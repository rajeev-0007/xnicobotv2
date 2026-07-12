'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay, addSeparator, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');
const { resolveUser } = require('../../utils/resolveUser');

async function handleProfile(reply, targetUser, guildId) {
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, targetUser.id);
    const stats = animeManager.getCollectionStats(playerData);
    const totalValue = animeManager.getCollectionValue(playerData);

    // Build rarity breakdown
    const rarityLines = Object.entries(animeManager.RARITIES).map(([key, rarity]) => {
        const count = stats.byRarity[key] || 0;
        const total = animeManager.CHARACTERS.filter(c => c.rarity === key).length;
        const uniqueOwned = new Set(
            playerData.collection.filter(e => {
                const c = animeManager.CHARACTERS.find(ch => ch.id === e.charId);
                return c && c.rarity === key;
            }).map(e => e.charId)
        ).size;
        return `> ${rarity.emoji} **${rarity.name}:** ${uniqueOwned}/${total} unique (${count} total)`;
    }).reverse(); // Show mythic first

    // Favorites
    const favLines = playerData.favorites.length > 0
        ? playerData.favorites.map(charId => {
            const char = animeManager.CHARACTERS.find(c => c.id === charId);
            if (!char) return null;
            const rarity = animeManager.RARITIES[char.rarity];
            return `> ${rarity.emoji} ${char.name}`;
        }).filter(Boolean)
        : ['> *No favorites set*'];

    // Progress bar
    const filled = Math.round(stats.percentage / 10);
    const progressBar = '█'.repeat(filled) + '░'.repeat(10 - filled);

    const container = createContainer(0x9B59B6);
    addTextDisplay(container, [
        `## ${AE.card} ${targetUser.username}'s Anime Profile`,
        '',
        `### ${AE.progress} Collection Progress`,
        `> \`[${progressBar}]\` **${stats.percentage}%**`,
        `> **${stats.unique}/${stats.maxUnique}** unique characters collected`,
        '',
        `### ${AE.stats} Stats`,
        `> ${AE.cards} **Total Cards:** ${stats.total.toLocaleString()}`,
        `> ${AE.money} **Collection Value:** ${totalValue.toLocaleString()} coins`,
        `> ${AE.roll} **Total Rolls:** ${playerData.totalRolls.toLocaleString()}`,
        `> ${AE.spent} **Total Spent:** ${playerData.totalSpent.toLocaleString()} coins`,
        `> ${AE.trade} **Trades Made:** ${playerData.trades}`,
    ].join('\n'));

    addSeparator(container, SeparatorSpacingSize.Small);

    addTextDisplay(container, [
        `### ${animeManager.RARITIES.mythic.emoji} Rarity Breakdown`,
        rarityLines.join('\n'),
    ].join('\n'));

    addSeparator(container, SeparatorSpacingSize.Small);

    addTextDisplay(container, [
        `### ${AE.favorite} Favorites`,
        favLines.join('\n'),
        '',
        `-# Use \`aroll\` to collect • \`afavorites add\` to showcase`,
    ].join('\n'));

    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aprofile')
        .setDescription('View your anime collector profile')
        .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(false)),
    prefix: 'aprofile',
    description: 'View your or another user\'s anime collector profile with stats',
    usage: 'aprofile [@user]',
    aliases: ['ap', 'animeprofile', 'cardprofile'],
    category: 'anime',

    async executePrefix(message, args) {
        const target = (await resolveUser(message, args)) || message.author;
        return handleProfile(message.reply.bind(message), target, message.guild?.id);
    },

    async execute(interaction) {
        const target = interaction.options?.getUser('user') || interaction.user;
        return handleProfile(interaction.reply.bind(interaction), target, interaction.guild?.id);
    },
};
