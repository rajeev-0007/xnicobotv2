'use strict';

/**
 * Minesweeper — bet on revealing safe tiles, cash out for a multiplier.
 *
 * Flow
 * ────
 *   1. `mines <bet>` opens a SETUP panel:
 *        • Grid Size select   (3×3 / 4×4 / 5×4 / 5×5 / 5×6)
 *        • Risk Level select  (Safe / Low / Medium / Hard / Extreme / Nightmare)
 *        • [Start Game] button — disabled until both picks are made
 *        • [Cancel] button     — discards the setup with no charge
 *   2. Pressing **Start Game** deducts the bet, generates the board,
 *      and switches to the live game panel.
 *   3. Each safe tile bumps the multiplier; cash out any time.
 *      Hitting a mine ends the round and reveals the full board.
 *   4. If the player walks away, the round auto-cashes-out at the
 *      current multiplier so the bet is never silently consumed.
 *
 * Custom emojis only — every glyph in this command resolves to a real
 * `<:Name:Id>` from the bot's emoji set, so Discord never rejects the
 * payload with INVALID_FORM_BODY: emoji.
 */

const {
    SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, MessageFlags
} = require('discord.js');
const { formatCoins, coinIcon, coinEmoji, formatCoinsAmount } = require('../../utils/currencyHelper');
const {
    createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize
} = require('../../utils/componentHelpers');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const economyManager = require('../../utils/economyManager');

/* ═══════════════════════════════════════════════════════════════════
   CUSTOM EMOJI SET — every visual element references a real custom
   emoji on the bot's home server. Falls back gracefully via the
   emojiGuard sanitizer if any ever go missing.
   ═══════════════════════════════════════════════════════════════════ */
const E = {
    title:    '<:Lightning:1521227915537285150>',
    gem:      '<:Sketch:1521228025365004471>',
    mine:     '<:Cancel:1521227723916181644>',
    success:  '<:Checkedbox:1521227734943269077>',
    info:     '<:Inforect:1521228008285929532>',
    warn:     '<:Infotriangle:1521227710381428926>',
    // Coin icon is per-guild — use coinIcon(guildId) at render sites.
    sandwatch:'<:Sandwatch:1521228272426418367>',
    settings: '<:Settings:1521227767780343879>',
    skipnext: '<:Caretright:1521227704953864202>',
    grid:     '<:Box:1521228152414666833>',
    star:     '<:Star:1521227981685526568>',
    chart:    '<:transfer:1521228019824590948>',
    history:  '<:History:1521227863079256278>',
    shield:   '<:Shield:1521227694677692467>',
    fire:     '<:Fire:1521227907647668374>',
    award:    '<:Award:1521228119640375336>',
    caret:    '<:Caretright:1521227704953864202>',
    lightning:'<:Lightning:1521227915537285150>',
};

// Visually distinct emojis for each risk tier so the dropdown isn't a
// row of identical bullets. Falls back to caret if a custom one ever
// goes missing on the home guild.
const RISK_EMOJI = {
    safe:      E.shield,
    low:       E.success,
    medium:    E.star,
    hard:      E.fire,
    extreme:   E.lightning,
    nightmare: E.mine,
};

/* ═══════════════════════════════════════════════════════════════════
   GAME CONFIG — 5 grid sizes × 6 risk levels = 30 stages
   ═══════════════════════════════════════════════════════════════════ */

// Discord limits each ActionRow to 5 components, so cols must always be ≤ 5.
// `5x6` (6 rows × 5 cols) keeps the 30-tile grid valid; flipping to >5 cols
// would crash with INVALID_FORM_BODY: BASE_TYPE_BAD_LENGTH.
//
// IMPORTANT: a Components V2 container is itself capped at 10 child
// components. The live game container budget per render is:
//   header (1) + separator (1) + grid rows (≤6) + cashout row (1) = ≤9
// Loss/win render swaps the cashout row for a balance line, so the
// max ever required is 6 rows + 3 misc components = 9 — within budget.
const GRIDS = {
    '3x3': { rows: 3, cols: 3, total: 9,  label: '3 × 3 (9 tiles)',  emoji: E.grid },
    '4x4': { rows: 4, cols: 4, total: 16, label: '4 × 4 (16 tiles)', emoji: E.grid },
    '5x4': { rows: 4, cols: 5, total: 20, label: '5 × 4 (20 tiles)', emoji: E.grid },
    '5x5': { rows: 5, cols: 5, total: 25, label: '5 × 5 (25 tiles)', emoji: E.grid },
    '5x6': { rows: 6, cols: 5, total: 30, label: '5 × 6 (30 tiles)', emoji: E.grid },
};

const RISKS = {
    safe: {
        mines: { '3x3': 1, '4x4': 1,  '5x4': 1,  '5x5': 2,  '5x6': 2  },
        label: 'Safe',
        emoji: RISK_EMOJI.safe,
        color: 0x10B981,
        desc: 'Smallest payout, lowest risk',
    },
    low: {
        mines: { '3x3': 1, '4x4': 3,  '5x4': 4,  '5x5': 5,  '5x6': 6  },
        label: 'Low',
        emoji: RISK_EMOJI.low,
        color: 0x57F287,
        desc: 'Few mines, modest multiplier',
    },
    medium: {
        mines: { '3x3': 2, '4x4': 5,  '5x4': 7,  '5x5': 8,  '5x6': 10 },
        label: 'Medium',
        emoji: RISK_EMOJI.medium,
        color: 0xFEE75C,
        desc: 'Balanced mines and reward',
    },
    hard: {
        mines: { '3x3': 3, '4x4': 7,  '5x4': 10, '5x5': 12, '5x6': 15 },
        label: 'Hard',
        emoji: RISK_EMOJI.hard,
        color: 0xF97316,
        desc: 'Many mines, high multiplier',
    },
    extreme: {
        mines: { '3x3': 4, '4x4': 9,  '5x4': 13, '5x5': 16, '5x6': 20 },
        label: 'Extreme',
        emoji: RISK_EMOJI.extreme,
        color: 0xED4245,
        desc: 'Very few safe tiles, top payouts',
    },
    nightmare: {
        mines: { '3x3': 5, '4x4': 11, '5x4': 16, '5x5': 20, '5x6': 25 },
        label: 'Nightmare',
        emoji: RISK_EMOJI.nightmare,
        color: 0x8B0000,
        desc: 'Insane risk, jackpot multiplier',
    },
};

// House edge — tuned so the bot keeps a small statistical advantage
// over time without making early reveals feel pointless. 5% edge is
// the same value the rest of our economy games use (limbo / crash).
const HOUSE_EDGE = 0.05;

/** Active games + setups keyed by userId. */
const activeGames = new Map();

/* ═══════════════════════════════════════════════════════════════════
   PURE GAME LOGIC
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Calculate the fair-odds multiplier for revealing `revealed` safe
 * tiles on a board with `total` total tiles and `mines` mines.
 *
 * Formula:
 *     P(safe streak) = ∏(i=0..n-1) (total - mines - i) / (total - i)
 *     multiplier      = (1 - houseEdge) / P(safe streak)
 *
 * This makes the EV slightly negative (house edge) regardless of grid
 * size or risk tier — the previous `pow(base, revealed)` formula
 * ignored the actual mine count and made high-risk small grids
 * massively player-favoured (3×3 nightmare paid 625× at 4 reveals
 * when the fair value is ~120×).
 */
function calculateMultiplier(revealed, gridKey, riskKey) {
    if (revealed <= 0) return 1;
    const grid = GRIDS[gridKey];
    const risk = RISKS[riskKey];
    if (!grid || !risk) return 1;
    const mines = risk.mines[gridKey];
    if (mines == null) return 1;

    const safeTiles = grid.total - mines;
    if (revealed > safeTiles) revealed = safeTiles;

    let probability = 1;
    for (let i = 0; i < revealed; i++) {
        const numerator = safeTiles - i;
        const denominator = grid.total - i;
        if (numerator <= 0 || denominator <= 0) {
            // Should never happen given the clamp above, but guard
            // against div-by-zero on degenerate boards anyway.
            return 1;
        }
        probability *= numerator / denominator;
    }

    // Cap at 1000× so a single jackpot can't drain the economy table
    // — the highest fair payout (5×6 nightmare, full clear) is
    // already astronomically rare and effectively unreachable.
    const raw = (1 - HOUSE_EDGE) / probability;
    return Math.min(1000, Math.round(raw * 100) / 100);
}

function generateBoard(gridKey, risk) {
    const grid = GRIDS[gridKey];
    const mineCount = RISKS[risk].mines[gridKey];
    const board = Array(grid.total).fill(false);

    // Fisher-Yates style placement — guarantees exactly `mineCount`
    // distinct mines without the rejection-loop's worst-case spin
    // when mines fill most of the board (e.g. 5×6 nightmare = 25/30
    // mines, where the original loop could iterate hundreds of
    // times before finding the 25th empty slot).
    const indices = Array.from({ length: grid.total }, (_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    for (let i = 0; i < mineCount; i++) board[indices[i]] = true;
    return board;
}

/* ═══════════════════════════════════════════════════════════════════
   UI BUILDERS
   ═══════════════════════════════════════════════════════════════════ */

function buildGameGrid(game, reveal = false) {
    const grid = GRIDS[game.gridKey];
    const rows = [];

    for (let r = 0; r < grid.rows; r++) {
        const row = new ActionRowBuilder();
        for (let c = 0; c < grid.cols; c++) {
            const idx = r * grid.cols + c;
            const isRevealed = game.revealed.has(idx);
            const isMine = game.board[idx];

            let btn;
            if (reveal && isMine) {
                // End-of-round mine reveal
                btn = new ButtonBuilder()
                    .setCustomId(`mines_${game.userId}_${idx}`)
                    .setEmoji(E.mine)
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(true);
            } else if (reveal && !isMine && !isRevealed) {
                // End-of-round: show safe tiles the player missed
                // so they can see what would have been theirs.
                btn = new ButtonBuilder()
                    .setCustomId(`mines_${game.userId}_${idx}`)
                    .setEmoji(E.gem)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true);
            } else if (isRevealed) {
                btn = new ButtonBuilder()
                    .setCustomId(`mines_${game.userId}_${idx}`)
                    .setEmoji(E.gem)
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true);
            } else if (game.ended) {
                btn = new ButtonBuilder()
                    .setCustomId(`mines_${game.userId}_${idx}`)
                    .setLabel('·')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true);
            } else {
                btn = new ButtonBuilder()
                    .setCustomId(`mines_${game.userId}_${idx}`)
                    .setLabel('·')
                    .setStyle(ButtonStyle.Secondary);
            }
            row.addComponents(btn);
        }
        rows.push(row);
    }

    return rows;
}

/**
 * Builds the action row(s) below the live grid: the cashout button.
 * Returned as a separate function so the live and end-state renders
 * can decide whether to append it without juggling row indexes inside
 * `buildGameGrid`.
 *
 * The cashout button is *always* present during a live game so the
 * player has a clear, predictable "exit" they can find at a glance —
 * even before the first reveal. When no tiles are revealed yet it is
 * disabled with a hint label, instead of being hidden entirely (the
 * old behaviour, which made players think the button was missing).
 */
function buildCashoutRow(game) {
    if (game.ended) return null;

    const revealed = game.revealed.size;
    const mult = revealed > 0
        ? calculateMultiplier(revealed, game.gridKey, game.risk)
        : 1;
    const payout = Math.floor(game.bet * mult);

    const cashoutBtn = new ButtonBuilder()
        .setCustomId(`mines_${game.userId}_cashout`)
        .setStyle(ButtonStyle.Primary);

    if (revealed === 0) {
        cashoutBtn
            .setLabel('Cash Out · pick a tile first')
            .setDisabled(true);
    } else {
        cashoutBtn
            .setLabel(`Cash Out · ${mult}x = ${formatNumber(payout)}`)
            .setDisabled(false);
    }

    const safeIcon = coinEmoji(game.guildId);
    if (safeIcon) cashoutBtn.setEmoji(safeIcon);
    return new ActionRowBuilder().addComponents(cashoutBtn);
}

function buildGameContainer(game, status = 'playing') {
    const multiplier = calculateMultiplier(game.revealed.size, game.gridKey, game.risk);
    const potential  = Math.floor(game.bet * multiplier);
    const riskInfo   = RISKS[game.risk];
    const gridInfo   = GRIDS[game.gridKey];
    const mineCount  = riskInfo.mines[game.gridKey];
    const safeTotal  = gridInfo.total - mineCount;

    let color = riskInfo.color;
    let statusText = '';

    if (status === 'playing') {
        // Probability the *next* reveal is safe — gives the player a
        // live read on whether to push or cash out. Without this the
        // multiplier feels arbitrary and high-risk grids look more
        // punishing than they actually are.
        const remainingSafe = safeTotal - game.revealed.size;
        const remainingTotal = gridInfo.total - game.revealed.size;
        const nextSafePct = remainingTotal > 0
            ? Math.round((remainingSafe / remainingTotal) * 100)
            : 0;
        // Multiplier you'd reach if you reveal one more safe tile.
        const nextMult = calculateMultiplier(game.revealed.size + 1, game.gridKey, game.risk);

        statusText = [
            `> ${E.gem} **Revealed:** \`${game.revealed.size}\` / \`${safeTotal}\` safe tiles`,
            `> ${E.chart} **Multiplier:** \`${multiplier}x\`  ·  next reveal → \`${nextMult}x\``,
            `> ${E.shield} **Next safe:** \`${nextSafePct}%\`  ·  -# ${remainingSafe} safe / ${remainingTotal} remaining`,
            `> ${coinIcon(game.guildId)} **Cash out value:** ${formatCoinsAmount(potential, game.guildId)}`,
        ].join('\n');
    } else if (status === 'won') {
        color = 0x57F287;
        const profit = potential - game.bet;
        statusText = [
            `> ${E.success} **Cashed out at \`${multiplier}x\`!**`,
            `> ${coinIcon(game.guildId)} **Won:** ${formatCoinsAmount(potential, game.guildId)} *(profit +${formatNumber(profit)})*`,
        ].join('\n');
    } else if (status === 'lost') {
        color = 0xED4245;
        statusText = [
            `> ${E.mine} **BOOM! You hit a mine.**`,
            `> ${coinIcon(game.guildId)} **Lost:** ${formatCoinsAmount(game.bet, game.guildId)}`,
        ].join('\n');
    } else if (status === 'expired') {
        color = 0x6b7280;
        statusText = [
            `> ${E.sandwatch} **Round timed out — auto cashed out.**`,
            `> ${coinIcon(game.guildId)} **Returned:** ${formatCoinsAmount(potential, game.guildId)}  *(${multiplier}x)*`,
        ].join('\n');
    }

    const container = createContainer(color);
    addTextDisplay(container, [
        `# ${E.title} Minesweeper`,
        `-# ${gridInfo.emoji} ${gridInfo.label}  ·  ${riskInfo.emoji} **${riskInfo.label}** risk  ·  ${E.mine} \`${mineCount}\` mines`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
        '',
        statusText,
    ].join('\n'));

    return container;
}

function buildSetupContainer(userId) {
    const game = activeGames.get(userId);
    if (!game) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `${E.mine} Setup expired. Run \`mines <bet>\` again.`);
        return c;
    }

    const ready = !!(game.gridKey && game.risk);
    const accent = ready ? 0x57F287 : 0xCAD7E6;

    const summaryLines = [
        `# ${E.title} Minesweeper — Setup`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
    ];

    if (game.gridKey) {
        summaryLines.push(`> ${GRIDS[game.gridKey].emoji} **Grid:** ${GRIDS[game.gridKey].label}`);
    }
    if (game.risk) {
        const r = RISKS[game.risk];
        const mineCount = game.gridKey ? r.mines[game.gridKey] : '?';
        summaryLines.push(`> ${r.emoji} **Risk:** ${r.label}  ·  mines: \`${mineCount}\``);
    }

    // Show a tiny payout preview when both are picked.
    if (ready) {
        const safeTotal = GRIDS[game.gridKey].total - RISKS[game.risk].mines[game.gridKey];
        const previewReveals = Math.min(3, safeTotal);
        const previewMult = calculateMultiplier(previewReveals, game.gridKey, game.risk);
        summaryLines.push(`> ${E.chart} **First ${previewReveals} reveals:** \`${previewMult}x\``);
    }

    summaryLines.push('');
    summaryLines.push(ready
        ? `${E.success} Configuration locked. Press **Start Game** when ready.`
        : `${E.info} Pick a **grid size** and **risk level** below to enable Start.`);

    const container = createContainer(accent);
    addTextDisplay(container, summaryLines.join('\n'));
    addSeparator(container, SeparatorSpacingSize.Small);

    /* ── Grid Size select ─────────────────────────────────────────── */
    const gridOptions = Object.entries(GRIDS).map(([key, g]) => ({
        label: g.label,
        value: key,
        description: `${g.total} tiles total`,
        emoji: g.emoji,
        default: game.gridKey === key,
    }));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`mines_setup_grid_${userId}`)
            .setPlaceholder(game.gridKey ? `Grid · ${GRIDS[game.gridKey].label}` : 'Select grid size…')
            .addOptions(gridOptions)
    ));

    /* ── Risk Level select ────────────────────────────────────────── */
    const riskOptions = Object.entries(RISKS).map(([key, r]) => ({
        label: `${r.label} Risk`,
        value: key,
        description: r.desc,
        emoji: r.emoji,
        default: game.risk === key,
    }));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`mines_setup_risk_${userId}`)
            .setPlaceholder(game.risk ? `Risk · ${RISKS[game.risk].label}` : 'Select risk level…')
            .addOptions(riskOptions)
    ));

    /* ── Start / Cancel buttons ───────────────────────────────────── */
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`mines_setup_start_${userId}`)
            .setLabel('Start Game')
            .setEmoji(E.skipnext)
            .setStyle(ButtonStyle.Success)
            .setDisabled(!ready),
        new ButtonBuilder()
            .setCustomId(`mines_setup_cancel_${userId}`)
            .setLabel('Cancel')
            .setEmoji(E.mine)
            .setStyle(ButtonStyle.Secondary),
    ));

    return container;
}

/* ═══════════════════════════════════════════════════════════════════
   COMMAND ENTRY (prefix + slash share this)
   ═══════════════════════════════════════════════════════════════════ */

async function handleMines(reply, userId, args, guildId) {
    if (activeGames.has(userId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, `${E.warn} You already have an active mines session. Finish or cancel it first.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const balance = getBalance(userId);
    const betResult = parseBet(args[0], balance);

    if (!betResult.valid) {
        // parseBet already returns a fully-formed payload — surface it
        // so the user sees the exact reason (no balance, > MAX_BET, …)
        return reply(betResult.error);
    }

    const bet = betResult.amount;

    activeGames.set(userId, {
        phase: 'setup',
        bet,
        guildId: guildId || null,
        gridKey: null,
        risk: null,
        userId,
        timestamp: Date.now(),
    });

    // Auto-expire setup after 90s. The bet hasn't been deducted at
    // this point, so simply dropping the entry is safe.
    const setupTimer = setTimeout(() => {
        const g = activeGames.get(userId);
        if (g && g.phase === 'setup') activeGames.delete(userId);
    }, 90_000);
    if (setupTimer.unref) setupTimer.unref();
    activeGames.get(userId)._setupTimer = setupTimer;

    return reply({
        components: [buildSetupContainer(userId)],
        flags: MessageFlags.IsComponentsV2,
    });
}

/* ═══════════════════════════════════════════════════════════════════
   INTERACTION ROUTER (buttons + select menus)
   ═══════════════════════════════════════════════════════════════════ */

async function handleMinesInteraction(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('mines_')) return false;

    const userId = interaction.user.id;

    // ── Setup-phase actions share `mines_setup_<action>_<userId>` ──
    // The userId is the *3rd* segment after splitting on `_`. We use
    // index 3 (rather than slicing the full tail) because the action
    // names are single tokens (grid/risk/start/cancel).
    const setupMatch = customId.match(/^mines_setup_(grid|risk|start|cancel)_(\d+)$/);
    if (setupMatch) {
        const action = setupMatch[1];
        const targetUser = setupMatch[2];
        if (userId !== targetUser) {
            return interaction.reply({
                content: `${E.mine} Not your game!`,
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'setup') {
            return interaction.reply({
                content: `${E.mine} Setup expired. Run \`mines <bet>\` again.`,
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }

        if (action === 'grid') {
            game.gridKey = interaction.values?.[0] || game.gridKey;
            return interaction.update({
                components: [buildSetupContainer(userId)],
                flags: MessageFlags.IsComponentsV2,
            });
        }
        if (action === 'risk') {
            game.risk = interaction.values?.[0] || game.risk;
            return interaction.update({
                components: [buildSetupContainer(userId)],
                flags: MessageFlags.IsComponentsV2,
            });
        }
        if (action === 'cancel') {
            clearTimeout(game._setupTimer);
            activeGames.delete(userId);
            const c = createContainer(0x6b7280);
            addTextDisplay(c, `# ${E.mine} Setup Cancelled\n\nNo coins were charged.`);
            return interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
        if (action === 'start') {
            if (!game.gridKey || !game.risk) {
                return interaction.reply({
                    content: `${E.warn} Pick both grid size and risk first.`,
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
            }
            return startGame(interaction, game);
        }
        return true;
    }

    // ── Live game: `mines_<userId>_<idx|cashout>` ──
    const liveMatch = customId.match(/^mines_(\d+)_(cashout|\d+)$/);
    if (liveMatch) {
        const targetUser = liveMatch[1];
        const action = liveMatch[2];

        if (userId !== targetUser) {
            return interaction.reply({
                content: `${E.mine} Not your game!`,
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'playing') {
            return interaction.reply({
                content: `${E.mine} No active game.`,
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }

        if (action === 'cashout') return cashOut(interaction, game, 'won');

        const tileIdx = parseInt(action, 10);
        if (isNaN(tileIdx) || tileIdx < 0 || tileIdx >= game.board.length) {
            return interaction.deferUpdate().catch(() => {});
        }
        return revealTile(interaction, game, tileIdx);
    }

    return false;
}

/* ═══════════════════════════════════════════════════════════════════
   GAME LIFECYCLE
   ═══════════════════════════════════════════════════════════════════ */

async function startGame(interaction, game) {
    clearTimeout(game._setupTimer);

    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, game.userId);

    if (userData.coins < game.bet) {
        activeGames.delete(game.userId);
        const c = createContainer(0xED4245);
        addTextDisplay(c, `${E.mine} Not enough coins. Balance: ${formatCoins(userData.coins, game.guildId)}`);
        return interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    userData.coins -= game.bet;
    userData.totalGambled = (userData.totalGambled || 0) + game.bet;
    economyManager.saveEconomy(economy);

    game.phase     = 'playing';
    game.board     = generateBoard(game.gridKey, game.risk);
    game.revealed  = new Set();
    game.totalSafe = game.board.filter(x => !x).length;
    game.ended     = false;

    // Auto-cashout after 3 minutes of inactivity. We *cash out at the
    // current multiplier* rather than silently consuming the bet —
    // the original implementation dropped the game and left the user
    // out of pocket if they walked away mid-round.
    game.expireTimer = setTimeout(async () => {
        const live = activeGames.get(game.userId);
        if (!live || live.ended || live._cashedOut) return;
        try {
            // No interaction available here — settle silently.
            await settleAutoCashout(live);
        } catch { /* logged inside settleAutoCashout */ }
    }, 180_000);
    if (game.expireTimer.unref) game.expireTimer.unref();

    const container = buildGameContainer(game, 'playing');
    addSeparator(container, SeparatorSpacingSize.Small);
    for (const row of buildGameGrid(game)) container.addActionRowComponents(row);
    const cashoutRow = buildCashoutRow(game);
    if (cashoutRow) container.addActionRowComponents(cashoutRow);

    try {
        return await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } catch (err) {
        // If we can't render the live panel (interaction token expired,
        // network blip, message deleted), refund the bet rather than
        // leaving the user paying for a game they can't play.
        console.error('[MINES] startGame render failed, refunding:', err);
        try {
            const eco = economyManager.loadEconomy();
            const { userData: ud } = economyManager.getUser(eco, game.userId);
            ud.coins += game.bet;
            ud.totalGambled = Math.max(0, (ud.totalGambled || 0) - game.bet);
            economyManager.saveEconomy(eco);
        } catch {}
        clearTimeout(game.expireTimer);
        activeGames.delete(game.userId);
        return null;
    }
}

async function revealTile(interaction, game, tileIdx) {
    if (game.ended) return interaction.deferUpdate().catch(() => {});
    if (game.revealed.has(tileIdx)) return interaction.deferUpdate().catch(() => {});
    if (game._processing) return interaction.deferUpdate().catch(() => {});

    game._processing = true;
    try {
        const isMine = game.board[tileIdx];

        if (isMine) {
            game.ended = true;
            game.revealed.add(tileIdx);
            clearTimeout(game.expireTimer);
            activeGames.delete(game.userId);

            const economy = economyManager.loadEconomy();
            const { userData } = economyManager.getUser(economy, game.userId);
            userData.totalLost = (userData.totalLost || 0) + game.bet;
            economyManager.addXP(economy, game.userId, 2);
            // Achievement check runs on every settle so milestones
            // like "gambler" (1M total wagered) fire on losses too —
            // the previous version only checked on win, which meant a
            // user who lost the qualifying bet never got the badge.
            economyManager.checkAllAchievements(economy, game.userId);
            economyManager.saveEconomy(economy);

            const container = buildGameContainer(game, 'lost');
            addSeparator(container, SeparatorSpacingSize.Small);
            addTextDisplay(container, `${coinIcon(game.guildId)} **Balance:** ${formatCoinsAmount(userData.coins, game.guildId)}`);
            for (const row of buildGameGrid(game, true)) container.addActionRowComponents(row);

            return await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        game.revealed.add(tileIdx);

        // Auto cash-out when every safe tile is revealed. Pass
        // `internal: true` so cashOut doesn't re-acquire the
        // `_processing` lock we already hold here — otherwise it
        // would short-circuit and silently skip the payout.
        if (game.revealed.size >= game.totalSafe) {
            return await cashOut(interaction, game, 'won', { internal: true });
        }

        const container = buildGameContainer(game, 'playing');
        addSeparator(container, SeparatorSpacingSize.Small);
        for (const row of buildGameGrid(game)) container.addActionRowComponents(row);
        const cashoutRow = buildCashoutRow(game);
        if (cashoutRow) container.addActionRowComponents(cashoutRow);

        return await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } catch (err) {
        // Recover gracefully from race conditions (interaction already
        // acked, network blip, etc.) without leaving `_processing`
        // stuck on true.
        try { await interaction.deferUpdate().catch(() => {}); } catch {}
        throw err;
    } finally {
        game._processing = false;
    }
}

async function cashOut(interaction, game, status = 'won', { internal = false } = {}) {
    // Guard against stacked clicks: a user spamming Cash Out, or a
    // tile click that's mid-flight when Cash Out lands. The
    // `_processing` flag is shared with `revealTile`, so neither
    // can interleave with the other.
    //
    // The `internal` option lets `revealTile` call into us as the
    // tail of an auto-clear without tripping its own _processing
    // guard — it has already locked, validated and committed the
    // safe-tile reveal that triggered the auto-cashout.
    if (game.ended || game._cashedOut) {
        return interaction.deferUpdate().catch(() => {});
    }
    if (!internal && game._processing) {
        return interaction.deferUpdate().catch(() => {});
    }
    if (game.revealed.size === 0) {
        // The button should be disabled in this case, but defend
        // against custom-id replays from the network anyway.
        return interaction.reply({
            content: `${E.warn} Reveal at least one tile before cashing out.`,
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});
    }

    if (!internal) game._processing = true;
    game._cashedOut = true;
    game.ended = true;
    clearTimeout(game.expireTimer);
    activeGames.delete(game.userId);

    try {
        const multiplier = calculateMultiplier(game.revealed.size, game.gridKey, game.risk);
        const payout = Math.floor(game.bet * multiplier);
        const profit = payout - game.bet;

        const economy = economyManager.loadEconomy();
        const { userData } = economyManager.getUser(economy, game.userId);
        userData.coins += payout;
        // Track lifetime earnings the same way fish/hunt/scratch/battle do
        // so the /profile and /economystats cards stay consistent — the
        // previous version skipped this and mines wins never showed up
        // under "lifetime earned".
        if (payout > 0) {
            userData.totalEarned = (userData.totalEarned || 0) + payout;
        }
        if (profit > 0) {
            userData.totalWon = (userData.totalWon || 0) + profit;
        }
        // Cap the XP reward so a fully-cleared 5×6 board doesn't
        // mass-grant levels in one round.
        economyManager.addXP(economy, game.userId, Math.min(20, game.revealed.size * 2));
        economyManager.checkAllAchievements(economy, game.userId);
        economyManager.saveEconomy(economy);

        const container = buildGameContainer(game, status);
        addSeparator(container, SeparatorSpacingSize.Small);
        addTextDisplay(container,
            `${coinIcon(game.guildId)} **Balance:** ${formatCoinsAmount(userData.coins, game.guildId)}\n`
            + `-# Revealed ${game.revealed.size}/${game.totalSafe} safe tiles`);
        for (const row of buildGameGrid(game, true)) container.addActionRowComponents(row);

        return await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } finally {
        // Always release the lock if we acquired it. `revealTile`'s
        // own finally block clears `_processing` for the internal
        // call path so we don't double-release here.
        if (!internal) game._processing = false;
    }
}

/**
 * Auto-cashout triggered by the inactivity timer. No interaction is
 * available, so we just credit the user and clear state — the next
 * thing they see is whatever they had already cashed in their wallet.
 *
 * If the user revealed zero tiles, we refund the bet (multiplier = 1
 * because of the early-return in `calculateMultiplier`).
 */
async function settleAutoCashout(game) {
    if (game.ended || game._cashedOut) return;
    game._cashedOut = true;
    game.ended = true;
    activeGames.delete(game.userId);

    const multiplier = calculateMultiplier(game.revealed.size, game.gridKey, game.risk);
    const payout = Math.floor(game.bet * multiplier);
    const profit = payout - game.bet;

    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, game.userId);
    userData.coins += payout;
    if (payout > 0) userData.totalEarned = (userData.totalEarned || 0) + payout;
    if (profit > 0) userData.totalWon = (userData.totalWon || 0) + profit;
    economyManager.checkAllAchievements(economy, game.userId);
    economyManager.saveEconomy(economy);
}

/* ═══════════════════════════════════════════════════════════════════
   MODULE EXPORT
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mines')
        .setDescription('Play minesweeper — reveal tiles without hitting mines')
        .addStringOption(o => o
            .setName('bet')
            .setDescription('Bet amount (max 100k) or "all"')
            .setRequired(true)),

    prefix: 'mines',
    description: 'Minesweeper gambling — pick grid + risk, reveal tiles, cash out anytime.',
    usage: 'mines <bet>',
    category: 'economy',
    aliases: ['minesweeper', 'ms'],

    handleMinesInteraction,

    // Exposed for unit tests / external tooling.
    _internal: {
        calculateMultiplier,
        generateBoard,
        GRIDS,
        RISKS,
        HOUSE_EDGE,
    },

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const amount = interaction.options.getString('bet');
        await handleMines(
            (opts) => interaction.reply(opts),
            interaction.user.id,
            [amount],
            interaction.guild?.id
        );
    },

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        await handleMines(
            (opts) => message.reply(opts),
            message.author.id,
            args,
            message.guild?.id
        );
    },
};
