'use strict';

const { SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const {
    musicError, replyMusic,
    buildMusicContainer, COLOR,
} = require('../../utils/musicResponse');

const LYRICS_TIMEOUT_MS = 10_000;

/**
 * Clean up a track title for better lyrics search results.
 * Removes parenthetical metadata, pipe-separated suffixes,
 * featuring credits, and video-type labels.
 */
function cleanTrackTitle(title) {
    return (title || '')
        .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
        .replace(/\|.*$/g, '')
        .replace(/ft\..*$/gi, '')
        .replace(/feat\..*$/gi, '')
        .replace(/official\s*(video|audio|music\s*video|lyric\s*video|visualizer)/gi, '')
        .trim();
}

/**
 * Clean up an artist/author name for better search results.
 */
function cleanArtistName(author) {
    return (author || '')
        .replace(/VEVO$/i, '')
        .replace(/ - Topic$/i, '')
        .replace(/Official$/i, '')
        .replace(/Music$/i, '')
        .trim();
}

/**
 * Best-effort lyrics fetcher using multiple sources.
 *
 * Priority:
 *   1. LRCLIB (lrclib.net) — modern, reliable, free, no API key
 *   2. lyrics.ovh — legacy fallback (often unreliable)
 *
 * Returns: { title, artist, lyrics } | null
 */
async function fetchLyrics(query) {
    const cleaned = query.replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
    const parts = cleaned.split(/\s*-\s*/);

    let artist = '';
    let title = cleaned;

    if (parts.length >= 2) {
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
    }

    // ── Strategy 1: LRCLIB search (best source) ──
    try {
        const searchQuery = artist ? `${artist} ${title}` : title;
        const lrcRes = await axios.get('https://lrclib.net/api/search', {
            params: { q: searchQuery },
            timeout: LYRICS_TIMEOUT_MS,
            headers: { 'User-Agent': 'xNico/2.0.0 (https://thenico.vercel.app)' },
            validateStatus: s => s < 500,
        });

        if (lrcRes.status === 200 && Array.isArray(lrcRes.data) && lrcRes.data.length > 0) {
            // Prefer a result that has plainLyrics
            const match = lrcRes.data.find(r => r.plainLyrics) || lrcRes.data[0];
            if (match.plainLyrics) {
                return {
                    artist: match.artistName || artist || 'Unknown',
                    title: match.trackName || title,
                    lyrics: match.plainLyrics,
                };
            }
        }
    } catch {}

    // ── Strategy 2: LRCLIB direct get (if we have artist + title) ──
    if (artist && title) {
        try {
            const directRes = await axios.get('https://lrclib.net/api/get', {
                params: {
                    track_name: title,
                    artist_name: artist,
                },
                timeout: LYRICS_TIMEOUT_MS,
                headers: { 'User-Agent': 'xNico/2.0.0 (https://thenico.vercel.app)' },
                validateStatus: s => s < 500,
            });

            if (directRes.status === 200 && directRes.data?.plainLyrics) {
                return {
                    artist: directRes.data.artistName || artist,
                    title: directRes.data.trackName || title,
                    lyrics: directRes.data.plainLyrics,
                };
            }
        } catch {}
    }

    // ── Strategy 3: lyrics.ovh legacy fallback ──
    if (artist && title) {
        try {
            const ovhRes = await axios.get(
                `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
                { timeout: LYRICS_TIMEOUT_MS, validateStatus: s => s < 500 }
            );
            if (ovhRes.status === 200 && ovhRes.data?.lyrics) {
                return { artist, title, lyrics: ovhRes.data.lyrics };
            }
        } catch {}
    }

    return null;
}

function chunkLyrics(text, max = 1500) {
    const out = [];
    let buf = '';
    for (const line of String(text).split('\n')) {
        if ((buf + line + '\n').length > max) {
            out.push(buf.trimEnd());
            buf = '';
        }
        buf += line + '\n';
    }
    if (buf.trim()) out.push(buf.trimEnd());
    return out;
}

async function run(target, lavalinkManager, songQuery) {
    const isSlash = typeof target.isRepliable === 'function';
    const player  = lavalinkManager.getPlayer(target.guild.id);

    let query = (songQuery || '').trim();
    if (!query) {
        if (!player || !player.queue?.current) {
            return replyMusic(target, musicError(
                'Missing Query',
                'Provide a song name, or play one first.',
                'Example: `/lyrics Imagine Dragons - Believer`'
            ), { ephemeral: isSlash });
        }
        const t = player.queue.current.info;
        // Use cleaned title/author for better search results
        const cleanedAuthor = cleanArtistName(t.author);
        const cleanedTitle = cleanTrackTitle(t.title);
        query = cleanedAuthor ? `${cleanedAuthor} - ${cleanedTitle}` : cleanedTitle;
    }

    if (isSlash) {
        await target.deferReply().catch(() => {});
    }

    const found = await fetchLyrics(query);
    if (!found || !found.lyrics?.trim()) {
        return replyMusic(target, musicError(
            'Lyrics Not Found',
            `Couldn't find lyrics for **${query}**.`,
            'Try formatting as `Artist - Song Title`.'
        ), { ephemeral: isSlash });
    }

    const chunks = chunkLyrics(found.lyrics, 1500);
    const head = `**${found.title}**\n-# by ${found.artist}\n\n${chunks[0]}`;
    const footer = chunks.length > 1
        ? `Showing first part of ${chunks.length}. Source: lrclib.net`
        : 'Source: lrclib.net';

    const first = buildMusicContainer({
        title: 'Lyrics',
        emoji: '<:Edit:1521227886634205298>',
        body: head,
        footer,
        color: COLOR.BRAND,
    });

    return replyMusic(target, first);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lyrics')
        .setDescription('Fetch lyrics for a track')
        .addStringOption(o => o.setName('song')
            .setDescription('Song name (omit to use the current track)')
            .setRequired(false)),

    prefix: 'lyrics',
    description: 'Fetch lyrics for a track',
    usage: 'lyrics [song]',
    category: 'music',
    aliases: ['ly', 'words'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getString('song'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args.join(' '));
    },
};
