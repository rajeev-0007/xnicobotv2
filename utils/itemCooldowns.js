'use strict';

/**
 * itemCooldowns.js — per-user, per-item usage cooldowns.
 *
 * Some shop items used to be effectively unlimited:
 *   - `coin_bag` cost 3,000 coins and paid out 5,000–15,000 — guaranteed
 *     profit, so a player could spam-buy it and infinitely print money.
 *   - `mystery_box` and `crystal_box` had no cooldown either, so a
 *     player with a stack could trigger 50+ pet drops or coin floods
 *     in a single button press.
 *
 * This module centralises the rules so:
 *   - Every cooldown is one canonical entry per item id (no scattered
 *     constants across `use.js`).
 *   - State persists across restarts (jsonStore-backed).
 *   - Other commands (shop, inventory) can render the remaining time
 *     consistently using `formatRemaining()`.
 *
 * The coin-bag itself is also rebalanced inside use.js so a single
 * use is no longer a guaranteed profit — see the comment there.
 */

const jsonStore = require('./jsonStore');

const STORE_KEY = 'item_cooldowns';

/**
 * Cooldown definitions in milliseconds.
 *
 * Anything not listed here can be used freely. We deliberately keep
 * the list short and put cooldowns only on items where:
 *   1. The reward has variance (loot boxes), so spamming would let
 *      players cherry-pick lucky outcomes; OR
 *   2. The reward is a server-wide convenience that should be earned
 *      (time-skip, energy-drink resetting work cooldowns).
 */
const ITEM_COOLDOWNS = {
    /* ── Loot boxes — capped to once per cooldown period regardless of stack ── */
    mystery_box:  60 * 60 * 1000,        // 1 hour
    crystal_box:  90 * 60 * 1000,        // 1.5 hours (more valuable rewards)
    // Weapon boxes are the primary way to roll new weapons for your
    // active pet. Keep them snappy so trying out the new expanded
    // weapon catalog feels rewarding rather than chore-gated. The
    // premium `weapon_crate` carries a much longer cooldown because
    // its drop pool tilts toward rare/epic/legendary/mythic.
    weapon_box:   60 * 1000,             // 1 minute
    weapon_crate: 30 * 60 * 1000,        // 30 minutes
    dragon_egg:   12 * 60 * 60 * 1000,   // 12 hours (legendary pet)

    /* ── Skill scroll — gentle gating so a stack can't blanket-fill
     * a pet's learned-skills pool in a single click. ── */
    skill_scroll: 90 * 1000,             // 90 seconds

    /* ── Coin bag — gentle gating so it can't print money in a loop ── */
    coin_bag:     15 * 60 * 1000,        // 15 minutes

    /* ── Cooldown-resetting items — must themselves have a cooldown,
     * otherwise they trivialise the work/daily systems entirely ── */
    energy_drink: 4 * 60 * 60 * 1000,    // 4 hours
    time_skip:    8 * 60 * 60 * 1000,    // 8 hours
};

/* ─────────────────── persistence ─────────────────── */

function load() {
    if (!jsonStore.has(STORE_KEY)) return {};
    try { return jsonStore.read(STORE_KEY) || {}; }
    catch { return {}; }
}
function save(data) {
    jsonStore.write(STORE_KEY, data);
}

/* ─────────────────── public API ─────────────────── */

/**
 * Look up the cooldown duration for an item id, in milliseconds.
 * Returns 0 if the item has no cooldown configured.
 */
function getCooldown(itemId) {
    return ITEM_COOLDOWNS[itemId] || 0;
}

/**
 * Returns ms remaining on the cooldown for (userId, itemId).
 * 0 means "ready to use".
 */
function getRemaining(userId, itemId) {
    const cd = getCooldown(itemId);
    if (!cd) return 0;
    const data = load();
    const last = data[userId]?.[itemId] || 0;
    const elapsed = Date.now() - last;
    return elapsed >= cd ? 0 : cd - elapsed;
}

/**
 * Record that a user just used the item. No-op if the item has no
 * cooldown configured.
 */
function markUsed(userId, itemId) {
    const cd = getCooldown(itemId);
    if (!cd) return;
    const data = load();
    data[userId] ||= {};
    data[userId][itemId] = Date.now();
    save(data);
}

/**
 * Format a millisecond remaining-time as a short human string.
 * Examples: "12s", "3m 4s", "1h 22m", "1d 4h"
 */
function formatRemaining(ms) {
    if (ms <= 0) return '0s';
    const s = Math.ceil(ms / 1000);
    if (s < 60)        return `${s}s`;
    const m = Math.floor(s / 60), rs = s % 60;
    if (m < 60)        return rs ? `${m}m ${rs}s` : `${m}m`;
    const h = Math.floor(m / 60), rm = m % 60;
    if (h < 24)        return rm ? `${h}h ${rm}m` : `${h}h`;
    const d = Math.floor(h / 24), rh = h % 24;
    return rh ? `${d}d ${rh}h` : `${d}d`;
}

/**
 * Format a millisecond remaining-time as a Discord relative timestamp
 * (e.g. <t:1234567890:R>). Useful for "ready <t:…:R>" labels.
 */
function formatReadyAt(ms) {
    const ts = Math.floor((Date.now() + ms) / 1000);
    return `<t:${ts}:R>`;
}

module.exports = {
    ITEM_COOLDOWNS,
    getCooldown,
    getRemaining,
    markUsed,
    formatRemaining,
    formatReadyAt,
};
