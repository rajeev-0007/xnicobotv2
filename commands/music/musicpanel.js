'use strict';

const { PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { buildIdlePanel } = require('../../utils/musicPanel');
const { buildPermissionDenied } = require('../../utils/responseBuilder');
const { musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');
const log = require('../../utils/logger-styled');

const jsonStore = require('../../utils/jsonStore');

const STORE = 'musicpanel';
const CV2 = MessageFlags.IsComponentsV2;

function loadPanelConfig() {
    if (!jsonStore.has(STORE)) {
        jsonStore.write(STORE, {});
        return {};
    }
    return jsonStore.read(STORE) || {};
}

function savePanelConfig(config) { jsonStore.write(STORE, config); }

// Idle-panel channel topic (shared between the create paths).
const PANEL_TOPIC = '<:Music:1521228141543165982> Music Panel — type a song name, URL, or playlist (YouTube · Spotify · SoundCloud · Apple Music). Messages auto-delete.';

function panelOverwrites(guild) {
    return [
        {
            id: guild.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.SendMessages,
            ],
        },
        {
            id: guild.client.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels,
            ],
        },
    ];
}

function markPanelCaches(guildId, channelId) {
    if (global.musicPanelCache) global.musicPanelCache.set(guildId, true);
    if (global.musicPanelChannelCache) global.musicPanelChannelCache.set(guildId, channelId);
}

/**
 * Create (or re-post) the music panel for a guild. Shared by the prefix
 * command AND the dashboard→bot action runner (utils/dashActionRunner.js).
 *
 * Behaviour:
 *   - If a panel already exists and its channel+message still resolve, it's
 *     reused (idempotent success) unless `force` is set.
 *   - If the tracked channel exists but the message is gone, the idle panel
 *     is re-posted into it.
 *   - If `channelId` is provided, the idle panel is posted into that existing
 *     text channel instead of creating a new one.
 *   - Otherwise a dedicated `nico-controller` channel is created.
 *
 * Returns { channelId, messageId, reused?, created? }. Throws on failure with
 * a user-facing message.
 *
 * @param {import('discord.js').Guild} guild
 * @param {{ channelId?: string|null, force?: boolean }} [opts]
 */
async function createMusicPanel(guild, opts = {}) {
    const config = loadPanelConfig();
    const existing = config[guild.id];

    // Reuse an intact existing panel (unless forced or a specific channel was requested).
    if (existing?.channelId && !opts.force && !opts.channelId) {
        const ch = guild.channels.cache.get(existing.channelId)
            || await guild.channels.fetch(existing.channelId).catch(() => null);
        if (ch) {
            const msg = existing.messageId
                ? await ch.messages.fetch(existing.messageId).catch(() => null)
                : null;
            if (msg) {
                markPanelCaches(guild.id, ch.id);
                return { channelId: ch.id, messageId: msg.id, reused: true };
            }
            // Channel still there but the panel message vanished — re-post it.
            const idle = buildIdlePanel(guild.id);
            const panelMsg = await ch.send({ components: [idle], flags: CV2 });
            config[guild.id] = { channelId: ch.id, messageId: panelMsg.id, createdAt: existing.createdAt || Date.now() };
            savePanelConfig(config);
            markPanelCaches(guild.id, ch.id);
            return { channelId: ch.id, messageId: panelMsg.id, reused: true };
        }
        // Tracked channel is gone — fall through and create a fresh one.
    }

    let channel;
    let created = false;
    if (opts.channelId) {
        channel = guild.channels.cache.get(opts.channelId)
            || await guild.channels.fetch(opts.channelId).catch(() => null);
        if (!channel) throw new Error('The selected channel was not found.');
        if (channel.type !== ChannelType.GuildText) throw new Error('The music panel channel must be a text channel.');
    } else {
        channel = await guild.channels.create({
            name: 'nico-controller',
            type: ChannelType.GuildText,
            topic: PANEL_TOPIC,
            permissionOverwrites: panelOverwrites(guild),
        });
        created = true;
    }

    const idlePanel = buildIdlePanel(guild.id);
    const panelMsg = await channel.send({ components: [idlePanel], flags: CV2 });

    config[guild.id] = { channelId: channel.id, messageId: panelMsg.id, createdAt: Date.now() };
    savePanelConfig(config);
    markPanelCaches(guild.id, channel.id);

    return { channelId: channel.id, messageId: panelMsg.id, created };
}

module.exports = {
    name: 'musicpanel',
    prefix: 'musicpanel',
    description: 'Create a dedicated music panel channel with interactive controls',
    usage: 'musicpanel',
    category: 'music',
    aliases: ['mp', 'panel'],
    createMusicPanel,

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply({ components: [buildPermissionDenied('Manage Channels')], flags: CV2 });
        }

        const config = loadPanelConfig();
        if (config[message.guild.id]) {
            return replyMusic(message, musicError(
                'Panel Already Exists',
                'A music panel is already set up for this server.',
                'Use `removepanel` first if you want to recreate it.'
            ));
        }

        try {
            const { channelId } = await createMusicPanel(message.guild);
            return replyMusic(message, musicSuccess(
                'Music Panel Created',
                `Panel ready in <#${channelId}>.`,
                'Members can now type song names there to start playback.'
            ));
        } catch (err) {
            log.error?.(`[musicpanel] Failed to create panel: ${err.message}`);
            return replyMusic(message, musicError(
                'Panel Creation Failed',
                'Could not create the music panel.',
                err.message || 'Make sure I have the required permissions.'
            ));
        }
    },
};
