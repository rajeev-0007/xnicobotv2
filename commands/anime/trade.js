'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');

async function handleTrade(reply, message, author, targetUser, offerName, wantName, guildId) {
    if (targetUser.id === author.id) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Trade Failed\nYou can't trade with yourself!`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (targetUser.bot) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Trade Failed\nYou can't trade with bots!`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const offerChar = animeManager.findCharacter(offerName);
    const wantChar = animeManager.findCharacter(wantName);

    if (!offerChar) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Trade Failed\nCharacter "${offerName}" not found. Use \`acharlist\` to see all characters.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (!wantChar) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Trade Failed\nCharacter "${wantName}" not found. Use \`acharlist\` to see all characters.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const animeData = animeManager.loadAnimeData();
    const authorData = animeManager.getPlayerData(animeData, author.id);
    const targetData = animeManager.getPlayerData(animeData, targetUser.id);

    if (!animeManager.hasCharacter(authorData, offerChar.id)) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Trade Failed\nYou don't have **${offerChar.name}** in your collection!`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (!animeManager.hasCharacter(targetData, wantChar.id)) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Trade Failed\n**${targetUser.username}** doesn't have **${wantChar.name}**!`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const offerRarity = animeManager.RARITIES[offerChar.rarity];
    const wantRarity = animeManager.RARITIES[wantChar.rarity];

    // Send trade proposal
    const container = createContainer(0xF1C40F);
    addTextDisplay(container, [
        `## 🔄 Trade Proposal`,
        '',
        `**${author.username}** wants to trade with **${targetUser.username}**!`,
        '',
        `> 📤 **Offering:** ${offerRarity.emoji} ${offerChar.name} (*${offerChar.anime}*)`,
        `> 📥 **Wants:** ${wantRarity.emoji} ${wantChar.name} (*${wantChar.anime}*)`,
        '',
        `-# ${targetUser.username}, type \`accept\` or \`deny\` within 30 seconds`,
    ].join('\n'));

    await reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

    // Wait for response
    const channel = message.channel;
    const filter = m => m.author.id === targetUser.id && ['accept', 'deny', 'decline', 'reject'].includes(m.content.toLowerCase().trim());

    try {
        const collected = await channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
        const response = collected.first().content.toLowerCase().trim();

        if (response === 'accept') {
            // Execute trade
            animeManager.removeFromCollection(authorData, offerChar.id);
            animeManager.removeFromCollection(targetData, wantChar.id);
            animeManager.addToCollection(authorData, wantChar);
            animeManager.addToCollection(targetData, offerChar);

            authorData.trades++;
            targetData.trades++;
            animeManager.saveAnimeData();

            const successContainer = createContainer(0x57F287);
            addTextDisplay(successContainer, [
                `## ✅ Trade Complete!`,
                '',
                `> **${author.username}** received ${wantRarity.emoji} **${wantChar.name}**`,
                `> **${targetUser.username}** received ${offerRarity.emoji} **${offerChar.name}**`,
                '',
                `-# Both collections have been updated`,
            ].join('\n'));
            return channel.send({ components: [successContainer], flags: MessageFlags.IsComponentsV2 });
        } else {
            const denyContainer = createContainer(0xED4245);
            addTextDisplay(denyContainer, `## ❌ Trade Declined\n**${targetUser.username}** declined the trade.`);
            return channel.send({ components: [denyContainer], flags: MessageFlags.IsComponentsV2 });
        }
    } catch {
        const timeoutContainer = createContainer(0xFEE75C);
        addTextDisplay(timeoutContainer, `## ⏳ Trade Expired\nThe trade request timed out.`);
        return channel.send({ components: [timeoutContainer], flags: MessageFlags.IsComponentsV2 });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('atrade')
        .setDescription('Trade an anime character card with another user')
        .addUserOption(o => o.setName('user').setDescription('User to trade with').setRequired(true))
        .addStringOption(o => o.setName('offer').setDescription('Character you want to give').setRequired(true))
        .addStringOption(o => o.setName('want').setDescription('Character you want to receive').setRequired(true)),
    prefix: 'atrade',
    description: 'Trade anime character cards with another user',
    usage: 'atrade <@user> <your_character> <their_character>',
    aliases: ['animtrade', 'cardtrade'],
    category: 'anime',

    async executePrefix(message, args) {
        if (args.length < 3) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, [
                `## ❌ Usage Error`,
                '',
                `> \`atrade @user <your_character> <their_character>\``,
                '',
                `-# Example: \`atrade @friend Goku Naruto\``,
            ].join('\n'));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const target = message.mentions.users.first();
        if (!target) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Error\nPlease mention a user to trade with.`);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Parse offer and want (everything after the mention split by "|" or last word is want)
        const textArgs = args.filter(a => !a.match(/^<@!?\d+>$/));
        if (textArgs.length < 2) {
            const container = createContainer(0xED4245);
            addTextDisplay(container, `## ❌ Usage\n\`atrade @user <offer> | <want>\` or \`atrade @user <offer> <want>\``);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const joined = textArgs.join(' ');
        let offerName, wantName;

        if (joined.includes('|')) {
            const parts = joined.split('|').map(p => p.trim());
            offerName = parts[0];
            wantName = parts[1];
        } else {
            // Split in half
            const mid = Math.floor(textArgs.length / 2);
            offerName = textArgs.slice(0, mid).join(' ');
            wantName = textArgs.slice(mid).join(' ');
        }

        return handleTrade(message.reply.bind(message), message, message.author, target, offerName, wantName, message.guild?.id);
    },

    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const offer = interaction.options.getString('offer');
        const want = interaction.options.getString('want');
        return handleTrade(interaction.reply.bind(interaction), interaction, interaction.user, target, offer, want, interaction.guild?.id);
    },
};
