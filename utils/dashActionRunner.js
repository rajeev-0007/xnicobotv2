'use strict';

/**
 * DashActionRunner — bot-side consumer of the `dash_actions` queue.
 *
 * WHY THIS EXISTS
 * The dashboard (often on a different host, e.g. Vercel) can only WRITE
 * config to the shared Postgres store — it cannot call the Discord API.
 * So "Save settings" for verification / tickets / music updates config but
 * never actually POSTS the panel into a channel. That was the whole
 * "it only saves, never sends/executes" bug.
 *
 * This runner closes the loop: the dashboard enqueues an action (a small
 * record in the `dash_actions` store), the bot picks it up (via jsonStore's
 * 'update' event on the 5s Postgres poll, plus a safety interval), performs
 * the real Discord-side work, and writes the status/result back so the
 * dashboard can show success or a precise error.
 *
 * Unlike utils/storeSync.js (which must NOT require discord.js), this module
 * runs ONLY in the bot process and freely uses the client + command builders.
 */

const jsonStore = require('./jsonStore');
const log = require('./logger-styled');
const panelRegistry = require('./panelRegistry');

const STORE = 'dash_actions';
const POLL_MS = 8000;                 // safety poll in case an 'update' is missed
const MAX_AGE_MS = 60 * 60 * 1000;    // prune finished actions after 1h

let _client = null;
let _busy = false;
let _queued = false;
let _installed = false;

function installDashActionRunner(client) {
    if (_installed) return;
    _installed = true;
    _client = client;

    try {
        jsonStore.on('update', (name) => {
            if (name === STORE) schedule();
        });
    } catch (e) {
        log.warning?.('[DashActions] could not attach update listener: ' + (e?.message || e));
    }

    const t = setInterval(schedule, POLL_MS);
    if (t && t.unref) t.unref();

    // Initial sweep shortly after ready so anything queued while the bot was
    // offline gets processed.
    setTimeout(schedule, 3000);
    log.success?.('[DashActions] Panel deployment runner installed');
}

function schedule() {
    if (_busy) { _queued = true; return; }
    processActions().catch(err =>
        log.error?.('[DashActions] process error: ' + (err?.message || err)));
}

async function processActions() {
    if (_busy) { _queued = true; return; }
    _busy = true;
    try {
        const snapshot = (jsonStore.initialized ? jsonStore.read(STORE) : null) || {};
        const pending = Object.entries(snapshot)
            .filter(([, a]) => a && a.status === 'pending')
            .sort((a, b) => (a[1].createdAt || 0) - (b[1].createdAt || 0));

        if (pending.length === 0) return;

        // Do all the (async) Discord work first, collect results, then merge
        // them back into the freshest copy of the store in one sync mutation.
        const results = {};
        for (const [id, action] of pending) {
            try {
                const result = await runAction(action);
                results[id] = { status: 'done', result: result || {}, error: null, processedAt: Date.now() };
            } catch (err) {
                const msg = (err && err.message) ? String(err.message).slice(0, 300) : String(err).slice(0, 300);
                results[id] = { status: 'error', error: msg, processedAt: Date.now() };
                log.warning?.(`[DashActions] ${id} (${action?.panel}) failed: ${msg}`);
            }
        }

        const now = Date.now();
        await jsonStore.updateStore(STORE, (all) => {
            for (const [id, upd] of Object.entries(results)) {
                if (all[id]) Object.assign(all[id], upd);
            }
            // Opportunistic prune of old finished actions so the store stays small.
            for (const [id, a] of Object.entries(all)) {
                if (a && (a.status === 'done' || a.status === 'error')
                    && now - (a.processedAt || a.createdAt || 0) > MAX_AGE_MS) {
                    delete all[id];
                }
            }
            return all;
        });
    } finally {
        _busy = false;
        if (_queued) { _queued = false; setImmediate(schedule); }
    }
}

// ── Action dispatch ──────────────────────────────────────────────────────────

async function runAction(action) {
    if (!_client) throw new Error('Bot is still starting up. Try again in a moment.');
    if (!action || action.type !== 'panel_deploy') throw new Error('Unsupported action.');

    const guild = _client.guilds.cache.get(action.guildId)
        || await _client.guilds.fetch(action.guildId).catch(() => null);
    if (!guild) throw new Error('The bot is not in this server (or cannot access it).');

    switch (action.panel) {
        case 'verification': return deployVerification(guild, action);
        case 'tickets':      return deployTickets(guild, action);
        case 'music':        return deployMusic(guild, action);
        default: throw new Error('Unknown panel type: ' + action.panel);
    }
}

// ── Shared helpers ───────────────────────────────────────────────────────────

async function resolveTextChannel(guild, channelId) {
    if (!channelId) throw new Error('No channel selected.');
    const ch = guild.channels.cache.get(channelId)
        || await guild.channels.fetch(channelId).catch(() => null);
    if (!ch) throw new Error('That channel was not found — it may have been deleted.');
    if (typeof ch.isTextBased === 'function' ? !ch.isTextBased() : ch.type !== 0) {
        throw new Error('The selected channel is not a text channel.');
    }
    return ch;
}

function ensureSendable(guild, channel, perms) {
    const me = guild.members.me;
    if (!me) return; // can't resolve — let the send attempt surface the real error
    const have = channel.permissionsFor(me);
    const missing = perms.filter(p => !have?.has(p));
    if (missing.length) {
        throw new Error(`I'm missing permission(s) in #${channel.name}: ${missing.join(', ')}.`);
    }
}

// ── Panel handlers ───────────────────────────────────────────────────────────

async function deployVerification(guild, action) {
    const { getVerificationConfig } = require('./verificationManager');
    const verifCmd = require('../commands/automation/verification-setup');
    const sendVerificationPanel = verifCmd && verifCmd.sendVerificationPanel;
    if (typeof sendVerificationPanel !== 'function') {
        throw new Error('Verification panel builder is unavailable on this bot version.');
    }

    const config = getVerificationConfig(guild.id) || {};
    const channelId = action.channelId || config.channelId;
    if (!channelId) throw new Error('No verification channel configured. Pick a channel and save first.');

    const channel = await resolveTextChannel(guild, channelId);
    ensureSendable(guild, channel, ['ViewChannel', 'SendMessages']);

    const msg = await sendVerificationPanel(guild, channel, {
        title: config.title || '<:Shield:1521227694677692467> Server Verification',
        description: config.message || config.description
            || 'Welcome! Click the button below and complete a quick challenge to verify you are human and gain access to the server.',
        captchaType: config.captchaType || 'random',
        panelConfig: config.panelConfig || null,
    });

    // Track the message so future edits/reset can find it.
    try { panelRegistry.registerPanel(guild.id, 'verification', channel.id, msg.id); } catch {}
    return { channelId: channel.id, messageId: msg.id };
}

async function deployTickets(guild, action) {
    const ticketCmd = require('../commands/automation/ticket-setup');
    const buildPanelMessage = ticketCmd && ticketCmd.buildPanelMessage;
    if (typeof buildPanelMessage !== 'function') {
        throw new Error('Ticket panel builder is unavailable on this bot version.');
    }
    const {
        readAll, saveAll, ensureMigrated, resolveSupportRoleId,
    } = require('./ticketPanels');

    const config = readAll();
    const guildConfig = ensureMigrated(config[guild.id]);
    if (!guildConfig) throw new Error('Ticket system is not set up yet. Configure it and save first.');

    const channel = await resolveTextChannel(guild, action.channelId);
    ensureSendable(guild, channel, ['ViewChannel', 'SendMessages']);

    const panelId = action.panelId || 'default';
    const existing = guildConfig.panels && guildConfig.panels[panelId];

    const supportRoleId = resolveSupportRoleId
        ? resolveSupportRoleId(guildConfig, existing)
        : (existing?.supportRoleId || guildConfig.supportRoleId || null);
    const supportRole = supportRoleId ? guild.roles.cache.get(supportRoleId) : null;

    const panel = existing || {
        channelId: channel.id, label: 'Default', categoryIds: [],
        supportRoleId: null, channelCategoryId: null, panelMessage: null,
    };

    const sent = await channel.send(buildPanelMessage({
        guildConfig, panel, panelId, supportRole, guild,
    }));

    // Best-effort teardown of the previous panel message for this panelId.
    if (existing?.channelId && existing?.messageId && existing.messageId !== sent.id) {
        try {
            const oldChan = await guild.channels.fetch(existing.channelId).catch(() => null);
            const oldMsg = oldChan ? await oldChan.messages.fetch(existing.messageId).catch(() => null) : null;
            if (oldMsg) await oldMsg.delete().catch(() => null);
        } catch { /* non-fatal */ }
    }

    guildConfig.panels = guildConfig.panels || {};
    guildConfig.panels[panelId] = {
        ...(existing || {}),
        channelId: channel.id,
        messageId: sent.id,
        label: existing?.label || 'Default',
        categoryIds: existing?.categoryIds || [],
        supportRoleId: existing?.supportRoleId ?? null,
        channelCategoryId: existing?.channelCategoryId ?? null,
        panelMessage: existing?.panelMessage ?? null,
    };
    config[guild.id] = guildConfig;
    saveAll(config);

    return { channelId: channel.id, messageId: sent.id };
}

async function deployMusic(guild, action) {
    const musicCmd = require('../commands/music/musicpanel');
    if (typeof musicCmd.createMusicPanel !== 'function') {
        throw new Error('Music panel builder is unavailable on this bot version.');
    }
    return musicCmd.createMusicPanel(guild, {
        channelId: action.channelId || null,
        force: !!action.force,
    });
}

module.exports = { installDashActionRunner };
