'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { preflightPlayer, musicSuccess, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager) {
    const player = lavalinkManager.getPlayer(target.guild.id);

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    await player.seek(0);
    const t = player.queue.current;
    return replyMusic(target, musicSuccess(
        'Replaying Track',
        `**${t.info.title}**\n-# by ${t.info.author || 'Unknown Artist'}`,
        'Started from the beginning.'
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('replay')
        .setDescription('Replay the current track from the beginning'),

    prefix: 'replay',
    description: 'Replay the current track from the beginning',
    usage: 'replay',
    category: 'music',
    aliases: ['replay-track'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); },
};
