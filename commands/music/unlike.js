'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { models } = require('../../utils/database');
const {
    musicSuccess, musicError, replyMusic,
} = require('../../utils/musicResponse');

async function run(target, lavalinkManager) {
    const isSlash = typeof target.isRepliable === 'function';
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const userId  = isSlash ? target.user.id : target.author.id;

    if (!player || !player.queue?.current) {
        return replyMusic(target, musicError('No Track Playing', 'There is no current track to unlike.'), { ephemeral: isSlash });
    }

    const track = player.queue.current;
    if (!track.info?.uri) {
        return replyMusic(target, musicError('Cannot Modify', 'This track has no saved link.'), { ephemeral: isSlash });
    }

    const existing = await models.FavoriteSong.findOne({ userId, url: track.info.uri });
    if (!existing) {
        return replyMusic(target, musicError('Not in Favorites', 'This track is not in your favorites.'), { ephemeral: isSlash });
    }

    await models.FavoriteSong.deleteOne({ userId, url: track.info.uri });

    return replyMusic(target, musicSuccess(
        'Removed from Favorites',
        `**${track.info.title}**\n-# by ${track.info.author || 'Unknown Artist'}`,
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlike')
        .setDescription('Remove the current track from your favorites'),

    prefix: 'unlike',
    description: 'Remove the current track from your favorites',
    usage: 'unlike',
    category: 'music',
    aliases: ['unfav'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); },
};
