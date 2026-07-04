'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager, position) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const total = player.queue.tracks?.length || 0;
    if (total === 0) {
        return replyMusic(target, musicError('Empty Queue', 'There are no queued tracks to skip to.'), { ephemeral: isSlash });
    }

    const pos = parseInt(position, 10);
    if (!Number.isFinite(pos) || pos < 1 || pos > total) {
        return replyMusic(target, musicError(
            'Invalid Position',
            `Pick a number between **1** and **${total}**.`,
            'Use `/queue` to see all queued tracks.'
        ), { ephemeral: isSlash });
    }

    const target_track = player.queue.tracks[pos - 1];

    // Drop the (pos - 1) tracks before the target via the queue API to fire
    // any persistence hooks.
    if (typeof player.queue.splice === 'function') player.queue.splice(0, pos - 1);
    else                                            player.queue.tracks.splice(0, pos - 1);

    await player.skip();

    return replyMusic(target, musicSuccess(
        'Skipped to Track',
        `**${target_track.info.title}**\n-# by ${target_track.info.author || 'Unknown Artist'}`,
        `Was at position #${pos}.`
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skipto')
        .setDescription('Skip to a specific position in the queue')
        .addIntegerOption(o => o.setName('position')
            .setDescription('Track position in the queue').setRequired(true).setMinValue(1)),

    prefix: 'skipto',
    description: 'Skip to a specific position in the queue',
    usage: 'skipto <position>',
    category: 'music',
    aliases: ['jump'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getInteger('position'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args[0]);
    },
};
