'use strict';

/**
 * lotteryScheduler.js — Background scheduler for the server lottery.
 *
 * Runs in a single global interval started from the bot's ready
 * handler. On every tick it does three things, in order:
 *
 *   1.  If a draw is active and its timer has expired, run the draw,
 *       persist the history, and announce winners (callback hook).
 *   2.  If a draw is active and still running, give the AI bettor a
 *       chance to buy a ticket according to its strategy.
 *   3.  If no draw is active, leave the state untouched. The first
 *       human (or AI) ticket will start a new draw cleanly.
 *
 * The scheduler is intentionally simple — it is a server-wide
 * bookkeeping loop rather than per-channel or per-guild. The actual
 * UI panels run their own tighter refresh interval; this scheduler
 * is the source of truth for state mutations.
 *
 * © Rajeev (Rexzy) — xNico
 */

const economyManager = require('./economyManager');
const jsonStore = require('./jsonStore');
const lotteryAI = require('./lotteryAI');

/* ───────────────────── Tunables (kept in sync with /lottery) ───────────────────── */

const LOTTERY_DURATION = 60 * 60 * 1000; // 1 hour
const GST_RATE         = 0.18;
const BASE_TICKET_PRICE = 500;
const PRICE_STEP        = 250;
const MAX_TICKETS       = 20;

const TICK_MS = 5_000; // 5s — cheap, lets the AI feel "alive" without spam

let _interval = null;
let _onWinners = null;

/* ─────────────────────────── Storage ─────────────────────────── */

function loadLottery() {
    if (!jsonStore.has('lottery')) {
        const fresh = {
            active: false,
            endsAt: 0,
            jackpot: 0,
            lastJackpot: 0,
            entries: {},
            history: { endedAt: null, gst: 0, winners: [] },
        };
        jsonStore.write('lottery', fresh);
        return fresh;
    }
    return jsonStore.read('lottery');
}

function saveLottery(data) {
    jsonStore.write('lottery', data);
}

/* ─────────────────────────── Draw logic ─────────────────────────── */

/**
 * Pick a winner from the entries map, weighted by ticket count.
 * Removes them from `entries` so the next pick can't repeat.
 */
function pickWeighted(entries) {
    const ids = Object.keys(entries);
    if (ids.length === 0) return null;
    let total = 0;
    for (const id of ids) total += entries[id];
    let r = Math.floor(Math.random() * total);
    for (const id of ids) {
        r -= entries[id];
        if (r < 0) {
            delete entries[id];
            return id;
        }
    }
    // Fallback (shouldn't happen)
    const fallback = ids[ids.length - 1];
    delete entries[fallback];
    return fallback;
}

/**
 * Run the draw if the current state is eligible. Returns the
 * winners array (`[{id, reward, isAI}]`) or null if no draw ran.
 *
 * Safe to call any number of times; only fires when the timer
 * has expired AND there are tickets in play AND at least one
 * human or AI participated.
 */
async function runDrawIfDue() {
    const lottery = loadLottery();
    if (!lottery.active || Date.now() < lottery.endsAt) return null;

    const totalTickets = Object.values(lottery.entries).reduce((a, b) => a + b, 0);

    // No participants — silently roll the state back so the next
    // /lottery invocation starts a fresh draw without confusion.
    if (totalTickets === 0) {
        lottery.active = false;
        lottery.endsAt = 0;
        lottery.jackpot = 0;
        lotteryAI.resetAI(lottery);
        saveLottery(lottery);
        return null;
    }

    const economy = economyManager.loadEconomy();
    const gst  = Math.floor(lottery.jackpot * GST_RATE);
    const pool = lottery.jackpot - gst;

    // Up to 3 distinct winners — 60/25/15 split. If only one or two
    // participants exist, payouts collapse cleanly.
    const tempEntries = { ...lottery.entries };
    const shares = [0.60, 0.25, 0.15];
    const slots = Math.min(shares.length, Object.keys(tempEntries).length);
    const winners = [];

    let unawarded = pool;
    for (let i = 0; i < slots; i++) {
        const id = pickWeighted(tempEntries);
        if (!id) break;
        const isAI = lotteryAI.isAIEntry(id);
        // For the final pick, award everything that's left so we
        // never lose coins to floor() rounding errors.
        const reward = i === slots - 1
            ? unawarded
            : Math.floor(pool * shares[i]);
        unawarded -= reward;

        if (!isAI && reward > 0) {
            const { userData } = economyManager.getUser(economy, id);
            userData.coins += reward;
        }
        winners.push({ id, reward, isAI });
    }

    economyManager.saveEconomy(economy);

    lottery.history = {
        endedAt: Date.now(),
        gst,
        winners,
        totalTickets,
        totalPot: lottery.jackpot,
    };

    lottery.active = false;
    lottery.endsAt = 0;
    lottery.jackpot = 0;
    lottery.lastJackpot = 0;
    lottery.entries = {};
    lotteryAI.resetAI(lottery);

    saveLottery(lottery);

    // Broadcast hook — fire-and-forget; consumer is responsible
    // for swallowing its own errors.
    if (typeof _onWinners === 'function') {
        try { await _onWinners(lottery.history); } catch (_) { /* swallow */ }
    }

    return winners;
}

/* ─────────────────────────── AI ticking ─────────────────────────── */

/**
 * Give the AI a chance to participate. Returns the buy result
 * `{ bought, spent }` or `{ bought: 0, spent: 0 }` if no buy.
 */
function tickAIIfActive() {
    const lottery = loadLottery();
    if (!lottery.active) return { bought: 0, spent: 0 };

    const result = lotteryAI.tickAI(lottery, {
        basePrice:  BASE_TICKET_PRICE,
        priceStep:  PRICE_STEP,
        maxTickets: MAX_TICKETS,
    });

    if (result.bought > 0) saveLottery(lottery);
    return result;
}

/* ─────────────────────────── Public start/stop ─────────────────────────── */

function start({ onWinners } = {}) {
    if (_interval) return;
    if (typeof onWinners === 'function') _onWinners = onWinners;

    _interval = setInterval(async () => {
        try {
            // Draw first (so a finished round doesn't accidentally also
            // get one extra AI ticket between expiry and draw).
            await runDrawIfDue();
            tickAIIfActive();
        } catch (err) {
            console.error('[lotteryScheduler] tick error:', err);
        }
    }, TICK_MS);

    // Don't keep the event loop alive on shutdown — the bot will exit
    // normally when other handles are released.
    if (_interval && typeof _interval.unref === 'function') _interval.unref();
}

function stop() {
    if (_interval) {
        clearInterval(_interval);
        _interval = null;
    }
}

/* ─────────────────────────── Exports ─────────────────────────── */

module.exports = {
    start,
    stop,
    runDrawIfDue,
    tickAIIfActive,
    loadLottery,
    saveLottery,
    // Constants exported so the /lottery command file shares one
    // source of truth instead of redeclaring them.
    LOTTERY_DURATION,
    GST_RATE,
    BASE_TICKET_PRICE,
    PRICE_STEP,
    MAX_TICKETS,
};
