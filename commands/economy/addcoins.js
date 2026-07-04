'use strict';

const { MessageFlags } = require('discord.js');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { resolveUser } = require('../../utils/resolveUser');

const OWNER_IDS = process.env.OWNER_ID ? [process.env.OWNER_ID] : [];

module.exports = {
    data: new (require('discord.js').SlashCommandBuilder)()
        .setName('addcoins')
        .setDescription('(Owner only) Add coins to a user')
        .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Amount to add').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000)),
    prefix: 'addcoins',
    aliases: ['givecoins', 'admincoins'],
    category: 'economy',

    async executePrefix(message, args) {
        const guildId = message.guild?.id;
        if (!OWNER_IDS.includes(message.author.id)) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, '<:Cancel:1521227723916181644> This command is owner-only.');
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        const target = await resolveUser(message, args);
        const amount = parseInt(args[1], 10);

        if (!target || !amount || isNaN(amount) || amount <= 0) {
            const container = createContainer(0xCAD7E6);
            addTextDisplay(container, [
                `# 🛠️ Add Coins (Owner Only)`,
                '',
                `**Usage:** \`addcoins @user <amount>\``,
                '',
                `**Example:**`,
                `\`addcoins @User 10000\``,
            ].join('\n'));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (amount > 1_000_000_000) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, '<:Cancel:1521227723916181644> Amount too large.');
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        const economy = economyManager.loadEconomy();
        const { userData: user } = economyManager.getUser(economy, target.id);

        user.coins = Number(user.coins || 0) + amount;
        economyManager.saveEconomy(economy);

        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `# ${coinIcon(guildId)} Coins Added`,
            '',
            `<:Checkedbox:1521227734943269077> **${formatCoins(amount, guildId)}** added to **${target.username}**`,
            '',
            `${coinIcon(guildId)} **New Balance:** ${formatCoinsAmount(user.coins, guildId)}`,
        ].join('\n'));

        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async execute(interaction) {
        await interaction.deferReply({ flags: 1 << 15 });
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const fakeMessage = {
            author: interaction.user,
            mentions: { users: { first: () => target } },
            reply: (opts) => interaction.editReply(opts),
        };
        return module.exports.executePrefix(fakeMessage, [null, amount]);
    },
};
