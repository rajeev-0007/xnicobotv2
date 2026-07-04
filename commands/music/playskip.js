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

    const doSearch = (q) => Promise.race([
        player.search({ query: q }, requester),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT_MS)),
    ]);

    let res;
    try {
        res = await doSearch(searchQuery);

        // SoundCloud fallback for non-URL searches (matches play.js behavior)
        if (!isUrl && (res.loadType === 'empty' || res.loadType === 'error' || !res.tracks?.length)) {
            try {
                const fallbackRes = await doSearch(`scsearch:${query}`);
                if (fallbackRes.loadType !== 'error' && fallbackRes.tracks?.length) {
                    res = fallbackRes;
                }
            } catch {
                // Fallback timed out — keep original result
            }
        }
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

    if (player.playing || player.paused) {
        await player.skip();
    } else {
        await player.play();
    }

    return replyMusic(target, musicSuccess(
        'Playing Now',
        `**${track.info.title}**\n-# by ${track.info.author || 'Unknown Artist'}`,
        `Duration: \`${formatTime(track.info.duration || 0)}\``
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('playskip')
        .setDescription('Skip the current track and immediately play a new one')
        .addStringOption(o => o.setName('query').setDescription('Song name or URL').setRequired(true)),

    prefix: 'playskip',
    description: 'Skip the current track and immediately play a new one',
    usage: 'playskip <song name or URL>',
    category: 'music',
    aliases: ['ps2', 'pn'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getString('query'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args.join(' '));
    },
};
