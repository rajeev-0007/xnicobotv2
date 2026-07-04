'use strict';

/**
 * Uptime / Heartbeat Monitor
 * ──────────────────────────────────────────────────────────────────────────
 * Posts "went offline" / "came back online" notifications to a Discord
 * webhook, configured by the bot owner.
 *
 * Architecture (why it actually detects crashes):
 *   • The BOT (index.js child) writes a heartbeat file every few seconds with
 *     its start time, name and avatar.
 *   • The SHARD MANAGER (shard.js parent) runs `startMonitor()`. Because the
 *     parent process is separate from the bot child, it stays alive when the
 *     bot crashes/respawns — so it can see the heartbeat go stale ("No
 *     HeartBeat Received") and post the offline notice, then post the online
 *     notice once heartbeats resume.
 *
 * Everything is file-based (no DB) so the parent process needs no gateway or
 * PostgreSQL access.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

const DATA_DIR       = path.join(__dirname, '..', 'data');
const CONFIG_PATH    = path.join(DATA_DIR, 'uptime-monitor.json');
const HEARTBEAT_PATH = path.join(DATA_DIR, '.heartbeat.json');
const STATE_PATH     = path.join(DATA_DIR, '.uptime-state.json');

const DEFAULT_CONFIG = {
    enabled: false,
    webhookUrl: null,
    thresholdSec: 30,   // no heartbeat for this long ⇒ considered offline
    displayName: null,  // optional override; falls back to the bot username
};

const COLOR_OFFLINE = 0xED4245;
const COLOR_ONLINE  = 0x57F287;
const COLOR_TEST    = 0x5865F2;

/* ── small fs helpers ───────────────────────────────────────────────────── */

function _ensureDir() {
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
}

function _readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { return fallback; }
}

function _writeJson(file, data) {
    _ensureDir();
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); return true; }
    catch { return false; }
}

/* ── config ─────────────────────────────────────────────────────────────── */

function getConfig() {
    return { ...DEFAULT_CONFIG, ...(_readJson(CONFIG_PATH, {}) || {}) };
}

function setConfig(patch) {
    const cfg = { ...getConfig(), ...patch };
    _writeJson(CONFIG_PATH, cfg);
    return cfg;
}

/* ── heartbeat (written by the bot child) ───────────────────────────────── */

function writeHeartbeat({ startTime, botName, avatarUrl }) {
    _writeJson(HEARTBEAT_PATH, {
        lastBeat: Date.now(),
        startTime: startTime || Date.now(),
        botName: botName || null,
        avatarUrl: avatarUrl || null,
        pid: process.pid,
    });
}

function readHeartbeat() {
    return _readJson(HEARTBEAT_PATH, null);
}

/* ── formatting ─────────────────────────────────────────────────────────── */

function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    if (sec && !d) parts.push(`${sec}s`);
    return parts.join(' ') || '0s';
}

/* ── embed builders (classic embeds — webhooks render these natively) ───── */

function _name(hb, cfg) {
    return cfg.displayName || hb?.botName || 'Bot';
}

function buildOfflineEmbed(name, onlineMs, reason) {
    return {
        title: `${name} went offline`,
        color: COLOR_OFFLINE,
        description:
            `**Online Time:** ${formatDuration(onlineMs)}\n` +
            `**Reason:** ${reason || 'No HeartBeat Received'}`,
        timestamp: new Date().toISOString(),
        footer: { text: 'Uptime Monitor' },
    };
}

function buildOnlineEmbed(name, downtimeMs) {
    return {
        title: `${name} came back online`,
        color: COLOR_ONLINE,
        description:
            `**Downtime:** ${formatDuration(downtimeMs)}\n` +
            `${name} is now back online and fully operational`,
        timestamp: new Date().toISOString(),
        footer: { text: 'Uptime Monitor' },
    };
}

/* ── webhook poster ─────────────────────────────────────────────────────── */

/**
 * Single HTTPS POST attempt using Node's `https` module.
 * Forces IPv4 (`family: 4`) to avoid NAT64 / IPv6 (`64:ff9b::…`) connect
 * timeouts seen on some hosts, and enforces a hard per-attempt timeout so a
 * hung connection can never block the event loop. Never throws.
 * @returns {Promise<{ok:boolean, status:number, body?:string, error?:string}>}
 */
function _httpsPost(url, bodyStr, timeoutMs) {
    return new Promise((resolve) => {
        let u;
        try { u = new URL(url); } catch { return resolve({ ok: false, status: 0, error: 'invalid url' }); }
        if (u.protocol !== 'https:') return resolve({ ok: false, status: 0, error: 'not https' });

        const data = Buffer.from(bodyStr, 'utf8');
        let settled = false;
        let hardTimer = null;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            if (hardTimer) clearTimeout(hardTimer);
            try { req.destroy(); } catch {}
            resolve(result);
        };

        const req = https.request({
            hostname: u.hostname,
            port: 443,
            path: u.pathname + u.search,
            method: 'POST',
            family: 4, // force IPv4 — avoids NAT64/IPv6 connect timeouts
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length,
                'User-Agent': 'xNico-UptimeMonitor/1.0',
            },
        }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { if (body.length < 4000) body += c; });
            res.on('end', () => finish({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body }));
        });

        // Hard overall timeout — guarantees resolution even if the TCP connect
        // itself hangs (which req.setTimeout does NOT reliably bound).
        hardTimer = setTimeout(() => finish({ ok: false, status: 0, error: `timeout after ${timeoutMs}ms` }), timeoutMs);
        if (hardTimer.unref) hardTimer.unref();

        req.on('error', (err) => finish({ ok: false, status: 0, error: err.message }));
        req.write(data);
        req.end();
    });
}

/**
 * Post an embed to a Discord webhook with retries and rate-limit handling.
 * Fully self-contained and non-throwing — returns true on success, false
 * otherwise. Retries transient network/5xx errors; respects 429; does not
 * retry other 4xx (bad/expired webhook).
 */
async function postWebhook(url, embed, { username, avatarUrl, retries = 2, timeoutMs = 8000 } = {}) {
    if (!url) return false;
    const bodyStr = JSON.stringify({
        username: username || undefined,
        avatar_url: avatarUrl || undefined,
        embeds: [embed],
    });

    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await _httpsPost(url, bodyStr, timeoutMs);
        if (res.ok) return true;

        // Rate limited — wait the requested time (capped) then retry.
        if (res.status === 429) {
            let waitMs = 1000;
            try { const j = JSON.parse(res.body || '{}'); if (j.retry_after) waitMs = Math.ceil(j.retry_after * 1000); } catch {}
            await new Promise((r) => setTimeout(r, Math.min(waitMs, 5000)));
            continue;
        }

        // Client error other than 429 (e.g. 401/404 bad or deleted webhook) — no point retrying.
        if (res.status >= 400 && res.status < 500) return false;

        // Network error or 5xx — back off and retry.
        if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    return false;
}

/**
 * Send a test notification so the owner can confirm the webhook works.
 */
async function sendTest(cfg = getConfig()) {
    const hb = readHeartbeat();
    const name = _name(hb, cfg);
    const embed = {
        title: `${name} — Uptime Monitor Connected`,
        color: COLOR_TEST,
        description: 'This webhook is now configured for uptime notifications.\nYou will be pinged here when the bot goes offline or comes back online.',
        timestamp: new Date().toISOString(),
        footer: { text: 'Uptime Monitor' },
    };
    return postWebhook(cfg.webhookUrl, embed, { username: name, avatarUrl: hb?.avatarUrl, timeoutMs: 6000, retries: 1 });
}

/**
 * Post an "offline" notice immediately during a graceful shutdown/restart
 * (SIGTERM/SIGINT), and mark the state offline so recovery posts the
 * "came back online" notice. Called from shard.js before it exits.
 * Cannot fire on a hard kill / power loss (nothing is alive to post).
 */
async function notifyShutdown(reason = 'Manual Shutdown') {
    const cfg = getConfig();
    if (!cfg.enabled || !cfg.webhookUrl) return false;
    const hb = readHeartbeat();
    const name = _name(hb, cfg);
    const onlineMs = hb?.startTime ? Math.max(0, Date.now() - hb.startTime) : 0;
    _writeJson(STATE_PATH, { status: 'offline', offlineAt: Date.now() });
    return postWebhook(cfg.webhookUrl, buildOfflineEmbed(name, onlineMs, reason), { username: name, avatarUrl: hb?.avatarUrl, timeoutMs: 2500, retries: 0 });
}

/* ── the monitor loop (runs in the shard manager / parent process) ──────── */

function startMonitor({ pollMs = 5000, log = console } = {}) {
    let state = _readJson(STATE_PATH, { status: 'unknown', offlineAt: null });

    const save = () => _writeJson(STATE_PATH, state);

    const tick = async () => {
        const cfg = getConfig();
        if (!cfg.enabled || !cfg.webhookUrl) return;

        const hb = readHeartbeat();
        if (!hb || !hb.lastBeat) return; // bot has never started yet

        const now = Date.now();
        const age = now - hb.lastBeat;
        const thresholdMs = Math.max(15, cfg.thresholdSec || 30) * 1000;
        const name = _name(hb, cfg);

        // First observation — establish baseline without notifying.
        if (state.status === 'unknown') {
            state = { status: age > thresholdMs ? 'offline' : 'online', offlineAt: age > thresholdMs ? hb.lastBeat : null };
            save();
            return;
        }

        // Online → Offline transition
        if (state.status === 'online' && age > thresholdMs) {
            const onlineMs = Math.max(0, hb.lastBeat - (hb.startTime || hb.lastBeat));
            state = { status: 'offline', offlineAt: hb.lastBeat };
            save();
            const sent = await postWebhook(cfg.webhookUrl, buildOfflineEmbed(name, onlineMs, 'No HeartBeat Received'), { username: name, avatarUrl: hb.avatarUrl });
            try { log.warning?.(`[UptimeMonitor] ${name} went offline (online ${formatDuration(onlineMs)})${sent ? '' : ' — webhook post failed'}`); } catch {}
            return;
        }

        // Offline → Online transition (fresh heartbeat again)
        if (state.status === 'offline' && age <= thresholdMs) {
            const backAt = hb.startTime && hb.startTime > (state.offlineAt || 0) ? hb.startTime : now;
            const downtimeMs = Math.max(0, backAt - (state.offlineAt || backAt));
            state = { status: 'online', offlineAt: null };
            save();
            const sent = await postWebhook(cfg.webhookUrl, buildOnlineEmbed(name, downtimeMs), { username: name, avatarUrl: hb.avatarUrl });
            try { log.success?.(`[UptimeMonitor] ${name} came back online (down ${formatDuration(downtimeMs)})${sent ? '' : ' — webhook post failed'}`); } catch {}
        }
    };

    const timer = setInterval(() => { tick().catch(() => {}); }, pollMs);
    if (timer.unref) timer.unref();
    try { log.info?.(`[UptimeMonitor] Watching heartbeat every ${Math.round(pollMs / 1000)}s`); } catch {}
    return timer;
}

module.exports = {
    CONFIG_PATH, HEARTBEAT_PATH, STATE_PATH, DEFAULT_CONFIG,
    getConfig, setConfig,
    writeHeartbeat, readHeartbeat,
    formatDuration,
    buildOfflineEmbed, buildOnlineEmbed,
    postWebhook, sendTest, notifyShutdown,
    startMonitor,
};
