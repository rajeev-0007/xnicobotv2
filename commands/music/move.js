'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager, fromRaw, toRaw) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member, requireCurrent: false });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const total = player.queue.tracks?.length || 0;
    if (total < 2) {
        return replyMusic(target, musicError('Not Enough Tracks', 'Need at least 2 queued tracks to move.'), { ephemeral: isSlash });
    }

    const fromPos = parseInt(fromRaw, 10);
    const toPos   = parseInt(toRaw, 10);
    if (!Number.isFinite(fromPos) || !Number.isFinite(toPos) ||
        fromPos < 1 || fromPos > total || toPos < 1 || toPos > total) {
        return replyMusic(target, musicError(
            'Invalid Position',
            `Both positions must be between **1** and **${total}**.`,
            'Use `/queue` to see all queued tracks.'
        ), { ephemeral: isSlash });
    }
    if (fromPos === toPos) {
        return replyMusic(target, musicError('No Change', 'The track is already at that position.'), { ephemeral: isSlash });
    }

    const track = player.queue.tracks[fromPos - 1];
    player.queue.tracks.splice(fromPos - 1, 1);
    player.queue.tracks.splice(toPos - 1, 0, track);

    return replyMusic(target, musicSuccess(
        'Track Moved',
        `**${track.info.title}**`,
        `Moved from #${fromPos} → #${toPos}`
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('move')
        .setDescription('Move a track to a different queue position')
        .addIntegerOption(o => o.setName('from').setDescription('Current position').setRequired(true).setMinValue(1))
        .addIntegerOption(o => o.setName('to').setDescription('New position').setRequired(true).setMinValue(1)),

    prefix: 'move',
    description: 'Move a track to a different queue position',
    usage: 'move <from> <to>',
    category: 'music',
    aliases: ['mv'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager,
            interaction.options.getInteger('from'),
            interaction.options.getInteger('to'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args[0], args[1]);
    },
};
