/**
 * StoreSync — a single shared subscription layer that maps jsonStore
 * 'update' events to the bot's in-memory cache invalidators.
 *
 * Why this exists:
 *   - The dashboard writes to the shared jsonStore via writeImmediate.
 *   - utils/jsonStore now emits 'update' on every write/writeImmediate
 *     and on every PostgreSQL refresh.
 *   - When bot + dashboard run in the SAME process they share the
 *     singleton jsonStore, so this listener fires synchronously after
 *     the dashboard write and the bot's cache stays fresh.
 *   - When they run in DIFFERENT processes, jsonStore.smartRefresh()
 *     polls PostgreSQL every 3s and emits 'update' on the bot side
 *     for any store whose row changed; this listener handles those
 *     too.
 *
 * Stale-row eviction:
 *   Each per-guild handler MUST `.clear()` its target Map first so guilds
 *   that disappear from the snapshot (e.g. an entire guild row removed
 *   from the store) are evicted from the cache. The legacy index.js
 *   listener used to do this and was removed; this listener is now the
 *   single source of truth for cache rebuilds.
 *
 * Re-entrancy contract:
 *   Handlers MUST NOT call jsonStore.write/writeImmediate. Doing so
 *   would re-enter _emitUpdate synchronously from inside the original
 *   emit('update', …) and recurse until the call stack exhausts. The
 *   handlers below only mutate Maps and lazy-load utils/botCustomize.
 *
 * IMPORTANT: this module must NOT require discord.js (or any package
 * that requires it transitively). It only touches our own utils so it
 * can be loaded in lightweight smoke harnesses without node_modules.
 */

'use strict';

// Sentinel symbol used to mark a jsonStore instance as already wired.
// Replaces a module-local boolean so the listener cannot be registered
// twice even if installStoreSync is reached from a second require path
// or after the module cache is cleared.
const INSTALLED_KEY = Symbol.for('xnico.storeSync.installed');

/**
 * Rebuild a per-guild cache Map from a snapshot. Clears first so guild
 * keys that disappear from the snapshot are evicted, then calls
 * `applyOne(guildId, cfg)` for every entry. `cacheGetter` is a function
 * because the cache Map may not exist yet at module-load time (index.js
 * exposes the cache on `global` only after its top-level `const … = new Map()`
 * declarations run).
 */
function rebuildPerGuildCache(cacheGetter, applyOne, data) {
    const cache = typeof cacheGetter === 'function' ? cacheGetter() : cacheGetter;
    if (cache && typeof cache.clear === 'function') {
        try { cache.clear(); } catch {}
    }
    if (!data || typeof data !== 'object') return;
    if (typeof applyOne !== 'function') return;
    for (const [guildId, cfg] of Object.entries(data)) {
        try { applyOne(guildId, cfg); } catch {}
    }
}

// Map of storeName -> handler(data, jsonStore). Each handler is wrapped
// in try/catch so a single broken store doesn't break the listener.
//
// Per-guild handlers clear the upstream cache Map first (via the
// `global.<module>Cache` reference exposed by index.js) and then call
// the bot-side `global.update*Cache(guildId, cfg)` to repopulate. This
// guarantees stale-row eviction when a guild is removed from the
// snapshot entirely.
const HANDLERS = {
    automod(data) {
        if (typeof global.updateAutomodCache !== 'function') return;
        rebuildPerGuildCache(
            () => global.automodCache,
            (gid, cfg) => global.updateAutomodCache(gid, cfg),
            data
        );
    },

    antinuke(data) {
        // reloadAntinukeCache is whole-snapshot semantics (clears + repopulates),
        // so it is preferred. Fall back to the per-guild form for older
        // bots that only export updateAntinukeCache.
        if (typeof global.reloadAntinukeCache === 'function') {
            try { global.reloadAntinukeCache(data || {}); return; } catch {}
        }
        if (typeof global.updateAntinukeCache !== 'function') return;
        rebuildPerGuildCache(
            () => global.antinukeCache,
            (gid, cfg) => global.updateAntinukeCache(gid, cfg),
            data
        );
    },

    autoreact(data) {
        if (typeof global.updateAutoreactCache !== 'function') return;
        rebuildPerGuildCache(
            () => global.autoreactCache,
            (gid, cfg) => global.updateAutoreactCache(gid, cfg),
            data
        );
    },

    autoresponder(data) {
        if (typeof global.updateAutoresponderCache !== 'function') return;
        rebuildPerGuildCache(
            () => global.autoresponderCache,
            (gid, cfg) => global.updateAutoresponderCache(gid, cfg),
            data
        );
    },

    antiraid(data) {
        if (typeof global.updateAntiraidCache !== 'function') return;
        rebuildPerGuildCache(
            () => global.antiraidCache,
            (gid, cfg) => global.updateAntiraidCache(gid, cfg),
            data
        );
    },

    antialt(data) {
        if (typeof global.updateAntialtCache !== 'function') return;
        rebuildPerGuildCache(
            () => global.antialtCache,
            (gid, cfg) => global.updateAntialtCache(gid, cfg),
            data
        );
    },

    'bot-customize'() {
        // botCustomize.invalidateCache() resets the 5s TTL cache so the
        // very next read pulls the fresh row out of jsonStore.
        try {
            const botCustomize = require('./botCustomize');
            if (botCustomize && typeof botCustomize.invalidateCache === 'function') {
                botCustomize.invalidateCache();
            }
        } catch {}
    },

    serverstats() {
        // utils/serverStatsManager keeps a 5s TTL cache of the 'serverstats'
        // store. Without this, a dashboard change could remain invisible
        // to the live stats-channel updater for up to 5s. invalidateCache
        // simply resets the timestamps so the next loadConfig() re-reads
        // jsonStore (which already has the fresh row).
        try {
            const ssm = require('./serverStatsManager');
            if (ssm && typeof ssm.invalidateCache === 'function') {
                ssm.invalidateCache();
            }
        } catch {}
    },

    logs() {
        // utils/logger keeps a 10s TTL cache of the 'logs' store
        // (per-guild log channel mappings + webhook URLs). When the
        // dashboard writes to 'logs' from a different process, the
        // smartRefresh poll emits 'update' here; without this handler
        // the bot's logger keeps the stale config for up to 10s.
        // invalidateCache resets _logsCache to null so the next
        // loadLogs() call pulls the fresh row from jsonStore.
        try {
            const logger = require('./logger');
            if (logger && typeof logger.invalidateCache === 'function') {
                logger.invalidateCache();
            }
        } catch {}
    },

    // Stores that are read-through (no in-memory cache). No-op handlers
    // are listed explicitly so the mapping table doubles as documentation.
    prefixes() { /* read-through via index.js getGuildPrefix */ },
    'custom-badges'() { /* read-through via utils/badgeManager */ },
    'user-badges'() { /* read-through via utils/badgeManager */ },

    // join2create is read on demand by utils/join2createHandler.js, so
    // there is no in-memory cache to invalidate. Listed explicitly so
    // notifyModuleUpdate('voice', …) — which maps voice -> join2create —
    // resolves to a documented no-op rather than falling off the table.
    join2create() { /* read-through via utils/join2createHandler */ },

    'media-only'() { /* read-through via utils/interactionHandlers */ },

    welcomer() {
        // Welcomer is read-through: every guildMemberAdd/Remove handler
        // calls jsonStore.peek('welcomer') directly, so there's no
        // in-memory cache that needs invalidating. No-op kept here so
        // notifyModuleUpdate('welcomer', …) routes to a documented
        // entry rather than falling off the table.
    },

    'economy-settings'() {
        // economy reads through jsonStore on each command — no dedicated
        // in-memory cache to clear. Future-proof: try to invalidate any
        // module-level cache the manager exposes.
        try {
            const eco = require('./economyManager');
            if (eco && typeof eco.invalidateCache === 'function') {
                eco.invalidateCache();
            }
        } catch {}
    },

    'social-notify'() {
        try {
            const sn = require('./socialNotifyManager');
            if (sn && typeof sn.invalidateCache === 'function') {
                sn.invalidateCache();
            }
        } catch {}
    },

    'vote-config'() {
        try {
            const vm = require('./voteManager');
            if (vm && typeof vm.invalidateCache === 'function') {
                vm.invalidateCache();
            }
        } catch {}
    },

    confessions() {
        // /confess and confession-setup read jsonStore on demand
    },

    'screenshot-verify'() {
        // utils/screenshotVerifyManager reads jsonStore on demand —
        // no in-memory cache to invalidate. Listed explicitly so a
        // dashboard write doesn't fall off the HANDLERS table.
    },

    'screenshot-verify-submissions'() {
        // submission queue is read on demand by the manager + watcher
    },

    'custom-shop'() {
        // commands/economy/customshop reads jsonStore directly each call
    },

    'vanity-protect'() {
        // antinuke vanity protection reads through jsonStore on demand
    },

    // ── Newly surfaced bot features ──────────────────────────────────────
    // None of these have an in-memory cache to clear: each reads through
    // jsonStore on demand. We register no-op handlers so the dashboard's
    // notifyModuleUpdate() resolves to a documented entry rather than
    // falling off the table — if any of these gain a TTL cache later,
    // wire it up here in one place.
    aichat() { /* utils/aiChatManager reads jsonStore on demand */ },
    birthdays() { /* utils/birthdayManager reads jsonStore on demand */ },
    applications() { /* commands/admin/application reads jsonStore on demand */ },
    'application-responses'() { /* read on demand */ },
    statusrole() { /* Applied live by the presenceUpdate listener in index.js
                       (utils/statusRoleHandler.js). Read-through via
                       jsonStore.peek('statusrole') on each presence event, so
                       there is no in-memory cache to invalidate here. */ },
    botblock() { /* read on demand by the messageCreate listener */ },
    vanityguard() { /* read on demand by guildUpdate listener */ },
    nightmode() { /* read on demand */ },
    emergency() { /* read on demand */ },
    servertag() { /* read on demand */ },
    'servertag-users'() { /* read on demand */ },
    guildtags() { /* read on demand */ },
    lockdown() { /* read on demand */ },
    'ignored-channels'() { /* read on demand by leveling/automod/logger */ },
    'botignore-config'() { /* read-through via index.js peekGuild('botignore-config') */ },
    warnings() { /* read on demand by warn / warnings / clearwarnings */ },
    'warn-config'() { /* read on demand by warn.js threshold check */ },
    modlogs() { /* read on demand by cases / reason / modhistory */ },
    'premium-keys'() { /* read on demand by redeemkey.js */ },
    minecraft() { /* utils/minecraftMonitor reads jsonStore on demand via its poller */ },
    'disabled-commands'() { /* read on demand by utils/disabledCommands on each command dispatch */ },
    trap() { /* utils/trapManager reads jsonStore.peekGuild on demand in messageCreate */ },
};

/**
 * Attach the cache-invalidation listener to a jsonStore instance.
 * Safe to call multiple times - the listener is only registered once
 * per jsonStore instance (sentinel stamped on the instance itself,
 * survives module-cache clears).
 *
 * @param {EventEmitter} jsonStore - the singleton from utils/jsonStore
 */
function installStoreSync(jsonStore) {
    if (!jsonStore || typeof jsonStore.on !== 'function') return;
    if (jsonStore[INSTALLED_KEY]) return;
    try {
        Object.defineProperty(jsonStore, INSTALLED_KEY, {
            value: true,
            configurable: true,
            enumerable: false,
            writable: false
        });
    } catch {
        // Some hosts may freeze the emitter; fall back to a plain assignment.
        try { jsonStore[INSTALLED_KEY] = true; } catch { return; }
    }

    jsonStore.on('update', (storeName, data) => {
        const handler = HANDLERS[storeName];
        if (typeof handler !== 'function') return;
        try {
            handler(data, jsonStore);
        } catch (e) {
            // Never let a listener failure crash the emitter
            try {
                // eslint-disable-next-line no-console
                console.error(`[storeSync] handler for "${storeName}" failed:`, e?.message || e);
            } catch {}
        }
    });
}

/**
 * Manually trigger the bot-side cache update for a store as if jsonStore
 * had emitted an 'update'. Useful when a route handler has an in-hand
 * snapshot that hasn't been written through writeImmediate yet (rare).
 *
 * Note: with the storeSync listener in place, route handlers should NOT
 * call this AFTER a writeImmediate — the listener already fires.
 *
 * @param {string} storeName
 * @param {*}      data
 */
function notifyStoreUpdate(storeName, data) {
    const handler = HANDLERS[storeName];
    if (typeof handler !== 'function') return;
    try { handler(data); } catch {}
}

module.exports = {
    installStoreSync,
    notifyStoreUpdate,
    HANDLERS,
    INSTALLED_KEY,
    // Exported for unit testing — not part of the public surface.
    _rebuildPerGuildCache: rebuildPerGuildCache,
};
