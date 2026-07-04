'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { buildNowPlayingContainer } = require('../../utils/musicPanel');
const { musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager) {
    const guildId = target.guild.id;
    const player  = lavalinkManager.getPlayer(guildId);
    const isSlash = typeof target.isRepliable === 'function';

    if (!player || !player.queue?.current) {
        return replyMusic(target, musicError('No Music Playing', 'There is no music currently playing.', 'Use `/play <song>` to start playback.'), { ephemeral: isSlash });
    }

    const autoplay  = target.client.autoplayStatus || new Map();
    const container = buildNowPlayingContainer(player, autoplay);

    if (!container) {
        return replyMusic(target, musicError('Load Failed', 'Could not load now-playing information.'), { ephemeral: isSlash });
    }
    return replyMusic(target, container);
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
