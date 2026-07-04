'use strict';

/**
 * Wheel — bet on a Fortune Wheel spin. Pick a wheel preset (segment
 * count + payout shape), press Start, watch the wheel spin, see where
 * the pointer lands.
 *
 * Presets
 * ───────
 *   Small  — 6 segments, common 0.5×/1×/2× with one rare 5× jackpot
 *   Medium — 10 segments, more variance, 10× jackpot
 *   Large  — 20 segments, high volatility, 25× jackpot
 *   Mega   — 40 segments, lottery-style, 100× jackpot
 *
 * Math
 * ────
 *   Each segment is uniformly likely. Expected value tuned to ~92–95%
 *   RTP per preset by mixing 0.5× / 1× / 2× / 5× / jackpot multipliers.
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
    spin:     '<:Music:1521228141543165982>',
    success:  '<:Checkedbox:1521227734943269077>',
    fail:     '<:Cancel:1521227723916181644>',
    info:     '<:Inforect:1521228008285929532>',
    warn:     '<:Infotriangle:1521227710381428926>',
    // NOTE: do not bake the coin emoji in here — it must follow the
    // per-guild `/currency` setting. Use `coinIcon(guildId)` at every
    // render site instead.
    chart:    '<:transfer:1521228019824590948>',
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

/* ═══════════════════════════════════════════════════════════════════
   PRESETS — wheel segments by multiplier
   ═══════════════════════════════════════════════════════════════════ */

const PRESETS = {
    small: {
        label: 'Small Wheel',
        emoji: E.riskLow,
        color: 0x57F287,
        desc: '6 slices · low volatility · 5× jackpot',
        // [multiplier, count] — sum of counts = total segments
        segments: [[0.5, 2], [1.0, 2], [2.0, 1], [5.0, 1]],
    },
    medium: {
        label: 'Medium Wheel',
        emoji: E.riskMed,
        color: 0xFEE75C,
        desc: '10 slices · balanced · 10× jackpot',
        segments: [[0.0, 1], [0.5, 3], [1.0, 3], [2.0, 2], [10.0, 1]],
    },
    large: {
        label: 'Large Wheel',
        emoji: E.riskHigh,
        color: 0xF97316,
        desc: '20 slices · high variance · 25× jackpot',
        segments: [[0.0, 4], [0.5, 6], [1.0, 4], [2.0, 3], [5.0, 2], [25.0, 1]],
    },
    mega: {
        label: 'Mega Wheel',
        emoji: E.riskMax,
        color: 0xED4245,
        desc: '40 slices · lottery-style · 100× jackpot',
        segments: [[0.0, 18], [0.5, 10], [1.0, 5], [2.0, 4], [5.0, 2], [100.0, 1]],
    },
};

const activeGames = new Map();

/* ═══════════════════════════════════════════════════════════════════
   PURE LOGIC
   ═══════════════════════════════════════════════════════════════════ */

function expandSegments(presetKey) {
    const list = [];
    for (const [mult, count] of PRESETS[presetKey].segments) {
        for (let i = 0; i < count; i++) list.push(mult);
    }
    return list;
}

function spinWheel(presetKey) {
    const segments = expandSegments(presetKey);
    const idx = Math.floor(Math.random() * segments.length);
    return { mult: segments[idx], slot: idx, total: segments.length };
}

function multiplierEmoji(mult) {
    if (mult >= 25) return E.crown;
    if (mult >= 5)  return E.gem;
    if (mult >= 2)  return E.star;
    if (mult >= 1)  return E.success;
    if (mult > 0)   return E.warn;
    return E.fail;
}

/* ═══════════════════════════════════════════════════════════════════
   UI BUILDERS
   ═══════════════════════════════════════════════════════════════════ */

function buildSetupContainer(userId) {
    const game = activeGames.get(userId);
    if (!game) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `${E.fail} Setup expired. Run \`wheel <bet>\` again.`);
        return c;
    }

    const ready = !!game.preset;
    const accent = game.preset ? PRESETS[game.preset].color : 0xCAD7E6;

    const lines = [
        `# ${E.title} Fortune Wheel — Setup`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
    ];
    if (game.preset) {
        const p = PRESETS[game.preset];
        const top = Math.max(...p.segments.map(([m]) => m));
        lines.push(`> ${p.emoji} **Wheel:** ${p.label}  ·  top \`${top}x\``);
    }

    lines.push('');
    lines.push(ready
        ? `${E.success} Ready! Press **Start Game** to spin the wheel.`
        : `${E.info} Pick a wheel preset below to enable Start.`);

    const container = createContainer(accent);
    addTextDisplay(container, lines.join('\n'));
    addSeparator(container, SeparatorSpacingSize.Small);

    const opts = Object.entries(PRESETS).map(([key, p]) => ({
        label: p.label,
        value: key,
        description: p.desc,
        emoji: p.emoji,
        default: game.preset === key,
    }));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`wheel_setup_preset_${userId}`)
            .setPlaceholder(game.preset ? `Wheel · ${PRESETS[game.preset].label}` : 'Select a wheel…')
            .addOptions(opts)
    ));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`wheel_setup_start_${userId}`)
            .setLabel('Start Game')
            .setEmoji(E.skipnext)
            .setStyle(ButtonStyle.Success)
            .setDisabled(!ready),
        new ButtonBuilder()
            .setCustomId(`wheel_setup_cancel_${userId}`)
            .setLabel('Cancel')
            .setEmoji(E.fail)
            .setStyle(ButtonStyle.Secondary),
    ));

    return container;
}

function buildResultContainer(game, result) {
    const p = PRESETS[game.preset];
    const won = result.payout > game.bet;
    const push = result.payout === game.bet;
    const color = won ? 0x57F287 : push ? 0xFEE75C : 0xED4245;

    // Build a payout-distribution preview line (each unique mult shown once).
    const uniqueMults = [...new Set(expandSegments(game.preset))].sort((a, b) => a - b);
    const distLine = uniqueMults.map(m => {
        const n = expandSegments(game.preset).filter(x => x === m).length;
        const tag = m === result.mult ? `**${m}x · ${n}**` : `${m}x · ${n}`;
        return `${multiplierEmoji(m)} ${tag}`;
    }).join('  ·  ');

    const lines = [
        `# ${E.title} Fortune Wheel`,
        `-# ${p.emoji} ${p.label}  ·  ${result.total} segments`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
        `> ${E.spin} **Landed:** slot ${result.slot + 1} → ${multiplierEmoji(result.mult)} \`${result.mult}x\``,
        '',
        won
            ? `${E.success} **Won ${formatCoins(result.payout - game.bet, game.guildId)}!** *(received ${formatNumber(result.payout)})*`
            : push
                ? `${E.info} **Bet refunded** — landed on 1×`
                : `${E.fail} **Lost ${formatCoins(game.bet - result.payout, game.guildId)}** *(kept ${formatNumber(result.payout)})*`,
    ];

    if (won && result.bonusDelta && result.bonusDelta > 0) {
        lines.push(`-# 🥇 Medal bonus added **+${formatCoins(result.bonusDelta, game.guildId)}** to your win.`);
    }

    if (typeof result.balance === 'number') {
        lines.push('');
        lines.push(`> ${coinIcon(game.guildId)} **Balance:** ${formatCoinsAmount(result.balance, game.guildId)}`);
    }

    lines.push('');
    lines.push(`-# Distribution: ${distLine}`);

    const container = createContainer(color);
    addTextDisplay(container, lines.join('\n'));
    return container;
}

/* ═══════════════════════════════════════════════════════════════════
   COMMAND ENTRY
   ═══════════════════════════════════════════════════════════════════ */

async function handleWheel(reply, userId, args, guildId) {
    if (activeGames.has(userId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, `${E.warn} You already have an active wheel session. Finish or cancel it first.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const balance = getBalance(userId);
    const betResult = parseBet(args[0], balance);

    if (!betResult.valid) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `# ${E.title} Fortune Wheel`,
            '',
            `> ${E.info} **Usage:** \`wheel <bet>\``,
            `> ${coinIcon(guildId)} **Max Bet:** ${formatNumber(MAX_BET)}`,
            '',
            `Spin the Fortune Wheel — pick a preset, then watch where the pointer lands.`,
            '',
            `**Wheels:** ${E.riskLow} Small · ${E.riskMed} Medium · ${E.riskHigh} Large · ${E.riskMax} Mega`,
            '',
            `Bigger wheels = lower hit-rate but jackpots up to **100×**.`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const bet = betResult.amount;
    activeGames.set(userId, {
        phase: 'setup', bet, guildId: guildId || null, userId, preset: null, timestamp: Date.now(),
    });
    setTimeout(() => {
        const g = activeGames.get(userId);
        if (g && g.phase === 'setup') activeGames.delete(userId);
    }, 90_000);

    return reply({ components: [buildSetupContainer(userId)], flags: MessageFlags.IsComponentsV2 });
}

/* ═══════════════════════════════════════════════════════════════════
   ROUTER
   ═══════════════════════════════════════════════════════════════════ */

async function handleWheelInteraction(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('wheel_')) return false;
    const userId = interaction.user.id;

    if (customId.startsWith('wheel_setup_preset_')) {
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'setup') return interaction.reply({ content: `${E.fail} Setup expired.`, flags: MessageFlags.Ephemeral });
        game.preset = interaction.values[0];
        return interaction.update({ components: [buildSetupContainer(userId)], flags: MessageFlags.IsComponentsV2 });
    }

    if (customId.startsWith('wheel_setup_cancel_')) {
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        activeGames.delete(userId);
        const c = createContainer(0x6b7280);
        addTextDisplay(c, `# ${E.fail} Setup Cancelled\n\nNo coins were charged.`);
        return interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (customId.startsWith('wheel_setup_start_')) {
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'setup') return interaction.reply({ content: `${E.fail} Setup expired.`, flags: MessageFlags.Ephemeral });
        if (!game.preset) return interaction.reply({ content: `${E.warn} Pick a wheel preset first.`, flags: MessageFlags.Ephemeral });
        return startGame(interaction, game);
    }

    return false;
}

/* ═══════════════════════════════════════════════════════════════════
   LIFECYCLE
   ═══════════════════════════════════════════════════════════════════ */

async function startGame(interaction, game) {
    deductBet(game.userId, game.bet);
    game.phase = 'playing';
    activeGames.delete(game.userId);

    const result = spinWheel(game.preset);
    const payout = Math.floor(game.bet * result.mult);

    /* ═══ Spinning animation ═══
       Edit the same panel through 3 "spinning" frames, each showing
       a random teaser slot with a slowing rhythm, then settle and
       show the real result. The final outcome is fixed BEFORE the
       first frame renders so animation can never desync from the
       economy. */
    const segs = expandSegments(game.preset);
    const totalSlots = segs.length;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function buildSpinFrame(displayMult, label) {
        const p = PRESETS[game.preset];
        const c = createContainer(p.color);
        addTextDisplay(c, [
            `# ${E.title} Fortune Wheel`,
            `-# ${p.emoji} ${p.label}  ·  ${totalSlots} segments`,
            '',
            `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
            '',
            `## ${E.spin}  ▸  \`${displayMult}x\`  ◂`,
            '',
            label,
        ].join('\n'));
        return c;
    }

    try {
        // Frame 0 — initial spin
        await interaction.update({
            components: [buildSpinFrame(segs[Math.floor(Math.random() * totalSlots)], `<:Sandwatch:1521228272426418367> *Wheel spinning…*`)],
            flags: MessageFlags.IsComponentsV2,
        });
        await sleep(550);

        // Frame 1 — slowing
        const editFn = (payload) => interaction.editReply(payload);
        await editFn({
            components: [buildSpinFrame(segs[Math.floor(Math.random() * totalSlots)], `<:Sandwatch:1521228272426418367> *Wheel slowing…*`)],
            flags: MessageFlags.IsComponentsV2,
        });
        await sleep(550);

        // Frame 2 — almost there
        await editFn({
            components: [buildSpinFrame(segs[Math.floor(Math.random() * totalSlots)], `<:Sandwatch:1521228272426418367> *Almost stopped…*`)],
            flags: MessageFlags.IsComponentsV2,
        });
        await sleep(600);

        // Final reveal
        const { userData, payout: actualPayout } = settle(game.userId, game.bet, payout);
        result.payout = actualPayout;
        result.bonusDelta = actualPayout - payout; // medal bonus delta
        result.balance = userData.coins;

        const container = buildResultContainer(game, result);
        return await editFn({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } catch (err) {
        // Animation failed (rate limit / token expired). Settle the
        // bet anyway so the user always gets the payout, then attempt
        // a final edit. If even that fails, the bet is still settled
        // — the user just won't see the result panel.
        console.warn('[WHEEL] animation failed, settling silently:', err?.message || err);
        const { userData, payout: actualPayout } = settle(game.userId, game.bet, payout);
        result.payout = actualPayout;
        result.bonusDelta = actualPayout - payout;
        result.balance = userData.coins;
        try {
            await interaction.editReply({
                components: [buildResultContainer(game, result)],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch { /* swallow — settled is what matters */ }
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wheel')
        .setDescription('Spin the Fortune Wheel — pick a preset, win up to 100×')
        .addStringOption(o => o.setName('bet').setDescription('Bet amount (max 100k) or "all"').setRequired(true)),

    prefix: 'wheel',
    aliases: ['spin'],
    description: 'Spin the Fortune Wheel — small to mega presets, jackpots up to 100×.',
    usage: 'wheel <bet>',
    category: 'economy',

    handleWheelInteraction,

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const amount = interaction.options.getString('bet');
        await handleWheel((opts) => interaction.reply(opts), interaction.user.id, [amount], interaction.guild?.id);
    },

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        await handleWheel((opts) => message.reply(opts), message.author.id, args, message.guild?.id);
    },
};
