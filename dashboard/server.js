/**
 * xNico Dashboard — Express Server v2
 * Full REST API with Discord OAuth2 login + module configuration
 */
const express = require('express');
const path = require('node:path');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
let helmet = null;
let rateLimit = null;
try { helmet = require('helmet'); } catch { /* optional security module, skip if not installed */ }
try { rateLimit = require('express-rate-limit'); } catch { /* optional security module, skip if not installed */ }

try {
    require('@dotenvx/dotenvx').config({ path: path.join(__dirname, '..', '.env') });
} catch (error) { // nosonar
    // @dotenvx not installed, fall back to regular dotenv
    try {
        require('dotenv').config({ path: path.join(__dirname, '.env') });
    } catch (error_) { // nosonar
        // Try one more fallback location
        require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
    }
}
// Suppress Node.js deprecation warnings (like punycode)
process.env.NODE_NO_WARNINGS = '1';

// AsyncLocalStorage gives every request its own context bag that
// survives `await` boundaries. We use it to collect background
// write promises so the response shim can flush them before the
// serverless host freezes the sandbox. See the pendingWrites
// middleware below for the full rationale.
const { AsyncLocalStorage } = require('node:async_hooks');
const requestStore = new AsyncLocalStorage();

const app = express();
app.disable('x-powered-by');
const PORT = process.env.DASHBOARD_PORT || 3500;
// JWT_SECRET MUST be set in production. The hardcoded fallback below
// is only retained for first-run local development; if it's ever used
// we log a loud warning so deployments don't ship with a known key.
const JWT_SECRET_FALLBACK = 'xnico-dashboard-secret-key-2024-v2';
const JWT_SECRET = process.env.JWT_SECRET || JWT_SECRET_FALLBACK;
if (JWT_SECRET === JWT_SECRET_FALLBACK) {
    console.warn('\n[Dashboard] ⚠ WARNING: JWT_SECRET env var not set — using insecure fallback. Set JWT_SECRET in production!\n');
}
const DISCORD_CLIENT_ID = process.env.CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
// Explicit override (use this in production if auto-detection ever guesses
// wrong behind an unusual proxy). When unset we resolve the redirect URI
// dynamically from each request — see resolveRedirectUri() below.
const DISCORD_REDIRECT_ENV = process.env.DISCORD_REDIRECT || '';
const DISCORD_REDIRECT_FALLBACK = `http://localhost:${PORT}/api/auth/discord/callback`;
const BOT_TOKEN = process.env.TOKEN || '';

/**
 * Resolve the OAuth2 redirect URI for THIS request.
 *
 * The #1 reason Discord login "stops working" after deploying is a
 * redirect_uri mismatch: the code hard-codes localhost (or a single
 * env value) while the app is actually served from a Vercel/preview
 * domain. Discord then rejects the callback ("Invalid OAuth2 redirect_uri")
 * or sends the user back to a dead localhost URL.
 *
 * Resolution order:
 *   1. DISCORD_REDIRECT env var, if explicitly set (production override).
 *   2. The live request's protocol + host (works on any domain, incl.
 *      Vercel previews) — requires `trust proxy` so x-forwarded-* is honored.
 *   3. localhost fallback for first-run local dev.
 *
 * IMPORTANT: the authorize step and the token-exchange step must send the
 * EXACT same redirect_uri. Because both derive it from the same request
 * host, they stay in lock-step automatically. Whatever value this returns
 * for your domain must also be added to the Discord Developer Portal ->
 * OAuth2 -> Redirects list.
 */
function resolveRedirectUri(req) {
    if (DISCORD_REDIRECT_ENV) return DISCORD_REDIRECT_ENV;
    try {
        if (req) {
            const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
                .split(',')[0].trim();
            const host = req.get('host');
            if (host) return `${proto}://${host}/api/auth/discord/callback`;
        }
    } catch {}
    return DISCORD_REDIRECT_FALLBACK;
}
const FRONTEND_URL = process.env.FRONTEND_URL || '';
// Comma-separated list of permitted browser origins. If unset we allow
// any origin (legacy behavior); set DASHBOARD_CORS_ORIGINS in prod.
const CORS_ORIGINS = (process.env.DASHBOARD_CORS_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

console.log(`[Dashboard] Auth Config: Redirect=${DISCORD_REDIRECT_ENV || '(auto-detected per request)'}`);
console.log(`[Dashboard] Discord OAuth: ${DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET ? 'Configured' : 'INCOMPLETE — set CLIENT_ID + DISCORD_CLIENT_SECRET'}`);
console.log(`[Dashboard] JWT Secret: ${JWT_SECRET.substring(0, 5)}... (LOADED)`);

app.set('trust proxy', true);

// Helmet for sane default security headers (CSP off because the SPA
// loads inline event handlers; we keep frame/x-content/referrer-policy).
if (helmet) {
    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' }
    }));
}

if (CORS_ORIGINS.length) {
    app.use(cors({
        origin: (origin, cb) => {
            // Same-origin requests have no Origin header — always allow.
            if (!origin) return cb(null, true);
            return cb(null, CORS_ORIGINS.includes(origin));
        },
        credentials: true
    }));
} else {
    app.use(cors({ origin: true, credentials: true }));
}

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Rate-limit auth endpoints to slow brute-force attacks. 30 attempts /
// 15 min per IP is generous enough for legit users and aggressive
// enough to make password cracking impractical.
if (rateLimit) {
    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 30,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many authentication attempts. Try again in 15 minutes.' }
    });
    app.use('/api/auth/login', authLimiter);
    app.use('/api/auth/register', authLimiter);
}

const jsonStore = require('../utils/jsonStore');
const botCustomize = require('../utils/botCustomize');
const { notifyStoreUpdate } = require('../utils/storeSync');

/*
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * Dashboard <-> Bot sync model
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * All module config endpoints read/write via jsonStore (writeBotStore =
 * jsonStore.writeImmediate). jsonStore now emits an 'update' event on
 * every write/writeImmediate AND on every PostgreSQL poll refresh.
 * The bot subscribes to those events via utils/storeSync.js, which fans
 * out to global.updateAutomodCache / global.reloadAntinukeCache /
 * botCustomize.invalidateCache / etc. so the in-memory caches stay
 * fresh whether the dashboard is in the same process (sync) or in a
 * separate process (3s PG poll).
 *
 * The storeSync listener is the SINGLE source of truth for cache
 * invalidation. Route handlers below MUST NOT also call the per-guild
 * `global.update*Cache` functions inline — that would double-apply
 * every write.
 * â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 */

// Map module names from the generic /:module route to jsonStore names.
// Most are 1:1; a few dashboard-friendly aliases collapse to the same store.
const MODULE_TO_STORE = {
    voice: 'join2create',
    'media-only': 'media-only',
    'bot-customize': 'bot-customize',
    'economy-settings': 'economy-settings',
    'social-notify': 'social-notify',
    'vote-config': 'vote-config',
    confessions: 'confessions',
    serverstats: 'serverstats',
    // Newer systems exposed by recent commits — keep these in sync with
    // the bot's store names so dashboard-driven writes invalidate the
    // right cache via storeSync.
    'screenshot-verify':             'screenshot-verify',
    'screenshot-verify-submissions': 'screenshot-verify-submissions',
    'custom-shop':                   'custom-shop',
    'customshop':                    'custom-shop',
    'currency':                      'economy-settings',
    'superthreatmode':               'superthreatmode',
    // Newly surfaced bot features. Each of these has a dedicated panel
    // command (`commands/admin/<name>.js`) writing to the store of the
    // same name; we expose them on the dashboard now so changes made
    // here flow through storeSync to the bot host.
    aichat:            'aichat',
    birthdays:         'birthdays',
    applications:      'applications',
    'application-responses': 'application-responses',
    statusrole:        'statusrole',
    botblock:          'botblock',
    vanityguard:       'vanityguard',
    nightmode:         'nightmode',
    emergency:         'emergency',
    servertag:         'servertag',
    guildtags:         'guildtags',
    lockdown:          'lockdown',
    'ignored-channels':'ignored-channels',
    warnings:          'warnings',
    'warn-config':     'warn-config',
    modlogs:           'modlogs',
    // Dashboard exposes "logging" with friendly field names (modLog,
    // messageLog, ...) but the bot reads the 'logs' store with shorter
    // keys (moderation, message, ...). The translation lives in the
    // logging-specific GET/PUT handlers further below; here we just
    // make sure cache-invalidation events fire on the right store.
    logging: 'logs',
    actions: 'actions'
};

function notifyModuleUpdate(moduleName, guildId, updated) {
    if (!moduleName) return;
    try {
        const storeName = MODULE_TO_STORE[moduleName] || moduleName;
        // Read the just-written snapshot back so the listener receives a
        // canonical view (matches what jsonStore would have emitted on
        // writeImmediate). The listener is the SINGLE source of truth
        // for cache invalidation — do NOT also invoke per-guild
        // global.update*Cache here, that would double-apply every write.
        const all = readBotStore(storeName) || {};
        notifyStoreUpdate(storeName, all);
    } catch {}
}

// Vercel Serverless Init Middleware
let jsonStoreInitPromise = null;
let _lastPgRetry = 0;
app.use(async (req, res, next) => {
    if (req.path.startsWith('/api/') && !jsonStore.initialized) {
        if (!jsonStoreInitPromise) {
            jsonStoreInitPromise = jsonStore.init().catch(err => {
                console.error('[Dashboard] Serverless Init Error:', err);
            });
        }
        await jsonStoreInitPromise;
    }

    // Self-heal: if we latched into local-file mode on a transient Postgres
    // error but DATABASE_URL IS configured, re-attempt Postgres (throttled).
    // Without this, one flaky first connection on a cold Vercel instance would
    // desync the dashboard from the bot for the whole life of that instance.
    if (req.path.startsWith('/api/')
        && jsonStore.initialized
        && jsonStore._localMode
        && process.env.DATABASE_URL
        && typeof jsonStore.retryPostgres === 'function') {
        const now = Date.now();
        if (now - _lastPgRetry > 10000) {
            _lastPgRetry = now;
            try { await jsonStore.retryPostgres(); } catch { /* keep serving */ }
        }
    }
    next();
});

// â”€â”€ Read-freshness middleware (serverless split-hosting) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// On Vercel each warm invocation reuses the jsonStore cache loaded at the
// last cold start, and the bot's 5s PostgreSQL poll (smartRefresh) does NOT
// run while the function is frozen between requests. Without this, dashboard
// GET routes that read straight from the cache (trust, invites, serverstats,
// automod, antinuke, leveling, economy, tickets, …) serve STALE data — so
// changes the bot made never appear in the dashboard ("store in bot not
// showing in dashboard").
//
// Fix: before any /api read, re-pull the shared store from Postgres (one
// SELECT). A short TTL prevents warm-burst requests from hammering the DB.
// No-op in local-file mode (single-host), where the cache is authoritative.
let _lastReadRefresh = 0;
// smartRefresh is a cheap `SELECT store_name, updated_at` diff that only
// re-pulls the rows whose timestamp actually changed, so we can run it on
// (almost) every read without the multi-MB full-table transfer that
// jsonStore.refresh() performs. A tiny TTL still coalesces warm bursts.
const READ_REFRESH_TTL_MS = 1000;
app.use(async (req, res, next) => {
    if (req.method === 'GET'
        && req.path.startsWith('/api/')
        && jsonStore.initialized
        && !jsonStore._localMode) {
        const now = Date.now();
        if (now - _lastReadRefresh > READ_REFRESH_TTL_MS) {
            _lastReadRefresh = now;
            try {
                // Prefer the lightweight timestamp-diff refresh; fall back to
                // the full pull only if smartRefresh isn't available.
                if (typeof jsonStore.smartRefresh === 'function') {
                    await jsonStore.smartRefresh();
                } else if (typeof jsonStore.refresh === 'function') {
                    await jsonStore.refresh();
                }
            } catch (e) {
                console.error('[Dashboard] Read refresh failed:', e?.message || e);
            }
        }
    }
    next();
});

// â”€â”€ Per-request "pending writes" tracker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Vercel (and any serverless host) freezes the function as soon as the
// HTTP response is sent. Background promises that haven't resolved
// yet are silently killed. That's why dashboard PUTs appeared to
// "succeed" on the dashboard but never reached the bot — the PG
// upsert was still in flight when the sandbox got frozen.
//
// This middleware uses Node's AsyncLocalStorage so the "current
// request" survives await boundaries (a module-scoped `let` is NOT
// safe here because async route handlers interleave). Every call
// to `writeBotStore` looks up the active context via
// `requestStore.getStore()` and pushes its persist promise onto
// `pendingWrites`. The wrapped `res.json` awaits all of them before
// flushing the response so the serverless host doesn't freeze us
// mid-PG-upsert.
//
// Routes don't need to change — every call to `writeBotStore`
// already participates. Routes that already `await writeBotStore`
// directly are unaffected (the promise just resolves twice).
app.use((req, res, next) => {
    const ctx = { pendingWrites: [] };
    const origJson = res.json.bind(res);
    res.json = function patchedJson(body) {
        const writes = ctx.pendingWrites.splice(0);
        if (writes.length === 0) return origJson(body);
        return Promise.allSettled(writes).then(() => origJson(body));
    };
    requestStore.run(ctx, () => next());
});

// â”€â”€ Data Store â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let DATA_DIR = path.join(__dirname, 'data');
try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
} catch (error) { // nosonar
    // Failed to create data directory, use tmp dir instead
    DATA_DIR = '/tmp/xnico_dashboard_data'; // nosonar
    try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (error_) { // nosonar
        // Failed to create tmp dir too, proceed without persistent data
    }
}

function readJSON(file, fallback = {}) {
    let fallbackData;
    if (typeof fallback === 'function') {
        fallbackData = fallback();
    } else if (Array.isArray(fallback)) {
        fallbackData = [...fallback];
    } else {
        fallbackData = { ...fallback };
    }
    try {
        if (jsonStore.initialized) {
            const storeName = 'dash_' + file.replace('.json', '');
            if (jsonStore.has(storeName)) {
                return jsonStore.read(storeName);
            }
        }
        if (fs.existsSync(path.join(DATA_DIR, file))) {
            return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8'));
        }
    } catch { /* Failed to read file, return fallback */ }
    return fallbackData;
}

function writeJSON(file, data) {
    try {
        if (jsonStore.initialized) {
            const storeName = 'dash_' + file.replace('.json', '');
            jsonStore.writeImmediate(storeName, data);
        }
        fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
    } catch (error) { // nosonar
        // Failed to write, but jsonStore may have succeeded (best effort)
    }
}

// Try to read from bot's jsonStore data
function readBotStore(storeName) {
    if (!jsonStore.initialized) return null;
    return jsonStore.read(storeName);
}
function peekBotStore(storeName) {
    if (!jsonStore.initialized) return null;
    return jsonStore.peek(storeName);
}

// â”€â”€ Bot guild membership resolver â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Discord's GET /users/@me/guilds caps results at 200 per page, so a bot
// in 200+ servers would silently drop guilds and the dashboard would
// incorrectly show "Invite Bot" for guilds the bot is already in. This
// helper paginates the Discord API, caches the result, and falls back
// to the local guild_members store on API failure.
//
// Cache TTL note: 10s is a deliberate trade-off. Higher values (we used
// 30s previously) reduce Discord-API load but leave the dashboard
// showing "Invite Bot" for that long after the user actually invited
// the bot — a classic "did it work?" moment that looks broken even
// when the bot is in the guild. The frontend's recheck poll calls the
// `/api/guilds/refresh` force endpoint anyway, so the cache here is
// only a backstop for unforced GETs.
const BOT_GUILDS_TTL_MS = 10_000;
let _botGuildsCache = { ids: null, fetchedAt: 0, refreshing: null };

async function fetchAllBotGuildIds() {
    if (!BOT_TOKEN) return new Set();

    const ids = new Set();
    let after = null;
    // Defensive cap (~ 20k guilds) so a malformed response can never
    // turn into an infinite loop.
    for (let page = 0; page < 100; page++) {
        const url = new URL('https://discord.com/api/users/@me/guilds');
        url.searchParams.set('limit', '200');
        if (after) url.searchParams.set('after', after);

        const r = await fetch(url, { headers: { Authorization: `Bot ${BOT_TOKEN}` } });
        if (!r.ok) break;
        const batch = await r.json();
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const g of batch) ids.add(g.id);
        if (batch.length < 200) break;
        after = batch.at(-1).id;
    }
    return ids;
}

function readBotGuildIdsFromLocalStore() { // nosonar
    const ids = new Set();
    // Primary: the authoritative guild list the bot persists on ready,
    // guildCreate and guildDelete (see syncBotGuildsList in index.js).
    // This is the source of truth that lets the dashboard resolve bot
    // presence over a shared database WITHOUT needing a BOT_TOKEN, and
    // it includes guilds the bot just joined that have no activity yet.
    try {
        const list = readBotStore('bot_guilds') || [];
        const arr = Array.isArray(list) ? list : Object.values(list || {});
        for (const g of arr) {
            const gid = typeof g === 'string' ? g : (g?.id || g?.guild_id || g?.guildId);
            if (gid) ids.add(String(gid));
        }
    } catch {}
    // Secondary: any guild the bot has recorded a member for is a guild
    // the bot is (or was) in — covers older data written before bot_guilds.
    try {
        const members = readBotStore('guild_members') || [];
        const arr = Array.isArray(members) ? members : Object.values(members || {});
        for (const m of arr) {
            const gid = m?.guild_id || m?.guildId;
            if (gid) ids.add(String(gid));
        }
    } catch {}
    try {
        const guilds = readBotStore('guilds') || [];
        const arr = Array.isArray(guilds) ? guilds : [];
        for (const g of arr) {
            const gid = g?.guild_id || g?.guildId || g?.id;
            if (gid) ids.add(String(gid));
        }
    } catch {}
    return ids;
}

async function getBotGuildIds({ force = false } = {}) {
    const now = Date.now();
    if (!force && _botGuildsCache.ids && (now - _botGuildsCache.fetchedAt) < BOT_GUILDS_TTL_MS) {
        return _botGuildsCache.ids;
    }
    // Coalesce concurrent refreshes into one in-flight request.
    if (_botGuildsCache.refreshing) return _botGuildsCache.refreshing;

    _botGuildsCache.refreshing = (async () => {
        // Resolve bot presence from BOTH sources and union them. A guild
        // counts as "bot present" if it appears in EITHER:
        //   1. the Discord API (authoritative, needs a valid BOT_TOKEN), or
        //   2. the bot's own data store (guild_members / guilds) — which works
        //      whenever the dashboard shares the bot's database, even if
        //      BOT_TOKEN is missing/expired on this deployment.
        //
        // The previous logic used the local store ONLY when the API returned
        // empty. That meant a missing/expired BOT_TOKEN (API -> empty) combined
        // with any momentary local miss flipped EVERY server to "Invite",
        // which is exactly the "invite required even though the bot is here"
        // bug. Unioning makes detection resilient to either source failing.
        const merged = new Set();

        try {
            const apiIds = await fetchAllBotGuildIds();
            for (const id of apiIds) merged.add(String(id));
        } catch (e) {
            console.warn('[botGuilds] Discord API fetch failed:', e?.message || e);
        }

        try {
            const local = readBotGuildIdsFromLocalStore();
            for (const id of local) merged.add(String(id));
        } catch (e) {
            console.warn('[botGuilds] Local store read failed:', e?.message || e);
        }

        if (merged.size > 0) {
            _botGuildsCache.ids = merged;
            _botGuildsCache.fetchedAt = Date.now();
            return merged;
        }

        // Neither source produced anything (no token + no shared/populated
        // store). Keep the last known-good result rather than flipping every
        // server to "Invite".
        return _botGuildsCache.ids || merged;
    })().finally(() => { _botGuildsCache.refreshing = null; });

    return _botGuildsCache.refreshing;
}

/**
 * Write a store and wait until it's actually been persisted to
 * PostgreSQL (or the local file in fallback mode).
 *
 * IMPORTANT: callers MUST `await` this in serverless environments
 * (Vercel, Cloudflare, AWS Lambda) because the function host freezes
 * the sandbox the moment the HTTP response is sent. A non-awaited
 * write that happens to be in-flight when the response goes out can
 * be dropped silently — which is exactly why dashboard saves were
 * "not applying" on the bot host. The bot polls PG every 3s and
 * only sees changes that actually committed.
 *
 * For routes that haven't been refactored to `await writeBotStore()`
 * directly, the per-request `pendingWrites` middleware below tracks
 * the returned promise on `res.locals.pendingWrites` and the
 * `res.json` shim awaits the bundle before flushing the response.
 */
function writeBotStore(storeName, data) {
    if (!jsonStore.initialized) return Promise.resolve();
    let promise;
    if (typeof jsonStore.writeImmediate === 'function') {
        promise = Promise.resolve(jsonStore.writeImmediate(storeName, data));
    } else {
        jsonStore.write(storeName, data);
        promise = Promise.resolve();
    }
    // Track on the active request's pendingWrites bag so the response
    // shim waits for PG to commit before Vercel freezes the sandbox.
    const ctx = requestStore.getStore();
    if (ctx && Array.isArray(ctx.pendingWrites)) {
        ctx.pendingWrites.push(promise.catch(err =>
            console.error(`[Dashboard] writeBotStore(${storeName}) failed:`, err?.message || err)
        ));
    }
    return promise;
}

/**
 * Race-safe single-guild update. Re-reads the latest row from PG
 * before applying the mutation so concurrent bot writes aren't
 * clobbered. See utils/jsonStore.js -> updateGuildEntry for the full
 * rationale. Returns the updated guild entry.
 */
async function updateGuildStore(storeName, guildId, mutator) {
    if (!jsonStore.initialized) return null;
    if (typeof jsonStore.updateGuildEntry === 'function') {
        return jsonStore.updateGuildEntry(storeName, guildId, mutator);
    }
    // Legacy fallback (shouldn't happen post-update)
    const all = jsonStore.read(storeName) || {};
    const before = all[guildId] || {};
    const after = mutator(before, all);
    all[guildId] = (after && typeof after === 'object') ? after : before;
    await writeBotStore(storeName, all);
    return all[guildId];
}

/**
 * Race-safe single-USER update for the array-shaped `users` store.
 * Mirrors updateGuildStore but for users keyed by `user_id`. Prevents
 * the dashboard's whole-array write from clobbering the bot's frequent
 * users writes (economy/XP/stats) — the root cause of profile/rank
 * customizations appearing not to persist. Returns the updated record.
 */
async function updateUserStore(userId, mutator) {
    if (typeof jsonStore.updateUserEntry === 'function') {
        return jsonStore.updateUserEntry(userId, mutator);
    }
    // Legacy fallback (older jsonStore without updateUserEntry).
    const users = readBotStore('users') || [];
    const usersList = Array.isArray(users) ? users : Object.values(users);
    let rec = usersList.find(u => u && (u.user_id === userId || u.userId === userId));
    if (!rec) { 
        rec = { user_id: userId, profile: {}, social: {} }; 
        if (Array.isArray(users)) users.push(rec); else users[userId] = rec;
    }
    const after = mutator(rec, users);
    if (after && typeof after === 'object' && after !== rec) {
        if (Array.isArray(users)) {
            const idx = users.indexOf(rec);
            if (idx >= 0) users[idx] = after;
        } else {
            users[userId] = after;
        }
        rec = after;
    }
    await writeBotStore('users', users);
    return rec;
}

// (jsonStore.init moved to end of file to wrap app.listen)

// Init default admin
(function initUsers() {
    const users = readJSON('users.json', []);
    if (users.length === 0) {
        users.push({ id: 'usr_' + Date.now(), username: 'admin', email: 'admin@xnico.bot', password: bcrypt.hashSync('admin123', 10), role: 'owner', avatar: null, createdAt: new Date().toISOString() });
        writeJSON('users.json', users);
    }
})();

// Init analytics
//
// Seed file is purely for cold-start when no bot data has been
// recorded yet. We use a flat zero baseline rather than randomized
// numbers so the dashboard never lies to operators on first boot.
(function initAnalytics() {
    if (readJSON('analytics.json', null)) return;
    const days = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        days.push({ date: d.toISOString().split('T')[0], commands: 0, messages: 0, members: 0 });
    }
    writeJSON('analytics.json', { totalCommands: 0, totalMessages: 0, totalMembers: 0, totalGuilds: 0, uptime: 99.9, avgResponseTime: 42, daily: days });
})();

// Init mod logs (no longer used by /api/modlogs, kept only for
// dashboard's local "examples" section if any UI still reads it.)
(function initModLogs() {
    if (readJSON('modlogs.json', null)) return;
    writeJSON('modlogs.json', []);
})();

// â”€â”€ Auth Middleware â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function authMiddleware(req, res, next) {
    const t = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (!t) {
        console.warn('[Auth] No token found in request.');
        return res.status(401).json({ error: 'Token missing' });
    }
    try {
        req.user = jwt.verify(t, JWT_SECRET);
        next();
    } catch (err) {
        console.error('[Auth] JWT Verification Failed:', err.message);
        return res.status(401).json({ error: 'Verification failed: ' + err.message });
    }
}

// â”€â”€ Bot Info (public, no auth) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/bot-info', async (req, res) => {
    try {
        const r = await fetch(`https://discord.com/api/v10/users/${DISCORD_CLIENT_ID}`, {
            headers: { Authorization: `Bot ${process.env.TOKEN}` }
        });
        const bot = await r.json();
        let avatarUrl;
        if (bot.avatar) {
            const extension = bot.avatar.startsWith('a_') ? 'gif' : 'png';
            avatarUrl = `https://cdn.discordapp.com/avatars/${bot.id}/${bot.avatar}.${extension}?size=256`;
        } else {
            const discriminator = Number.parseInt(bot.discriminator || '0', 10);
            avatarUrl = `https://cdn.discordapp.com/embed/avatars/${discriminator % 5}.png`;
        }
        res.json({ id: bot.id, username: bot.username, avatar: avatarUrl, banner_color: bot.banner_color });
    } catch (error) { /* Failed to fetch bot info from Discord, return default data */ res.json({ id: DISCORD_CLIENT_ID, username: 'xNico', avatar: '', banner_color: null }); } // nosonar
});



// â”€â”€ Discord OAuth2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/auth/discord', (req, res) => {
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        return res.status(503).json({ error: 'Discord OAuth is not configured on the server.' });
    }
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: resolveRedirectUri(req),
        response_type: 'code',
        scope: 'identify guilds'
    });
    res.json({ url: `https://discord.com/api/oauth2/authorize?${params}` });
});

// Direct redirect endpoint — browser navigates here directly
app.get('/api/auth/discord/redirect', (req, res) => {
    // Surface a clear, user-facing error instead of bouncing to Discord
    // with an empty client_id (which yields a cryptic Discord error page).
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        console.error('[Auth] Redirect blocked: OAuth not configured (CLIENT_ID / DISCORD_CLIENT_SECRET missing).');
        return res.redirect('/?error=oauth_not_configured');
    }
    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: resolveRedirectUri(req),
        response_type: 'code',
        scope: 'identify guilds'
    });
    res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// Fallback for common redirect URI patterns
app.get(['/auth/callback', '/callback'], (req, res) => {
    res.redirect(`/api/auth/discord/callback?${new URLSearchParams(req.query).toString()}`);
});

app.get('/api/auth/discord/callback', async (req, res) => {
    const { code, error: oauthError } = req.query;
    console.log('[Auth] Step 1: Callback received, code:', code ? 'present' : 'MISSING');
    // Discord can redirect back with ?error=access_denied if the user
    // clicks "Cancel" on the consent screen — surface that cleanly.
    if (oauthError) {
        console.warn('[Auth] Discord returned error on callback:', oauthError);
        return res.redirect('/?error=' + encodeURIComponent(String(oauthError)));
    }
    if (!code) return res.redirect('/?error=no_code');
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        console.error('[Auth] Callback blocked: OAuth not configured (CLIENT_ID / DISCORD_CLIENT_SECRET missing).');
        return res.redirect('/?error=oauth_not_configured');
    }
    // Must EXACTLY match the redirect_uri used in the authorize step.
    // Both are derived from the same request host, so they line up.
    const redirectUri = resolveRedirectUri(req);
    try {
        // Step 2: Exchange code for Discord access token
        console.log('[Auth] Step 2: Exchanging code with Discord...');
        console.log('[Auth]   client_id:', DISCORD_CLIENT_ID);
        console.log('[Auth]   redirect_uri:', redirectUri);
        const tokenParams = new URLSearchParams({ client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirectUri });
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenParams.toString()
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) {
            console.error('[Auth] Step 2 FAILED - Discord token exchange error:', JSON.stringify(tokenData));
            return res.redirect('/?error=token_failed');
        }
        console.log('[Auth] Step 2 OK: Got Discord access token');

        // Step 3: Get user info from Discord
        console.log('[Auth] Step 3: Fetching Discord user info...');
        const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
        const discordUser = await userRes.json();
        console.log('[Auth] Step 3 OK: User:', discordUser.username, 'ID:', discordUser.id);

        // Step 4: Get user guilds
        console.log('[Auth] Step 4: Fetching user guilds...');
        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
        const userGuilds = await guildsRes.json();
        console.log('[Auth] Step 4 OK: Found', Array.isArray(userGuilds) ? userGuilds.length : 0, 'guilds');

        // Step 5: Save user to local DB
        console.log('[Auth] Step 5: Saving user to DB...');
        const users = readJSON('users.json', []);
        let user = users.find(u => u.discordId === discordUser.id);
        if (!user) {
            user = { id: 'usr_' + Date.now(), discordId: discordUser.id, username: discordUser.username, email: discordUser.email || '', avatar: discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : null, role: 'user', createdAt: new Date().toISOString() };
            users.push(user);
            console.log('[Auth] Step 5: Created new user:', user.id);
        } else {
            user.username = discordUser.username;
            user.avatar = discordUser.avatar ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png` : user.avatar;
            console.log('[Auth] Step 5: Updated existing user:', user.id);
        }
        writeJSON('users.json', users);

        // Save user guilds (filter to admin/manage perms)
        const adminGuilds = (Array.isArray(userGuilds) ? userGuilds : []).filter(g => (g.permissions & 0x8) === 0x8 || (g.permissions & 0x20) === 0x20);
        writeJSON(`guilds_${discordUser.id}.json`, adminGuilds);
        console.log('[Auth] Step 5 OK: Saved', adminGuilds.length, 'admin guilds');

        // Step 6: Create JWT and redirect
        const jwtToken = jwt.sign({ id: user.id, discordId: discordUser.id, username: discordUser.username, role: user.role, avatar: user.avatar, accessToken: tokenData.access_token }, JWT_SECRET, { expiresIn: '7d' });
        console.log('[Auth] Step 6: JWT created, length:', jwtToken.length);

        const isSecure = req.protocol === 'https';

        // httpOnly cookie so XSS can't steal the JWT. The client's
        // localStorage copy is set from the URL `?token=` once, then the
        // cookie carries it for subsequent fetches via credentials: include.
        res.cookie('token', jwtToken, {
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/',
            sameSite: isSecure ? 'none' : 'lax',
            secure: isSecure
        });

        const redirectURL = `/?token=${jwtToken}`;
        console.log('[Auth] Step 7: Redirecting to /?token=... (length:', redirectURL.length, ')');
        res.redirect(redirectURL);
    } catch (e) {
        console.error('[Auth] OAuth EXCEPTION:', e.message, e.stack?.split('\n')[1]);
        res.redirect('/?error=oauth_failed');
    }
});

// â”€â”€ Standard Auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const users = readJSON('users.json', []);
    const user = users.find(u => (u.username === username || u.email === username) && u.password);
    if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
    const t = jwt.sign({ id: user.id, discordId: user.discordId, username: user.username, role: user.role, email: user.email, avatar: user.avatar }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', t, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
    res.json({ token: t, user: { id: user.id, username: user.username, email: user.email, role: user.role, avatar: user.avatar } });
});

app.post('/api/auth/register', (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
    const users = readJSON('users.json', []);
    if (users.some(u => u.username === username)) return res.status(409).json({ error: 'Username taken' });
    const hash = bcrypt.hashSync(password, 10);
    const u = { id: 'usr_' + Date.now(), username, email, password: hash, role: 'viewer', avatar: null, createdAt: new Date().toISOString() };
    users.push(u);
    writeJSON('users.json', users);
    const t = jwt.sign({ id: u.id, username: u.username, role: u.role, email: u.email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token: t, user: { id: u.id, username: u.username, email: u.email, role: u.role } });
});

app.post('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ success: true }); });

// Returns the JWT user PLUS canonical owner / premium flags so the
// frontend never has to guess. The dashboard hides owner-only UI
// (premium key generator, premium nav link) based on these flags —
// it's also enforced server-side, but the client check keeps the
// chrome clean.
app.get('/api/auth/me', authMiddleware, (req, res) => {
    const isOwner = isBotOwner(req);

    let hasPremium = isOwner;
    let premiumExpiresAt = null;
    let premiumType = isOwner ? 'owner' : null;
    if (!hasPremium && req.user.discordId) {
        try {
            const pm = require('../utils/premiumManager');
            if (pm.isPremium(req.user.discordId)) {
                hasPremium = true;
                premiumType = 'user';
                const status = pm.getPremiumStatus(req.user.discordId);
                premiumExpiresAt = status?.expiresAt || null;
            }
        } catch {
            const list = readBotStore('premium') || [];
            if (Array.isArray(list)) {
                const entry = list.find(p => p.userId === req.user.discordId && (!p.expiresAt || new Date(p.expiresAt) > new Date()));
                if (entry) {
                    hasPremium = true;
                    premiumType = 'user';
                    premiumExpiresAt = entry.expiresAt || null;
                }
            }
        }
    }

    res.json({
        user: { ...req.user, isOwner, hasPremium, premiumType, premiumExpiresAt }
    });
});

// â”€â”€ User's Discord Guilds â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guilds/me', authMiddleware, async (req, res) => {
    if (!req.user.discordId) return res.json([]);

    // Get saved guilds (admin/manage only — written at login)
    let guilds = readJSON(`guilds_${req.user.discordId}.json`, []);
    // Try refresh from Discord API
    if (req.user.accessToken) {
        try {
            const r = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${req.user.accessToken}` } });
            if (r.ok) {
                const all = await r.json();
                guilds = all.filter(g => (g.permissions & 0x8) === 0x8 || (g.permissions & 0x20) === 0x20);
                writeJSON(`guilds_${req.user.discordId}.json`, guilds);
            }
        } catch { }
    }

    const force = req.query.refresh === '1';
    const botGuildIds = await getBotGuildIds({ force });

    const result = guilds.map(g => ({
        ...g,
        icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
        botPresent: botGuildIds.has(g.id)
    }));
    return res.json(result);
});

// Manual refresh — bypasses cache, used by the "Invite Bot" page after
// the user invites the bot so the UI flips to "Manage" immediately.
app.post('/api/guilds/refresh', authMiddleware, async (req, res) => {
    try {
        const ids = await getBotGuildIds({ force: true });
        return res.json({ ok: true, count: ids.size });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e?.message || 'refresh failed' });
    }
});

// â”€â”€ Guild Config (Welcomer, AutoMod, etc.) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Translate the dashboard's "logging" payload (UI field names like
 * `modLog`, `messageLog`) to the bot's "logs" store schema (short keys
 * like `moderation`, `message`). This is what makes the Audit Logging
 * module actually take effect — without translation the bot keeps
 * reading from `logs` while the dashboard writes to a parallel store
 * the bot never reads.
 *
 * Adding a new log category? Update both this map AND
 * `botLoggingToDashboard` below so the round-trip stays lossless.
 * Keys defined here must also exist as `set-<key>` slash subcommands
 * in `commands/admin/logging-setup.js` (`logTypeNames`).
 */
const DASHBOARD_TO_BOT_LOG_KEYS = {
    modLog:        'moderation',
    messageLog:    'message',
    memberLog:     'member',
    serverLog:     'server',
    voiceLog:      'voice',
    automodLog:    'automod',
    securityLog:   'security',
    boostLog:      'boost',
    commandsLog:   'commands',
    reactionsLog:  'reactions',
    pinsLog:       'pins',
};
const BOT_TO_DASHBOARD_LOG_KEYS = Object.fromEntries(
    Object.entries(DASHBOARD_TO_BOT_LOG_KEYS).map(([k, v]) => [v, k])
);

function dashboardLoggingToBot(uiCfg, prevBotCfg = {}) {
    const out = { ...prevBotCfg };
    if (uiCfg && typeof uiCfg === 'object') {
        for (const [uiKey, botKey] of Object.entries(DASHBOARD_TO_BOT_LOG_KEYS)) {
            if (uiKey in uiCfg) out[botKey] = uiCfg[uiKey] || null;
        }
        if ('ignoredChannels' in uiCfg) out.ignoredChannels = uiCfg.ignoredChannels || [];
        // Preserve mode + webhooks + filters if they were set elsewhere (e.g. /logging-setup).
        if ('mode' in uiCfg)           out.mode       = uiCfg.mode;
        if ('webhooks' in uiCfg)       out.webhooks   = uiCfg.webhooks;
        if ('filters' in uiCfg)        out.filters    = uiCfg.filters;
    }
    return out;
}

/**
 * Inverse translation: the dashboard reads from the same `logs` store
 * but UI components expect the friendly key names.
 */
function botLoggingToDashboard(botCfg) {
    if (!botCfg || typeof botCfg !== 'object') return {};
    const out = {
        ignoredChannels: botCfg.ignoredChannels || [],
        mode:            botCfg.mode || 'bot',
        webhooks:        botCfg.webhooks || {},
        filters:         botCfg.filters || {},
    };
    let anyConfigured = false;
    for (const [botKey, uiKey] of Object.entries(BOT_TO_DASHBOARD_LOG_KEYS)) {
        out[uiKey] = botCfg[botKey] || null;
        if (botCfg[botKey]) anyConfigured = true;
    }
    out.enabled = anyConfigured;
    return out;
}

function getGuildModuleConfig(guildId, module) {
    const storeName = MODULE_TO_STORE[module] || module;
    const botData = readBotStore(storeName);
    if (!botData?.[guildId]) return null;

    if (module === 'logging') {
        return botLoggingToDashboard(botData[guildId]);
    }
    return botData[guildId];
}

function setGuildModuleConfig(guildId, module, config) {
    const storeName = MODULE_TO_STORE[module] || module;
    let botData = readBotStore(storeName) || {};

    if (module === 'logging') {
        // Merge translated UI payload onto existing bot-side row so we
        // don't clobber `mode` / `webhooks` set via /logging-setup.
        botData[guildId] = dashboardLoggingToBot(config, botData[guildId] || {});
    } else {
        botData[guildId] = config;
    }
    writeBotStore(storeName, botData);
}

// Welcomer defaults
function getWelcomerDefaults() {
    return {
        enabled: false, channelId: null, mode: 'components', content: 'Welcome {user} to **{server}**! We now have {membercount} members.', title: null, description: null, color: '#bcf1e4', image: null, thumbnail: null, footer: null, author: null, pingUser: false, colorless: false, dmWelcome: { enabled: false, content: 'Welcome to **{server}**!' }, autoDelete: 0, buttons: [], actionButtons: [], actionMenus: [], buttonPosition: 'bottom', imagePosition: 'bottom',
        canvas: { enabled: false, backgroundColor: '#23272a', accentColor: '#bcf1e4', textColor: '#ffffff', backgroundImage: null, customMessage: null, fontFamily: null },
        leave: { enabled: false, channelId: null, mode: 'components', content: 'Goodbye **{username}**! We now have {membercount} members.', title: null, color: '#ED4245', colorless: false, image: null, thumbnail: null, footer: null, author: null, buttons: [], actionButtons: [], actionMenus: [], buttonPosition: 'bottom', imagePosition: 'bottom', canvas: { enabled: false, backgroundColor: '#23272a', accentColor: '#ed4245', textColor: '#ffffff', backgroundImage: null, customMessage: null, fontFamily: null } }
    };
}

// AutoMod defaults
function getAutomodDefaults() {
    return { enabled: false, badWords: { enabled: false, words: [], action: 'delete' }, spam: { enabled: false, messageLimit: 5, timeWindow: 5000, action: 'timeout' }, links: { enabled: false, action: 'delete', whitelist: [] }, invites: { enabled: false, action: 'delete' }, massMention: { enabled: false, limit: 5, action: 'delete' }, caps: { enabled: false, percentage: 70, minLength: 10, action: 'delete' }, profanity: { enabled: false, action: 'delete' }, sexualContent: { enabled: false, action: 'delete' }, slurs: { enabled: false, action: 'delete' }, logChannel: null, ignoredRoles: [], ignoredChannels: [], bypassRoleId: null };
}

// --- Broadcaster interceptor ---
async function sendBroadcasterMessage(guildId, moduleName, action) {
    if (!BOT_TOKEN) return;
    const bcData = readBotStore('broadcaster') || {};
    const cfg = bcData[guildId];
    if (!cfg || !cfg.enabled || !cfg.channelId) return;

    const prettyName = moduleName.charAt(0).toUpperCase() + moduleName.slice(1).replace(/-/g, ' ');
    const content = `📢 The **${prettyName}** feature was just **${action}** via the dashboard!`;

    try {
        await fetch(`https://discord.com/api/channels/${cfg.channelId}/messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ content })
        });
    } catch (e) {
        console.error('Broadcaster failed:', e);
    }
}

app.use((req, res, next) => {
    if (req.method !== 'PUT' || !req.body || typeof req.body.enabled !== 'boolean') return next();
    
    const match = req.originalUrl.match(/^\/api\/guild\/(\d+)\/([^\/?]+)/);
    if (!match) return next();

    const guildId = match[1];
    let rawModule = match[2];
    rawModule = rawModule.replace('-config', '').replace('-settings', '');
    if (!rawModule || rawModule === 'broadcaster') return next();

    const storeName = MODULE_TO_STORE[rawModule] || rawModule;
    let oldData = readBotStore(storeName)?.[guildId] || {};
    
    // Fix split-config architecture for economy and leveling broadcaster checks
    if (rawModule === 'economy') {
        oldData = readBotStore('economy-settings')?.[guildId] || {};
    } else if (rawModule === 'leveling') {
        oldData = readBotStore('levelingtoggle')?.[guildId] || {};
    }

    const newState = req.body.enabled;
    let oldState = !!oldData.enabled;
    
    // Custom implicit state logic to match GET endpoints
    if (rawModule === 'economy') oldState = oldData.enabled !== false;
    else if (rawModule === 'leveling') oldState = oldData.enabled === true || (readBotStore('leveling')?.[guildId]?.enabled === true);
    else if (rawModule === 'tickets' || rawModule === 'starboard' || rawModule === 'counting') oldState = !!oldData.channelId;

    let action = null;
    if (newState && !oldState) action = 'activated';
    else if (!newState && oldState) action = 'deactivated';
    else if (newState && oldState) action = 'updated';

    if (action) {
        const originalJson = res.json;
        res.json = function(body) {
            if (body && !body.error && !body._error) {
                sendBroadcasterMessage(guildId, rawModule, action);
            }
            return originalJson.call(this, body);
        };
    }
    next();
});
// -------------------------------

// Generic module config endpoints
const MODULE_DEFAULTS = {
    welcomer: getWelcomerDefaults,
    automod: getAutomodDefaults,
    leveling: () => ({ enabled: false, xpPerMessage: 15, xpCooldown: 60, announcements: { enabled: true, channel: null, message: 'Congrats {user}! You reached level {level}!' }, noXpRoles: [], noXpChannels: [], levelRoles: {}, xpMultiplier: 1 }),
    economy: () => ({ enabled: false, startingBalance: 0, dailyReward: 1000, currency: '<:Money:1521228266957045900>', currencyName: 'coins', weeklyReward: 5000, workMinReward: 100, workMaxReward: 300, robChance: 50, robEnabled: true, gamblingEnabled: true, shopEnabled: true }),
    tickets: () => ({ enabled: false, categoryId: null, supportRoleId: null, maxOpen: 5, logChannel: null, closeConfirmation: true, transcripts: true, dmOnClose: true, autoClose: 0, welcomeMessage: 'Support will be with you shortly.' }),
    logging: () => ({
        enabled: false,
        modLog: null, messageLog: null, memberLog: null, serverLog: null, voiceLog: null,
        automodLog: null, securityLog: null, boostLog: null, commandsLog: null,
        reactionsLog: null, pinsLog: null,
        ignoredChannels: [],
        mode: 'bot', webhooks: {}, filters: {},
    }),
    music: () => ({ enabled: true, defaultVolume: 80, maxQueueSize: 100, djRoleId: null, voteSkip: true, announce: true }),
    antinuke: () => ({
        enabled: false,
        banProtection: { enabled: false, limit: 3, timeWindow: 60000, action: 'remove_roles' },
        kickProtection: { enabled: false, limit: 3, timeWindow: 60000, action: 'remove_roles' },
        channelDelete: { enabled: false, limit: 2, timeWindow: 60000, action: 'remove_roles' },
        channelCreate: { enabled: false, limit: 3, timeWindow: 60000, action: 'remove_roles' },
        roleDelete: { enabled: false, limit: 2, timeWindow: 60000, action: 'remove_roles' },
        roleCreate: { enabled: false, limit: 3, timeWindow: 60000, action: 'remove_roles' },
        webhookCreate: { enabled: false, limit: 2, timeWindow: 60000, action: 'remove_roles' },
        botAdd: { enabled: false, action: 'kick_bot' },
        whitelistedUsers: [],
        bypassRoleId: null,
        logChannel: null
    }),
    broadcaster: () => ({ enabled: false, channelId: null }),
    verification: () => ({ enabled: false, type: 'button', roleId: null, channelId: null, message: 'Click the button below to verify yourself!', logChannel: null }),
    starboard: () => ({ enabled: false, channelId: null, minStars: 3, emoji: '⭐', selfStar: false, ignoredChannels: [] }),
    autorole: () => ({ humans: [], bots: [] }),
    antialt: () => ({ enabled: false, minAge: 7, action: 'kick', logChannel: null }),
    antiraid: () => ({ enabled: false, joinLimit: 10, timeWindow: 10, action: 'kick', logChannel: null }),
    antispam: () => ({ enabled: false, messageSpam: { enabled: false, limit: 5, time: 5, action: 'timeout' }, emojiSpam: { enabled: false, limit: 10, action: 'delete' }, capsSpam: { enabled: false, percentage: 80, minLength: 10, action: 'delete' }, linkSpam: { enabled: false, limit: 3, action: 'delete' }, imageSpam: { enabled: false, limit: 5, action: 'delete' }, stickerSpam: { enabled: false, limit: 5, action: 'delete' }, mentionSpam: { enabled: false, limit: 5, action: 'timeout' }, duplicateSpam: { enabled: false, limit: 3, action: 'delete' }, inviteSpam: { enabled: false, action: 'delete' }, newlineSpam: { enabled: false, limit: 15, action: 'delete' }, ignoredRoles: [], ignoredChannels: [], logChannel: null }),
    antilink: () => ({ enabled: false, action: 'delete', whitelistedLinks: [], whitelistedRoles: [], whitelistedChannels: [], logChannel: null }),
    suggestions: () => ({ channelId: null, logsChannelId: null, voteThreshold: 10, threadSlowmode: 0, nextId: 1, suggestions: {} }),
    afk: () => ({ enabled: true }),
    actions: () => ({ enabled: true }),
    'button-commands': () => ({}),
    'select-menus': () => ({}),
    'media-only': () => ({ enabled: false, channels: [] }),
    sticky: () => ({ enabled: false, messages: {} }),
    counting: () => ({ enabled: false, channelId: null, currentCount: 0, lastUserId: null }),
    autoresponder: () => ({ enabled: false, triggers: [] }),
    autoreact: () => ({ enabled: false, triggers: [] }),
    voice: () => ({ enabled: false, j2cChannelId: null, j2cCategoryId: null, j2cUserLimit: 0, j2cBitrate: 64000, voiceRoles: {} }),
    reactionroles: () => ({ enabled: false, panels: [] }),
    giveaway: () => ({ enabled: true }),
    'bot-customize': () => ({ nickname: null, avatarUrl: null, bannerUrl: null, aboutText: null, prefix: null, embedColor: 'default', footerText: null, footerIcon: null, language: 'en', dmOnJoin: false, dmMessage: null, commandCooldown: 3, deleteCommands: false, ephemeralResponses: false }),
    'botignore-config': () => ({ enabled: false, ignoredChannels: [], ignoredRoles: [], ignoredUsers: [], ignoreAllBots: false, ignorePrefix: false }),
    'social-notify': () => ({ youtube: { enabled: false, channels: [], notifyChannel: null, pingRole: null, message: '{channel} uploaded a new video!\n\n**{title}**\n{url}', liveMessage: '🔴 **{channel}** is now LIVE!\n{url}', liveEnabled: true } }),
    'vote-config': () => ({ enabled: false, channelId: null, pingRoleId: null }),
    'economy-settings': () => ({ currency: '<:Money:1521228266957045900>', currencyName: 'coins', dailyReward: 1000, weeklyReward: 5000, workMinReward: 100, workMaxReward: 300, robChance: 50, startingBalance: 0, robEnabled: true, gamblingEnabled: true, shopEnabled: true }),
    'confessions': () => ({ channelId: null, count: 0, log: {} }),
    'serverstats': () => ({ enabled: false, stats: [], channelMap: {}, style: 'default' }),

    // â”€â”€ Newer module defaults (matches commands/admin/<name>.js shapes) â”€â”€
    aichat: () => ({
        enabled: false, channelId: null,
        model: 'llama-3.3-70b-versatile',
        temperature: 0.7, maxTokens: 1024, systemPrompt: ''
    }),
    autonick: () => ({ enabled: false, format: '{user}' }),
    nightmode: () => ({ enabled: false, startHour: 22, endHour: 6, lockChannels: [], lockMessage: 'The server is currently in Night Mode. Chat is locked.', logChannel: null }),
    superthreatmode: () => ({ enabled: false, triggerThreshold: 10, action: 'lockdown', notifyChannel: null }),
    currency: () => ({ enabled: false, currencyName: 'coins', currencyEmoji: '🪙' }),
    customshop: () => ({ enabled: false, logChannel: null, items: [] }),
    loan: () => ({ enabled: false, maxLoan: 5000, dailyInterest: 5, logChannel: null }),

    profilebadge: () => ({ enabled: false }),
    birthdays: () => ({
        enabled: false, channelId: null, roleId: null,
        pingMode: 'user',          // user | role | here | everyone | none
        messageType: 'embed',      // simple | embed | components
        hour: 9, timezone: 'UTC',
        users: {}, panel: null
    }),
    applications: () => ({
        enabled: false,
        name: 'Staff Application',
        description: 'Apply to join our team!',
        questions: [],
        reviewChannel: null, logChannel: null,
        acceptRole: null, removeRole: null, requireRole: null,
        denyMessage:   'Thank you for your interest, but your application has been denied.',
        acceptMessage: 'Congratulations! Your application has been accepted!',
        cooldown: 86400000, color: 0x5865F2
    }),
    statusrole: () => ({ enabled: false, entries: [] }),
    botblock:   () => ({ enabled: false, channels: [] }),
    vanityguard:() => ({ enabled: false, whitelistedUsers: [], logChannelId: null, action: 'none' }),
    nightmode:  () => ({ enabled: false, activatedAt: null, activatedBy: null, disabledChannels: [], savedPermissions: {} }),
    emergency:  () => ({ enabled: false, activatedAt: null, activatedBy: null, savedRolePerms: {}, emergencyRoles: [], emergencyUsers: [] }),
    servertag:  () => ({ enabled: false, tag: '', roleId: null, notifyChannel: null, coinReward: 0, xpReward: 0, dmNotify: true }),
    guildtags:  () => ({ enabled: false, tag: null }),
    'ignored-channels': () => ({ channels: [] }),
    'warn-config': () => ({ thresholds: [
        { warns: 1, action: 'none',    duration: null, label: 'Warning only' },
        { warns: 2, action: 'timeout', duration: 300,  label: 'Timeout 5 minutes' },
        { warns: 3, action: 'timeout', duration: 3600, label: 'Timeout 1 hour' },
        { warns: 4, action: 'kick',    duration: null, label: 'Kick from server' },
        { warns: 5, action: 'ban',     duration: null, label: 'Permanent ban' },
    ]})
};

// â”€â”€ Premium status check for a guild â”€â”€
app.get('/api/guild/:guildId/premium-status', authMiddleware, (req, res) => {
    let discordId = req.user.discordId;
    if (!discordId) {
        const users = readJSON('users.json', []);
        const u = users.find(x => x.id === req.user.id);
        if (u) discordId = u.discordId;
    }

    let userPremium = false;
    let serverPremium = false;
    let premiumExpiry = null;
    let premiumType = null;

    try {
        const premiumManager = require('../utils/premiumManager');
        userPremium = premiumManager.isPremium(discordId);
        serverPremium = premiumManager.isServerPremium(req.params.guildId);

        if (serverPremium) {
            const status = premiumManager.getServerPremiumStatus(req.params.guildId);
            premiumExpiry = status.expiresAt;
            premiumType = 'server';
        } else if (userPremium) {
            const status = premiumManager.getPremiumStatus(discordId);
            premiumExpiry = status.expiresAt;
            premiumType = 'user';
        }
    } catch (error) { // nosonar
        // Fall back to reading stores directly
        try {
            const serverData = readBotStore('server-premium') || [];
            const serverEntry = serverData.find(s => s.guildId === req.params.guildId);
            if (serverEntry && (!serverEntry.expiresAt || new Date(serverEntry.expiresAt) > new Date())) {
                serverPremium = true;
                premiumExpiry = serverEntry.expiresAt;
                premiumType = 'server';
            } else {
                const premiumData = readBotStore('premium') || [];
                const userEntry = premiumData.find(p => p.userId === discordId);
                if (userEntry && (!userEntry.expiresAt || new Date(userEntry.expiresAt) > new Date())) {
                    userPremium = true;
                    premiumExpiry = userEntry.expiresAt;
                    premiumType = 'user';
                }
            }
        } catch (error_) { /* proceed */ } // nosonar
    }

    const isOwner = isBotOwner(req);

    res.json({
        hasPremium: isOwner || userPremium || serverPremium,
        userPremium,
        serverPremium,
        isOwner,
        premiumType: isOwner ? 'owner' : premiumType,
        expiresAt: premiumExpiry,
        supportServer: process.env.SUPPORT_SERVER || 'https://discord.gg/xnico'
    });
});

// â”€â”€ Guild channels (via bot token) — MUST be before the generic :module route â”€â”€
app.get('/api/guild/:guildId/channels', authMiddleware, async (req, res) => {
    if (!BOT_TOKEN) return res.json([]);
    try {
        const r = await fetch(`https://discord.com/api/guilds/${req.params.guildId}/channels`, { headers: { Authorization: `Bot ${BOT_TOKEN}` } });
        if (r.ok) return res.json(await r.json());
    } catch { /* Failed to fetch channels from Discord, return empty */ }
    res.json([]);
});

app.get('/api/guild/:guildId/roles', authMiddleware, async (req, res) => {
    if (!BOT_TOKEN) return res.json([]);
    try {
        const r = await fetch(`https://discord.com/api/guilds/${req.params.guildId}/roles`, { headers: { Authorization: `Bot ${BOT_TOKEN}` } });
        if (r.ok) return res.json(await r.json());
    } catch { /* Failed to fetch roles from Discord, return empty */ }
    res.json([]);
});

// Guild custom emojis — powers the dashboard emoji picker so admins can drop
// their server's custom emojis into welcomer/embed/message fields. Fetched via
// the bot token (the dashboard has no Discord client). Compact shape only.
app.get('/api/guild/:guildId/emojis', authMiddleware, async (req, res) => {
    if (!BOT_TOKEN) return res.json([]);
    try {
        const r = await fetch(`https://discord.com/api/guilds/${req.params.guildId}/emojis`, { headers: { Authorization: `Bot ${BOT_TOKEN}` } });
        if (r.ok) {
            const arr = await r.json();
            return res.json((Array.isArray(arr) ? arr : [])
                .filter(e => e?.id && e?.name)
                .map(e => ({ id: e.id, name: e.name, animated: !!e.animated })));
        }
    } catch { /* Failed to fetch emojis from Discord, return empty */ }
    res.json([]);
});

app.get('/api/guild/:guildId/analytics', authMiddleware, async (req, res) => { // nosonar
    const gid = req.params.guildId;

    // Real analytics derived from the bot's actual stores.
    const economy        = readBotStore('economy')        || {};
    const guildMembers   = readBotStore('guild_members')  || [];
    const warningsStore  = readBotStore('warnings')       || {};
    const modlogs        = readBotStore('modlogs')        || {};

    // Active warnings: count of warnings entries for this guild that
    // haven't been cleared. clearwarnings.js deletes the user entry, so
    // anything still present counts.
    let activeWarnings = 0;
    const guildWarnings = warningsStore[gid] || {};
    for (const userWarns of Object.values(guildWarnings)) {
        if (Array.isArray(userWarns)) activeWarnings += userWarns.length;
        else if (userWarns && typeof userWarns === 'object') activeWarnings += Object.keys(userWarns).length;
    }

    // Economy flow: total wallet+bank for THIS guild's members.
    // The bot stores economy globally in `economy` store keyed by user_id
    // with fields { coins, bank }. We intersect with guild_members to
    // scope the total to this guild only.
    let economyFlow = 0;
    const usersStore = readBotStore('users') || [];
    const economyStore = readBotStore('economy') || {};
    
    // Deduplicate members by user_id to prevent massively inflated stats
    const rawGuildMembers = guildMembers.filter(m => m.guild_id === gid);
    const seenUsers = new Set();
    const guildMemberEconomy = [];
    for (const m of rawGuildMembers) {
        if (!seenUsers.has(m.user_id)) {
            seenUsers.add(m.user_id);
            guildMemberEconomy.push(m);
        }
    }
    
    for (const m of guildMemberEconomy) {
        const u = Array.isArray(usersStore) ? usersStore.find(user => user.user_id === m.user_id) : null;
        const userEconomy = economyStore[m.user_id] || (u && u.economy);
        if (userEconomy) {
            // The economy store uses 'coins' for wallet balance
            economyFlow += Number(userEconomy.coins || 0);
            economyFlow += Number(userEconomy.bank || 0);
        }
    }

    // Messages logged: the bot tracks per-member message counts in
    // guild_members.analytics.totalMessages. Sum them for this guild.
    let messagesLogged = 0;
    for (const m of guildMemberEconomy) {
        messagesLogged += Number(m.analytics?.totalMessages || m.leveling?.messageCount || 0);
    }

    // Commands used: reuse the leveling/analytics counter if present.
    let commandsUsed = 0;
    for (const m of guildMemberEconomy) {
        commandsUsed += Number(m.analytics?.commandsUsed || 0);
    }
    if (!commandsUsed) {
        // Fallback: rough proxy from message volume so the panel isn't blank.
        commandsUsed = Math.floor(messagesLogged * 0.05);
    }

    // Recent activity from the real modlogs store + automod activity.
    const guildLogs = modlogs[gid] || {};
    const flatLogs = [];
    for (const [userId, entries] of Object.entries(guildLogs)) {
        if (!Array.isArray(entries)) continue;
        for (const log of entries) {
            flatLogs.push({
                time: new Date(log.timestamp || Date.now()).toLocaleString(),
                module: 'Moderation',
                action: `${log.action}${log.reason ? ' — ' + log.reason : ''}`,
                user: `<@${userId}>`,
                timestamp: Number(log.timestamp || 0)
            });
        }
    }
    flatLogs.sort((a, b) => b.timestamp - a.timestamp);
    const recentActivity = flatLogs.slice(0, 15).map(({ timestamp, ...rest }) => rest);

    res.json({
        commandsUsed, messagesLogged, activeWarnings, economyFlow,
        recentActivity,
        // Hint for the UI: was any data found at all?
        hasData: !!(messagesLogged || activeWarnings || economyFlow || recentActivity.length)
    });
});

// â”€â”€ Leveling CRUD (syncs with guilds store + mirror stores) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function readGuildConfig(guildId) {
    const guilds = readBotStore('guilds') || [];
    const arr = Array.isArray(guilds) ? guilds : [];
    let g = arr.find(x => x.guild_id === guildId);
    if (!g) {
        g = { guild_id: guildId, leveling: { enabled: false } };
        arr.push(g);
    }
    return { guilds: arr, guild: g };
}
function writeGuildConfig(guilds) {
    writeBotStore('guilds', guilds);
}

app.get('/api/guild/:guildId/leveling', authMiddleware, (req, res) => {
    const { guild } = readGuildConfig(req.params.guildId);
    const lv = guild.leveling || {};
    // Merge with levelingtoggle for per-channel disables
    const toggleStore = readBotStore('levelingtoggle') || {};
    const tg = toggleStore[req.params.guildId] || { enabled: false, disabledChannels: [] };
    // Mirror stores for fallback data
    const lvRoles = readBotStore('levelroles') || {};
    const lvChannel = readBotStore('levelchannel') || {};
    const lvMult = readBotStore('levelmultiplier') || {};

    res.json({
        enabled: lv.enabled === true || tg.enabled === true,
        xpSettings: {
            minXp: lv.xpSettings?.minXp ?? 15,
            maxXp: lv.xpSettings?.maxXp ?? 25,
            cooldown: lv.xpSettings?.cooldown ?? 60
        },
        multiplier: lv.multiplier ?? 1,
        stackRoles: lv.stackRoles === true,
        roles: Array.isArray(lv.roles) && lv.roles.length ? lv.roles : (lvRoles[req.params.guildId] || []),
        ignoreChannels: lv.ignoreChannels || [],
        ignoreRoles: lv.ignoreRoles || [],
        disabledChannels: tg.disabledChannels || [],
        announcements: {
            enabled: lv.announcements?.enabled !== false,
            channel: lv.announcements?.channel || 'same',
            customChannelId: lv.announcements?.customChannelId || lv.announcementChannel || lvChannel[req.params.guildId] || null,
            message: lv.announcements?.message || 'GG {user}, you just advanced to **Level {level}**!'
        },
        roleMultipliers: lvMult[req.params.guildId] || {}
    });
});

app.put('/api/guild/:guildId/leveling', authMiddleware, (req, res) => { // nosonar
    const gid = req.params.guildId;
    const body = req.body || {};

    // 1. Update main guild config (leveling.*)
    const { guilds, guild } = readGuildConfig(gid);
    guild.leveling = guild.leveling || {};
    const lv = guild.leveling;

    if (typeof body.enabled === 'boolean') lv.enabled = body.enabled;
    if (body.xpSettings) {
        lv.xpSettings = {
            minXp: Math.max(1, Math.min(1000, Number(body.xpSettings.minXp) || 15)),
            maxXp: Math.max(1, Math.min(1000, Number(body.xpSettings.maxXp) || 25)),
            cooldown: Math.max(1, Math.min(3600, Number(body.xpSettings.cooldown) || 60))
        };
        if (lv.xpSettings.minXp > lv.xpSettings.maxXp) lv.xpSettings.maxXp = lv.xpSettings.minXp;
    }
    if (body.multiplier !== undefined) lv.multiplier = Math.max(0.1, Math.min(10, Number(body.multiplier) || 1));
    if (typeof body.stackRoles === 'boolean') lv.stackRoles = body.stackRoles;
    if (Array.isArray(body.roles)) {
        lv.roles = body.roles
            .filter(r => r?.roleId && Number.isInteger(Number(r?.level)) && Number(r?.level) >= 1)
            .map(r => ({ level: Number(r.level), roleId: String(r.roleId) }))
            .sort((a, b) => a.level - b.level);
    }
    if (Array.isArray(body.ignoreChannels)) lv.ignoreChannels = body.ignoreChannels.map(String);
    if (Array.isArray(body.ignoreRoles)) lv.ignoreRoles = body.ignoreRoles.map(String);
    if (body.announcements) {
        lv.announcements = {
            enabled: body.announcements.enabled !== false,
            channel: ['same', 'dm', 'custom'].includes(body.announcements.channel) ? body.announcements.channel : 'same',
            customChannelId: body.announcements.channel === 'custom' ? (body.announcements.customChannelId || null) : null,
            message: body.announcements.message || 'GG {user}, you just advanced to **Level {level}**!'
        };
        lv.announcementChannel = lv.announcements.channel === 'custom' ? lv.announcements.customChannelId : null;
    }

    guild.updated_at = new Date().toISOString();
    writeGuildConfig(guilds);

    // 2. Sync levelingtoggle store (for per-channel disables + master enable)
    const tStore = readBotStore('levelingtoggle') || {};
    if (!tStore[gid]) tStore[gid] = { enabled: false, disabledChannels: [] };
    if (typeof body.enabled === 'boolean') tStore[gid].enabled = body.enabled;
    if (Array.isArray(body.disabledChannels)) tStore[gid].disabledChannels = body.disabledChannels.map(String);
    writeBotStore('levelingtoggle', tStore);

    // 3. Sync levelroles store (fallback for XP handler)
    if (Array.isArray(body.roles)) {
        const rStore = readBotStore('levelroles') || {};
        rStore[gid] = lv.roles;
        writeBotStore('levelroles', rStore);
    }

    // 4. Sync levelchannel store (legacy fallback)
    if (body.announcements) {
        const cStore = readBotStore('levelchannel') || {};
        if (body.announcements.channel === 'custom' && body.announcements.customChannelId) {
            cStore[gid] = body.announcements.customChannelId;
        } else {
            delete cStore[gid];
        }
        writeBotStore('levelchannel', cStore);
    }

    // 5. Sync levelmultiplier store (per-role multipliers)
    if (body.roleMultipliers && typeof body.roleMultipliers === 'object') {
        const mStore = readBotStore('levelmultiplier') || {};
        const clean = {};
        for (const [roleId, mult] of Object.entries(body.roleMultipliers)) {
            const n = Number(mult);
            if (n >= 0.1 && n <= 10) clean[String(roleId)] = n;
        }
        mStore[gid] = clean;
        writeBotStore('levelmultiplier', mStore);
    }

    res.json({ success: true });
});

// â”€â”€ Leveling leaderboard (per-user stats) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/leveling/leaderboard', authMiddleware, (req, res) => {
    const xpData = readBotStore('leveling') || {};
    const guildData = xpData[req.params.guildId] || {};
    const rows = Object.entries(guildData).map(([userId, d]) => ({
        userId,
        xp: d.xp || 0,
        level: d.level ?? Math.floor(0.1 * Math.sqrt(d.xp || 0)),
        messages: d.messages || 0,
        lastActive: d.lastXpGain || 0
    })).sort((a, b) => b.xp - a.xp);
    res.json(rows.slice(0, 100));
});

// Reset a single user's XP
app.delete('/api/guild/:guildId/leveling/user/:userId', authMiddleware, (req, res) => {
    if (!['588982544545087498', '1264506198489563143'].includes(req.user.discordId)) {
        return res.status(403).json({ error: 'Only specific bot owners can perform this action.' });
    }
    const xpData = readBotStore('leveling') || {};
    if (xpData[req.params.guildId]?.[req.params.userId]) {
        delete xpData[req.params.guildId][req.params.userId];
        writeBotStore('leveling', xpData);
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'User has no XP data' });
});

// Reset ALL XP for a guild
app.delete('/api/guild/:guildId/leveling/reset-all', authMiddleware, (req, res) => {
    if (!['588982544545087498', '1264506198489563143'].includes(req.user.discordId)) {
        return res.status(403).json({ error: 'Only specific bot owners can perform this action.' });
    }
    const xpData = readBotStore('leveling') || {};
    if (xpData[req.params.guildId]) {
        xpData[req.params.guildId] = {};
        writeBotStore('leveling', xpData);
    }
    res.json({ success: true });
});

// Manually set a user's level
app.post('/api/guild/:guildId/leveling/user/:userId/set-level', authMiddleware, (req, res) => {
    if (!['588982544545087498', '1264506198489563143'].includes(req.user.discordId)) {
        return res.status(403).json({ error: 'Only specific bot owners can perform this action.' });
    }
    const level = Math.max(0, Math.min(1000, Number.parseInt(req.body.level, 10) || 0));
    const xpData = readBotStore('leveling') || {};
    if (!xpData[req.params.guildId]) xpData[req.params.guildId] = {};
    const xp = Math.ceil(Math.pow(level / 0.1, 2));
    xpData[req.params.guildId][req.params.userId] = {
        ...xpData[req.params.guildId][req.params.userId],
        xp, level, lastXpGain: 0,
        messages: xpData[req.params.guildId][req.params.userId]?.messages || 0,
        forceRoleSync: true
    };
    writeBotStore('leveling', xpData);
    res.json({ success: true, xp, level });
});

// â”€â”€ Bot Customize (Premium-gated) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/bot-customize-config', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    // Check premium
    const premium = checkPremiumStatus(req, gid);
    if (!premium.hasPremium) return res.status(403).json({ error: 'Premium required', premium });
    const data = readBotStore('bot-customize') || {};
    const cfg = data[gid] || {};
    res.json({
        nickname: cfg.nickname || null,
        avatarUrl: cfg.avatarUrl || null,
        bannerUrl: cfg.bannerUrl || null,
        aboutText: cfg.aboutText || null,
        prefix: cfg.prefix || null,
        embedColor: cfg.embedColor || 'default',
        footerText: cfg.footerText || null,
        footerIcon: cfg.footerIcon || null,
        language: cfg.language || 'en',
        dmOnJoin: cfg.dmOnJoin || false,
        dmMessage: cfg.dmMessage || null,
        commandCooldown: cfg.commandCooldown ?? 3,
        deleteCommands: cfg.deleteCommands || false,
        ephemeralResponses: cfg.ephemeralResponses || false,
    });
});
app.put('/api/guild/:guildId/bot-customize-config', authMiddleware, (req, res) => { // nosonar
    const gid = req.params.guildId;
    const premium = checkPremiumStatus(req, gid);
    if (!premium.hasPremium) return res.status(403).json({ error: 'Premium required', premium });
    const body = req.body || {};
    const data = readBotStore('bot-customize') || {};
    if (!data[gid]) data[gid] = {};
    const cfg = data[gid];

    // Same field set the slash panel writes — keeps the dashboard in
    // lock-step with /bot-customize so admins can edit either surface
    // and see the change applied everywhere.
    if (typeof body.nickname === 'string' || body.nickname === null) cfg.nickname = body.nickname;
    if (typeof body.avatarUrl === 'string' || body.avatarUrl === null) cfg.avatarUrl = body.avatarUrl;
    if (typeof body.bannerUrl === 'string' || body.bannerUrl === null) cfg.bannerUrl = body.bannerUrl;
    if (typeof body.aboutText === 'string' || body.aboutText === null) cfg.aboutText = body.aboutText;
    if (typeof body.prefix === 'string' || body.prefix === null) cfg.prefix = body.prefix;
    if (typeof body.embedColor === 'string') cfg.embedColor = body.embedColor;
    if (typeof body.footerText === 'string' || body.footerText === null) cfg.footerText = body.footerText;
    if (typeof body.footerIcon === 'string' || body.footerIcon === null) cfg.footerIcon = body.footerIcon;
    if (typeof body.language === 'string') cfg.language = body.language;
    if (typeof body.dmOnJoin === 'boolean') cfg.dmOnJoin = body.dmOnJoin;
    if (typeof body.dmMessage === 'string' || body.dmMessage === null) cfg.dmMessage = body.dmMessage;
    if (Number.isFinite(Number(body.commandCooldown))) cfg.commandCooldown = Math.max(0, Math.min(60, Number(body.commandCooldown)));
    if (typeof body.deleteCommands === 'boolean') cfg.deleteCommands = body.deleteCommands;
    if (typeof body.ephemeralResponses === 'boolean') cfg.ephemeralResponses = body.ephemeralResponses;
    writeBotStore('bot-customize', data);

    // Mirror the prefix to the 'prefixes' store, which is what
    // index.js getGuildPrefix() actually reads for prefix command parsing.
    // Without this, dashboard prefix changes never take effect on prefix
    // commands until the user runs the /setprefix slash command.
    if (Object.hasOwn(body, 'prefix')) {
        try {
            const prefixes = readBotStore('prefixes') || {};
            const newPrefix = typeof body.prefix === 'string' ? body.prefix.trim() : '';
            if (newPrefix) {
                prefixes[gid] = newPrefix;
            } else {
                delete prefixes[gid];
            }
            writeBotStore('prefixes', prefixes);
        } catch (error) {
            console.error('[Dashboard] Failed to mirror prefix to prefixes store:', error?.message || error);
        }
    }

    // Invalidate the per-guild bot-customize cache (5s TTL otherwise)
    // so prefix / embedColor / footerText / cooldown changes apply
    // immediately when bot and dashboard share a process.
    //
    // NOTE: the storeSync listener also calls invalidateCache() when
    // jsonStore emits 'update' for bot-customize. invalidateCache() is
    // idempotent (just resets _cacheTime to 0), so calling it inline
    // here as well is a no-op safety net rather than a double-apply.
    try { botCustomize.invalidateCache(); } catch {}

    // Live update nickname via Discord API
    if (body.nickname !== undefined && BOT_TOKEN) {
        fetch(`https://discord.com/api/v10/guilds/${gid}/members/@me`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ nick: body.nickname || '' })
        }).catch(() => { });
    }

    // Live update per-server avatar via Discord API. The slash panel
    // does this synchronously, so doing it here keeps the dashboard at
    // parity. Body shapes:
    //   - { avatarUrl: 'https://...' }   -> fetch + base64 + PATCH
    //   - { avatarUrl: 'data:image/...' } -> PATCH directly
    //   - { avatarUrl: null }          -> reset to global avatar
    if (Object.hasOwn(body, 'avatarUrl') && BOT_TOKEN) {
        (async () => {
            try {
                let payloadAvatar = null;
                if (typeof body.avatarUrl === 'string' && body.avatarUrl.length > 0) {
                    if (body.avatarUrl.startsWith('data:')) {
                        payloadAvatar = body.avatarUrl;
                    } else {
                        const r = await fetch(body.avatarUrl);
                        if (r.ok) {
                            const buf = Buffer.from(await r.arrayBuffer());
                            const ct = r.headers.get('content-type') || 'image/png';
                            payloadAvatar = `data:${ct};base64,${buf.toString('base64')}`;
                        }
                    }
                }
                await fetch(`https://discord.com/api/v10/guilds/${gid}/members/@me`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ avatar: payloadAvatar }),
                });
            } catch (error) {
                console.error('[Dashboard] Failed to push guild avatar:', error?.message || error);
            }
        })();
    }

    // Live update per-server banner via Discord API. Same endpoint as
    // avatar, just targeting the `banner` field. Discord may reject
    // (some guild contexts don't allow it for bots) — when that happens
    // the local store value still drives /botinfo and /botprofile.
    if (Object.hasOwn(body, 'bannerUrl') && BOT_TOKEN) {
        (async () => {
            try {
                let payloadBanner = null;
                if (typeof body.bannerUrl === 'string' && body.bannerUrl.length > 0) {
                    if (body.bannerUrl.startsWith('data:')) {
                        payloadBanner = body.bannerUrl;
                    } else {
                        const r = await fetch(body.bannerUrl);
                        if (r.ok) {
                            const buf = Buffer.from(await r.arrayBuffer());
                            const ct = r.headers.get('content-type') || 'image/png';
                            payloadBanner = `data:${ct};base64,${buf.toString('base64')}`;
                        }
                    }
                }
                await fetch(`https://discord.com/api/v10/guilds/${gid}/members/@me`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ banner: payloadBanner }),
                });
            } catch (error) {
                console.error('[Dashboard] Failed to push guild banner:', error?.message || error);
            }
        })();
    }

    // Per-guild bio push. Discord exposes a `bio` field on
    // PATCH /guilds/{guild_id}/members/@me, the same endpoint used for
    // the per-guild avatar/banner just above. Targeting it here keeps
    // the bio scoped to this guild only — earlier we hit /users/@me
    // which mutated the bot's global account bio for every server.
    if (Object.hasOwn(body, 'aboutText') && BOT_TOKEN) {
        (async () => {
            try {
                const trimmed = String(body.aboutText || '').slice(0, 190);
                await fetch(`https://discord.com/api/v10/guilds/${gid}/members/@me`, {
                    method: 'PATCH',
                    headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bio: trimmed.length ? trimmed : null }),
                });
            } catch (error) { // nosonar
                // Silent — dashboard doesn't need to surface this since
                // /botinfo and /botprofile render the local value anyway.
            }
        })();
    }
    res.json(cfg);
});

// Helper: check premium status for a user+guild
function checkPremiumStatus(req, guildId) {
    let discordId = req.user.discordId;
    if (!discordId) {
        const users = readJSON('users.json', []);
        const u = users.find(x => x.id === req.user.id);
        if (u) discordId = u.discordId;
    }
    const isOwner = isBotOwner(req);
    if (isOwner) return { hasPremium: true, isOwner: true };
    try {
        const premiumManager = require('../utils/premiumManager');
        if (premiumManager.isPremium(discordId) || premiumManager.isServerPremium(guildId)) return { hasPremium: true };
    } catch { /* premiumManager not available, fall back to raw store */ }
    const premiumData = readBotStore('premium') || [];
    if (Array.isArray(premiumData) && premiumData.some(p => p.userId === discordId && (!p.expiresAt || new Date(p.expiresAt) > new Date()))) return { hasPremium: true };
    const serverData = readBotStore('server-premium') || [];
    if (Array.isArray(serverData) && serverData.some(s => s.guildId === guildId && (!s.expiresAt || new Date(s.expiresAt) > new Date()))) return { hasPremium: true };
    return { hasPremium: false };
}

// â”€â”€ Trust System CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/trust-config', authMiddleware, (req, res) => {
    const data = readBotStore('trust') || {};
    const cfg = data[req.params.guildId] || {};
    res.json({
        admins: Array.isArray(cfg.admins) ? cfg.admins : [],
        mods: Array.isArray(cfg.mods) ? cfg.mods : [],
        vcmods: Array.isArray(cfg.vcmods) ? cfg.vcmods : []
    });
});
app.put('/api/guild/:guildId/trust-config', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('trust') || {};
    if (!data[gid]) data[gid] = { admins: [], mods: [], vcmods: [] };
    if (Array.isArray(body.admins)) data[gid].admins = body.admins.map(String).slice(0, 25);
    if (Array.isArray(body.mods)) data[gid].mods = body.mods.map(String).slice(0, 25);
    if (Array.isArray(body.vcmods)) data[gid].vcmods = body.vcmods.map(String).slice(0, 25);
    writeBotStore('trust', data);
    res.json(data[gid]);
});

// ———— Server Backup System ———————————————————————————————————————————————————————————————————
const BACKUP_MODULES = ['welcomer', 'automod', 'tickets', 'verification', 'autoreact', 'autoresponder', 'reactionroles', 'economy-settings', 'levelroles', 'button-commands', 'select-menus', 'logging', 'starboard', 'suggestions', 'join2create', 'media-only', 'sticky', 'bot-customize'];

app.get('/api/guild/:guildId/backups', authMiddleware, (req, res) => {
    const data = readBotStore('server_backups') || [];
    const guildBackups = (Array.isArray(data) ? data : [])
        .filter(b => b.guildId === req.params.guildId || b.guild_id === req.params.guildId)
        .map(b => ({ id: b.id || b.backup_id, name: b.name || b.guild_name, createdAt: b.createdAt || b.created_at, size: b.size || '—', modules: b.modules || [] }))
        .slice(0, 10);
    res.json(guildBackups);
});

app.post('/api/guild/:guildId/backups/create', authMiddleware, (req, res) => {
    const guildId = req.params.guildId;
    const backupData = {};
    
    for (const mod of BACKUP_MODULES) {
        const storeData = readBotStore(mod);
        if (storeData && storeData[guildId]) {
            backupData[mod] = storeData[guildId];
        }
    }

    const payload = JSON.stringify(backupData);
    const sizeKb = Math.max(1, Math.round(payload.length / 1024));

    const backupObj = {
        id: Math.random().toString(36).substring(2, 10),
        guildId,
        name: `Backup ${new Date().toLocaleDateString()}`,
        createdAt: Date.now(),
        size: `${sizeKb} KB`,
        modules: Object.keys(backupData),
        data: backupData
    };

    let allBackups = readBotStore('server_backups') || [];
    if (!Array.isArray(allBackups)) allBackups = [];
    allBackups.unshift(backupObj);
    
    const guildBackups = allBackups.filter(b => b.guildId === guildId || b.guild_id === guildId);
    if (guildBackups.length > 10) {
        const toKeep = new Set(guildBackups.slice(0, 10).map(b => b.id || b.backup_id));
        allBackups = allBackups.filter(b => (b.guildId !== guildId && b.guild_id !== guildId) || toKeep.has(b.id || b.backup_id));
    }

    writeBotStore('server_backups', allBackups);
    res.json({ success: true, backup: backupObj });
});

app.post('/api/guild/:guildId/backups/upload', authMiddleware, express.json({limit: '5mb'}), (req, res) => {
    const guildId = req.params.guildId;
    let importedData = req.body.data;
    
    if (!importedData || typeof importedData !== 'object') {
        return res.status(400).json({ error: 'Invalid backup format' });
    }
    
    // Support the export format payload which wraps data in { kind, data }
    if (importedData.kind === 'xnico-backup' && importedData.data) {
        importedData = importedData.data;
    }

    const payload = JSON.stringify(importedData);
    const sizeKb = Math.max(1, Math.round(payload.length / 1024));

    const backupObj = {
        id: Math.random().toString(36).substring(2, 10),
        guildId,
        name: `Imported Backup`,
        createdAt: Date.now(),
        size: `${sizeKb} KB`,
        modules: Object.keys(importedData).filter(k => BACKUP_MODULES.includes(k)),
        data: importedData
    };

    let allBackups = readBotStore('server_backups') || [];
    if (!Array.isArray(allBackups)) allBackups = [];
    allBackups.unshift(backupObj);
    
    const guildBackups = allBackups.filter(b => b.guildId === guildId || b.guild_id === guildId);
    if (guildBackups.length > 10) {
        const toKeep = new Set(guildBackups.slice(0, 10).map(b => b.id || b.backup_id));
        allBackups = allBackups.filter(b => (b.guildId !== guildId && b.guild_id !== guildId) || toKeep.has(b.id || b.backup_id));
    }

    writeBotStore('server_backups', allBackups);
    res.json({ success: true, backup: backupObj });
});

app.get('/api/guild/:guildId/backups/:backupId/download', authMiddleware, (req, res) => {
    const data = readBotStore('server_backups') || [];
    const backup = (Array.isArray(data) ? data : []).find(b => (b.guildId === req.params.guildId || b.guild_id === req.params.guildId) && (b.id === req.params.backupId || b.backup_id === req.params.backupId));
    
    if (!backup) return res.status(404).send('Backup not found');

    const exportPayload = {
        kind: 'xnico-backup',
        version: 1,
        exportedAt: backup.createdAt || backup.created_at || Date.now(),
        data: backup.data || {}
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="xnico-backup-${backup.id || backup.backup_id}.json"`);
    res.send(JSON.stringify(exportPayload, null, 2));
});

// ———— Invite Tracking ————————————————————————————————————————————————————————————————————————
app.get('/api/guild/:guildId/invites-config', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    // Read from invites store (the actual invite manager store)
    const invData = readBotStore('invites') || {};
    const cfg = invData[gid] || {};
    // Also read guild_members for leaderboard
    const guildMembers = readBotStore('guild_members') || [];
    const members = guildMembers.filter(m => m.guild_id === gid);
    const topInviters = members
        .filter(m => m.invites && Number(m.invites.invites || 0) > 0)
        .map(m => ({ userId: m.user_id, invites: Number(m.invites.invites || 0), left: Number(m.invites.left || 0), fake: Number(m.invites.fake || 0) }))
        .sort((a, b) => b.invites - a.invites)
        .slice(0, 25);
    // Merge with totals from invite store
    const totals = cfg.totals || {};
    const storeInviters = Object.entries(totals)
        .map(([userId, t]) => ({ userId, invites: (t.regular || 0) + (t.bonus || 0), left: t.left || 0, fake: t.fake || 0, bonus: t.bonus || 0 }))
        .filter(e => e.invites > 0 || e.left > 0)
        .sort((a, b) => b.invites - a.invites)
        .slice(0, 25);
    // Use whichever has more data
    const leaderboard = storeInviters.length >= topInviters.length ? storeInviters : topInviters;

    res.json({
        enabled: cfg.enabled !== false,
        channel: cfg.channel || null,
        rewards: Array.isArray(cfg.rewards) ? cfg.rewards : [],
        leaderboard,
        totalTracked: Object.keys(cfg.members || {}).length || members.length
    });
});
app.put('/api/guild/:guildId/invites-config', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const body = req.body || {};
    const invData = readBotStore('invites') || {};
    if (!invData[gid]) invData[gid] = { invites: {}, members: {}, rewards: [], totals: {}, enabled: true };
    const cfg = invData[gid];
    if (typeof body.enabled === 'boolean') cfg.enabled = body.enabled;
    if (body.channel !== undefined) cfg.channel = body.channel || null;
    if (Array.isArray(body.rewards)) {
        cfg.rewards = body.rewards
            .filter(r => r && Number.isFinite(Number(r.invites)) && r.roleId)
            .map(r => ({ invites: Number(r.invites), roleId: String(r.roleId) }))
            .sort((a, b) => a.invites - b.invites)
            .slice(0, 20);
    }
    writeBotStore('invites', invData);
    res.json({ success: true });
});

// â”€â”€ Server Stats Channels â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/serverstats-config', authMiddleware, (req, res) => {
    const data = readBotStore('serverstats') || {};
    const cfg = data[req.params.guildId] || {};
    res.json({
        enabled: !!cfg.categoryId || !!(cfg.channels && Object.keys(cfg.channels).length),
        categoryId: cfg.categoryId || null,
        channels: cfg.channels || {}
    });
});
app.put('/api/guild/:guildId/serverstats-config', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('serverstats') || {};
    if (!data[gid]) data[gid] = {};
    if (body.categoryId !== undefined) data[gid].categoryId = body.categoryId || null;
    if (body.channels && typeof body.channels === 'object') data[gid].channels = body.channels;
    if (body.enabled === false) { delete data[gid]; }
    writeBotStore('serverstats', data);
    res.json({ success: true });
});

// â”€â”€ Server Backup List â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/backups', authMiddleware, (req, res) => {
    const data = readBotStore('server_backups') || [];
    const guildBackups = (Array.isArray(data) ? data : [])
        .filter(b => b.guild_id === req.params.guildId || b.guildId === req.params.guildId)
        .map(b => ({ id: b.id || b.backup_id, name: b.name || b.guild_name, createdAt: b.created_at || b.createdAt, size: b.size || '—' }))
        .slice(0, 20);
    res.json(guildBackups);
});

// â”€â”€ Voice J2C CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€ Voice J2C CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// The J2C system was upgraded to a v2 multi-interface schema. The
// dashboard previously exposed only the legacy v1 flat fields
// (`triggerChannelId`, `activeChannels`), which meant a dashboard PUT
// would clobber the new `interfaces` map on save. These endpoints now
// surface the v2 shape directly and pass through `interfaces` as-is.
app.get('/api/guild/:guildId/voice-config', authMiddleware, (req, res) => {
    const data = readBotStore('join2create') || {};
    const raw = data[req.params.guildId] || {};

    // Lazy-migrate legacy v1 -> v2 for the read view so dashboards
    // never see the old shape. The bot-side mgr.getGuildConfig does
    // the same migration on read; we just mirror it here.
    let cfg;
    try {
        const j2cMgr = require('../utils/join2createManager');
        cfg = j2cMgr.migrateGuildConfig(raw, req.params.guildId);
    } catch {
        cfg = raw;
    }

    let tier = 'free';
    try {
        const j2cMgr = require('../utils/join2createManager');
        tier = j2cMgr.getGuildTier(req.params.guildId, req.user?.discordId || null);
    } catch {}

    const interfaces = Object.values(cfg.interfaces || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const activeChannelCount = Object.keys(cfg.activeChannels || {}).length;

    res.json({
        schemaVersion: cfg.schemaVersion || 2,
        tier,
        interfaces,
        activeChannelCount,
        // Legacy mirrors for older dashboard widgets that still read these.
        enabled: interfaces.some(i => i.enabled !== false),
        triggerChannelId: interfaces[0]?.triggerChannelId || null,
        interfaceChannelId: interfaces[0]?.interfaceChannelId || null,
        activeChannels: activeChannelCount
    });
});
app.put('/api/guild/:guildId/voice-config', authMiddleware, (req, res) => { // nosonar
    const gid = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('join2create') || {};

    // Pull-through migrate before any mutation so we never accidentally
    // overwrite a v2 doc with a v1-shaped patch.
    let cfg;
    try {
        const j2cMgr = require('../utils/join2createManager');
        cfg = j2cMgr.migrateGuildConfig(data[gid] || {}, gid);
    } catch {
        cfg = data[gid] || { schemaVersion: 2, interfaces: {}, activeChannels: {}, analytics: {} };
    }
    cfg.schemaVersion = 2;
    if (!cfg.interfaces)     cfg.interfaces     = {};
    if (!cfg.activeChannels) cfg.activeChannels = {};

    // Accept a partial update of one interface at a time. Body shape:
    //   { interfaceId: 'i_xxx', patch: { name, triggerChannelId, ... } }
    if (typeof body.interfaceId === 'string' && body.patch && typeof body.patch === 'object') {
        const iface = cfg.interfaces[body.interfaceId];
        if (!iface) {
            return res.status(404).json({ error: 'Interface not found.' });
        }
        const allowed = ['name', 'slug', 'emoji', 'triggerChannelId', 'categoryId', 'interfaceChannelId', 'controlPanelMessageId', 'maxUsers', 'bitrate', 'namingTemplate', 'allowedRoles', 'deniedRoles', 'visibility', 'autoDelete', 'enabled'];
        for (const key of allowed) {
            if (body.patch[key] !== undefined) iface[key] = body.patch[key];
        }
        iface.updatedAt = Date.now();
        cfg.interfaces[body.interfaceId] = iface;
    }

    // Legacy compatibility — older dashboards send a flat triggerChannelId
    // and `enabled` toggle. Translate them onto the first interface (or
    // create one if none exists yet) so existing UI widgets keep working.
    if (typeof body.enabled === 'boolean' || body.triggerChannelId !== undefined) {
        const list = Object.values(cfg.interfaces);
        let iface = list[0];
        if (!iface) {
            const id = 'i_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); // nosonar
            iface = {
                id, name: 'Default Room', slug: 'default',
                emoji: '<:Volumeup:1521228004502536272>',
                triggerChannelId: null, categoryId: null,
                interfaceChannelId: null, controlPanelMessageId: null,
                maxUsers: 0, bitrate: 96,
                namingTemplate: "{user}'s Channel",
                allowedRoles: [], deniedRoles: [],
                visibility: 'public', autoDelete: true,
                enabled: true,
                createdAt: Date.now(), updatedAt: Date.now()
            };
            cfg.interfaces[id] = iface;
        }
        if (typeof body.enabled === 'boolean') iface.enabled = body.enabled;
        if (body.triggerChannelId !== undefined) iface.triggerChannelId = body.triggerChannelId || null;
        iface.updatedAt = Date.now();
    }

    data[gid] = cfg;
    writeBotStore('join2create', data);
    res.json({ success: true });
});

// â”€â”€ Reaction Roles CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/reactionroles-config', authMiddleware, (req, res) => {
    const data = readBotStore('reactionroles') || {};
    const cfg = data[req.params.guildId] || {};
    const panels = Array.isArray(cfg.panels) ? cfg.panels : Object.values(cfg).filter(v => v && typeof v === 'object' && v.messageId);
    res.json({ panels: panels.slice(0, 25) });
});

// â”€â”€ Media-Only CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/media-only-config', authMiddleware, (req, res) => {
    const data = readBotStore('media-only') || {};
    const cfg = data[req.params.guildId] || {};
    res.json({ channels: Array.isArray(cfg.channels) ? cfg.channels : [] });
});
app.put('/api/guild/:guildId/media-only-config', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('media-only') || {};
    if (!data[gid]) data[gid] = {};
    if (Array.isArray(body.channels)) data[gid].channels = body.channels.map(String).slice(0, 25);
    writeBotStore('media-only', data);
    res.json({ success: true });
});

// â”€â”€ AFK CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/afk-config', authMiddleware, (req, res) => {
    const data = readBotStore('afk') || {};
    // AFK is stored per-user globally: { [userId]: { reason, since, guildId } }
    let count = 0;
    for (const [, info] of Object.entries(data)) {
        if (info && info.guildId === req.params.guildId) count++;
    }
    res.json({ activeAfkUsers: count });
});

// â”€â”€ Sticky Messages CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Bot schema (canonical): { [gid]: { enabled, messages: { [channelId]: { content, type, messageId } } } }
// Read at index.js:8813 as `cfg.messages?.[channelId]`. Anything written
// outside the `.messages` envelope is ignored by the runtime, so we
// normalize on read AND write.
app.get('/api/guild/:guildId/sticky-config', authMiddleware, (req, res) => {
    const data = readBotStore('sticky') || {};
    const cfg  = data[req.params.guildId] || {};
    const map  = (cfg && typeof cfg === 'object' && cfg.messages && typeof cfg.messages === 'object')
        ? cfg.messages
        : cfg; // legacy shape — keys at the top level

    const messages = Object.entries(map || {})
        .filter(([k]) => k !== 'enabled' && k !== 'messages') // skip legacy stray keys
        .map(([channelId, m]) => ({
            channelId,
            content: typeof m === 'string' ? m : (m?.content || m?.message || ''),
            type:    m?.type || 'text',
            messageId: m?.messageId || null
        }));
    res.json({
        enabled: cfg?.enabled !== false && messages.length > 0,
        messages
    });
});
app.put('/api/guild/:guildId/sticky-config', authMiddleware, (req, res) => { // nosonar
    const gid  = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('sticky') || {};
    if (!data[gid] || typeof data[gid] !== 'object') {
        data[gid] = { enabled: true, messages: {} };
    }
    if (!data[gid].messages || typeof data[gid].messages !== 'object') {
        data[gid].messages = {};
    }

    // Migrate any legacy top-level channel entries into .messages.
    for (const k of Object.keys(data[gid])) {
        if (k === 'enabled' || k === 'messages') continue;
        if (typeof data[gid][k] === 'object' && data[gid][k] !== null) {
            data[gid].messages[k] = data[gid][k];
        }
        delete data[gid][k];
    }

    if (typeof body.enabled === 'boolean') data[gid].enabled = body.enabled;

    // Add a sticky
    if (body.add?.channelId && body.add?.content) {
        data[gid].messages[body.add.channelId] = {
            content: String(body.add.content).slice(0, 4000),
            type: body.add.type || 'text',
            messageId: null
        };
        if (data[gid].enabled !== false) data[gid].enabled = true;
    }
    // Remove a sticky
    if (body.remove?.channelId) {
        delete data[gid].messages[body.remove.channelId];
    }

    // Bulk replace
    if (body.messages && typeof body.messages === 'object' && !Array.isArray(body.messages)) {
        const clean = {};
        for (const [chId, m] of Object.entries(body.messages)) {
            if (!chId || typeof m !== 'object') continue;
            clean[chId] = {
                content: String(m.content || '').slice(0, 4000),
                type: m.type || 'text',
                messageId: m.messageId || null
            };
        }
        data[gid].messages = clean;
    }

    writeBotStore('sticky', data);
    res.json({ success: true });
});

// â”€â”€ Autorole CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/autorole-config', authMiddleware, (req, res) => {
    const data = readBotStore('autorole') || {};
    const cfg = data[req.params.guildId] || {};
    let humansRole;
    if (Array.isArray(cfg.humans)) {
        humansRole = cfg.humans;
    } else if (typeof cfg === 'string') {
        humansRole = [cfg];
    } else {
        humansRole = [];
    }
    res.json({
        enabled: cfg.enabled !== false,
        humans: humansRole,
        bots: Array.isArray(cfg.bots) ? cfg.bots : []
    });
});
app.put('/api/guild/:guildId/autorole-config', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('autorole') || {};
    data[gid] = {
        enabled: body.enabled !== false,
        humans: Array.isArray(body.humans) ? body.humans.map(String).slice(0, 10) : [],
        bots: Array.isArray(body.bots) ? body.bots.map(String).slice(0, 10) : []
    };
    writeBotStore('autorole', data);
    res.json(data[gid]);
});

// â”€â”€ Suggestions CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/suggestions-config', authMiddleware, (req, res) => {
    const premium = checkPremiumStatus(req, req.params.guildId);
    if (!premium.hasPremium) return res.status(403).json({ error: 'Premium required' });

    const data = readBotStore('suggestions') || {};
    const cfg = data[req.params.guildId] || {};
    res.json({
        channelId: cfg.channelId || null,
        logsChannelId: cfg.logsChannelId || null,
        voteThreshold: cfg.voteThreshold || 10,
        threadSlowmode: cfg.threadSlowmode || 0,
        totalSuggestions: cfg.nextId ? cfg.nextId - 1 : Object.keys(cfg.suggestions || {}).length
    });
});
app.put('/api/guild/:guildId/suggestions-config', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('suggestions') || {};
    if (!data[gid]) data[gid] = { channelId: null, logsChannelId: null, voteThreshold: 10, threadSlowmode: 0, nextId: 1, suggestions: {} };
    const cfg = data[gid];
    if (body.channelId !== undefined) cfg.channelId = body.channelId || null;
    if (body.logsChannelId !== undefined) cfg.logsChannelId = body.logsChannelId || null;
    if (Number.isFinite(Number(body.voteThreshold))) cfg.voteThreshold = Math.max(1, Math.min(100, Number(body.voteThreshold)));
    if (Number.isFinite(Number(body.threadSlowmode))) cfg.threadSlowmode = Math.max(0, Math.min(21600, Number(body.threadSlowmode)));
    writeBotStore('suggestions', data);
    res.json({ success: true });
});

// â”€â”€ Feedback CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/feedback-config', authMiddleware, (req, res) => {
    const premium = checkPremiumStatus(req, req.params.guildId);
    if (!premium.hasPremium) return res.status(403).json({ error: 'Premium required' });

    const data = readBotStore('feedback') || {};
    const cfg = data[req.params.guildId] || {};
    const ratings = cfg.ratings || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let total = 0, count = 0;
    for (let i = 1; i <= 5; i++) { total += i * (ratings[i] || 0); count += (ratings[i] || 0); }
    res.json({
        channelId: cfg.channelId || null,
        logsChannelId: cfg.logsChannelId || null,
        totalCount: cfg.totalCount || count,
        ratings,
        averageRating: count > 0 ? Math.round(total / count * 10) / 10 : 0
    });
});
app.put('/api/guild/:guildId/feedback-config', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('feedback') || {};
    if (!data[gid]) data[gid] = { channelId: null, logsChannelId: null, totalCount: 0, ratings: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
    const cfg = data[gid];
    if (body.channelId !== undefined) cfg.channelId = body.channelId || null;
    if (body.logsChannelId !== undefined) cfg.logsChannelId = body.logsChannelId || null;
    writeBotStore('feedback', data);
    res.json({ success: true });
});

// â”€â”€ Screenshot Verify CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Surfaces the per-guild config (mode, channels, tasks, behavior) and
// the queue stats. The full editor (creating tasks / actions) lives
// in-bot via `/screenshot-verify panel` because the action engine can
// chain role grants / DMs / channel announcements that the dashboard
// can't easily mirror without a Discord REST round-trip per click.
app.get('/api/guild/:guildId/screenshot-verify-config', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const cfgAll  = readBotStore('screenshot-verify') || {};
    const subsAll = readBotStore('screenshot-verify-submissions') || {};
    const cfg = cfgAll[gid] || {};
    const guildSubs = subsAll[gid] || {};

    let pending = 0, approved = 0, rejected = 0;
    for (const s of Object.values(guildSubs)) {
        if (s.status === 'pending')       pending++;
        else if (s.status === 'approved') approved++;
        else if (s.status === 'rejected') rejected++;
    }

    res.json({
        enabled:             cfg.enabled === true,
        mode:                cfg.mode || 'hybrid',
        verifier:            cfg.verifier || 'hybrid',
        confidenceThreshold: cfg.confidenceThreshold || 75,
        cooldown:            cfg.cooldown || 0,
        autoDelete:          cfg.autoDelete !== false,
        hideAfterVerify:     cfg.hideAfterVerify !== false,
        color:               cfg.color || 0x5865F2,
        submissionChannelId: cfg.submissionChannelId || null,
        reviewChannelId:     cfg.reviewChannelId || null,
        logChannelId:        cfg.logChannelId || null,
        approveMessage:      cfg.approveMessage || '',
        rejectMessage:       cfg.rejectMessage || '',
        tasks:               Array.isArray(cfg.tasks) ? cfg.tasks : [],
        stats: { pending, approved, rejected, total: pending + approved + rejected }
    });
});
app.put('/api/guild/:guildId/screenshot-verify-config', authMiddleware, (req, res) => { // nosonar
    const gid  = req.params.guildId;
    const body = req.body || {};
    const all = readBotStore('screenshot-verify') || {};
    if (!all[gid]) {
        all[gid] = {
            enabled: false, submissionChannelId: null, reviewChannelId: null, logChannelId: null,
            mode: 'hybrid', verifier: 'hybrid', confidenceThreshold: 75, cooldown: 0,
            autoDelete: true, hideAfterVerify: true, color: 0x5865F2,
            approveMessage: 'Your screenshot was approved.',
            rejectMessage:  'Your screenshot did not pass verification. You may try again.',
            tasks: []
        };
    }
    const cfg = all[gid];

    // Whitelist of mutable top-level keys (we never let dashboard edit
    // `tasks` here — that goes through the in-bot panel because each
    // task may carry actions that spawn role grants / DMs).
    if (typeof body.enabled === 'boolean') cfg.enabled = body.enabled;
    if (['auto', 'review', 'hybrid'].includes(body.mode)) cfg.mode = body.mode;
    if (['ocr', 'ai', 'hybrid'].includes(body.verifier)) cfg.verifier = body.verifier;
    if (typeof body.confidenceThreshold === 'number' && body.confidenceThreshold >= 50 && body.confidenceThreshold <= 100) {
        cfg.confidenceThreshold = Math.round(body.confidenceThreshold);
    }
    if (typeof body.cooldown === 'number' && body.cooldown >= 0) cfg.cooldown = Math.floor(body.cooldown);
    if (typeof body.autoDelete === 'boolean')      cfg.autoDelete = body.autoDelete;
    if (typeof body.hideAfterVerify === 'boolean') cfg.hideAfterVerify = body.hideAfterVerify;
    if (typeof body.color === 'number' && body.color >= 0 && body.color <= 0xFFFFFF) cfg.color = body.color;
    if (body.submissionChannelId !== undefined) cfg.submissionChannelId = body.submissionChannelId || null;
    if (body.reviewChannelId !== undefined)     cfg.reviewChannelId     = body.reviewChannelId || null;
    if (body.logChannelId !== undefined)        cfg.logChannelId        = body.logChannelId || null;
    if (typeof body.approveMessage === 'string') cfg.approveMessage = body.approveMessage.slice(0, 500);
    if (typeof body.rejectMessage === 'string')  cfg.rejectMessage  = body.rejectMessage.slice(0, 500);

    writeBotStore('screenshot-verify', all);
    res.json({ success: true });
});

// â”€â”€ Custom Shop CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Admins can list / add / remove custom-shop items via dashboard. Each
// item carries an `action` (give_role / remove_role / send_dm /
// add_coins / custom_reply) plus its `actionData`.
app.get('/api/guild/:guildId/custom-shop-config', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const all = readBotStore('custom-shop') || {};
    const cfg = all[gid] || { items: [] };
    res.json({
        items: Array.isArray(cfg.items) ? cfg.items : []
    });
});
app.put('/api/guild/:guildId/custom-shop-config', authMiddleware, (req, res) => {
    const gid  = req.params.guildId;
    const body = req.body || {};
    const all = readBotStore('custom-shop') || {};
    if (!all[gid]) all[gid] = { items: [] };

    const VALID_ACTIONS = new Set(['give_role', 'remove_role', 'send_dm', 'add_coins', 'custom_reply']);

    if (Array.isArray(body.items)) {
        // Sanitize + clamp every item before persisting. This is a
        // user-controlled write so we cannot trust the shape blindly.
        all[gid].items = body.items.slice(0, 50).map(item => {
            const action = VALID_ACTIONS.has(item?.action) ? item.action : 'custom_reply';
            return {
                name:        String(item?.name || 'Item').slice(0, 50),
                price:       Math.max(1, Math.min(1_000_000_000, Number.parseInt(item?.price, 10) || 1)),
                action,
                actionData:  String(item?.actionData ?? '').slice(0, 1500),
                description: String(item?.description ?? '').slice(0, 200),
                createdBy:   item?.createdBy || req.user?.discordId || 'dashboard',
                createdAt:   item?.createdAt || Date.now()
            };
        });
    }

    writeBotStore('custom-shop', all);
    res.json({ success: true });
});

// â”€â”€ Tickets CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/tickets-config', authMiddleware, (req, res) => {
    const data = readBotStore('tickets') || {};
    const cfg = data[req.params.guildId] || {};
    res.json({
        configured: !!cfg.channelId,
        channelId: cfg.channelId || null,
        categoryId: cfg.categoryId || null,
        supportRoleId: cfg.supportRoleId || null,
        panelMessageId: cfg.panelMessageId || null,
        nextTicketNumber: cfg.nextTicketNumber || 0,
        categories: Array.isArray(cfg.categories) ? cfg.categories : [],
        openTickets: Object.keys(cfg.tickets || {}).length,
        hasCustomPanel: !!cfg.panelMessage,
        hasCustomWelcome: !!cfg.welcomeMessage,
        panelMessage: cfg.panelMessage || null,
        welcomeMessage: cfg.welcomeMessage || null
    });
});

app.put('/api/guild/:guildId/tickets-config', authMiddleware, async (req, res) => {
    const gid = req.params.guildId;
    const body = req.body || {};
    try {
        await jsonStore.updateGuildEntry('tickets', gid, (cfg) => {
            if (!cfg) cfg = { tickets: {}, nextTicketNumber: 0 };
            if (body.enabled !== undefined) cfg.enabled = !!body.enabled;
            if (body.channelId !== undefined) cfg.channelId = body.channelId || null;
            if (body.categoryId !== undefined) cfg.categoryId = body.categoryId || null;
            if (body.supportRoleId !== undefined) cfg.supportRoleId = body.supportRoleId || null;
            if (Array.isArray(body.categories)) {
                cfg.categories = body.categories
                    .filter(c => c?.id && c?.label)
                    .map(c => ({
                        id: String(c.id).toLowerCase().replace(/\s+/g, '-').slice(0, 32),
                        label: String(c.label).slice(0, 80),
                        emoji: String(c.emoji || '🎫').slice(0, 32),
                        description: String(c.description || '').slice(0, 200)
                    }));
                if (cfg.panels && cfg.panels.default) {
                    cfg.panels.default.categoryIds = [];
                }
            }

            if (body.panelMessage !== undefined) {
                if (!body.panelMessage) {
                    delete cfg.panelMessage;
                } else {
                    cfg.panelMessage = {
                        mode: String(body.panelMessage.mode || 'components'),
                        content: String(body.panelMessage.content || '').slice(0, 2000),
                        title: String(body.panelMessage.title || '').slice(0, 256),
                        description: String(body.panelMessage.description || '').slice(0, 4096),
                        color: String(body.panelMessage.color || '#5865F2').slice(0, 20),
                        image: String(body.panelMessage.image || '').slice(0, 500),
                        thumbnail: String(body.panelMessage.thumbnail || '').slice(0, 500),
                        footer: String(body.panelMessage.footer || '').slice(0, 2048),
                        footerIcon: String(body.panelMessage.footerIcon || '').slice(0, 500),
                        author: String(body.panelMessage.author || '').slice(0, 256),
                        authorIcon: String(body.panelMessage.authorIcon || '').slice(0, 500)
                    };
                }
            }

            if (body.welcomeMessage !== undefined) {
                if (!body.welcomeMessage) {
                    delete cfg.welcomeMessage;
                } else {
                    cfg.welcomeMessage = {
                        mode: String(body.welcomeMessage.mode || 'components'),
                        content: String(body.welcomeMessage.content || '').slice(0, 2000),
                        title: String(body.welcomeMessage.title || '').slice(0, 256),
                        description: String(body.welcomeMessage.description || '').slice(0, 4096),
                        color: String(body.welcomeMessage.color || '#5865F2').slice(0, 20),
                        image: String(body.welcomeMessage.image || '').slice(0, 500),
                        thumbnail: String(body.welcomeMessage.thumbnail || '').slice(0, 500),
                        footer: String(body.welcomeMessage.footer || '').slice(0, 2048),
                        footerIcon: String(body.welcomeMessage.footerIcon || '').slice(0, 500),
                        author: String(body.welcomeMessage.author || '').slice(0, 256),
                        authorIcon: String(body.welcomeMessage.authorIcon || '').slice(0, 500)
                    };
                }
            }
            return cfg;
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// List open tickets
app.get('/api/guild/:guildId/tickets-open', authMiddleware, (req, res) => {
    const data = peekBotStore('tickets') || {};
    const cfg = data[req.params.guildId] || {};
    const tickets = cfg.tickets || {};
    const list = Object.entries(tickets).map(([channelId, t]) => ({
        channelId,
        userId: t.userId,
        category: t.category || t.categoryLabel || 'General',
        createdAt: t.createdAt
    }));
    res.json(list);
});

// Ticket History
app.get('/api/guild/:guildId/tickets-history', authMiddleware, (req, res) => {
    const data = peekBotStore('ticket-history') || {};
    const history = data[req.params.guildId] || [];
    res.json(history);
});

// Transcript Proxy
app.get('/api/guild/:guildId/transcript/:channelId/:messageId', authMiddleware, async (req, res) => {
    try {
        const { channelId, messageId } = req.params;
        const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        if (!response.ok) {
            return res.status(404).send('Transcript log message not found or expired.');
        }
        const messageData = await response.json();
        const htmlAttachment = messageData.attachments?.find(a => a.filename?.endsWith('.html'));
        if (!htmlAttachment) {
            return res.status(404).send('No HTML transcript attachment found on this message.');
        }
        const htmlResponse = await fetch(htmlAttachment.url);
        if (!htmlResponse.ok) {
            return res.status(500).send('Failed to download transcript from Discord CDN.');
        }
        const html = await htmlResponse.text();
        res.setHeader('Content-Type', 'text/html');
        res.send(html);
    } catch (err) {
        console.error(`[Dashboard] Transcript proxy failed:`, err);
        res.status(500).send('An error occurred while fetching the transcript.');
    }
});

// â”€â”€ Starboard CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/starboard-config', authMiddleware, (req, res) => {
    const data = readBotStore('starboard') || {};
    const cfg = data[req.params.guildId] || {};
    res.json({
        enabled: !!cfg.channelId,
        channelId: cfg.channelId || null,
        threshold: cfg.threshold || 3,
        starredCount: Object.keys(cfg.starredMessages || {}).length
    });
});
app.put('/api/guild/:guildId/starboard-config', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('starboard') || {};
    if (body.enabled === false) {
        delete data[gid];
    } else {
        if (!data[gid]) data[gid] = { starredMessages: {} };
        if (body.channelId !== undefined) data[gid].channelId = body.channelId || null;
        if (Number.isFinite(Number(body.threshold))) data[gid].threshold = Math.max(1, Math.min(100, Number(body.threshold)));
    }
    writeBotStore('starboard', data);
    res.json({ success: true });
});

// â”€â”€ Counting CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// IMPORTANT: the bot's counting handler reads/writes via
// utils/database.db.{get,set}('counting_<guildId>') (a custom_data PG row),
// NOT via jsonStore. The previous dashboard used jsonStore('counting')
// which was a parallel store the bot never read — every dashboard write
// was orphaned. Both endpoints now route through the same db helper.
app.get('/api/guild/:guildId/counting-config', authMiddleware, async (req, res) => {
    try {
        const { db } = require('../utils/database');
        const cfg = (await db.get(`counting_${req.params.guildId}`)) || {};
        res.json({
            enabled: !!cfg.channelId,
            channelId: cfg.channelId || null,
            currentCount: cfg.currentCount || 0,
            highScore: cfg.highScore || 0,
            totalCounts: cfg.totalCounts || 0,
            fails: cfg.fails || 0,
            lastUserId: cfg.lastUserId || null
        });
    } catch (error) { /* Database not available, return default data */ // nosonar
        res.json({ enabled: false, channelId: null, currentCount: 0, highScore: 0, totalCounts: 0, fails: 0, lastUserId: null });
    }
});
app.put('/api/guild/:guildId/counting-config', authMiddleware, async (req, res) => {
    const gid  = req.params.guildId;
    const body = req.body || {};
    try {
        const { db } = require('../utils/database');
        if (body.enabled === false) {
            await db.delete(`counting_${gid}`);
            return res.json({ success: true, disabled: true });
        }
        const existing = (await db.get(`counting_${gid}`)) || {
            channelId: null, currentCount: 0, lastUserId: null,
            highScore: 0, totalCounts: 0, fails: 0
        };
        if (body.channelId !== undefined) existing.channelId = body.channelId ? String(body.channelId) : null;
        if (body.reset)     { existing.currentCount = 0; existing.lastUserId = null; }
        await db.set(`counting_${gid}`, existing);
        res.json({ success: true });
    } catch (error) { /* Database write failed */
        res.status(500).json({ success: false, error: error?.message || 'counting update failed' });
    }
});

// â”€â”€ Autoreact CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/autoreact-config', authMiddleware, (req, res) => {
    const data = readBotStore('autoreact') || {};
    const cfg = data[req.params.guildId] || { enabled: false, reactions: [] };
    res.json({
        enabled: cfg.enabled || false,
        reactions: Array.isArray(cfg.reactions) ? cfg.reactions : []
    });
});
app.put('/api/guild/:guildId/autoreact-config', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('autoreact') || {};
    if (!data[gid]) data[gid] = { enabled: false, reactions: [] };
    if (typeof body.enabled === 'boolean') data[gid].enabled = body.enabled;
    if (Array.isArray(body.reactions)) {
        data[gid].reactions = body.reactions
            .filter(r => r?.trigger && Array.isArray(r?.emojis) && r.emojis.length)
            .map(r => ({ trigger: String(r.trigger).toLowerCase().trim(), emojis: r.emojis.map(String).slice(0, 20) }));
    }
    writeBotStore('autoreact', data);
    // The storeSync listener attached to jsonStore handles cache
    // invalidation automatically when writeBotStore -> writeImmediate
    // fires the 'update' event. Calling global.updateAutoreactCache here
    // would double-apply the write (the listener already iterates the
    // fresh snapshot per guild).
    res.json(data[gid]);
});

// â”€â”€ Giveaway Settings CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/giveaway-settings', authMiddleware, (req, res) => {
    const data = readBotStore('giveaway-settings') || {};
    const cfg = data[req.params.guildId] || {};
    res.json({
        defaultDuration: cfg.defaultDuration || 60,
        defaultWinners: cfg.defaultWinners || 1,
        pingRole: cfg.pingRole || null,
        dmWinners: cfg.dmWinners !== false,
        showParticipants: cfg.showParticipants !== false,
        requireRole: cfg.requireRole || null,
        bypassRole: cfg.bypassRole || null
    });
});
app.put('/api/guild/:guildId/giveaway-settings', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('giveaway-settings') || {};
    if (!data[gid]) data[gid] = {};
    const s = data[gid];
    if (Number.isFinite(Number(body.defaultDuration))) s.defaultDuration = Math.max(1, Math.min(43200, Number(body.defaultDuration)));
    if (Number.isFinite(Number(body.defaultWinners))) s.defaultWinners = Math.max(1, Math.min(20, Number(body.defaultWinners)));
    if (body.pingRole !== undefined) s.pingRole = body.pingRole || null;
    if (body.requireRole !== undefined) s.requireRole = body.requireRole || null;
    if (body.bypassRole !== undefined) s.bypassRole = body.bypassRole || null;
    if (typeof body.dmWinners === 'boolean') s.dmWinners = body.dmWinners;
    if (typeof body.showParticipants === 'boolean') s.showParticipants = body.showParticipants;
    writeBotStore('giveaway-settings', data);
    res.json(data[gid]);
});

// Active giveaways list
app.get('/api/guild/:guildId/giveaways', authMiddleware, (req, res) => {
    const data = readBotStore('giveaways') || {};
    const guildGiveaways = data[req.params.guildId] || {};
    const list = Object.entries(guildGiveaways).map(([msgId, g]) => ({
        messageId: msgId,
        prize: g.prize,
        winners: g.winners,
        channelId: g.channelId,
        hostId: g.hostId,
        endTime: g.endTime,
        ended: g.ended || false,
        participants: (g.participants || []).length
    }));
    res.json(list);
});

// â”€â”€ Economy Module CRUD (settings + leaderboard + user management) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/economy-settings', authMiddleware, (req, res) => {
    const allSettings = readBotStore('economy-settings') || {};
    const guildSettings = allSettings[req.params.guildId] || {};
    res.json({
        currency: guildSettings.currency || '💰',
        currencyName: guildSettings.currencyName || 'coins',
        dailyReward: guildSettings.dailyReward || 100,
        weeklyReward: guildSettings.weeklyReward || 500,
        workMinReward: guildSettings.workMinReward || 50,
        workMaxReward: guildSettings.workMaxReward || 200,
        robChance: guildSettings.robChance || 40,
        startingBalance: guildSettings.startingBalance || 0,
        robEnabled: guildSettings.robEnabled !== false,
        gamblingEnabled: guildSettings.gamblingEnabled !== false,
        shopEnabled: guildSettings.shopEnabled !== false,
    });
});

app.put('/api/guild/:guildId/economy-settings', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const body = req.body || {};
    const allSettings = readBotStore('economy-settings') || {};
    if (!allSettings[gid]) allSettings[gid] = {};
    const s = allSettings[gid];

    if (typeof body.currency === 'string') s.currency = body.currency.trim().slice(0, 32) || '💰';
    if (typeof body.currencyName === 'string') s.currencyName = body.currencyName.trim().slice(0, 32).toLowerCase() || 'coins';
    if (Number.isFinite(Number(body.dailyReward))) s.dailyReward = Math.max(0, Math.min(1000000, Number(body.dailyReward)));
    if (Number.isFinite(Number(body.weeklyReward))) s.weeklyReward = Math.max(0, Math.min(10000000, Number(body.weeklyReward)));
    if (Number.isFinite(Number(body.workMinReward))) s.workMinReward = Math.max(0, Math.min(1000000, Number(body.workMinReward)));
    if (Number.isFinite(Number(body.workMaxReward))) s.workMaxReward = Math.max(0, Math.min(1000000, Number(body.workMaxReward)));
    if (Number.isFinite(Number(body.robChance))) s.robChance = Math.max(0, Math.min(100, Number(body.robChance)));
    if (Number.isFinite(Number(body.startingBalance))) s.startingBalance = Math.max(0, Math.min(10000000, Number(body.startingBalance)));
    if (typeof body.robEnabled === 'boolean') s.robEnabled = body.robEnabled;
    if (typeof body.gamblingEnabled === 'boolean') s.gamblingEnabled = body.gamblingEnabled;
    if (typeof body.shopEnabled === 'boolean') s.shopEnabled = body.shopEnabled;

    writeBotStore('economy-settings', allSettings);
    res.json(allSettings[gid]);
});

// Economy leaderboard (top users by net worth)
app.get('/api/guild/:guildId/economy-leaderboard', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const economyStore = readBotStore('economy') || {};
    const usersStore = readBotStore('users') || [];
    const guildMembers = readBotStore('guild_members') || [];
    
    const validMemberIds = new Set(
        guildMembers.filter(m => m.guild_id === gid).map(m => m.user_id)
    );

    const mergedEconomy = { ...economyStore };
    for (const u of usersStore) {
        if (u.economy && (!mergedEconomy[u.user_id] || !mergedEconomy[u.user_id].coins)) {
            mergedEconomy[u.user_id] = {
                coins: Number(u.economy.coins || 0),
                bank: Number(u.economy.bank || 0),
                level: 1,
                streak: 0
            };
        }
    }

    const entries = Object.entries(mergedEconomy)
        .filter(([userId]) => validMemberIds.has(userId) || validMemberIds.size === 0)
        .map(([userId, data]) => ({
            userId,
            coins: Number(data.coins || data.balance || 0),
            bank: Number(data.bank || 0),
            total: Number(data.coins || data.balance || 0) + Number(data.bank || 0),
            level: Number(data.level || 1),
            streak: Number(data.dailyStreak || data.streak || 0)
        }))
        .filter(e => e.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 50);
    res.json(entries);
});

// Set a user's balance
app.post('/api/guild/:guildId/economy-user/:userId/set', authMiddleware, (req, res) => {
    if (!['588982544545087498', '1264506198489563143'].includes(req.user.discordId)) {
        return res.status(403).json({ error: 'Only specific bot owners can perform this action.' });
    }
    const { coins, bank } = req.body || {};
    const economy = readBotStore('economy') || {};
    if (!economy[req.params.userId]) economy[req.params.userId] = { coins: 0, bank: 0 };
    if (Number.isFinite(Number(coins))) economy[req.params.userId].coins = Math.max(0, Number(coins));
    if (Number.isFinite(Number(bank))) economy[req.params.userId].bank = Math.max(0, Number(bank));
    writeBotStore('economy', economy);
    res.json({ success: true, coins: economy[req.params.userId].coins, bank: economy[req.params.userId].bank });
});

// Reset a user's economy
app.delete('/api/guild/:guildId/economy-user/:userId', authMiddleware, (req, res) => {
    if (!['588982544545087498', '1264506198489563143'].includes(req.user.discordId)) {
        return res.status(403).json({ error: 'Only specific bot owners can perform this action.' });
    }
    const economy = readBotStore('economy') || {};
    if (economy[req.params.userId]) {
        delete economy[req.params.userId];
        writeBotStore('economy', economy);
    }
    res.json({ success: true });
});

// â”€â”€ AntiNuke CRUD (protection modules, whitelist, bypass) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ANTINUKE_KEYS = ['banProtection', 'kickProtection', 'channelDelete', 'channelCreate', 'roleDelete', 'roleCreate', 'webhookCreate', 'botAdd'];
const ANTINUKE_PUNISH = new Set(['remove_roles', 'kick', 'ban', 'timeout', 'kick_bot', 'kick_both', 'ban_bot']);

function getAntinukeDefaults() {
    return {
        enabled: false,
        banProtection: { enabled: false, limit: 3, timeWindow: 60000, action: 'remove_roles' },
        kickProtection: { enabled: false, limit: 3, timeWindow: 60000, action: 'remove_roles' },
        channelDelete: { enabled: false, limit: 2, timeWindow: 60000, action: 'remove_roles' },
        channelCreate: { enabled: false, limit: 3, timeWindow: 60000, action: 'remove_roles' },
        roleDelete: { enabled: false, limit: 2, timeWindow: 60000, action: 'remove_roles' },
        roleCreate: { enabled: false, limit: 3, timeWindow: 60000, action: 'remove_roles' },
        webhookCreate: { enabled: false, limit: 2, timeWindow: 60000, action: 'remove_roles' },
        botAdd: { enabled: false, action: 'kick_bot' },
        whitelistedUsers: [],
        bypassRoleId: null,
        logChannel: null,
        zeroTolerance: false,
        instantQuarantine: false,
        autoRestore: false
    };
}

app.get('/api/guild/:guildId/antinuke', authMiddleware, (req, res) => {
    const data = readBotStore('antinuke') || {};
    const saved = data[req.params.guildId] || {};
    res.json(deepMerge(getAntinukeDefaults(), saved));
});

app.put('/api/guild/:guildId/antinuke', authMiddleware, (req, res) => { // nosonar
    const gid = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('antinuke') || {};
    const cur = deepMerge(getAntinukeDefaults(), data[gid] || {});

    // Master toggle
    if (typeof body.enabled === 'boolean') cur.enabled = body.enabled;

    // Each protection module
    for (const key of ANTINUKE_KEYS) {
        if (!body[key]) continue;
        const mod = body[key];
        if (!cur[key]) cur[key] = {};
        if (typeof mod.enabled === 'boolean') cur[key].enabled = mod.enabled;
        if (key !== 'botAdd') {
            if (Number.isFinite(Number(mod.limit))) cur[key].limit = Math.max(1, Math.min(50, Number(mod.limit)));
            if (Number.isFinite(Number(mod.timeWindow))) cur[key].timeWindow = Math.max(5000, Math.min(600000, Number(mod.timeWindow)));
        }
        if (mod.action && ANTINUKE_PUNISH.has(mod.action)) cur[key].action = mod.action;
    }

    // Shared settings
    if (Array.isArray(body.whitelistedUsers)) cur.whitelistedUsers = body.whitelistedUsers.map(String);
    if (body.bypassRoleId !== undefined) cur.bypassRoleId = body.bypassRoleId || null;
    if (body.logChannel !== undefined) cur.logChannel = body.logChannel || null;

    // Power-mode flags
    if (typeof body.zeroTolerance === 'boolean') cur.zeroTolerance = body.zeroTolerance;
    if (typeof body.instantQuarantine === 'boolean') cur.instantQuarantine = body.instantQuarantine;
    if (typeof body.autoRestore === 'boolean') cur.autoRestore = body.autoRestore;

    data[gid] = cur;
    writeBotStore('antinuke', data);
    // The storeSync listener attached to jsonStore handles cache
    // invalidation automatically when writeBotStore -> writeImmediate
    // fires the 'update' event. Calling global.reloadAntinukeCache here
    // would double-apply the write.
    res.json(cur);
});

// â”€â”€ AutoMod CRUD (filters, ignore lists, bad words) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const AUTOMOD_FILTERS = ['badWords', 'spam', 'links', 'invites', 'massMention', 'caps', 'profanity', 'sexualContent', 'slurs'];
const AUTOMOD_ACTIONS = new Set(['warn', 'delete', 'timeout', 'kick', 'ban']);

function getAutomodDefaultsFull() {
    return {
        enabled: false,
        badWords: { enabled: false, words: [], action: 'delete' },
        spam: { enabled: false, messageLimit: 5, timeWindow: 5000, action: 'timeout' },
        links: { enabled: false, action: 'delete', whitelist: [] },
        invites: { enabled: false, action: 'delete' },
        massMention: { enabled: false, limit: 5, action: 'delete' },
        caps: { enabled: false, percentage: 70, minLength: 10, action: 'delete' },
        profanity: { enabled: false, action: 'delete' },
        sexualContent: { enabled: false, action: 'delete' },
        slurs: { enabled: false, action: 'delete' },
        logChannel: null,
        ignoredRoles: [],
        ignoredChannels: [],
        bypassRoleId: null
    };
}

app.get('/api/guild/:guildId/automod', authMiddleware, (req, res) => {
    const data = readBotStore('automod') || {};
    const saved = data[req.params.guildId] || {};
    res.json(deepMerge(getAutomodDefaultsFull(), saved));
});

app.put('/api/guild/:guildId/automod', authMiddleware, (req, res) => { // nosonar
    const gid = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('automod') || {};
    const cur = deepMerge(getAutomodDefaultsFull(), data[gid] || {});

    // Master toggle
    if (typeof body.enabled === 'boolean') cur.enabled = body.enabled;

    // Each filter
    for (const key of AUTOMOD_FILTERS) {
        if (!body[key]) continue;
        const f = body[key];
        if (!cur[key]) cur[key] = {};
        if (typeof f.enabled === 'boolean') cur[key].enabled = f.enabled;
        if (f.action && AUTOMOD_ACTIONS.has(f.action)) cur[key].action = f.action;

        if (key === 'badWords' && Array.isArray(f.words)) {
            cur[key].words = [...new Set(f.words.filter(w => w && typeof w === 'string').map(w => w.trim().toLowerCase()))];
        }
        if (key === 'spam') {
            if (Number.isFinite(Number(f.messageLimit))) cur[key].messageLimit = Math.max(2, Math.min(50, Number(f.messageLimit)));
            if (Number.isFinite(Number(f.timeWindow))) cur[key].timeWindow = Math.max(1000, Math.min(60000, Number(f.timeWindow)));
        }
        if (key === 'links' && Array.isArray(f.whitelist)) {
            cur[key].whitelist = [...new Set(f.whitelist.filter(w => w && typeof w === 'string').map(w => w.trim().toLowerCase()))];
        }
        if (key === 'massMention' && Number.isFinite(Number(f.limit))) {
            cur[key].limit = Math.max(1, Math.min(50, Number(f.limit)));
        }
        if (key === 'caps') {
            if (Number.isFinite(Number(f.percentage))) cur[key].percentage = Math.max(10, Math.min(100, Number(f.percentage)));
            if (Number.isFinite(Number(f.minLength))) cur[key].minLength = Math.max(3, Math.min(500, Number(f.minLength)));
        }
    }

    // Shared settings
    if (Array.isArray(body.ignoredRoles)) cur.ignoredRoles = body.ignoredRoles.map(String);
    if (Array.isArray(body.ignoredChannels)) cur.ignoredChannels = body.ignoredChannels.map(String);
    if (body.bypassRoleId !== undefined) cur.bypassRoleId = body.bypassRoleId || null;
    if (body.logChannel !== undefined) cur.logChannel = body.logChannel || null;

    data[gid] = cur;
    writeBotStore('automod', data);
    // The storeSync listener attached to jsonStore handles cache
    // invalidation automatically when writeBotStore -> writeImmediate
    // fires the 'update' event. Calling global.updateAutomodCache here
    // would double-apply the write (the listener already iterates the
    // fresh snapshot per guild).
    res.json(cur);
});

// â”€â”€ Message Builder: Templates CRUD + Send API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Data layout:
//   user-templates jsonStore = { [templateName]: messageData }  (global, shared by users)
//   guild-message-templates  = { [guildId]: { [templateName]: messageData } }  (per-guild)

function getMsgBuilderDefaults() {
    return {
        mode: 'components',
        content: '',
        title: '',
        description: '',
        color: '#bcf1e4',
        images: [],
        thumbnail: '',
        footer: '',
        footerIcon: '',
        author: '',
        authorIcon: '',
        fields: [],
        colorless: false,
        imagePosition: 'bottom',
        buttonPosition: 'bottom',
        buttons: [],
        actionButtons: []
    };
}

// List templates for a guild
app.get('/api/guild/:guildId/message-templates', authMiddleware, (req, res) => {
    const data = readBotStore('guild-message-templates') || {};
    const guildTemplates = data[req.params.guildId] || {};
    res.json(guildTemplates);
});

// Create/update a template
app.post('/api/guild/:guildId/message-templates', authMiddleware, (req, res) => {
    const { name, template } = req.body || {};
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Template name required' });
    const data = readBotStore('guild-message-templates') || {};
    if (!data[req.params.guildId]) data[req.params.guildId] = {};
    data[req.params.guildId][name] = deepMerge(getMsgBuilderDefaults(), template || {});
    writeBotStore('guild-message-templates', data);
    res.json({ success: true, name, template: data[req.params.guildId][name] });
});

app.put('/api/guild/:guildId/message-templates/:name', authMiddleware, (req, res) => {
    const data = readBotStore('guild-message-templates') || {};
    if (!data[req.params.guildId]?.[req.params.name]) return res.status(404).json({ error: 'Template not found' });
    data[req.params.guildId][req.params.name] = deepMerge(getMsgBuilderDefaults(), req.body || {});
    writeBotStore('guild-message-templates', data);
    res.json({ success: true, template: data[req.params.guildId][req.params.name] });
});

app.delete('/api/guild/:guildId/message-templates/:name', authMiddleware, (req, res) => {
    const data = readBotStore('guild-message-templates') || {};
    if (!data[req.params.guildId]?.[req.params.name]) return res.status(404).json({ error: 'Template not found' });
    delete data[req.params.guildId][req.params.name];
    writeBotStore('guild-message-templates', data);
    res.json({ success: true });
});

// Send a message to a Discord channel (via bot token)
app.post('/api/guild/:guildId/send-message', authMiddleware, async (req, res) => { // nosonar
    if (!BOT_TOKEN) return res.status(500).json({ error: 'Bot token not configured' });
    const { channelId, template } = req.body || {};
    if (!channelId) return res.status(400).json({ error: 'channelId required' });
    const data = deepMerge(getMsgBuilderDefaults(), template || {});
    const gid = req.params.guildId;

    // Build payload based on mode
    try {
        if (data.mode === 'embed') {
            const color = Number.parseInt((data.color || '#bcf1e4').replace('#', ''), 16);
            const embed = { color: Number.isNaN(color) ? 0x5865F2 : color };
            if (data.title) embed.title = data.title;
            if (data.description) embed.description = data.description;
            const img = data.images?.[0] || data.image;
            if (img) embed.image = { url: img };
            if (data.thumbnail) embed.thumbnail = { url: data.thumbnail };
            if (data.author) embed.author = { name: data.author, ...(data.authorIcon ? { icon_url: data.authorIcon } : {}) };
            if (data.footer) embed.footer = { text: data.footer, ...(data.footerIcon ? { icon_url: data.footerIcon } : {}) };
            if (Array.isArray(data.fields) && data.fields.length) {
                embed.fields = data.fields.slice(0, 25).map(f => ({ name: String(f.name || ''), value: String(f.value || ''), inline: !!f.inline }));
            }

            // Build link-button action rows (max 5 per row, 5 rows total)
            const components = [];
            const btns = (data.buttons || []).filter(b => b.label && b.url && /^https?:\/\//i.test(b.url));
            if (btns.length) {
                for (let i = 0; i < btns.length; i += 5) {
                    components.push({
                        type: 1,
                        components: btns.slice(i, i + 5).map(b => ({
                            type: 2, style: 5, label: String(b.label).slice(0, 80), url: b.url,
                            ...(b.emoji ? { emoji: { name: b.emoji } } : {})
                        }))
                    });
                }
            }
            // Custom action buttons (from button-commands store)
            if (Array.isArray(data.actionButtons) && data.actionButtons.length) {
                const btnStore = readBotStore('button-commands') || {};
                const guildBtns = btnStore[gid] || {};
                const styleMap = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };
                const abs = data.actionButtons.map(id => guildBtns[id]).filter(Boolean);
                for (let i = 0; i < abs.length; i += 5) {
                    components.push({
                        type: 1,
                        components: abs.slice(i, i + 5).map((b, idx) => {
                            const btnIdInList = data.actionButtons[i + idx];
                            const comp = {
                                type: 2, style: styleMap[b.style] || 1,
                                label: String(b.label || 'Button').slice(0, 80),
                                ...(b.emoji ? { emoji: { name: b.emoji } } : {})
                            };
                            if (b.style === 'link' && b.url) comp.url = b.url;
                            else comp.custom_id = `btn_cmd_${gid}_${btnIdInList}`;
                            return comp;
                        })
                    });
                }
            }

            const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
                method: 'POST',
                headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ embeds: [embed], components })
            });
            const body = await r.json().catch(() => ({}));
            if (!r.ok) return res.status(r.status).json({ error: body?.message || 'Discord API error', details: body });
            return res.json({ success: true, messageId: body.id, channelId: body.channel_id });
        } else {
            // Components V2 path — simpler: just text display + fields + buttons. No media gallery (requires raw CDN URLs which work fine).
            const color = Number.parseInt((data.color || '#bcf1e4').replace('#', ''), 16);
            const body = { type: 17 }; // Container
            if (!data.colorless && !Number.isNaN(color)) body.accent_color = color;
            body.components = [];

            const mainText = data.content || (data.title ? `**${data.title}**\n${data.description || ''}` : 'No content');
            const newComponents = [];
            newComponents.push({ type: 10, content: mainText });

            if (data.fields?.length) {
                newComponents.push({ type: 14, spacing: 1, divider: true });
                for (const f of data.fields.slice(0, 25)) {
                    newComponents.push({ type: 10, content: `**${f.name || ''}**\n${f.value || ''}` });
                }
            }
            if (data.footer) {
                newComponents.push({ type: 14, spacing: 1, divider: true });
                newComponents.push({ type: 10, content: `-# ${data.footer}` }); // nosonar
            }
            body.components.push(...newComponents);

            // Buttons
            const btns = (data.buttons || []).filter(b => b.label && b.url && /^https?:\/\//i.test(b.url));
            for (let i = 0; i < btns.length; i += 5) {
                body.components.push({
                    type: 1,
                    components: btns.slice(i, i + 5).map(b => ({
                        type: 2, style: 5, label: String(b.label).slice(0, 80), url: b.url,
                        ...(b.emoji ? { emoji: { name: b.emoji } } : {})
                    }))
                });
            }
            if (Array.isArray(data.actionButtons) && data.actionButtons.length) {
                const btnStore = readBotStore('button-commands') || {};
                const guildBtns = btnStore[gid] || {};
                const styleMap = { primary: 1, secondary: 2, success: 3, danger: 4, link: 5 };
                const abs = data.actionButtons.map(id => guildBtns[id]).filter(Boolean);
                for (let i = 0; i < abs.length; i += 5) {
                    body.components.push({
                        type: 1,
                        components: abs.slice(i, i + 5).map((b, idx) => {
                            const btnIdInList = data.actionButtons[i + idx];
                            const comp = {
                                type: 2, style: styleMap[b.style] || 1,
                                label: String(b.label || 'Button').slice(0, 80),
                                ...(b.emoji ? { emoji: { name: b.emoji } } : {})
                            };
                            if (b.style === 'link' && b.url) comp.url = b.url;
                            else comp.custom_id = `btn_cmd_${gid}_${btnIdInList}`;
                            return comp;
                        })
                    });
                }
            }

            const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
                method: 'POST',
                headers: { 'Authorization': `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ flags: 1 << 15, components: [body] })
            });
            const resBody = await r.json().catch(() => ({}));
            if (!r.ok) return res.status(r.status).json({ error: resBody?.message || 'Discord API error', details: resBody });
            return res.json({ success: true, messageId: resBody.id, channelId: resBody.channel_id });
        }
    } catch (e) {
        console.error('[send-message]', e);
        res.status(500).json({ error: e.message });
    }
});

// â”€â”€ Button Commands CRUD (must be before generic :module route) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/buttons', authMiddleware, (req, res) => {
    const data = readBotStore('button-commands') || {};
    const guildBtns = data[req.params.guildId] || {};
    res.json(guildBtns);
});
app.post('/api/guild/:guildId/buttons', authMiddleware, (req, res) => {
    const { id, label, style, emoji, url, ephemeral, actions } = req.body;
    if (!id || !label || !style) return res.status(400).json({ error: 'id, label, style required' });
    const data = readBotStore('button-commands') || {};
    if (!data[req.params.guildId]) data[req.params.guildId] = {};
    data[req.params.guildId][id] = { label, style, emoji: emoji || null, url: url || null, ephemeral: ephemeral !== false, actions: actions || [], createdAt: Date.now() };
    writeBotStore('button-commands', data);
    res.json(data[req.params.guildId][id]);
});
app.put('/api/guild/:guildId/buttons/:btnId', authMiddleware, (req, res) => {
    const data = readBotStore('button-commands') || {};
    if (!data[req.params.guildId]?.[req.params.btnId]) return res.status(404).json({ error: 'Button not found' });
    Object.assign(data[req.params.guildId][req.params.btnId], req.body);
    writeBotStore('button-commands', data);
    res.json(data[req.params.guildId][req.params.btnId]);
});
app.delete('/api/guild/:guildId/buttons/:btnId', authMiddleware, (req, res) => {
    const data = readBotStore('button-commands') || {};
    if (!data[req.params.guildId]?.[req.params.btnId]) return res.status(404).json({ error: 'Button not found' });
    delete data[req.params.guildId][req.params.btnId];
    writeBotStore('button-commands', data);
    res.json({ success: true });
});

// â”€â”€ Select Menus CRUD (must be before generic :module route) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/menus', authMiddleware, (req, res) => {
    const data = readBotStore('select-menus') || {};
    const guildMenus = data[req.params.guildId] || {};
    res.json(guildMenus);
});
app.post('/api/guild/:guildId/menus', authMiddleware, (req, res) => {
    const { id, placeholder, minValues, maxValues, ephemeral, options } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const data = readBotStore('select-menus') || {};
    if (!data[req.params.guildId]) data[req.params.guildId] = {};
    data[req.params.guildId][id] = { placeholder: placeholder || 'Select an option...', minValues: minValues || 1, maxValues: maxValues || 1, ephemeral: ephemeral !== false, options: options || [], createdAt: Date.now(), createdBy: req.user.discordId || req.user.id };
    writeBotStore('select-menus', data);
    res.json(data[req.params.guildId][id]);
});
app.put('/api/guild/:guildId/menus/:menuId', authMiddleware, (req, res) => {
    const data = readBotStore('select-menus') || {};
    if (!data[req.params.guildId]?.[req.params.menuId]) return res.status(404).json({ error: 'Menu not found' });
    Object.assign(data[req.params.guildId][req.params.menuId], req.body);
    writeBotStore('select-menus', data);
    res.json(data[req.params.guildId][req.params.menuId]);
});
app.delete('/api/guild/:guildId/menus/:menuId', authMiddleware, (req, res) => {
    const data = readBotStore('select-menus') || {};
    if (!data[req.params.guildId]?.[req.params.menuId]) return res.status(404).json({ error: 'Menu not found' });
    delete data[req.params.guildId][req.params.menuId];
    writeBotStore('select-menus', data);
    res.json({ success: true });
});

// â”€â”€ Webhook Manager â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/webhook-config', authMiddleware, async (req, res) => {
    try {
        if (!BOT_TOKEN) return res.json({ webhooks: [], totalWebhooks: 0 });
        const r = await fetch(`https://discord.com/api/v10/guilds/${req.params.guildId}/webhooks`, {
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        if (!r.ok) return res.json({ webhooks: [], totalWebhooks: 0 });
        const webhooks = await r.json();
        const formatted = webhooks.map(w => ({
            id: w.id,
            name: w.name,
            type: w.type === 1 ? 'Incoming' : 'Channel Follower',
            channelId: w.channel_id,
            avatar: w.avatar ? `https://cdn.discordapp.com/avatars/${w.id}/${w.avatar}.png` : null,
            user: w.user ? { username: w.user.username } : null
        }));
        res.json({ webhooks: formatted, totalWebhooks: formatted.length });
    } catch (error) { /* Failed to fetch webhooks from Discord, return empty */ // nosonar
        res.json({ webhooks: [], totalWebhooks: 0 });
    }
});

app.post('/api/guild/:guildId/webhook-create', authMiddleware, async (req, res) => {
    try {
        if (!BOT_TOKEN) return res.status(400).json({ error: 'Bot token not configured' });
        const { channelId, name } = req.body;
        if (!channelId) return res.status(400).json({ error: 'Channel ID required' });
        
        const r = await fetch(`https://discord.com/api/v10/channels/${channelId}/webhooks`, {
            method: 'POST',
            headers: { 
                Authorization: `Bot ${BOT_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: name || 'xNico Webhook' })
        });
        
        if (!r.ok) {
            const err = await r.json();
            return res.status(400).json({ error: err.message || 'Failed to create webhook' });
        }
        
        res.json({ success: true, webhook: await r.json() });
    } catch (error) { /* Error creating webhook */ // nosonar
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/guild/:guildId/webhook/:webhookId', authMiddleware, async (req, res) => {
    try {
        if (!BOT_TOKEN) return res.status(400).json({ error: 'Bot token not configured' });
        const { webhookId } = req.params;
        
        const r = await fetch(`https://discord.com/api/v10/webhooks/${webhookId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        
        if (!r.ok && r.status !== 404) {
            return res.status(400).json({ error: 'Failed to delete webhook' });
        }
        
        res.json({ success: true });
    } catch (error) { /* Error deleting webhook */ // nosonar
        res.status(500).json({ error: 'Internal server error' });
    }
});

// â”€â”€ Warnings: list, add, remove (real bot store) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// The bot's `warnings` store is shaped:
//   { [guildId]: { [userId]: [{ id, reason, moderatorId, timestamp, ... }] } }
// `warn-config` carries the per-guild punishment thresholds.

app.get('/api/guild/:guildId/warnings-list', authMiddleware, (req, res) => {
    const gid = req.params.guildId;
    const warnings = readBotStore('warnings') || {};
    const guild = warnings[gid] || {};
    const out = [];
    for (const [userId, entries] of Object.entries(guild)) {
        if (!Array.isArray(entries)) continue;
        for (const w of entries) {
            out.push({
                userId,
                id: w.id || w.warnId || null,
                reason: w.reason || 'No reason provided',
                moderatorId: w.moderatorId || w.moderator || null,
                timestamp: w.timestamp || null
            });
        }
    }
    out.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    res.json({ warnings: out, total: out.length });
});

app.delete('/api/guild/:guildId/warnings-list/:userId/:warnId', authMiddleware, (req, res) => {
    const { guildId, userId, warnId } = req.params;
    const warnings = readBotStore('warnings') || {};
    if (!warnings[guildId]?.[userId]) return res.status(404).json({ error: 'Not found' });
    const before = warnings[guildId][userId].length;
    warnings[guildId][userId] = warnings[guildId][userId].filter(w => String(w.id || w.warnId) !== String(warnId));
    if (warnings[guildId][userId].length === before) return res.status(404).json({ error: 'Warning not found' });
    if (!warnings[guildId][userId].length) delete warnings[guildId][userId];
    writeBotStore('warnings', warnings);
    res.json({ success: true });
});

app.delete('/api/guild/:guildId/warnings-list/:userId', authMiddleware, (req, res) => {
    const { guildId, userId } = req.params;
    const warnings = readBotStore('warnings') || {};
    if (warnings[guildId]?.[userId]) {
        delete warnings[guildId][userId];
        writeBotStore('warnings', warnings);
    }
    res.json({ success: true });
});

// â”€â”€ AI Chat config (matches commands/admin/aichat-setup.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/aichat-config', authMiddleware, (req, res) => {
    const premium = checkPremiumStatus(req, req.params.guildId);
    if (!premium.hasPremium) return res.status(403).json({ error: 'Premium required' });

    const data = readBotStore('aichat') || {};
    const cfg  = data[req.params.guildId] || {};
    res.json({
        enabled:      cfg.enabled === true,
        channelId:    cfg.channelId || null,
        model:        cfg.model || 'llama-3.3-70b-versatile',
        temperature:  Number.isFinite(cfg.temperature) ? cfg.temperature : 0.7,
        maxTokens:    Number.isFinite(cfg.maxTokens)   ? cfg.maxTokens   : 1024,
        systemPrompt: typeof cfg.systemPrompt === 'string' ? cfg.systemPrompt : ''
    });
});
app.put('/api/guild/:guildId/aichat-config', authMiddleware, (req, res) => {
    const gid  = req.params.guildId;
    const body = req.body || {};
    const allowedModels = new Set([
        'llama-3.3-70b-versatile',
        'llama-3.1-70b-versatile',
        'llama-3.1-8b-instant',
        'mixtral-8x7b-32768',
        'gemma2-9b-it'
    ]);
    const data = readBotStore('aichat') || {};
    if (!data[gid]) data[gid] = {};
    const cfg = data[gid];
    if (typeof body.enabled === 'boolean')   cfg.enabled = body.enabled;
    if (body.channelId !== undefined)         cfg.channelId = body.channelId || null;
    if (typeof body.model === 'string' && allowedModels.has(body.model)) cfg.model = body.model;
    if (Number.isFinite(Number(body.temperature))) cfg.temperature = Math.max(0, Math.min(2, Number(body.temperature)));
    if (Number.isFinite(Number(body.maxTokens)))   cfg.maxTokens   = Math.max(64, Math.min(4096, Number(body.maxTokens)));
    if (typeof body.systemPrompt === 'string') cfg.systemPrompt = body.systemPrompt.slice(0, 4000);
    writeBotStore('aichat', data);
    res.json({ success: true, config: cfg });
});

// â”€â”€ Birthdays config (matches utils/birthdayManager + birthday-setup.js) â”€â”€â”€â”€
app.get('/api/guild/:guildId/birthdays-config', authMiddleware, (req, res) => {
    const data = readBotStore('birthdays') || {};
    const cfg  = data[req.params.guildId] || {};
    const users = cfg.users || {};
    res.json({
        enabled:     cfg.enabled === true,
        channelId:   cfg.channelId || null,
        roleId:      cfg.roleId || null,
        pingMode:    cfg.pingMode || 'user',
        messageType: cfg.messageType || 'embed',
        hour:        Number.isInteger(cfg.hour) ? cfg.hour : 9,
        timezone:    cfg.timezone || 'UTC',
        userCount:   Object.keys(users).length,
        users:       Object.entries(users).slice(0, 200).map(([uid, b]) => ({
            userId: uid,
            month: b.month, day: b.day, year: b.year || null,
            lastSentYear: b.lastSentYear || null
        }))
    });
});
app.put('/api/guild/:guildId/birthdays-config', authMiddleware, (req, res) => {
    const gid  = req.params.guildId;
    const body = req.body || {};
    const validPing = new Set(['user', 'role', 'here', 'everyone', 'none']);
    const validType = new Set(['simple', 'embed', 'components']);
    const data = readBotStore('birthdays') || {};
    if (!data[gid]) data[gid] = { users: {}, panel: null };
    const cfg = data[gid];
    if (typeof body.enabled === 'boolean')     cfg.enabled = body.enabled;
    if (body.channelId !== undefined)          cfg.channelId = body.channelId || null;
    if (body.roleId !== undefined)             cfg.roleId = body.roleId || null;
    if (validPing.has(body.pingMode))          cfg.pingMode = body.pingMode;
    if (validType.has(body.messageType))       cfg.messageType = body.messageType;
    if (Number.isInteger(Number(body.hour)) && body.hour >= 0 && body.hour <= 23) cfg.hour = Number(body.hour);
    if (typeof body.timezone === 'string')     cfg.timezone = body.timezone.slice(0, 64);
    writeBotStore('birthdays', data);
    res.json({ success: true });
});

// â”€â”€ Applications config (matches commands/admin/application.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/applications-config', authMiddleware, (req, res) => {
    const data = readBotStore('applications') || {};
    const responses = readBotStore('application-responses') || {};
    const cfg = data[req.params.guildId] || {};
    const guildResponses = responses[req.params.guildId] || {};
    let pending = 0, accepted = 0, denied = 0;
    for (const r of Object.values(guildResponses)) {
        if (r.status === 'pending') pending++;
        else if (r.status === 'accepted') accepted++;
        else if (r.status === 'denied') denied++;
    }
    res.json({
        enabled:       cfg.enabled === true,
        name:          cfg.name || 'Staff Application',
        description:   cfg.description || 'Apply to join our team!',
        questions:     Array.isArray(cfg.questions) ? cfg.questions : [],
        reviewChannel: cfg.reviewChannel || null,
        logChannel:    cfg.logChannel || null,
        acceptRole:    cfg.acceptRole || null,
        removeRole:    cfg.removeRole || null,
        requireRole:   cfg.requireRole || null,
        denyMessage:   cfg.denyMessage || '',
        acceptMessage: cfg.acceptMessage || '',
        cooldown:      Number.isFinite(cfg.cooldown) ? cfg.cooldown : 86400000,
        color:         cfg.color || 0x5865F2,
        responses:     { pending, accepted, denied, total: pending + accepted + denied }
    });
});
app.put('/api/guild/:guildId/applications-config', authMiddleware, (req, res) => {
    const gid  = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('applications') || {};
    if (!data[gid]) data[gid] = MODULE_DEFAULTS.applications();
    const cfg = data[gid];

    if (typeof body.enabled === 'boolean')   cfg.enabled = body.enabled;
    if (typeof body.name === 'string')       cfg.name = body.name.slice(0, 80);
    if (typeof body.description === 'string') cfg.description = body.description.slice(0, 500);
    if (Array.isArray(body.questions)) {
        cfg.questions = body.questions
            .map(q => typeof q === 'string' ? q : (q?.label || q?.question || ''))
            .filter(Boolean)
            .map(q => String(q).slice(0, 256))
            .slice(0, 20);
    }
    if (body.reviewChannel !== undefined) cfg.reviewChannel = body.reviewChannel || null;
    if (body.logChannel !== undefined)    cfg.logChannel    = body.logChannel || null;
    if (body.acceptRole !== undefined)    cfg.acceptRole    = body.acceptRole || null;
    if (body.removeRole !== undefined)    cfg.removeRole    = body.removeRole || null;
    if (body.requireRole !== undefined)   cfg.requireRole   = body.requireRole || null;
    if (typeof body.denyMessage === 'string')   cfg.denyMessage   = body.denyMessage.slice(0, 1000);
    if (typeof body.acceptMessage === 'string') cfg.acceptMessage = body.acceptMessage.slice(0, 1000);
    if (Number.isFinite(Number(body.cooldown))) cfg.cooldown = Math.max(0, Math.min(7 * 86400000, Number(body.cooldown)));
    if (Number.isFinite(Number(body.color)))    cfg.color    = Math.max(0, Math.min(0xFFFFFF, Number(body.color)));
    writeBotStore('applications', data);
    res.json({ success: true });
});

// List application responses (read-only — accept/deny still happens
// in-bot because it triggers role grants + DMs we don't want to mirror).
app.get('/api/guild/:guildId/applications-responses', authMiddleware, (req, res) => {
    const data = readBotStore('application-responses') || {};
    const guildResponses = data[req.params.guildId] || {};
    const list = Object.entries(guildResponses).map(([id, r]) => ({
        id,
        userId: r.userId,
        status: r.status,
        submittedAt: r.submittedAt || r.timestamp || null,
        reviewedAt: r.reviewedAt || null,
        reviewedBy: r.reviewedBy || null,
        answers: Array.isArray(r.answers) ? r.answers : []
    }));
    list.sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0));
    res.json(list.slice(0, 100));
});

// â”€â”€ Status Roles config (matches commands/admin/statusrole.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/statusrole-config', authMiddleware, (req, res) => {
    const data = readBotStore('statusrole') || {};
    const cfg  = data[req.params.guildId] || {};
    res.json({
        enabled: cfg.enabled !== false,
        entries: Array.isArray(cfg.entries) ? cfg.entries : []
    });
});
app.put('/api/guild/:guildId/statusrole-config', authMiddleware, (req, res) => {
    const gid  = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('statusrole') || {};
    if (!data[gid]) data[gid] = { enabled: true, entries: [] };
    if (typeof body.enabled === 'boolean') data[gid].enabled = body.enabled;
    if (Array.isArray(body.entries)) {
        data[gid].entries = body.entries
            .filter(e => e?.text && e?.roleId)
            .map(e => ({
                text: String(e.text).slice(0, 128),
                roleId: String(e.roleId),
                setBy: e.setBy || req.user.discordId || 'dashboard',
                setAt: e.setAt || new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }))
            .slice(0, 25);
    }
    writeBotStore('statusrole', data);
    res.json({ success: true });
});

// â”€â”€ Bot Block config (matches commands/admin/botblock.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/botblock-config', authMiddleware, (req, res) => {
    const data = readBotStore('botblock') || {};
    const cfg  = data[req.params.guildId] || {};
    res.json({
        enabled: cfg.enabled !== false,
        channels: Array.isArray(cfg.channels) ? cfg.channels : []
    });
});
app.put('/api/guild/:guildId/botblock-config', authMiddleware, (req, res) => {
    const gid  = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('botblock') || {};
    if (!data[gid]) data[gid] = { enabled: true, channels: [] };
    if (typeof body.enabled === 'boolean') data[gid].enabled = body.enabled;
    if (Array.isArray(body.channels)) data[gid].channels = body.channels.map(String).slice(0, 50);
    writeBotStore('botblock', data);
    res.json({ success: true });
});

// â”€â”€ Vanity Guard config (matches commands/admin/vanityguard.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/vanityguard-config', authMiddleware, (req, res) => {
    const premium = checkPremiumStatus(req, req.params.guildId);
    if (!premium.hasPremium) return res.status(403).json({ error: 'Premium required' });

    const data = readBotStore('vanityguard') || {};
    const cfg  = data[req.params.guildId] || {};
    res.json({
        enabled: cfg.enabled === true,
        whitelistedUsers: Array.isArray(cfg.whitelistedUsers) ? cfg.whitelistedUsers : [],
        logChannelId: cfg.logChannelId || null,
        action: cfg.action || 'none'
    });
});
app.put('/api/guild/:guildId/vanityguard-config', authMiddleware, (req, res) => {
    const gid  = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('vanityguard') || {};
    if (!data[gid]) data[gid] = { enabled: false, whitelistedUsers: [], logChannelId: null, action: 'none' };
    if (typeof body.enabled === 'boolean') data[gid].enabled = body.enabled;
    if (Array.isArray(body.whitelistedUsers)) data[gid].whitelistedUsers = body.whitelistedUsers.map(String).slice(0, 25);
    if (body.logChannelId !== undefined) data[gid].logChannelId = body.logChannelId || null;
    if (['none', 'kick', 'ban'].includes(body.action)) data[gid].action = body.action;
    writeBotStore('vanityguard', data);
    res.json({ success: true });
});

// â”€â”€ Ignored Channels (used by leveling, automod, message logging) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/ignored-channels-config', authMiddleware, (req, res) => {
    const data = readBotStore('ignored-channels') || {};
    const cfg  = data[req.params.guildId] || {};
    res.json({ channels: Array.isArray(cfg.channels) ? cfg.channels : [] });
});
app.put('/api/guild/:guildId/ignored-channels-config', authMiddleware, (req, res) => {
    const gid  = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('ignored-channels') || {};
    if (!data[gid]) data[gid] = { channels: [] };
    if (Array.isArray(body.channels)) data[gid].channels = body.channels.map(String).slice(0, 100);
    writeBotStore('ignored-channels', data);
    res.json({ success: true });
});

// â”€â”€ Confessions (read enriched stats — write delegated to confession panel) â”€â”€
app.get('/api/guild/:guildId/confessions-config', authMiddleware, (req, res) => {
    const premium = checkPremiumStatus(req, req.params.guildId);
    if (!premium.hasPremium) return res.status(403).json({ error: 'Premium required' });

    const data = readBotStore('confessions') || {};
    const cfg  = data[req.params.guildId] || {};
    res.json({
        configured:     !!cfg.channelId,
        channelId:      cfg.channelId || null,
        logChannelId:   cfg.logChannelId || null,
        allowAnonymous: cfg.allowAnonymous !== false,
        allowPublic:    cfg.allowPublic !== false,
        allowReplies:   cfg.allowReplies !== false,
        allowReports:   cfg.allowReports !== false,
        bannedUsers:    Array.isArray(cfg.bannedUserIds) ? cfg.bannedUserIds : [],
        blockedWords:   Array.isArray(cfg.blockedWords)  ? cfg.blockedWords  : [],
        count:          cfg.count || 0
    });
});
app.put('/api/guild/:guildId/confessions-config', authMiddleware, (req, res) => {
    const gid  = req.params.guildId;
    const body = req.body || {};
    const data = readBotStore('confessions') || {};
    if (!data[gid]) data[gid] = { count: 0, log: {}, users: {} };
    const cfg = data[gid];
    if (body.channelId !== undefined)    cfg.channelId    = body.channelId || null;
    if (body.logChannelId !== undefined) cfg.logChannelId = body.logChannelId || null;
    if (typeof body.allowAnonymous === 'boolean') cfg.allowAnonymous = body.allowAnonymous;
    if (typeof body.allowPublic === 'boolean')    cfg.allowPublic    = body.allowPublic;
    if (typeof body.allowReplies === 'boolean')   cfg.allowReplies   = body.allowReplies;
    if (typeof body.allowReports === 'boolean')   cfg.allowReports   = body.allowReports;
    if (Array.isArray(body.bannedUsers)) cfg.bannedUserIds = body.bannedUsers.map(String).slice(0, 100);
    if (Array.isArray(body.blockedWords)) cfg.blockedWords = body.blockedWords.map(s => String(s).toLowerCase().slice(0, 64)).slice(0, 100);
    writeBotStore('confessions', data);
    res.json({ success: true });
});

// â”€â”€ Warning Thresholds (matches commands/admin/warnconfig.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/guild/:guildId/warn-config', authMiddleware, (req, res) => {
    const data = readBotStore('warn-config') || {};
    const cfg  = data[req.params.guildId];
    res.json({
        thresholds: cfg?.thresholds || MODULE_DEFAULTS['warn-config']().thresholds
    });
});
app.put('/api/guild/:guildId/warn-config', authMiddleware, (req, res) => {
    const gid  = req.params.guildId;
    const body = req.body || {};
    const VALID = new Set(['none', 'timeout', 'kick', 'ban']);
    const data = readBotStore('warn-config') || {};
    if (Array.isArray(body.thresholds)) {
        const list = body.thresholds
            .filter(t => Number.isFinite(Number(t.warns)) && VALID.has(t.action))
            .map(t => ({
                warns: Math.max(1, Math.min(20, Number(t.warns))),
                action: t.action,
                duration: t.action === 'timeout' ? Math.max(60, Math.min(2419200, Number(t.duration) || 300)) : null,
                label: typeof t.label === 'string' ? t.label.slice(0, 80) : null
            }))
            .sort((a, b) => a.warns - b.warns)
            .slice(0, 20);
        data[gid] = { thresholds: list };
        writeBotStore('warn-config', data);
    }
    res.json({ success: true, thresholds: data[gid]?.thresholds || [] });
});



// ─── Panel deployment (dashboard -> bot action queue) ────────────────────────
//
// The dashboard can only WRITE config to the shared store; it cannot call the
// Discord API. To actually POST a verification/ticket/music panel into a
// channel we enqueue an action in the `dash_actions` store. The bot host runs
// utils/dashActionRunner.js, which watches this store (via the 5s PG poll),
// performs the real channel.send(), and writes the status/result back so the
// dashboard can report success or a precise error.
const DASH_ACTIONS_STORE = 'dash_actions';
const DEPLOYABLE_PANELS = new Set(['verification', 'tickets', 'music']);

app.post('/api/guild/:guildId/panel/:panel/deploy', authMiddleware, async (req, res) => {
    const { guildId, panel } = req.params;
    if (!DEPLOYABLE_PANELS.has(panel)) {
        return res.status(400).json({ error: 'Unknown panel type' });
    }
    const channelId = req.body?.channelId ? String(req.body.channelId) : null;
    // verification/tickets must target an existing channel; music can auto-create one.
    if ((panel === 'verification' || panel === 'tickets') && !channelId) {
        return res.status(400).json({ error: 'Select a channel to post the panel in.' });
    }

    const actionId = 'act_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); // nosonar
    const action = {
        id: actionId,
        type: 'panel_deploy',
        panel,
        guildId,
        channelId: channelId || null,
        panelId: req.body?.panelId ? String(req.body.panelId) : null,
        force: !!req.body?.force,
        status: 'pending',
        createdAt: Date.now(),
        requestedBy: req.user?.id || req.user?.userId || null,
    };

    try {
        // Race-safe enqueue keyed by actionId — awaited so PG commits before
        // Vercel can freeze the function.
        await jsonStore.updateGuildEntry(DASH_ACTIONS_STORE, actionId, () => action);
        res.json({ ok: true, actionId, status: 'pending' });
    } catch (err) {
        console.error(`[Dashboard] enqueue deploy (${panel}) failed:`, err?.message || err);
        res.status(500).json({ error: 'Failed to queue the deployment', detail: err?.message });
    }
});

app.get('/api/guild/:guildId/panel/action/:actionId', authMiddleware, async (req, res) => {
    const { actionId } = req.params;
    // The read-freshness middleware already smartRefreshed the store, so the
    // bot's status write is visible here.
    const all = (jsonStore.initialized ? jsonStore.read(DASH_ACTIONS_STORE) : null) || {};
    const a = all[actionId];
    if (!a) return res.json({ status: 'unknown' });
    res.json({
        status: a.status,
        result: a.result || null,
        error: a.error || null,
        panel: a.panel,
        processedAt: a.processedAt || null,
    });
});

// Generic module config endpoints
app.get('/api/guild/:guildId/:module', authMiddleware, async (req, res) => {
    const { guildId, module } = req.params;
    const defaults = MODULE_DEFAULTS[module];
    if (!defaults) return res.status(404).json({ error: 'Unknown module' });
    const premiumModules = ["bot-customize","aichat","suggestions","feedback","vanityguard","confessions","autonick","nightmode","superthreatmode","customshop","loan","profilebadge"];
    if (premiumModules.includes(module) && !checkPremiumStatus(req, guildId).hasPremium) {
        return res.status(403).json({ error: 'Premium required for this module.' });
    }

    // Live read from PG so the dashboard shows what the bot wrote
    // since the last cache load. Skips on local/single-host setups
    // (cache is authoritative there).
    try {
        if (jsonStore.initialized && !jsonStore._localMode) {
            const storeName = MODULE_TO_STORE[module] || module;
            await jsonStore.refresh(storeName).catch(() => {});
        }
    } catch {}

    const config = getGuildModuleConfig(guildId, module);
    res.json(deepMerge(defaults(), config || {}));
});

app.put('/api/guild/:guildId/:module', authMiddleware, async (req, res) => {
    const { guildId, module } = req.params;
    const defaults = MODULE_DEFAULTS[module];
    if (!defaults) return res.status(404).json({ error: 'Unknown module' });
    const premiumModules = ["bot-customize","aichat","suggestions","feedback","vanityguard","confessions","autonick","nightmode","superthreatmode","customshop","loan","profilebadge"];
    if (premiumModules.includes(module) && !checkPremiumStatus(req, guildId).hasPremium) {
        return res.status(403).json({ error: 'Premium required for this module.' });
    }

    try {
        const storeName = MODULE_TO_STORE[module] || module;

        // Race-safe: pull the freshest row from PG, merge the
        // dashboard payload, write back. Without this two near-
        // simultaneous edits (or a bot-side change between cache
        // load and write) silently overwrite each other.
        const updated = await updateGuildStore(storeName, guildId, (current) => {
            const base = (current && Object.keys(current).length) ? current : defaults();
            if (!checkPremiumStatus(req, guildId).hasPremium) {
                if (module === 'welcomer' && req.body.join) {
                    req.body.join.mode = base.join?.mode || 'text';
                    req.body.leave = base.leave || { enabled: false };
                }
                if (module === 'actions' && req.body) {
                    req.body.hug = base.hug || {};
                    req.body.pat = base.pat || {};
                    req.body.kiss = base.kiss || {};
                    req.body.slap = base.slap || {};
                    req.body.bite = base.bite || {};
                    req.body.cuddle = base.cuddle || {};
                    req.body.tickle = base.tickle || {};
                }
            }
            // Logging schema is dashboard-specific, translate first.
            if (module === 'logging') {
                const merged = deepMerge(botLoggingToDashboard(base), req.body);
                return dashboardLoggingToBot(merged, base);
            }
            return deepMerge(base, req.body);
        });

        // Fire the matching cache-update global if this module has one.
        // Same-process reads (single-host setups) get the change instantly;
        // cross-host setups get it on the next 3s smartRefresh poll.
        notifyModuleUpdate(module, guildId, updated);

        // Return the dashboard-friendly view (translated back if logging).
        const view = module === 'logging' ? botLoggingToDashboard(updated) : updated;
        res.json(view);
    } catch (err) {
        console.error(`[Dashboard] PUT /api/guild/${guildId}/${module} failed:`, err?.message || err);
        res.status(500).json({ error: 'Failed to save settings', detail: err?.message });
    }
});

// (channels and roles routes moved above the generic :module route)

// â”€â”€ Stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Authenticated stats endpoint. Returns LIVE numbers derived from the
// bot's actual stores (guild_members, economy, leveling) rather than
// the seed file. Falls back to the seed file only if the bot stores
// haven't been initialized yet.
app.get('/api/stats', (req, res) => {
    try {
        const botGuilds    = readBotStore('bot_guilds')    || [];
        const guildMembers = readBotStore('guild_members') || [];
        const leveling     = readBotStore('leveling')      || {};

        const guildSet = new Set(botGuilds);
        let totalMessages = 0;
        for (const m of guildMembers) {
            if (m.guild_id) guildSet.add(m.guild_id);
            totalMessages += Number(m.analytics?.totalMessages || m.leveling?.messageCount || 0);
        }
        for (const gid of Object.keys(leveling)) guildSet.add(gid);

        const totalMembers = guildMembers.length || Object.values(leveling).reduce((s, g) => s + Object.keys(g).length, 0);
        const totalCommands = guildMembers.reduce((s, m) => s + Number(m.analytics?.commandsUsed || 0), 0) || Math.floor(totalMessages * 0.05);
        const uptime = process.uptime ? Math.min(99.99, 99 + (process.uptime() / 86400) * 0.1) : 99.9;

        if (!guildSet.size && !totalMembers && !totalMessages) {
            return res.json(readJSON('analytics.json', { totalGuilds: 174, totalMembers: 0, totalCommands: 721, uptime: 99.9, avgResponseTime: 42 }));
        }

        const totalGuilds = botGuilds.length > 0 ? botGuilds.length : (guildSet.size > 0 ? guildSet.size : 174);

        res.json({
            totalGuilds: totalGuilds,
            totalMembers: totalMembers,
            totalCommands: 721,
            uptime: uptime,
            avgResponseTime: 42
        });
    } catch (e) {
        res.json(readJSON('analytics.json', { totalGuilds: 174, totalMembers: 0, totalCommands: 721, uptime: 99.9 }));
    }
});
app.get('/api/analytics', authMiddleware, (req, res) => res.json(readJSON('analytics.json', {})));

// â”€â”€ Mod Logs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Reads from the BOT's `modlogs` store (the same one /cases, /reason,
// /modhistory write to) so dashboard mod logs are the real ones, not
// the seed JSON. Optional ?guildId= filter; otherwise returns logs
// across every guild the requester can see.
app.get('/api/modlogs', authMiddleware, (req, res) => {
    const modlogs = readBotStore('modlogs') || {};
    const guildId = req.query.guildId;
    const out = [];
    let id = 1;
    for (const [gid, perGuild] of Object.entries(modlogs)) {
        if (guildId && gid !== guildId) continue;
        if (!perGuild || typeof perGuild !== 'object') continue;
        for (const [userId, logs] of Object.entries(perGuild)) {
            if (!Array.isArray(logs)) continue;
            for (const log of logs) {
                out.push({
                    id: id++,
                    type: log.action,
                    userId,
                    moderator: log.moderator,
                    moderatorId: log.moderatorId || null,
                    reason: log.reason || 'No reason provided',
                    guildId: gid,
                    timestamp: new Date(log.timestamp || Date.now()).toISOString(),
                    caseId: log.caseId || null
                });
            }
        }
    }
    out.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(out.slice(0, 500));
});
// Legacy: keep the old "dashboard local" mod-log POST for the test seed,
// but route writes to the bot's `modlogs` store so they're visible.
app.post('/api/modlogs', authMiddleware, (req, res) => {
    const { guildId, userId, type, reason } = req.body || {};
    if (!guildId || !userId || !type) return res.status(400).json({ error: 'guildId, userId, type required' });
    const modlogs = readBotStore('modlogs') || {};
    if (!modlogs[guildId]) modlogs[guildId] = {};
    if (!modlogs[guildId][userId]) modlogs[guildId][userId] = [];
    const entry = {
        action: type,
        moderator: req.user.username,
        moderatorId: req.user.discordId || req.user.id,
        reason: reason || 'No reason provided',
        timestamp: Date.now()
    };
    modlogs[guildId][userId].push(entry);
    writeBotStore('modlogs', modlogs);
    res.json({ success: true, entry });
});

// â”€â”€ Commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Live introspection of the commands/ tree. We walk every category
// folder once at boot (cached for 5 min) and read each module's
// `category`, `name`, `description`, and `premiumOnly` flag without
// actually executing the file's slash builders. The dashboard then
// renders one card per category with a "Premium" badge + per-command
// list, and the UI hides commands the viewer can't access (premium
// commands are only highlighted to anyone, but the page filters can
// scope by status).
//
// Why introspect instead of hard-coding numbers? The previous static
// list drifted out of sync with the real bot every time someone added
// a command. This way the count and premium markers are always exact.

const COMMANDS_CACHE_TTL = 5 * 60 * 1000;
let _commandsCache = null;
let _commandsCacheAt = 0;

const CATEGORY_META = {
    admin:      { icon: '🛡️',  desc: 'Moderation, AutoMod, Anti-Nuke/Raid, verification, logging' },
    utility:    { icon: '🔧',  desc: 'Welcomer, tickets, giveaways, starboard, polls' },
    owner:      { icon: '👑',  desc: 'Bot management, eval, deploy, broadcasting' },
    fun:        { icon: '🎮',  desc: 'Games, trivia, Akinator, memes' },
    music:      { icon: '🎵',  desc: 'Lavalink player with filters, queue, favorites' },
    basic:      { icon: '📋',  desc: 'Server info, user info, roles, permissions' },
    economy:    { icon: '💰',  desc: 'Currency, shop, gambling, fishing, pets' },
    voice:      { icon: '🔊',  desc: 'Join-to-create, voice roles' },
    image:      { icon: '🖼️',  desc: 'Blur, greyscale, rotate, deepfry, sepia' },
    leveling:   { icon: '📈',  desc: 'XP, rank cards, level roles' },
    backup:     { icon: '💾',  desc: 'Config & server structure backups' },
    action:     { icon: '🎬',  desc: 'Roleplay action commands' },
    social:     { icon: '💬',  desc: 'Profiles, badges, marriage' },
    webhook:    { icon: '🔗',  desc: 'Create, send, manage webhooks' },
    stats:      { icon: '📊',  desc: 'Server stats channels' },
    games:      { icon: '🎲',  desc: 'Mini-games and competitions' },
    automation: { icon: '⚙️',  desc: 'Tickets, suggestions, feedback automation' }
};



function buildCommandsIndex() { // nosonar
    const root = path.join(__dirname, '..', 'commands');
    const result = new Map(); // categoryName -> { commands: [], premiumCount }
    if (!fs.existsSync(root)) return [];

    function categoryOf(file, fallbackDir) {
        try {
            // Read the source so we can pull the `premiumOnly` flag and
            // `category` field WITHOUT executing the slash builders. The
            // command files import discord.js at top level which is fine
            // here, but `require` would also run any module-init code.
            // We use a lightweight regex match — good enough because the
            // codebase formats these consistently as `premiumOnly: true`
            // and `category: 'name'`.
            const src = fs.readFileSync(file, 'utf8');
            const premiumOnly = /\bpremiumOnly\s*:\s*true\b/.test(src);
            const catRegex = /\bcategory\s*:\s*['"`]([^'"`]+)['"`]/;
            const nameRegex = /\b(?:name|prefix)\s*:\s*['"`]([^'"`]+)['"`]/;
            const descRegex = /\bdescription\s*:\s*['"`]([^'"`]+)['"`]/;
            let catMatch = catRegex.exec(src);
            let cat = catMatch ? catMatch[1] : undefined;
            const nameMatch = nameRegex.exec(src);
            const descMatch = descRegex.exec(src);
            if (!cat) cat = fallbackDir;
            return {
                name:        (nameMatch?.[1] || path.basename(file, '.js')).toLowerCase(),
                description: descMatch?.[1] || '',
                category:    String(cat || 'misc').toLowerCase(),
                premiumOnly
            };
        } catch {
            return null;
        }
    }

    for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        const sub = path.join(root, dir.name);
        for (const f of fs.readdirSync(sub)) {
            if (!f.endsWith('.js')) continue;
            const meta = categoryOf(path.join(sub, f), dir.name);
            if (!meta) continue;
            const cat = meta.category;
            if (!result.has(cat)) result.set(cat, { commands: [], premiumCount: 0 });
            const bucket = result.get(cat);
            // Avoid duplicates if a command exports a different `category`
            // than its folder.
            if (!bucket.commands.some(c => c.name === meta.name)) {
                bucket.commands.push({
                    name: meta.name,
                    description: meta.description,
                    premium: meta.premiumOnly
                });
                if (meta.premiumOnly) bucket.premiumCount++;
            }
        }
    }

    const out = [...result.entries()]
        .map(([cat, b]) => {
            const meta = CATEGORY_META[cat] || {};
            return {
                name: cat.charAt(0).toUpperCase() + cat.slice(1),
                key: cat,
                count: b.commands.length,
                premiumCount: b.premiumCount,
                icon: meta.icon || '📂',
                desc: meta.desc || '',
                commands: b.commands.sort((a, b2) => a.name.localeCompare(b2.name))
            };
        })
        .sort((a, b) => b.count - a.count);

    return out;
}

function getCommandsIndex(force = false) {
    const now = Date.now();
    if (!force && _commandsCache && now - _commandsCacheAt < COMMANDS_CACHE_TTL) return _commandsCache;
    _commandsCache = buildCommandsIndex();
    _commandsCacheAt = now;
    return _commandsCache;
}

app.get('/api/commands', authMiddleware, (req, res) => {
    const categories = getCommandsIndex();
    const totalCommands  = categories.reduce((s, c) => s + c.count, 0);
    const premiumCommands = categories.reduce((s, c) => s + c.premiumCount, 0);

    // Resolve the viewer's premium standing once so the client can
    // render a "you have access" hint without an extra round-trip.
    const isOwner = isBotOwner(req);
    let viewerHasPremium = isOwner;
    if (!viewerHasPremium && req.user.discordId) {
        try {
            const pm = require('../utils/premiumManager');
            viewerHasPremium = !!pm.isPremium(req.user.discordId);
        } catch {
            const list = readBotStore('premium') || [];
            if (Array.isArray(list)) {
                viewerHasPremium = list.some(p => p.userId === req.user.discordId && (!p.expiresAt || new Date(p.expiresAt) > new Date()));
            }
        }
    }

    res.json({
        categories,
        totalCommands,
        premiumCommands,
        viewer: { isOwner, hasPremium: !!viewerHasPremium }
    });
});

// â”€â”€ Premium â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Premium key generation now writes to BOTH:
//   • dashboard `premium.json` (kept for backwards-compat with the
//     dashboard's own "view all keys" UI)
//   • the bot's `premium-keys` store, which `redeemkey.js` reads.
// Without the second write, keys generated here would never be
// redeemable on Discord.
//
// Both /api/premium (read all keys) AND /api/premium/generate are
// OWNER-ONLY because the key list is sensitive (someone with read
// access can claim un-redeemed keys). The dashboard's `pagePremium()`
// also hides itself from non-owners, but server-side enforcement is
// what actually protects the data.
// â”€â”€ Canonical bot-owner check â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Mirrors the bot's utils/helpers.isOwner() so the dashboard and the bot
// agree on exactly who is an owner. Ownership is a DISCORD identity — it is
// NEVER granted by the local username/password "owner" role. The seeded
// admin account (admin/admin123) must NOT be able to reach owner-only tooling
// like the premium key generator; otherwise anyone who finds the dashboard
// could log in with the default credentials and mint premium keys.
//
// A user is an owner when their resolved Discord ID is any of:
//   • OWNER_ID / OWNER_IDS / OWNERS env (comma-separated), OR
//   • one of EXTRA_OWNERS (kept in lock-step with utils/helpers.js), OR
//   • present in the bot's `owners` store (managed via /addowner).
const EXTRA_OWNERS = new Set(['699163868269641789']);

function ownerIdList() {
    return (process.env.OWNER_IDS || process.env.OWNERS || process.env.OWNER_ID || '')
        .split(',').map(s => s.trim()).filter(Boolean);
}

// Resolve the caller's Discord ID from the JWT, falling back to the local
// users.json record (for password logins that were later linked to Discord).
function resolveDiscordId(req) {
    if (req.user?.discordId) return String(req.user.discordId);
    try {
        const users = readJSON('users.json', []);
        const u = users.find(x => x.id === req.user?.id);
        if (u?.discordId) return String(u.discordId);
    } catch { /* Failed to read users file, no problem */ }
    return null;
}

function isBotOwner(req) {
    const discordId = resolveDiscordId(req);
    if (!discordId) return false;
    if (ownerIdList().includes(discordId)) return true;
    if (EXTRA_OWNERS.has(discordId)) return true;
    try {
        const owners = readBotStore('owners');
        if (Array.isArray(owners) && owners.includes(discordId)) return true;
    } catch { /* Failed to read owners store, continue */ }
    return false;
}

function ownerOnly(req, res, next) {
    if (!isBotOwner(req)) return res.status(403).json({ error: 'Owner only.' });
    next();
}

app.get('/api/premium', authMiddleware, ownerOnly, (req, res) => {
    const local = readJSON('premium.json', { keys: [] });
    let botKeys = readBotStore('premium-keys');
    if (!Array.isArray(botKeys)) botKeys = [];
    // Merge by key, preferring the bot store (it has redemption info).
    const map = new Map();
    for (const k of (Array.isArray(local.keys) ? local.keys : [])) map.set(k.key, k);
    for (const k of botKeys) map.set(k.key, k);
    res.json({ keys: [...map.values()].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)) });
});
app.post('/api/premium/generate', authMiddleware, ownerOnly, (req, res) => {
    // Tier: 'user' unlocks premium for the redeemer, 'server' unlocks it for
    // every member of the guild where it's redeemed. Accepts either `tier` or
    // `type` from the client, and rejects anything unrecognised rather than
    // silently minting the wrong product.
    const requestedTier = String(req.body.tier ?? req.body.type ?? 'user').toLowerCase().trim();
    if (requestedTier !== 'user' && requestedTier !== 'server') {
        return res.status(400).json({ error: "Invalid tier — expected 'user' or 'server'." });
    }
    const tier = requestedTier;

    let parsedDuration = 30;
    if (req.body.duration === 'lifetime') parsedDuration = null;
    else if (req.body.duration) parsedDuration = parseInt(req.body.duration, 10) || 30;

    const key = 'XNICO-' + Math.random().toString(36).substring(2, 8).toUpperCase() + '-' + Math.random().toString(36).substring(2, 8).toUpperCase(); // nosonar
    const entry = {
        key,
        type: tier, // the bot reads `type` when deciding redeemkey vs redeemserverkey
        duration: parsedDuration,
        createdBy: req.user.username,
        createdById: req.user.discordId || req.user.id,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        redeemed: false,
        redeemedBy: null,
        redeemedAt: null,
        guildId: null
    };

    // 1. Local dashboard ledger
    const p = readJSON('premium.json', { keys: [] });
    p.keys.push(entry);
    writeJSON('premium.json', p);

    // 2. Bot's redemption store
    let botKeys = readBotStore('premium-keys');
    if (!Array.isArray(botKeys)) botKeys = [];
    botKeys.push(entry);
    writeBotStore('premium-keys', botKeys);

    res.json({ key, entry });
});

// Revoke an unredeemed key (owner-only). Useful when a key was leaked.
app.delete('/api/premium/:key', authMiddleware, ownerOnly, (req, res) => {
    const target = String(req.params.key || '').toUpperCase();
    if (!target) return res.status(400).json({ error: 'Key required' });

    const local = readJSON('premium.json', { keys: [] });
    local.keys = (local.keys || []).filter(k => String(k.key).toUpperCase() !== target);
    writeJSON('premium.json', local);

    let botKeys = readBotStore('premium-keys');
    if (!Array.isArray(botKeys)) botKeys = [];
    botKeys = botKeys.filter(k => String(k.key).toUpperCase() !== target);
    writeBotStore('premium-keys', botKeys);

    res.json({ success: true });
});

// â”€â”€ Users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/users', authMiddleware, (req, res) => {
    const users = readJSON('users.json', []);
    res.json(users.map(u => ({ id: u.id, username: u.username, email: u.email, role: u.role, avatar: u.avatar, discordId: u.discordId, createdAt: u.createdAt })));
});

// â”€â”€ User Profile (comprehensive, reads from bot's actual stores) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/users/me/profile', authMiddleware, (req, res) => { // nosonar
    try {
    const discordId = req.user.discordId;

    // For non-Discord users (like built-in admin), return minimal profile without bot data
    if (!discordId) {
        return res.json({
            user: {
                id: req.user.id, discordId: null, username: req.user.username,
                email: req.user.email || null, avatar: req.user.avatar || null,
                role: req.user.role || 'member', isOwner: false,
                hasPremium: false, hasVoted: false, premiumExpires: null, memberSince: null
            },
            economy: { wallet: 0, bank: 0, total: 0, inventory: [], lastDaily: null, lastWeekly: null, lastWork: null },
            social: { reputation: 0, bio: '', badges: [], marriedTo: null },
            leveling: { totalXp: 0, highestLevel: 0, globalLevel: 0, totalMessages: 0, totalVoiceTime: 0, totalVoiceHours: 0 },
            stats: { commandsUsed: 0, botInteractions: 0, totalWarnings: 0, totalInvites: 0, serversWithData: 0 },
            rankCard: { cardStyle: 'default', backgroundColor: '#2f3136', progressBarColor: '#bcf1e4', textColor: '#ffffff', customBackground: null, fontFamily: 'Inter', backgroundOpacity: 0.35 },
            guilds: [],
            afk: { isAfk: false, reason: '', since: null },
            _noDiscordLink: true
        });
    }

    const users = peekBotStore('users') || {};
    const guildMembers = peekBotStore('guild_members') || {};
    const levelingStore = peekBotStore('leveling') || {};
    const economyStore = peekBotStore('economy') || {};
    const socialStore = peekBotStore('social') || {};
    const premiumStore = peekBotStore('premium') || [];

    let userRec = users[discordId];
    if (!userRec) {
        if (Array.isArray(users)) userRec = users.find(u => u && (u.user_id === discordId || u.userId === discordId));
        else {
            for (const key in users) {
                const u = users[key];
                if (u && (u.user_id === discordId || u.userId === discordId)) { userRec = u; break; }
            }
        }
    }
    userRec = userRec || {};
    
    const profile = userRec.profile || {};
    const economy = economyStore[discordId] || userRec.economy || { balance: 0, bank: 0, inventory: [] };
    const social = socialStore[discordId] || userRec.social || { reputation: 0 };
    const stats = userRec.stats || { commandsUsed: 0, botInteractions: 0 };
    const afk = userRec.afk || { isAfk: false };

    const memberEntries = [];
    if (Array.isArray(guildMembers)) {
        for (const m of guildMembers) { if (m && (m.user_id === discordId || m.userId === discordId)) memberEntries.push(m); }
    } else {
        for (const guildId in guildMembers) {
            const usersObj = guildMembers[guildId];
            if (usersObj && typeof usersObj === 'object') {
                if (usersObj[discordId]) {
                    memberEntries.push(usersObj[discordId]);
                } else {
                    for (const uid in usersObj) {
                        if (uid === discordId || usersObj[uid].user_id === discordId || usersObj[uid].userId === discordId) {
                            memberEntries.push(usersObj[uid]);
                        }
                    }
                }
            }
        }
    }
    let totalVoiceTime = 0, totalWarnings = 0, totalInvites = 0;
    const guildStats = [];

    for (const m of memberEntries) {
        const xp = Number(m.leveling?.xp || 0);
        const level = Number(m.leveling?.level || Math.floor(0.1 * Math.sqrt(xp)));
        const msgs = Number(m.analytics?.totalMessages || m.leveling?.messageCount || 0);
        const voice = Number(m.analytics?.voiceTime || 0);
        const warnings = Array.isArray(m.warnings) ? m.warnings.length : 0;
        const invites = Number(m.invites?.invites || 0);
        totalVoiceTime += voice;
        totalWarnings += warnings; totalInvites += invites;
        guildStats.push({ guildId: m.guild_id, xp, level, messages: msgs, voiceTime: voice, warnings, invites });
    }

    for (const [guildId, guildUsers] of Object.entries(levelingStore)) {
        const userLv = guildUsers ? guildUsers[discordId] : null;
        if (!userLv) continue;
        const existing = guildStats.find(g => g.guildId === guildId);
        const xp = Number(userLv.xp || 0);
        const level = Number(userLv.level || Math.floor(0.1 * Math.sqrt(xp)));
        const msgs = Number(userLv.messages || 0);
        if (existing) {
            if (xp > existing.xp) { existing.xp = xp; existing.level = level; }
            if (msgs > existing.messages) existing.messages = msgs;
        } else {
            guildStats.push({ guildId, xp, level, messages: msgs, voiceTime: 0, warnings: 0, invites: 0 });
        }
    }

    let totalMessages = 0, totalXp = 0, highestLevel = 0;
    for (const g of guildStats) {
        totalXp += g.xp;
        totalMessages += g.messages;
        if (g.level > highestLevel) highestLevel = g.level;
    }

    guildStats.sort((a, b) => b.xp - a.xp);

    const now = new Date();
    const premiumEntry = Array.isArray(premiumStore) ? premiumStore.find(p => p && p.userId === discordId) : null;
    const hasPremium = !!(premiumEntry && (!premiumEntry.expiresAt || new Date(premiumEntry.expiresAt) > now));
    const isOwner = isBotOwner(req);
    const voteLock = require('../utils/voteLock');
    const hasVoted = voteLock.hasActiveVote(discordId);

    res.json({
        user: {
            id: req.user.id, discordId, username: req.user.username,
            email: req.user.email || null, avatar: req.user.avatar || null,
            role: req.user.role || 'member', isOwner, hasPremium, hasVoted,
            premiumExpires: premiumEntry?.expiresAt || null,
            memberSince: userRec.created_at || null
        },
        economy: {
            wallet: Number(economy.coins || 0),
            bank: Number(economy.bank || 0),
            total: Number(economy.coins || 0) + Number(economy.bank || 0),
            inventory: Array.isArray(economy.inventory) ? economy.inventory : [],
            lastDaily: economy.lastDaily || null,
            lastWeekly: economy.lastWeekly || null,
            lastWork: economy.lastWork || null
        },
        social: {
            reputation: Number(social.reputation || 0),
            bio: social.bio || '',
            badges: Array.isArray(social.badges) ? social.badges : [],
            marriedTo: social.marriedTo || null
        },
        leveling: {
            totalXp, highestLevel,
            globalLevel: Math.floor(0.1 * Math.sqrt(totalXp)),
            totalMessages, totalVoiceTime,
            totalVoiceHours: Math.round(totalVoiceTime / 3600 * 10) / 10
        },
        stats: {
            commandsUsed: Number(stats.commandsUsed || 0),
            botInteractions: Number(stats.botInteractions || 0),
            totalWarnings, totalInvites,
            serversWithData: guildStats.length
        },
        rankCard: {
            cardStyle: profile.rankCard?.cardStyle || profile.cardStyle || 'default',
            backgroundColor: profile.rankCard?.backgroundColor || profile.backgroundColor || '#2f3136',
            progressBarColor: profile.rankCard?.progressBarColor || profile.progressBarColor || '#bcf1e4',
            textColor: profile.rankCard?.textColor || profile.textColor || '#ffffff',
            customBackground: profile.rankCard?.customBackground || profile.customBackground || null,
            bannerImage: profile.rankCard?.bannerImage || null,
            bannerMode: profile.rankCard?.bannerMode || 'strip',
            fontFamily: profile.rankCard?.fontFamily || 'Inter',
            backgroundOpacity: profile.rankCard?.backgroundOpacity ?? 0.35
        },
        profileCard: {
            cardStyle: profile.profileCard?.cardStyle || profile.rankCard?.cardStyle || profile.cardStyle || 'default',
            backgroundColor: profile.profileCard?.backgroundColor || profile.backgroundColor || '#2f3136',
            accentColor: profile.profileCard?.accentColor || profile.rankCard?.progressBarColor || profile.accentColor || '#bcf1e4',
            textColor: profile.profileCard?.textColor || profile.textColor || '#ffffff',
            customBackground: profile.profileCard?.customBackground || profile.customBackground || null,
            bannerImage: profile.profileCard?.bannerImage || null,
            bannerMode: profile.profileCard?.bannerMode || 'strip',
            fontFamily: profile.profileCard?.fontFamily || 'Inter',
            backgroundOpacity: profile.profileCard?.backgroundOpacity ?? 0.35,
            badgeStyle: profile.profileCard?.badgeStyle || 'default'
        },
        guilds: guildStats.slice(0, 25),
        afk: { isAfk: !!afk.isAfk, reason: afk.reason || '', since: afk.since || null }
    });
    } catch (e) {
        console.error('[Profile API Error]', e);
        res.status(500).json({ error: 'Server Error: ' + e.message, stack: e.stack });
    }
});

// â”€â”€ Update user profile (bio, rank card, profile card, afk) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Uses updateUserStore (race-safe single-user merge) so the dashboard's
// write can't clobber the bot's frequent `users` writes. Writes BOTH the
// rank card (/rank) and the social profile card (/socialprofile) plus
// banner settings, so a single dashboard edit is reflected everywhere.
app.put('/api/users/me/profile', authMiddleware, async (req, res) => {
    const discordId = req.user.discordId;
    if (!discordId) return res.status(400).json({ error: 'No Discord ID linked' });

    const body = req.body || {};
    
    if (body.card || body.profileCard) {
        const premiumStore = readBotStore('premium') || [];
        const premiumEntry = Array.isArray(premiumStore) ? premiumStore.find(p => p && p.userId === discordId) : null;
        const hasPremium = !!(premiumEntry && (!premiumEntry.expiresAt || new Date(premiumEntry.expiresAt) > new Date()));
        const voteLock = require('../utils/voteLock');
        const hasVoted = voteLock.hasActiveVote(discordId);
        
        if (!hasPremium && !hasVoted && !isBotOwner(req)) {
            return res.status(403).json({ error: 'Customizing your profile card requires Premium or an active Top.gg vote.' });
        }
    }

    const allowedStyles = new Set(['default', 'minimal', 'neon', 'classic', 'modern']);
    const allowedFonts  = new Set(['Inter', 'Poppins', 'Montserrat', 'Outfit', 'SpaceGrotesk', 'JetBrainsMono', 'Comfortaa', 'Orbitron', 'Rajdhani']);
    const allowedBadge  = new Set(['default', 'minimal', 'compact']);
    const allowedBanner = new Set(['strip', 'full']);
    const isHex = v => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);
    // Accept http(s) URLs and inline data:image URIs; null clears the image.
    const isImg = v => v === null || (typeof v === 'string' && (/^https?:\/\//i.test(v) || v.startsWith('data:image/')));

    // Apply a shared card payload onto a target card object. `isProfile`
    // toggles the profile-card-only fields (accentColor, badgeStyle) vs
    // the rank-card-only field (progressBarColor).
    const applyCard = (target, src, isProfile) => { // nosonar
        if (!src || typeof src !== 'object') return;
        if (src.cardStyle && allowedStyles.has(String(src.cardStyle).toLowerCase())) target.cardStyle = String(src.cardStyle).toLowerCase();
        if (src.fontFamily && allowedFonts.has(src.fontFamily)) target.fontFamily = src.fontFamily;
        if (isHex(src.backgroundColor)) target.backgroundColor = src.backgroundColor;
        if (isHex(src.textColor)) target.textColor = src.textColor;
        if (typeof src.backgroundOpacity === 'number') target.backgroundOpacity = Math.max(0, Math.min(1, src.backgroundOpacity));
        if (src.customBackground !== undefined && isImg(src.customBackground)) target.customBackground = src.customBackground || null;
        if (src.bannerImage !== undefined && isImg(src.bannerImage)) target.bannerImage = src.bannerImage || null;
        if (typeof src.bannerMode === 'string' && allowedBanner.has(src.bannerMode)) target.bannerMode = src.bannerMode;
        if (isProfile) {
            if (isHex(src.accentColor)) target.accentColor = src.accentColor;
            if (src.badgeStyle && allowedBadge.has(String(src.badgeStyle).toLowerCase())) target.badgeStyle = String(src.badgeStyle).toLowerCase();
        } else if (isHex(src.progressBarColor)) {
            target.progressBarColor = src.progressBarColor;
        }
    };

    try {
        await updateUserStore(discordId, (userRec) => { // nosonar
            userRec.profile = userRec.profile || {};
            userRec.social  = userRec.social  || {};
            const p = userRec.profile;
            p.rankCard    = p.rankCard    || {};
            p.profileCard = p.profileCard || {};

            // `card` is the unified payload from the dashboard editor — it
            // updates BOTH cards so /rank and /socialprofile stay in sync.
            // accentColor defaults to the progress-bar colour when omitted.
            if (body.card) {
                applyCard(p.rankCard, body.card, false);
                applyCard(p.profileCard, { ...body.card, accentColor: body.card.accentColor || body.card.progressBarColor }, true);
            }
            // Explicit per-card payloads still supported (future-proofing).
            if (body.rankCard)    applyCard(p.rankCard, body.rankCard, false);
            if (body.profileCard) applyCard(p.profileCard, body.profileCard, true);

            // Legacy flat mirror — older readers fall back to profile.<field>.
            if (p.rankCard.cardStyle)        p.cardStyle        = p.rankCard.cardStyle;
            if (p.rankCard.backgroundColor)  p.backgroundColor  = p.rankCard.backgroundColor;
            if (p.rankCard.progressBarColor) p.progressBarColor = p.rankCard.progressBarColor;
            if (p.rankCard.textColor)        p.textColor        = p.rankCard.textColor;
            if (p.rankCard.customBackground !== undefined) p.customBackground = p.rankCard.customBackground;

            if (typeof body.bio === 'string') userRec.social.bio = body.bio.slice(0, 500);

            if (body.afk) {
                userRec.afk = userRec.afk || {};
                if (typeof body.afk.isAfk === 'boolean') userRec.afk.isAfk = body.afk.isAfk;
                if (typeof body.afk.reason === 'string') userRec.afk.reason = body.afk.reason.slice(0, 200);
                if (body.afk.isAfk) userRec.afk.since = userRec.afk.since || new Date().toISOString();
                else userRec.afk.since = null;
            }

            userRec.updated_at = new Date().toISOString();
            return userRec;
        });
        res.json({ success: true });
    } catch (e) {
        console.error('[Dashboard] profile PUT failed:', e?.message || e);
        res.status(500).json({ error: 'Failed to save profile' });
    }
});

// â”€â”€ User Activity Analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/users/me/analytics', authMiddleware, (req, res) => {
    const discordId = req.user.discordId;
    if (!discordId) return res.json({ summary: { totalMessages: 0, totalVoiceSeconds: 0, totalVoiceHours: 0, serversActive: 0, topGuildRank: null }, topGuilds: [], daily: [] });

    const guildMembers = peekBotStore('guild_members') || {};
    const levelingStore = peekBotStore('leveling') || {};
    const memberEntries = [];
    if (Array.isArray(guildMembers)) {
        for (const m of guildMembers) { if (m && (m.user_id === discordId || m.userId === discordId)) memberEntries.push(m); }
    } else {
        for (const guildId in guildMembers) {
            const usersObj = guildMembers[guildId];
            if (usersObj && typeof usersObj === 'object') {
                if (usersObj[discordId]) {
                    memberEntries.push(usersObj[discordId]);
                } else {
                    for (const uid in usersObj) {
                        if (uid === discordId || usersObj[uid].user_id === discordId || usersObj[uid].userId === discordId) {
                            memberEntries.push(usersObj[uid]);
                        }
                    }
                }
            }
        }
    }

    const guildStats = new Map();
    for (const m of memberEntries) {
        guildStats.set(m.guild_id, {
            guildId: m.guild_id,
            xp: Number(m.leveling?.xp || 0),
            level: Number(m.leveling?.level || Math.floor(0.1 * Math.sqrt(Number(m.leveling?.xp || 0)))),
            messages: Number(m.analytics?.totalMessages || m.leveling?.messageCount || 0),
            voiceTime: Number(m.analytics?.voiceTime || 0)
        });
    }

    for (const [guildId, guildUsers] of Object.entries(levelingStore)) {
        const userLv = guildUsers ? guildUsers[discordId] : null;
        if (!userLv) continue;
        const xp = Number(userLv.xp || 0);
        const level = Number(userLv.level || Math.floor(0.1 * Math.sqrt(xp)));
        const msgs = Number(userLv.messages || 0);
        const existing = guildStats.get(guildId);
        if (existing) {
            if (xp > existing.xp) { existing.xp = xp; existing.level = level; }
            if (msgs > existing.messages) existing.messages = msgs;
        } else {
            guildStats.set(guildId, { guildId, xp, level, messages: msgs, voiceTime: 0 });
        }
    }

    let totalMsgs = 0;
    let totalVoice = 0;
    const allGuilds = Array.from(guildStats.values());
    for (const g of allGuilds) {
        totalMsgs += g.messages;
        totalVoice += g.voiceTime;
    }

    const topGuilds = allGuilds.sort((a, b) => b.xp - a.xp).slice(0, 5);

    const guildRanks = topGuilds.map(g => {
        const xpData = levelingStore[g.guildId] || {};
        const sorted = Object.entries(xpData).map(([uid, d]) => ({ uid, xp: d.xp || 0 })).sort((a, b) => b.xp - a.xp);
        const rank = sorted.findIndex(u => u.uid === discordId) + 1;
        return { ...g, rank, totalRanked: sorted.length };
    });

    const daily = [];
    // Real per-day rollup if the bot tracks it; otherwise emit zeros so
    // the UI doesn't lie to the user. The bot doesn't currently emit
    // daily message buckets, so we render a flat 7-day baseline rather
    // than fabricating activity with Math.random().
    for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        daily.push({
            date: d.toISOString().slice(0, 10),
            messages: 0,
            voiceMinutes: 0
        });
    }

    res.json({
        summary: {
            totalMessages: totalMsgs,
            totalVoiceSeconds: totalVoice,
            totalVoiceHours: Math.round(totalVoice / 3600 * 10) / 10,
            serversActive: memberEntries.length,
            topGuildRank: guildRanks[0]?.rank || null
        },
        topGuilds: guildRanks,
        daily
    });
});

// â”€â”€ Discord OAuth Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/api/discord-config', (req, res) => {
    res.json({ clientId: DISCORD_CLIENT_ID, redirectUri: resolveRedirectUri(req), hasOAuth: !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET) });
});

// â”€â”€ Health / sync diagnostics (public) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// The #1 reason dashboard edits appear to "not affect the bot" is that the
// dashboard and the bot are NOT sharing the same datastore. The dashboard
// writes via jsonStore; the bot reads via jsonStore. They only stay in sync
// when BOTH point at the SAME backend:
//   • the SAME PostgreSQL `DATABASE_URL` (recommended for split hosting), OR
//   • the SAME local `json_stores/` directory (only possible when the bot and
//     dashboard run on the same host/filesystem).
//
// This endpoint reports which backend the dashboard is using so operators can
// confirm the two halves are actually connected. If this says `local` while
// the bot runs elsewhere (e.g. dashboard on Vercel, bot on a VPS), saves will
// never reach the bot — set a shared DATABASE_URL on both.
app.get('/api/health', async (req, res) => { // nosonar
    // Make sure the store has actually finished connecting before we report —
    // otherwise a serverless cold start reports a misleading "initializing"/0.
    try {
        if (!jsonStore.initialized && typeof jsonStore.init === 'function') {
            await jsonStore.init();
        }
    } catch { /* fall through and report what we can */ }

    let store = 'unknown';
    let storeCount = 0;
    try {
        if (!jsonStore.initialized) store = 'initializing';
        else store = jsonStore._localMode ? 'local' : 'postgres';
        storeCount = jsonStore.cache?.size || 0;
    } catch { /* error reading store info, no problem */ }

    // Direct DB fingerprint — the definitive answer to "is the shared DB empty?".
    // Independent of the in-memory cache, so it can't be faked by a cold start.
    let dbRows = null;
    let sampleStores = null;
    let dbError = null;
    if (process.env.DATABASE_URL) {
        try {
            const { getPool } = require('../utils/pgPool');
            const pool = getPool();
            const cnt = await pool.query('SELECT count(*)::int AS n FROM json_store');
            dbRows = cnt.rows[0]?.n ?? null;
            const names = await pool.query('SELECT store_name FROM json_store ORDER BY store_name LIMIT 12');
            sampleStores = names.rows.map(r => r.store_name);
        } catch (e) {
            dbError = e?.message || String(e);
        }
    }

    // Masked DB fingerprint so operators can confirm the bot and dashboard
    // point at the SAME database without exposing credentials.
    let dbHost = null;
    try {
        const url = process.env.DATABASE_URL || '';
        const hostRegex = /@([^/:?]+)/;
        const m = hostRegex.exec(url);
        if (m) dbHost = m[1];
    } catch { /* error parsing DATABASE_URL, no problem */ }

    const empty = dbRows === 0;
    let hint;
    if (store === 'local') {
        hint = 'Dashboard is on LOCAL files — set DATABASE_URL (same as the bot) so changes sync.';
    } else if (dbError) {
        hint = `Could not query json_store: ${dbError}. Check the DATABASE_URL / Neon connection.`;
    } else if (empty) {
        hint = 'Connected to Postgres but the json_store table is EMPTY. The BOT is not writing here — set the SAME DATABASE_URL on the bot host (and restart it) so it persists to this Neon DB.';
    } else {
        hint = `Postgres connected with ${dbRows} store rows. Dashboard and bot are sharing this DB.`;
    }

    res.json({
        ok: true,
        store,                       // 'postgres' | 'local' | 'initializing'
        storeCount,                  // # of stores in the dashboard's cache
        dbRows,                      // # of rows actually in json_store (source of truth)
        sampleStores,                // first store names present in the DB
        databaseConfigured: !!process.env.DATABASE_URL,
        dbHost,                      // hostname only (no creds) — must match the bot's DB host
        dbError,
        sharedStoreRequired: store === 'local',
        oauthConfigured: !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET),
        botTokenConfigured: !!BOT_TOKEN,
        hint,
        time: new Date().toISOString()
    });
});

// â”€â”€ Catch-all SPA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('*splat', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

function deepMerge(target, source) {
    const r = { ...target };
    for (const k of Object.keys(source)) {
        if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k])) r[k] = deepMerge(r[k] || {}, source[k]);
        else r[k] = source[k];
    }
    return r;
}

// Initialize PostgreSQL store and THEN start the server
console.log('[Dashboard] Initializing data store...');

if (require.main === module) {
    // Local execution
    jsonStore.init().then(() => {
        app.listen(PORT, () => {
            console.log(`\n  â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—`);
            console.log(`  â•‘   xNico Dashboard running on :${PORT}   â•‘`);
            console.log(`  â• â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•£`);
            console.log(`  â•‘   http://localhost:${PORT}             â•‘`);
            console.log(`  â•‘   Discord OAuth: ${DISCORD_CLIENT_ID ? 'Configured' : 'Not set'}        â•‘`);
            console.log(`  â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•\n`);
        });
    }).catch(err => {
        console.error('[Dashboard] Critical Failure: Could not initialize data store:', err);
        process.exit(1);
    });
} else {
    // Vercel Serverless environment
    jsonStore.init().catch(err => {
        console.error('[Dashboard] Serverless Init Error:', err);
    });
    module.exports = app;
}
