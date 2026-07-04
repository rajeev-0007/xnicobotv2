'use strict';

/**
 * minecraftBridge.js — two-way Discord ↔ Minecraft chat bridge.
 *
 * A headless mineflayer client joins the configured Minecraft server as a
 * player. It relays:
 *   • Minecraft public chat  → Discord channel (webhook, per-player avatar)
 *   • Minecraft whispers (to the bot) → Discord channel (marked private)
 *   • Discord messages in the bridge channel → Minecraft via bot.chat()
 *
 * Requirements / limitations (Minecraft protocol realities):
 *   • Needs outbound TCP to the MC server — works on a VPS/cloud host, NOT on
 *     Vercel. (The bot runs on the cloud, so this is fine.)
 *   • Occupies one player slot and appears as a player in-game.
 *   • Can only see whispers sent TO the bot — not private DMs between other
 *     players (the server never sends those to us).
 *   • 'offline' auth works only on offline-mode (cracked) servers. Premium
 *     servers need 'microsoft' auth (device-code login printed to the bot
 *     console on first connect; tokens are cached afterwards).
 *
 * Bridge config lives in the 'minecraft' jsonStore under `bridge`:
 *   bridge: { enabled, channelId, host, port, auth:'offline'|'microsoft',
 *             username, version, relayJoinLeave }
 */

const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

const STORE = 'minecraft';
const MC_CHAT_MAX = 256;
const RECONNECT_BASE_MS = 10_000;
const RECONNECT_MAX_MS = 5 * 60_000;

// guildId → { bot, status, reconnectTimer, attempts, webhook, channelId, client }
const bridges = new Map();
// channelId → guildId  (fast lookup for the Discord message relay)
const channelIndex = new Map();

let _mineflayer = null;
function getMineflayer() {
    if (_mineflayer) return _mineflayer;
    try { _mineflayer = require('mineflayer'); }
    catch { _mineflayer = null; }
    return _mineflayer;
}

/* ── config helpers (shared 'minecraft' store) ──────────────── */

function loadAll() {
    try { return jsonStore.has(STORE) ? (jsonStore.read(STORE) || {}) : {}; }
    catch { return {}; }
}
function getBridgeConfig(guildId) {
    return loadAll()[guildId]?.bridge || null;
}
function saveBridgeConfig(guildId, partial) {
    const all = loadAll();
    if (!all[guildId]) all[guildId] = {};
    all[guildId].bridge = { ...(all[guildId].bridge || {}), ...partial };
    all[guildId].updatedAt = Date.now();
    jsonStore.writeImmediate(STORE, all);
    return all[guildId].bridge;
}

/* ── Discord relay (webhook, styled per-player) ─────────────── */

async function getWebhook(channel) {
    try {
        const hooks = await channel.fetchWebhooks();
        let hook = hooks.find(h => h.name === 'MC Bridge' && h.owner?.id === channel.client.user.id);
        if (!hook) {
            hook = await channel.createWebhook({ name: 'MC Bridge', reason: 'Minecraft chat bridge' });
        }
        return hook;
    } catch {
        return null; // missing Manage Webhooks — fall back to plain messages
    }
}

async function relayToDiscord(state, { player, content, system = false, isPrivate = false }) {
    const channel = await state.client.channels.fetch(state.channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;

    if (system) {
        await channel.send({ content: `-# <:online:1521228065752088576> ${content}`.slice(0, 2000) }).catch(() => {});
        return;
    }

    const text = (isPrivate ? `🔒 (whisper) ${content}` : content).slice(0, 1900);

    if (!state.webhook) state.webhook = await getWebhook(channel);
    if (state.webhook) {
        await state.webhook.send({
            username: String(player || 'Server').slice(0, 80),
            avatarURL: `https://mc-heads.net/avatar/${encodeURIComponent(player || 'Steve')}/64`,
            content: text,
            allowedMentions: { parse: [] },
        }).catch(() => {
            channel.send({ content: `**${player}:** ${text}`, allowedMentions: { parse: [] } }).catch(() => {});
        });
    } else {
        await channel.send({ content: `**${player}:** ${text}`, allowedMentions: { parse: [] } }).catch(() => {});
    }
}

/* ── bridge lifecycle ───────────────────────────────────────── */

function scheduleReconnect(client, guildId) {
    const state = bridges.get(guildId);
    if (!state) return;
    state.attempts = (state.attempts || 0) + 1;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * state.attempts);
    state.status = 'reconnecting';
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = setTimeout(() => {
        const cfg = getBridgeConfig(guildId);
        if (cfg?.enabled) startBridge(client, guildId).catch(() => {});
    }, delay);
    if (state.reconnectTimer.unref) state.reconnectTimer.unref();
}

/**
 * Start (or restart) the bridge for a guild. Returns { ok, error }.
 */
async function startBridge(client, guildId) {
    const mineflayer = getMineflayer();
    if (!mineflayer) return { ok: false, error: 'mineflayer is not installed on this host (run `npm install mineflayer`).' };

    const cfg = getBridgeConfig(guildId);
    if (!cfg?.enabled || !cfg.host || !cfg.channelId) return { ok: false, error: 'Bridge is not configured.' };

    // Tear down any existing bot first.
    stopBridge(guildId, { keepConfig: true });

    const state = {
        bot: null, status: 'connecting', reconnectTimer: null, attempts: bridges.get(guildId)?.attempts || 0,
        webhook: null, channelId: cfg.channelId, client,
    };
    bridges.set(guildId, state);
    channelIndex.set(cfg.channelId, guildId);

    let bot;
    try {
        bot = mineflayer.createBot({
            host: cfg.host,
            port: cfg.port || 25565,
            username: cfg.username || 'DiscordBridge',
            auth: cfg.auth === 'microsoft' ? 'microsoft' : 'offline',
            version: cfg.version || false,       // false = auto-detect
            checkTimeoutInterval: 30_000,
            onMsaCode: (data) => {
                log.warning(`[MC Bridge] Microsoft login required for guild ${guildId}: visit ${data.verification_uri} and enter code ${data.user_code}`);
            },
        });
    } catch (e) {
        scheduleReconnect(client, guildId);
        return { ok: false, error: e.message };
    }

    state.bot = bot;

    bot.once('spawn', () => {
        state.status = 'online';
        state.attempts = 0;
        log.success(`[MC Bridge] Connected to ${cfg.host}:${cfg.port || 25565} for guild ${guildId}`);
        relayToDiscord(state, { system: true, content: `Bridge connected to **${cfg.host}** as \`${bot.username}\`.` });
    });

    // Public chat from other players (skip our own messages).
    bot.on('chat', (username, message) => {
        if (!username || username === bot.username) return;
        relayToDiscord(state, { player: username, content: message });
    });

    // Whispers sent TO the bot (only ones the server forwards to us).
    bot.on('whisper', (username, message) => {
        if (!username || username === bot.username) return;
        relayToDiscord(state, { player: username, content: message, isPrivate: true });
    });

    if (cfg.relayJoinLeave) {
        bot.on('playerJoined', (p) => { if (p?.username && p.username !== bot.username) relayToDiscord(state, { system: true, content: `**${p.username}** joined the server.` }); });
        bot.on('playerLeft', (p) => { if (p?.username && p.username !== bot.username) relayToDiscord(state, { system: true, content: `**${p.username}** left the server.` }); });
    }

    bot.on('kicked', (reason) => {
        state.status = 'kicked';
        let r = reason; try { r = typeof reason === 'string' ? reason : JSON.stringify(reason); } catch {}
        log.warning(`[MC Bridge] Kicked from ${cfg.host} (guild ${guildId}): ${String(r).slice(0, 120)}`);
        relayToDiscord(state, { system: true, content: `Bridge was kicked — reconnecting...` });
    });

    bot.on('end', () => {
        if (state.status !== 'stopped') scheduleReconnect(client, guildId);
    });

    bot.on('error', (err) => {
        log.warning(`[MC Bridge] Error (guild ${guildId}): ${(err?.message || err || '').toString().slice(0, 120)}`);
    });

    return { ok: true };
}

function stopBridge(guildId, { keepConfig = false } = {}) {
    const state = bridges.get(guildId);
    if (state) {
        state.status = 'stopped';
        if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
        try { state.bot?.quit('Bridge stopped'); } catch {}
        if (state.channelId) channelIndex.delete(state.channelId);
        bridges.delete(guildId);
    }
    if (!keepConfig) saveBridgeConfig(guildId, { enabled: false });
}

/**
 * Relay a Discord message into Minecraft. Called from messageCreate.
 * Returns true if the message was handled (was in a bridge channel).
 */
function handleDiscordMessage(message) {
    if (!message.guild || message.author?.bot || message.webhookId) return false;
    const guildId = channelIndex.get(message.channelId);
    if (!guildId) return false;
    const state = bridges.get(guildId);
    if (!state?.bot || state.status !== 'online') return true; // owns the channel but not connected
    if (!message.content) return true;

    const name = message.member?.displayName || message.author.username;
    let line = `${name}: ${message.content.replace(/\n/g, ' ')}`;
    if (line.length > MC_CHAT_MAX) line = line.slice(0, MC_CHAT_MAX);
    try { state.bot.chat(line); } catch {}
    return true;
}

/** Start every guild's bridge that's marked enabled (on bot ready). */
function startAllBridges(client) {
    const all = loadAll();
    for (const [guildId, cfg] of Object.entries(all)) {
        if (cfg?.bridge?.enabled) {
            startBridge(client, guildId).catch(() => {});
        }
    }
}

function getStatus(guildId) {
    return bridges.get(guildId)?.status || (getBridgeConfig(guildId)?.enabled ? 'starting' : 'off');
}

module.exports = {
    getBridgeConfig, saveBridgeConfig,
    startBridge, stopBridge, handleDiscordMessage, startAllBridges, getStatus,
};
