'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { updateVoiceChannelStatus } = require('../../utils/musicPanel');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';
    const member  = target.member;

    const pre = preflightPlayer({ player, member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    if (!player.paused) {
        return replyMusic(target, musicError('Not Paused', 'Playback is not paused right now.'), { ephemeral: isSlash });
    }

    await player.resume();
    await updateVoiceChannelStatus(target.client, player);

    const t = player.queue.current;
    return replyMusic(target, musicSuccess(
        'Music Resumed',
        `**${t.info.title}**\n-# by ${t.info.author || 'Unknown Artist'}`,
        'Now playing.'
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('resume')
        .setDescription('Resume the paused track'),

    prefix: 'resume',
    description: 'Resume the paused track',
    usage: 'resume',
    category: 'music',
    aliases: ['rs', 'unpause', 'continue'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); },
};
