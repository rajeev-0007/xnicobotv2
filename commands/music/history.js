'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { formatTime } = require('../../utils/musicHelpers');
const { getPlatformInfo, truncateText } = require('../../utils/musicPanel');
const { preflightPlayer, musicInfo, musicError, replyMusic } = require('../../utils/musicResponse');

function buildHistoryBody(history) {
    const recent = history.slice().reverse().slice(0, 10);
    const lines = recent.map((track, i) => {
        const platform = getPlatformInfo(track.info?.sourceName);
        const title = truncateText(track.info?.title || 'Unknown', 45);
        const author = truncateText(track.info?.author || 'Unknown', 30);
        return `\`${(i + 1).toString().padStart(2, ' ')}.\` ${platform.icon} **${title}**\n-# by ${author} · \`${formatTime(track.info?.duration || 0)}\``;
    }).join('\n\n');

    const footer = `Showing ${recent.length} most recent of ${history.length} played`;
    return { body: lines, footer };
}

async function run(target, lavalinkManager) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member, requireCurrent: false });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const history = player.queue.previous || [];
    if (!history.length) {
        return replyMusic(target, musicError('No History', 'No tracks have been played in this session.'), { ephemeral: isSlash });
    }

    const { body, footer } = buildHistoryBody(history);
    return replyMusic(target, musicInfo('Recent Plays', body, footer));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('Show recently played tracks (newest first)'),

    prefix: 'history',
    description: 'Show recently played tracks',
    usage: 'history',
    category: 'music',
    aliases: ['hist', 'recent'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); },
};
