'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE, rankBadge } = require('../../utils/animeEmojis');

async function handleLeaderboard(reply, guildId, type = 'collection') {
    const animeData = animeManager.loadAnimeData();
    const players = Object.entries(animeData).filter(([, pd]) => pd.collection && pd.collection.length > 0);

    if (players.length === 0) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `## ${AE.trophy} Anime Leaderboard`,
            '',
            `> No one has collected any cards yet!`,
            '',
            `-# Use \`aroll\` to start collecting`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    let sorted;
    let title;
    let valueLabel;

    switch (type) {
        case 'unique':
            title = `${AE.trophy} Unique Cards Leaderboard`;
            valueLabel = 'unique';
            sorted = players.map(([userId, pd]) => ({
                userId,
                value: new Set(pd.collection.map(c => c.charId)).size,
            })).sort((a, b) => b.value - a.value);
            break;

        case 'value':
            title = `${AE.money} Collection Value Leaderboard`;
            valueLabel = 'coins value';
            sorted = players.map(([userId, pd]) => ({
                userId,
                value: animeManager.getCollectionValue(pd),
            })).sort((a, b) => b.value - a.value);
            break;

        case 'rolls':
            title = `${AE.roll} Total Rolls Leaderboard`;
            valueLabel = 'rolls';
            sorted = players.map(([userId, pd]) => ({
                userId,
                value: pd.totalRolls || 0,
            })).sort((a, b) => b.value - a.value);
            break;

        default: // collection
            title = `${AE.trophy} Collection Size Leaderboard`;
            valueLabel = 'cards';
            sorted = players.map(([userId, pd]) => ({
                userId,
                value: pd.collection.length,
            })).sort((a, b) => b.value - a.value);
            break;
    }

    const top10 = sorted.slice(0, 10);

    const lines = top10.map((entry, i) => {
        const medal = rankBadge(i + 1);
        const valueStr = type === 'value'
            ? `${AE.money} ${entry.value.toLocaleString()}`
            : `${entry.value.toLocaleString()} ${valueLabel}`;
        return `${medal} <@${entry.userId}> — ${valueStr}`;
    });

    const container = createContainer(0xF1C40F);
    addTextDisplay(container, [
        `## ${title}`,
        '',
        lines.join('\n'),
        '',
        `-# ${players.length} total collectors • Use \`aleaderboard [collection|unique|value|rolls]\``,
    ].join('\n'));

    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aleaderboard')
        .setDescription('View the anime collection leaderboard')
        .addStringOption(o => o.setName('type').setDescription('Leaderboard type')
            .addChoices(
                { name: 'Collection Size', value: 'collection' },
                { name: 'Unique Cards', value: 'unique' },
                { name: 'Collection Value', value: 'value' },
                { name: 'Total Rolls', value: 'rolls' },
            ).setRequired(false)),
    prefix: 'aleaderboard',
    description: 'View the anime collection leaderboard (top collectors)',
    usage: 'aleaderboard [collection|unique|value|rolls]',
    aliases: ['alb', 'animelb', 'cardlb'],
    category: 'anime',

    async executePrefix(message, args) {
        const type = args[0]?.toLowerCase() || 'collection';
        return handleLeaderboard(message.reply.bind(message), message.guild?.id, type);
    },

    async execute(interaction) {
        const type = interaction.options?.getString('type') || 'collection';
        return handleLeaderboard(interaction.reply.bind(interaction), interaction.guild?.id, type);
    },
};
