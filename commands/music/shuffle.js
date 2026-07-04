'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager) {
    const player = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    if ((player.queue.tracks?.length || 0) < 2) {
        return replyMusic(target, musicError('Not Enough Tracks', 'Need at least 2 tracks in the queue to shuffle.'), { ephemeral: isSlash });
    }

    player.queue.shuffle();
    return replyMusic(target, musicSuccess(
        'Queue Shuffled',
        `**${player.queue.tracks.length}** track${player.queue.tracks.length === 1 ? '' : 's'} reshuffled.`,
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shuffle')
        .setDescription('Shuffle the queue'),

    prefix: 'shuffle',
    description: 'Shuffle the queue',
    usage: 'shuffle',
    category: 'music',
    aliases: ['sh', 'mix'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); },
};
