'use strict';

const {
    SlashCommandBuilder,
    ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
    SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { models } = require('../../utils/database');
const { formatTime } = require('../../utils/musicHelpers');
const { } = require('../../utils/responseBuilder');
const { musicError, replyMusic, COLOR } = require('../../utils/musicResponse');

function buildAddedContainer(track) {
    const container = new ContainerBuilder().setAccentColor(COLOR.BRAND);

    const body =
        `**${track.info.title}**\n` +
        `-# by ${track.info.author || 'Unknown'} · ${formatTime(track.info.duration || 0)}`;

    if (track.info.artworkUrl) {
        container
            .addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Heart:1521228100652765247> Added to Favorites`))
                    .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: track.info.artworkUrl } }))
            )
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${body}\n\n-# Use \`/my-music\` to view your saved tracks.`));
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Heart:1521228100652765247> Added to Favorites\n\n${body}\n\n-# Use \`/my-music\` to view your saved tracks.`
        ));
    }

    container
;
    return container;
}

async function run(target, lavalinkManager) {
    const isSlash = typeof target.isRepliable === 'function';
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const userId  = isSlash ? target.user.id : target.author.id;

    if (!player || !player.queue?.current) {
        return replyMusic(target, musicError('No Track Playing', 'There is no current track to like.'), { ephemeral: isSlash });
    }

    const track = player.queue.current;
    if (!track.info?.uri) {
        return replyMusic(target, musicError('Cannot Save', 'This track has no shareable link.'), { ephemeral: isSlash });
    }

    const existing = await models.FavoriteSong.findOne({ userId, url: track.info.uri });
    if (existing) {
        return replyMusic(target, musicError('Already Saved', 'This track is already in your favorites.'), { ephemeral: isSlash });
    }

    await models.FavoriteSong.create({
        userId,
        url:        track.info.uri,
        title:      track.info.title,
        author:     track.info.author,
        duration:   track.info.duration,
        artworkUrl: track.info.artworkUrl || track.info.thumbnail,
        sourceName: track.info.sourceName,
        addedAt:    new Date().toISOString() });

    return replyMusic(target, buildAddedContainer(track));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('like')
        .setDescription('Add the current track to your favorites'),

    prefix: 'like',
    description: 'Add the current track to your favorites',
    usage: 'like',
    category: 'music',
    aliases: ['favorite', 'fav'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); } };
