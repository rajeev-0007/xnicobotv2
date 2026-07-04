'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, getErrorContainer, MessageFlags, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const { parseBet, processBetResult, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');

const COOLDOWN = 8_000;
const cooldowns = new Map();
const activeSessions = new Map();

async function handleHighLow(reply, userId, args, message, guildId) {
    const now = Date.now();

    if (cooldowns.get(userId) > now) {
        const left = Math.ceil((cooldowns.get(userId) - now) / 1000);
        const c = createContainer(0xCAD7E6);
        addTextDisplay(c, `<:Clock:1521228110408847623> Wait **${left}s** before playing again.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const balance = getBalance(userId);
    const betResult = parseBet(args[0], balance);

    if (!betResult.valid) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `# 🔢 Higher or Lower`,
            '',
            `**Usage:** \`highlow <amount>\``,
            `**Max Bet:** ${formatNumber(MAX_BET)}`,
            '',
            `I pick a number 1-100. You guess if the next number is **higher** or **lower**.`,
            `Correct = win your bet. Wrong = lose it.`,
            '',
            `**Examples:**`,
            `\`highlow 500\``,
            `\`highlow all\``,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const bet = betResult.amount;
    cooldowns.set(userId, now + COOLDOWN);

    const firstNumber = Math.floor(Math.random() * 100) + 1;
    const secondNumber = Math.floor(Math.random() * 100) + 1;

    // Store session
    activeSessions.set(userId, { bet, firstNumber, secondNumber, timestamp: now });

    const container = createContainer(0xCAD7E6);
    addTextDisplay(container, [
        `# 🔢 Higher or Lower`,
        '',
        `## The number is: **${firstNumber}**`,
        '',
        `> Will the next number be **higher** or **lower**?`,
        `> Bet: **${formatCoins(bet, guildId)}**`,
    ].join('\n'));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`hl_higher_${userId}`).setLabel('⬆️ Higher').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`hl_lower_${userId}`).setLabel('⬇️ Lower').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`hl_jackpot_${userId}`).setLabel('🎯 Exact (10x)').setStyle(ButtonStyle.Primary)
    );

    container.addActionRowComponents(row);

    const sent = await reply({ components: [container], flags: MessageFlags.IsComponentsV2, fetchReply: true });

    // Auto-expire after 30s
    setTimeout(() => {
        if (activeSessions.has(userId)) {
            activeSessions.delete(userId);
        }
    }, 30000);
}

// Handle button interactions (called from interactionCreate)
async function handleHighLowButton(interaction, guildId) {
    const customId = interaction.customId;
    if (!customId.startsWith('hl_')) return false;

    const parts = customId.split('_');
    const choice = parts[1]; // higher, lower, jackpot
    const targetUserId = parts[2];

    if (interaction.user.id !== targetUserId) {
        return interaction.reply({ components: [getErrorContainer('This is not your game!')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    const session = activeSessions.get(targetUserId);
    if (!session) {
        return interaction.reply({ components: [getErrorContainer('This game has expired.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    activeSessions.delete(targetUserId);

    const { bet, firstNumber, secondNumber } = session;
    let won = false;
    let multiplier = 1;

    if (choice === 'jackpot') {
        won = secondNumber === firstNumber;
        multiplier = 10;
    } else if (choice === 'higher') {
        won = secondNumber > firstNumber;
    } else {
        won = secondNumber < firstNumber;
    }

    // Tie (same number, not jackpot) = push
    if (choice !== 'jackpot' && secondNumber === firstNumber) {
        const economyManager = require('../../utils/economyManager');
        const economy = economyManager.loadEconomy();
        const { userData } = economyManager.getUser(economy, targetUserId);

        const container = createContainer(0xFEE75C);
        addTextDisplay(container, [
            `# 🔢 Higher or Lower`,
            '',
            `## ${firstNumber} → **${secondNumber}**`,
            '',
            `🤝 **Same number! Push — no coins lost.**`,
            `${coinIcon(guildId)} **Balance:** ${formatCoinsAmount(userData.coins, guildId)}`,
        ].join('\n'));

        return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const { userData } = processBetResult(targetUserId, bet, won, multiplier);
    const winAmount = Math.floor(bet * multiplier);

    const container = createContainer(won ? 0x57F287 : 0xED4245);
    addTextDisplay(container, [
        `# 🔢 Higher or Lower`,
        '',
        `## ${firstNumber} → **${secondNumber}**`,
        `> You chose: **${choice === 'jackpot' ? '🎯 Exact' : choice === 'higher' ? '⬆️ Higher' : '⬇️ Lower'}**`,
        '',
        won
            ? `<:Checkedbox:1521227734943269077> **Won ${formatCoins(winAmount, guildId)}!** ${multiplier > 1 ? `(${multiplier}x)` : ''}`
            : `<:Cancel:1521227723916181644> **Lost ${formatCoins(bet, guildId)}**`,
        '',
        `${coinIcon(guildId)} **Balance:** ${formatCoinsAmount(userData.coins, guildId)}`,
    ].join('\n'));

    return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new (require('discord.js').SlashCommandBuilder)()
        .setName('highlow')
        .setDescription('Guess if the next number is higher or lower (max 100k)')
        .addStringOption(o => o.setName('amount').setDescription('Bet amount or "all"').setRequired(true)),

    prefix: 'highlow',
    description: 'Higher or Lower — guess the next number (max 100k)',
    usage: 'highlow <amount>',
    category: 'economy',
    aliases: ['hl', 'hilo'],

    handleHighLowButton,
    // Aliased as `handleButton` for the index.js generic dispatcher.
    // The legacy `handleHighLowButton` name is kept for back-compat
    // with anything that imported it directly.
    handleButton: handleHighLowButton,

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const amount = interaction.options.getString('amount');
        await handleHighLow((opts) => interaction.reply(opts), interaction.user.id, [amount], interaction.guild?.id);
    },

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        await handleHighLow((opts) => message.reply(opts), message.author.id, args, message, message.guild?.id);
    }
};
