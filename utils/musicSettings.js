/**
 * Music Settings Helper — per-guild music customization.
 *
 * Reads from jsonStore 'music' (the same store the dashboard's
 * "Music" module writes to via `PUT /api/guild/:id/music`). Until this
 * helper existed the bot had no consumer for that store at all, so
 * dashboard saves were write-only. Each accessor returns a sane
 * default when the guild has never been configured.
 *
 * Schema (matches dashboard/public/modules.js → music):
 *   {
 *     enabled, defaultVolume, maxQueueSize,
 *     djRoleId, voteSkip, announce
 *   }
 */

'use strict';

const jsonStore = require('./jsonStore');

const DEFAULTS = Object.freeze({
    enabled: true,
    defaultVolume: 80,    // %, matches dashboard default
    maxQueueSize: 100,    // tracks
    djRoleId: null,       // null means no DJ restriction
    voteSkip: true,       // require majority vote-skip
    announce: true        // post "Now Playing" message on trackStart
});

function loadAll() {
    if (!jsonStore.has('music')) return {};
    try { return jsonStore.read('music'); } catch { return {}; }
}

function getMusicSettings(guildId) {
    if (!guildId) return { ...DEFAULTS };
    const all = loadAll();
    const s = all[guildId] || {};
    const num = (v, d) => Number.isFinite(Number(v)) ? Number(v) : d;
    const bool = (v, d) => typeof v === 'boolean' ? v : d;
    return {
        enabled: bool(s.enabled, DEFAULTS.enabled),
        defaultVolume: Math.min(200, Math.max(0, num(s.defaultVolume, DEFAULTS.defaultVolume))),
        maxQueueSize: Math.min(1000, Math.max(1, num(s.maxQueueSize, DEFAULTS.maxQueueSize))),
        djRoleId: s.djRoleId || DEFAULTS.djRoleId,
        voteSkip: bool(s.voteSkip, DEFAULTS.voteSkip),
        announce: bool(s.announce, DEFAULTS.announce)
    };
}

module.exports = { DEFAULTS, getMusicSettings };
