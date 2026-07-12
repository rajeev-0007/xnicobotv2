'use strict';

const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { buildNowPlayingContainer } = require('../../utils/musicPanel');
const { musicError, replyMusic } = require('../../utils/musicResponse');
const { renderNowPlayingCard, cardOptionsFromPlayer } = require('../../utils/musicCard');
const { startLiveCard } = require('../../utils/liveMusicCard');

async function run(target, lavalinkManager) {
    const guildId = target.guild.id;
    const player  = lavalinkManager.getPlayer(guildId);
    const isSlash = typeof target.isRepliable === 'function';

    if (!player || !player.queue?.current) {
        return replyMusic(target, musicError('No Music Playing', 'There is no music currently playing.', 'Use `/play <song>` to start playback.'), { ephemeral: isSlash });
    }

    const autoplay = target.client.autoplayStatus || new Map();

    // Render the canvas Now Playing card. This is best-effort: if the
    // renderer returns null (bad image, unusual track) we fall back to the
    // plain remote-artwork panel so the command never fails for the user.
    let attachment = null;
    let container;
    try {
        const cardOpts = cardOptionsFromPlayer(player, 'default');
        const buffer = cardOpts ? await renderNowPlayingCard(cardOpts) : null;
        if (buffer) {
            attachment = new AttachmentBuilder(buffer, { name: 'nowplaying.png' });
            container = buildNowPlayingContainer(player, autoplay, { cardImageUrl: 'attachment://nowplaying.png' });
        }
    } catch { attachment = null; }

    if (!container) container = buildNowPlayingContainer(player, autoplay);

    if (!container) {
        return replyMusic(target, musicError('Load Failed', 'Could not load now-playing information.'), { ephemeral: isSlash });
    }

    const sent = await replyMusic(target, container, attachment ? { files: [attachment] } : {});

    // If we rendered a card, keep it updating live (progress bar advances)
    // in this same message every 10s — no extra messages.
    if (sent && attachment) startLiveCard(target.client, sent, 'default');

    return sent;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nowplaying')
        .setDescription('Show the currently playing track and full music controls'),

    prefix: 'nowplaying',
    description: 'Show the currently playing track and full music controls',
    usage: 'nowplaying',
    category: 'music',
    aliases: ['np', 'current', 'playing'],

    async execute(interaction, lavalinkManager)        { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); },
};
