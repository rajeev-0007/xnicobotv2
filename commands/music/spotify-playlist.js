'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { waitForLavalink } = require('../../utils/helpers');
const {
    preflightVoiceOnly, musicSuccess, musicError, replyMusic,
} = require('../../utils/musicResponse');

const SEARCH_TIMEOUT_MS = 20_000;
const MAX_TRACKS = 100;

async function ensurePlayer(target, lavalinkManager, member) {
    let player = lavalinkManager.getPlayer(target.guild.id);
    if (!player) {
        player = await lavalinkManager.createPlayer({
            guildId: target.guild.id,
            voiceChannelId: member.voice.channel.id,
            textChannelId: target.channel.id,
            selfDeaf: true,
            volume: 100,
        });
    }
    if (!player.connected) await player.connect();
    return player;
}

async function run(target, lavalinkManager, query) {
    const isSlash = typeof target.isRepliable === 'function';
    const member  = target.member;
    const requester = isSlash ? target.user : target.author;

    const voiceErr = preflightVoiceOnly(member);
    if (voiceErr) return replyMusic(target, voiceErr.container, { ephemeral: isSlash });

    if (!query || !query.trim()) {
        return replyMusic(target, musicError('Missing Query', 'Provide a Spotify playlist URL or search term.'), { ephemeral: isSlash });
    }

    if (isSlash) await target.deferReply().catch(() => {});

    if (!(await waitForLavalink(lavalinkManager))) {
        return replyMusic(target, musicError('Music Unavailable', 'No music servers are connected right now.', 'Please try again in a moment.'), { ephemeral: isSlash });
    }

    let player;
    try { player = await ensurePlayer(target, lavalinkManager, member); }
    catch (err) {
        return replyMusic(target, musicError('Connection Failed', 'Could not join your voice channel.', err?.message), { ephemeral: isSlash });
    }

    const isSpotifyUrl = /spotify\.com|spotify:/i.test(query);
    const searchQuery = isSpotifyUrl ? query : `ytsearch:${query} playlist`;

    let res;
    try {
        res = await Promise.race([
            player.search({ query: searchQuery }, requester),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT_MS)),
        ]);
    } catch (err) {
        const msg = err.message === 'Search timeout'
            ? 'Search timed out. The music server may be slow.'
            : (err.message || 'Failed to search for tracks.');
        return replyMusic(target, musicError('Search Failed', msg), { ephemeral: isSlash });
    }

    if (!res || res.loadType === 'empty' || res.loadType === 'error' || !res.tracks?.length) {
        return replyMusic(target, musicError('Not Found', 'Could not load that Spotify playlist.', 'Check the URL or try a different query.'), { ephemeral: isSlash });
    }

    let tracks = res.tracks;
    let playlistName = res.playlistInfo?.name || res.playlist?.name || 'Spotify Playlist';
    if (res.loadType !== 'playlist') {
        tracks = tracks.slice(0, MAX_TRACKS);
        playlistName = query.length > 50 ? query.slice(0, 47) + '…' : query;
    }

    const wasPlaying = player.playing || player.paused;
    for (const track of tracks) player.queue.add(track);
    if (!wasPlaying) await player.play();

    return replyMusic(target, musicSuccess(
        'Spotify Playlist Loaded',
        `**${playlistName}**\n-# Added **${tracks.length}** track${tracks.length === 1 ? '' : 's'} to the queue.`,
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('spotify-playlist')
        .setDescription('Play a Spotify playlist by URL or search')
        .addStringOption(o => o.setName('query').setDescription('Spotify playlist URL or search query').setRequired(true)),

    prefix: 'spotify-playlist',
    description: 'Play a Spotify playlist by URL or search',
    usage: 'spotify-playlist <url or query>',
    category: 'music',
    aliases: ['spl'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getString('query'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args.join(' '));
    },
};
