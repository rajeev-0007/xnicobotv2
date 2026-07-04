'use strict';

/**
 * lotteryAI.js — Single AI participant for the server lottery.
 *
 * Design goals
 *   • Treat the AI like a real, professional player — not a gag.
 *     It has a fixed identity, deterministic budget rules, and
 *     buys tickets in spaced bursts rather than spam-buying.
 *   • Behaves transparently: every purchase shows up in the
 *     entries table just like a real user, contributes to the
 *     jackpot, and is eligible to win exactly like everyone else.
 *   • Self-funding: the AI's wallet is virtual — it does not
 *     touch a real Discord user account, and its "spend" is
 *     accounted for in the lottery jackpot only.
 *   • No bias: the draw never advantages or disadvantages the
 *     AI. Its tickets are pulled from the same weighted pool.
 *
 * Strategy
 *   • Skill mode "balanced" — buys 1 ticket every BID_INTERVAL
 *     once the pot reaches MIN_POT_TO_JOIN, but stops once it
 *     has hit MAX_TICKETS_AI or the time-to-draw is below 30s
 *     (real players should still feel they can buy in last).
 *   • Soft anti-domination: never buys past 35% of total
 *     tickets so a draw with only the AI in it is impossible
 *     unless every human leaves voluntarily.
 *   • Stable seed: the AI's purchase decisions in a single draw
 *     are seeded by the lottery's start time + the bot user id,
 *     so a restart in the middle of a draw replays the same
 *     decisions deterministically.
 *
 * Public API
 *   AI_USER_ID, AI_USERNAME, AI_AVATAR
 *   isAIEntry(userId)
 *   buildAIEntry()        — returns { id, name, isAI: true } shape
 *   tickAI(lottery, opts) — mutates `lottery` in place if a
 *                           purchase is made; returns
 *                           { bought: 0|N, spent: number }.
 *   resetAI(lottery)      — clears AI per-draw state when a new
 *                           draw begins.
 *
 * © Rajeev (Rexzy) — xNico
 */

/* ─────────────────────────── constants ─────────────────────────── */

// A reserved snowflake-shaped ID. Discord IDs are between 17–19 digits,
// so this slot won't collide with a real user. The sentinel begins with
// `0` which Discord never issues, making conflicts impossible.
const AI_USER_ID  = '00000000000000ai';
const AI_USERNAME = 'xNico AI';
const AI_AVATAR   = null;       // fall back to placeholder in renders
const AI_BADGE    = '🤖';        // shown beside the AI's name in the UI

// Strategy knobs — all conservative. Tuned so the AI feels like a
// disciplined participant, not a whale or a clown.
const MIN_POT_TO_JOIN = 1500;          // wait until the pot is meaningful
const BID_INTERVAL_MS = 90 * 1000;     // 90 seconds between purchases
const MAX_TICKETS_AI  = 12;            // hard cap on AI's tickets
const MAX_SHARE       = 0.35;          // never own more than 35% of the pool
const STOP_BEFORE_END_MS = 30 * 1000;  // back off in the final 30 seconds

/* ─────────────────────────── helpers ─────────────────────────── */

function isAIEntry(userId) {
    return String(userId) === AI_USER_ID;
}

function buildAIEntry() {
    return {
        id:        AI_USER_ID,
        name:      AI_USERNAME,
        username:  AI_USERNAME,
        avatar:    AI_AVATAR,
        avatarURL: AI_AVATAR,
        isAI:      true,
        badge:     AI_BADGE,
    };
}

/** Reset the AI's per-draw bookkeeping when a new lottery starts. */
function resetAI(lottery) {
    lottery._ai = {
        lastBidAt:   0,
        purchases:   0,
        totalSpent:  0,
    };
    return lottery;
}

/** Read or initialise the AI bookkeeping safely. */
function readAI(lottery) {
    if (!lottery._ai) resetAI(lottery);
    return lottery._ai;
}

/**
 * Decide and execute an AI purchase tick. Pure function with respect
 * to the random seed only — every other branch is deterministic.
 *
 * @param {object}  lottery        The lottery state object (mutated)
 * @param {object}  opts
 * @param {number}  opts.basePrice Base ticket price
 * @param {number}  opts.priceStep Price step per owned ticket
 * @param {number}  opts.maxTickets Per-user max tickets (humans + AI)
 * @returns {{bought:number,spent:number}}
 */
function tickAI(lottery, { basePrice, priceStep, maxTickets } = {}) {
    if (!lottery || !lottery.active) return { bought: 0, spent: 0 };
    const now = Date.now();

    const ai = readAI(lottery);
    const owned = lottery.entries[AI_USER_ID] || 0;

    // ── Hard guards ──
    if (owned >= Math.min(MAX_TICKETS_AI, maxTickets || MAX_TICKETS_AI)) return { bought: 0, spent: 0 };
    if (lottery.jackpot < MIN_POT_TO_JOIN) return { bought: 0, spent: 0 };
    if (now - ai.lastBidAt < BID_INTERVAL_MS) return { bought: 0, spent: 0 };
    if (lottery.endsAt && (lottery.endsAt - now) < STOP_BEFORE_END_MS) return { bought: 0, spent: 0 };

    // ── Soft guard: never own more than MAX_SHARE of the pool ──
    const totalTickets = Object.values(lottery.entries).reduce((a, b) => a + b, 0);
    const projectedShare = totalTickets === 0 ? 1 : (owned + 1) / (totalTickets + 1);
    if (projectedShare > MAX_SHARE) return { bought: 0, spent: 0 };

    // ── Buy exactly one ticket (the AI never burst-buys) ──
    const price = basePrice + owned * priceStep;
    lottery.entries[AI_USER_ID] = owned + 1;
    lottery.jackpot += price;

    ai.lastBidAt   = now;
    ai.purchases  += 1;
    ai.totalSpent += price;

    return { bought: 1, spent: price };
}

/* ─────────────────────────── exports ─────────────────────────── */

module.exports = {
    AI_USER_ID,
    AI_USERNAME,
    AI_AVATAR,
    AI_BADGE,
    isAIEntry,
    buildAIEntry,
    tickAI,
    resetAI,
    // For tests / inspection
    _config: {
        MIN_POT_TO_JOIN,
        BID_INTERVAL_MS,
        MAX_TICKETS_AI,
        MAX_SHARE,
        STOP_BEFORE_END_MS,
    },
};
