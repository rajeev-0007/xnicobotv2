'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay, addSeparator, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const economyManager = require('../../utils/economyManager');

function buildRollEmbed(character, isDuplicate, playerData, guildId, isFreeRoll) {
    const rarity = animeManager.RARITIES[character.rarity];
    const container = createContainer(rarity.color);

    const dupTag = isDuplicate ? ' *(DUPLICATE)*' : ' ✨ **NEW!**';
    const costLine = isFreeRoll ? '🎟️ Free Roll' : `💰 Cost: ${animeManager.ROLL_COST} coins`;

    addTextDisplay(container, [
        `## ${rarity.emoji} Anime Roll`,
        '',
        `### ${character.name}${dupTag}`,
        `> **Anime:** ${character.anime}`,
        `> **Rarity:** ${rarity.emoji} ${rarity.name}`,
        `> **Value:** 💰 ${rarity.value.toLocaleString()} coins`,
        '',
        `-# ${costLine} • Collection: ${playerData.collection.length} cards`,
    ].join('\n'));

    return container;
}

function buildMultiRollEmbed(results, newCount, dupCount, playerData, guildId, isFreeRoll) {
    const container = createContainer(0x9B59B6);

    const lines = results.map(char => {
        const rarity = animeManager.RARITIES[char.rarity];
        return `${rarity.emoji} **${char.name}** — *${char.anime}*`;
    });

    const costLine = isFreeRoll
        ? '🎟️ Free Multi-Roll'
        : `💰 Cost: ${animeManager.MULTI_ROLL_COST} coins`;

    addTextDisplay(container, [
        `## 🎴 Multi Roll (x${animeManager.MULTI_ROLL_COUNT})`,
        '',
        lines.join('\n'),
        '',
        `> ✨ **${newCount} New** | 🔄 **${dupCount} Duplicates**`,
        '',
        `-# ${costLine} • Collection: ${playerData.collection.length} cards`,
    ].join('\n'));

    return container;
}

async function handleRoll(reply, user, guildId, multi = false) {
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, user.id);

    // Cooldown check
    const now = Date.now();
    if (now - playerData.lastRoll < animeManager.ROLL_COOLDOWN) {
        const remaining = Math.ceil((animeManager.ROLL_COOLDOWN - (now - playerData.lastRoll)) / 1000);
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ⏳ Cooldown\nPlease wait **${remaining}s** before rolling again.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // Check free rolls
    const freeRolls = animeManager.checkFreeRolls(playerData);
    let isFreeRoll = false;

    if (freeRolls > 0 && !multi) {
        isFreeRoll = true;
    } else {
        // Check coins
        const cost = multi ? animeManager.MULTI_ROLL_COST : animeManager.ROLL_COST;
        if (userData.coins < cost) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, [
                `## 💸 Not Enough Coins`,
                '',
                `You need **${cost.toLocaleString()}** coins to roll${multi ? ' (x10)' : ''}.`,
                `> Current balance: **${(userData.coins || 0).toLocaleString()}** coins`,
                '',
                freeRolls > 0 ? `-# 🎟️ You have ${freeRolls} free single roll(s) remaining today!` : `-# 💡 Use \`daily\` or \`work\` to earn coins`,
            ].join('\n'));
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Deduct coins
        userData.coins -= cost;
        playerData.totalSpent += cost;
        economyManager.saveEconomy(economy);
    }

    if (isFreeRoll) {
        animeManager.useFreeRoll(playerData);
    }

    playerData.lastRoll = now;

    if (multi) {
        // Multi roll
        const results = animeManager.rollMultiple();
        let newCount = 0;
        let dupCount = 0;

        for (const char of results) {
            const isDup = animeManager.addToCollection(playerData, char);
            if (isDup) dupCount++;
            else newCount++;
        }

        playerData.totalRolls += animeManager.MULTI_ROLL_COUNT;
        animeManager.saveAnimeData();

        const container = buildMultiRollEmbed(results, newCount, dupCount, playerData, guildId, isFreeRoll);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } else {
        // Single roll
        const character = animeManager.rollCharacter();
        const isDuplicate = animeManager.addToCollection(playerData, character);
        playerData.totalRolls++;
        animeManager.saveAnimeData();

        // Check wishlist notification
        let wishlistHit = playerData.wishlist.includes(character.id);

        const container = buildRollEmbed(character, isDuplicate, playerData, guildId, isFreeRoll);

        if (wishlistHit) {
            addSeparator(container, SeparatorSpacingSize.Small);
            addTextDisplay(container, `🌟 **WISHLIST HIT!** You got a character from your wishlist!`);
        }

        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aroll')
        .setDescription('Roll for a random anime character card')
        .addBooleanOption(o => o.setName('multi').setDescription('Do a multi-roll (x10)').setRequired(false)),
    prefix: 'aroll',
    description: 'Roll for a random anime character card (gacha)',
    usage: 'aroll [--multi]',
    aliases: ['ar', 'animeroll', 'gacha'],
    category: 'anime',

    async executePrefix(message, args) {
        const multi = args.includes('multi') || args.includes('--multi') || args.includes('x10');
        return handleRoll(message.reply.bind(message), message.author, message.guild?.id, multi);
    },

    async execute(interaction) {
        const multi = interaction.options?.getBoolean('multi') || false;
        return handleRoll(interaction.reply.bind(interaction), interaction.user, interaction.guild?.id, multi);
    },
};
