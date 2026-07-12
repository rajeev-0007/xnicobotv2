'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');
const economyManager = require('../../utils/economyManager');

async function handleSell(reply, user, guildId, characterName, sellAll = false) {
    if (!characterName && !sellAll) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, [
            `## ${AE.cancel} Usage`,
            '',
            `> \`asell <character name>\` — Sell a specific character`,
            `> \`asell duplicates\` — Sell all duplicate cards`,
            '',
            `-# You'll receive 50% of the card's value in coins`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, user.id);

    if (sellAll) {
        // Sell all duplicates
        const duplicates = animeManager.getDuplicates(playerData);
        if (duplicates.length === 0) {
            const container = createContainer(0xFEE75C);
            addTextDisplay(container, `## ${AE.warn} No Duplicates\nYou don't have any duplicate cards to sell.`);
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        let totalEarned = 0;
        let totalSold = 0;

        for (const { charId, count } of duplicates) {
            const dupsToSell = count - 1; // Keep 1 copy
            const sellValue = animeManager.getSellValue(charId);

            for (let i = 0; i < dupsToSell; i++) {
                animeManager.removeFromCollection(playerData, charId);
                totalEarned += sellValue;
                totalSold++;
            }
        }

        userData.coins += totalEarned;
        economyManager.saveEconomy(economy);
        animeManager.saveAnimeData();

        const container = createContainer(0x57F287);
        addTextDisplay(container, [
            `## ${AE.money} Duplicates Sold!`,
            '',
            `> ${AE.cards} Sold **${totalSold}** duplicate cards`,
            `> ${AE.money} Earned **${totalEarned.toLocaleString()}** coins`,
            '',
            `-# Your collection now has only unique cards (1 of each)`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // Sell specific character
    const char = animeManager.findCharacter(characterName);
    if (!char) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ${AE.cancel} Not Found\nCharacter "${characterName}" not found. Use \`acharlist\` to see all characters.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (!animeManager.hasCharacter(playerData, char.id)) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ${AE.cancel} Not Owned\nYou don't have **${char.name}** in your collection.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const sellValue = animeManager.getSellValue(char.id);
    const rarity = animeManager.RARITIES[char.rarity];

    animeManager.removeFromCollection(playerData, char.id);
    userData.coins += sellValue;
    economyManager.saveEconomy(economy);
    animeManager.saveAnimeData();

    const container = createContainer(0x57F287);
    addTextDisplay(container, [
        `## ${AE.money} Card Sold!`,
        '',
        `> ${rarity.emoji} **${char.name}** (*${char.anime}*)`,
        `> ${AE.money} Received **${sellValue.toLocaleString()}** coins`,
        '',
        `-# Remaining copies: ${animeManager.getCharacterCount(playerData, char.id)}`,
    ].join('\n'));
    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('asell')
        .setDescription('Sell anime character cards for coins')
        .addStringOption(o => o.setName('character').setDescription('Character name or "duplicates"').setRequired(true)),
    prefix: 'asell',
    description: 'Sell anime cards for coins (50% of card value)',
    usage: 'asell <character|duplicates>',
    aliases: ['animesell', 'cardsell'],
    category: 'anime',

    async executePrefix(message, args) {
        if (args.length === 0) {
            return handleSell(message.reply.bind(message), message.author, message.guild?.id, null);
        }

        const input = args.join(' ').toLowerCase();
        const sellAll = input === 'duplicates' || input === 'dupes' || input === 'dups';

        return handleSell(message.reply.bind(message), message.author, message.guild?.id, sellAll ? null : input, sellAll);
    },

    async execute(interaction) {
        const input = interaction.options.getString('character');
        const sellAll = input.toLowerCase() === 'duplicates' || input.toLowerCase() === 'dupes';
        return handleSell(interaction.reply.bind(interaction), interaction.user, interaction.guild?.id, sellAll ? null : input, sellAll);
    },
};
