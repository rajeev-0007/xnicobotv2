'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { db } = require('../../utils/database');
const { musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

const NAME_MAX = 50;

function makeKey(userId, name) {
    return `playlist_${userId}_${name.toLowerCase().replace(/\s+/g, '_')}`;
}

async function run(target, lavalinkManager, name) {
    const isSlash = typeof target.isRepliable === 'function';
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const userId  = isSlash ? target.user.id : target.author.id;

    if (!player || (!player.queue?.current && !(player.queue?.tracks?.length))) {
        return replyMusic(target, musicError('Empty Queue', 'There is nothing in the queue to save.'), { ephemeral: isSlash });
    }

    const playlistName = (name || '').trim();
    if (!playlistName) {
        return replyMusic(target, musicError('Missing Name', 'Provide a name for your playlist.'), { ephemeral: isSlash });
    }
    if (playlistName.length > NAME_MAX) {
        return replyMusic(target, musicError('Name Too Long', `Playlist names must be **${NAME_MAX}** characters or fewer.`), { ephemeral: isSlash });
    }

    const key = makeKey(userId, playlistName);
    const existing = await db.get(key);
    if (existing) {
        return replyMusic(target, musicError('Name Taken', 'A playlist with that name already exists.', 'Pick a different name.'), { ephemeral: isSlash });
    }

    const songs = [];
    if (player.queue.current) {
        const c = player.queue.current.info;
        songs.push({ url: c.uri, title: c.title, author: c.author, duration: c.duration });
    }
    for (const t of (player.queue.tracks || [])) {
        songs.push({ url: t.info.uri, title: t.info.title, author: t.info.author, duration: t.info.duration });
    }

    await db.set(key, {
        name: playlistName,
        userId,
        songs,
        createdAt: new Date().toISOString(),
    });

    return replyMusic(target, musicSuccess(
        'Playlist Saved',
        `**${playlistName}**\n-# ${songs.length} song${songs.length === 1 ? '' : 's'} saved.`,
        `Use \`/load-playlist ${playlistName}\` to play it.`
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('save-queue')
        .setDescription('Save the current queue as a playlist')
        .addStringOption(o => o.setName('name')
            .setDescription('Name for the playlist').setRequired(true).setMaxLength(NAME_MAX)),

    prefix: 'save-queue',
    description: 'Save the current queue as a playlist',
    usage: 'save-queue <name>',
    category: 'music',
    aliases: ['saveq', 'savequeue'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getString('name'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args.join(' '));
    },
};
