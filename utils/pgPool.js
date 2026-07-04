/**
 * pgPool — Dual-database pool with automatic failover.
 *
 * Primary:  DATABASE_URL
 * Fallback: FALLBACK_DATABASE_URL  (optional)
 *
 * On every query:
 *   1. Try primary pool
 *   2. If it fails, switch to fallback pool and retry
 *   3. Every 2 minutes, silently probe the primary — if it recovers,
 *      switch back automatically
 */

// Resolve the `pg` driver defensively. On most hosts a plain require works.
// On some serverless layouts (e.g. Vercel's legacy `builds`), this shared
// module lives at the repo root while `pg` may be installed under a nested
// package's node_modules — so fall back to a few known locations before
// giving up. This keeps the bot's normal require path unchanged.
function loadPg() {
    try {
        return require('pg');
    } catch (primaryErr) {
        const path = require('path');
        const candidates = [
            path.join(__dirname, '..', 'node_modules', 'pg'),
            path.join(__dirname, '..', 'dashboard', 'node_modules', 'pg'),
            path.join(process.cwd(), 'node_modules', 'pg'),
            path.join(process.cwd(), 'dashboard', 'node_modules', 'pg'),
        ];
        for (const c of candidates) {
            try {
                return require(c);
            } catch (_) { /* keep trying */ }
        }
        throw primaryErr;
    }
}

const { Pool } = loadPg();
const log = require('./logger-styled');

const RECOVERY_INTERVAL_MS = 2 * 60 * 1000; // check primary every 2 min

// Error codes/messages that indicate a connection-level failure
// (quota exceeded, server down) vs a query-level failure (bad SQL).
const FAILOVER_MESSAGES = [
    'data transfer quota',
    'connection refused',
    'connection terminated',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ssl connection',
    'timeout expired',
    'too many connections',
];

function isConnectionError(err) {
    if (!err) return false;
    const msg = (err.message || '').toLowerCase();
    return FAILOVER_MESSAGES.some(f => msg.includes(f.toLowerCase()))
        || err.code === 'ECONNREFUSED'
        || err.code === 'ETIMEDOUT'
        || err.code === '53300'   // too_many_connections
        || err.code === '57P01';  // admin_shutdown
}

function buildPool(connStr) {
    if (!connStr) return null;

    // Managed Postgres providers (Neon, Supabase, Railway, Render, Aiven, RDS…)
    // require TLS. Detect it from the URL or known hosts.
    const wantsSSL = /sslmode=|ssl=true/i.test(connStr)
        || /(neon\.tech|supabase|pooler|render\.com|railway|aivencloud|amazonaws|heroku|cockroachlabs)/i.test(connStr);

    // Strip sslmode / ssl params from the URL so they don't conflict with the
    // explicit `ssl` object below. Forcing `verify-full` makes node-postgres
    // verify the cert hostname, which fails on managed databases whose cert
    // hostname doesn't match — producing connection errors even when the DB
    // is fully online. We control TLS purely through the ssl object instead.
    let cleanStr = connStr
        .replace(/([?&])sslmode=[^&]*/gi, '$1')
        .replace(/([?&])ssl=[^&]*/gi, '$1')
        .replace(/\?&/g, '?')
        .replace(/&&+/g, '&')
        .replace(/[?&]+$/g, '');

    const pool = new Pool({
        connectionString: cleanStr,
        max: 10,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
        ssl: wantsSSL ? { rejectUnauthorized: false } : false,
    });
    pool.on('error', () => {}); // suppress unhandled error events
    return pool;
}

class DualPool {
    constructor() {
        this._primary  = null;
        this._fallback = null;
        this._usingFallback = false;
        this._recoveryTimer = null;
        this._initialized = false;
    }

    _init() {
        if (this._initialized) return;
        this._initialized = true;
        this._primary  = buildPool(process.env.DATABASE_URL || '');
        this._fallback = buildPool(process.env.FALLBACK_DATABASE_URL || '');

        if (this._fallback) {
            log.info('[PostgreSQL] Fallback database configured');
        }
    }

    _activePool() {
        this._init();
        return this._usingFallback ? this._fallback : this._primary;
    }

    _startRecovery() {
        if (this._recoveryTimer || !this._fallback) return;
        this._recoveryTimer = setInterval(async () => {
            try {
                await this._primary.query('SELECT 1');
                // Primary is back!
                clearInterval(this._recoveryTimer);
                this._recoveryTimer = null;
                this._usingFallback = false;
                log.success('[PostgreSQL] Primary database recovered — switched back');
            } catch {
                // Still down — keep waiting
            }
        }, RECOVERY_INTERVAL_MS);
        if (this._recoveryTimer.unref) this._recoveryTimer.unref();
    }

    _switchToFallback(err) {
        if (this._usingFallback || !this._fallback) return false;
        this._usingFallback = true;
        log.warning(`[PostgreSQL] Primary failed (${err.message?.slice(0, 60)}) — switching to fallback database`);
        this._startRecovery();
        return true;
    }

    /**
     * Execute a query with automatic failover.
     * Signature matches pg.Pool.query() exactly.
     */
    async query(text, values) {
        this._init();
        const active = this._activePool();
        if (!active) throw new Error('No database pool available');

        try {
            return await active.query(text, values);
        } catch (err) {
            // If this is a connection-level failure and we have a fallback, try it
            if (isConnectionError(err) && this._switchToFallback(err)) {
                try {
                    return await this._fallback.query(text, values);
                } catch (fallbackErr) {
                    log.error('[PostgreSQL] Fallback also failed:', fallbackErr.message?.slice(0, 80));
                    throw fallbackErr;
                }
            }
            throw err;
        }
    }

    /**
     * Acquire a client from the active pool (for transactions).
     */
    async connect() {
        this._init();
        return this._activePool().connect();
    }

    get usingFallback() { return this._usingFallback; }

    async end() {
        if (this._recoveryTimer) {
            clearInterval(this._recoveryTimer);
            this._recoveryTimer = null;
        }
        if (this._primary)  await this._primary.end().catch(() => {});
        if (this._fallback) await this._fallback.end().catch(() => {});
        this._primary  = null;
        this._fallback = null;
        this._initialized = false;
    }
}

const dualPool = new DualPool();

function getPool() {
    return dualPool;
}

async function closePool() {
    await dualPool.end();
}

module.exports = { getPool, closePool };
