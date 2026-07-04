'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { db } = require('../../utils/database');
const { musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

function makeKey(userId, name) {
    return `playlist_${userId}_${name.toLowerCase().replace(/\s+/g, '_')}`;
}

async function run(target, name) {
    const isSlash = typeof target.isRepliable === 'function';
    const userId  = isSlash ? target.user.id : target.author.id;

    if (!name || !name.trim()) {
        return replyMusic(target, musicError('Missing Name', 'Provide the playlist name to delete.', 'Use `/playlists` to list yours.'), { ephemeral: isSlash });
    }

    const playlist = await db.get(makeKey(userId, name.trim()));
    if (!playlist) {
        return replyMusic(target, musicError('Playlist Not Found', `No playlist named **${name.trim()}** exists.`), { ephemeral: isSlash });
    }

    await db.delete(makeKey(userId, name.trim()));
    return replyMusic(target, musicSuccess(
        'Playlist Deleted',
        `**${playlist.name}** has been removed.`,
        `${playlist.songs?.length || 0} song${(playlist.songs?.length || 0) === 1 ? '' : 's'} removed.`
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('delete-playlist')
        .setDescription('Delete one of your saved playlists')
        .addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)),

    prefix: 'delete-playlist',
    description: 'Delete one of your saved playlists',
    usage: 'delete-playlist <name>',
    category: 'music',
    aliases: ['delp', 'rmplaylist'],

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused().toLowerCase();
        const keys = await db.list(`playlist_${interaction.user.id}_`);
        const out = [];
        for (const key of keys) {
            const pl = await db.get(key);
            if (pl && pl.name.toLowerCase().includes(focused)) {
                out.push({ name: pl.name, value: pl.name });
            }
        }
        await interaction.respond(out.slice(0, 25));
    },

    async execute(interaction) {
        return run(interaction, interaction.options.getString('name'));
    },
    async executePrefix(message, args) {
        return run(message, args.join(' '));
    },
};
