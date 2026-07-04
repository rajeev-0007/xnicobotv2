/**
 * Top.gg Stats Poster — pushes the bot's live guild count (and shard
 * count) to the Top.gg API so the bot's listing on top.gg reflects
 * reality.
 *
 * What this fixes
 * ───────────────
 * Without periodic POST /bots/:bot_id/stats calls, top.gg's listing
 * page shows a stale or empty "Servers" number. This module reads the
 * current `client.guilds.cache.size` and posts it to top.gg every 30
 * minutes (top.gg's recommended cadence), with retries and rate-limit
 * awareness (60 req/min limit per Authentication docs).
 *
 * Auth
 * ────
 * Set `TOPGG_TOKEN` in `.env` — get it from the bot's edit page on
 * top.gg → "API" tab → "Reset Token" or "Token".
 * NOTE: this is DIFFERENT from `TOPGG_WEBHOOK_SECRET` which is for
 * receiving votes. The Webhook secret cannot post stats.
 *
 * Sharding
 * ────────
 * In a ShardingManager setup the auto-poster fans out via the manager:
 *   - We post one aggregated `server_count` (sum of all shards) so the
 *     listing is always correct even when shards are uneven.
 *   - We also post `shards` array if more than one shard is running.
 *
 * Public API
 * ──────────
 *   const poster = require('./topggPoster');
 *   poster.start(client);   // begin auto-posting
 *   poster.stop();          // stop the timer
 *   await poster.postNow(client); // force-post immediately
 *
 * The `start()` call is a no-op when `TOPGG_TOKEN` is not set — so the
 * bot keeps running fine for self-hosters who don't list on top.gg.
 */

'use strict';

const https = require('https');
const log = require('./logger-styled');

const POST_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes (well under the 60/min limit)
const RETRY_BACKOFF_MS = 60 * 1000;      // wait 1 min on transient failure
const MAX_RETRIES      = 3;

let _timer = null;
let _retryTimer = null;
let _client = null;
let _lastPosted = 0;
let _lastPostedCount = -1;
let _failureCount = 0;

function getToken() {
    return (process.env.TOPGG_TOKEN || '').trim();
}

function getBotId(client) {
    return client?.user?.id || (process.env.CLIENT_ID || '').trim();
}

/**
 * Sum guild counts across all shards. In single-process mode this is
 * just the local cache size; under ShardingManager we ask each shard
 * for its size and sum them.
 *
 * Returns { totalGuilds: number, shardCounts: number[]|null }.
 */
async function collectStats(client) {
    // ShardingManager / ShardClientUtil (per-process) presence
    if (client.shard && typeof client.shard.fetchClientValues === 'function') {
        try {
            const sizes = await client.shard.fetchClientValues('guilds.cache.size');
            const arr = Array.isArray(sizes) ? sizes.map(n => Number(n) || 0) : [];
            const total = arr.reduce((a, b) => a + b, 0);
            return { totalGuilds: total, shardCounts: arr.length > 1 ? arr : null };
        } catch {
            // Fall through to local size if the IPC call fails (e.g. shard 0 only)
        }
    }
    return { totalGuilds: client.guilds.cache.size, shardCounts: null };
}

/**
 * POST to https://top.gg/api/bots/:bot_id/stats with the standard
 * Authorization header. Resolves on 2xx, rejects with status code on
 * non-2xx so the caller can decide whether to retry.
 */
function httpsPost(botId, token, payload) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const req = https.request({
            method: 'POST',
            host: 'top.gg',
            path: `/api/bots/${botId}/stats`,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
                'Authorization': token,
                'User-Agent': 'xnicobot-stats-poster/1.0'
            },
            timeout: 15_000
        }, res => {
            let chunks = '';
            res.on('data', d => { chunks += d.toString(); });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    return resolve({ status: res.statusCode, body: chunks });
                }
                const err = new Error(`Top.gg responded ${res.statusCode}: ${chunks.slice(0, 200)}`);
                err.status = res.statusCode;
                err.body = chunks;
                reject(err);
            });
        });
        req.on('timeout', () => {
            req.destroy(new Error('Top.gg POST timed out'));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

/**
 * Push current stats to top.gg. Returns the posted server count on
 * success, or null on failure (with the failure logged).
 */
async function postNow(client) {
    const c = client || _client;
    if (!c) return null;

    const token = getToken();
    if (!token) return null;

    const botId = getBotId(c);
    if (!botId) {
        log.warning('[Top.gg] Cannot post stats — no bot id available yet');
        return null;
    }

    const { totalGuilds, shardCounts } = await collectStats(c);
    if (!Number.isFinite(totalGuilds) || totalGuilds < 0) return null;

    // Skip the post if nothing has changed AND we already posted recently.
    // top.gg's listing only shows server_count so re-sending the same
    // value every 30m is redundant. Still post once an hour to keep the
    // listing's "last updated" timestamp fresh.
    const now = Date.now();
    if (totalGuilds === _lastPostedCount && now - _lastPosted < 60 * 60 * 1000) {
        return totalGuilds;
    }

    const payload = { server_count: totalGuilds };
    if (shardCounts && shardCounts.length > 1) {
        payload.shards = shardCounts;
        payload.shard_count = shardCounts.length;
    }

    try {
        await httpsPost(botId, token, payload);
        _lastPosted = now;
        _lastPostedCount = totalGuilds;
        _failureCount = 0;
        log.success(`[Top.gg] Posted server_count=${totalGuilds}${shardCounts ? ` shards=[${shardCounts.join(',')}]` : ''}`);
        return totalGuilds;
    } catch (err) {
        _failureCount++;
        const status = err.status;
        if (status === 401 || status === 403) {
            log.error(`[Top.gg] Authentication failed (${status}) — check TOPGG_TOKEN. Auto-poster disabled.`);
            stop();
            return null;
        }
        if (status === 404) {
            log.error(`[Top.gg] Bot ${botId} is not listed on Top.gg. Auto-poster disabled.`);
            stop();
            return null;
        }
        if (status === 429) {
            log.warning('[Top.gg] Rate-limited (429). Backing off for 1 minute.');
            scheduleRetry();
            return null;
        }
        log.warning(`[Top.gg] Stats post failed (${err.message?.slice(0, 120)}). Retrying soon.`);
        if (_failureCount < MAX_RETRIES) scheduleRetry();
        return null;
    }
}

function scheduleRetry() {
    if (_retryTimer) return;
    _retryTimer = setTimeout(() => {
        _retryTimer = null;
        postNow(_client).catch(() => {});
    }, RETRY_BACKOFF_MS);
    if (_retryTimer.unref) _retryTimer.unref();
}

/**
 * Begin periodic posting. Safe to call multiple times — re-calls
 * replace any existing timer with a fresh one bound to the new client.
 */
function start(client) {
    _client = client;

    if (!getToken()) {
        log.info('[Top.gg] TOPGG_TOKEN not configured — auto-poster disabled. ' +
                 'Add it to .env to enable server count syncing.');
        return false;
    }

    if (!getBotId(client)) {
        log.warning('[Top.gg] No bot id available — auto-poster will not start.');
        return false;
    }

    stop();

    // Post immediately on startup (gives top.gg the freshest data) and
    // again on the periodic schedule.
    postNow(client).catch(() => {});

    _timer = setInterval(() => {
        postNow(client).catch(() => {});
    }, POST_INTERVAL_MS);
    if (_timer.unref) _timer.unref();

    log.success('[Top.gg] Auto-poster started (every 30 minutes)');
    return true;
}

function stop() {
    if (_timer) {
        clearInterval(_timer);
        _timer = null;
    }
    if (_retryTimer) {
        clearTimeout(_retryTimer);
        _retryTimer = null;
    }
}

/**
 * Re-post on guild count change so the listing updates instantly when
 * the bot joins or leaves a server. Wires `guildCreate` and
 * `guildDelete` listeners; safe to call once after `start(client)`.
 */
function bindGuildEvents(client) {
    if (!client || client[Symbol.for('xnico.topgg.bound')]) return;
    try {
        Object.defineProperty(client, Symbol.for('xnico.topgg.bound'), {
            value: true,
            enumerable: false,
            configurable: true,
            writable: false
        });
    } catch {
        client[Symbol.for('xnico.topgg.bound')] = true;
    }

    const trigger = () => {
        // Debounce: a join + immediate leave shouldn't spam top.gg.
        if (bindGuildEvents._t) clearTimeout(bindGuildEvents._t);
        bindGuildEvents._t = setTimeout(() => {
            bindGuildEvents._t = null;
            postNow(client).catch(() => {});
        }, 5000);
        if (bindGuildEvents._t.unref) bindGuildEvents._t.unref();
    };

    client.on('guildCreate', trigger);
    client.on('guildDelete', trigger);
}

module.exports = { start, stop, postNow, bindGuildEvents, collectStats };
