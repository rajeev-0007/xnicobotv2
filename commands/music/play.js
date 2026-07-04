'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { waitForLavalink } = require('../../utils/helpers');
const {
    buildNowPlayingContainer,
    buildTrackAddedContainer,
    buildPlaylistAddedContainer,
} = require('../../utils/musicPanel');
const {
    preflightVoiceOnly, musicError, replyMusic,
} = require('../../utils/musicResponse');

const SEARCH_TIMEOUT_MS = 20_000;

/* ─────────────────────────────────────────────────────────────
   Source selector
   ─────────────────────────────────────────────────────────────
   Discord lets us add a slash-option `source` that maps to one of
   Lavalink's standard search prefixes. The user picks "YouTube",
   "Spotify", "SoundCloud", "Apple Music", "Deezer" or "YT Music"
   and we route the search through that platform instead of the
   default `ytsearch:`.

   `auto` (default) keeps the legacy behaviour: try YouTube first,
   fall back to SoundCloud if it returns no results. URLs always
   bypass the search prefix and play directly so a Spotify URL
   still resolves through lavasrc even when source=auto.
   ──────────────────────────────────────────────────────────── */
const SOURCES = {
    auto:       { label: 'Auto (YouTube → SoundCloud)', prefix: 'ytsearch',  emoji: '🎵', fallback: 'scsearch' },
    youtube:    { label: 'YouTube',                      prefix: 'ytsearch',  emoji: '▶️' },
    youtubemusic:{label: 'YouTube Music',                prefix: 'ytmsearch', emoji: '🎶' },
    spotify:    { label: 'Spotify',                      prefix: 'spsearch',  emoji: '🟢', fallback: 'ytsearch' },
    soundcloud: { label: 'SoundCloud',                   prefix: 'scsearch',  emoji: '🟠' },
    applemusic: { label: 'Apple Music',                  prefix: 'amsearch',  emoji: '🎼', fallback: 'ytsearch' },
    deezer:     { label: 'Deezer',                       prefix: 'dzsearch',  emoji: '🎧', fallback: 'ytsearch' },
};

/**
 * Resolve a user-supplied source label / prefix-text to one of the
 * SOURCES keys. Accepts the prefix-text alone (e.g. `spotify`,
 * `sp`, `yt`, `sc`) so prefix-command users have a friendly shortcut
 * without typing `youtubemusic`.
 */
function resolveSource(input) {
    if (!input) return 'auto';
    const v = String(input).toLowerCase().trim();
    if (SOURCES[v]) return v;
    const aliases = {
        yt: 'youtube',
        ytm: 'youtubemusic',
        ytmusic: 'youtubemusic',
        sp: 'spotify',
        spot: 'spotify',
        sc: 'soundcloud',
        sound: 'soundcloud',
        am: 'applemusic',
        apple: 'applemusic',
        dz: 'deezer',
    };
    return aliases[v] || 'auto';
}

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
        // Brief settle so subsequent operations have a connected websocket.
        await new Promise(r => setTimeout(r, 1000));
    }
    return player;
}

async function searchWithFallback(player, query, requester, sourceKey = 'auto') {
    const isUrl = /^https?:\/\//i.test(query);
    const src = SOURCES[sourceKey] || SOURCES.auto;

    // URLs always go straight to Lavalink so a Spotify or SoundCloud
    // link plays through its native source plugin no matter which
    // option the user picked.
    const primary = isUrl ? query : `${src.prefix}:${query}`;

    const doSearch = (q) => Promise.race([
        player.search({ query: q }, requester),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT_MS)),
    ]);

    let res = await doSearch(primary);

    // Per-source fallback. We only fall back for non-URL searches —
    // a failed URL load means the URL itself is dead, not that the
    // search platform missed.
    if (!isUrl && src.fallback && (res.loadType === 'empty' || res.loadType === 'error' || !res.tracks?.length)) {
        try {
            const fallbackRes = await doSearch(`${src.fallback}:${query}`);
            // Only use the fallback result if it actually found something.
            // If the fallback also returned an error or empty, keep the
            // original result so the caller gets the right error message.
            if (fallbackRes.loadType !== 'error' && fallbackRes.tracks?.length) {
                res = fallbackRes;
            }
        } catch {
            // Fallback search timed out or threw — keep original result
        }
    }
    return { res, isUrl, source: sourceKey };
}

async function run(target, lavalinkManager, query, sourceKey = 'auto') {
    const isSlash = typeof target.isRepliable === 'function';
    const member  = target.member;
    const requester = isSlash ? target.user : target.author;

    const voiceErr = preflightVoiceOnly(member);
    if (voiceErr) return replyMusic(target, voiceErr.container, { ephemeral: isSlash });

    if (!query || !query.trim()) {
        return replyMusic(target, musicError(
            'Missing Query',
            'Provide a song name or URL.',
            isSlash ? 'Example: `/play Never Gonna Give You Up`' : 'Example: `-play Never Gonna Give You Up`'
        ), { ephemeral: isSlash });
    }

    if (isSlash) await target.deferReply().catch(() => {});

    if (!(await waitForLavalink(lavalinkManager))) {
        return replyMusic(target, musicError(
            'Music Unavailable',
            'No music servers are connected right now.',
            'Please try again in a moment.'
        ), { ephemeral: isSlash });
    }

    let player;
    try {
        player = await ensurePlayer(target, lavalinkManager, member);
    } catch (err) {
        return replyMusic(target, musicError(
            'Connection Failed',
            'Could not join your voice channel.',
            err?.message || 'Check that I have permission to join and speak.'
        ), { ephemeral: isSlash });
    }

    let res;
    try {
        ({ res } = await searchWithFallback(player, query.trim(), requester, sourceKey));
    } catch (err) {
        const msg = err.message === 'Search timeout'
            ? 'Search timed out. The music server may be slow.'
            : (err.message || 'Failed to search for tracks.');
        return replyMusic(target, musicError('Search Failed', msg, 'Please try again.'), { ephemeral: isSlash });
    }

    if (res.loadType === 'error') {
        return replyMusic(target, musicError(
            'Load Failed',
            res.exception?.message || 'Failed to load track.',
            'Please try a different query or URL.'
        ), { ephemeral: isSlash });
    }
    if (res.loadType === 'empty' || !res.tracks?.length) {
        return replyMusic(target, musicError(
            'No Results',
            'Could not find any tracks matching your query.',
            'Try a different search term or check the URL.'
        ), { ephemeral: isSlash });
    }

    if (res.loadType === 'playlist') {
        let added = 0;
        for (const track of res.tracks) {
            track.requester = requester;
            try { await player.queue.add(track); added++; } catch {}
        }
        if (added === 0) {
            return replyMusic(target, musicError('Empty Playlist', 'Could not add any tracks from the playlist.'), { ephemeral: isSlash });
        }

        const totalDuration = res.tracks.reduce((acc, t) => acc + (t.info.duration || 0), 0);
        const thumbnail = res.tracks[0]?.info?.artworkUrl || res.tracks[0]?.info?.thumbnail;
        const container = buildPlaylistAddedContainer(
            res.playlistInfo?.name || 'Unknown Playlist',
            added,
            totalDuration,
            thumbnail
        );
        await replyMusic(target, container);
        if (!player.playing && !player.paused) await player.play();
        return;
    }

    // Single track
    const track = res.tracks[0];
    track.requester = requester;
    const wasPlaying = player.playing || player.paused;
    try { await player.queue.add(track); }
    catch (err) {
        return replyMusic(target, musicError('Failed to Add', err.message || 'Could not add the track to the queue.'), { ephemeral: isSlash });
    }

    if (!wasPlaying) {
        await player.play();
        // Tiny settle so `queue.current` is set when we render the panel.
        await new Promise(r => setTimeout(r, 500));
        const container = buildNowPlayingContainer(player, target.client.autoplayStatus);
        if (container) return replyMusic(target, container);
    }

    const container = buildTrackAddedContainer(track, player.queue.tracks.length, player.queue.tracks.length);
    return replyMusic(target, container);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('play')
        .setDescription('Play a song or add to the queue')
        .addStringOption(o => o.setName('query').setDescription('Song name or URL').setRequired(true))
        .addStringOption(o => o.setName('source').setDescription('Where to search (default: auto)').setRequired(false)
            .addChoices(
                { name: 'Auto (YouTube → SoundCloud)', value: 'auto' },
                { name: 'YouTube',                      value: 'youtube' },
                { name: 'YouTube Music',                value: 'youtubemusic' },
                { name: 'Spotify',                      value: 'spotify' },
                { name: 'SoundCloud',                   value: 'soundcloud' },
                { name: 'Apple Music',                  value: 'applemusic' },
                { name: 'Deezer',                       value: 'deezer' },
            )),

    prefix: 'play',
    description: 'Play a song or add to the queue',
    usage: 'play <song name or URL> [--source=<yt|ytm|spotify|sc|apple|deezer>]',
    category: 'music',
    aliases: ['p'],

    async execute(interaction, lavalinkManager) {
        const sourceKey = resolveSource(interaction.options.getString('source'));
        return run(interaction, lavalinkManager, interaction.options.getString('query'), sourceKey);
    },
    async executePrefix(message, args, lavalinkManager) {
        // Prefix users get a `--source=spotify` (or `-s spotify`) flag
        // so the same source picker is reachable without slash. We
        // strip the flag from the query so the rest of the args is
        // exactly what they typed minus the source switch.
        let sourceKey = 'auto';
        const cleaned = [];
        for (let i = 0; i < args.length; i++) {
            const arg = args[i];
            const m = /^(?:--source=|-s=|src=|source=)(.+)$/i.exec(arg);
            if (m) { sourceKey = resolveSource(m[1]); continue; }
            if (/^(?:--source|-s|src|source)$/i.test(arg) && args[i + 1]) {
                sourceKey = resolveSource(args[i + 1]);
                i++;
                continue;
            }
            cleaned.push(arg);
        }
        return run(message, lavalinkManager, cleaned.join(' '), sourceKey);
    },
};
