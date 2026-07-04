'use strict';

/**
 * scratch — Buy 1–5 scratch tickets at a fixed cost and try to
 * line up matching symbols across rows, columns, or diagonals.
 *
 * Each ticket is a 3×3 grid drawn from a weighted symbol pool.
 * Payout is the sum of every match across the eight win-lines.
 * House edge sits in the 8-symbol pool (so a random 3-tile line
 * lands a payout less than ~5% of the time, comfortably below
 * the average ticket price expressed as multiples of 500).
 *
 * Concurrency
 * ───────────
 * A short per-user lock prevents a user from spamming the slash
 * command while a previous batch is still being persisted — the
 * old version raced against the persist debounce and could
 * occasionally double-charge.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { formatCoins, formatCoinsAmount, coinIcon } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { EMOJIS } = require('../../utils/economyEmojis');
const { gamblingGuard } = require('../../utils/economyGuards');

/* ───────────── Game constants ───────────── */

const TICKET_COST  = 500;
const MIN_TICKETS  = 1;
const MAX_TICKETS  = 5;
const COOLDOWN     = 10_000;
const cooldowns    = new Map();
const inFlight     = new Set();   // per-user re-entry guard

const SYMBOLS = ['🍒', '<:Sketch:1521228025365004471>', '🌟', '🎰', '🍋', '🍇', '🔔', '<:Money:1521228266957045900>'];

/* Triple-match payouts. Symbol order in `SYMBOLS` is intentional —
 * rarer payouts come from rarer-feeling glyphs (gem / money / star). */
const PAYOUTS = {
    '<:Sketch:1521228025365004471><:Sketch:1521228025365004471><:Sketch:1521228025365004471>': 5000,
    '<:Money:1521228266957045900><:Money:1521228266957045900><:Money:1521228266957045900>': 2000,
    '🎰🎰🎰': 1500,
    '🔔🔔🔔': 1000,
    '🌟🌟🌟': 750,
    '🍇🍇🍇': 500,
    '🍒🍒🍒': 300,
    '🍋🍋🍋': 200,
};

function scratchCard() {
    const card = [];
    for (let row = 0; row < 3; row++) {
        const r = [];
        for (let col = 0; col < 3; col++) {
            r.push(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
        }
        card.push(r);
    }
    return card;
}

/**
 * Score a single 3×3 card. Returns the sum of every winning
 * 3-in-a-row plus a `wins` array of human-readable lines (used by
 * the result panel).
 */
function calcPrize(card) {
    let prize = 0;
    const wins = [];

    // Rows
    for (const row of card) {
        const key = row.join('');
        if (PAYOUTS[key]) {
            prize += PAYOUTS[key];
            wins.push(`Row · ${row.join(' ')} → +${formatNumber(PAYOUTS[key])}`);
        }
    }
    // Columns
    for (let col = 0; col < 3; col++) {
        const colSymbols = card.map(r => r[col]);
        const key = colSymbols.join('');
        if (PAYOUTS[key]) {
            prize += PAYOUTS[key];
            wins.push(`Col · ${colSymbols.join(' ')} → +${formatNumber(PAYOUTS[key])}`);
        }
    }
    // Diagonals
    const diag1 = [card[0][0], card[1][1], card[2][2]];
    const diag2 = [card[0][2], card[1][1], card[2][0]];
    if (PAYOUTS[diag1.join('')]) {
        prize += PAYOUTS[diag1.join('')];
        wins.push(`Diag · ${diag1.join(' ')} → +${formatNumber(PAYOUTS[diag1.join('')])}`);
    }
    if (PAYOUTS[diag2.join('')]) {
        prize += PAYOUTS[diag2.join('')];
        wins.push(`Diag · ${diag2.join(' ')} → +${formatNumber(PAYOUTS[diag2.join('')])}`);
    }

    return { prize, wins };
}

/* ───────────── Command flow ───────────── */

async function handleScratch(reply, userId, count, guildId) {
    const now = Date.now();

    // Re-entry guard — prevents spam clicks from racing the persist debounce.
    if (inFlight.has(userId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, `${EMOJIS.warn || '<:Infotriangle:1521227710381428926>'} A previous scratch is still resolving — try again in a second.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const lastUsed  = cooldowns.get(userId) || 0;
    const remaining = COOLDOWN - (now - lastUsed);
    if (remaining > 0) {
        const secs = Math.ceil(remaining / 1000);
        const c = createContainer(0xED4245);
        addTextDisplay(c, `# ${EMOJIS.sandwatch} Cooldown\n\n${EMOJIS.alarm} Wait **${secs}s** before scratching again.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const qty = Math.max(MIN_TICKETS, Math.min(count || 1, MAX_TICKETS));
    const totalCost = TICKET_COST * qty;

    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);

    if ((userData.coins || 0) < totalCost) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, [
            `${EMOJIS.cancel} You need **${formatCoins(totalCost, guildId)}** to buy ${qty} ticket${qty === 1 ? '' : 's'}.`,
            `> Wallet: **${formatNumber(userData.coins || 0)}**`,
        ].join('\n'));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    inFlight.add(userId);
    cooldowns.set(userId, now);

    try {
        userData.coins -= totalCost;
        userData.totalGambled = (userData.totalGambled || 0) + totalCost;

        let totalPrize = 0;
        let bestSingle = 0;
        const ticketLines = [];

        for (let i = 0; i < qty; i++) {
            const card = scratchCard();
            const { prize, wins } = calcPrize(card);
            totalPrize += prize;
            if (prize > bestSingle) bestSingle = prize;

            const cardStr = card.map(row => row.join('  ')).join('\n');
            const result = wins.length > 0
                ? wins.map(w => `  <:Checkedbox:1521227734943269077> ${w}`).join('\n')
                : `  <:Cancel:1521227723916181644> No matching line`;
            ticketLines.push(`**Ticket #${i + 1}** · ${prize > 0 ? `+${formatNumber(prize)}` : 'no win'}\n${cardStr}\n${result}`);
        }

        userData.coins += totalPrize;
        if (totalPrize > 0) {
            userData.totalEarned = (userData.totalEarned || 0) + totalPrize;
            userData.totalWon    = (userData.totalWon    || 0) + Math.max(0, totalPrize - totalCost);
        } else {
            userData.totalLost = (userData.totalLost || 0) + totalCost;
        }

        // XP scales with the *best* single ticket so a lucky 5×3000 still
        // feels meaningful even if the other 4 tickets were duds.
        const xpGain = bestSingle >= 5000 ? 25
                     : bestSingle >= 2000 ? 15
                     : bestSingle >= 1000 ? 10
                     : bestSingle >  0    ?  5
                     :                       2;
        economyManager.addXP(economy, userId, xpGain);
        economyManager.checkAllAchievements(economy, userId);
        economyManager.saveEconomy(economy);

        const net    = totalPrize - totalCost;
        const won    = net > 0;
        const broke  = net === 0;
        const netStr = net > 0 ? `+${formatNumber(net)}` : net < 0 ? `−${formatNumber(Math.abs(net))}` : '0';
        const accent = won ? 0x57F287 : broke ? 0xFEE75C : 0xED4245;
        const headline = won
            ? `# 🎟️ Scratch · You Win!`
            : broke
                ? `# 🎟️ Scratch · Break-Even`
                : `# 🎟️ Scratch · No Luck`;

        const c = createContainer(accent);
        addTextDisplay(c, headline);
        addSeparator(c, SeparatorSpacingSize.Small);
        addTextDisplay(c, ticketLines.join('\n\n'));
        addSeparator(c, SeparatorSpacingSize.Small);
        addTextDisplay(c, [
            `${coinIcon(guildId)} **Cost:** −${formatCoins(totalCost, guildId)}`,
            `${EMOJIS.sketch || '<:Sketch:1521228025365004471>'} **Prize:** +${formatCoinsAmount(totalPrize, guildId)}`,
            `<:transfer:1521228019824590948> **Net:** **${netStr}** coins`,
            `${coinIcon(guildId)} **Wallet:** ${formatCoinsAmount(userData.coins, guildId)}`,
            won ? `-# Best ticket: +${formatNumber(bestSingle)} · +${xpGain} XP` : `-# +${xpGain} XP for trying`,
        ].join('\n'));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    } finally {
        inFlight.delete(userId);
    }
}

/* ───────────── Module export ───────────── */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('scratch')
        .setDescription(`Buy scratch cards (${TICKET_COST} coins each) and try your luck`)
        .addIntegerOption(o => o
            .setName('tickets')
            .setDescription(`Number of tickets to scratch (${MIN_TICKETS}–${MAX_TICKETS})`)
            .setRequired(false)
            .setMinValue(MIN_TICKETS)
            .setMaxValue(MAX_TICKETS)),
    prefix: 'scratch',
    aliases: ['scratchcard'],
    category: 'economy',
    description: 'Buy scratch cards and try your luck',
    usage: 'scratch [1-5]',

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        const qty = parseInt(args[0], 10) || 1;
        return handleScratch(message.reply.bind(message), message.author.id, qty, message.guild?.id);
    },

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        await interaction.deferReply().catch(() => {});
        const qty = interaction.options.getInteger('tickets') || 1;
        return handleScratch(interaction.editReply.bind(interaction), interaction.user.id, qty, interaction.guild?.id);
    },
};
