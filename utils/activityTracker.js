'use strict';

/**
 * activityTracker.js — lightweight per-user message & voice activity tracking
 * for Statbot-style /userstats cards.
 *
 * Stores, per guild → per user:
 *   • msg:   { 'YYYY-MM-DD': count }     daily message counts (last 14 days)
 *   • vc:    { 'YYYY-MM-DD': seconds }   daily voice seconds  (last 14 days)
 *   • msgCh: { channelId: count }        per-text-channel message totals
 *   • vcCh:  { channelId: seconds }      per-voice-channel time totals
 *   • last:  timestamp of last activity
 *
 * Backed by the `user-activity` JSON store (debounced hot store). All writes
 * use peek()+markDirty() so we never deep-clone the (potentially large) store
 * on the message hot-path.
 *
 * © Rajeev (Rexzy) — xNico
 */

const jsonStore = require('./jsonStore');

const STORE = 'user-activity';
const KEEP_DAYS = 30;

function dayKey(ts = Date.now()) {
    return new Date(ts).toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

function last14Keys() {
    const keys = [];
    const now = Date.now();
    for (let i = KEEP_DAYS - 1; i >= 0; i--) {
        keys.push(dayKey(now - i * 86_400_000));
    }
    return keys;
}

function getStore() {
    let data = jsonStore.peek(STORE);
    if (!data || typeof data !== 'object') {
        data = {};
        jsonStore.cache.set(STORE, data);
    }
    return data;
}

function getUserEntry(store, guildId, userId, create = false) {
    if (!store[guildId]) {
        if (!create) return null;
        store[guildId] = {};
    }
    if (!store[guildId][userId]) {
        if (!create) return null;
        store[guildId][userId] = { msg: {}, vc: {}, msgCh: {}, vcCh: {}, last: 0 };
    }
    return store[guildId][userId];
}

/** Drop day buckets older than KEEP_DAYS so the store stays bounded. */
function pruneDays(map) {
    const valid = new Set(last14Keys());
    for (const k of Object.keys(map)) {
        if (!valid.has(k)) delete map[k];
    }
}

/** Record a message for ranking + daily/channel breakdowns. */
function recordMessage(guildId, userId, channelId) {
    if (!guildId || !userId) return;
    try {
        const store = getStore();
        const u = getUserEntry(store, guildId, userId, true);
        const d = dayKey();
        u.msg[d] = (u.msg[d] || 0) + 1;
        if (channelId) u.msgCh[channelId] = (u.msgCh[channelId] || 0) + 1;
        u.last = Date.now();
        pruneDays(u.msg);
        jsonStore.markDirty(STORE);
    } catch { /* non-fatal */ }
}

/** Record voice seconds for ranking + daily/channel breakdowns. */
function recordVoice(guildId, userId, channelId, seconds) {
    if (!guildId || !userId || !seconds || seconds <= 0) return;
    try {
        const store = getStore();
        const u = getUserEntry(store, guildId, userId, true);
        const d = dayKey();
        u.vc[d] = (u.vc[d] || 0) + seconds;
        if (channelId) u.vcCh[channelId] = (u.vcCh[channelId] || 0) + seconds;
        u.last = Date.now();
        pruneDays(u.vc);
        jsonStore.markDirty(STORE);
    } catch { /* non-fatal */ }
}

function sumDays(map, days) {
    const keys = last14Keys().slice(KEEP_DAYS - days);
    let total = 0;
    for (const k of keys) total += map[k] || 0;
    return total;
}

function topEntry(map) {
    let best = null, bestVal = 0;
    for (const [id, v] of Object.entries(map || {})) {
        if (v > bestVal) { bestVal = v; best = id; }
    }
    return best ? { id: best, value: bestVal } : null;
}

/**
 * Compute a full stats snapshot for a user in a guild.
 * Ranks are computed against every tracked member's 14-day totals.
 */
function getUserStats(guildId, userId) {
    const store = getStore();
    const guildData = store[guildId] || {};
    const u = guildData[userId] || { msg: {}, vc: {}, msgCh: {}, vcCh: {}, last: 0 };

    const msg1d = sumDays(u.msg, 1);
    const msg7d = sumDays(u.msg, 7);
    const msg14d = sumDays(u.msg, 14);
    const vc1d = sumDays(u.vc, 1);
    const vc7d = sumDays(u.vc, 7);
    const vc14d = sumDays(u.vc, 14);

    // ── Ranks (by 14-day totals) ──
    let msgRank = 0, vcRank = 0, msgTotalRanked = 0, vcTotalRanked = 0;
    const msgTotals = [];
    const vcTotals = [];
    for (const [uid, entry] of Object.entries(guildData)) {
        const m = sumDays(entry.msg || {}, 14);
        const v = sumDays(entry.vc || {}, 14);
        if (m > 0) msgTotals.push({ uid, v: m });
        if (v > 0) vcTotals.push({ uid, v });
    }
    msgTotals.sort((a, b) => b.v - a.v);
    vcTotals.sort((a, b) => b.v - a.v);
    msgTotalRanked = msgTotals.length;
    vcTotalRanked = vcTotals.length;
    const mi = msgTotals.findIndex(x => x.uid === userId);
    const vi = vcTotals.findIndex(x => x.uid === userId);
    msgRank = mi >= 0 ? mi + 1 : 0;
    vcRank = vi >= 0 ? vi + 1 : 0;

    // ── Daily series (oldest → newest) for the chart ──
    const series = last14Keys().map(k => ({
        day: k,
        msg: u.msg[k] || 0,
        vc: u.vc[k] || 0,
    }));

    return {
        msg1d, msg7d, msg14d,
        vc1d, vc7d, vc14d,
        msgRank, vcRank, msgTotalRanked, vcTotalRanked,
        topMsgChannel: topEntry(u.msgCh),
        topVcChannel: topEntry(u.vcCh),
        series,
        lastSeen: u.last || 0,
    };
}

/**
 * Server-wide activity snapshot: messages/voice/contributors over 1d/7d/14d,
 * top member (messages & voice), top channel (messages & voice), and the
 * 14-day daily series for the chart. Aggregated across every tracked member,
 * so it stays in sync with the per-user /userstats data and leveling stats.
 */
function getServerStats(guildId) {
    const store = getStore();
    const guildData = store[guildId] || {};
    const keys = last14Keys();

    const msg = { 1: 0, 7: 0, 14: 0 };
    const vc = { 1: 0, 7: 0, 14: 0 };
    const contrib = { 1: new Set(), 7: new Set(), 14: new Set() };
    const msgChAgg = {}, vcChAgg = {};
    const msgByUser = [], vcByUser = [];
    const dayMsg = {}, dayVc = {};

    for (const [uid, u] of Object.entries(guildData)) {
        const m1 = sumDays(u.msg, 1), m7 = sumDays(u.msg, 7), m14 = sumDays(u.msg, 14);
        const v1 = sumDays(u.vc, 1), v7 = sumDays(u.vc, 7), v14 = sumDays(u.vc, 14);
        msg[1] += m1; msg[7] += m7; msg[14] += m14;
        vc[1] += v1; vc[7] += v7; vc[14] += v14;
        if (m1 > 0 || v1 > 0) contrib[1].add(uid);
        if (m7 > 0 || v7 > 0) contrib[7].add(uid);
        if (m14 > 0 || v14 > 0) contrib[14].add(uid);
        if (m14 > 0) msgByUser.push({ id: uid, value: m14 });
        if (v14 > 0) vcByUser.push({ id: uid, value: v14 });
        for (const [ch, c] of Object.entries(u.msgCh || {})) msgChAgg[ch] = (msgChAgg[ch] || 0) + c;
        for (const [ch, c] of Object.entries(u.vcCh || {})) vcChAgg[ch] = (vcChAgg[ch] || 0) + c;
        for (const k of keys) { dayMsg[k] = (dayMsg[k] || 0) + (u.msg[k] || 0); dayVc[k] = (dayVc[k] || 0) + (u.vc[k] || 0); }
    }

    msgByUser.sort((a, b) => b.value - a.value);
    vcByUser.sort((a, b) => b.value - a.value);

    return {
        msg1d: msg[1], msg7d: msg[7], msg14d: msg[14],
        vc1d: vc[1], vc7d: vc[7], vc14d: vc[14],
        contrib1d: contrib[1].size, contrib7d: contrib[7].size, contrib14d: contrib[14].size,
        topMsgUser: msgByUser[0] || null,
        topVcUser: vcByUser[0] || null,
        topMsgChannel: topEntry(msgChAgg),
        topVcChannel: topEntry(vcChAgg),
        series: keys.map(k => ({ day: k, msg: dayMsg[k] || 0, vc: dayVc[k] || 0 })),
    };
}

/**
 * Ranked message leaderboard for a guild over the last `days` days.
 * Returns [{ userId, value }] sorted descending. `days` is clamped to
 * the retention window (KEEP_DAYS). Used by the live leaderboard.
 */
function getMessageLeaderboard(guildId, days = 1, limit = 10) {
    const store = getStore();
    const guildData = store[guildId] || {};
    const window = Math.min(Math.max(1, days), KEEP_DAYS);

    const rows = [];
    for (const [uid, u] of Object.entries(guildData)) {
        const total = sumDays(u.msg || {}, window);
        if (total > 0) rows.push({ userId: uid, value: total });
    }
    rows.sort((a, b) => b.value - a.value);
    return rows.slice(0, limit);
}

module.exports = { recordMessage, recordVoice, getUserStats, getServerStats, getMessageLeaderboard, dayKey };
