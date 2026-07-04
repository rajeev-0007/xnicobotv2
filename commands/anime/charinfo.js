'use strict';

const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const animeCard = require('../../utils/animeCardCanvas');

async function handleCharInfo(reply, user, guildId, characterName) {
    await animeManager.ensurePool();
    if (!characterName) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, [`## <:Cancel:1521227723916181644> Usage`, '', `> \`acharinfo <character name>\``, '', `-# Example: \`acharinfo Levi\``].join('\n'));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const char = animeManager.findCharacter(characterName);
    if (!char) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `## <:Cancel:1521227723916181644> Not Found\nCharacter "${characterName}" not found. Use \`acharlist\` to browse.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const rarity = animeManager.RARITIES[char.rarity];
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);
    const owned = animeManager.getCharacterCount(playerData, char.id);
    const sellValue = animeManager.getSellValue(char.id);

    let globalOwners = 0;
    for (const [, pd] of Object.entries(animeData)) {
        if (pd.collection && pd.collection.some(c => c.charId === char.id)) globalOwners++;
    }

    const buffer = await animeCard.renderCard(char, {});
    const c = createContainer(rarity.color);
    addTextDisplay(c, [
        `## ${rarity.emoji} ${char.name}`,
        `> **Anime:** ${char.anime}`,
        `> **Rarity:** ${rarity.emoji} ${rarity.name}`,
        `> **Value:** 💰 ${rarity.value.toLocaleString()} • **Sell:** 💰 ${sellValue.toLocaleString()}`,
        `> **Drop Rate:** ${rarity.weight}%`,
        char.favourites ? `> **AniList Favourites:** ${char.favourites.toLocaleString()}` : '',
        '',
        `> 🃏 **You Own:** ${owned > 0 ? `${owned} cop${owned > 1 ? 'ies' : 'y'}` : 'Not owned'}`,
        `> 🌍 **Global Owners:** ${globalOwners}`,
        playerData.wishlist.includes(char.id) ? `> ⭐ On your wishlist` : '',
        playerData.favorites.includes(char.id) ? `> 💜 In your favorites` : '',
    ].filter(Boolean).join('\n'));

    return reply({ components: [c], files: [new AttachmentBuilder(buffer, { name: 'char.png' })], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('acharinfo')
        .setDescription('View detailed info about an anime character')
        .addStringOption(o => o.setName('character').setDescription('Character name').setRequired(true)),
    prefix: 'acharinfo',
    description: 'View detailed info about an anime character card',
    usage: 'acharinfo <character name>',
    aliases: ['aci', 'cardinfo', 'charinfo'],
    category: 'anime',

    async executePrefix(message, args) {
        await message.channel.sendTyping().catch(() => {});
        return handleCharInfo(message.reply.bind(message), message.author, message.guild?.id, args.join(' '));
    },

    async execute(interaction) {
        await interaction.deferReply();
        return handleCharInfo((payload) => interaction.editReply(payload), interaction.user, interaction.guild?.id, interaction.options.getString('character'));
    },
};
