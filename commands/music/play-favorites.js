'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { models } = require('../../utils/database');
const { waitForLavalink } = require('../../utils/helpers');
const {
    preflightVoiceOnly, musicSuccess, musicError, replyMusic,
} = require('../../utils/musicResponse');

const SEARCH_TIMEOUT_MS = 15_000;

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

async function run(target, lavalinkManager, shuffle) {
    const isSlash = typeof target.isRepliable === 'function';
    const member  = target.member;
    const requester = isSlash ? target.user : target.author;
    const userId  = isSlash ? target.user.id : target.author.id;

    const voiceErr = preflightVoiceOnly(member);
    if (voiceErr) return replyMusic(target, voiceErr.container, { ephemeral: isSlash });

    if (isSlash) await target.deferReply().catch(() => {});

    if (!(await waitForLavalink(lavalinkManager))) {
        return replyMusic(target, musicError('Music Unavailable', 'No music servers are connected right now.', 'Please try again in a moment.'), { ephemeral: isSlash });
    }

    const favorites = await models.FavoriteSong.find({ userId });
    if (!favorites?.length) {
        return replyMusic(target, musicError('No Favorites', 'You have no saved tracks yet.', 'Use `/like` while a song is playing.'), { ephemeral: isSlash });
    }

    let player;
    try { player = await ensurePlayer(target, lavalinkManager, member); }
    catch (err) {
        return replyMusic(target, musicError('Connection Failed', 'Could not join your voice channel.', err?.message), { ephemeral: isSlash });
    }

    let songs = [...favorites];
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
        return replyMusic(target, musicError('Load Failed', 'Could not load any of your favorite tracks.'), { ephemeral: isSlash });
    }
    if (!player.playing && !player.paused) await player.play();

    return replyMusic(target, musicSuccess(
        'Playing Favorites',
        `Added **${added}** track${added === 1 ? '' : 's'} to the queue${shuffle ? ' (shuffled)' : ''}.`,
        'Now playing your favorites.'
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play-favorites')
        .setDescription('Play all your favorite tracks')
        .addBooleanOption(o => o.setName('shuffle').setDescription('Shuffle before playing').setRequired(false)),

    prefix: 'play-favorites',
    description: 'Play all your favorite tracks',
    usage: 'play-favorites [shuffle]',
    category: 'music',
    aliases: ['playfav', 'pf'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getBoolean('shuffle') || false);
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args[0]?.toLowerCase() === 'shuffle');
    },
};
