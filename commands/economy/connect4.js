'use strict';

/**
 * Connect 4 — bet vs the bot OR vs another user.
 *
 * Solo: bet up-front, win pays 2×, draw refunds, loss keeps the bet.
 *       Bot picks the strongest move 70% of the time and a random
 *       legal column 30% of the time.
 *
 * PvP : challenge container with Accept/Decline. Both players' coins
 *       are escrowed up-front. Winner takes 2× bet, draw refunds.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { formatCoins, formatCoinsShort } = require('../../utils/currencyHelper');
const { deductBet, settle } = require('../../utils/betGameHelper');
const { resolveUser } = require('../../utils/resolveUser');
const economyManager = require('../../utils/economyManager');
const {
    validateOpponent, deductBoth, settlePvP, buildChallenge, pvpError
} = require('../../utils/pvpGameHelper');

const ROWS = 6, COLS = 7;
const games = new Map();
const challenges = new Map();

setInterval(() => {
    const now = Date.now();
    const cutoff = now - 10 * 60 * 1000;
    for (const [id, g] of games) if (g.createdAt < cutoff) games.delete(id);
    for (const [id, c] of challenges) if (c.expiresAt < now) challenges.delete(id);
}, 5 * 60 * 1000);

function drop(board, col, piece) {
    for (let r = ROWS - 1; r >= 0; r--) {
        if (!board[r][col]) { board[r][col] = piece; return r; }
    }
    return -1;
}

function checkWin(board, piece) {
    for (let r = 0; r < ROWS; r++)
        for (let c = 0; c <= COLS - 4; c++)
            if ([0,1,2,3].every(i => board[r][c + i] === piece)) return true;
    for (let r = 0; r <= ROWS - 4; r++)
        for (let c = 0; c < COLS; c++)
            if ([0,1,2,3].every(i => board[r + i][c] === piece)) return true;
    for (let r = 3; r < ROWS; r++)
        for (let c = 0; c <= COLS - 4; c++)
            if ([0,1,2,3].every(i => board[r - i][c + i] === piece)) return true;
    for (let r = 0; r <= ROWS - 4; r++)
        for (let c = 0; c <= COLS - 4; c++)
            if ([0,1,2,3].every(i => board[r + i][c + i] === piece)) return true;
    return false;
}

function isFull(board) { return board.every(row => row.every(Boolean)); }

function botMove(board) {
    const canDrop = c => board[0][c] === null;
    const tryDrop = (c, piece) => {
        const b = board.map(r => [...r]);
        drop(b, c, piece);
        return b;
    };
    if (Math.random() < 0.7) {
        for (let c = 0; c < COLS; c++) {
            if (canDrop(c) && checkWin(tryDrop(c, 'Y'), 'Y')) return c;
        }
        for (let c = 0; c < COLS; c++) {
            if (canDrop(c) && checkWin(tryDrop(c, 'R'), 'R')) return c;
        }
        const order = [3, 2, 4, 1, 5, 0, 6];
        return order.find(c => canDrop(c)) ?? -1;
    }
    const legal = Array.from({ length: COLS }, (_, i) => canDrop(i) ? i : -1).filter(i => i !== -1);
    return legal.length === 0 ? -1 : legal[Math.floor(Math.random() * legal.length)];
}

function buildContainer(game, payoutInfo = null) {
    const guildId = game.guildId;
    const EMPTY = '⬜', RED = '🔴', YELLOW = '🟡';
    const display = game.board.map(row =>
        row.map(cell => cell === 'R' ? RED : cell === 'Y' ? YELLOW : EMPTY).join('')
    ).join('\n') + '\n1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣';

    let header, accent;
    if (game.mode === 'pvp') {
        const rName = `<@${game.rId}>`;
        const yName = `<@${game.yId}>`;
        if (game.status === 'won' && game.winner === 'R') { header = `### 🏆 ${rName} wins!`; accent = 0x57F287; }
        else if (game.status === 'won' && game.winner === 'Y') { header = `### 🏆 ${yName} wins!`; accent = 0x57F287; }
        else if (game.status === 'draw') { header = `### 🤝 Draw — both bets refunded.`; accent = 0xFEE75C; }
        else {
            const turnName = game.turn === 'R' ? rName : yName;
            const piece = game.turn === 'R' ? '🔴' : '🟡';
            header = `${turnName}'s turn ${piece}\n-# 🔴 ${rName}  •  🟡 ${yName}`;
            accent = 0xCAD7E6;
        }
    } else {
        if (game.status === 'won' && game.winner === 'R') { header = `### 🏆 You Win!`; accent = 0x57F287; }
        else if (game.status === 'won' && game.winner === 'Y') { header = `### 🤖 Bot Wins.`; accent = 0xED4245; }
        else if (game.status === 'draw') { header = `### 🤝 Draw — bet refunded.`; accent = 0xFEE75C; }
        else { header = `Drop your piece — get 4 in a row!\n-# 🔴 You  •  🟡 Bot`; accent = 0xCAD7E6; }
    }

    const potLabel = game.mode === 'pvp'
        ? `**Bet:** ${formatCoins(game.bet, guildId)} each • **Pot:** ${formatCoins(game.bet * 2, guildId)}`
        : `**Bet:** ${formatCoins(game.bet, guildId)}`;

    let content = `# 🔵 Connect 4\n\n${potLabel}\n\n${header}\n\n${display}`;
    if (payoutInfo) content += `\n\n${payoutInfo}`;

    const c = new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    if (game.status === 'playing') {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            ...[0,1,2,3,4].map(col =>
                new ButtonBuilder()
                    .setCustomId(`c4_${game.id}_${col}`)
                    .setLabel(String(col + 1))
                    .setStyle(game.board[0][col] ? ButtonStyle.Secondary : ButtonStyle.Primary)
                    .setDisabled(!!game.board[0][col])
            )
        ));
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            ...[5, 6].map(col =>
                new ButtonBuilder()
                    .setCustomId(`c4_${game.id}_${col}`)
                    .setLabel(String(col + 1))
                    .setStyle(game.board[0][col] ? ButtonStyle.Secondary : ButtonStyle.Primary)
                    .setDisabled(!!game.board[0][col])
            )
        ));
    }
    return c;
}

function startSoloGame(userId, guildId, bet) {
    deductBet(userId, bet);
    const id = `${userId}-${Date.now()}`;
    const game = {
        id, mode: 'solo', playerId: userId, guildId, bet,
        board: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
        status: 'playing', winner: null,
        createdAt: Date.now()
    };
    games.set(id, game);
    return buildContainer(game);
}

function startPvpGame(rId, yId, guildId, bet) {
    deductBoth(rId, yId, bet);
    const id = `${rId}-${yId}-${Date.now()}`;
    const game = {
        id, mode: 'pvp', rId, yId, playerId: rId, guildId, bet,
        board: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
        status: 'playing', winner: null,
        turn: 'R', createdAt: Date.now()
    };
    games.set(id, game);
    return buildContainer(game);
}

function hasActiveGame(userId) {
    for (const g of games.values()) {
        if (g.status === 'playing' && (g.playerId === userId || g.rId === userId || g.yId === userId)) return true;
    }
    return false;
}

function hasActiveChallenge(userId) {
    for (const c of challenges.values()) {
        if (c.challengerId === userId || c.opponentId === userId) return true;
    }
    return false;
}

async function runStart(reply, userId, guildId, betArg, opponent) {
    const balance = getBalance(userId);
    const r = parseBet(betArg, balance);
    if (!r.valid) return reply(r.error);
    const bet = r.amount;

    if (hasActiveGame(userId) || hasActiveChallenge(userId)) {
        const c = new ContainerBuilder().setAccentColor(0xFEE75C)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `<:Infotriangle:1521227710381428926> Finish your active connect-4 game or pending challenge first.`
            ));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const validOpponent = opponent && !opponent.bot && opponent.id !== userId ? opponent : null;
    if (!validOpponent) {
        return reply({ components: [startSoloGame(userId, guildId, bet)], flags: MessageFlags.IsComponentsV2 });
    }

    const v = validateOpponent(userId, validOpponent, bet);
    if (!v.ok) return reply(v.message);
    if (hasActiveGame(validOpponent.id) || hasActiveChallenge(validOpponent.id)) {
        return reply(pvpError(`<@${validOpponent.id}> already has an active game or pending challenge.`));
    }

    const challengeId = `${userId}-${validOpponent.id}-${Date.now()}`;
    challenges.set(challengeId, {
        challengerId: userId, opponentId: validOpponent.id, guildId, bet,
        expiresAt: Date.now() + 60_000
    });

    return reply(buildChallenge({
        gameLabel: 'Connect 4', gameEmoji: '🔵',
        challengerId: userId, opponentId: validOpponent.id, bet, guildId,
        idPrefix: 'c4ch', challengeId
    }));
}

async function handleChallengeButton(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('c4ch_')) return false;
    const m = customId.match(/^c4ch_(accept|decline)_(.+)$/);
    if (!m) return false;
    const [, action, challengeId] = m;
    const ch = challenges.get(challengeId);

    if (!ch) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> Challenge expired.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return true;
    }
    if (interaction.user.id !== ch.opponentId) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> Only the challenged user can respond.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return true;
    }

    if (action === 'decline') {
        challenges.delete(challengeId);
        const c = new ContainerBuilder().setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# 🔵 Challenge Declined\n\n<@${ch.opponentId}> declined the match.`
            ));
        await interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return true;
    }

    const economy = economyManager.loadEconomy();
    const a = economyManager.getUser(economy, ch.challengerId).userData;
    const b = economyManager.getUser(economy, ch.opponentId).userData;
    if (a.coins < ch.bet || b.coins < ch.bet) {
        challenges.delete(challengeId);
        await interaction.update(pvpError(`One of the players no longer has enough coins for this match.`)).catch(() => {});
        return true;
    }

    challenges.delete(challengeId);
    const container = startPvpGame(ch.challengerId, ch.opponentId, ch.guildId, ch.bet);
    await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    return true;
}

async function handleGameButton(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('c4_') || customId.startsWith('c4ch_')) return false;

    const lastUnderscore = customId.lastIndexOf('_');
    const col = parseInt(customId.slice(lastUnderscore + 1), 10);
    const gameId = customId.slice(3, lastUnderscore);
    const game = games.get(gameId);

    if (!game || game.status !== 'playing') {
        await interaction.deferUpdate().catch(() => {});
        return true;
    }

    if (game.mode === 'solo') {
        if (interaction.user.id !== game.playerId) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Not your game.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }
        if (drop(game.board, col, 'R') === -1) {
            await interaction.deferUpdate().catch(() => {});
            return true;
        }

        let info = null;
        let payout = null;

        if (checkWin(game.board, 'R')) {
            game.status = 'won'; game.winner = 'R';
            payout = game.bet * 2;
            info = `<:Checkedbox:1521227734943269077> +${formatCoins(game.bet, game.guildId)} profit`;
        } else if (isFull(game.board)) {
            game.status = 'draw';
            payout = game.bet;
            info = `🤝 Bet refunded.`;
        } else {
            const bc = botMove(game.board);
            if (bc !== -1) drop(game.board, bc, 'Y');
            if (checkWin(game.board, 'Y')) {
                game.status = 'won'; game.winner = 'Y';
                payout = 0;
                info = `<:Cancel:1521227723916181644> Lost ${formatCoins(game.bet, game.guildId)}`;
            } else if (isFull(game.board)) {
                game.status = 'draw';
                payout = game.bet;
                info = `🤝 Bet refunded.`;
            }
        }

        if (payout !== null) {
            settle(game.playerId, game.bet, payout);
            games.delete(gameId);
        }

        try {
            await interaction.update({ components: [buildContainer(game, info)], flags: MessageFlags.IsComponentsV2 });
        } catch (e) {
            if (e.code !== 10008 && e.code !== 40060) console.error('[Connect4] update error:', e);
        }
        return true;
    }

    // PvP mode
    const expectedPlayer = game.turn === 'R' ? game.rId : game.yId;
    if (interaction.user.id !== expectedPlayer) {
        if (interaction.user.id === game.rId || interaction.user.id === game.yId) {
            await interaction.reply({ content: '<:Sandwatch:1521228272426418367> Not your turn.', flags: MessageFlags.Ephemeral }).catch(() => {});
        } else {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Not your game.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return true;
    }

    if (drop(game.board, col, game.turn) === -1) {
        await interaction.deferUpdate().catch(() => {});
        return true;
    }

    let info = null;
    if (checkWin(game.board, game.turn)) {
        game.status = 'won'; game.winner = game.turn;
        const winnerId = game.turn === 'R' ? game.rId : game.yId;
        const loserId = game.turn === 'R' ? game.yId : game.rId;
        settlePvP({ winnerId, loserId, aId: game.rId, bId: game.yId, bet: game.bet, draw: false });
        info = `<:Checkedbox:1521227734943269077> <@${winnerId}> takes the pot of ${formatCoins(game.bet * 2, game.guildId)}`;
        games.delete(gameId);
    } else if (isFull(game.board)) {
        game.status = 'draw';
        settlePvP({ winnerId: null, loserId: null, aId: game.rId, bId: game.yId, bet: game.bet, draw: true });
        info = `🤝 Both bets of ${formatCoins(game.bet, game.guildId)} refunded`;
        games.delete(gameId);
    } else {
        game.turn = game.turn === 'R' ? 'Y' : 'R';
    }

    try {
        await interaction.update({ components: [buildContainer(game, info)], flags: MessageFlags.IsComponentsV2 });
    } catch (e) {
        if (e.code !== 10008 && e.code !== 40060) console.error('[Connect4] update error:', e);
    }
    return true;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('connect4')
        .setDescription('Connect 4 — bet vs the bot or challenge another user')
        .addStringOption(o => o.setName('bet').setDescription(`Amount to bet (max ${MAX_BET.toLocaleString()}) or "all"`).setRequired(true))
        .addUserOption(o => o.setName('opponent').setDescription('Challenge a player (optional, bot plays if empty)').setRequired(false)),
    prefix: 'connect4',
    aliases: ['c4', 'connectfour'],
    description: 'Bet vs the bot OR another user — winner takes 2× bet, draw refunds.',
    usage: 'connect4 <bet> [@opponent]',
    category: 'economy',

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const bet = interaction.options.getString('bet');
        const opponent = interaction.options.getUser('opponent');
        return runStart(o => interaction.reply(o), interaction.user.id, interaction.guild?.id, bet, opponent);
    },
    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        const opponent = await resolveUser(message, args);
        const betArg = args.find(a => !/^<@!?\d{17,20}>$/.test(a) && !/^\d{17,20}$/.test(a));
        return runStart(o => message.reply(o), message.author.id, message.guild?.id, betArg, opponent);
    },

    async handleButton(interaction) {
        if (interaction.customId.startsWith('c4ch_')) return handleChallengeButton(interaction);
        return handleGameButton(interaction);
    }
};
