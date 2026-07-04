'use strict';

/**
 * Confession Manager
 * ──────────────────
 * Centralized helpers for the confession system.
 *
 * Storage layout (jsonStore key: `confessions`):
 * {
 *   "<guildId>": {
 *     channelId,                // channel where confessions are posted
 *     logChannelId,             // optional staff channel that receives author info
 *     panel: { channelId, messageId },  // optional public Submit panel
 *     allowAnonymous: true,
 *     allowPublic: true,
 *     allowReplies: true,
 *     allowReports: true,
 *     bannedUserIds: [],
 *     blockedWords: [],         // moderation: confessions containing these are silently rejected
 *     count: 0,
 *     log: {
 *       "<confessionId>": {
 *         userId, username, timestamp, number, mode: 'anonymous'|'public', text
 *       }
 *     }
 *   }
 * }
 */

const jsonStore = require('./jsonStore');
const STORE = 'confessions';

function getDefaultGuildConfig() {
    return {
        channelId: null,
        logChannelId: null,
        panel: null,
        allowAnonymous: true,
        allowPublic: true,
        allowReplies: true,
        allowReports: true,
        bannedUserIds: [],
        blockedWords: [],
        count: 0,
        log: {}
    };
}

function loadAll() {
    if (!jsonStore.has(STORE)) {
        jsonStore.write(STORE, {});
        return {};
    }
    const data = jsonStore.read(STORE);
    return (data && typeof data === 'object') ? data : {};
}

function saveAll(data) { jsonStore.write(STORE, data); }

function getGuildConfig(guildId) {
    const all = loadAll();
    if (!all[guildId]) return getDefaultGuildConfig();
    const cfg = { ...getDefaultGuildConfig(), ...all[guildId] };
    if (!Array.isArray(cfg.bannedUserIds)) cfg.bannedUserIds = [];
    if (!Array.isArray(cfg.blockedWords)) cfg.blockedWords = [];
    if (!cfg.log || typeof cfg.log !== 'object') cfg.log = {};
    return cfg;
}

function saveGuildConfig(guildId, cfg) {
    const all = loadAll();
    all[guildId] = cfg;
    saveAll(all);
}

function generateId() {
    // 8-char base36 — unique enough for log lookups, easy to read.
    return Math.random().toString(36).substring(2, 10).toUpperCase();
}

function formatNumber(n) {
    return `#${String(n).padStart(4, '0')}`;
}

function isBanned(cfg, userId) {
    return Array.isArray(cfg.bannedUserIds) && cfg.bannedUserIds.includes(userId);
}

function containsBlockedWord(cfg, text) {
    if (!Array.isArray(cfg.blockedWords) || !cfg.blockedWords.length) return null;
    const lower = String(text).toLowerCase();
    for (const w of cfg.blockedWords) {
        if (!w) continue;
        if (lower.includes(String(w).toLowerCase())) return w;
    }
    return null;
}

function recordConfession(cfg, { userId, username, text, mode }) {
    cfg.count = (cfg.count || 0) + 1;
    const id = generateId();
    cfg.log[id] = {
        userId,
        username,
        timestamp: Date.now(),
        number: cfg.count,
        mode,
        text: String(text).slice(0, 4000)
    };
    return { id, number: cfg.count };
}

function recordReply(cfg, confessionId, userId, replyText) {
    const conf = cfg.log[confessionId];
    if (!conf) return null;
    if (!Array.isArray(conf.replies)) conf.replies = [];
    conf.replies.push({
        userId,
        timestamp: Date.now(),
        text: String(replyText).slice(0, 2000)
    });
    return conf;
}

module.exports = {
    STORE,
    getDefaultGuildConfig,
    loadAll,
    saveAll,
    getGuildConfig,
    saveGuildConfig,
    generateId,
    formatNumber,
    isBanned,
    containsBlockedWord,
    recordConfession,
    recordReply
};
