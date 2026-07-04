'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { db } = require('../../utils/database');
const { waitForLavalink } = require('../../utils/helpers');
const {
    preflightVoiceOnly, musicSuccess, musicError, replyMusic,
} = require('../../utils/musicResponse');

const SEARCH_TIMEOUT_MS = 15_000;

function makeKey(userId, name) {
    return `playlist_${userId}_${name.toLowerCase().replace(/\s+/g, '_')}`;
}

function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

async function ensurePlayer(target, lavalinkManager, member) {
    let player = lavalinkManager.getPlayer(target.guild.id);
    if (!player) {
        player = await lavalinkManager.createPlayer({
            guildId: target.guild.id,
            voiceChannelId: member.voice.channel.id,
            textChannelId: target.channel.id,
            selfDeaf: true,
        });
    }
    if (!player.connected) await player.connect();
    return player;
}

async function run(target, lavalinkManager, name, shuffle) {
    const isSlash = typeof target.isRepliable === 'function';
    const member  = target.member;
    const requester = isSlash ? target.user : target.author;
    const userId  = isSlash ? target.user.id : target.author.id;

    const voiceErr = preflightVoiceOnly(member);
    if (voiceErr) return replyMusic(target, voiceErr.container, { ephemeral: isSlash });

    if (!name || !name.trim()) {
        return replyMusic(target, musicError('Missing Name', 'Provide the playlist name.', 'Use `/playlists` to list yours.'), { ephemeral: isSlash });
    }

    if (isSlash) await target.deferReply().catch(() => {});

    const playlist = await db.get(makeKey(userId, name.trim()));
    if (!playlist) {
        return replyMusic(target, musicError('Playlist Not Found', `No playlist named **${name.trim()}** exists.`, 'Use `/playlists` to list yours.'), { ephemeral: isSlash });
    }

    if (!(await waitForLavalink(lavalinkManager))) {
        return replyMusic(target, musicError('Music Unavailable', 'No music servers are connected right now.', 'Please try again in a moment.'), { ephemeral: isSlash });
    }

    let player;
    try { player = await ensurePlayer(target, lavalinkManager, member); }
    catch (err) {
        return replyMusic(target, musicError('Connection Failed', 'Could not join your voice channel.', err?.message), { ephemeral: isSlash });
    }

    let songs = [...playlist.songs];
    if (shuffle) shuffleInPlace(songs);

    let added = 0;
    for (const s of songs) {
        try {
            const result = await Promise.race([
                player.search({ query: s.url || `${s.title} ${s.author || ''}` }, requester),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT_MS)),
            ]);
            if (result?.tracks?.length) {
                player.queue.add(result.tracks[0]);
                added++;
            }
        } catch {}
    }

    if (added === 0) {
        return replyMusic(target, musicError('Load Failed', 'Could not load any songs from this playlist.'), { ephemeral: isSlash });
    }
    if (!player.playing && !player.paused) await player.play();

    return replyMusic(target, musicSuccess(
        `Loaded — ${playlist.name}`,
        `Added **${added}** song${added === 1 ? '' : 's'} to the queue${shuffle ? ' (shuffled)' : ''}.`,
        'Now playing.'
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('load-playlist')
        .setDescription('Load and play a saved playlist')
        .addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true))
        .addBooleanOption(o => o.setName('shuffle').setDescription('Shuffle before playing').setRequired(false)),

    prefix: 'load-playlist',
    description: 'Load and play a saved playlist',
    usage: 'load-playlist <name> [shuffle]',
    category: 'music',
    aliases: ['load', 'loadplaylist'],

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

    async execute(interaction, lavalinkManager) {
        return run(
            interaction, lavalinkManager,
            interaction.options.getString('name'),
            interaction.options.getBoolean('shuffle') || false
        );
    },
    async executePrefix(message, args, lavalinkManager) {
        const shuffle = args[args.length - 1]?.toLowerCase() === 'shuffle';
        const name = shuffle ? args.slice(0, -1).join(' ') : args.join(' ');
        return run(message, lavalinkManager, name, shuffle);
    },
};
