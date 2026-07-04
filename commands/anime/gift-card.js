'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');

async function handleGift(reply, author, targetUser, characterName, guildId) {
    if (!targetUser || !characterName) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, [
            `## ❌ Usage`,
            '',
            `> \`agift @user <character name>\``,
            '',
            `-# Gift one of your anime cards to another user`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (targetUser.id === author.id) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Error\nYou can't gift cards to yourself!`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (targetUser.bot) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Error\nYou can't gift cards to bots!`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const char = animeManager.findCharacter(characterName);
    if (!char) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Not Found\nCharacter "${characterName}" not found.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const animeData = animeManager.loadAnimeData();
    const authorData = animeManager.getPlayerData(animeData, author.id);
    const targetData = animeManager.getPlayerData(animeData, targetUser.id);

    if (!animeManager.hasCharacter(authorData, char.id)) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Not Owned\nYou don't have **${char.name}** in your collection.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // Execute gift
    animeManager.removeFromCollection(authorData, char.id);
    animeManager.addToCollection(targetData, char);
    animeManager.saveAnimeData();

    const rarity = animeManager.RARITIES[char.rarity];
    const container = createContainer(0x57F287);
    addTextDisplay(container, [
        `## 🎁 Card Gifted!`,
        '',
        `**${author.username}** gifted ${rarity.emoji} **${char.name}** to **${targetUser.username}**!`,
        '',
        `> **Card:** ${char.name} (*${char.anime}*)`,
        `> **Rarity:** ${rarity.emoji} ${rarity.name}`,
        `> **Value:** 💰 ${rarity.value.toLocaleString()} coins`,
        '',
        `-# How generous! 🎉`,
    ].join('\n'));

    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('agift')
        .setDescription('Gift an anime card to another user')
        .addUserOption(o => o.setName('user').setDescription('User to gift to').setRequired(true))
        .addStringOption(o => o.setName('character').setDescription('Character to gift').setRequired(true)),
    prefix: 'agift',
    description: 'Gift one of your anime cards to another user',
    usage: 'agift <@user> <character name>',
    aliases: ['cardgift', 'animegift'],
    category: 'anime',

    async executePrefix(message, args) {
        const target = message.mentions.users.first();
        if (!target) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Error\nPlease mention a user to gift to.`);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        const characterName = args.filter(a => !a.match(/^<@!?\d+>$/)).join(' ');
        return handleGift(message.reply.bind(message), message.author, target, characterName, message.guild?.id);
    },

    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const characterName = interaction.options.getString('character');
        return handleGift(interaction.reply.bind(interaction), interaction.user, target, characterName, interaction.guild?.id);
    },
};
