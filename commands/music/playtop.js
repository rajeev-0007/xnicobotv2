'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { waitForLavalink } = require('../../utils/helpers');
const { formatTime } = require('../../utils/musicHelpers');
const {
    preflightVoiceOnly, musicSuccess, musicError, replyMusic,
} = require('../../utils/musicResponse');

const SEARCH_TIMEOUT_MS = 10_000;

async function ensurePlayer(target, lavalinkManager, member) {
    let player = lavalinkManager.getPlayer(target.guild.id);
    if (!player) {
        player = await lavalinkManager.createPlayer({
            guildId: target.guild.id,
            voiceChannelId: member.voice.channel.id,
            textChannelId: target.channel.id,
            selfDeaf: true,
            selfMute: false,
            volume: 100,
        });
        await player.connect();
        await new Promise(r => setTimeout(r, 800));
    }
    return player;
}

async function run(target, lavalinkManager, query) {
    const isSlash = typeof target.isRepliable === 'function';
    const member  = target.member;
    const requester = isSlash ? target.user : target.author;

    const voiceErr = preflightVoiceOnly(member);
    if (voiceErr) return replyMusic(target, voiceErr.container, { ephemeral: isSlash });

    if (!query || !query.trim()) {
        return replyMusic(target, musicError('Missing Query', 'Provide a song name or URL.'), { ephemeral: isSlash });
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

    const isUrl = /^https?:\/\//i.test(query);
    const searchQuery = isUrl ? query : `ytsearch:${query}`;

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

    if (res.loadType === 'empty' || !res.tracks?.length) {
        return replyMusic(target, musicError('No Results', 'No results found.', 'Try a different query.'), { ephemeral: isSlash });
    }

    const track = res.tracks[0];
    track.requester = requester;
    await player.queue.add(track, 0);

    if (!player.playing && !player.paused) {
        await player.play();
    }

    return replyMusic(target, musicSuccess(
        'Added to Top of Queue',
        `**${track.info.title}**\n-# by ${track.info.author || 'Unknown Artist'}`,
        `Duration: \`${formatTime(track.info.duration || 0)}\` · Up next.`
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playtop')
        .setDescription('Add a track to the top of the queue')
        .addStringOption(o => o.setName('query').setDescription('Song name or URL').setRequired(true)),

    prefix: 'playtop',
    description: 'Add a track to the top of the queue',
    usage: 'playtop <song name or URL>',
    category: 'music',
    aliases: ['pt'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getString('query'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args.join(' '));
    },
};
