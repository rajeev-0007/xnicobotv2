'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { db } = require('../../utils/database');
const { formatTime } = require('../../utils/musicHelpers');
const { musicInfo, musicError, replyMusic } = require('../../utils/musicResponse');

async function buildBody(userId) {
    const keys = await db.list(`playlist_${userId}_`);
    if (keys.length === 0) {
        return {
            empty: true,
            body: 'You have no saved playlists yet.',
            footer: 'Use `/save-queue <name>` to save your current queue.',
        };
    }

    const lines = [];
    for (let i = 0; i < keys.length; i++) {
        const pl = await db.get(keys[i]);
        if (!pl) continue;
        const total = (pl.songs || []).reduce((acc, s) => acc + (s.duration || 0), 0);
        lines.push(`**${i + 1}. ${pl.name}**\n-# ${pl.songs?.length || 0} song${pl.songs?.length === 1 ? '' : 's'} · \`${formatTime(total)}\``);
    }
    return {
        empty: false,
        body: lines.join('\n\n'),
        footer: 'Use `/load-playlist <name>` to play a playlist.',
    };
}

async function run(target) {
    const isSlash = typeof target.isRepliable === 'function';
    const userId  = isSlash ? target.user.id : target.author.id;

    if (isSlash) {
        await target.deferReply({ flags: require('discord.js').MessageFlags.Ephemeral }).catch(() => {});
    }

    try {
        const { empty, body, footer } = await buildBody(userId);
        const container = empty
            ? musicInfo('Your Playlists', body, footer)
            : musicInfo('Your Playlists', body, footer);
        return replyMusic(target, container, { ephemeral: isSlash });
    } catch (err) {
        return replyMusic(target, musicError('Failed', 'Could not load your playlists.', err?.message), { ephemeral: isSlash });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playlists')
        .setDescription('View your saved playlists'),

    prefix: 'playlists',
    description: 'View your saved playlists',
    usage: 'playlists',
    category: 'music',
    aliases: ['mylists', 'lists'],

    async execute(interaction)         { return run(interaction); },
    async executePrefix(message)       { return run(message);     },
};
