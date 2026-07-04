'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');

async function handleDailyCard(reply, user, guildId) {
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);

    const freeRolls = animeManager.checkFreeRolls(playerData);

    if (freeRolls <= 0) {
        const nextReset = new Date();
        nextReset.setHours(24, 0, 0, 0);
        const timeUntil = nextReset.getTime() - Date.now();
        const hours = Math.floor(timeUntil / 3600000);
        const minutes = Math.floor((timeUntil % 3600000) / 60000);

        const container = createContainer(0xFEE75C);
        addTextDisplay(container, [
            `## 🎟️ Daily Rolls`,
            '',
            `> You've used all your free rolls for today!`,
            `> ⏰ Next reset in: **${hours}h ${minutes}m**`,
            '',
            `-# Free rolls: 0/${animeManager.DAILY_FREE_ROLLS} • Use coins to roll: \`aroll\``,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // Use a free roll
    animeManager.useFreeRoll(playerData);
    playerData.lastRoll = Date.now();
    playerData.totalRolls++;

    const character = animeManager.rollCharacter();
    const isDuplicate = animeManager.addToCollection(playerData, character);
    animeManager.saveAnimeData();

    const rarity = animeManager.RARITIES[character.rarity];
    const dupTag = isDuplicate ? ' *(DUPLICATE)*' : ' ✨ **NEW!**';
    const remaining = animeManager.DAILY_FREE_ROLLS - playerData.freeRollsToday;

    const container = createContainer(rarity.color);
    addTextDisplay(container, [
        `## 🎟️ Daily Free Roll`,
        '',
        `### ${rarity.emoji} ${character.name}${dupTag}`,
        `> **Anime:** ${character.anime}`,
        `> **Rarity:** ${rarity.emoji} ${rarity.name}`,
        `> **Value:** 💰 ${rarity.value.toLocaleString()} coins`,
        '',
        `-# Free rolls remaining today: ${remaining}/${animeManager.DAILY_FREE_ROLLS}`,
    ].join('\n'));

    // Wishlist notification
    if (playerData.wishlist.includes(character.id)) {
        addTextDisplay(container, `\n🌟 **WISHLIST HIT!** You got a character from your wishlist!`);
    }

    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adaily')
        .setDescription('Use a free daily anime card roll'),
    prefix: 'adaily',
    description: 'Use one of your free daily anime card rolls',
    usage: 'adaily',
    aliases: ['dailycard', 'freeroll', 'adailyroll'],
    category: 'anime',

    async executePrefix(message) {
        return handleDailyCard(message.reply.bind(message), message.author, message.guild?.id);
    },

    async execute(interaction) {
        return handleDailyCard(interaction.reply.bind(interaction), interaction.user, interaction.guild?.id);
    },
};
