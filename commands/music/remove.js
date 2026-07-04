'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager, position) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member, requireCurrent: false });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const total = player.queue.tracks?.length || 0;
    if (total === 0) {
        return replyMusic(target, musicError('Empty Queue', 'There are no queued tracks to remove.'), { ephemeral: isSlash });
    }

    const pos = parseInt(position, 10);
    if (!Number.isFinite(pos) || pos < 1 || pos > total) {
        return replyMusic(target, musicError(
            'Invalid Position',
            `Pick a number between **1** and **${total}**.`,
            'Use `/queue` to see all queued tracks.'
        ), { ephemeral: isSlash });
    }

    const removed = player.queue.tracks[pos - 1];
    player.queue.remove(pos - 1);

    return replyMusic(target, musicSuccess(
        'Track Removed',
        `**${removed.info.title}**\n-# by ${removed.info.author || 'Unknown Artist'}`,
        `Was at position #${pos}.`
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription('Remove a track from the queue')
        .addIntegerOption(o => o.setName('position')
            .setDescription('Track position in the queue').setRequired(true).setMinValue(1)),

    prefix: 'remove',
    description: 'Remove a track from the queue',
    usage: 'remove <position>',
    category: 'music',
    aliases: ['rm', 'del'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getInteger('position'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args[0]);
    },
};
