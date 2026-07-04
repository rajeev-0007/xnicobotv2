'use strict';

/**
 * Join-to-Create Manager (v4 — multi-interface, clean UX)
 * ───────────────────────────────────────────────────────────────────
 * A guild can run several Join-to-Create "interfaces". Each interface
 * is a single trigger VC + a single control panel + its own defaults
 * (naming, user limit, bitrate, visibility, auto-delete, role gating).
 *
 * - Free guilds  : up to MAX_INTERFACES_FREE   (1)
 * - Premium      : up to MAX_INTERFACES_PREMIUM (10)
 *
 * SCHEMA v4 (per-guild)
 *   {
 *     schemaVersion: 4,
 *     interfaces: {
 *       [id]: {
 *         id, name, emoji, enabled,
 *         triggerChannelIds: [vcId, ...],   // ≥1 trigger VCs for this interface
 *         categoryId,
 *         interfaceChannelId, controlPanelMessageId,
 *         namingTemplate,
 *         defaultUserLimit, defaultBitrate,
 *         defaultVisibility, autoDelete,
 *         maxConcurrentChannels,
 *         allowedRoles, deniedRoles,
 *         createdAt, updatedAt
 *       }
 *     },
 *     activeChannels: {
 *       [ownerUserId]: {
 *         channelId, interfaceId, createdAt,
 *         trustedUsers: [], bannedUsers: []
 *       }
 *     },
 *     analytics: { totalCreated, lastCreatedAt }
 *   }
 *
 * Migrations
 *   v1 (legacy flat)         → v4 : lift legacy fields into one interface
 *   v2 (interfaces map)      → v4 : rename to v4, normalize per-iface keys
 *   v3 (single config)       → v4 : lift single config into one interface
 */

const jsonStore       = require('./jsonStore');
const log             = require('./logger-styled');
const premiumManager  = require('./premiumManager');

const STORE = 'join2create';

const SCHEMA_VERSION         = 4;
const MAX_INTERFACES_FREE    = 1;
const MAX_INTERFACES_PREMIUM = 10;
const DEFAULT_BITRATE_KBPS   = 96;

/* ═══════════════════════════════════════════════════════════════════
   STORE I/O
   ═══════════════════════════════════════════════════════════════════ */

function loadAll() {
    if (!jsonStore.has(STORE)) {
        jsonStore.write(STORE, {});
        return {};
    }
    return jsonStore.read(STORE) || {};
}

function saveAll(data) { jsonStore.write(STORE, data); }

function defaultGuildConfig() {
    return {
        schemaVersion: SCHEMA_VERSION,
        interfaces:    {},
        activeChannels: {},
        analytics: { totalCreated: 0, lastCreatedAt: 0 }
    };
}

function makeInterfaceId() {
    return 'i_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function defaultInterface(partial = {}) {
    const id = partial.id || makeInterfaceId();

    // Accept legacy single `triggerChannelId` and the new `triggerChannelIds` array.
    let triggers = [];
    if (Array.isArray(partial.triggerChannelIds)) triggers = partial.triggerChannelIds.filter(Boolean);
    else if (partial.triggerChannelId) triggers = [partial.triggerChannelId];
    triggers = [...new Set(triggers)].slice(0, 25);

    return {
        id,
        name:                  String(partial.name || 'Default').slice(0, 50) || 'Default',
        emoji:                 partial.emoji || '<:Volumeup:1521228004502536272>',
        enabled:               partial.enabled !== false,

        triggerChannelIds:     triggers,
        categoryId:            partial.categoryId            || null,
        interfaceChannelId:    partial.interfaceChannelId    || null,
        controlPanelMessageId: partial.controlPanelMessageId || null,

        namingTemplate:        String(partial.namingTemplate || "{user}'s Channel").slice(0, 100),
        defaultUserLimit:      clampInt(partial.defaultUserLimit ?? partial.maxUsers, 0, 99, 0),
        defaultBitrate:        clampInt(partial.defaultBitrate   ?? partial.bitrate,  8, 384, DEFAULT_BITRATE_KBPS),
        defaultVisibility:     partial.defaultVisibility === 'private' || partial.visibility === 'private' ? 'private' : 'public',
        autoDelete:            partial.autoDelete !== false,
        maxConcurrentChannels: clampInt(partial.maxConcurrentChannels ?? partial.maxChannels, 0, 99, 0),

        allowedRoles:          Array.isArray(partial.allowedRoles) ? partial.allowedRoles.slice(0, 25) : [],
        deniedRoles:           Array.isArray(partial.deniedRoles)  ? partial.deniedRoles.slice(0, 25)  : [],

        createdAt: partial.createdAt || Date.now(),
        updatedAt: Date.now()
    };
}

/* ═══════════════════════════════════════════════════════════════════
   MIGRATION
   ═══════════════════════════════════════════════════════════════════ */

function migrateGuildConfig(raw, guildId) {
    if (!raw || typeof raw !== 'object') return defaultGuildConfig();
    if (raw.schemaVersion === SCHEMA_VERSION && raw.interfaces) return raw;

    const fresh = defaultGuildConfig();

    // ── v3 (single-interface flat) → v4 ───────────────────────────
    if (raw.schemaVersion === 3) {
        if (raw.triggerChannelId || raw.interfaceChannelId) {
            const iface = defaultInterface({
                name:                  'Default',
                enabled:               raw.enabled !== false,
                triggerChannelId:      raw.triggerChannelId,
                categoryId:            raw.categoryId,
                interfaceChannelId:    raw.interfaceChannelId,
                controlPanelMessageId: raw.controlPanelMessageId,
                namingTemplate:        raw.namingTemplate,
                defaultUserLimit:      raw.defaultUserLimit,
                defaultBitrate:        raw.defaultBitrate,
                defaultVisibility:     raw.defaultVisibility,
                autoDelete:            raw.autoDelete,
                maxConcurrentChannels: raw.maxConcurrentChannels,
                allowedRoles:          raw.allowedRoles,
                deniedRoles:           raw.deniedRoles,
                createdAt:             raw.createdAt
            });
            fresh.interfaces[iface.id] = iface;

            // Carry over active channels and tag them with this interface.
            for (const [uid, entry] of Object.entries(raw.activeChannels || {})) {
                if (!entry) continue;
                const channelId = typeof entry === 'string' ? entry : entry.channelId;
                if (!channelId) continue;
                fresh.activeChannels[uid] = {
                    channelId,
                    interfaceId: iface.id,
                    createdAt:   entry.createdAt || Date.now(),
                    trustedUsers: Array.isArray(entry.trustedUsers) ? entry.trustedUsers : [],
                    bannedUsers:  Array.isArray(entry.bannedUsers)  ? entry.bannedUsers  : []
                };
            }
        }
        if (raw.analytics) fresh.analytics = { ...fresh.analytics, ...raw.analytics };
        log.info(`[J2C] Migrated guild ${guildId} from v3 → v${SCHEMA_VERSION}`);
        return fresh;
    }

    // ── v2 (interfaces map) → v4 ──────────────────────────────────
    if (raw.schemaVersion === 2 && raw.interfaces && typeof raw.interfaces === 'object') {
        for (const [id, src] of Object.entries(raw.interfaces)) {
            if (!src) continue;
            const iface = defaultInterface({
                id,
                name:                  src.name,
                emoji:                 src.emoji,
                enabled:               src.enabled !== false,
                // src may have either form depending on patch level
                triggerChannelIds:     Array.isArray(src.triggerChannelIds) ? src.triggerChannelIds : undefined,
                triggerChannelId:      src.triggerChannelId,
                categoryId:            src.categoryId,
                interfaceChannelId:    src.interfaceChannelId,
                controlPanelMessageId: src.controlPanelMessageId,
                namingTemplate:        src.namingTemplate,
                defaultUserLimit:      src.maxUsers,
                defaultBitrate:        src.bitrate,
                defaultVisibility:     src.visibility,
                autoDelete:            src.autoDelete,
                maxConcurrentChannels: src.maxConcurrentChannels ?? src.maxChannels,
                allowedRoles:          src.allowedRoles,
                deniedRoles:           src.deniedRoles,
                createdAt:             src.createdAt
            });
            fresh.interfaces[id] = iface;
        }
        for (const [uid, entry] of Object.entries(raw.activeChannels || {})) {
            if (!entry) continue;
            const channelId = typeof entry === 'string' ? entry : entry.channelId;
            if (!channelId) continue;
            fresh.activeChannels[uid] = {
                channelId,
                interfaceId: entry.interfaceId || (Object.keys(fresh.interfaces)[0] || null),
                createdAt:   entry.createdAt || Date.now(),
                trustedUsers: Array.isArray(entry.trustedUsers) ? entry.trustedUsers : [],
                bannedUsers:  Array.isArray(entry.bannedUsers)  ? entry.bannedUsers  : []
            };
        }
        if (raw.analytics) fresh.analytics = { ...fresh.analytics, ...raw.analytics };
        log.info(`[J2C] Migrated guild ${guildId} from v2 → v${SCHEMA_VERSION}`);
        return fresh;
    }

    // ── v1 (legacy flat) → v4 ─────────────────────────────────────
    if (raw.triggerChannelId || raw.interfaceChannelId) {
        const iface = defaultInterface({
            name:                  'Default',
            enabled:               raw.enabled !== false,
            triggerChannelId:      raw.triggerChannelId,
            interfaceChannelId:    raw.interfaceChannelId,
            controlPanelMessageId: raw.controlPanelMessageId,
            createdAt:             raw.createdAt
        });
        fresh.interfaces[iface.id] = iface;

        for (const [uid, val] of Object.entries(raw.activeChannels || {})) {
            if (!val) continue;
            const channelId = typeof val === 'string' ? val : val.channelId;
            if (!channelId) continue;
            fresh.activeChannels[uid] = {
                channelId,
                interfaceId: iface.id,
                createdAt:   val.createdAt || Date.now(),
                trustedUsers: Array.isArray(val.trustedUsers) ? val.trustedUsers : [],
                bannedUsers:  Array.isArray(val.bannedUsers)  ? val.bannedUsers  : []
            };
        }
    }
    log.info(`[J2C] Migrated guild ${guildId} from v${raw.schemaVersion || 1} → v${SCHEMA_VERSION}`);
    return fresh;
}

function getGuildConfig(guildId) {
    const all = loadAll();
    const raw = all[guildId];
    if (!raw) return defaultGuildConfig();
    return migrateGuildConfig(raw, guildId);
}

function saveGuildConfig(guildId, cfg) {
    const all = loadAll();
    cfg.schemaVersion = SCHEMA_VERSION;
    all[guildId] = cfg;
    saveAll(all);
}

function deleteGuildConfig(guildId) {
    const all = loadAll();
    delete all[guildId];
    saveAll(all);
}

/* ═══════════════════════════════════════════════════════════════════
   PREMIUM
   ═══════════════════════════════════════════════════════════════════ */

function getGuildTier(guildId, requesterUserId = null) {
    if (requesterUserId && premiumManager.hasPremiumAccess(requesterUserId, guildId)) return 'premium';
    if (premiumManager.isServerPremium(guildId)) return 'premium';
    return 'free';
}

function isPremium(guildId, requesterUserId = null) {
    return getGuildTier(guildId, requesterUserId) === 'premium';
}

function maxInterfacesFor(tier) {
    return tier === 'premium' ? MAX_INTERFACES_PREMIUM : MAX_INTERFACES_FREE;
}

function canAddInterface(guildId, requesterUserId = null) {
    const cfg  = getGuildConfig(guildId);
    const tier = getGuildTier(guildId, requesterUserId);
    const max  = maxInterfacesFor(tier);
    const currentCount = Object.keys(cfg.interfaces).length;

    if (currentCount < max) return { ok: true, tier, currentCount, max };
    return {
        ok: false,
        tier, currentCount, max,
        reason: tier === 'premium'
            ? `You've reached the premium cap of ${max} interfaces.`
            : `Free servers may run only ${max} Join-to-Create interface. Upgrade to premium to unlock up to ${MAX_INTERFACES_PREMIUM}.`
    };
}

/* ═══════════════════════════════════════════════════════════════════
   INTERFACE CRUD
   ═══════════════════════════════════════════════════════════════════ */

function listInterfaces(guildId) {
    const cfg = getGuildConfig(guildId);
    return Object.values(cfg.interfaces).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function getInterface(guildId, interfaceId) {
    const cfg = getGuildConfig(guildId);
    return cfg.interfaces[interfaceId] || null;
}

function createInterface(guildId, requesterUserId, partial = {}) {
    const gate = canAddInterface(guildId, requesterUserId);
    if (!gate.ok) return { ok: false, error: gate.reason, tier: gate.tier };

    const cfg = getGuildConfig(guildId);
    const iface = defaultInterface(partial);
    cfg.interfaces[iface.id] = iface;
    saveGuildConfig(guildId, cfg);
    return { ok: true, iface };
}

const INTERFACE_KEYS = [
    'name', 'emoji', 'enabled',
    'triggerChannelIds', 'categoryId', 'interfaceChannelId', 'controlPanelMessageId',
    'namingTemplate', 'defaultUserLimit', 'defaultBitrate', 'defaultVisibility', 'autoDelete',
    'maxConcurrentChannels',
    'allowedRoles', 'deniedRoles'
];

function updateInterface(guildId, interfaceId, patch) {
    const cfg = getGuildConfig(guildId);
    const iface = cfg.interfaces[interfaceId];
    if (!iface) return { ok: false, error: 'Interface not found.' };

    for (const key of INTERFACE_KEYS) {
        if (patch?.[key] === undefined) continue;
        if (key === 'defaultUserLimit')      iface[key] = clampInt(patch[key], 0, 99, iface[key]);
        else if (key === 'defaultBitrate')   iface[key] = clampInt(patch[key], 8, 384, iface[key]);
        else if (key === 'maxConcurrentChannels') iface[key] = clampInt(patch[key], 0, 99, iface[key]);
        else if (key === 'defaultVisibility') iface[key] = patch[key] === 'private' ? 'private' : 'public';
        else if (key === 'namingTemplate')   iface[key] = String(patch[key] || iface[key]).slice(0, 100);
        else if (key === 'name')             iface[key] = String(patch[key] || iface[key]).slice(0, 50) || iface[key];
        else if (key === 'allowedRoles' || key === 'deniedRoles')
            iface[key] = Array.isArray(patch[key]) ? patch[key].slice(0, 25) : iface[key];
        else if (key === 'triggerChannelIds')
            iface[key] = Array.isArray(patch[key]) ? [...new Set(patch[key].filter(Boolean))].slice(0, 25) : iface[key];
        else iface[key] = patch[key];
    }
    iface.updatedAt = Date.now();
    saveGuildConfig(guildId, cfg);
    return { ok: true, iface };
}

function deleteInterface(guildId, interfaceId) {
    const cfg = getGuildConfig(guildId);
    if (!cfg.interfaces[interfaceId]) return { ok: false, error: 'Interface not found.' };
    delete cfg.interfaces[interfaceId];
    // Drop active channels that referenced it.
    for (const [uid, entry] of Object.entries(cfg.activeChannels)) {
        if (entry.interfaceId === interfaceId) delete cfg.activeChannels[uid];
    }
    saveGuildConfig(guildId, cfg);
    return { ok: true };
}

function findInterfaceByTrigger(guildId, triggerChannelId) {
    const cfg = getGuildConfig(guildId);
    return Object.values(cfg.interfaces).find(i =>
        i.enabled !== false && Array.isArray(i.triggerChannelIds) && i.triggerChannelIds.includes(triggerChannelId)
    ) || null;
}

/* ═══════════════════════════════════════════════════════════════════
   ACTIVE CHANNEL TRACKING
   ═══════════════════════════════════════════════════════════════════ */

function recordActiveChannel(guildId, ownerUserId, channelId, interfaceId) {
    const cfg = getGuildConfig(guildId);
    cfg.activeChannels[ownerUserId] = {
        channelId,
        interfaceId,
        createdAt:    Date.now(),
        trustedUsers: [],
        bannedUsers:  []
    };
    cfg.analytics.totalCreated  = (cfg.analytics.totalCreated || 0) + 1;
    cfg.analytics.lastCreatedAt = Date.now();
    saveGuildConfig(guildId, cfg);
}

function dropActiveChannel(guildId, ownerUserId) {
    const cfg = getGuildConfig(guildId);
    if (cfg.activeChannels[ownerUserId]) {
        delete cfg.activeChannels[ownerUserId];
        saveGuildConfig(guildId, cfg);
    }
}

function getActiveChannel(guildId, ownerUserId) {
    const cfg = getGuildConfig(guildId);
    return cfg.activeChannels[ownerUserId] || null;
}

function findOwnerByChannel(guildId, channelId) {
    const cfg = getGuildConfig(guildId);
    for (const [uid, entry] of Object.entries(cfg.activeChannels)) {
        if (entry.channelId === channelId) return uid;
    }
    return null;
}

function countActiveChannelsForInterface(guildId, interfaceId) {
    const cfg = getGuildConfig(guildId);
    let n = 0;
    for (const entry of Object.values(cfg.activeChannels || {})) {
        if (entry?.interfaceId === interfaceId) n++;
    }
    return n;
}

function transferOwnership(guildId, fromUserId, toUserId) {
    const cfg = getGuildConfig(guildId);
    const entry = cfg.activeChannels[fromUserId];
    if (!entry) return { ok: false, error: 'No active channel for this user.' };
    delete cfg.activeChannels[fromUserId];
    cfg.activeChannels[toUserId] = { ...entry, createdAt: entry.createdAt || Date.now() };
    saveGuildConfig(guildId, cfg);
    return { ok: true };
}

function addTrustedUser(guildId, ownerUserId, targetUserId) {
    const cfg = getGuildConfig(guildId);
    const entry = cfg.activeChannels[ownerUserId];
    if (!entry) return { ok: false, error: 'No active channel.' };
    if (entry.trustedUsers.includes(targetUserId)) return { ok: false, error: 'User is already trusted.' };
    entry.trustedUsers.push(targetUserId);
    saveGuildConfig(guildId, cfg);
    return { ok: true };
}

function removeTrustedUser(guildId, ownerUserId, targetUserId) {
    const cfg = getGuildConfig(guildId);
    const entry = cfg.activeChannels[ownerUserId];
    if (!entry) return { ok: false, error: 'No active channel.' };
    entry.trustedUsers = (entry.trustedUsers || []).filter(id => id !== targetUserId);
    saveGuildConfig(guildId, cfg);
    return { ok: true };
}

function addBannedUser(guildId, ownerUserId, targetUserId) {
    const cfg = getGuildConfig(guildId);
    const entry = cfg.activeChannels[ownerUserId];
    if (!entry) return { ok: false, error: 'No active channel.' };
    entry.bannedUsers = entry.bannedUsers || [];
    if (!entry.bannedUsers.includes(targetUserId)) entry.bannedUsers.push(targetUserId);
    // Block also strips co-owner status if present.
    entry.trustedUsers = (entry.trustedUsers || []).filter(id => id !== targetUserId);
    saveGuildConfig(guildId, cfg);
    return { ok: true };
}

function removeBannedUser(guildId, ownerUserId, targetUserId) {
    const cfg = getGuildConfig(guildId);
    const entry = cfg.activeChannels[ownerUserId];
    if (!entry) return { ok: false, error: 'No active channel.' };
    entry.bannedUsers = (entry.bannedUsers || []).filter(id => id !== targetUserId);
    saveGuildConfig(guildId, cfg);
    return { ok: true };
}

/* ═══════════════════════════════════════════════════════════════════
   CONCURRENCY
   ═══════════════════════════════════════════════════════════════════ */

const guildLocks = new Map();

async function withGuildLock(guildId, fn) {
    const previous = guildLocks.get(guildId) || Promise.resolve();
    const next = previous.then(() => fn()).catch(err => {
        log.error(`[J2C] Guild lock error for ${guildId}: ${err.message}`);
        throw err;
    });
    const tail = next.then(() => {}, () => {});
    guildLocks.set(guildId, tail);
    try {
        return await next;
    } finally {
        if (guildLocks.get(guildId) === tail) guildLocks.delete(guildId);
    }
}

const userCooldowns = new Map();
const USER_COOLDOWN_MS = 3000;

function isOnCooldown(guildId, userId) {
    const last = userCooldowns.get(`${guildId}:${userId}`) || 0;
    return Date.now() - last < USER_COOLDOWN_MS;
}

function markCooldown(guildId, userId) {
    userCooldowns.set(`${guildId}:${userId}`, Date.now());
    if (userCooldowns.size > 1000) {
        const cutoff = Date.now() - USER_COOLDOWN_MS * 4;
        for (const [k, ts] of userCooldowns.entries()) {
            if (ts < cutoff) userCooldowns.delete(k);
        }
    }
}

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */

function clampInt(value, min, max, fallback) {
    const n = Number.parseInt(value, 10);
    if (Number.isNaN(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function applyNamingTemplate(template, ctx) {
    return String(template || "{user}'s Channel")
        .replace(/{user\.id}/g, ctx.user?.id || '')
        .replace(/{user\.tag}/g, ctx.user?.tag || ctx.user?.username || '')
        .replace(/{user}/g, ctx.user?.username || ctx.user?.globalName || 'User')
        .replace(/{kind}/g, ctx.iface?.name || 'Voice')
        .replace(/{server}/g, ctx.guild?.name || '')
        .replace(/{n}/g, String(ctx.activeCount || 0))
        .slice(0, 100);
}

/* ═══════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
    // Constants
    STORE,
    SCHEMA_VERSION,
    MAX_INTERFACES_FREE,
    MAX_INTERFACES_PREMIUM,
    DEFAULT_BITRATE_KBPS,

    // Config
    defaultGuildConfig,
    getGuildConfig,
    saveGuildConfig,
    deleteGuildConfig,
    migrateGuildConfig,

    // Premium
    getGuildTier,
    isPremium,
    maxInterfacesFor,
    canAddInterface,

    // Interfaces
    listInterfaces,
    getInterface,
    createInterface,
    updateInterface,
    deleteInterface,
    findInterfaceByTrigger,

    // Active channels
    recordActiveChannel,
    dropActiveChannel,
    getActiveChannel,
    findOwnerByChannel,
    countActiveChannelsForInterface,
    transferOwnership,
    addTrustedUser,
    removeTrustedUser,
    addBannedUser,
    removeBannedUser,

    // Concurrency
    withGuildLock,
    isOnCooldown,
    markCooldown,

    // Utils
    clampInt,
    applyNamingTemplate
};
