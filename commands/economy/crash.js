'use strict';

/**
 * Crash — bet on a multiplier ticking up, cash out before it crashes.
 *
 * Flow
 * ────
 *   1. `crash <bet>` opens a SETUP panel with risk presets and an
 *      auto-cashout selector.
 *   2. Pressing **Start Game** deducts the bet and starts the round.
 *      The multiplier panel shows the current multiplier (\`1.00x →
 *      X.XXx\`); the player presses **Cash Out** at any point to lock
 *      in their winnings.
 *   3. If the player doesn't cash out before the round crashes, they
 *      lose their bet entirely. If they pre-set Auto-Cashout, the
 *      round will resolve at that multiplier automatically (or crash
 *      first, whichever comes first).
 *
 * Math
 * ────
 *   Crash points come from a provably-fair-style geometric distribution
 *   tuned per risk preset (lower-risk presets crash later on average,
 *   capping at ~10×; high-risk crash sooner but can pay 50× jackpots).
 *
 *   The "tick" loop runs server-side and edits the message every ~1s,
 *   so the player feels the multiplier rising. The actual settlement
 *   only happens once on cash-out or crash — there's no race window
 *   where the player can spam-claim.
 */

const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, MessageFlags
} = require('discord.js');
const { formatCoins, formatCoinsShort, coinIcon, coinEmoji, formatCoinsAmount } = require('../../utils/currencyHelper');
const {
    createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize
} = require('../../utils/componentHelpers');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { deductBet, settle } = require('../../utils/betGameHelper');

/* ═══════════════════════════════════════════════════════════════════
   CUSTOM EMOJI SET
   ═══════════════════════════════════════════════════════════════════ */
const E = {
    title:    '<:Lightning:1521227915537285150>',
    rocket:   '<:Fire:1521227907647668374>',
    boom:     '<:Cancel:1521227723916181644>',
    success:  '<:Checkedbox:1521227734943269077>',
    info:     '<:Inforect:1521228008285929532>',
    warn:     '<:Infotriangle:1521227710381428926>',
    // Coin icon is per-guild — use coinIcon(guildId) at render sites.
    chart:    '<:transfer:1521228019824590948>',
    star:     '<:Star:1521227981685526568>',
    skipnext: '<:Caretright:1521227704953864202>',
    sandwatch:'<:Sandwatch:1521228272426418367>',
    riskSafe: '<:Caretright:1521227704953864202>',
    riskLow:  '<:Caretright:1521227704953864202>',
    riskMed:  '<:Caretright:1521227704953864202>',
    riskHigh: '<:Caretright:1521227704953864202>',
    riskMax: '<:Caretright:1521227704953864202>',
    auto:     '<:Settings:1521227767780343879>',
};

/* ═══════════════════════════════════════════════════════════════════
   RISK / CASH-OUT PRESETS
   ═══════════════════════════════════════════════════════════════════
 *  `crashRate` is the per-tick chance of crashing.
 *  `cap` is the maximum multiplier (the round auto-resolves there).
 */
const RISKS = {
    safe: {
        label: 'Safe',
        emoji: E.riskSafe,
        crashRate: 0.04,   // ~4% chance to crash each tick
        cap: 5,
        color: 0x10B981,
        desc: 'Frequent crashes but rarely above 5×',
    },
    low: {
        label: 'Low',
        emoji: E.riskLow,
        crashRate: 0.06,
        cap: 10,
        color: 0x57F287,
        desc: 'Balanced — most rounds pay 1.5–4×',
    },
    medium: {
        label: 'Medium',
        emoji: E.riskMed,
        crashRate: 0.09,
        cap: 20,
        color: 0xFEE75C,
        desc: 'Higher variance, up to 20× payouts',
    },
    high: {
        label: 'High',
        emoji: E.riskHigh,
        crashRate: 0.13,
        cap: 35,
        color: 0xF97316,
        desc: 'Crashes early — but can hit 35× jackpots',
    },
    extreme: {
        label: 'Extreme',
        emoji: E.riskMax,
        crashRate: 0.18,
        cap: 50,
        color: 0xED4245,
        desc: 'All-or-nothing — 50× moonshots possible',
    },
};

/** Predefined auto-cashout multipliers (player can also play manual). */
const AUTOCASH_OPTIONS = [
    { value: 'manual', label: 'Manual (no auto-cashout)', mult: null,  emoji: E.auto    },
    { value: '1.5',    label: 'Auto · 1.5x',              mult: 1.5,   emoji: E.chart   },
    { value: '2',      label: 'Auto · 2x',                mult: 2,     emoji: E.chart   },
    { value: '3',      label: 'Auto · 3x',                mult: 3,     emoji: E.rocket  },
    { value: '5',      label: 'Auto · 5x',                mult: 5,     emoji: E.rocket  },
    { value: '10',     label: 'Auto · 10x',               mult: 10,    emoji: E.star    },
    { value: '25',     label: 'Auto · 25x (jackpot)',     mult: 25,    emoji: E.star    },
];

/** Active games keyed by userId (one round per player). */
const activeGames = new Map();

/* ═══════════════════════════════════════════════════════════════════
   PURE GAME LOGIC
   ═══════════════════════════════════════════════════════════════════ */

/** Pick a crash multiplier following the risk's distribution. */
function rollCrashPoint(risk) {
    const r = RISKS[risk];
    let mult = 1.00;
    // Tick the multiplier up until either we crash or hit the cap.
    while (mult < r.cap) {
        if (Math.random() < r.crashRate) return Math.round(mult * 100) / 100;
        // Per-tick growth — slows down as it climbs, like a real crash chart.
        mult += Math.max(0.05, mult * 0.07);
    }
    return r.cap;
}

/* ═══════════════════════════════════════════════════════════════════
   UI BUILDERS
   ═══════════════════════════════════════════════════════════════════ */

function buildSetupContainer(userId) {
    const game = activeGames.get(userId);
    if (!game) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `${E.boom} Setup expired. Run \`crash <bet>\` again.`);
        return c;
    }

    const accent = game.risk ? RISKS[game.risk].color : 0xCAD7E6;
    const ready = !!game.risk;

    const lines = [
        `# ${E.title} Crash — Setup`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
    ];
    if (game.risk) {
        const r = RISKS[game.risk];
        lines.push(`> ${r.emoji} **Risk:** ${r.label} · cap ${r.cap}×`);
    }
    if (game.autoCashout && game.autoCashout !== 'manual') {
        lines.push(`> ${E.auto} **Auto-cashout at** \`${game.autoCashout}x\``);
    }

    lines.push('');
    lines.push(ready
        ? `${E.success} Ready! Press **Start Game** to launch the round.`
        : `${E.info} Pick a **risk preset** below to enable Start.`);

    const container = createContainer(accent);
    addTextDisplay(container, lines.join('\n'));
    addSeparator(container, SeparatorSpacingSize.Small);

    /* ── Risk select ─────────────────────────────────────────────── */
    const riskOpts = Object.entries(RISKS).map(([key, r]) => ({
        label: `${r.label} Risk`,
        value: key,
        description: `${r.desc} · cap ${r.cap}×`,
        emoji: r.emoji,
        default: game.risk === key,
    }));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`crash_setup_risk_${userId}`)
            .setPlaceholder(game.risk ? `Risk · ${RISKS[game.risk].label}` : 'Select risk preset…')
            .addOptions(riskOpts)
    ));

    /* ── Auto-cashout select ─────────────────────────────────────── */
    const autoOpts = AUTOCASH_OPTIONS.map(o => ({
        label: o.label,
        value: o.value,
        emoji: o.emoji,
        default: (game.autoCashout || 'manual') === o.value,
    }));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`crash_setup_auto_${userId}`)
            .setPlaceholder('Auto-cashout (optional)')
            .addOptions(autoOpts)
    ));

    /* ── Start / Cancel ──────────────────────────────────────────── */
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`crash_setup_start_${userId}`)
            .setLabel('Start Game')
            .setEmoji(E.skipnext)
            .setStyle(ButtonStyle.Success)
            .setDisabled(!ready),
        new ButtonBuilder()
            .setCustomId(`crash_setup_cancel_${userId}`)
            .setLabel('Cancel')
            .setEmoji(E.boom)
            .setStyle(ButtonStyle.Secondary),
    ));

    return container;
}

function buildLiveContainer(game, status = 'rising') {
    const r = RISKS[game.risk];
    const profit = Math.floor(game.bet * game.currentMult) - game.bet;

    let header, color;
    if (status === 'rising') {
        header = `${E.rocket} **\`${game.currentMult.toFixed(2)}x\`** — climbing!`;
        color = r.color;
    } else if (status === 'won') {
        header = `${E.success} **Cashed out at \`${game.currentMult.toFixed(2)}x\`** — +${formatCoins(Math.max(0, profit), game.guildId)} profit!`;
        color = 0x57F287;
    } else if (status === 'crashed') {
        header = `${E.boom} **CRASHED at \`${game.crashAt.toFixed(2)}x\`** — lost ${formatCoins(game.bet, game.guildId)}`;
        color = 0xED4245;
    } else if (status === 'auto-won') {
        header = `${E.success} **Auto-cashed at \`${game.currentMult.toFixed(2)}x\`** — +${formatCoins(Math.max(0, profit), game.guildId)} profit!`;
        color = 0x57F287;
    }

    const container = createContainer(color);
    addTextDisplay(container, [
        `# ${E.title} Crash`,
        `-# ${r.emoji} ${r.label} risk  ·  cap ${r.cap}×`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
        game.autoMult ? `> ${E.auto} **Auto-cashout:** \`${game.autoMult}x\`` : null,
        '',
        header,
    ].filter(Boolean).join('\n'));

    if (status === 'rising') {
        addSeparator(container, SeparatorSpacingSize.Small);
        const cashoutBtn = new ButtonBuilder()
            .setCustomId(`crash_cashout_${game.userId}`)
            .setLabel(`Cash Out · ${formatNumber(Math.floor(game.bet * game.currentMult))}`)
            .setStyle(ButtonStyle.Success);
        const safeIcon = coinEmoji(game.guildId);
        if (safeIcon) cashoutBtn.setEmoji(safeIcon);
        container.addActionRowComponents(new ActionRowBuilder().addComponents(cashoutBtn));
    }

    return container;
}

/* ═══════════════════════════════════════════════════════════════════
   COMMAND ENTRY
   ═══════════════════════════════════════════════════════════════════ */

async function handleCrash(reply, userId, args, guildId) {
    if (activeGames.has(userId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, `${E.warn} You already have an active crash session. Finish or cancel it first.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const balance = getBalance(userId);
    const betResult = parseBet(args[0], balance);

    if (!betResult.valid) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `# ${E.title} Crash`,
            '',
            `> ${E.info} **Usage:** \`crash <bet>\``,
            `> ${coinIcon(guildId)} **Max Bet:** ${formatNumber(MAX_BET)}`,
            '',
            `Watch the multiplier rise. Cash out before it crashes — but wait too long and you lose the lot.`,
            '',
            `**Risks:** ${E.riskSafe} Safe · ${E.riskLow} Low · ${E.riskMed} Medium · ${E.riskHigh} High · ${E.riskMax} Extreme`,
            '',
            `Higher risk = earlier crashes, but jackpot multipliers up to **50×**.`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const bet = betResult.amount;

    activeGames.set(userId, {
        phase: 'setup',
        bet,
        guildId: guildId || null,
        userId,
        risk: null,
        autoCashout: 'manual',
        timestamp: Date.now(),
    });

    setTimeout(() => {
        const g = activeGames.get(userId);
        if (g && g.phase === 'setup') activeGames.delete(userId);
    }, 90_000);

    return reply({
        components: [buildSetupContainer(userId)],
        flags: MessageFlags.IsComponentsV2,
    });
}

/* ═══════════════════════════════════════════════════════════════════
   INTERACTION ROUTER
   ═══════════════════════════════════════════════════════════════════ */

async function handleCrashInteraction(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('crash_')) return false;

    const userId = interaction.user.id;

    /* ── Setup: pick risk ─────────────────────────────────────────── */
    if (customId.startsWith('crash_setup_risk_')) {
        const target = customId.split('_')[3];
        if (userId !== target) {
            return interaction.reply({ content: `${E.boom} Not your game!`, flags: MessageFlags.Ephemeral });
        }
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'setup') {
            return interaction.reply({ content: `${E.boom} Setup expired.`, flags: MessageFlags.Ephemeral });
        }
        game.risk = interaction.values[0];
        return interaction.update({ components: [buildSetupContainer(userId)], flags: MessageFlags.IsComponentsV2 });
    }

    /* ── Setup: pick auto-cashout ─────────────────────────────────── */
    if (customId.startsWith('crash_setup_auto_')) {
        const target = customId.split('_')[3];
        if (userId !== target) {
            return interaction.reply({ content: `${E.boom} Not your game!`, flags: MessageFlags.Ephemeral });
        }
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'setup') {
            return interaction.reply({ content: `${E.boom} Setup expired.`, flags: MessageFlags.Ephemeral });
        }
        game.autoCashout = interaction.values[0];
        return interaction.update({ components: [buildSetupContainer(userId)], flags: MessageFlags.IsComponentsV2 });
    }

    /* ── Setup: cancel ────────────────────────────────────────────── */
    if (customId.startsWith('crash_setup_cancel_')) {
        const target = customId.split('_')[3];
        if (userId !== target) {
            return interaction.reply({ content: `${E.boom} Not your game!`, flags: MessageFlags.Ephemeral });
        }
        activeGames.delete(userId);
        const c = createContainer(0x6b7280);
        addTextDisplay(c, `# ${E.boom} Setup Cancelled\n\nNo coins were charged.`);
        return interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    /* ── Setup: start ─────────────────────────────────────────────── */
    if (customId.startsWith('crash_setup_start_')) {
        const target = customId.split('_')[3];
        if (userId !== target) {
            return interaction.reply({ content: `${E.boom} Not your game!`, flags: MessageFlags.Ephemeral });
        }
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'setup') {
            return interaction.reply({ content: `${E.boom} Setup expired.`, flags: MessageFlags.Ephemeral });
        }
        if (!game.risk) {
            return interaction.reply({ content: `${E.warn} Pick a risk preset first.`, flags: MessageFlags.Ephemeral });
        }
        return startGame(interaction, game);
    }

    /* ── Live: cashout ────────────────────────────────────────────── */
    if (customId.startsWith('crash_cashout_')) {
        const target = customId.split('_')[2];
        if (userId !== target) {
            return interaction.reply({ content: `${E.boom} Not your game!`, flags: MessageFlags.Ephemeral });
        }
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'playing' || game._settled) {
            return interaction.deferUpdate().catch(() => {});
        }
        return manualCashout(interaction, game);
    }

    return false;
}

/* ═══════════════════════════════════════════════════════════════════
   GAME LIFECYCLE
   ═══════════════════════════════════════════════════════════════════ */

async function startGame(interaction, game) {
    // Deduct bet up-front using the shared helper.
    deductBet(game.userId, game.bet);

    game.phase = 'playing';
    game.crashAt = rollCrashPoint(game.risk);
    game.currentMult = 1.00;
    game.startedAt = Date.now();
    game._settled = false;

    const autoOpt = AUTOCASH_OPTIONS.find(o => o.value === game.autoCashout);
    game.autoMult = autoOpt?.mult || null;

    // Send initial live panel.
    await interaction.update({
        components: [buildLiveContainer(game, 'rising')],
        flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});

    // Tick loop — run server-side so the multiplier visibly climbs.
    const TICK_MS = 1500;
    const STEP_GROWTH = 0.07;     // per-tick percent growth
    const STEP_MIN    = 0.05;     // floor for early ticks

    game._ticker = setInterval(async () => {
        if (game._settled) {
            clearInterval(game._ticker);
            return;
        }

        const next = game.currentMult + Math.max(STEP_MIN, game.currentMult * STEP_GROWTH);

        // Did the round crash on this tick?
        if (next >= game.crashAt) {
            game.currentMult = game.crashAt;
            return finishCrashed(interaction, game);
        }

        // Auto-cashout hit?
        if (game.autoMult && next >= game.autoMult) {
            game.currentMult = game.autoMult;
            return finishWon(interaction, game, true);
        }

        game.currentMult = Math.round(next * 100) / 100;

        try {
            await interaction.editReply({
                components: [buildLiveContainer(game, 'rising')],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch { /* message likely deleted — let next tick crash gracefully */ }
    }, TICK_MS);

    // Hard timeout: if for some reason the loop runs over a minute, force-crash it.
    game._maxTimer = setTimeout(() => {
        if (!game._settled) {
            game.currentMult = game.crashAt;
            finishCrashed(interaction, game);
        }
    }, 90_000);
}

async function manualCashout(interaction, game) {
    if (game._settled) return interaction.deferUpdate().catch(() => {});
    // Ack the button click first so subsequent editReply paths work
    // for both tick-driven and manual finishes.
    await interaction.deferUpdate().catch(() => {});
    return finishWon(interaction, game, false);
}

async function finishWon(interaction, game, isAuto) {
    game._settled = true;
    clearInterval(game._ticker);
    clearTimeout(game._maxTimer);
    activeGames.delete(game.userId);

    const payout = Math.floor(game.bet * game.currentMult);
    settle(game.userId, game.bet, payout);

    const container = buildLiveContainer(game, isAuto ? 'auto-won' : 'won');
    try {
        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } catch {
        try { await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }); }
        catch {}
    }
}

async function finishCrashed(interaction, game) {
    game._settled = true;
    clearInterval(game._ticker);
    clearTimeout(game._maxTimer);
    activeGames.delete(game.userId);

    settle(game.userId, game.bet, 0);   // total loss

    const container = buildLiveContainer(game, 'crashed');
    try {
        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } catch {
        try { await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }); }
        catch {}
    }
}

/* ═══════════════════════════════════════════════════════════════════
   MODULE EXPORT
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('crash')
        .setDescription('Bet on a crash multiplier — cash out before it crashes!')
        .addStringOption(o => o.setName('bet').setDescription('Bet amount (max 100k) or "all"').setRequired(true)),

    prefix: 'crash',
    description: 'Bet on a rising multiplier. Cash out anytime — but if it crashes first, you lose.',
    usage: 'crash <bet>',
    category: 'economy',
    aliases: ['cr'],

    handleCrashInteraction,

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const amount = interaction.options.getString('bet');
        await handleCrash(
            (opts) => interaction.reply(opts),
            interaction.user.id,
            [amount],
            interaction.guild?.id
        );
    },

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        await handleCrash(
            (opts) => message.reply(opts),
            message.author.id,
            args,
            message.guild?.id
        );
    },
};
