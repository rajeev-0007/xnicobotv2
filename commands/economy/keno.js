'use strict';

/**
 * Keno — pick K numbers from 1..40, the bot draws 10. Payout is based
 * on the number of picks K and how many matched the draw.
 *
 * UI layout (the previous 5×8 button grid violated Discord's hard
 * 5-buttons-per-ActionRow limit and crashed every render):
 *   1. Pick-count select  → sets K and reveals the picker
 *   2. Two number selects → split 1–25 and 26–40 across two
 *      multi-select StringSelectMenus (max 25 options per menu).
 *      Selections from each menu are merged into the active game's
 *      `picks` set. Both menus respect K as their max selectable
 *      count, and the live preview shows the merged total.
 *   3. Start / Clear / Cancel buttons (one ActionRow, 3 buttons).
 *
 * Math
 * ────
 *   The bot draws 10 distinct numbers from a 40-number pool. Payout
 *   tables for each "pick count" preset are tuned to roughly 90%
 *   RTP, with jackpots scaling from 12× (3-pick all match) up to
 *   1000× (10-pick all match — astronomically rare).
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
    pick:     '<:Sketch:1521228025365004471>',
    miss:     '<:Cancel:1521227723916181644>',
    success:  '<:Checkedbox:1521227734943269077>',
    info:     '<:Inforect:1521228008285929532>',
    warn:     '<:Infotriangle:1521227710381428926>',
    // Coin icon is per-guild — use coinIcon(guildId) at render sites.
    chart:    '<:transfer:1521228019824590948>',
    skipnext: '<:Caretright:1521227704953864202>',
    star:     '<:Star:1521227981685526568>',
    fire:     '<:Fire:1521227907647668374>',
    crown:    '<:Crown:1521227739988889764>',
    history:  '<:History:1521227863079256278>',
    box:      '<:Box:1521228152414666833>',
    riskLow:  '<:Caretright:1521227704953864202>',
    riskMed:  '<:Caretright:1521227704953864202>',
    riskHigh: '<:Caretright:1521227704953864202>',
    riskMax:  '<:Caretright:1521227704953864202>',
};

const POOL_SIZE = 40;
const DRAW_SIZE = 10;
const HALF_SIZE = 25;   // first picker covers 1..25, second covers 26..40

/**
 * PAYOUTS[picksCount][matches] = multiplier
 * Tuned for ~90% RTP. Picks indexed 3 / 5 / 7 / 10 — selectable by
 * the player. Matches < threshold pay 0.
 */
const PAYOUTS = {
    3:  { 0: 0,    1: 0,    2: 1,    3: 12 },
    5:  { 0: 0,    1: 0,    2: 0.5,  3: 2,    4: 8,    5: 50 },
    7:  { 0: 0,    1: 0,    2: 0,    3: 0.5,  4: 2,    5: 8,    6: 30,   7: 200 },
    10: { 0: 1,    1: 0,    2: 0,    3: 0,    4: 0.5,  5: 2,    6: 5,    7: 25,  8: 100, 9: 250, 10: 1000 },
};

const PICK_PRESETS = [
    { value: '3',  count: 3,  label: '3 numbers',  emoji: E.riskLow,  desc: 'Easy hits · top payout 12×' },
    { value: '5',  count: 5,  label: '5 numbers',  emoji: E.riskMed,  desc: 'Balanced · top payout 50×' },
    { value: '7',  count: 7,  label: '7 numbers',  emoji: E.riskHigh, desc: 'High variance · top payout 200×' },
    { value: '10', count: 10, label: '10 numbers', emoji: E.riskMax,  desc: 'Lottery · top payout 1000×' },
];

const activeGames = new Map();

/* ═══════════════════════════════════════════════════════════════════
   PURE LOGIC
   ═══════════════════════════════════════════════════════════════════ */

function drawNumbers() {
    const pool = Array.from({ length: POOL_SIZE }, (_, i) => i + 1);
    for (let i = 0; i < DRAW_SIZE; i++) {
        const j = i + Math.floor(Math.random() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return new Set(pool.slice(0, DRAW_SIZE));
}

function payoutMultiplier(pickCount, matches) {
    return PAYOUTS[pickCount]?.[matches] ?? 0;
}

/* ═══════════════════════════════════════════════════════════════════
   UI BUILDERS
   ═══════════════════════════════════════════════════════════════════ */

function buildPresetContainer(userId) {
    const game = activeGames.get(userId);
    if (!game) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `${E.miss} Setup expired. Run \`keno <bet>\` again.`);
        return c;
    }

    const lines = [
        `# ${E.title} Keno — Setup`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
        '',
        `${E.info} First, pick **how many numbers** you'll bet on. The picker board appears next.`,
    ];

    const container = createContainer(0xCAD7E6);
    addTextDisplay(container, lines.join('\n'));
    addSeparator(container, SeparatorSpacingSize.Small);

    const opts = PICK_PRESETS.map(p => ({
        label: p.label,
        value: p.value,
        description: p.desc,
        emoji: p.emoji,
    }));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`keno_setup_count_${userId}`)
            .setPlaceholder('Pick how many numbers to bet on…')
            .addOptions(opts)
    ));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`keno_setup_cancel_${userId}`)
            .setLabel('Cancel')
            .setEmoji(E.miss)
            .setStyle(ButtonStyle.Secondary),
    ));

    return container;
}

/**
 * Number picker — uses two StringSelectMenus split at HALF_SIZE
 * (a single Discord select menu maxes out at 25 options).
 *
 * Each picker shows the merged-state default flag so when the user
 * re-opens the dropdown the previously-selected numbers stay ticked.
 */
function buildPickerContainer(userId) {
    const game = activeGames.get(userId);
    if (!game || !game.pickCount) return buildPresetContainer(userId);

    const ready = game.picks.size === game.pickCount;
    const accent = ready ? 0x57F287 : 0xCAD7E6;

    const lines = [
        `# ${E.title} Keno — Pick ${game.pickCount} Numbers`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
        `> ${E.pick} **Picked:** ${game.picks.size} / ${game.pickCount}`,
    ];
    if (game.picks.size > 0) {
        lines.push(`> ${E.history} **Selection:** ${[...game.picks].sort((a, b) => a - b).join(', ')}`);
    }
    lines.push('');
    lines.push(ready
        ? `${E.success} Ready! Press **Start Game** to draw.`
        : `${E.info} Use the dropdowns to pick ${game.pickCount} numbers from 1–${POOL_SIZE}.`);

    const container = createContainer(accent);
    addTextDisplay(container, lines.join('\n'));
    addSeparator(container, SeparatorSpacingSize.Small);

    // ── Picker 1: numbers 1..HALF_SIZE ───────────────────────────────
    const pickedInLow = [...game.picks].filter(n => n <= HALF_SIZE).length;
    const lowOpts = Array.from({ length: HALF_SIZE }, (_, i) => {
        const n = i + 1;
        return {
            label: String(n),
            value: String(n),
            default: game.picks.has(n),
        };
    });
    const lowMaxValues = Math.min(HALF_SIZE,
        // Don't let the user blow past the total pickCount via this picker.
        Math.max(1, game.pickCount - (game.picks.size - pickedInLow))
    );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`keno_pick_low_${userId}`)
            .setPlaceholder(`Numbers 1–${HALF_SIZE} · ${pickedInLow} picked`)
            .setMinValues(0)
            .setMaxValues(lowMaxValues)
            .addOptions(lowOpts)
    ));

    // ── Picker 2: numbers (HALF_SIZE+1)..POOL_SIZE ───────────────────
    const pickedInHigh = [...game.picks].filter(n => n > HALF_SIZE).length;
    const highOpts = Array.from({ length: POOL_SIZE - HALF_SIZE }, (_, i) => {
        const n = HALF_SIZE + i + 1;
        return {
            label: String(n),
            value: String(n),
            default: game.picks.has(n),
        };
    });
    const highMaxValues = Math.min(POOL_SIZE - HALF_SIZE,
        Math.max(1, game.pickCount - (game.picks.size - pickedInHigh))
    );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`keno_pick_high_${userId}`)
            .setPlaceholder(`Numbers ${HALF_SIZE + 1}–${POOL_SIZE} · ${pickedInHigh} picked`)
            .setMinValues(0)
            .setMaxValues(highMaxValues)
            .addOptions(highOpts)
    ));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`keno_setup_start_${userId}`)
            .setLabel('Start Game')
            .setEmoji(E.skipnext)
            .setStyle(ButtonStyle.Success)
            .setDisabled(!ready),
        new ButtonBuilder()
            .setCustomId(`keno_setup_clear_${userId}`)
            .setLabel('Clear Picks')
            .setEmoji(E.history)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`keno_setup_cancel_${userId}`)
            .setLabel('Cancel')
            .setEmoji(E.miss)
            .setStyle(ButtonStyle.Secondary),
    ));

    return container;
}

function buildResultContainer(game, draw, matches, mult, payout) {
    const won = payout > game.bet;
    const push = payout === game.bet;
    const color = won ? 0x57F287 : push ? 0xFEE75C : 0xED4245;

    const drawSorted = [...draw].sort((a, b) => a - b);
    const picks = [...game.picks].sort((a, b) => a - b);

    const drawDisplay = drawSorted.map(n => {
        return game.picks.has(n) ? `**\`${n}\`**` : `\`${n}\``;
    }).join(' ');
    const picksDisplay = picks.map(n => {
        return draw.has(n) ? `${E.pick} \`${n}\`` : `${E.miss} \`${n}\``;
    }).join('  ');

    const lines = [
        `# ${E.title} Keno`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
        `> ${E.chart} **Matches:** ${matches} / ${game.pickCount}  ·  multiplier \`${mult}x\``,
        '',
        won
            ? `${E.success} **Won ${formatCoins(payout - game.bet, game.guildId)}!** (received ${formatNumber(payout)})`
            : push
                ? `${E.info} **Bet refunded** — break-even payout`
                : `${E.miss} **Lost ${formatCoins(game.bet - payout, game.guildId)}** (kept ${formatNumber(payout)})`,
        '',
        `**Drawn numbers** (matches in **bold**):`,
        `${drawDisplay}`,
        '',
        `**Your picks:**`,
        `${picksDisplay}`,
    ];

    const container = createContainer(color);
    addTextDisplay(container, lines.join('\n'));
    return container;
}

/* ═══════════════════════════════════════════════════════════════════
   ENTRY + ROUTER
   ═══════════════════════════════════════════════════════════════════ */

async function handleKeno(reply, userId, args, guildId) {
    if (activeGames.has(userId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, `${E.warn} You already have an active keno session. Finish or cancel it first.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const balance = getBalance(userId);
    const betResult = parseBet(args[0], balance);

    if (!betResult.valid) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `# ${E.title} Keno`,
            '',
            `> ${E.info} **Usage:** \`keno <bet>\``,
            `> ${coinIcon(guildId)} **Max Bet:** ${formatNumber(MAX_BET)}`,
            '',
            `Pick numbers from 1–${POOL_SIZE}. The bot draws ${DRAW_SIZE}. Payout depends on how many you matched.`,
            '',
            `**Pick counts:** 3 · 5 · 7 · 10  (jackpot up to **1000×** on 10-pick).`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const bet = betResult.amount;
    activeGames.set(userId, {
        phase: 'preset', bet, guildId: guildId || null, userId,
        pickCount: 0, picks: new Set(), timestamp: Date.now(),
    });
    setTimeout(() => {
        const g = activeGames.get(userId);
        if (g && g.phase !== 'playing') activeGames.delete(userId);
    }, 180_000);

    return reply({ components: [buildPresetContainer(userId)], flags: MessageFlags.IsComponentsV2 });
}

async function handleKenoInteraction(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('keno_')) return false;
    const userId = interaction.user.id;

    if (customId.startsWith('keno_setup_count_')) {
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.miss} Not your game!`, flags: MessageFlags.Ephemeral });
        const game = activeGames.get(userId);
        if (!game) return interaction.reply({ content: `${E.miss} Setup expired.`, flags: MessageFlags.Ephemeral });
        const preset = PICK_PRESETS.find(p => p.value === interaction.values[0]);
        if (!preset) return interaction.deferUpdate();
        game.pickCount = preset.count;
        game.picks = new Set();
        game.phase = 'picker';
        return interaction.update({ components: [buildPickerContainer(userId)], flags: MessageFlags.IsComponentsV2 });
    }

    // Number-picker dropdowns merge each side into game.picks.
    // Each dropdown represents *the entire selection for its half*,
    // so we replace its slice on every interaction.
    if (customId.startsWith('keno_pick_low_') || customId.startsWith('keno_pick_high_')) {
        const isLow = customId.startsWith('keno_pick_low_');
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.miss} Not your game!`, flags: MessageFlags.Ephemeral });
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'picker') return interaction.deferUpdate().catch(() => {});

        // Build new combined picks — keep the other half as-is, replace this half.
        const otherHalf = [...game.picks].filter(n => isLow ? n > HALF_SIZE : n <= HALF_SIZE);
        const newSelection = (interaction.values || []).map(v => parseInt(v, 10)).filter(n => !isNaN(n));
        const merged = [...otherHalf, ...newSelection];

        if (merged.length > game.pickCount) {
            // Trim newest-half down to fit, but keep the other half stable.
            // Discord enforces maxValues, but we still defend in case the
            // other half was already at-cap.
            const room = Math.max(0, game.pickCount - otherHalf.length);
            const trimmed = newSelection.slice(0, room);
            game.picks = new Set([...otherHalf, ...trimmed]);
            return interaction.update({ components: [buildPickerContainer(userId)], flags: MessageFlags.IsComponentsV2 });
        }

        game.picks = new Set(merged);
        return interaction.update({ components: [buildPickerContainer(userId)], flags: MessageFlags.IsComponentsV2 });
    }

    if (customId.startsWith('keno_setup_clear_')) {
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.miss} Not your game!`, flags: MessageFlags.Ephemeral });
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'picker') return interaction.deferUpdate().catch(() => {});
        game.picks.clear();
        return interaction.update({ components: [buildPickerContainer(userId)], flags: MessageFlags.IsComponentsV2 });
    }

    if (customId.startsWith('keno_setup_cancel_')) {
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.miss} Not your game!`, flags: MessageFlags.Ephemeral });
        activeGames.delete(userId);
        const c = createContainer(0x6b7280);
        addTextDisplay(c, `# ${E.miss} Setup Cancelled\n\nNo coins were charged.`);
        return interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (customId.startsWith('keno_setup_start_')) {
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.miss} Not your game!`, flags: MessageFlags.Ephemeral });
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'picker') return interaction.reply({ content: `${E.miss} Setup expired.`, flags: MessageFlags.Ephemeral });
        if (game.picks.size !== game.pickCount) {
            return interaction.reply({ content: `${E.warn} Pick exactly ${game.pickCount} numbers first.`, flags: MessageFlags.Ephemeral });
        }
        return startGame(interaction, game);
    }

    return false;
}

async function startGame(interaction, game) {
    deductBet(game.userId, game.bet);
    game.phase = 'playing';
    activeGames.delete(game.userId);

    const draw = drawNumbers();
    let matches = 0;
    for (const n of game.picks) if (draw.has(n)) matches++;

    const mult = payoutMultiplier(game.pickCount, matches);
    const payout = Math.floor(game.bet * mult);
    settle(game.userId, game.bet, payout);

    const container = buildResultContainer(game, draw, matches, mult, payout);
    return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('keno')
        .setDescription('Pick numbers 1–40 — the bot draws 10. Match more = bigger payout.')
        .addStringOption(o => o.setName('bet').setDescription('Bet amount (max 100k) or "all"').setRequired(true)),

    prefix: 'keno',
    aliases: ['kn'],
    description: 'Lottery-style number-picking game. Up to 1000× jackpot on a 10-pick perfect match.',
    usage: 'keno <bet>',
    category: 'economy',

    handleKenoInteraction,

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const amount = interaction.options.getString('bet');
        await handleKeno((opts) => interaction.reply(opts), interaction.user.id, [amount], interaction.guild?.id);
    },

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        await handleKeno((opts) => message.reply(opts), message.author.id, args, message.guild?.id);
    },
};
