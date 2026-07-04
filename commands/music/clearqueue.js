'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const trackCount = player.queue.tracks?.length || 0;
    if (trackCount === 0) {
        return replyMusic(target, musicError('Empty Queue', 'The queue is already empty.'), { ephemeral: isSlash });
    }

    if (typeof player.queue.splice === 'function') player.queue.splice(0, trackCount);
    else                                            player.queue.tracks.splice(0, trackCount);

    return replyMusic(target, musicSuccess(
        'Queue Cleared',
        `Removed **${trackCount}** track${trackCount === 1 ? '' : 's'}.`,
        'The current track keeps playing.'
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clearqueue')
        .setDescription('Clear all queued tracks (current track keeps playing)'),

    prefix: 'clearqueue',
    description: 'Clear all queued tracks (current track keeps playing)',
    usage: 'clearqueue',
    category: 'music',
    aliases: ['cq', 'clearq', 'emptyqueue'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); },
};
