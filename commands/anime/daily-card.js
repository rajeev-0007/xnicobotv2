'use strict';

const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const animeCard = require('../../utils/animeCardCanvas');

async function handleDailyCard(reply, user, guildId) {
    await animeManager.ensurePool();
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);

    const freeRolls = animeManager.checkFreeRolls(playerData);
    if (freeRolls <= 0) {
        const nextReset = new Date();
        nextReset.setHours(24, 0, 0, 0);
        const timeUntil = nextReset.getTime() - Date.now();
        const hours = Math.floor(timeUntil / 3600000);
        const minutes = Math.floor((timeUntil % 3600000) / 60000);
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, [
            `## 🎟️ Daily Rolls`,
            `> You've used all your free rolls today!`,
            `> ⏰ Reset in **${hours}h ${minutes}m**`,
            `-# Free rolls: 0/${animeManager.DAILY_FREE_ROLLS} • Use coins: \`aroll\``,
        ].join('\n'));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    animeManager.useFreeRoll(playerData);
    playerData.lastRoll = Date.now();
    playerData.totalRolls++;

    const character = animeManager.rollCharacter();
    const isDuplicate = animeManager.addToCollection(playerData, character);
    animeManager.saveAnimeData();

    const rarity = animeManager.RARITIES[character.rarity];
    const remaining = animeManager.DAILY_FREE_ROLLS - playerData.freeRollsToday;
    const buffer = await animeCard.renderCard(character, { isDuplicate, isNew: !isDuplicate });

    const c = createContainer(rarity.color);
    const lines = [
        `## 🎟️ Daily Free Roll — **${character.name}**`,
        `> ${rarity.emoji} **${rarity.name}** • 💰 ${rarity.value.toLocaleString()} value`,
        `-# Free rolls left today: ${remaining}/${animeManager.DAILY_FREE_ROLLS}`,
    ];
    if (playerData.wishlist.includes(character.id)) lines.push(`\n🌟 **WISHLIST HIT!**`);
    addTextDisplay(c, lines.join('\n'));
    c.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL('attachment://card.png')
        )
    );

    return reply({ components: [c], files: [new AttachmentBuilder(buffer, { name: 'card.png' })], flags: MessageFlags.IsComponentsV2 });
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
        await message.channel.sendTyping().catch(() => {});
        return handleDailyCard(message.reply.bind(message), message.author, message.guild?.id);
    },

    async execute(interaction) {
        await interaction.deferReply();
        return handleDailyCard((payload) => interaction.editReply(payload), interaction.user, interaction.guild?.id);
    },
};
