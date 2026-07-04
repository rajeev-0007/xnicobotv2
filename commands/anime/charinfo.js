'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');

async function handleCharInfo(reply, user, guildId, characterName) {
    if (!characterName) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, [
            `## ❌ Usage`,
            '',
            `> \`acharinfo <character name>\``,
            '',
            `-# Example: \`acharinfo Goku\` or \`acharinfo Naruto\``,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const char = animeManager.findCharacter(characterName);
    if (!char) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Not Found\nCharacter "${characterName}" not found. Use \`acharlist\` to browse all characters.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const rarity = animeManager.RARITIES[char.rarity];
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);
    const owned = animeManager.getCharacterCount(playerData, char.id);
    const sellValue = animeManager.getSellValue(char.id);

    // Check how many players globally own this character
    let globalOwners = 0;
    for (const [, pd] of Object.entries(animeData)) {
        if (pd.collection && pd.collection.some(c => c.charId === char.id)) {
            globalOwners++;
        }
    }

    const container = createContainer(rarity.color);
    addTextDisplay(container, [
        `## ${rarity.emoji} ${char.name}`,
        '',
        `> **Anime:** ${char.anime}`,
        `> **Rarity:** ${rarity.emoji} ${rarity.name}`,
        `> **Base Value:** 💰 ${rarity.value.toLocaleString()} coins`,
        `> **Sell Value:** 💰 ${sellValue.toLocaleString()} coins`,
        `> **Drop Rate:** ${rarity.weight}%`,
        '',
        `> 🃏 **You Own:** ${owned > 0 ? `${owned} cop${owned > 1 ? 'ies' : 'y'}` : 'Not owned'}`,
        `> 🌍 **Global Owners:** ${globalOwners} player${globalOwners !== 1 ? 's' : ''}`,
        '',
        playerData.wishlist.includes(char.id) ? `> ⭐ On your wishlist` : '',
        playerData.favorites.includes(char.id) ? `> 💜 In your favorites` : '',
        '',
        `-# ID: ${char.id}`,
    ].filter(Boolean).join('\n'));

    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('acharinfo')
        .setDescription('View detailed info about an anime character')
        .addStringOption(o => o.setName('character').setDescription('Character name or ID').setRequired(true)),
    prefix: 'acharinfo',
    description: 'View detailed info about an anime character card',
    usage: 'acharinfo <character name>',
    aliases: ['aci', 'cardinfo', 'charinfo'],
    category: 'anime',

    async executePrefix(message, args) {
        const characterName = args.join(' ');
        return handleCharInfo(message.reply.bind(message), message.author, message.guild?.id, characterName);
    },

    async execute(interaction) {
        const characterName = interaction.options.getString('character');
        return handleCharInfo(interaction.reply.bind(interaction), interaction.user, interaction.guild?.id, characterName);
    },
};
