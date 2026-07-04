'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { resolveUser } = require('../../utils/resolveUser');

async function handleBalance(reply, targetUser, guildId) {
    const economy = economyManager.loadEconomy();
    const { userData, changed } = economyManager.getUser(economy, targetUser.id);
    if (changed) economyManager.saveEconomy(economy);

    const wallet = Number(userData.coins) || 0;
    const bank = Number(userData.bank) || 0;
    const total = wallet + bank;

    const container = createContainer(0xCAD7E6);
    addTextDisplay(container, [
        `# ${coinIcon(guildId)} Balance`,
        '',
        `### <:User:1521227714227343380> ${targetUser.username}`,
        '',
        `> ${coinIcon(guildId)} **Wallet:** ${formatCoinsAmount(wallet, guildId)}`,
        `> <:Bank:1521228286813012169> **Bank:** ${formatCoins(bank, guildId)}`,
    ].join('\n'));

    addSeparator(container, SeparatorSpacingSize.Small);

    addTextDisplay(container, [
        `> <:Sketch:1521228025365004471> **Total Worth:** ${formatCoinsAmount(total, guildId)}`,
        '',
        `-# Use \`deposit\` and \`withdraw\` to manage your bank`,
    ].join('\n'));

    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('balance')
        .setDescription('Check your or another user\'s coin balance')
        .addUserOption(o => o.setName('user').setDescription('User to check (defaults to you)').setRequired(false)),
    prefix: 'balance',
    description: 'Check your or another user\'s coin balance',
    usage: 'balance [@user]',
    aliases: ['bal', 'coins', 'money'],
    category: 'economy',

    async executePrefix(message, args) {
        const target = (await resolveUser(message, args)) || message.author;
        return handleBalance(message.reply.bind(message), target, message.guild?.id);
    },

    async execute(interaction) {
        const target = interaction.options?.getUser('user') || interaction.user;
        return handleBalance(interaction.reply.bind(interaction), target, interaction.guild?.id);
    }
};
