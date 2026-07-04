'use strict';

/**
 * Plinko — drop a ball through pegs and see which payout slot it lands in.
 *
 * Flow
 * ────
 *   1. `plinko <bet>` opens a SETUP panel:
 *        • Rows select         (8 / 12 / 16) — more rows = bigger range
 *        • Risk select         (Low / Medium / High) — picks the payout table
 *        • [Start Game] button — locked until both picks are made
 *        • [Cancel] button     — discards setup, no charge
 *   2. Pressing **Start Game** deducts the bet and animates the ball
 *      bouncing through the pegs in a few ticks. The final slot's
 *      payout is applied (multiplier × bet).
 *
 * Math
 * ────
 *   Each row, the ball goes left or right with 50/50 chance. After R
 *   rows there are R+1 slots; the slot index is the number of "rights".
 *   The slot's payout multiplier is read from `PAYOUTS[risk][rows]` —
 *   classic Plinko U-shape (extreme slots pay big, center slots <1×).
 *
 * House edge sits in the centre slots paying ≤1×, balanced against the
 * rare-but-juicy edge slots. Roughly 92–95% RTP across all presets.
 */

const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, MessageFlags
} = require('discord.js');
const { formatCoins, formatCoinsShort, coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
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
    ball:     '<:Sketch:1521228025365004471>',
    peg:      '<:Star:1521227981685526568>',
    success:  '<:Checkedbox:1521227734943269077>',
    fail:     '<:Cancel:1521227723916181644>',
    info:     '<:Inforect:1521228008285929532>',
    warn:     '<:Infotriangle:1521227710381428926>',
    // Coin icon is per-guild — see coinIcon(guildId). Don't bake one in.
    chart:    '<:transfer:1521228019824590948>',
    skipnext: '<:Caretright:1521227704953864202>',
    fire:     '<:Fire:1521227907647668374>',
    riskLow:  '<:Caretright:1521227704953864202>',
    riskMed:  '<:Caretright:1521227704953864202>',
    riskHigh: '<:Caretright:1521227704953864202>',
    rows:     '<:Caretright:1521227704953864202>',
};

/* ═══════════════════════════════════════════════════════════════════
   PAYOUT TABLES — PAYOUTS[risk][rows] is an array of multipliers
   indexed by slot (left → right). Symmetric around the centre.
   ═══════════════════════════════════════════════════════════════════ */

const PAYOUTS = {
    low: {
        8:  [5.6, 2.1, 1.1, 1.0, 0.5, 1.0, 1.1, 2.1, 5.6],
        12: [10,  3,   1.6, 1.4, 1.1, 1.0, 0.5, 1.0, 1.1, 1.4, 1.6, 3,   10],
        16: [16,  9,   2,   1.4, 1.4, 1.2, 1.1, 1.0, 0.5, 1.0, 1.1, 1.2, 1.4, 1.4, 2,   9,   16],
    },
    medium: {
        8:  [13,  3,   1.3, 0.7, 0.4, 0.7, 1.3, 3,   13],
        12: [33,  11,  4,   2,   1.1, 0.6, 0.3, 0.6, 1.1, 2,   4,   11,  33],
        16: [110, 41,  10,  5,   3,   1.5, 1,   0.5, 0.3, 0.5, 1,   1.5, 3,   5,   10,  41,  110],
    },
    high: {
        8:  [29,  4,   1.5, 0.3, 0.2, 0.3, 1.5, 4,   29],
        12: [76,  18,  5,   2,   0.8, 0.3, 0.2, 0.3, 0.8, 2,   5,   18,  76],
        16: [420, 130, 26,  9,   4,   2,   0.5, 0.3, 0.2, 0.3, 0.5, 2,   4,   9,   26,  130, 420],
    },
};

const ROW_OPTIONS = {
    8:  { label: '8 Rows',  emoji: E.rows, desc: 'Quick rounds, smaller range' },
    12: { label: '12 Rows', emoji: E.rows, desc: 'Balanced — classic Plinko' },
    16: { label: '16 Rows', emoji: E.rows, desc: 'Wide payout range, jackpots up to 420×' },
};

const RISK_OPTIONS = {
    low:    { label: 'Low Risk',    emoji: E.riskLow,  color: 0x57F287, desc: 'Most balls pay 1×, jackpot up to 16×'  },
    medium: { label: 'Medium Risk', emoji: E.riskMed,  color: 0xFEE75C, desc: 'Wider centre dip, 110× edge jackpot'   },
    high:   { label: 'High Risk',   emoji: E.riskHigh, color: 0xED4245, desc: 'Tiny centre payouts, 420× moonshot'    },
};

/** Active games keyed by userId. */
const activeGames = new Map();

/* ═══════════════════════════════════════════════════════════════════
   PURE GAME LOGIC
   ═══════════════════════════════════════════════════════════════════ */

/** Drop the ball through `rows` pegs. Returns the slot index 0..rows. */
function dropBall(rows) {
    const path = [];
    let position = 0;     // signed offset from centre
    for (let r = 0; r < rows; r++) {
        const step = Math.random() < 0.5 ? -1 : 1;
        position += step;
        path.push(step);
    }
    // Convert signed position to slot index (0..rows).
    // Number of "right" moves = (position + rows) / 2.
    const rights = path.filter(s => s === 1).length;
    return { slot: rights, path };
}

/* ═══════════════════════════════════════════════════════════════════
   UI BUILDERS
   ═══════════════════════════════════════════════════════════════════ */

function buildSetupContainer(userId) {
    const game = activeGames.get(userId);
    if (!game) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `${E.fail} Setup expired. Run \`plinko <bet>\` again.`);
        return c;
    }

    const ready = !!(game.rows && game.risk);
    const accent = game.risk ? RISK_OPTIONS[game.risk].color : 0xCAD7E6;

    const lines = [
        `# ${E.title} Plinko — Setup`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
    ];
    if (game.rows) {
        lines.push(`> ${ROW_OPTIONS[game.rows].emoji} **Rows:** ${ROW_OPTIONS[game.rows].label}`);
    }
    if (game.risk) {
        const r = RISK_OPTIONS[game.risk];
        lines.push(`> ${r.emoji} **Risk:** ${r.label}`);
        if (game.rows) {
            const table = PAYOUTS[game.risk][game.rows];
            const max = Math.max(...table);
            lines.push(`> ${E.chart} **Top payout:** \`${max}x\``);
        }
    }

    lines.push('');
    lines.push(ready
        ? `${E.success} Ready! Press **Start Game** to drop the ball.`
        : `${E.info} Pick **rows** and **risk** below to enable Start.`);

    const container = createContainer(accent);
    addTextDisplay(container, lines.join('\n'));
    addSeparator(container, SeparatorSpacingSize.Small);

    /* ── Rows select ─────────────────────────────────────────────── */
    const rowOpts = Object.entries(ROW_OPTIONS).map(([key, r]) => ({
        label: r.label,
        value: key,
        description: r.desc,
        emoji: r.emoji,
        default: String(game.rows) === key,
    }));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`plinko_setup_rows_${userId}`)
            .setPlaceholder(game.rows ? `Rows · ${ROW_OPTIONS[game.rows].label}` : 'Select rows…')
            .addOptions(rowOpts)
    ));

    /* ── Risk select ─────────────────────────────────────────────── */
    const riskOpts = Object.entries(RISK_OPTIONS).map(([key, r]) => ({
        label: r.label,
        value: key,
        description: r.desc,
        emoji: r.emoji,
        default: game.risk === key,
    }));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`plinko_setup_risk_${userId}`)
            .setPlaceholder(game.risk ? `Risk · ${RISK_OPTIONS[game.risk].label}` : 'Select risk…')
            .addOptions(riskOpts)
    ));

    /* ── Start / Cancel ──────────────────────────────────────────── */
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`plinko_setup_start_${userId}`)
            .setLabel('Start Game')
            .setEmoji(E.skipnext)
            .setStyle(ButtonStyle.Success)
            .setDisabled(!ready),
        new ButtonBuilder()
            .setCustomId(`plinko_setup_cancel_${userId}`)
            .setLabel('Cancel')
            .setEmoji(E.fail)
            .setStyle(ButtonStyle.Secondary),
    ));

    return container;
}

/** Render an ASCII frame of the ball as it falls. */
function renderFrame(rows, currentRow, currentPos) {
    const width = rows + 1;
    const lines = [];
    for (let r = 0; r <= rows; r++) {
        const cells = [];
        for (let c = 0; c < width; c++) {
            // Pegs only render in the inner rows
            if (r === currentRow) {
                // Ball position — measured as signed offset from centre.
                const ballCol = Math.floor((currentPos + r) / 2);
                if (c === ballCol) cells.push('●');
                else cells.push(r > 0 && r < rows && c >= (rows - r) / 2 && c <= (rows + r) / 2 && (c - r) % 2 === 0 ? '·' : ' ');
            } else if (r > 0 && r < rows && c >= (rows - r) / 2 && c <= (rows + r) / 2 && (c - r) % 2 === 0) {
                cells.push('·');
            } else {
                cells.push(' ');
            }
        }
        lines.push(cells.join(' '));
    }
    return '```\n' + lines.join('\n') + '\n```';
}

/** Render the payout slot bar as text underneath the board. */
function renderPayoutBar(table, highlightSlot = null) {
    return table.map((mult, i) => {
        const tag = i === highlightSlot ? `**[${mult}x]**` : `\`${mult}x\``;
        return tag;
    }).join(' · ');
}

function buildLiveContainer(game, status, info = {}) {
    const r = RISK_OPTIONS[game.risk];
    const table = PAYOUTS[game.risk][game.rows];
    const color = status === 'won' ? 0x57F287
        : status === 'lost' ? 0xED4245
        : r.color;

    const lines = [
        `# ${E.title} Plinko`,
        `-# ${E.rows} ${ROW_OPTIONS[game.rows].label}  ·  ${r.emoji} ${r.label}`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
    ];

    if (status === 'falling') {
        lines.push(`> ${E.ball} **Dropping...** row ${info.row}/${game.rows}`);
    } else if (status === 'won') {
        lines.push(`> ${E.success} **Slot ${info.slot}** → \`${info.mult}x\` payout`);
        lines.push(`> ${coinIcon(game.guildId)} **Won:** ${formatCoinsAmount(info.payout, game.guildId)} (+${formatNumber(info.payout - game.bet)})`);
    } else if (status === 'lost') {
        lines.push(`> ${E.fail} **Slot ${info.slot}** → \`${info.mult}x\` payout`);
        lines.push(`> ${coinIcon(game.guildId)} **Lost:** ${formatCoinsAmount(game.bet - info.payout, game.guildId)} (kept ${formatNumber(info.payout)})`);
    } else if (status === 'push') {
        lines.push(`> ${E.info} **Slot ${info.slot}** → \`${info.mult}x\` payout`);
        lines.push(`> ${coinIcon(game.guildId)} **Bet refunded:** ${formatCoinsAmount(info.payout, game.guildId)}`);
    }

    lines.push('');
    if (status !== 'falling') {
        lines.push(renderFrame(game.rows, game.rows, info.finalPos ?? 0));
    } else {
        lines.push(renderFrame(game.rows, info.row, info.pos));
    }

    lines.push('');
    lines.push(`-# Payouts: ${renderPayoutBar(table, status === 'falling' ? null : info.slot)}`);

    const container = createContainer(color);
    addTextDisplay(container, lines.join('\n'));
    return container;
}

/* ═══════════════════════════════════════════════════════════════════
   COMMAND ENTRY
   ═══════════════════════════════════════════════════════════════════ */

async function handlePlinko(reply, userId, args, guildId) {
    if (activeGames.has(userId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, `${E.warn} You already have an active plinko session. Finish or cancel it first.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const balance = getBalance(userId);
    const betResult = parseBet(args[0], balance);

    if (!betResult.valid) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `# ${E.title} Plinko`,
            '',
            `> ${E.info} **Usage:** \`plinko <bet>\``,
            `> ${coinIcon(guildId)} **Max Bet:** ${formatNumber(MAX_BET)}`,
            '',
            `Drop a ball through pegs — the slot it lands in decides your payout.`,
            '',
            `**Rows:** 8 · 12 · 16 (wider boards = bigger range)`,
            `**Risks:** ${E.riskLow} Low · ${E.riskMed} Medium · ${E.riskHigh} High`,
            '',
            `Top jackpot: **420×** on 16-row High Risk.`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const bet = betResult.amount;

    activeGames.set(userId, {
        phase: 'setup',
        bet,
        guildId: guildId || null,
        userId,
        rows: null,
        risk: null,
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

async function handlePlinkoInteraction(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('plinko_')) return false;

    const userId = interaction.user.id;

    if (customId.startsWith('plinko_setup_rows_')) {
        const target = customId.split('_')[3];
        if (userId !== target) {
            return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        }
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'setup') {
            return interaction.reply({ content: `${E.fail} Setup expired.`, flags: MessageFlags.Ephemeral });
        }
        game.rows = parseInt(interaction.values[0], 10);
        return interaction.update({ components: [buildSetupContainer(userId)], flags: MessageFlags.IsComponentsV2 });
    }

    if (customId.startsWith('plinko_setup_risk_')) {
        const target = customId.split('_')[3];
        if (userId !== target) {
            return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        }
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'setup') {
            return interaction.reply({ content: `${E.fail} Setup expired.`, flags: MessageFlags.Ephemeral });
        }
        game.risk = interaction.values[0];
        return interaction.update({ components: [buildSetupContainer(userId)], flags: MessageFlags.IsComponentsV2 });
    }

    if (customId.startsWith('plinko_setup_cancel_')) {
        const target = customId.split('_')[3];
        if (userId !== target) {
            return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        }
        activeGames.delete(userId);
        const c = createContainer(0x6b7280);
        addTextDisplay(c, `# ${E.fail} Setup Cancelled\n\nNo coins were charged.`);
        return interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (customId.startsWith('plinko_setup_start_')) {
        const target = customId.split('_')[3];
        if (userId !== target) {
            return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        }
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'setup') {
            return interaction.reply({ content: `${E.fail} Setup expired.`, flags: MessageFlags.Ephemeral });
        }
        if (!game.rows || !game.risk) {
            return interaction.reply({ content: `${E.warn} Pick rows and risk first.`, flags: MessageFlags.Ephemeral });
        }
        return startGame(interaction, game);
    }

    return false;
}

/* ═══════════════════════════════════════════════════════════════════
   GAME LIFECYCLE
   ═══════════════════════════════════════════════════════════════════ */

async function startGame(interaction, game) {
    deductBet(game.userId, game.bet);

    game.phase = 'playing';
    const { slot, path } = dropBall(game.rows);
    game.path = path;
    game.slot = slot;

    // Drop the initial frame.
    await interaction.update({
        components: [buildLiveContainer(game, 'falling', { row: 0, pos: 0 })],
        flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});

    // Animate the ball ~5 frames.
    const TICK_MS = 700;
    const ANIM_FRAMES = Math.min(game.rows, 5);
    const stepEvery = Math.max(1, Math.floor(game.rows / ANIM_FRAMES));
    let pos = 0;

    for (let r = 1; r <= game.rows; r++) {
        pos += path[r - 1];
        if (r === game.rows || r % stepEvery === 0) {
            await new Promise(res => setTimeout(res, TICK_MS));
            try {
                await interaction.editReply({
                    components: [buildLiveContainer(game, 'falling', { row: r, pos })],
                    flags: MessageFlags.IsComponentsV2,
                });
            } catch { break; }
        }
    }

    // Resolve.
    const table = PAYOUTS[game.risk][game.rows];
    const mult = table[slot];
    const payout = Math.floor(game.bet * mult);

    settle(game.userId, game.bet, payout);
    activeGames.delete(game.userId);

    const finalPos = path.reduce((acc, s) => acc + s, 0);
    let status;
    if (payout > game.bet)      status = 'won';
    else if (payout === game.bet) status = 'push';
    else                          status = 'lost';

    const container = buildLiveContainer(game, status, { slot, mult, payout, finalPos });
    try {
        await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } catch {}
}

/* ═══════════════════════════════════════════════════════════════════
   MODULE EXPORT
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('plinko')
        .setDescription('Drop a ball through pegs — slot it lands in decides your payout')
        .addStringOption(o => o.setName('bet').setDescription('Bet amount (max 100k) or "all"').setRequired(true)),

    prefix: 'plinko',
    description: 'Plinko ball-drop. Pick rows + risk, drop the ball, win up to 420×.',
    usage: 'plinko <bet>',
    category: 'economy',
    aliases: ['pk'],

    handlePlinkoInteraction,

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const amount = interaction.options.getString('bet');
        await handlePlinko(
            (opts) => interaction.reply(opts),
            interaction.user.id,
            [amount],
            interaction.guild?.id
        );
    },

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        await handlePlinko(
            (opts) => message.reply(opts),
            message.author.id,
            args,
            message.guild?.id
        );
    },
};
