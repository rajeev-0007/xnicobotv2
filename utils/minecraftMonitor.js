'use strict';

/**
 * minecraftMonitor.js — Minecraft server status + live monitoring.
 *
 * Uses the free, key-less mcsrvstat.us API (works from any host, handles
 * SRV records, Java + Bedrock) to fetch server status, and keeps a live
 * auto-updating status message in a configured channel.
 *
 * Config (jsonStore 'minecraft', keyed by guildId):
 *   {
 *     enabled, host, port, edition: 'java'|'bedrock',
 *     channelId, messageId, intervalMin,
 *     color, showPlayers, lastOnline, updatedAt, setBy
 *   }
 *
 * The poller (started from index.js on ready) edits each guild's status
 * message on its interval. One-off lookups don't touch the store.
 */

const {
    ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
    SeparatorBuilder, SeparatorSpacingSize, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

const STORE = 'minecraft';
const MIN_INTERVAL_MIN = 2;          // mcsrvstat caches ~1-5min; don't poll faster
const DEFAULT_INTERVAL_MIN = 5;
const FETCH_TIMEOUT_MS = 15_000;

const COLORS = { online: 0x57F287, offline: 0xED4245, accent: 0x5865F2 };
const E = {
    online:  '<:online:1521228065752088576>',
    offline: '<:offline:1521228263177977897>',
    user:    '<:User:1521227714227343380>',
    arrow:   '<:Caretright:1521227704953864202>',
    box:     '<:Box:1521228152414666833>',
    clock:   '<:Clock:1521228110408847623>',
    refresh: '<:Refresh:1521227946441052420>',
};

/* ── config helpers ─────────────────────────────────────────── */

function loadAll() {
    try { return jsonStore.has(STORE) ? (jsonStore.read(STORE) || {}) : {}; }
    catch { return {}; }
}
function getConfig(guildId) {
    const all = loadAll();
    return all[guildId] || null;
}
function saveConfig(guildId, partial) {
    const all = loadAll();
    all[guildId] = { ...(all[guildId] || {}), ...partial, updatedAt: Date.now() };
    jsonStore.writeImmediate(STORE, all);
    return all[guildId];
}
function removeConfig(guildId) {
    const all = loadAll();
    if (!all[guildId]) return false;
    delete all[guildId];
    jsonStore.writeImmediate(STORE, all);
    return true;
}

/* ── status fetch ───────────────────────────────────────────── */

/**
 * Fetch Minecraft server status via mcsrvstat.us.
 * @param {string} host  hostname or host:port
 * @param {'java'|'bedrock'} edition
 * @returns {Promise<object>} normalized status
 */
async function fetchStatus(host, edition = 'java') {
    const clean = String(host || '').trim().replace(/^https?:\/\//, '');
    if (!clean) throw new Error('No host provided');

    const base = edition === 'bedrock'
        ? 'https://api.mcsrvstat.us/bedrock/3/'
        : 'https://api.mcsrvstat.us/3/';

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let data;
    try {
        const res = await fetch(base + encodeURIComponent(clean), {
            headers: { 'User-Agent': 'xNico-Bot (Minecraft monitor)' },
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`API ${res.status}`);
        data = await res.json();
    } finally {
        clearTimeout(t);
    }

    return {
        online: !!data.online,
        host: clean,
        ip: data.ip || null,
        port: data.port || null,
        version: data.version || (data.protocol && data.protocol.name) || null,
        motd: Array.isArray(data.motd?.clean) ? data.motd.clean.join('\n').trim() : null,
        players: {
            online: data.players?.online ?? 0,
            max: data.players?.max ?? 0,
            list: Array.isArray(data.players?.list) ? data.players.list.map(p => p.name || p) : [],
        },
        icon: typeof data.icon === 'string' && data.icon.startsWith('data:image') ? data.icon : null,
        edition,
        software: data.software || null,
        gamemode: data.gamemode || null,
    };
}

/* ── presentation ───────────────────────────────────────────── */

function iconAttachment(status) {
    if (!status.icon) return null;
    try {
        const b64 = status.icon.split(',')[1];
        const buf = Buffer.from(b64, 'base64');
        return new AttachmentBuilder(buf, { name: 'mcicon.png' });
    } catch { return null; }
}

/**
 * Build the Components V2 status panel. Returns { components, files }.
 */
function buildStatusPanel(status, cfg = {}) {
    const accent = status.online ? COLORS.online : COLORS.offline;
    const att = iconAttachment(status);

    const titleEmoji = status.online ? E.online : E.offline;
    const stateText = status.online ? '**Online**' : '**Offline**';

    let body = `## ${titleEmoji} ${status.host}\n`;
    body += `${E.arrow} **Status:** ${stateText}\n`;
    if (status.online) {
        body += `${E.user} **Players:** ${status.players.online} / ${status.players.max}\n`;
        if (status.version) body += `${E.box} **Version:** ${status.version}\n`;
        if (status.edition === 'bedrock' && status.gamemode) body += `${E.arrow} **Gamemode:** ${status.gamemode}\n`;
        if (status.motd) body += `\n> ${status.motd.replace(/\n/g, '\n> ')}\n`;
        if ((cfg.showPlayers !== false) && status.players.list.length) {
            const sample = status.players.list.slice(0, 20).join(', ');
            body += `\n${E.arrow} **Online now:** ${sample}${status.players.list.length > 20 ? ` +${status.players.list.length - 20} more` : ''}\n`;
        }
    } else {
        body += `\n> The server is unreachable or offline right now.\n`;
    }

    const container = new ContainerBuilder().setAccentColor(
        Number.isFinite(cfg.color) ? cfg.color : accent
    );

    if (att) {
        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
                .setThumbnailAccessory(new ThumbnailBuilder().setURL('attachment://mcicon.png'))
        );
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    const now = Math.floor(Date.now() / 1000);
    const updEvery = cfg.intervalMin ? ` · updates every ${cfg.intervalMin}m` : '';
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# ${E.refresh} ${status.edition === 'bedrock' ? 'Bedrock' : 'Java'} · last checked <t:${now}:R>${updEvery}`
    ));

    return { components: [container], files: att ? [att] : [] };
}

/* ── live monitor poller ────────────────────────────────────── */

let _pollTimer = null;

/**
 * Update one guild's live status message. Creates the message if missing.
 */
async function updateGuildMonitor(client, guildId, cfg) {
    if (!cfg?.enabled || !cfg.host || !cfg.channelId) return;
    const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return;

    let status;
    try { status = await fetchStatus(cfg.host, cfg.edition); }
    catch (e) { log.debug?.(`[MC] fetch failed for ${cfg.host}: ${e.message}`); return; }

    const { components, files } = buildStatusPanel(status, cfg);
    const payload = { components, files, flags: MessageFlags.IsComponentsV2 };

    try {
        if (cfg.messageId) {
            const msg = await channel.messages.fetch(cfg.messageId).catch(() => null);
            if (msg) { await msg.edit(payload); }
            else {
                const sent = await channel.send(payload);
                saveConfig(guildId, { messageId: sent.id });
            }
        } else {
            const sent = await channel.send(payload);
            saveConfig(guildId, { messageId: sent.id });
        }
        // Record last state for change detection (future: ping on offline).
        if (cfg.lastOnline !== status.online) saveConfig(guildId, { lastOnline: status.online });
    } catch (e) {
        log.debug?.(`[MC] update failed for guild ${guildId}: ${e.message}`);
    }
}

/**
 * Start the global monitor loop. Safe to call once on ready.
 * Runs every minute and updates each guild whose interval has elapsed.
 */
function startMonitor(client) {
    if (_pollTimer) return;
    const tick = async () => {
        const all = loadAll();
        const nowMin = Math.floor(Date.now() / 60000);
        for (const [guildId, cfg] of Object.entries(all)) {
            if (!cfg?.enabled) continue;
            const interval = Math.max(MIN_INTERVAL_MIN, cfg.intervalMin || DEFAULT_INTERVAL_MIN);
            if (nowMin % interval !== 0) continue; // only on the interval boundary
            await updateGuildMonitor(client, guildId, cfg).catch(() => {});
        }
    };
    _pollTimer = setInterval(tick, 60_000);
    if (_pollTimer.unref) _pollTimer.unref();
    // Kick an initial pass shortly after boot so messages refresh on restart.
    setTimeout(() => tick().catch(() => {}), 15_000);
    log.info('[MC] Minecraft monitor started.');
}

function stopMonitor() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

module.exports = {
    STORE, MIN_INTERVAL_MIN, DEFAULT_INTERVAL_MIN,
    getConfig, saveConfig, removeConfig, loadAll,
    fetchStatus, buildStatusPanel, updateGuildMonitor,
    startMonitor, stopMonitor,
};
