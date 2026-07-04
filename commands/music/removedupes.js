'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member, requireCurrent: false });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const original = player.queue.tracks?.length || 0;
    if (original === 0) {
        return replyMusic(target, musicError('Empty Queue', 'There are no queued tracks.'), { ephemeral: isSlash });
    }

    const seen = new Set();
    const unique = [];
    for (const track of player.queue.tracks) {
        const id = track.info.identifier || track.info.uri;
        if (!seen.has(id)) {
            seen.add(id);
            unique.push(track);
        }
    }
    player.queue.tracks = unique;
    const removed = original - unique.length;

    if (removed === 0) {
        return replyMusic(target, musicSuccess(
            'No Duplicates',
            'The queue had no duplicate tracks.',
        ));
    }

    return replyMusic(target, musicSuccess(
        'Duplicates Removed',
        `Removed **${removed}** duplicate track${removed === 1 ? '' : 's'}.`,
        `**${unique.length}** unique track${unique.length === 1 ? '' : 's'} remaining.`
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('removedupes')
        .setDescription('Remove duplicate tracks from the queue'),

    prefix: 'removedupes',
    description: 'Remove duplicate tracks from the queue',
    usage: 'removedupes',
    category: 'music',
    aliases: ['dedupe', 'rmdupes'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); },
};
