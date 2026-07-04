'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const {
    createContainer,
    addTextDisplay,
    formatNumber,
    MessageFlags
} = require('../../utils/componentHelpers');

const economyManager = require('../../utils/economyManager');
const { resolveUser } = require('../../utils/resolveUser');

/* =======================================================
   REPLY ADAPTER
   Safely handles Message & Interaction contexts
======================================================= */

function createReply(ctx) {
    // Slash command interaction
    if ('commandName' in ctx) {
        return (payload) => ctx.reply(payload);
    }

    // Prefix message
    if ('channel' in ctx) {
        return (payload) => ctx.reply(payload);
    }

    throw new Error('Invalid command context provided to pay command');
}

/* =======================================================
   ABUSE GUARDS
   Re-entry locks prevent two parallel `pay` invocations
   from the same sender (slash + prefix or rapid double-fire)
   from both crediting the receiver. The Map is keyed by
   sender userId and cleared in a finally block.
   Per-sender cooldown limits transfer spam.
======================================================= */
const inFlight = new Set();
const cooldowns = new Map();
const PAY_COOLDOWN_MS = 5_000;
const MIN_PAY = 10;
const MAX_PAY = 1_000_000;

/* =======================================================
   CORE BUSINESS LOGIC
======================================================= */

async function handlePay(ctx, senderId, target, amount, guildId) {
    const reply = createReply(ctx);

    /* ---------- RE-ENTRY GUARD ---------- */
    // Without this, two parallel pay invocations from the same
    // sender (slash + prefix double-fire, or a panic-spam) both
    // pass the balance check on the live economy cache and both
    // credit the receiver — duplicating the transfer.
    if (inFlight.has(senderId)) {
        const c = createContainer();
        addTextDisplay(c, `# <:Infotriangle:1521227710381428926> Transfer In Progress\n\nWait a moment for your previous payment to complete.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    /* ---------- COOLDOWN ---------- */
    const now = Date.now();
    const ready = cooldowns.get(senderId) || 0;
    if (now < ready) {
        const left = Math.ceil((ready - now) / 1000);
        const c = createContainer();
        addTextDisplay(c, `# <:Clock:1521228110408847623> On Cooldown\n\nWait **${left}s** before paying another user.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    /* ---------- VALIDATION ---------- */

    if (!target) {
        const container = createContainer();
        addTextDisplay(
            container,
            `# <:Cancel:1521227723916181644> Invalid Usage\n\nUsage: \`pay @user <amount>\``
        );
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (target.id === senderId) {
        const container = createContainer();
        addTextDisplay(
            container,
            `# <:Cancel:1521227723916181644> Invalid Transaction\n\nYou cannot pay yourself.`
        );
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (target.bot) {
        const container = createContainer();
        addTextDisplay(
            container,
            `# <:Cancel:1521227723916181644> Invalid Transaction\n\nYou cannot pay bots.`
        );
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (!Number.isInteger(amount) || amount <= 0) {
        const container = createContainer();
        addTextDisplay(
            container,
            `# <:Cancel:1521227723916181644> Invalid Amount\n\nAmount must be a number greater than **0**.`
        );
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (amount < MIN_PAY) {
        const container = createContainer();
        addTextDisplay(
            container,
            `# <:Cancel:1521227723916181644> Amount Too Low\n\nMinimum transfer is **${formatCoins(MIN_PAY, guildId)}**.`
        );
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (amount > MAX_PAY) {
        const container = createContainer();
        addTextDisplay(
            container,
            `# <:Cancel:1521227723916181644> Amount Too High\n\nMaximum transfer is **${formatCoins(MAX_PAY, guildId)}** per payment.`
        );
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    inFlight.add(senderId);
    try {
        /* ---------- ECONOMY ---------- */

        const economy = economyManager.loadEconomy();

        const { userData: sender } =
            economyManager.getUser(economy, senderId);

        const { userData: receiver } =
            economyManager.getUser(economy, target.id);

        if (sender.coins < amount) {
            const container = createContainer();
            addTextDisplay(
                container,
                `# <:Cancel:1521227723916181644> Insufficient Funds\n\n${coinIcon(guildId)} **Your Balance:** ${formatCoinsAmount(sender.coins, guildId)}`
            );
            return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        /* ---------- TRANSFER ---------- */

        sender.coins -= amount;
        receiver.coins += amount;

        cooldowns.set(senderId, Date.now() + PAY_COOLDOWN_MS);
        economyManager.saveEconomy(economy);

        /* ---------- SUCCESS ---------- */

        const container = createContainer();
        addTextDisplay(
            container,
            `# ${coinIcon(guildId)} Payment Successful\n\n` +
            `You paid **${target.username}** ${formatCoins(amount, guildId)}\n\n` +
            `${coinIcon(guildId)} **Your New Balance:** ${formatCoinsAmount(sender.coins, guildId)}`
        );

        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } finally {
        inFlight.delete(senderId);
    }
}

/* =======================================================
   COMMAND EXPORT
======================================================= */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pay')
        .setDescription('Pay another user coins')
        .addUserOption(o => o.setName('user').setDescription('User to pay').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Amount to pay').setRequired(true).setMinValue(1)),
    name: 'pay',
    prefix: 'pay',
    aliases: ['transfer'],
    category: 'economy',

    /* ---------- SLASH ---------- */
    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');

        return handlePay(
            interaction,
            interaction.user.id,
            target,
            amount, interaction.guild?.id);
    },

    /* ---------- PREFIX ---------- */
    async executePrefix(message, args) {
        const target = await resolveUser(message, args);
        const amount = parseInt(args[1], 10);

        return handlePay(
            message,
            message.author.id,
            target,
            amount, message.guild?.id);
    }
};