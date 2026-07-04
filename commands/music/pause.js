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

    if (player.paused) {
        return replyMusic(target, musicError('Already Paused', 'Playback is already paused.', `Use \`/resume\` to continue.`), { ephemeral: isSlash });
    }

    await player.pause();
    await updateVoiceChannelStatus(target.client, player);

    const t = player.queue.current;
    return replyMusic(target, musicSuccess(
        'Music Paused',
        `**${t.info.title}**\n-# by ${t.info.author || 'Unknown Artist'}`,
        'Use `/resume` to continue playing.'
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pause')
        .setDescription('Pause the current track'),

    prefix: 'pause',
    description: 'Pause the current track',
    usage: 'pause',
    category: 'music',
    aliases: ['ps'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); },
};
