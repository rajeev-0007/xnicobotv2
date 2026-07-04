'use strict';

/**
 * Tower — climb a tower one floor at a time. Each floor has N tiles
 * (3 / 4 / 5 depending on difficulty); one or more are mines. Pick
 * the safe tile to advance. Cash out anytime to lock in winnings.
 *
 * Difficulty
 * ──────────
 *   Easy   — 4 tiles per floor, 1 mine, 8 floors  (max ~6×)
 *   Medium — 3 tiles per floor, 1 mine, 8 floors  (max ~25×)
 *   Hard   — 4 tiles per floor, 2 mines, 8 floors (max ~256×)
 *   Expert — 3 tiles per floor, 2 mines, 8 floors (max ~6500×)
 *
 *   Multiplier per floor = (tiles / safeCount), so each floor's
 *   multiplier compounds. Reaching the top auto-cashes out.
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
const { deductBet, settle } = require('../../utils/betGameHelper');

const E = {
    title:    '<:Lightning:1521227915537285150>',
    floor:    '<:Box:1521228152414666833>',
    safe:     '<:Sketch:1521228025365004471>',
    mine:     '<:Cancel:1521227723916181644>',
    success:  '<:Checkedbox:1521227734943269077>',
    fail:     '<:Cancel:1521227723916181644>',
    info:     '<:Inforect:1521228008285929532>',
    warn:     '<:Infotriangle:1521227710381428926>',
    // Coin icon is per-guild — see coinIcon(guildId). Don't bake one in.
    chart:    '<:transfer:1521228019824590948>',
    skipnext: '<:Caretright:1521227704953864202>',
    crown:    '<:Crown:1521227739988889764>',
    riskLow:  '<:Caretright:1521227704953864202>',
    riskMed:  '<:Caretright:1521227704953864202>',
    riskHigh: '<:Caretright:1521227704953864202>',
    riskMax: '<:Caretright:1521227704953864202>',
};

const TOTAL_FLOORS = 8;

const DIFFICULTIES = {
    easy: {
        label: 'Easy',  emoji: E.riskLow,  color: 0x57F287,
        tiles: 4, mines: 1,
        desc: '4 tiles · 1 mine per floor · max ~6×',
    },
    medium: {
        label: 'Medium', emoji: E.riskMed, color: 0xFEE75C,
        tiles: 3, mines: 1,
        desc: '3 tiles · 1 mine per floor · max ~25×',
    },
    hard: {
        label: 'Hard',   emoji: E.riskHigh, color: 0xF97316,
        tiles: 4, mines: 2,
        desc: '4 tiles · 2 mines per floor · max ~256×',
    },
    expert: {
        label: 'Expert', emoji: E.riskMax,  color: 0xED4245,
        tiles: 3, mines: 2,
        desc: '3 tiles · 2 mines per floor · max ~6500×',
    },
};

const activeGames = new Map();

/* ═══════════════════════════════════════════════════════════════════
   PURE LOGIC
   ═══════════════════════════════════════════════════════════════════ */

function generateTower(difficulty) {
    const d = DIFFICULTIES[difficulty];
    const floors = [];
    for (let f = 0; f < TOTAL_FLOORS; f++) {
        const tiles = Array(d.tiles).fill(false);
        let placed = 0;
        while (placed < d.mines) {
            const idx = Math.floor(Math.random() * d.tiles);
            if (!tiles[idx]) { tiles[idx] = true; placed++; }
        }
        floors.push(tiles);
    }
    return floors;
}

function multiplierForFloor(difficulty, floorsCleared) {
    const d = DIFFICULTIES[difficulty];
    const safe = d.tiles - d.mines;
    // Compound multiplier per cleared floor with a tiny house edge (0.97).
    const raw = Math.pow(d.tiles / safe, floorsCleared) * 0.97;
    return Math.round(raw * 100) / 100;
}

/* ═══════════════════════════════════════════════════════════════════
   UI
   ═══════════════════════════════════════════════════════════════════ */

function buildSetupContainer(userId) {
    const game = activeGames.get(userId);
    if (!game) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `${E.fail} Setup expired. Run \`tower <bet>\` again.`);
        return c;
    }

    const ready = !!game.difficulty;
    const accent = game.difficulty ? DIFFICULTIES[game.difficulty].color : 0xCAD7E6;

    const lines = [
        `# ${E.title} Tower — Setup`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
    ];
    if (game.difficulty) {
        const d = DIFFICULTIES[game.difficulty];
        const maxMult = multiplierForFloor(game.difficulty, TOTAL_FLOORS);
        lines.push(`> ${d.emoji} **Difficulty:** ${d.label} · ${d.tiles} tiles · ${d.mines} mine${d.mines > 1 ? 's' : ''}`);
        lines.push(`> ${E.crown} **Top floor pays:** \`${maxMult}x\``);
    }

    lines.push('');
    lines.push(ready
        ? `${E.success} Ready! Press **Start Game** to enter the tower.`
        : `${E.info} Pick a difficulty below to enable Start.`);

    const container = createContainer(accent);
    addTextDisplay(container, lines.join('\n'));
    addSeparator(container, SeparatorSpacingSize.Small);

    const opts = Object.entries(DIFFICULTIES).map(([key, d]) => {
        const maxMult = multiplierForFloor(key, TOTAL_FLOORS);
        return {
            label: `${d.label} · max ${maxMult}x`,
            value: key,
            description: d.desc,
            emoji: d.emoji,
            default: game.difficulty === key,
        };
    });
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`tower_setup_diff_${userId}`)
            .setPlaceholder(game.difficulty ? `Difficulty · ${DIFFICULTIES[game.difficulty].label}` : 'Pick difficulty…')
            .addOptions(opts)
    ));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`tower_setup_start_${userId}`)
            .setLabel('Start Game')
            .setEmoji(E.skipnext)
            .setStyle(ButtonStyle.Success)
            .setDisabled(!ready),
        new ButtonBuilder()
            .setCustomId(`tower_setup_cancel_${userId}`)
            .setLabel('Cancel')
            .setEmoji(E.fail)
            .setStyle(ButtonStyle.Secondary),
    ));

    return container;
}

function buildLiveContainer(game, status, info = {}) {
    const d = DIFFICULTIES[game.difficulty];
    const currentFloor = game.floorIdx;       // next floor to clear, 0-indexed
    const currentMult = multiplierForFloor(game.difficulty, currentFloor);
    const nextMult = multiplierForFloor(game.difficulty, currentFloor + 1);
    const potential = Math.floor(game.bet * currentMult);

    let header, color;
    if (status === 'climbing') {
        header = `${E.info} **Floor ${currentFloor + 1} / ${TOTAL_FLOORS}** — pick the safe tile!`;
        color = d.color;
    } else if (status === 'won') {
        header = `${E.success} **Cashed out at floor ${currentFloor}** → \`${currentMult}x\` · +${formatNumber(potential - game.bet)} profit`;
        color = 0x57F287;
    } else if (status === 'lost') {
        header = `${E.mine} **Hit a mine on floor ${currentFloor + 1}** → lost ${formatCoins(game.bet, game.guildId)}`;
        color = 0xED4245;
    } else if (status === 'topped') {
        header = `${E.crown} **Reached the top!** \`${currentMult}x\` · +${formatNumber(potential - game.bet)} profit`;
        color = 0xA855F7;
    }

    const lines = [
        `# ${E.title} Tower of Risk`,
        `-# ${d.emoji} ${d.label}  ·  ${d.tiles} tiles · ${d.mines} mine${d.mines > 1 ? 's' : ''} per floor`,
        '',
        `> ${coinIcon(game.guildId)} **Bet:** ${formatCoinsAmount(game.bet, game.guildId)}`,
        `> ${E.chart} **Current multiplier:** \`${currentMult}x\`  ·  potential ${formatCoins(potential, game.guildId)}`,
        currentFloor < TOTAL_FLOORS && status === 'climbing' ? `> ${E.success} **Next floor pays:** \`${nextMult}x\`` : null,
        '',
        header,
    ].filter(Boolean);

    // Visual: stack from top floor → current. Cleared floors show ✓, current
    // shows arrow, future floors show ·.
    const towerLines = [];
    for (let f = TOTAL_FLOORS - 1; f >= 0; f--) {
        const fmult = multiplierForFloor(game.difficulty, f + 1);
        let glyph;
        if (status === 'lost' && f === currentFloor) glyph = E.mine;
        else if (f < currentFloor)  glyph = E.success;
        else if (f === currentFloor && status === 'climbing') glyph = '➤';
        else glyph = '·';
        towerLines.push(`-# ${glyph} **Floor ${f + 1}** · \`${fmult}x\``);
    }
    lines.push('');
    lines.push(towerLines.join('\n'));

    const container = createContainer(color);
    addTextDisplay(container, lines.join('\n'));

    if (status === 'climbing') {
        addSeparator(container, SeparatorSpacingSize.Small);

        // Tile pick row (3 or 4 buttons depending on difficulty).
        const tileRow = new ActionRowBuilder();
        for (let i = 0; i < d.tiles; i++) {
            tileRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`tower_pick_${game.userId}_${i}`)
                    .setLabel(`Tile ${i + 1}`)
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        container.addActionRowComponents(tileRow);

        // Cashout row (only if at least one floor cleared).
        if (currentFloor > 0) {
            const cashout = new ButtonBuilder()
                .setCustomId(`tower_cashout_${game.userId}`)
                .setLabel(`Cash Out · ${formatNumber(potential)}`)
                .setStyle(ButtonStyle.Success);
            const safeIcon = coinEmoji(game.guildId);
            if (safeIcon) cashout.setEmoji(safeIcon);
            container.addActionRowComponents(new ActionRowBuilder().addComponents(cashout));
        }
    }

    return container;
}

/* ═══════════════════════════════════════════════════════════════════
   ENTRY + ROUTER
   ═══════════════════════════════════════════════════════════════════ */

async function handleTower(reply, userId, args, guildId) {
    if (activeGames.has(userId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, `${E.warn} You already have an active tower run. Finish or cancel it first.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const balance = getBalance(userId);
    const betResult = parseBet(args[0], balance);

    if (!betResult.valid) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `# ${E.title} Tower of Risk`,
            '',
            `> ${E.info} **Usage:** \`tower <bet>\``,
            `> ${coinIcon(guildId)} **Max Bet:** ${formatNumber(MAX_BET)}`,
            '',
            `Climb 8 floors. Pick the safe tile on each floor — multiplier compounds. Cash out anytime.`,
            '',
            `**Difficulty:** ${E.riskLow} Easy · ${E.riskMed} Medium · ${E.riskHigh} Hard · ${E.riskMax} Expert`,
            '',
            `Top floor on Expert pays **\`6500x\`**.`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const bet = betResult.amount;
    activeGames.set(userId, {
        phase: 'setup', bet, guildId: guildId || null, userId,
        difficulty: null, floorIdx: 0, tower: null, ended: false,
        timestamp: Date.now(),
    });
    setTimeout(() => {
        const g = activeGames.get(userId);
        if (g && g.phase === 'setup') activeGames.delete(userId);
    }, 90_000);

    return reply({ components: [buildSetupContainer(userId)], flags: MessageFlags.IsComponentsV2 });
}

async function handleTowerInteraction(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('tower_')) return false;
    const userId = interaction.user.id;

    if (customId.startsWith('tower_setup_diff_')) {
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'setup') return interaction.reply({ content: `${E.fail} Setup expired.`, flags: MessageFlags.Ephemeral });
        game.difficulty = interaction.values[0];
        return interaction.update({ components: [buildSetupContainer(userId)], flags: MessageFlags.IsComponentsV2 });
    }

    if (customId.startsWith('tower_setup_cancel_')) {
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        activeGames.delete(userId);
        const c = createContainer(0x6b7280);
        addTextDisplay(c, `# ${E.fail} Setup Cancelled\n\nNo coins were charged.`);
        return interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (customId.startsWith('tower_setup_start_')) {
        const target = customId.split('_')[3];
        if (userId !== target) return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'setup') return interaction.reply({ content: `${E.fail} Setup expired.`, flags: MessageFlags.Ephemeral });
        if (!game.difficulty) return interaction.reply({ content: `${E.warn} Pick a difficulty first.`, flags: MessageFlags.Ephemeral });
        return startGame(interaction, game);
    }

    if (customId.startsWith('tower_pick_')) {
        const parts = customId.split('_');
        const target = parts[2];
        const tileIdx = parseInt(parts[3], 10);
        if (userId !== target) return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'playing' || game.ended) return interaction.deferUpdate().catch(() => {});
        return pickTile(interaction, game, tileIdx);
    }

    if (customId.startsWith('tower_cashout_')) {
        const target = customId.split('_')[2];
        if (userId !== target) return interaction.reply({ content: `${E.fail} Not your game!`, flags: MessageFlags.Ephemeral });
        const game = activeGames.get(userId);
        if (!game || game.phase !== 'playing' || game.ended) return interaction.deferUpdate().catch(() => {});
        return cashOut(interaction, game);
    }

    return false;
}

/* ═══════════════════════════════════════════════════════════════════
   LIFECYCLE
   ═══════════════════════════════════════════════════════════════════ */

async function startGame(interaction, game) {
    deductBet(game.userId, game.bet);
    game.phase = 'playing';
    game.tower = generateTower(game.difficulty);
    game.floorIdx = 0;
    game.ended = false;

    return interaction.update({
        components: [buildLiveContainer(game, 'climbing')],
        flags: MessageFlags.IsComponentsV2,
    });
}

async function pickTile(interaction, game, tileIdx) {
    if (game._processing) return interaction.deferUpdate().catch(() => {});
    game._processing = true;
    try {
        const floor = game.tower[game.floorIdx];
        const isMine = floor[tileIdx];

        if (isMine) {
            game.ended = true;
            activeGames.delete(game.userId);
            settle(game.userId, game.bet, 0);
            const container = buildLiveContainer(game, 'lost');
            return await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Safe — advance.
        game.floorIdx++;

        if (game.floorIdx >= TOTAL_FLOORS) {
            // Topped the tower — auto cash out.
            const mult = multiplierForFloor(game.difficulty, TOTAL_FLOORS);
            const payout = Math.floor(game.bet * mult);
            settle(game.userId, game.bet, payout);
            game.ended = true;
            activeGames.delete(game.userId);
            const container = buildLiveContainer(game, 'topped');
            return await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildLiveContainer(game, 'climbing');
        return await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } finally {
        game._processing = false;
    }
}

async function cashOut(interaction, game) {
    if (game.ended || game._cashedOut) return interaction.deferUpdate().catch(() => {});
    game._cashedOut = true;
    game.ended = true;

    const mult = multiplierForFloor(game.difficulty, game.floorIdx);
    const payout = Math.floor(game.bet * mult);
    settle(game.userId, game.bet, payout);
    activeGames.delete(game.userId);

    const container = buildLiveContainer(game, 'won');
    return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tower')
        .setDescription('Climb a tower — pick safe tiles, multiplier compounds, cash out anytime')
        .addStringOption(o => o.setName('bet').setDescription('Bet amount (max 100k) or "all"').setRequired(true)),

    prefix: 'tower',
    aliases: ['tw'],
    description: 'Climb 8 floors picking safe tiles. Cash out anytime — multipliers up to 6500×.',
    usage: 'tower <bet>',
    category: 'economy',

    handleTowerInteraction,

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const amount = interaction.options.getString('bet');
        await handleTower((opts) => interaction.reply(opts), interaction.user.id, [amount], interaction.guild?.id);
    },

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        await handleTower((opts) => message.reply(opts), message.author.id, args, message.guild?.id);
    },
};
