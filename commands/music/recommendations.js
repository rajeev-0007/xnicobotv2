'use strict';

const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { formatTime } = require('../../utils/musicHelpers');
const { getPlatformInfo, truncateText } = require('../../utils/musicPanel');
const {
    preflightPlayer, musicError, replyMusic, buildMusicContainer, COLOR,
} = require('../../utils/musicResponse');

const SEARCH_TIMEOUT_MS = 15_000;
const MAX_RECS = 10;
const CACHE_TTL_MS = 5 * 60_000;

function buildRecQueries(track) {
    const baseTitle = track.info.title.split('(')[0].split('[')[0].trim();
    return [
        `${track.info.author} top tracks`,
        `${track.info.author} similar`,
        `songs like ${baseTitle}`,
        `${baseTitle} radio mix`,
    ];
}

async function fetchRecommendations(player, track, requester, count) {
    const seen = new Set([track.info.uri]);
    for (const t of (player.queue.tracks || [])) seen.add(t.info.uri);

    const recommendations = [];
    for (const q of buildRecQueries(track)) {
        if (recommendations.length >= count) break;
        try {
            const r = await Promise.race([
                player.search({ query: `ytsearch:${q}` }, requester),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Search timeout')), SEARCH_TIMEOUT_MS)),
            ]);
            if (r?.tracks?.length) {
                for (const t of r.tracks) {
                    if (recommendations.length >= count) break;
                    if (!seen.has(t.info.uri)) {
                        seen.add(t.info.uri);
                        recommendations.push(t);
                    }
                }
            }
        } catch {}
    }
    return recommendations;
}

function buildRecContainer(track, recommendations) {
    const lines = recommendations.map((t, i) => {
        const platform = getPlatformInfo(t.info.sourceName);
        const title = truncateText(t.info.title, 45);
        const author = truncateText(t.info.author || 'Unknown', 30);
        return `\`${i + 1}.\` ${platform.icon} **${title}**\n-# by ${author} · \`${formatTime(t.info.duration || 0)}\``;
    }).join('\n\n');

    const body =
        `Based on **${truncateText(track.info.title, 40)}** by ${truncateText(track.info.author || 'Unknown', 30)}\n\n` +
        `${lines}`;

    const container = buildMusicContainer({
        title: 'Recommendations',
        emoji: '<:Music:1521228141543165982>',
        body,
        footer: 'Click a number to add that track, or **Add All** to queue every result.',
        color: COLOR.BRAND,
        brand: false,
    });

    const numEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
    const buttons = recommendations.map((_t, i) =>
        new ButtonBuilder()
            .setCustomId(`rec_add_${i}`)
            .setLabel(String(i + 1))
            .setEmoji(numEmojis[i] || '🔢')
            .setStyle(ButtonStyle.Secondary)
    );

    // Discord rows hold up to 5 buttons. With up to 10 recommendations we
    // need both rows for the numbered buttons; the "Add All" button gets
    // its own third row so no numbered button is silently dropped.
    const row1 = new ActionRowBuilder().addComponents(...buttons.slice(0, 5));
    const numberedRows = [row1];
    if (buttons.length > 5) {
        numberedRows.push(new ActionRowBuilder().addComponents(...buttons.slice(5, 10)));
    }
    const addAllRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('rec_add_all')
            .setLabel('Add All')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:Play:1521228333700878416>')
    );

    container.addActionRowComponents(...numberedRows, addAllRow);
    return container;
}

async function run(target, lavalinkManager, count) {
    const isSlash = typeof target.isRepliable === 'function';
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const requester = isSlash ? target.user : target.author;

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    if (!lavalinkManager.useable) {
        return replyMusic(target, musicError('Music Unavailable', 'No music servers are connected right now.', 'Please try again in a moment.'), { ephemeral: isSlash });
    }

    if (isSlash) await target.deferReply().catch(() => {});

    const track = player.queue.current;
    const safeCount = Math.min(MAX_RECS, Math.max(1, Number.isFinite(count) ? count : 5));
    const recommendations = await fetchRecommendations(player, track, requester, safeCount);

    if (recommendations.length === 0) {
        return replyMusic(target, musicError('No Recommendations', 'Could not find similar tracks for this song.', 'Try a different song.'), { ephemeral: isSlash });
    }

    const container = buildRecContainer(track, recommendations);
    const sent = await replyMusic(target, container);
    const messageId = sent?.id || sent?.message?.id;

    if (messageId) {
        const cache = (target.client.recommendationCache = target.client.recommendationCache || new Map());
        cache.set(messageId, {
            tracks: recommendations,
            userId: requester.id,
            expires: Date.now() + CACHE_TTL_MS,
        });
        setTimeout(() => cache.delete(messageId), CACHE_TTL_MS);
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('recommendations')
        .setDescription('Get track recommendations based on the current song')
        .addIntegerOption(o => o.setName('count')
            .setDescription(`Number of recommendations (1-${MAX_RECS})`)
            .setMinValue(1).setMaxValue(MAX_RECS).setRequired(false)),

    prefix: 'recommendations',
    description: 'Get track recommendations based on the current song',
    usage: 'recommendations [count]',
    category: 'music',
    aliases: ['recs', 'recommend'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getInteger('count') || 5);
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, parseInt(args[0]) || 5);
    },
};
