'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const { waitForLavalink } = require('../../utils/helpers');
const { formatTime } = require('../../utils/musicHelpers');
const { getPlatformInfo, truncateText } = require('../../utils/musicPanel');
const {
    preflightVoiceOnly, musicError, replyMusic, COLOR, ICON, buildMusicContainer,
} = require('../../utils/musicResponse');

const SEARCH_TIMEOUT_MS = 20_000;
const RESULTS_TTL_MS    = 60_000;

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

function buildResultContainer(query, tracks) {
    const lines = tracks.map((t, i) => {
        const platform = getPlatformInfo(t.info.sourceName);
        const title = truncateText(t.info.title, 50);
        const author = truncateText(t.info.author || 'Unknown', 30);
        return `\`${i + 1}.\` ${platform.icon} **${title}**\n-# by ${author} · \`${formatTime(t.info.duration || 0)}\``;
    }).join('\n\n');

    const container = buildMusicContainer({
        title: 'Search Results',
        emoji: '<:Search:1521228231263387738>',
        body: `**Query:** ${truncateText(query, 80)}\n\n${lines}`,
        footer: 'Pick a track below — selection expires in 60 seconds.',
        color: COLOR.BRAND,
        brand: false,
    });

    const numEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
    const buttons = tracks.slice(0, 5).map((_t, i) =>
        new ButtonBuilder()
            .setCustomId(`search_select_${i}`)
            .setLabel(String(i + 1))
            .setEmoji(numEmojis[i])
            .setStyle(ButtonStyle.Primary)
    );

    const row1 = new ActionRowBuilder().addComponents(...buttons.slice(0, 4));
    const row2Buttons = [...buttons.slice(4)];
    row2Buttons.push(
        new ButtonBuilder()
            .setCustomId('search_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(ICON.ERROR)
    );
    const row2 = new ActionRowBuilder().addComponents(...row2Buttons);

    container.addActionRowComponents(row1, row2);
    return container;
}

async function run(target, lavalinkManager, query) {
    const isSlash = typeof target.isRepliable === 'function';
    const member  = target.member;
    const requester = isSlash ? target.user : target.author;

    const voiceErr = preflightVoiceOnly(member);
    if (voiceErr) return replyMusic(target, voiceErr.container, { ephemeral: isSlash });

    if (!query || !query.trim()) {
        return replyMusic(target, musicError('Missing Query', 'Provide something to search for.'), { ephemeral: isSlash });
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

    const doSearch = (q) => Promise.race([
        player.search({ query: q }, requester),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT_MS)),
    ]);

    let res;
    try {
        res = await doSearch(`ytsearch:${query}`);
        if (res.loadType === 'empty' || !res.tracks?.length) {
            res = await doSearch(`scsearch:${query}`);
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

    const tracks = res.tracks.slice(0, 5);
    const container = buildResultContainer(query, tracks);

    const cache = (target.client.searchResults = target.client.searchResults || new Map());
    const userId = isSlash ? target.user.id : target.author.id;
    cache.set(userId, { tracks, player, timestamp: Date.now() });
    setTimeout(() => cache.delete(userId), RESULTS_TTL_MS);

    return replyMusic(target, container);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Search for tracks and pick one to play')
        .addStringOption(o => o.setName('query').setDescription('Song name or URL').setRequired(true)),

    prefix: 'search',
    description: 'Search for tracks and pick one to play',
    usage: 'search <query>',
    category: 'music',
    aliases: ['find', 'lookup'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getString('query'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args.join(' '));
    },
};
