'use strict';

/**
 * Limbo — pick a target multiplier; the round rolls a random
 * multiplier from a heavy-tailed distribution. If the rolled
 * multiplier is **at least** your target, you win at exactly your
 * target multiplier. If it falls below, you lose the bet.
 *
 * Target picker
 * ─────────────
 *   The target is chosen from a select menu of preset multipliers
 *   (1.10× through 100×). The lower the target, the higher the
 *   win probability — and vice versa.
 *
 *   Target | Win prob (≈)  | Multiplier on win
 *   1.10×  | ~90%          | 1.10×    (slow grind)
 *   1.50×  | ~66%          | 1.50×
 *   2.00×  | ~50%          | 2.00×
 *   3.00×  | ~33%          | 3.00×
 *   5.00×  | ~20%          | 5.00×
 *   10.0×  | ~10%          | 10.0×
 *   25.0×  | ~4%           | 25.0×
 *   50.0×  | ~2%           | 50.0×
 *   100×   | ~1%           | 100×     (lottery)
 *
 *   Implementation samples `roll = 1 / (1 - r)` where `r ∈ [0, 0.99)`
 *   then trims to a 99% house-edge-zero RTP and applies a small house
 *   edge by rejecting the rare top-end of the distribution.
 */

const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, MessageFlags
} = require('discord.js');
const { formatCoins, formatCoinsAmount, coinIcon } = require('../../utils/currencyHelper');
const {
    createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize
} = require('../../utils/componentHelpers');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { deductBet, settle } = require('../../utils/betGameHelper');

const E = {
    title:    '<:Lightning:1521227915537285150>',
    chart:    '<:transfer:1521228019824590948>',
    success:  '<:Checkedbox:1521227734943269077>',
    fail:     '<:Cancel:1521227723916181644>',
    info:     '<:Inforect:1521228008285929532>',
    warn:     '<:Infotriangle:1521227710381428926>',
    // Coin icon is per-guild — use coinIcon(guildId) at render sites.
    skipnext: '<:Caretright:1521227704953864202>',
    star:     '<:Star:1521227981685526568>',
    fire:     '<:Fire:1521227907647668374>',
    crown:    '<:Crown:1521227739988889764>',
    gem:      '<:Sketch:1521228025365004471>',
    riskLow:  '<:Caretright:1521227704953864202>',
    riskMed:  '<:Caretright:1521227704953864202>',
    riskHigh: '<:Caretright:1521227704953864202>',
    riskMax: '<:Caretright:1521227704953864202>',
};

const TARGETS = [
    { value: '1.1',  mult: 1.10,  label: '1.10x · ~90% win', emoji: E.riskLow,  desc: 'Safest target — slow grind' },
    { value: '1.5',  mult: 1.50,  label: '1.50x · ~66% win', emoji: E.riskLow,  desc: 'Steady winner' },
    { value: '2',    mult: 2.00,  label: '2.00x · ~50% win', emoji: E.riskMed,  desc: 'Coin-flip — classic limbo' },
    { value: '3',    mult: 3.00,  label: '3.00x · ~33% win', emoji: E.riskMed,  desc: 'Triple your bet' },
    { value: '5',    mult: 5.00,  label: '5.00x · ~20% win', emoji: E.riskHigh, desc: 'Quintuple — high variance' },
    { value: '10',   mult: 10.00, label: '10.0x · ~10% win', emoji: E.riskHigh, desc: 'Big swings, big wins' },
    { value: '25',   mult: 25.00, label: '25.0x · ~4% win',  emoji: E.riskMax,  desc: 'Jackpot territory' },
    { value: '50',   mult: 50.00, label: '50.0x · ~2% win',  emoji: E.riskMax,  desc: 'Moonshot' },
    { value: '100',  mult: 100.0, label: '100x · ~1% win',   emoji: E.crown,    desc: 'Lottery — 100× payout' },
];

const activeGames = new Map();

/* ═══════════════════════════════════════════════════════════════════
   PURE LOGIC — heavy-tailed random multiplier
   ═══════════════════════════════════════════════════════════════════ */

function rollMultiplier() {
    // 99% RTP target with a 1% house-edge cap. The classic limbo math:
    //   r ∈ [0, 1), result = 0.99 / (1 - r)
    // Means a 1.0× event is impossible; 1% chance of result ≥ 99×.
    const r = Math.random();
    return 0.99 / Math.max(0.0001, 1 - r);
}

function chooseColor(targetMult) {
    if (targetMult >= 25) return 0xED4245;
    if (targetMult >= 5)  return 0xF97316;
    if (targetMult >= 2)  return 0xFEE75C;
    return 0x57F287;
}

/* ═══════════════════════════════════════════════════════════════════
   UI
   ═══════════════════════════════════════════════════════════════════ */

function buildSetupContainer(userId) {
    const game = activeGames.get(userId);
    if (!game) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `${E.fail} Setup expired. Run \`limbo <bet>\` again.`);
        return c;
    }

    const target = game.targetMult ? TARGETS.find(t => t.value === game.target) : null;
    const ready = !!target;
    const accent = target ? chooseColor(target.mult) : 0xCAD7E6;

    const lines = [
        `# ${E.title} Limbo — Setup`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
    ];
    if (target) {
        lines.push(`> ${target.emoji} **Target:** \`${target.mult}x\``);
        lines.push(`> ${coinIcon(game.guildId)} **Win pays:** ${formatCoinsAmount(Math.floor(game.bet * target.mult), game.guildId)}`);
    }

    lines.push('');
    lines.push(ready
        ? `${E.success} Ready! Press **Start Game** to roll.`
        : `${E.info} Pick a target multiplier below to enable Start.`);

    const container = createContainer(accent);
    addTextDisplay(container, lines.join('\n'));
    addSeparator(container, SeparatorSpacingSize.Small);

    const opts = TARGETS.map(t => ({
        label: t.label,
        value: t.value,
        description: t.desc,
        emoji: t.emoji,
        default: game.target === t.value,
    }));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`limbo_setup_target_${userId}`)
            .setPlaceholder(target ? `Target · ${target.mult}x` : 'Pick a target multiplier…')
            .addOptions(opts)
    ));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`limbo_setup_start_${userId}`)
            .setLabel('Start Game')
            .setEmoji(E.skipnext)
            .setStyle(ButtonStyle.Success)
            .setDisabled(!ready),
        new ButtonBuilder()
            .setCustomId(`limbo_setup_cancel_${userId}`)
            .setLabel('Cancel')
            .setEmoji(E.fail)
            .setStyle(ButtonStyle.Secondary),
    ));

    return container;
}

function buildResultContainer(game, rolled, target) {
    const won = rolled >= target.mult;
    const color = won ? 0x57F287 : 0xED4245;
    const payout = won ? Math.floor(game.bet * target.mult) : 0;

    const lines = [
        `# ${E.title} Limbo`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
        `> ${target.emoji} **Target:** \`${target.mult}x\``,
        `> ${E.chart} **Rolled:** \`${rolled.toFixed(2)}x\``,
        '',
        won
            ? `${E.success} **Won ${formatCoins(payout - game.bet, game.guildId)}!** (received ${formatNumber(payout)})`
            : `${E.fail} **Lost ${formatCoins(game.bet, game.guildId)}** — rolled below \`${target.mult}x\``,
    ];

    const container = createContainer(color);
    addTextDisplay(container, lines.join('\n'));
    return container;
}

/* ═══════════════════════════════════════════════════════════════════
   ENTRY + ROUTER
   ═══════════════════════════════════════════════════════════════════ */

async function handleLimbo(reply, userId, args, guildId) {
    if (activeGames.has(userId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, `${E.warn} You already have an active limbo session. Finish or cancel it first.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const balance = getBalance(userId);
    const betResult = parseBet(args[0], balance);

    if (!betResult.valid) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `# ${E.title} Limbo`,
            '',
            `> ${E.info} **Usage:** \`limbo <bet>\``,
            `> ${coinIcon(guildId)} **Max Bet:** ${formatNumber(MAX_BET)}`,
            '',
            `Pick a **target multiplier** — if the rolled multiplier hits or exceeds your target, you win at exactly your target.`,
            '',
            `**Targets range from \`1.10x\` (~90% win) to \`100x\` (~1% win).**`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const bet = betResult.amount;
    activeGames.set(userId, {
        phase: 'setup', bet, guildId: guildId || null, userId,
        target: null, targetMult: null, timestamp: Date.now(),
    });
    setTimeout(() => {
        const g = activeGames.get(userId);
        if (g && g.phase === 'setup') activeGames.delete(userId);
    }, 90_000);

    return reply({ components: [buildSetupContainer(userId)], flags: MessageFlags.IsComponentsV2 });
}

async function handleLimboInteraction(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('limbo_')) return false;
    const userId = interaction.user.id;

    if (customId.startsWith('limbo_setup_target_')) {
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'setup') return interaction.reply({ content: `${E.fail} Setup expired.`, flags: MessageFlags.Ephemeral });
        const picked = TARGETS.find(t => t.value === interaction.values[0]);
        if (!picked) return interaction.deferUpdate();
        game.target = picked.value;
        game.targetMult = picked.mult;
        return interaction.update({ components: [buildSetupContainer(userId)], flags: MessageFlags.IsComponentsV2 });
    }

    if (customId.startsWith('limbo_setup_cancel_')) {
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        activeGames.delete(userId);
        const c = createContainer(0x6b7280);
        addTextDisplay(c, `# ${E.fail} Setup Cancelled\n\nNo coins were charged.`);
        return interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (customId.startsWith('limbo_setup_start_')) {
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'setup') return interaction.reply({ content: `${E.fail} Setup expired.`, flags: MessageFlags.Ephemeral });
        const picked = TARGETS.find(t => t.value === game.target);
        if (!picked) return interaction.reply({ content: `${E.warn} Pick a target multiplier first.`, flags: MessageFlags.Ephemeral });
        return startGame(interaction, game, picked);
    }

    return false;
}

async function startGame(interaction, game, target) {
    deductBet(game.userId, game.bet);
    activeGames.delete(game.userId);
    game.phase = 'playing';

    const rolled = Math.min(1000, rollMultiplier());
    const won = rolled >= target.mult;
    const payout = won ? Math.floor(game.bet * target.mult) : 0;
    settle(game.userId, game.bet, payout);

    const container = buildResultContainer(game, rolled, target);
    return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('limbo')
        .setDescription('Pick a target multiplier — beat the roll to win at that multiplier')
        .addStringOption(o => o.setName('bet').setDescription('Bet amount (max 100k) or "all"').setRequired(true)),

    prefix: 'limbo',
    aliases: ['lb'],
    description: 'Pick a target multiplier (1.10× to 100×) and try to roll above it.',
    usage: 'limbo <bet>',
    category: 'economy',

    handleLimboInteraction,

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const amount = interaction.options.getString('bet');
        await handleLimbo((opts) => interaction.reply(opts), interaction.user.id, [amount], interaction.guild?.id);
    },

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        await handleLimbo((opts) => message.reply(opts), message.author.id, args, message.guild?.id);
    },
};
