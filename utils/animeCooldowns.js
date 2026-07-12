'use strict';

/**
 * animeCooldowns.js — shared, persisted cooldowns for the anime commands.
 *
 * Cooldowns are stored on the player's record (playerData.cooldowns[key]) in
 * the anime_collection store, so they survive restarts and can't be bypassed
 * by re-deploying. Use check() before an action and set() after it succeeds.
 */

// Standard cooldown durations (ms) per command key. Tune here in one place.
const DURATIONS = {
    aopen:     12 * 60 * 60 * 1000, // mystery box — 12h (anti bulk-open)
    aguess:    12 * 1000,           // guess-the-character mini game
    animequiz: 12 * 1000,           // anime quiz
    abattle:   60 * 1000,           // card battle
    afuse:     30 * 1000,           // fusion
    aupgrade:  30 * 1000,           // upgrade
};

function getStore(playerData) {
    if (!playerData.cooldowns || typeof playerData.cooldowns !== 'object') {
        playerData.cooldowns = {};
    }
    return playerData.cooldowns;
}

/**
 * Check whether an action is on cooldown.
 * @returns {{ ok: true } | { ok: false, remaining: number }}
 */
function check(playerData, key, durationMs = DURATIONS[key]) {
    if (!durationMs) return { ok: true };
    const cds = getStore(playerData);
    const last = Number(cds[key]) || 0;
    const elapsed = Date.now() - last;
    if (elapsed < durationMs) return { ok: false, remaining: durationMs - elapsed };
    return { ok: true };
}

/** Stamp the cooldown as used now. */
function set(playerData, key) {
    getStore(playerData)[key] = Date.now();
}

/** Human-readable remaining time, e.g. "11h 59m", "45s". */
function fmt(ms) {
    ms = Math.max(0, Number(ms) || 0);
    const s = Math.ceil(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${s % 60}s`;
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h % 24}h`;
    return `${h}h ${m % 60}m`;
}

module.exports = { DURATIONS, check, set, fmt };
