'use strict';

const { MessageFlags } = require('discord.js');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');

async function handleWithdraw(reply, userId, args, guildId) {
    const economy = economyManager.loadEconomy();
    const { userData: user } = economyManager.getUser(economy, userId);

    const input = args[0]?.toLowerCase();
    const amount = input === 'all' ? user.bank : parseInt(input, 10);

    if (amount === undefined || amount === null || isNaN(amount) || amount <= 0) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `# <:Invoice:1521227903956811836> Withdraw`,
            '',
            `**Usage:** \`withdraw <amount | all>\``,
            '',
            `**Your Balances:**`,
            `${coinIcon(guildId)} Wallet: ${formatCoinsAmount(user.coins, guildId)}`,
            `<:Invoice:1521227903956811836> Bank: ${formatCoins(user.bank, guildId)}`,
            '',
            `**Examples:**`,
            `\`withdraw 500\``,
            `\`withdraw all\``,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (amount > user.bank) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, '<:Cancel:1521227723916181644> You don\'t have that many coins in your bank!');
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    user.bank -= amount;
    user.coins += amount;
    economyManager.saveEconomy(economy);

    const container = createContainer(0xCAD7E6);
    addTextDisplay(container, [
        `# <:Invoice:1521227903956811836> Withdrawal Successful`,
        '',
        `<:Checkedbox:1521227734943269077> Withdrew **${formatCoins(amount, guildId)}** from your bank.`,
    ].join('\n'));

    addSeparator(container, SeparatorSpacingSize.Small);

    addTextDisplay(container, [
        `**New Balances:**`,
        `${coinIcon(guildId)} Wallet: ${formatCoinsAmount(user.coins, guildId)}`,
        `<:Invoice:1521227903956811836> Bank: ${formatCoins(user.bank, guildId)}`,
        `<:Invoice:1521227903956811836> **Total:** ${formatCoins(user.coins + user.bank, guildId)}`,
    ].join('\n'));

    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new (require('discord.js').SlashCommandBuilder)()
        .setName('withdraw')
        .setDescription('Withdraw coins from your bank to your wallet')
        .addStringOption(o => o.setName('amount').setDescription('Amount to withdraw or "all"').setRequired(true)),
    prefix: 'withdraw',
    description: 'Withdraw coins from your bank to your wallet',
    usage: 'withdraw <amount|all>',
    aliases: ['with', 'take'],
    category: 'economy',

    async executePrefix(message, args) {
        return handleWithdraw(message.reply.bind(message), message.author.id, args, message.guild?.id);
    },

    async execute(interaction) {
        const amountStr = interaction.options?.getString('amount') || interaction.options?.getInteger('amount');
        return handleWithdraw(interaction.reply.bind(interaction), interaction.user.id, amountStr ? [String(amountStr)] : [], interaction.guild?.id);
    }
};
