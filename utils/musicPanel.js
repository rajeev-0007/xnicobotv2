const {
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    MediaGalleryBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ChannelType
} = require('discord.js');
const { formatTime } = require('./helpers');
const fs = require('fs');
const path = require('path');

const jsonStore = require('./jsonStore');
const log = require('./logger-styled');
const updateLocks = new Map();
const voiceStatusDebounce = new Map();

const MUSIC_THEME = {
    primary: 0x5865F2,
    success: 0x57F287,
    warning: 0xFEE75C,
    danger: 0xED4245,
    spotify: 0x1DB954,
    youtube: 0xFF0000,
    soundcloud: 0xFF5500,
    apple: 0xFC3C44
};

// Confirmed-valid emojis only. Unicode fallbacks used for cross-server emojis
// that were causing COMPONENT_INVALID_EMOJI errors when the bot lacked access.
const EMOJIS = {
    play: '<:Play:1521228333700878416>',
    pause: '<:Pause:1521228431889661994>',
    stop: '<:Microphoneoff:1521228303762063380>',
    previous: '<:Skipprev:1521228277891731616>',
    next: '<:Skipnext:1521228437711225126>',
    loop: '<:Refresh:1521227946441052420>',
    volume: '<:Volumeup:1521228004502536272>',
    mute: '<:Volumeoff:1521228297864745193>',
    queue: '<:Invoice:1521227903956811836>',
    music: '<:Music:1521228141543165982>',
    filters: '<:Fire:1521227907647668374>',
    verify: '<:Checkedbox:1521227734943269077>',
    wrong: '<:Cancel:1521227723916181644>',
    youtube: '<:YoutubeLive:1521228137541927022>',
    spotify: '<:spotify:1521228327761744043>',
    soundcloud: '<:soundCloud:1521228420468445375>',
    apple: '<:applemusic:1521228425962983484>',
    live: '<:Notificationon:1521227730304106680>',
    loading: '<:Lightningalt:1521227851796447472>',
    headphone: '<:Headphone:1521228310385000478>',
    fastforward: '<:Fastforward:1521228443465810024>',
    fastrewind: '<:Fastrewind:1521228448985645107>',
    forward: '<:Forward:1521228316093186098>',
    dislike: '<:Dislike:1521228158471508008>',
    like: '<:Like:1521228164104454175>',
    qended: '⏹',
    microphone: '<:Microphone:1521227746376683590>',
    musicNote: '<:Music:1521228141543165982>'
};

function createProgressBar(position, duration, length = 18) {
    if (duration === 0) return `${EMOJIS.live} **LIVE**`;

    const ratio = Math.min(position / duration, 1);
    const filled = Math.round(ratio * length);

    // Build bar: ━ for track, ● for playhead
    let bar = '';
    for (let i = 0; i < length; i++) {
        if (i < filled) bar += '━';
        else if (i === filled) bar += '⬤';
        else bar += '╌';
    }

    return `\`${bar}\``;
}

function createVolumeBar(volume, length = 8) {
    const filled = Math.floor((volume / 100) * length);
    const bar = '█'.repeat(filled) + '░'.repeat(length - filled);
    return `\`${bar}\``;
}

function getPlatformInfo(sourceName) {
    const source = (sourceName || '').toLowerCase();
    if (source.includes('youtube')) return { icon: EMOJIS.youtube, name: 'YouTube', color: MUSIC_THEME.youtube };
    if (source.includes('spotify')) return { icon: EMOJIS.spotify, name: 'Spotify', color: MUSIC_THEME.spotify };
    if (source.includes('soundcloud')) return { icon: EMOJIS.soundcloud, name: 'SoundCloud', color: MUSIC_THEME.soundcloud };
    if (source.includes('apple')) return { icon: EMOJIS.apple, name: 'Apple Music', color: MUSIC_THEME.apple };
    return { icon: EMOJIS.music, name: 'Music', color: MUSIC_THEME.primary };
}

function truncateText(text, maxLength) {
    if (!text) return 'Unknown';
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
}

function buildNowPlayingContainer(player, autoplayStatus, options = {}) {
    const track = player.queue.current;
    if (!track) return null;

    const position = player.position || 0;
    const duration = track.info.duration || 0;
    const isLiveStream = duration === 0 || track.info.isStream;

    let is247Enabled = false;
    if (jsonStore.has('musicpanel-247')) {
        try {
            const config247 = jsonStore.read('musicpanel-247');
            is247Enabled = config247[player.guildId]?.enabled || false;
        } catch (e) { }
    }

    const autoplayEnabled = autoplayStatus?.get(player.guildId) || false;
    const loopMode = player.repeatMode || 'off';
    const platform = getPlatformInfo(track.info.sourceName);

    const title = truncateText(track.info.title, 50);
    const author = truncateText(track.info.author, 40);
    const progressBar = createProgressBar(position, duration);

    // Status line
    const statusParts = [];
    if (player.paused) statusParts.push(`${EMOJIS.pause} Paused`);
    if (loopMode === 'track') statusParts.push(`${EMOJIS.loop} Track Loop`);
    else if (loopMode === 'queue') statusParts.push(`<:Shuffle:1521228321403437228> Queue Loop`);
    if (autoplayEnabled) statusParts.push('<:Lightningalt:1521227851796447472> Autoplay');
    if (is247Enabled) statusParts.push('<:Star:1521227981685526568> 24/7');

    const container = new ContainerBuilder();
    container.setAccentColor(platform.color);

    // Artwork
    const artworkUrl = track.info.artworkUrl || track.info.thumbnail;
    if (artworkUrl && artworkUrl.startsWith('http')) {
        try {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(item => item.setURL(artworkUrl))
            );
        } catch (e) { }
    }

    // Now Playing header + track info
    let content = `# ${EMOJIS.music} Now Playing\n\n`;
    content += `### ${platform.icon} ${title}\n`;
    content += `-# by **${author}**\n\n`;

    if (isLiveStream) {
        content += `${EMOJIS.live} **LIVE STREAM**\n`;
    } else {
        const pct = Math.min(Math.round((position / duration) * 100), 100);
        content += `> \`${formatTime(position)}\` ${progressBar} \`${formatTime(duration)}\`\n`;
        content += `-# ${pct}% played\n`;
    }

    content += `\n${EMOJIS.volume} **${player.volume}%** · ${EMOJIS.queue} **${player.queue.tracks.length}** in queue`;

    if (statusParts.length > 0) {
        content += `\n-# ${statusParts.join(' · ')}`;
    }

    content += `\n-# Requested by <@${track.requester?.id || 'Unknown'}>`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    // Up Next section
    if (player.queue.tracks.length > 0) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        const nextTracks = player.queue.tracks.slice(0, 3);
        let queueText = `### ${EMOJIS.queue} Up Next\n`;
        queueText += nextTracks.map((t, i) => {
            const p = getPlatformInfo(t.info.sourceName);
            const trackTitle = truncateText(t.info.title, 38);
            const trackDuration = t.info.duration ? formatTime(t.info.duration) : 'LIVE';
            return `\`${i + 1}.\` ${p.icon} ${trackTitle} · \`${trackDuration}\``;
        }).join('\n');

        if (player.queue.tracks.length > 3) {
            queueText += `\n-# **+${player.queue.tracks.length - 3} more in queue**`;
        }

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(queueText));
    }

    // --- Control Buttons (3 rows instead of 5) ---
    // Distinct loop icon per mode so users can tell what's active.
    const loopEmoji = loopMode === 'track' ? '<:Refresh:1521227946441052420>' :
        loopMode === 'queue' ? '<:Shuffle:1521228321403437228>' :
            EMOJIS.forward;

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_previous').setEmoji(EMOJIS.previous).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_pause_resume').setEmoji(player.paused ? EMOJIS.play : EMOJIS.pause).setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('panel_skip').setEmoji(EMOJIS.next).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_stop').setEmoji(EMOJIS.stop).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('panel_loop').setEmoji(loopEmoji).setStyle(loopMode !== 'off' ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_volume_down').setEmoji('<:Volumedown:1521228131825090792>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_volume_up').setEmoji('<:Volumeup:1521228004502536272>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_shuffle').setEmoji('<:Shuffle:1521228321403437228>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_autoplay').setEmoji('<:Lightningalt:1521227851796447472>').setStyle(autoplayEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_filters').setEmoji(EMOJIS.filters).setStyle(ButtonStyle.Secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_queue').setEmoji(EMOJIS.queue).setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_like').setEmoji('<:Heart:1521228100652765247>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_lyrics').setEmoji('<:Edit:1521227886634205298>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_grab').setEmoji('<:Download:1521228191899975810>').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('panel_247').setEmoji('<:Star:1521227981685526568>').setStyle(is247Enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    container.addActionRowComponents(row1, row2, row3);
    return container;
}

function buildIdlePanel(guildId = null) {
    const container = new ContainerBuilder();
    container.setAccentColor(MUSIC_THEME.primary);

    // Check 24/7 status
    let is247Enabled = false;
    if (guildId) {
        if (jsonStore.has('musicpanel-247')) {
            try {
                const config247 = jsonStore.read('musicpanel-247');
                is247Enabled = config247[guildId]?.enabled || false;
            } catch (e) { }
        }
    }

    // Banner
    const bannerUrl = 'https://cdn.discordapp.com/attachments/1457289768462188677/1517460672818974750/file_0000000099d8720696beb125a10eb38c.png?ex=6a365ce1&is=6a350b61&hm=153b72d872e3e0d3eef56560dde3e44969eb9ce605b3f856b5a89ede15730721';
    try {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(item => item.setURL(bannerUrl))
        );
    } catch (e) { }

    // Header
    let headerContent = `# ${EMOJIS.music} Music Player\n\n`;
    headerContent += `**Standby** — no track is playing right now.\n`;
    if (is247Enabled) {
        headerContent += `\n<:Star:1521227981685526568> **24/7 Mode** is active — bot will stay in voice.\n`;
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    // How to use + platforms in one block
    let infoContent = `### How to Play\n`;
    infoContent += `> **1.** Join a voice channel\n`;
    infoContent += `> **2.** Type a song name in this channel — or use \`/play <query>\`\n`;
    infoContent += `> **3.** Use the buttons below to control playback\n\n`;
    infoContent += `### Supported Platforms\n`;
    infoContent += `${EMOJIS.youtube} YouTube · ${EMOJIS.spotify} Spotify · ${EMOJIS.soundcloud} SoundCloud · ${EMOJIS.apple} Apple Music\n\n`;
    infoContent += `-# Waiting for your request · <:xnico:1486755083390550036> [xNico </>](https://discord.gg/Zs35X7Umak) Development`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(infoContent));

    // Idle buttons (all disabled except 24/7)
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_previous').setEmoji(EMOJIS.previous).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('panel_pause_resume').setEmoji(EMOJIS.play).setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId('panel_skip').setEmoji(EMOJIS.next).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('panel_stop').setEmoji(EMOJIS.stop).setStyle(ButtonStyle.Danger).setDisabled(true),
        new ButtonBuilder().setCustomId('panel_loop').setEmoji(EMOJIS.forward).setStyle(ButtonStyle.Secondary).setDisabled(true)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_volume_down').setEmoji('<:Volumedown:1521228131825090792>').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('panel_volume_up').setEmoji('<:Volumeup:1521228004502536272>').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('panel_shuffle').setEmoji('<:Shuffle:1521228321403437228>').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('panel_autoplay').setEmoji('<:Lightningalt:1521227851796447472>').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('panel_filters').setEmoji(EMOJIS.filters).setStyle(ButtonStyle.Secondary).setDisabled(true)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('panel_queue').setEmoji(EMOJIS.queue).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('panel_like').setEmoji('<:Heart:1521228100652765247>').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('panel_lyrics').setEmoji('<:Edit:1521227886634205298>').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('panel_grab').setEmoji('<:Download:1521228191899975810>').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('panel_247').setEmoji('<:Star:1521227981685526568>').setStyle(is247Enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    container.addActionRowComponents(row1, row2, row3);
    return container;
}

// Recovery hint shown on command-response cards (added-to-queue, playlist
// added, queue view) so users always know to run `fix` when music breaks.
// NOTE: intentionally NOT added to the persistent now-playing panel to keep
// that auto-updating UI clean.
const FIX_FOOTER_TEXT = '-# <:Refresh:1521227946441052420> Music not playing right? Run `fix` to reconnect the nodes, then play again.';

function addFixFooter(container) {
    try {
        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(FIX_FOOTER_TEXT)
        );
    } catch (e) { /* never let footer decoration break a card */ }
    return container;
}

function buildQueueContainer(player, page = 0) {
    const tracksPerPage = 10;
    const queue = player.queue.tracks;
    const totalPages = Math.ceil(queue.length / tracksPerPage) || 1;
    const currentPage = Math.min(Math.max(0, page), totalPages - 1);
    const start = currentPage * tracksPerPage;
    const end = Math.min(start + tracksPerPage, queue.length);

    const container = new ContainerBuilder();
    container.setAccentColor(MUSIC_THEME.primary);
    const current = player.queue.current;

    let content = `# ${EMOJIS.queue} Queue\n\n`;

    if (current) {
        const platform = getPlatformInfo(current.info.sourceName);
        content += `**Now Playing**\n`;
        content += `${platform.icon} **${truncateText(current.info.title, 42)}**\n`;
        content += `-# by ${truncateText(current.info.author, 30)} · \`${formatTime(current.info.duration || 0)}\`\n`;
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    let queueContent = `### Up Next — ${queue.length} track${queue.length !== 1 ? 's' : ''}\n`;

    if (queue.length === 0) {
        queueContent += `-# Queue is empty — add some tracks!\n`;
    } else {
        const pageTracks = queue.slice(start, end);
        queueContent += pageTracks.map((track, i) => {
            const num = start + i + 1;
            const p = getPlatformInfo(track.info.sourceName);
            const title = truncateText(track.info.title, 34);
            const duration = track.info.duration ? formatTime(track.info.duration) : 'LIVE';
            return `-# ${p.icon} \`${num}.\` ${title} · \`${duration}\``;
        }).join('\n');
    }

    const totalDuration = queue.reduce((acc, t) => acc + (t.info.duration || 0), 0);
    if (totalPages > 1) {
        queueContent += `\n\n-# Page ${currentPage + 1}/${totalPages} · Total: \`${formatTime(totalDuration)}\``;
    } else if (queue.length > 0) {
        queueContent += `\n\n-# Total: \`${formatTime(totalDuration)}\``;
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(queueContent));

    if (queue.length > 0) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`queue_prev_${currentPage}`)
                .setEmoji('<:Caretleft:1521227977495543838>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage === 0),
            new ButtonBuilder()
                .setCustomId('queue_shuffle')
                .setEmoji('<:Shuffle:1521228321403437228>')
                .setLabel('Shuffle')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('queue_clear')
                .setEmoji('<:Trash:1521227750420254820>')
                .setLabel('Clear')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`queue_next_${currentPage}`)
                .setEmoji('<:Skipnext:1521228437711225126>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(currentPage >= totalPages - 1)
        );
        container.addActionRowComponents(row);
    }

    addFixFooter(container);
    return container;
}

function buildTrackAddedContainer(track, position, queueLength) {
    const platform = getPlatformInfo(track.info.sourceName);
    const container = new ContainerBuilder();

    const artworkUrl = track.info.artworkUrl || track.info.thumbnail;
    if (artworkUrl && artworkUrl.startsWith('http')) {
        try {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(item => item.setURL(artworkUrl))
            );
        } catch (e) { }
    }

    let content = `# ${EMOJIS.verify} Added to Queue\n\n`;
    content += `### ${truncateText(track.info.title, 45)}\n`;
    content += `-# by **${truncateText(track.info.author, 35)}** • ${platform.name}\n\n`;
    content += `${EMOJIS.queue} Position: **#${position}** • Duration: \`${formatTime(track.info.duration || 0)}\`\n`;
    content += `-# Queue now has ${queueLength} tracks`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    addFixFooter(container);
    return container;
}

function buildPlaylistAddedContainer(playlistName, trackCount, totalDuration, thumbnail) {
    const container = new ContainerBuilder();

    if (thumbnail && thumbnail.startsWith('http')) {
        try {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(item => item.setURL(thumbnail))
            );
        } catch (e) { }
    }

    let content = `# ${EMOJIS.verify} Playlist Added\n\n`;
    content += `### ${truncateText(playlistName, 45)}\n\n`;
    content += `${EMOJIS.music} **${trackCount}** tracks added\n`;
    content += `<:Timer:1521227971590095070> Total Duration: \`${formatTime(totalDuration)}\`\n`;
    content += `-# Tracks added to the queue`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    addFixFooter(container);
    return container;
}

function buildFiltersContainer(player) {
    const container = new ContainerBuilder();

    const currentFilters = player.filterManager?.filters || {};

    let content = `# ${EMOJIS.filters} Audio Filters\n\n`;
    content += `-# Select filters to enhance your listening experience\n\n`;

    const filterList = [
        { id: 'bassboost', name: 'Bass Boost', emoji: '<:Volumeup:1521228004502536272>', desc: 'Enhance low frequencies' },
        { id: 'nightcore', name: 'Nightcore', emoji: '<:Lightningalt:1521227851796447472>', desc: 'Speed up with higher pitch' },
        { id: 'vaporwave', name: 'Vaporwave', emoji: '🌊', desc: 'Slow down with lower pitch' },
        { id: '8d', name: '8D Audio', emoji: EMOJIS.headphone, desc: 'Rotating surround effect' },
        { id: 'karaoke', name: 'Karaoke', emoji: EMOJIS.microphone, desc: 'Remove vocals' },
        { id: 'tremolo', name: 'Tremolo', emoji: EMOJIS.musicNote, desc: 'Oscillating volume' }
    ];

    content += filterList.map(f => {
        const active = currentFilters[f.id] ? '`ON`' : '`OFF`';
        return `${f.emoji} **${f.name}** ${active}\n-# ${f.desc}`;
    }).join('\n\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('filter_bassboost').setLabel('Bass Boost').setEmoji('<:Volumeup:1521228004502536272>').setStyle(currentFilters.bassboost ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('filter_nightcore').setLabel('Nightcore').setEmoji('<:Lightningalt:1521227851796447472>').setStyle(currentFilters.nightcore ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('filter_vaporwave').setLabel('Vaporwave').setEmoji('🌊').setStyle(currentFilters.vaporwave ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('filter_8d').setLabel('8D Audio').setEmoji(EMOJIS.headphone).setStyle(currentFilters['8d'] ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('filter_karaoke').setLabel('Karaoke').setEmoji(EMOJIS.microphone).setStyle(currentFilters.karaoke ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('filter_tremolo').setLabel('Tremolo').setEmoji(EMOJIS.musicNote).setStyle(currentFilters.tremolo ? ButtonStyle.Success : ButtonStyle.Secondary)
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('filter_clear').setLabel('Clear All').setEmoji('<:Trash:1521227750420254820>').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('filter_close').setEmoji('<:Cancel:1521227723916181644>').setLabel('Close').setStyle(ButtonStyle.Secondary)
    );

    container.addActionRowComponents(row1, row2, row3);
    return container;
}

function buildMusicSuccess(title, description, extra = '') {
    const container = new ContainerBuilder();
    let content = `# ${EMOJIS.verify} ${title}\n\n`;
    content += `${description}`;
    if (extra) content += `\n\n-# ${extra}`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return container;
}

function buildMusicError(title, description, suggestion = '') {
    const container = new ContainerBuilder();
    let content = `# ${EMOJIS.wrong} ${title}\n\n`;
    content += `${description}`;
    if (suggestion) content += `\n\n-# ${suggestion}`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return container;
}

function buildMusicLoading(message = 'Processing...') {
    const container = new ContainerBuilder();
    let content = `# ${EMOJIS.loading} ${message}\n\n`;
    content += `-# Please wait...`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return container;
}

/**
 * Build voice channel status string with platform glyphs.
 * Voice-channel-status (PUT /channels/:id/voice-status) does NOT render
 * custom guild emojis — only Unicode shows up in the VC sidebar. We use
 * voiceStatusGlyph() to map the source name to a Unicode glyph.
 * @param {Object} player - Lavalink player
 * @param {Object} [track] - Optional track override (defaults to player.queue.current)
 * @returns {string} Formatted status string
 */
function buildVoiceStatus(player, track = null) {
    const currentTrack = track || player?.queue?.current;
    if (!currentTrack?.info) return '';

    const { voiceStatusGlyph } = require('./musicHelpers');
    const glyph = voiceStatusGlyph(currentTrack.info.sourceName);
    const title = truncateText(currentTrack.info.title, 40);

    if (player?.paused) {
        return `⏸ Paused — ${title}`;
    }
    return `${glyph} ${title}`;
}

/**
 * Build waiting/idle voice channel status string.
 * @returns {string} Formatted waiting status
 */
function buildWaitingStatus() {
    return `<:Music:1521228141543165982> **/play <song>**`;
}

/**
 * Centralized voice channel status updater with debouncing.
 * Call ONLY when a real activity change happens (play, pause, resume, stop, skip, queue end).
 * @param {Client} client - Discord client
 * @param {Object} playerOrIds - Lavalink player OR { guildId, voiceChannelId } for destroyed players
 * @param {'auto'|'waiting'|'clear'} type - 'auto' detects playing/paused from player state
 * @param {Object} [track] - Optional track override for trackStart
 */
async function updateVoiceChannelStatus(client, playerOrIds, type = 'auto', track = null) {
    try {
        const guildId = playerOrIds?.guildId;
        const voiceChannelId = playerOrIds?.voiceChannelId;
        if (!guildId || !voiceChannelId) return;

        const guild = client.guilds.cache.get(guildId);
        const vc = guild?.channels.cache.get(voiceChannelId);
        if (!vc || (vc.type !== ChannelType.GuildVoice && vc.type !== ChannelType.GuildStageVoice)) return;

        let status;
        if (type === 'waiting') {
            status = buildWaitingStatus();
        } else if (type === 'clear') {
            status = null; // Discord requires null to clear, empty string doesn't work
        } else {
            status = playerOrIds.queue ? buildVoiceStatus(playerOrIds, track) : null;
        }

        // Debounce: avoid rapid voice status API calls (rate-limit safe)
        const debounceKey = guildId;
        if (voiceStatusDebounce.has(debounceKey)) {
            clearTimeout(voiceStatusDebounce.get(debounceKey));
        }

        await new Promise((resolve) => {
            voiceStatusDebounce.set(debounceKey, setTimeout(async () => {
                voiceStatusDebounce.delete(debounceKey);
                try {
                    await client.rest.put(`/channels/${vc.id}/voice-status`, {
                        body: { status: status === null ? null : status.substring(0, 500) }
                    });
                } catch (err) {
                    if (err.status === 429) {
                        log.warning(`Voice status rate-limited for guild ${guildId}`);
                    } else if (err.status !== 403 && err.status !== 404) {
                        log.error(`Voice status update failed: ${err.message}`);
                    }
                }
                resolve();
            }, 300));
        });
    } catch (e) {
        log.error(`Voice status error: ${e.message}`);
    }
}

async function acquirePanelLock(guildId) {
    if (updateLocks.get(guildId)) return false;
    updateLocks.set(guildId, true);
    return true;
}

function releasePanelLock(guildId) {
    updateLocks.delete(guildId);
}

async function updateMusicPanel(client, player, autoplayStatus, forceGuildId = null) {

    const guildId = forceGuildId || player?.guildId;
    if (!guildId) return;

    if (!jsonStore.has('musicpanel')) return;

    let panelConfig;
    try {
        panelConfig = jsonStore.read('musicpanel');
    } catch (e) {
        return;
    }

    const config = panelConfig[guildId];
    if (!config || !config.channelId || !config.messageId) return;

    const lockAcquired = await acquirePanelLock(guildId);
    if (!lockAcquired) return;

    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            releasePanelLock(guildId);
            return;
        }

        const channel = guild.channels.cache.get(config.channelId);
        if (!channel) {
            releasePanelLock(guildId);
            return;
        }

        let message;
        try {
            message = await channel.messages.fetch(config.messageId);
        } catch (e) {
            releasePanelLock(guildId);
            return;
        }

        const currentPlayer = player || client.lavalinkManager?.getPlayer(guildId);

        let container;
        if (currentPlayer && currentPlayer.queue.current) {
            container = buildNowPlayingContainer(currentPlayer, autoplayStatus);
        } else {
            container = buildIdlePanel(guildId);
        }

        if (container) {
            await message.edit({
                components: [container],
                flags: require('discord.js').MessageFlags.IsComponentsV2
            }).catch(() => { });
        }
    } catch (error) {
        log.error('Music panel update error:', error);
    } finally {
        releasePanelLock(guildId);
    }
}

module.exports = {
    buildNowPlayingContainer,
    buildIdlePanel,
    buildQueueContainer,
    buildTrackAddedContainer,
    buildPlaylistAddedContainer,
    buildFiltersContainer,
    buildMusicSuccess,
    buildMusicError,
    buildMusicLoading,
    updateMusicPanel,
    acquirePanelLock,
    releasePanelLock,
    createProgressBar,
    createVolumeBar,
    getPlatformInfo,
    buildVoiceStatus,
    buildWaitingStatus,
    updateVoiceChannelStatus,
    truncateText,
    MUSIC_THEME,
    EMOJIS
};
