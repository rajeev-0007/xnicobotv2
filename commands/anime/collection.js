'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay, addSeparator, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { resolveUser } = require('../../utils/resolveUser');

const CARDS_PER_PAGE = 10;

async function handleCollection(reply, targetUser, viewerId, page = 0, filterRarity = null) {
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, targetUser.id);
    const isSelf = targetUser.id === viewerId;

    if (playerData.collection.length === 0) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `## 🎴 Anime Collection`,
            '',
            isSelf
                ? `> You haven't collected any characters yet!`
                : `> ${targetUser.username} hasn't collected any characters yet!`,
            '',
            `-# Use \`aroll\` to start collecting anime characters`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // Get unique characters (show highest duplicate count)
    const charMap = new Map();
    for (const entry of playerData.collection) {
        const existing = charMap.get(entry.charId);
        if (!existing) {
            charMap.set(entry.charId, { charId: entry.charId, count: 1, obtainedAt: entry.obtainedAt });
        } else {
            existing.count++;
        }
    }

    let entries = [...charMap.values()];

    // Apply filter
    if (filterRarity) {
        entries = entries.filter(e => {
            const char = animeManager.CHARACTERS.find(c => c.id === e.charId);
            return char && char.rarity === filterRarity;
        });
    }

    // Sort by rarity (highest first), then name
    const rarityOrder = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
    entries.sort((a, b) => {
        const charA = animeManager.CHARACTERS.find(c => c.id === a.charId);
        const charB = animeManager.CHARACTERS.find(c => c.id === b.charId);
        const rarA = rarityOrder.indexOf(charA?.rarity || 'common');
        const rarB = rarityOrder.indexOf(charB?.rarity || 'common');
        if (rarA !== rarB) return rarA - rarB;
        return (charA?.name || '').localeCompare(charB?.name || '');
    });

    const totalPages = Math.ceil(entries.length / CARDS_PER_PAGE);
    page = Math.max(0, Math.min(page, totalPages - 1));

    const pageEntries = entries.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE);

    const lines = pageEntries.map(entry => {
        const char = animeManager.CHARACTERS.find(c => c.id === entry.charId);
        if (!char) return null;
        const rarity = animeManager.RARITIES[char.rarity];
        const countStr = entry.count > 1 ? ` x${entry.count}` : '';
        return `${rarity.emoji} **${char.name}**${countStr} — *${char.anime}*`;
    }).filter(Boolean);

    const stats = animeManager.getCollectionStats(playerData);

    const container = createContainer(0x9B59B6);
    addTextDisplay(container, [
        `## 🎴 ${targetUser.username}'s Collection`,
        '',
        `> 📊 **${stats.unique}/${stats.maxUnique}** unique (${stats.percentage}% complete)`,
        `> 🃏 **${stats.total}** total cards collected`,
        '',
        lines.join('\n'),
        '',
        filterRarity ? `-# Filtered: ${animeManager.RARITIES[filterRarity].emoji} ${animeManager.RARITIES[filterRarity].name} only` : '',
        `-# Page ${page + 1}/${totalPages} • Use \`acollection --page <n>\` to navigate`,
    ].filter(Boolean).join('\n'));

    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('acollection')
        .setDescription('View your anime character collection')
        .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(false))
        .addIntegerOption(o => o.setName('page').setDescription('Page number').setRequired(false))
        .addStringOption(o => o.setName('rarity').setDescription('Filter by rarity')
            .addChoices(
                { name: 'Common', value: 'common' },
                { name: 'Uncommon', value: 'uncommon' },
                { name: 'Rare', value: 'rare' },
                { name: 'Epic', value: 'epic' },
                { name: 'Legendary', value: 'legendary' },
                { name: 'Mythic', value: 'mythic' },
            ).setRequired(false)),
    prefix: 'acollection',
    description: 'View your or another user\'s anime character collection',
    usage: 'acollection [@user] [--page <n>] [--rarity <rarity>]',
    aliases: ['ac', 'cards', 'mycards', 'animecards'],
    category: 'anime',

    async executePrefix(message, args) {
        const target = (await resolveUser(message, args)) || message.author;
        let page = 0;
        let rarity = null;

        for (let i = 0; i < args.length; i++) {
            if ((args[i] === '--page' || args[i] === '-p') && args[i + 1]) {
                page = parseInt(args[i + 1]) - 1;
            }
            if ((args[i] === '--rarity' || args[i] === '-r') && args[i + 1]) {
                rarity = args[i + 1].toLowerCase();
            }
        }

        return handleCollection(message.reply.bind(message), target, message.author.id, page, rarity);
    },

    async execute(interaction) {
        const target = interaction.options?.getUser('user') || interaction.user;
        const page = (interaction.options?.getInteger('page') || 1) - 1;
        const rarity = interaction.options?.getString('rarity') || null;
        return handleCollection(interaction.reply.bind(interaction), target, interaction.user.id, page, rarity);
    },
};
