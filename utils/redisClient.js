/**
 * redisClient — optional Redis cache + cross-process message bus.
 *
 * ═══ WHAT THIS IS FOR ═══
 * utils/jsonStore.js already serves every read synchronously from an
 * in-memory Map, so Redis is NOT here to make reads faster — it can't
 * beat a local Map. It exists to fix four real costs:
 *
 *   1. CROSS-PROCESS SYNC LATENCY.  Without Redis, jsonStore polls
 *      `SELECT store_name, updated_at FROM json_store` every 5s in every
 *      process (bot + dashboard) so each side notices the other's writes.
 *      That is ~35k queries/day per process and up to 5s of lag before a
 *      dashboard edit reaches the bot. Redis Pub/Sub makes it instant.
 *
 *   2. GATEWAY PING.  That 5s poll round-trip shares the event loop with
 *      the discord.js heartbeat; jsonStore's own comments identify it as
 *      the dominant source of `client.ws.ping` drift. Removing it helps.
 *
 *   3. COLD-START TIME + BANDWIDTH.  Boot pulls every store's full JSONB
 *      out of Postgres. With ~105 stores (several of them MBs) that is the
 *      single biggest transfer the bot makes. Redis serves it from memory.
 *
 *   4. METERED POSTGRES.  pgPool treats 'data transfer quota' as a
 *      failover trigger, i.e. this deployment is on a metered provider
 *      (Neon/Supabase). Shifting read traffic to Redis protects the quota.
 *
 * ═══ AUTHORITY MODEL — READ THIS BEFORE CHANGING ANYTHING ═══
 * PostgreSQL remains the SOURCE OF TRUTH. Redis is a cache and a bus.
 * Nothing is ever ONLY in Redis. A total Redis wipe must never lose data —
 * it only costs a slower next boot. Every hydrate path reconciles against
 * Postgres timestamps before trusting a cached value.
 *
 * ═══ DEGRADATION ═══
 * Fully optional at every level:
 *   - No REDIS_URL           → disabled, jsonStore behaves exactly as before
 *   - Driver not installed   → one warning, then disabled
 *   - Redis down mid-flight  → commands fail soft (null/false), PG path continues
 * Supports both `ioredis` (preferred) and `redis` v4 via a thin adapter.
 *
 * ═══ ENCODING ═══
 * Values are stored as JSON strings. Payloads over GZIP_THRESHOLD_BYTES are
 * gzipped and base64'd behind a `GZ1:` marker. gzip gets ~10x on our JSON and
 * base64 costs ~1.33x, so the net is still a ~7x reduction — and it keeps the
 * value a plain string, which behaves identically on both drivers (no
 * getBuffer()/returnBuffers divergence to special-case).
 */

'use strict';

const zlib = require('node:zlib');
const crypto = require('node:crypto');
const log = require('./logger-styled');

// ── Tunables ─────────────────────────────────────────────────────────────
const GZIP_THRESHOLD_BYTES = 32 * 1024;          // compress above 32 KB
const GZIP_MARKER = 'GZ1:';
// Skip caching absurdly large stores rather than blowing up Redis memory.
// The invalidation message is still published, so peers fall back to a PG
// read and stay correct — they just don't get the fast path for that store.
const MAX_VALUE_BYTES = Number(process.env.REDIS_MAX_VALUE_BYTES || 8 * 1024 * 1024);
const DEFAULT_TTL_SECONDS = Number(process.env.REDIS_TTL_SECONDS || 7 * 24 * 60 * 60);
const CONNECT_TIMEOUT_MS = Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 10_000);

const PREFIX = (process.env.REDIS_PREFIX || 'xnico').replace(/:+$/, '');
const KEY_STORE = (name) => `${PREFIX}:store:${name}`;
const KEY_INDEX = `${PREFIX}:store:__index__`;     // hash: storeName -> updatedAtMs
const CHANNEL_INVALIDATE = `${PREFIX}:store:invalidate`;

/**
 * Unique per-process id. Pub/Sub is a broadcast: without this the publisher
 * receives its own invalidation, re-reads the value it just wrote, and
 * re-emits 'update' — the exact self-feeding loop that jsonStore's
 * `_timestamps` seeding was added to stop on the Postgres poll path.
 */
const ORIGIN_ID = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;

// ── Driver resolution ────────────────────────────────────────────────────

/**
 * Resolve a Redis driver defensively. Mirrors pgPool.loadPg(): on some
 * serverless layouts this shared module sits at the repo root while the
 * driver is installed under a nested package's node_modules, so a plain
 * require() from here misses it.
 *
 * @returns {{kind:'ioredis'|'node-redis', mod:any}|null}
 */
function loadDriver() {
    const path = require('node:path');
    const roots = [
        null, // plain require — the normal case
        path.join(__dirname, '..', 'node_modules'),
        path.join(__dirname, '..', 'dashboard', 'node_modules'),
        path.join(process.cwd(), 'node_modules'),
        path.join(process.cwd(), 'dashboard', 'node_modules'),
    ];

    for (const kind of ['ioredis', 'redis']) {
        for (const root of roots) {
            try {
                const mod = require(root ? path.join(root, kind) : kind);
                if (mod) return { kind: kind === 'ioredis' ? 'ioredis' : 'node-redis', mod };
            } catch { /* keep trying */ }
        }
    }
    return null;
}

// ── Adapters ─────────────────────────────────────────────────────────────
// Normalize ioredis and node-redis v4 to one small surface so the rest of
// this file (and jsonStore) never branches on driver kind.

function makeIoredisAdapter(Redis, url) {
    const opts = {
        lazyConnect: false,
        connectTimeout: CONNECT_TIMEOUT_MS,
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
        // Cap reconnect backoff so a long outage doesn't stall reconnects.
        retryStrategy: (times) => Math.min(times * 500, 10_000),
    };
    if (/^rediss:/i.test(url)) opts.tls = { rejectUnauthorized: false };

    const client = new Redis(url, opts);
    client.on('error', () => {}); // suppress unhandled 'error' crashes

    return {
        kind: 'ioredis',
        raw: client,
        async connect() { /* auto-connects */ },
        async ping() { return client.ping(); },
        async get(k) { return client.get(k); },
        async set(k, v, ttl) {
            return ttl > 0 ? client.set(k, v, 'EX', ttl) : client.set(k, v);
        },
        async del(k) { return client.del(k); },
        async hgetall(k) { return client.hgetall(k); },
        async hget(k, f) { return client.hget(k, f); },
        async hset(k, f, v) { return client.hset(k, f, v); },
        async hdel(k, f) { return client.hdel(k, f); },
        async mget(keys) { return keys.length ? client.mget(keys) : []; },
        async publish(ch, msg) { return client.publish(ch, msg); },
        duplicate() { return makeIoredisAdapter(Redis, url); },
        async subscribe(ch, handler) {
            client.on('message', (channel, message) => {
                if (channel === ch) handler(message);
            });
            return client.subscribe(ch);
        },
        async quit() { try { await client.quit(); } catch { client.disconnect?.(); } },
    };
}

function makeNodeRedisAdapter(mod, url) {
    const client = mod.createClient({
        url,
        socket: {
            connectTimeout: CONNECT_TIMEOUT_MS,
            reconnectStrategy: (retries) => Math.min(retries * 500, 10_000),
            ...(/^rediss:/i.test(url) ? { tls: true, rejectUnauthorized: false } : {}),
        },
    });
    client.on('error', () => {});

    return {
        kind: 'node-redis',
        raw: client,
        async connect() { if (!client.isOpen) await client.connect(); },
        async ping() { return client.ping(); },
        async get(k) { return client.get(k); },
        async set(k, v, ttl) {
            return ttl > 0 ? client.set(k, v, { EX: ttl }) : client.set(k, v);
        },
        async del(k) { return client.del(k); },
        async hgetall(k) { return client.hGetAll(k); },
        async hget(k, f) { return client.hGet(k, f); },
        async hset(k, f, v) { return client.hSet(k, f, v); },
        async hdel(k, f) { return client.hDel(k, f); },
        async mget(keys) { return keys.length ? client.mGet(keys) : []; },
        async publish(ch, msg) { return client.publish(ch, msg); },
        duplicate() { return makeNodeRedisAdapter(mod, url); },
        async subscribe(ch, handler) {
            // node-redis v4 requires a dedicated connection for subscribes,
            // which the caller provides by using a duplicate() adapter.
            return client.subscribe(ch, (message) => handler(message));
        },
        async quit() { try { await client.quit(); } catch { await client.disconnect?.(); } },
    };
}

// ── Encoding helpers ─────────────────────────────────────────────────────

function encode(value) {
    const json = JSON.stringify(value);
    if (json === undefined) return null;
    if (Buffer.byteLength(json, 'utf8') < GZIP_THRESHOLD_BYTES) return json;
    try {
        return GZIP_MARKER + zlib.gzipSync(json).toString('base64');
    } catch {
        return json; // compression is an optimization, never a requirement
    }
}

/** Human-readable byte size for log lines (avoids "0.0MB" for small values). */
function formatBytes(n) {
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)}MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`;
    return `${n}B`;
}

function decode(raw) {
    if (raw === null || raw === undefined) return undefined;
    try {
        if (typeof raw === 'string' && raw.startsWith(GZIP_MARKER)) {
            const buf = Buffer.from(raw.slice(GZIP_MARKER.length), 'base64');
            return JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
        }
        return JSON.parse(raw);
    } catch {
        return undefined; // treat corrupt cache entries as a miss
    }
}

// ── Client ───────────────────────────────────────────────────────────────

class RedisCache {
    constructor() {
        this._main = null;
        this._sub = null;
        this._enabled = false;
        this._ready = false;
        this._initPromise = null;
        this._driverKind = null;
        this._warned = false;
        this._oversized = new Set();   // stores we've already warned about
        this._stats = { hits: 0, misses: 0, sets: 0, published: 0, received: 0, errors: 0 };
    }

    get enabled() { return this._enabled; }
    get ready() { return this._enabled && this._ready; }
    get originId() { return ORIGIN_ID; }
    get driver() { return this._driverKind; }

    /**
     * Connect and verify with a PING. Idempotent and concurrency-safe:
     * jsonStore.init() can be reached from several call sites (bot
     * connectDatabase, dashboard cold-start, dashboard per-request
     * middleware) and must not open duplicate connections.
     *
     * @returns {Promise<boolean>} true when Redis is usable
     */
    async init() {
        if (this._ready) return true;
        if (this._initPromise) return this._initPromise;
        this._initPromise = this._doInit();
        try {
            return await this._initPromise;
        } finally {
            // Clear on failure so a later attempt can retry rather than
            // being permanently stuck on a rejected/false promise.
            if (!this._ready) this._initPromise = null;
        }
    }

    async _doInit() {
        const url = (process.env.REDIS_URL || process.env.REDIS_URI || '').trim();
        if (!url) return false; // not configured — silent, this is the default

        const driver = loadDriver();
        if (!driver) {
            if (!this._warned) {
                this._warned = true;
                log.warning('[Redis] REDIS_URL is set but no driver found — run `npm install ioredis`. Continuing without Redis.');
            }
            return false;
        }

        this._driverKind = driver.kind;
        try {
            const make = driver.kind === 'ioredis' ? makeIoredisAdapter : makeNodeRedisAdapter;
            this._main = make(driver.mod, url);
            await this._main.connect();
            await this._main.ping();

            this._enabled = true;
            this._ready = true;
            log.success(`[Redis] Connected via ${driver.kind} (prefix "${PREFIX}", origin ${ORIGIN_ID})`);
            return true;
        } catch (err) {
            log.warning(`[Redis] Connection failed (${String(err?.message || err).slice(0, 80)}) — continuing without Redis.`);
            this._enabled = false;
            this._ready = false;
            try { await this._main?.quit(); } catch {}
            this._main = null;
            return false;
        }
    }

    // ── Data cache ───────────────────────────────────────────────────────

    /**
     * Fetch a cached store body plus its recorded version stamp.
     *
     * `ts` is read from the index hash, which jsonStore keeps pinned to the
     * authoritative Postgres `updated_at` (see touchStore). That matters:
     * comparing a Redis-supplied wall-clock time against a Postgres-supplied
     * one across skewed hosts can make a stale entry look fresh. Keeping one
     * clock — Postgres — makes the ordering comparison sound. `ts` is 0 when
     * no stamp is recorded yet, which callers must treat as "unknown".
     *
     * @returns {Promise<{data:any, ts:number}|null>} null on miss
     */
    async getStore(name) {
        if (!this.ready) return null;
        try {
            const raw = await this._main.get(KEY_STORE(name));
            const data = decode(raw);
            if (data === undefined) { this._stats.misses++; return null; }
            this._stats.hits++;
            let ts = 0;
            try {
                const stamp = Number(await this._main.hget(KEY_INDEX, name));
                if (Number.isFinite(stamp) && stamp > 0) ts = stamp;
            } catch { /* stamp is optional */ }
            return { data, ts };
        } catch {
            this._stats.errors++;
            return null;
        }
    }

    /**
     * Update only the version stamp for a store, leaving the body untouched.
     * Called after a successful Postgres write so the cached entry carries the
     * authoritative `updated_at` rather than a local wall-clock guess.
     */
    async touchStore(name, ts) {
        if (!this.ready || !ts) return false;
        try {
            await this._main.hset(KEY_INDEX, name, String(ts));
            return true;
        } catch {
            this._stats.errors++;
            return false;
        }
    }

    /**
     * Bulk hydrate. One HGETALL for the index plus one MGET for the values,
     * instead of ~105 individual round-trips.
     *
     * @returns {Promise<{stores:Map<string,any>, timestamps:Map<string,number>}|null>}
     */
    async hydrateAll() {
        if (!this.ready) return null;
        try {
            const index = await this._main.hgetall(KEY_INDEX);
            const names = Object.keys(index || {});
            if (names.length === 0) return null;

            const values = await this._main.mget(names.map(KEY_STORE));
            const stores = new Map();
            const timestamps = new Map();

            for (let i = 0; i < names.length; i++) {
                const data = decode(values[i]);
                if (data === undefined) { this._stats.misses++; continue; }
                this._stats.hits++;
                stores.set(names[i], data);
                const ts = Number(index[names[i]]);
                if (Number.isFinite(ts) && ts > 0) timestamps.set(names[i], ts);
            }
            return stores.size ? { stores, timestamps } : null;
        } catch (err) {
            this._stats.errors++;
            log.warning(`[Redis] hydrateAll failed (${String(err?.message || err).slice(0, 60)})`);
            return null;
        }
    }

    /**
     * Cache a store value and record its timestamp in the index.
     * Fire-and-forget friendly: never throws.
     *
     * @param {string} name
     * @param {*} data
     * @param {number} ts  authoritative updated_at in ms (0 = now)
     */
    async setStore(name, data, ts = 0) {
        if (!this.ready) return false;
        let payload;
        try {
            payload = encode(data);
        } catch {
            return false;
        }
        if (payload === null) return false;

        const bytes = Buffer.byteLength(payload, 'utf8');
        if (bytes > MAX_VALUE_BYTES) {
            if (!this._oversized.has(name)) {
                this._oversized.add(name);
                log.warning(`[Redis] Store "${name}" is ${formatBytes(bytes)} (limit ${formatBytes(MAX_VALUE_BYTES)}) — not cached; PostgreSQL still serves it.`);
            }
            return false;
        }

        try {
            await this._main.set(KEY_STORE(name), payload, DEFAULT_TTL_SECONDS);
            await this._main.hset(KEY_INDEX, name, String(ts || Date.now()));
            this._stats.sets++;
            return true;
        } catch {
            this._stats.errors++;
            return false;
        }
    }

    async delStore(name) {
        if (!this.ready) return false;
        try {
            await this._main.del(KEY_STORE(name));
            await this._main.hdel(KEY_INDEX, name);
            return true;
        } catch {
            this._stats.errors++;
            return false;
        }
    }

    // ── Pub/Sub invalidation bus ─────────────────────────────────────────

    /**
     * Announce that `name` changed. Deliberately publishes only a small
     * signal, never the payload: multi-MB stores would make every peer pay
     * the full transfer on every write, and Redis pub/sub has no delivery
     * guarantee worth that cost. Peers re-read from the Redis cache (sub-ms)
     * and fall back to Postgres on a miss.
     */
    async publishInvalidate(name, ts = Date.now()) {
        if (!this.ready) return false;
        try {
            await this._main.publish(
                CHANNEL_INVALIDATE,
                JSON.stringify({ o: ORIGIN_ID, s: name, t: ts })
            );
            this._stats.published++;
            return true;
        } catch {
            this._stats.errors++;
            return false;
        }
    }

    /**
     * Subscribe to invalidations from OTHER processes. Messages originating
     * from this process are dropped before the handler sees them.
     *
     * Uses a dedicated connection because a subscribed Redis connection
     * cannot issue normal commands (true for both drivers).
     *
     * @param {(name:string, ts:number) => void} handler
     */
    async subscribeInvalidate(handler) {
        if (!this.ready || typeof handler !== 'function') return false;
        if (this._sub) return true;
        try {
            this._sub = this._main.duplicate();
            await this._sub.connect();
            await this._sub.subscribe(CHANNEL_INVALIDATE, (message) => {
                let msg;
                try { msg = JSON.parse(message); } catch { return; }
                if (!msg || msg.o === ORIGIN_ID) return; // ignore our own echo
                this._stats.received++;
                try { handler(msg.s, Number(msg.t) || Date.now()); } catch (e) {
                    log.error(`[Redis] invalidate handler failed for ${msg.s}: ${e?.message || e}`);
                }
            });
            log.success('[Redis] Subscribed to cross-process invalidation bus');
            return true;
        } catch (err) {
            log.warning(`[Redis] subscribe failed (${String(err?.message || err).slice(0, 60)}) — falling back to Postgres polling.`);
            try { await this._sub?.quit(); } catch {}
            this._sub = null;
            return false;
        }
    }

    // ── Diagnostics / lifecycle ──────────────────────────────────────────

    stats() {
        const total = this._stats.hits + this._stats.misses;
        return {
            enabled: this._enabled,
            ready: this._ready,
            driver: this._driverKind,
            prefix: PREFIX,
            origin: ORIGIN_ID,
            subscribed: !!this._sub,
            ...this._stats,
            hitRate: total ? `${((this._stats.hits / total) * 100).toFixed(1)}%` : 'n/a',
        };
    }

    async close() {
        this._ready = false;
        const tasks = [];
        if (this._sub) tasks.push(this._sub.quit().catch(() => {}));
        if (this._main) tasks.push(this._main.quit().catch(() => {}));
        await Promise.allSettled(tasks);
        this._sub = null;
        this._main = null;
    }
}

const cache = new RedisCache();

module.exports = cache;
module.exports.CHANNEL_INVALIDATE = CHANNEL_INVALIDATE;
module.exports.KEY_STORE = KEY_STORE;
module.exports.KEY_INDEX = KEY_INDEX;
module.exports.ORIGIN_ID = ORIGIN_ID;
// Exported for tests — not part of the public surface.
module.exports._encode = encode;
module.exports._decode = decode;
