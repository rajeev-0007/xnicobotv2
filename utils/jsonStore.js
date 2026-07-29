/**
 * JsonStore — In-memory cache backed by PostgreSQL, optionally fronted by Redis.
 *
 * All JSON data files are loaded into memory at startup from the
 * `json_store` PostgreSQL table. Reads are synchronous (from cache).
 * Writes update the cache immediately and are debounced before
 * persisting to PostgreSQL — reducing network transfer dramatically.
 *
 * ═══ LOCAL FALLBACK MODE ═══
 * If PostgreSQL is unreachable at startup, the store falls back to
 * reading/writing JSON files in the `json_stores/` directory.
 * The public API stays identical — callers don't need to change.
 *
 * Write strategy:
 *   - Cache updated immediately (synchronous)
 *   - DB write is debounced: waits DEBOUNCE_MS after last write to that store
 *   - Safety flush every PERIODIC_FLUSH_MS writes all dirty stores
 *   - On process exit, all dirty stores are flushed before shutdown
 *
 * ═══ REDIS TIER (optional — set REDIS_URL to enable) ═══
 * Redis is a CACHE and a MESSAGE BUS. PostgreSQL stays the source of truth,
 * so a full Redis wipe costs a slower next boot and nothing else.
 *
 *   Boot     hydrate from Redis (1 HGETALL + 1 MGET), then reconcile against
 *            a timestamp-only PG query and re-pull ONLY the drifted stores.
 *            Replaces "SELECT every store's full JSONB".
 *   Write    cache → Redis → PUBLISH invalidate → Postgres (unchanged rules:
 *            immediate for CRITICAL_STORES, debounced otherwise).
 *   Sync     Redis Pub/Sub delivers invalidations instantly instead of each
 *            process polling PG every PG_POLL_MS. The poll drops to
 *            PG_POLL_SLOW_MS purely as a safety net, because Pub/Sub has no
 *            delivery guarantee across a reconnect.
 *
 * Redis write cadence is deliberately split (see _scheduleRedisWrite):
 * CRITICAL_STORES go to Redis immediately so config changes propagate with
 * no perceptible delay, while hot high-churn stores (economy, users, XP —
 * some of them MBs, written on nearly every command) are coalesced over
 * REDIS_WRITE_DEBOUNCE_MS. Writing those to Redis on every command would
 * trade a Postgres bandwidth problem for a Redis bandwidth problem.
 *
 * The Redis DATA CACHE is only used in Postgres mode. In local-file fallback
 * mode the files are authoritative and hydrating from Redis could surface a
 * stale snapshot, so only the Pub/Sub bus is used there.
 */

const path = require('path');
const fs = require('fs');
const log = require('./logger-styled');
const redis = require('./redisClient');

const DEBOUNCE_MS      = 30_000;   // write to DB 30s after last change
const PERIODIC_FLUSH_MS = 5 * 60_000; // force-flush dirty stores every 5 min
// PG poll cadence — was 3000ms, but the SELECT round-trip + the
// 'update' fan-out it can cause was the dominant source of high
// `client.ws.ping` (the gateway heartbeat shares the event loop).
// 5s gives near-real-time dashboard sync without overloading PG.
// (Original 3s was tuned for shared-pg-host setups; 15s caused user-visible
// lag when the dashboard wrote a config from a different process.)
const PG_POLL_MS       = 5_000;
// Cadence used INSTEAD of PG_POLL_MS once the Redis invalidation bus is
// live. Pub/Sub already delivers changes in ~1ms, so this exists only to
// repair drift from messages dropped while a subscriber was reconnecting.
const PG_POLL_SLOW_MS  = 60_000;
// Coalescing window for Redis writes of hot (non-critical) stores.
const REDIS_WRITE_DEBOUNCE_MS = Number(process.env.REDIS_WRITE_DEBOUNCE_MS || 1_000);
const LOCAL_POLL_MS     = 1_500;   // poll local file mtimes every 1.5s for cross-process sync
const LOCAL_STORE_DIR  = path.join(__dirname, '..', 'json_stores');

// ── Critical config stores ───────────────────────────────────────────────
// These hold low-frequency, high-value configuration/state where losing a
// write on a quick restart is unacceptable (premium, prefixes, moderation
// config, tickets, music panel state, …). For these, write() persists
// IMMEDIATELY instead of waiting out the 30s debounce, so a restart inside
// the debounce window can never silently revert them.
//
// HOT, high-churn stores (economy, inventory, leveling XP totals, users,
// command-stats, caches) are deliberately NOT in this set — they are written
// on nearly every command and must stay debounced to avoid hammering PG and
// spiking the gateway heartbeat. Suffix matching covers dashboard mirror
// stores (e.g. `dash_premium`).
const CRITICAL_STORES = new Set([
    // Premium + access
    'premium', 'premium-keys', 'server-premium', 'dash_premium',
    'owners', 'blacklist', 'globalconfig', 'noprefix', 'globalnoprefix', 'vote-noprefix', 'apikeys',
    // User data (profile customizations, etc.)
    'users',
    // Guild & server data
    'guilds',
    // Prefix + branding
    'prefixes', 'bot-customize',
    // Bot panel settings (status, activities)
    'bot-activities',
    // Economy config
    'custom-shop', 'economy-settings',
    // Moderation / protection config
    'automod', 'antinuke', 'antiraid', 'antispam', 'antialt', 'vanityguard',
    'emergency', 'nightmode', 'botblock', 'statusrole', 'ignored-channels',
    'lockdown', 'trust', 'warnings', 'modlogs', 'warn-config',
    // Trap (honeypot) system
    'trap',
    // Tickets
    'tickets', 'ticket-history',
    // Automation config
    'autoresponder', 'autoreact', 'autorole', 'autonick', 'voiceautorole',
    'reactionroles', 'starboard', 'suggestions', 'feedback', 'giveaways', 'giveaway-settings',
    'media-only', 'sticky', 'simple-sticky', 'booster-notify', 'social-notify', 'social-notify-cache',
    'button-commands', 'select-menus', 'customcmds', 'welcomer', 'welcomer-templates',
    // Games / submissions config that must survive restarts
    'counting', 'screenshot-verify', 'screenshot-verify-submissions',
    // Verification / invites / join2create / serverstats
    'verification', 'invites', 'join2create', 'serverstats',
    // Leveling CONFIG (not the XP totals 'leveling'/'users')
    'levelchannel', 'levelingtoggle', 'levelmultiplier', 'levelroles',
    // Logging / applications / aichat / panels
    'logs', 'logging', 'applications', 'application-responses', 'aichat',
    'panel-registry', 'musicpanel', 'musicpanel-247', 'guildtags', 'servertag',
    'servertag-users', 'vote-config',
    // Misc high-value config
    'birthdays', 'confessions', 'reminders', 'spotify-links', 'marriages',
    'reputation', 'user-templates', 'voicebans',
    // Owner: temporarily disabled commands
    'disabled-commands',
]);

// `structuredClone` (Node ≥ 17) is 3–5× faster than the legacy
// `JSON.parse(JSON.stringify(...))` clone trick and avoids a second
// heap allocation pass. Falls back to the JSON dance on older
// Node versions or for objects that contain values structuredClone
// can't handle (Map/Set/typed arrays were never used in our stores).
const _structuredClone = typeof structuredClone === 'function'
    ? structuredClone
    : (v) => JSON.parse(JSON.stringify(v));

function deepClone(value) {
    if (value === null || value === undefined) return value;
    try { return _structuredClone(value); }
    catch { return JSON.parse(JSON.stringify(value)); }
}

const EventEmitter = require('events');

class JsonStore extends EventEmitter {
    constructor() {
        super();
        this.cache        = new Map();
        this.dirty        = new Set();       // stores with unsaved changes
        this.timers       = new Map();       // debounce timers per store
        this._timestamps  = new Map();       // tracks last known DB updated_at
        this._fileMtimes  = new Map();       // tracks last known local file mtimes (local mode)
        this.initialized  = false;
        this._flushTimer  = null;
        this._localMode   = false;           // true when PostgreSQL is unavailable
        // ── Redis tier state ────────────────────────────────────────────
        this._redisBus    = false;           // true once Pub/Sub is subscribed
        this._redisTimers = new Map();       // coalescing timers for hot-store Redis writes
        this._redisHydrated = 0;             // stores served from Redis at boot (for logging)
        this._invalidating = new Set();      // per-store in-flight invalidation guard
        this._invalidatePending = new Set(); // stores that changed again mid-refresh
    }

    async init() {
        // Make init idempotent + concurrent-safe. Several call sites
        // can race here: utils/database.js triggers it from the main
        // bot process during connectDatabase, and dashboard/server.js
        // triggers it both at cold-start (require.main === module
        // branch) and from the per-request middleware. Without a
        // guard each call set up its own poll/flush intervals and
        // re-printed the "Loaded 105 stores" line.
        if (this.initialized) return;
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInit();
        try {
            await this._initPromise;
        } catch (err) {
            // Don't cache a rejected init — otherwise every later call returns
            // the same failed promise and the store can never recover (this is
            // exactly what stranded the dashboard when the local-dir mkdir
            // threw EROFS on Vercel before Postgres was ever tried). Clearing
            // it lets the next init()/retryPostgres() attempt start fresh.
            this._initPromise = null;
            throw err;
        } finally {
            // Keep the resolved promise around so a second concurrent
            // caller still gets a stable "already done" result.
            // (No-op when initialized === true on next call.)
        }
    }

    async _doInit() {
        // Ensure local store directory exists (needed ONLY for the local-file
        // fallback). This is best-effort: on read-only serverless filesystems
        // (e.g. Vercel's /var/task) mkdirSync throws EROFS. That MUST NOT abort
        // init — otherwise we never even reach the Postgres branch below, the
        // rejection gets cached in _initPromise, the in-memory cache stays
        // empty forever, and every dashboard read returns {} while the DB is
        // actually full. Postgres is the preferred path here, so swallow it.
        try {
            if (!fs.existsSync(LOCAL_STORE_DIR)) {
                fs.mkdirSync(LOCAL_STORE_DIR, { recursive: true });
            }
        } catch (dirErr) {
            log.warning(`[JsonStore] Could not create local store dir (${dirErr.code || dirErr.message}); continuing — Postgres is preferred.`);
        }

        // Bring up Redis before touching Postgres so the boot path below can
        // take the hydrate-from-cache route. Never throws and never blocks
        // startup: a missing/unreachable Redis just returns false.
        try {
            await redis.init();
        } catch (redisErr) {
            log.warning(`[Redis] init skipped: ${String(redisErr?.message || redisErr).slice(0, 80)}`);
        }

        try {
            const { getPool } = require('./pgPool');
            const pool = getPool();

            // Ensure the schema exists BEFORE the first SELECT. This is the
            // difference between "just add DATABASE_URL and it works" and the
            // store silently falling back to local-file mode on a fresh DB.
            //
            // The bot's connectDatabase() already calls initializeSchema()
            // before init(), but the dashboard (dashboard/server.js) calls
            // jsonStore.init() directly with no schema step. On a brand-new
            // database the `json_store` table wouldn't exist yet, the SELECT
            // below would throw, and we'd drop into local mode — so dashboard
            // edits would never reach the bot even though DATABASE_URL was set.
            //
            // CREATE TABLE IF NOT EXISTS is idempotent, so running it here is
            // safe even when the bot already created the table. Lazily required
            // to avoid any load-order coupling.
            try {
                const { initializeSchema } = require('./pgSchema');
                await initializeSchema();
            } catch (schemaErr) {
                // If schema creation fails (e.g. read-only role), fall through
                // to the SELECT — it will either work against an existing table
                // or throw and trigger the local fallback, exactly as before.
                log.warning(`[JsonStore] Schema ensure skipped: ${schemaErr.message?.slice(0, 80)}`);
            }

            // ── Fast path: hydrate from Redis, then reconcile with PG ────
            // Without Redis this is a single "SELECT every store's full
            // JSONB" — the largest transfer the process makes at boot. With
            // Redis we pull the bodies from memory and ask Postgres only for
            // timestamps, then re-fetch just the rows that actually drifted
            // (another writer moved ahead of the cache, or Redis missed/
            // evicted a key). Postgres stays authoritative either way.
            let loadedFromRedis = 0;
            const hydrated = await this._hydrateFromRedis();
            if (hydrated) loadedFromRedis = hydrated;

            if (loadedFromRedis > 0) {
                // Timestamp-only reconcile — a few KB instead of many MB.
                const { rows } = await pool.query('SELECT store_name, updated_at FROM json_store');
                const stale = [];
                for (const row of rows) {
                    const dbTs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
                    const cachedTs = this._timestamps.get(row.store_name);
                    // Re-pull when Redis had no body for this store, or when
                    // Postgres is ahead of the cached snapshot.
                    if (!this.cache.has(row.store_name) || !cachedTs || dbTs > cachedTs) {
                        stale.push(row.store_name);
                    }
                    if (dbTs) this._timestamps.set(row.store_name, dbTs);
                }

                if (stale.length > 0) {
                    const { rows: freshRows } = await pool.query(
                        'SELECT store_name, data, updated_at FROM json_store WHERE store_name = ANY($1)',
                        [stale]
                    );
                    for (const row of freshRows) {
                        this.cache.set(row.store_name, row.data);
                        const ts = row.updated_at ? new Date(row.updated_at).getTime() : Date.now();
                        this._timestamps.set(row.store_name, ts);
                        // Repair the Redis entry so the next boot is clean.
                        this._redisWriteNow(row.store_name, row.data, ts);
                    }
                }

                // Drop cached stores that no longer exist in Postgres at all,
                // so a store deleted by another process can't be resurrected
                // from a stale Redis entry.
                const pgNames = new Set(rows.map(r => r.store_name));
                let evicted = 0;
                for (const name of [...this.cache.keys()]) {
                    if (!pgNames.has(name)) {
                        this.cache.delete(name);
                        this._timestamps.delete(name);
                        redis.delStore(name).catch(() => {});
                        evicted++;
                    }
                }

                this._redisHydrated = loadedFromRedis;
                log.success(
                    `[JsonStore] Loaded ${this.cache.size} stores ` +
                    `(${loadedFromRedis - evicted} cached, ${stale.length} re-synced from PostgreSQL` +
                    `${evicted ? `, ${evicted} evicted` : ''})`
                );
            } else {
                // ── Standard path (no Redis, or a cold Redis) ────────────
                // Pull updated_at too so smartRefresh doesn't treat every
                // already-loaded row as a fresh change on its first poll.
                // Without seeding _timestamps here, the very next 3s poll
                // saw dbTs > undefined for every row and emitted 'update'
                // for the entire database — which fed back into the bot's
                // cache invalidators (e.g. automod -> syncToDiscord, antinuke
                // reload, etc.) on every restart and on every bot-side write
                // (since _persistToPg also doesn't seed _timestamps, see below).
                const { rows } = await pool.query('SELECT store_name, data, updated_at FROM json_store');
                for (const row of rows) {
                    this.cache.set(row.store_name, row.data);
                    if (row.updated_at) {
                        this._timestamps.set(row.store_name, new Date(row.updated_at).getTime());
                    }
                }
                log.success(`[JsonStore] Loaded ${rows.length} stores from PostgreSQL`);

                // Warm Redis so the NEXT boot takes the fast path above.
                if (redis.ready) {
                    this._warmRedis().catch(() => {});
                }
            }

            this.initialized = true;
            this._localMode = false;

            // Periodic safety flush
            this._flushTimer = setInterval(() => this._flushDirty(), PERIODIC_FLUSH_MS);
            if (this._flushTimer.unref) this._flushTimer.unref();

            // ── Cross-process change notification ────────────────────────
            // Prefer the Redis bus (instant). Fall back to the PG poll when
            // Redis is absent or its subscribe failed. When the bus IS live
            // we still poll, but slowly, to repair drift from Pub/Sub
            // messages dropped during a subscriber reconnect.
            await this._installRedisBus();
            const pollMs = this._redisBus ? PG_POLL_SLOW_MS : PG_POLL_MS;
            this._pollTimer = setInterval(() => this.smartRefresh(), pollMs);
            if (this._pollTimer.unref) this._pollTimer.unref();
            if (this._redisBus) {
                log.info(`[JsonStore] Redis bus active — PostgreSQL poll relaxed to ${pollMs / 1000}s (safety net only)`);
            }

            // Flush on shutdown
            const onExit = () => this._flushDirtySync();
            process.once('SIGTERM', onExit);
            process.once('SIGINT',  onExit);
            process.once('exit',    onExit);
        } catch (err) {
            // ═══ FALLBACK: Load from local JSON files ═══
            log.warning(`[JsonStore] PostgreSQL unavailable (${err.message?.slice(0, 80)})`);
            log.info('[JsonStore] Falling back to local file storage in json_stores/');
            this._localMode = true;
            this._loadLocalFiles();
            this.initialized = true;

            // Periodic flush to local files
            this._flushTimer = setInterval(() => this._flushDirtyLocal(), PERIODIC_FLUSH_MS);
            if (this._flushTimer.unref) this._flushTimer.unref();

            // ── Cross-process sync via mtime polling ─────────────────────
            // The dashboard runs as a forked child process and writes to the
            // same json_stores/ directory. Without this poll the bot process
            // never sees those writes — its in-memory cache stays frozen
            // forever. We poll every LOCAL_POLL_MS, compare mtimes, re-read
            // changed files, and emit('update') so storeSync can rebuild
            // the per-guild caches.
            //
            // The Redis bus is still installed here when available (it makes
            // notification instant even in this degraded mode), but the Redis
            // DATA CACHE is intentionally NOT used: the files on disk are
            // authoritative in local mode, so hydrating bodies from Redis
            // could resurrect a stale snapshot. The invalidate handler
            // therefore re-reads from disk rather than from Redis.
            await this._installRedisBus();
            this._pollTimer = setInterval(() => this._pollLocalFiles(), LOCAL_POLL_MS);
            if (this._pollTimer.unref) this._pollTimer.unref();

            // Flush on shutdown
            const onExit = () => this._flushDirtyLocalSync();
            process.once('SIGTERM', onExit);
            process.once('SIGINT',  onExit);
            process.once('exit',    onExit);

            log.success(`[JsonStore] Loaded ${this.cache.size} stores from local files`);
        }
    }

    // ── Redis tier ──────────────────────────────────────────────────────────

    /**
     * Populate `cache` + `_timestamps` from Redis in two round-trips.
     * Callers MUST still reconcile against Postgres timestamps afterwards —
     * this only provides the bodies, it never establishes authority.
     *
     * @returns {Promise<number>} count of stores hydrated (0 = cold/unavailable)
     */
    async _hydrateFromRedis() {
        if (!redis.ready) return 0;
        try {
            const result = await redis.hydrateAll();
            if (!result || result.stores.size === 0) return 0;
            for (const [name, data] of result.stores) {
                this.cache.set(name, data);
            }
            for (const [name, ts] of result.timestamps) {
                this._timestamps.set(name, ts);
            }
            return result.stores.size;
        } catch {
            return 0;
        }
    }

    /**
     * Push the whole in-memory cache into Redis. Runs once after a cold-Redis
     * boot so the next start takes the fast path. Sequential on purpose —
     * this is background work and firing ~105 parallel SETs (some multi-MB)
     * would spike both the event loop and the Redis connection.
     */
    async _warmRedis() {
        if (!redis.ready) return 0;
        let n = 0;
        for (const [name, data] of this.cache) {
            const ts = this._timestamps.get(name) || Date.now();
            // eslint-disable-next-line no-await-in-loop
            const ok = await redis.setStore(name, data, ts);
            if (ok) n++;
        }
        if (n > 0) log.info(`[Redis] Warmed ${n} stores into cache`);
        return n;
    }

    /**
     * Subscribe to the cross-process invalidation bus. Sets `_redisBus` on
     * success, which is what relaxes the Postgres poll cadence.
     */
    async _installRedisBus() {
        if (!redis.ready || this._redisBus) return this._redisBus;
        const ok = await redis.subscribeInvalidate((name) => {
            this._onRedisInvalidate(name);
        });
        this._redisBus = !!ok;
        return this._redisBus;
    }

    /**
     * Handle an invalidation published by ANOTHER process (self-published
     * messages are filtered out inside redisClient by origin id).
     *
     * Contract notes:
     *   - Skips stores with unsaved local writes. Same rule as smartRefresh:
     *     clobbering a dirty store with a peer's snapshot is what used to make
     *     customizations "disappear again mid-session".
     *   - Re-emits through the normal 'update' path so utils/storeSync's
     *     handlers rebuild their per-guild Maps exactly as they do for a poll.
     */
    _onRedisInvalidate(name) {
        if (!name) return;
        if (this.dirty.has(name)) return;

        // Local-file mode: disk is authoritative, so let the mtime poller
        // pick the change up rather than trusting a Redis body.
        if (this._localMode) {
            this._pollLocalFiles();
            return;
        }

        // Serialize per store. A burst of invalidations for the same store
        // (e.g. an admin dragging a slider in the dashboard) would otherwise
        // start overlapping reads that resolve in completion order rather than
        // write order, letting an older snapshot land last.
        if (this._invalidating.has(name)) {
            this._invalidatePending.add(name); // re-run once after the current pass
            return;
        }
        this._invalidating.add(name);

        // Deliberately NO short-circuit on the published timestamp. The
        // publisher stamps with its own wall clock while `_timestamps` holds
        // Postgres `updated_at`; comparing them across skewed hosts can drop a
        // real change. A Redis GET is sub-millisecond, so always re-reading is
        // both cheaper and safer than reasoning about two clocks.
        (async () => {
            try {
                const cached = await redis.getStore(name);
                if (cached && cached.data !== undefined) {
                    if (this.dirty.has(name)) return; // became dirty while awaiting
                    this.cache.set(name, cached.data);
                    // Only adopt a stamp that came from the Postgres clock
                    // (touchStore). Leaving it unset otherwise means the slow
                    // safety poll will confirm against Postgres later, which is
                    // the safe direction to err in.
                    if (cached.ts > 0) this._timestamps.set(name, cached.ts);
                    this._emitUpdate(name, cached.data);
                    return;
                }
                // Cache miss (evicted, oversized, or never written) — go to
                // the source of truth. refresh() emits 'update' itself.
                await this.refresh(name);
            } catch (err) {
                log.warning(`[Redis] invalidate refresh failed for ${name}: ${String(err?.message || err).slice(0, 60)}`);
            } finally {
                this._invalidating.delete(name);
                if (this._invalidatePending.delete(name)) {
                    // Coalesced follow-up for everything that arrived while
                    // this pass was in flight.
                    this._onRedisInvalidate(name);
                }
            }
        })();
    }

    /**
     * Write to Redis and announce the change. Fire-and-forget by design —
     * Redis is a cache, so a failure here must never fail the caller's write.
     */
    _redisWriteNow(storeName, data, ts = Date.now()) {
        if (!redis.ready) return;
        this._clearRedisTimer(storeName);
        redis.setStore(storeName, data, ts)
            .then(() => redis.publishInvalidate(storeName, ts))
            .catch(() => {});
    }

    /**
     * Schedule a Redis write.
     *
     * CRITICAL_STORES go immediately: they're low-frequency config, and
     * instant propagation to the dashboard/bot peer is the whole point.
     *
     * Everything else is coalesced over REDIS_WRITE_DEBOUNCE_MS. The hot
     * stores (economy, users, leveling) are written on nearly every command
     * and can be several MB — pushing each of those to Redis synchronously
     * would just relocate the bandwidth problem this tier exists to solve.
     */
    _scheduleRedisWrite(storeName) {
        if (!redis.ready) return;
        if (this._isCritical(storeName)) {
            this._redisWriteNow(storeName, this.cache.get(storeName));
            return;
        }
        if (this._redisTimers.has(storeName)) return; // already queued
        const timer = setTimeout(() => {
            this._redisTimers.delete(storeName);
            const current = this.cache.get(storeName);
            if (current === undefined) return;
            redis.setStore(storeName, current, Date.now())
                .then(() => redis.publishInvalidate(storeName))
                .catch(() => {});
        }, REDIS_WRITE_DEBOUNCE_MS);
        if (timer.unref) timer.unref();
        this._redisTimers.set(storeName, timer);
    }

    _clearRedisTimer(storeName) {
        const t = this._redisTimers.get(storeName);
        if (t) {
            clearTimeout(t);
            this._redisTimers.delete(storeName);
        }
    }

    /** Diagnostics for owner commands (`bothealth`, `system`). */
    redisStats() {
        return {
            ...redis.stats(),
            busActive: this._redisBus,
            hydratedAtBoot: this._redisHydrated,
            pendingRedisWrites: this._redisTimers.size,
        };
    }

    /** Release Redis connections. Called from graceful shutdown after flush(). */
    async closeRedis() {
        for (const [, t] of this._redisTimers) clearTimeout(t);
        this._redisTimers.clear();
        try { await redis.close(); } catch {}
        this._redisBus = false;
    }

    // ── Postgres self-heal (split-host / serverless) ────────────────────────
    // If the very first init() hit a transient Postgres error (e.g. a Neon
    // serverless endpoint waking from sleep) the store latches into local-file
    // mode for the life of the process. On Vercel that means the dashboard
    // silently reads/writes ephemeral local files that the bot never sees.
    //
    // retryPostgres() lets a caller (the dashboard init middleware) re-attempt
    // the Postgres connection when DATABASE_URL is configured but we ended up
    // in local mode. It's a no-op once we're already on Postgres, and inert in
    // the bot process (which never calls it). Returns true when on Postgres.
    async retryPostgres() {
        if (!process.env.DATABASE_URL) return false;
        if (this.initialized && !this._localMode) return true; // already good
        if (this._retrying) return this._retryPromise;

        this._retrying = true;
        this._retryPromise = (async () => {
            try {
                if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
                if (this._flushTimer) { clearInterval(this._flushTimer); this._flushTimer = null; }
                // Reset init state so _doInit runs the Postgres path again.
                this.initialized = false;
                this._initPromise = null;
                this._localMode = false;
                await this.init();
            } catch { /* stays in whatever mode init resolved to */ }
            finally { this._retrying = false; }
            return this.initialized && !this._localMode;
        })();
        return this._retryPromise;
    }

    // ── Local file helpers ──────────────────────────────────────────────────

    _loadLocalFiles() {
        try {
            const files = fs.readdirSync(LOCAL_STORE_DIR).filter(f => f.endsWith('.json'));
            for (const file of files) {
                const storeName = path.basename(file, '.json');
                const filePath = path.join(LOCAL_STORE_DIR, file);
                try {
                    const raw = fs.readFileSync(filePath, 'utf8');
                    this.cache.set(storeName, JSON.parse(raw));
                    try {
                        const stat = fs.statSync(filePath);
                        this._fileMtimes.set(storeName, stat.mtimeMs);
                    } catch {}
                } catch (e) {
                    log.warning(`[JsonStore] Skipping corrupt file: ${file}`);
                }
            }
        } catch (e) {
            log.error('[JsonStore] Failed to read local store directory:', e.message);
        }
    }

    /**
     * Poll local-store file mtimes for changes made by other processes
     * (e.g. dashboard forked child). Emits 'update' for any store whose
     * file has been modified since the last poll. Skips stores we have
     * locally-dirty writes for so we never clobber unsynced data.
     */
    _pollLocalFiles() {
        if (!this._localMode) return;
        let files;
        try {
            files = fs.readdirSync(LOCAL_STORE_DIR).filter(f => f.endsWith('.json'));
        } catch {
            return;
        }

        const seen = new Set();
        const changedFiles = [];
        for (const file of files) {
            const storeName = path.basename(file, '.json');
            seen.add(storeName);
            if (this.dirty.has(storeName)) continue;

            const filePath = path.join(LOCAL_STORE_DIR, file);
            let stat;
            try { stat = fs.statSync(filePath); } catch { continue; }

            const lastMtime = this._fileMtimes.get(storeName) || 0;
            if (stat.mtimeMs <= lastMtime) continue;

            // File changed externally — re-read and emit
            let parsed;
            try {
                const raw = fs.readFileSync(filePath, 'utf8');
                parsed = JSON.parse(raw);
            } catch {
                continue;
            }
            this.cache.set(storeName, parsed);
            this._fileMtimes.set(storeName, stat.mtimeMs);
            changedFiles.push({ storeName, parsed });
        }

        for (const { storeName, parsed } of changedFiles) {
            try { this.emit('update', storeName, parsed); } catch {}
        }

        // Detect deleted files (store removed from disk by another process)
        for (const storeName of [...this._fileMtimes.keys()]) {
            if (!seen.has(storeName) && !this.dirty.has(storeName)) {
                this.cache.delete(storeName);
                this._fileMtimes.delete(storeName);
                try { this.emit('update', storeName, {}); } catch {}
            }
        }
    }

    /**
     * Async write to a local store file. Returns a promise so callers
     * (writeImmediate, dashboard request middleware) can await
     * persistence before responding.
     *
     * Switched from `fs.writeFileSync` because the economy store can
     * be several MB and a sync write blocks the event loop long enough
     * to spike `client.ws.ping` past 1s on every save (the gateway
     * heartbeat shares this loop). On a hot path (every command +
     * smartRefresh) the cumulative stalls were the dominant cause of
     * the "bot ping always high" report.
     */
    _persistToLocal(storeName, data) {
        const filePath = path.join(LOCAL_STORE_DIR, `${storeName}.json`);
        const payload = JSON.stringify(data, null, 2);
        return fs.promises.writeFile(filePath, payload, 'utf8').then(async () => {
            // Refresh tracked mtime so the polling loop doesn't treat this
            // self-write as an external change and re-emit 'update'.
            try {
                const stat = await fs.promises.stat(filePath);
                this._fileMtimes.set(storeName, stat.mtimeMs);
            } catch {}
            this.dirty.delete(storeName);
        }).catch(e => {
            log.error(`[JsonStore] Error writing local file ${storeName}:`, e.message);
        });
    }

    _flushDirtyLocal() {
        if (this.dirty.size === 0) return Promise.resolve();
        const promises = [];
        for (const name of [...this.dirty]) {
            const data = this.cache.get(name);
            if (data === undefined) continue;
            this._clearTimer(name);
            const p = this._persistToLocal(name, data);
            if (p && typeof p.then === 'function') promises.push(p);
        }
        return Promise.allSettled(promises);
    }

    _flushDirtyLocalSync() {
        if (this.dirty.size === 0) return;
        for (const name of this.dirty) {
            const data = this.cache.get(name);
            if (data === undefined) continue;
            this._clearTimer(name);
            try {
                const filePath = path.join(LOCAL_STORE_DIR, `${name}.json`);
                fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
                try {
                    const stat = fs.statSync(filePath);
                    this._fileMtimes.set(name, stat.mtimeMs);
                } catch {}
            } catch { }
        }
        this.dirty.clear();
    }

    // ── Core API ────────────────────────────────────────────────────────────

    _pathToName(filePath) {
        return path.basename(filePath, '.json');
    }

    read(storeName) {
        const data = this.cache.get(storeName);
        if (data === undefined || data === null) return {};
        return deepClone(data) || {};
    }

    /**
     * Read-only peek — returns the live cached object without cloning.
     *
     * Use this on hot paths (messageCreate, interactionCreate) where we
     * only check fields like `cfg[guildId].enabled` and never mutate.
     * The full `read()` deep-clones the entire store on every call,
     * which on a large store + high message rate became one of the
     * dominant sources of `client.ws.ping` drift.
     *
     * Contract: **DO NOT MUTATE** the returned object. If a caller ever
     * needs to write, they must `write(storeName, …)` with a fresh
     * object. (`read` is still the right call when ownership is
     * unclear.)
     */
    peek(storeName) {
        const data = this.cache.get(storeName);
        if (data === undefined || data === null) return null;
        return data;
    }

    /**
     * Read-only single-guild peek. Same contract as `peek` — returned
     * object must not be mutated.
     */
    peekGuild(storeName, guildId) {
        const data = this.cache.get(storeName);
        if (!data || typeof data !== 'object') return null;
        const entry = data[guildId];
        return entry === undefined ? null : entry;
    }

    readFile(filePath, defaultValue) {
        const name = this._pathToName(filePath);
        const data = this.cache.get(name);
        if (data === undefined || data === null) {
            return defaultValue !== undefined
                ? (typeof defaultValue === 'object' ? deepClone(defaultValue) : defaultValue)
                : {};
        }
        return deepClone(data) ?? (defaultValue !== undefined ? defaultValue : {});
    }

    /**
     * Write — updates cache immediately, schedules debounced persist.
     *
     * For CRITICAL_STORES (low-frequency, high-value config) the persist
     * is NOT debounced — it's flushed to the DB right away so a restart
     * inside the debounce window can't lose the write. Hot/high-churn
     * stores keep the debounce. `_isCritical()` does an exact + suffix
     * match so dashboard mirror stores (dash_premium, …) are covered too.
     */
    write(storeName, data) {
        this.cache.set(storeName, deepClone(data));
        this.dirty.add(storeName);
        if (this._isCritical(storeName)) {
            // Persist immediately; swallow errors so callers that don't
            // await write() keep their fire-and-forget contract.
            this._clearTimer(storeName);
            const persist = this._localMode
                ? this._persistToLocal(storeName, data)
                : this._persistToPg(storeName, data);
            if (persist && typeof persist.catch === 'function') persist.catch(() => {});
        } else {
            this._schedulePersist(storeName, data);
        }
        // Cache + notify peers. Independent of the Postgres cadence above:
        // config stores go out instantly, hot stores are coalesced.
        this._scheduleRedisWrite(storeName);
        this._emitUpdate(storeName, data);
    }

    /**
     * Whether a store should bypass the debounce and persist immediately.
     * Exact match against CRITICAL_STORES, plus a suffix match so mirror
     * stores like `dash_premium` / `dash_prefixes` are also covered.
     */
    _isCritical(storeName) {
        if (!storeName) return false;
        if (CRITICAL_STORES.has(storeName)) return true;
        // dashboard mirror prefix, e.g. dash_premium → premium
        if (storeName.startsWith('dash_')) {
            const base = storeName.slice(5);
            if (CRITICAL_STORES.has(base)) return true;
        }
        return false;
    }

    /**
     * Mark a store as dirty without cloning. Use ONLY when the caller
     * obtained the data via `peek()` and mutated it in-place. This
     * avoids the expensive deepClone that `write()` performs — critical
     * for the economy store which can be several MB and is written on
     * every single command.
     *
     * The debounced persist will serialize the live cache object to PG
     * (or local file) after DEBOUNCE_MS of inactivity.
     */
    markDirty(storeName) {
        this.dirty.add(storeName);
        this._schedulePersist(storeName, this.cache.get(storeName));
        // markDirty is the in-place-mutation path used by the hottest store
        // (economy). Coalesced Redis write only — never immediate.
        this._scheduleRedisWrite(storeName);
    }

    /**
     * Write Immediately - updates cache and persists immediately (no debounce).
     * Used by Dashboard to ensure immediate consistency.
     *
     * Returns a Promise that resolves when the underlying write
     * (PostgreSQL upsert in production, file write in fallback mode)
     * has completed. Awaiting this is *required* in serverless
     * environments like Vercel — the function host freezes the
     * sandbox the moment the response is sent, so a write started
     * but not awaited can be dropped silently.
     */
    writeImmediate(storeName, data) {
        this.cache.set(storeName, deepClone(data));
        this._clearTimer(storeName);
        let persistPromise;
        if (this._localMode) {
            persistPromise = this._persistToLocal(storeName, data) || Promise.resolve();
        } else {
            persistPromise = this._persistToPg(storeName, data);
        }
        // Immediate by definition — this is the dashboard's write path, where
        // the peer process should see the change with no perceptible delay.
        this._redisWriteNow(storeName, data);
        this._emitUpdate(storeName, data);
        return persistPromise || Promise.resolve();
    }

    /**
     * Read-modify-write helper for single-guild updates from the
     * dashboard. Solves a real race that bites cross-host setups:
     *
     *   1. Dashboard cold-start loads `automod` snapshot from PG.
     *   2. Bot updates the same `automod` row (e.g. user toggled via
     *      slash command) — PG row is now ahead of dashboard cache.
     *   3. Dashboard receives PUT for *another* guild, reads stale
     *      cache, merges, writes back — bot's change is now lost.
     *
     * `updateGuildEntry` re-fetches the freshest row from PG before
     * applying the mutation, then writes back. Cache and 'update'
     * event are still updated so the bot sees the result via the 3s
     * smartRefresh poll. Falls back to plain cached read in local
     * mode (single-host, no race).
     *
     * @param {string}   storeName  e.g. 'automod'
     * @param {string}   guildId    the guild whose entry is being changed
     * @param {Function} mutator    receives (guildEntry, allEntries) — return new entry, or modify in place
     * @returns {Promise<object>} the updated guild entry
     */
    async updateGuildEntry(storeName, guildId, mutator) {
        if (!storeName || !guildId || typeof mutator !== 'function') {
            throw new Error('updateGuildEntry requires (storeName, guildId, mutator)');
        }

        let all;
        if (this._localMode) {
            // Single host — file-based; the cache is authoritative.
            all = this.cache.get(storeName) || {};
            all = deepClone(all);
        } else {
            // Cross-host — re-fetch from PG so we don't clobber the
            // bot's writes that haven't been polled in yet.
            try {
                const { getPool } = require('./pgPool');
                const pool = getPool();
                const { rows } = await pool.query(
                    'SELECT data FROM json_store WHERE store_name = $1 LIMIT 1',
                    [storeName]
                );
                all = rows.length ? rows[0].data : {};
            } catch (err) {
                log.warning(`[JsonStore] updateGuildEntry: live PG read failed for ${storeName}, falling back to cache (${err.message?.slice(0, 60)})`);
                all = this.cache.get(storeName) || {};
                all = deepClone(all);
            }
        }
        if (!all || typeof all !== 'object') all = {};

        const before = all[guildId] || {};
        const after = mutator(before, all);
        // mutator may return a new object OR mutate `before` in place.
        all[guildId] = (after && typeof after === 'object') ? after : before;

        await this.writeImmediate(storeName, all);
        return all[guildId];
    }

    /**
     * Read-modify-write helper for a single user in the ARRAY-shaped
     * `users` store. This is the array analogue of updateGuildEntry and
     * solves the same cross-host race:
     *
     *   1. Dashboard cold-start loads the `users` array snapshot.
     *   2. Bot writes the `users` array constantly (XP, economy, stats),
     *      so the dashboard's cached copy goes stale within seconds.
     *   3. Dashboard receives a profile PUT, reads its STALE array,
     *      changes one user, writes the whole array back — silently
     *      reverting every bot-side change since step 1 (and its own
     *      profile edit can be reverted by the bot's next write).
     *
     * This was the root cause of "my rank/profile customization doesn't
     * persist". By re-fetching the freshest `users` row from PG, mutating
     * only the target record, and writing back, concurrent writers no
     * longer clobber each other. Falls back to the cached array in local
     * (single-host) mode where there is no race.
     *
     * @param {string}   userId   Discord user id (matched against user_id)
     * @param {Function} mutator  receives (userRecord, allUsers); mutate in
     *                            place or return a replacement record
     * @returns {Promise<object>} the updated user record
     */
    async updateUserEntry(userId, mutator) {
        if (!userId || typeof mutator !== 'function') {
            throw new Error('updateUserEntry requires (userId, mutator)');
        }
        const STORE = 'users';

        let all;
        if (this._localMode) {
            const cached = this.cache.get(STORE);
            all = Array.isArray(cached) ? deepClone(cached) : [];
        } else {
            try {
                const { getPool } = require('./pgPool');
                const pool = getPool();
                const { rows } = await pool.query(
                    'SELECT data FROM json_store WHERE store_name = $1 LIMIT 1',
                    [STORE]
                );
                all = rows.length && Array.isArray(rows[0].data) ? rows[0].data : [];
            } catch (err) {
                log.warning(`[JsonStore] updateUserEntry: live PG read failed, falling back to cache (${err.message?.slice(0, 60)})`);
                const cached = this.cache.get(STORE);
                all = Array.isArray(cached) ? deepClone(cached) : [];
            }
        }
        if (!Array.isArray(all)) all = [];

        let rec = all.find(u => u && (u.user_id === userId || u.userId === userId));
        if (!rec) {
            rec = {
                user_id: userId,
                economy: { balance: 0, bank: 0, inventory: [] },
                social: { reputation: 0 },
                profile: {},
                stats: { commandsUsed: 0, botInteractions: 0 },
                afk: { isAfk: false },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            all.push(rec);
        }

        const after = mutator(rec, all);
        if (after && typeof after === 'object' && after !== rec) {
            const idx = all.indexOf(rec);
            if (idx >= 0) all[idx] = after;
            rec = after;
        }

        await this.writeImmediate(STORE, all);
        return rec;
    }

    /**
     * Race-safe whole-store read-modify-write. Re-fetches the freshest
     * copy of `storeName` from Postgres (so concurrent writers — e.g. the
     * dashboard enqueuing new items while the bot updates statuses — are
     * not clobbered), hands it to `mutator(all)`, then persists the result.
     *
     * The mutator MUST be synchronous (it runs between the fresh read and
     * the write). Do any async work (Discord calls, etc.) BEFORE calling
     * this and merge the results inside the mutator. Returns the written
     * object. Used by the dashboard→bot action queue (utils/dashActionRunner).
     */
    async updateStore(storeName, mutator) {
        if (!storeName || typeof mutator !== 'function') {
            throw new Error('updateStore requires (storeName, mutator)');
        }
        let all;
        if (this._localMode) {
            const cached = this.cache.get(storeName);
            all = (cached && typeof cached === 'object') ? deepClone(cached) : {};
        } else {
            try {
                const { getPool } = require('./pgPool');
                const pool = getPool();
                const { rows } = await pool.query(
                    'SELECT data FROM json_store WHERE store_name = $1 LIMIT 1',
                    [storeName]
                );
                all = (rows.length && rows[0].data && typeof rows[0].data === 'object')
                    ? rows[0].data : {};
            } catch (err) {
                log.warning(`[JsonStore] updateStore: live PG read failed for ${storeName}, using cache (${err.message?.slice(0, 60)})`);
                const cached = this.cache.get(storeName);
                all = (cached && typeof cached === 'object') ? deepClone(cached) : {};
            }
        }
        const result = mutator(all);
        const next = (result && typeof result === 'object') ? result : all;
        await this.writeImmediate(storeName, next);
        return next;
    }

    /**
     * Emit an 'update' event with a deep-cloned snapshot so listeners
     * cannot mutate the cache. Failures in any listener are isolated.
     */
    _emitUpdate(storeName, data) {
        let snapshot;
        try {
            snapshot = deepClone(data);
        } catch {
            snapshot = data;
        }
        try {
            this.emit('update', storeName, snapshot);
        } catch (e) {
            try { log.error(`[JsonStore] Listener error for ${storeName}:`, e?.message || e); } catch {}
        }
    }

    writeFile(filePath, data) {
        this.write(this._pathToName(filePath), data);
    }

    has(storeName) {
        return this.cache.has(storeName);
    }

    hasFile(filePath) {
        return this.cache.has(this._pathToName(filePath));
    }

    delete(storeName) {
        this.cache.delete(storeName);
        this.dirty.delete(storeName);
        this._clearTimer(storeName);
        this._clearRedisTimer(storeName);

        // Evict from Redis and tell peers, otherwise a peer could re-hydrate
        // the deleted store from cache on its next boot.
        if (redis.ready) {
            redis.delStore(storeName)
                .then(() => redis.publishInvalidate(storeName))
                .catch(() => {});
        }

        if (this._localMode) {
            try {
                const filePath = path.join(LOCAL_STORE_DIR, `${storeName}.json`);
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            } catch { }
        } else {
            const { getPool } = require('./pgPool');
            const pool = getPool();
            pool.query('DELETE FROM json_store WHERE store_name = $1', [storeName])
                .catch(err => log.error(`[JsonStore] Error deleting ${storeName}:`, err));
        }
    }

    /**
     * Schedule a debounced persist for a store.
     * Resets the timer each time the store is written within the debounce window.
     */
    _schedulePersist(storeName, data) {
        this._clearTimer(storeName);
        const timer = setTimeout(() => {
            this.timers.delete(storeName);
            const current = this.cache.get(storeName) ?? data;
            if (this._localMode) {
                this._persistToLocal(storeName, current);
            } else {
                this._persistToPg(storeName, current);
            }
        }, DEBOUNCE_MS);
        if (timer.unref) timer.unref();
        this.timers.set(storeName, timer);
    }

    _clearTimer(storeName) {
        const existing = this.timers.get(storeName);
        if (existing) {
            clearTimeout(existing);
            this.timers.delete(storeName);
        }
    }

    // ── PostgreSQL persistence (only used when not in local mode) ────────

    /**
     * Flush all dirty stores to DB immediately (periodic safety net).
     */
    async _flushDirty() {
        if (this._localMode) return this._flushDirtyLocal();
        if (this.dirty.size === 0) return;
        const toFlush = [...this.dirty];
        // NOTE: do NOT pre-delete from `this.dirty` here. `_persistToPg`
        // clears the dirty flag ONLY on a successful write (in its .then).
        // If the write fails (e.g. the DB role lacks INSERT/UPDATE on
        // json_store), the store must stay dirty so smartRefresh's poll
        // won't clobber the in-memory value with stale DB data — which
        // is what made customizations "disappear again" mid-session.
        await Promise.allSettled(toFlush.map(name => {
            const data = this.cache.get(name);
            if (data === undefined) return Promise.resolve();
            this._clearTimer(name);
            return this._persistToPg(name, data);
        }));
    }

    /**
     * Synchronous-style flush called on exit — fires off promises but can't await.
     */
    _flushDirtySync() {
        if (this._localMode) return this._flushDirtyLocalSync();
        if (this.dirty.size === 0) return;
        const { getPool } = require('./pgPool');
        const pool = getPool();
        for (const name of this.dirty) {
            const data = this.cache.get(name);
            if (data === undefined) continue;
            this._clearTimer(name);
            pool.query(
                `INSERT INTO json_store (store_name, data, updated_at)
                 VALUES ($1, $2::jsonb, NOW())
                 ON CONFLICT (store_name) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
                [name, JSON.stringify(data)]
            ).catch(() => {});
        }
        this.dirty.clear();
    }

    _persistToPg(storeName, data) {
        const { getPool } = require('./pgPool');
        const pool = getPool();
        return pool.query(
            `INSERT INTO json_store (store_name, data, updated_at)
             VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (store_name) DO UPDATE SET data = $2::jsonb, updated_at = NOW()
             RETURNING updated_at`,
            [storeName, JSON.stringify(data)]
        ).then((res) => {
            this.dirty.delete(storeName);
            // Seed _timestamps so smartRefresh doesn't treat our own
            // write as an external change on the next 3s poll. Without
            // this, every bot-side write triggered a self-feeding loop:
            //   write -> updated_at = NOW() -> next poll sees newer ts
            //   -> emit('update') -> storeSync handler runs again
            //   -> for automod that meant Discord-API resync every 30s.
            const ts = res?.rows?.[0]?.updated_at;
            if (ts) {
                const ms = new Date(ts).getTime();
                this._timestamps.set(storeName, ms);
                // Pin the cached entry's stamp to Postgres' clock so the boot
                // reconcile and the invalidate handler compare like with like.
                if (redis.ready) redis.touchStore(storeName, ms).catch(() => {});
            }
        }).catch(err => log.error(`[JsonStore] Error persisting ${storeName}:`, err));
    }

    async smartRefresh() {
        if (!this.initialized || this._localMode) return;
        // Skip if a previous refresh is still in-flight — prevents
        // stacking queries when the remote PG (Neon) is slow.
        if (this._refreshing) return;
        this._refreshing = true;
        try {
            await this._doSmartRefresh();
        } finally {
            this._refreshing = false;
        }
    }

    async _doSmartRefresh() {
        const { getPool } = require('./pgPool');
        const pool = getPool();
        try {
            // Only fetch timestamps, extremely low compute usage
            const { rows } = await pool.query('SELECT store_name, updated_at FROM json_store');
            const changedStores = [];
            
            for (const row of rows) {
                const currentTs = this._timestamps.get(row.store_name);
                const dbTs = new Date(row.updated_at).getTime();
                
                // If timestamp changed (and we don't have local dirty changes)
                if ((!currentTs || dbTs > currentTs) && !this.dirty.has(row.store_name)) {
                    changedStores.push(row.store_name);
                    this._timestamps.set(row.store_name, dbTs);
                }
            }
            
            // Only fetch data for stores that actually changed
            if (changedStores.length > 0) {
                await this.refresh(...changedStores);
            }
        } catch (err) {
            // Ignore errors in background polling
        }
    }

    async refresh(...storeNames) {
        if (this._localMode) {
            // In local mode, re-read from files
            this._loadLocalFiles();
            return this.cache.size;
        }

        const { getPool } = require('./pgPool');
        const pool = getPool();
        if (storeNames.length === 0) {
            const { rows } = await pool.query('SELECT store_name, data, updated_at FROM json_store');
            const changed = [];
            for (const row of rows) {
                if (!this.dirty.has(row.store_name)) {
                    this.cache.set(row.store_name, row.data);
                    if (row.updated_at) this._timestamps.set(row.store_name, new Date(row.updated_at).getTime());
                    changed.push(row);
                }
            }
            for (const row of changed) {
                this.emit('update', row.store_name, row.data);
            }
            return rows.length;
        }
        const { rows } = await pool.query(
            'SELECT store_name, data, updated_at FROM json_store WHERE store_name = ANY($1)',
            [storeNames]
        );
        const changed = [];
        for (const row of rows) {
            if (!this.dirty.has(row.store_name)) {
                this.cache.set(row.store_name, row.data);
                if (row.updated_at) this._timestamps.set(row.store_name, new Date(row.updated_at).getTime());
                changed.push(row);
            }
        }
        for (const row of changed) {
            this.emit('update', row.store_name, row.data);
        }
        return rows.length;
    }

    /**
     * Flush only stores that have unsaved changes — used by the
     * 5-minute periodic safety timer. Avoids re-uploading the entire
     * cache (~100+ rows) on every cycle, which was the dominant
     * source of background PG bandwidth and event-loop work.
     *
     * Use `flush()` (no args) for the full-cache flush — only callers
     * that explicitly want every row written should pay that cost.
     */
    async flushDirty() {
        // Cancel all timers and flush dirty immediately
        for (const [, timer] of this.timers) clearTimeout(timer);
        this.timers.clear();
        if (this._localMode) {
            await this._flushDirtyLocal();
        } else {
            await this._flushDirty();
        }
    }

    async flush() {
        // Cancel all timers and flush everything immediately
        for (const [name, timer] of this.timers) {
            clearTimeout(timer);
        }
        this.timers.clear();

        if (this._localMode) {
            await this._flushDirtyLocal();
            // Also persist all cached stores to local files
            const promises = [];
            for (const [storeName, data] of this.cache) {
                const p = this._persistToLocal(storeName, data);
                if (p && typeof p.then === 'function') promises.push(p);
            }
            await Promise.allSettled(promises);
            log.info(`[JsonStore] Flushed ${this.cache.size} stores to local files`);
            return;
        }

        await this._flushDirty();
        // Also persist remaining cache
        const { getPool } = require('./pgPool');
        const pool = getPool();
        const promises = [];
        for (const [storeName, data] of this.cache) {
            // Cancel any queued coalesced Redis write — we're writing the
            // current value through to both tiers right now.
            this._clearRedisTimer(storeName);
            promises.push(
                pool.query(
                    `INSERT INTO json_store (store_name, data, updated_at)
                     VALUES ($1, $2::jsonb, NOW())
                     ON CONFLICT (store_name) DO UPDATE SET data = $2::jsonb, updated_at = NOW()
                     RETURNING updated_at`,
                    [storeName, JSON.stringify(data)]
                ).then(async (res) => {
                    // Write through to Redis using Postgres' own timestamp, so
                    // the next boot's reconcile sees the cache as current and
                    // takes the fast path instead of re-downloading everything.
                    const raw = res?.rows?.[0]?.updated_at;
                    const ms = raw ? new Date(raw).getTime() : Date.now();
                    this._timestamps.set(storeName, ms);
                    if (redis.ready) {
                        await redis.setStore(storeName, data, ms).catch(() => {});
                    }
                }).catch(err => log.error(`[JsonStore] Error flushing ${storeName}:`, err))
            );
        }
        await Promise.all(promises);
        log.info(`[JsonStore] Flushed ${this.cache.size} stores to PostgreSQL${redis.ready ? ' + Redis' : ''}`);
    }
}

const store = new JsonStore();
module.exports = store;
