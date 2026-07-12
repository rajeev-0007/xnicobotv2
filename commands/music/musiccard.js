'use strict';

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { musicError, replyMusic } = require('../../utils/musicResponse');
const { buildNowPlayingContainer } = require('../../utils/musicPanel');
const { renderNowPlayingCard, cardOptionsFromPlayer, STYLES } = require('../../utils/musicCard');
const { startLiveCard } = require('../../utils/liveMusicCard');

function resolveStyle(raw) {
    const s = String(raw || '').trim().toLowerCase();
    return STYLES.includes(s) ? s : 'default';
}

async function run(target, lavalinkManager, rawStyle) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    if (!player || !player.queue?.current) {
        return replyMusic(target, musicError(
            'No Music Playing',
            'There is no music currently playing.',
            'Use `/play <song>` to start playback.'
        ), { ephemeral: isSlash });
    }

    const style = resolveStyle(rawStyle);

    // Render the canvas card. If it fails, gracefully fall back to the
    // standard text panel so the user always gets a response.
    const cardOpts = cardOptionsFromPlayer(player, style);
    const buffer = cardOpts ? await renderNowPlayingCard(cardOpts) : null;

    const autoplay = target.client.autoplayStatus || new Map();

    if (!buffer) {
        const container = buildNowPlayingContainer(player, autoplay);
        if (!container) {
            return replyMusic(target, musicError('Load Failed', 'Could not load now-playing information.'), { ephemeral: isSlash });
        }
        return replyMusic(target, container);
    }

    const attachment = new AttachmentBuilder(buffer, { name: 'nowplaying.png' });
    const container = buildNowPlayingContainer(player, autoplay, { cardImageUrl: 'attachment://nowplaying.png' });
    if (!container) {
        return replyMusic(target, musicError('Load Failed', 'Could not load now-playing information.'), { ephemeral: isSlash });
    }

    const sent = await replyMusic(target, container, { files: [attachment] });

    // Keep this card updating live in the same message every 10s, in the
    // chosen style — the progress bar advances without new messages.
    if (sent) startLiveCard(target.client, sent, style);

    return sent;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('musiccard')
        .setDescription('Show the current track as a Now Playing image card')
        .addStringOption(o => o.setName('style')
            .setDescription('Card style')
            .setRequired(false)
            .addChoices(
                { name: 'Default (album backdrop)', value: 'default' },
                { name: 'Dark',    value: 'dark' },
                { name: 'Light',   value: 'light' },
                { name: 'Vibrant', value: 'vibrant' },
                { name: 'Minimal', value: 'minimal' },
            )),

    prefix: 'musiccard',
    description: 'Show the current track as a Now Playing image card',
    usage: 'musiccard [default|dark|light|vibrant|minimal]',
    category: 'music',
    aliases: ['mcard', 'npcard'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getString('style'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args[0]);
    },
};
