'use strict';

/**
 * Tic-Tac-Toe — bet vs the bot OR vs another user.
 *
 * Solo: bet up-front, win pays 2×, draw refunds, loss keeps the bet.
 *       Bot is "60% optimal / 40% random" so the player can win.
 *
 * PvP : challenge container with Accept/Decline. Both players' coins
 *       are escrowed at accept-time; winner takes the pot (2× bet),
 *       draw refunds both. Decline / 60s timeout cancels.
 *
 * One game per user at a time. State auto-expires after 10 minutes.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const economyManager = require('../../utils/economyManager');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { formatCoins, formatCoinsShort } = require('../../utils/currencyHelper');
const { resolveUser } = require('../../utils/resolveUser');
const {
    validateOpponent, deductBoth, settlePvP, buildChallenge, pvpError
} = require('../../utils/pvpGameHelper');

const games = new Map();
const challenges = new Map();

setInterval(() => {
    const now = Date.now();
    const gameCutoff = now - 10 * 60 * 1000;
    for (const [id, g] of games) if (g.createdAt < gameCutoff) games.delete(id);
    for (const [id, c] of challenges) if (c.expiresAt < now) challenges.delete(id);
}, 5 * 60 * 1000);

const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function winner(board) {
    for (const [a,b,c] of LINES) {
        if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
    }
    return null;
}

function isFull(board) { return board.every(Boolean); }

function bestMove(board) {
    let best = -Infinity, move = -1;
    for (let i = 0; i < 9; i++) {
        if (board[i]) continue;
        board[i] = 'O';
        const score = minimax(board, false);
        board[i] = null;
        if (score > best) { best = score; move = i; }
    }
    return move;
}

function minimax(board, isMax) {
    const w = winner(board);
    if (w === 'O') return 10;
    if (w === 'X') return -10;
    if (isFull(board)) return 0;
    let best = isMax ? -Infinity : Infinity;
    for (let i = 0; i < 9; i++) {
        if (board[i]) continue;
        board[i] = isMax ? 'O' : 'X';
        const s = minimax(board, !isMax);
        board[i] = null;
        best = isMax ? Math.max(best, s) : Math.min(best, s);
    }
    return best;
}

function botMove(board) {
    if (Math.random() < 0.6) return bestMove(board);
    const empty = board.map((v, i) => v ? -1 : i).filter(i => i !== -1);
    return empty[Math.floor(Math.random() * empty.length)];
}

function settleSolo(userId, bet, payout) {
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);
    if (payout > 0) {
        userData.coins += payout;
        if (payout > bet) userData.totalWon = (userData.totalWon || 0) + (payout - bet);
    }
    if (payout < bet) {
        userData.totalLost = (userData.totalLost || 0) + (bet - payout);
    }
    economyManager.addXP(economy, userId, payout > bet ? 6 : 2);
    economyManager.checkAllAchievements(economy, userId);
    economyManager.saveEconomy(economy);
    return userData;
}

function buildContainer(game, payoutInfo = null) {
    const guildId = game.guildId;
    const w = winner(game.board);
    const draw = !w && isFull(game.board);

    let header;
    let accent = 0xCAD7E6;

    if (game.mode === 'pvp') {
        const xName = `<@${game.xId}>`;
        const oName = `<@${game.oId}>`;
        if (w === 'X')      { header = `### 🏆 ${xName} wins!`; accent = 0x57F287; }
        else if (w === 'O') { header = `### 🏆 ${oName} wins!`; accent = 0x57F287; }
        else if (draw)      { header = `### 🤝 Draw — both bets refunded.`; accent = 0xFEE75C; }
        else {
            const turn = game.turn === 'X' ? xName : oName;
            header = `${turn}'s turn (${game.turn})`;
        }
    } else {
        if (w === 'X')      { header = `### 🏆 You Win!`;          accent = 0x57F287; }
        else if (w === 'O') { header = `### 🤖 Bot Wins!`;         accent = 0xED4245; }
        else if (draw)      { header = `### 🤝 Draw — bet refunded.`; accent = 0xFEE75C; }
        else                { header = `**You are X** — click a cell to play!`; }
    }

    const potLabel = game.mode === 'pvp'
        ? `**Bet:** ${formatCoins(game.bet, guildId)} each • **Pot:** ${formatCoins(game.bet * 2, guildId)}`
        : `**Bet:** ${formatCoins(game.bet, guildId)}`;

    let content = `# ✖⭕ Tic-Tac-Toe\n\n${potLabel}\n\n${header}`;
    if (payoutInfo) content += `\n\n${payoutInfo}`;

    const c = new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    const styles = { X: ButtonStyle.Danger, O: ButtonStyle.Primary };
    const labels = { X: 'X', O: 'O' };
    for (let r = 0; r < 3; r++) {
        const row = new ActionRowBuilder();
        for (let col = 0; col < 3; col++) {
            const i = r * 3 + col;
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`ttt_${game.id}_${i}`)
                    .setLabel(game.board[i] ? labels[game.board[i]] : '·')
                    .setStyle(game.board[i] ? styles[game.board[i]] : ButtonStyle.Secondary)
                    .setDisabled(!!game.board[i] || game.finished)
            );
        }
        c.addActionRowComponents(row);
    }
    return c;
}

function startSoloGame(userId, guildId, bet) {
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);
    userData.coins -= bet;
    userData.totalGambled = (userData.totalGambled || 0) + bet;
    economyManager.saveEconomy(economy);

    const id = `${userId}-${Date.now()}`;
    const game = {
        id, mode: 'solo', playerId: userId, guildId, bet,
        board: Array(9).fill(null), finished: false, createdAt: Date.now()
    };
    games.set(id, game);
    return buildContainer(game);
}

function startPvpGame(xId, oId, guildId, bet) {
    deductBoth(xId, oId, bet);
    const id = `${xId}-${oId}-${Date.now()}`;
    const game = {
        id, mode: 'pvp', xId, oId, playerId: xId, guildId, bet,
        board: Array(9).fill(null), turn: 'X', finished: false, createdAt: Date.now()
    };
    games.set(id, game);
    return buildContainer(game);
}

function hasActiveGame(userId) {
    for (const g of games.values()) {
        if (!g.finished && (g.playerId === userId || g.xId === userId || g.oId === userId)) return true;
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
    const betResult = parseBet(betArg, balance);
    if (!betResult.valid) return reply(betResult.error);
    const bet = betResult.amount;

    if (hasActiveGame(userId) || hasActiveChallenge(userId)) {
        const c = new ContainerBuilder().setAccentColor(0xFEE75C)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `<:Infotriangle:1521227710381428926> Finish your active tic-tac-toe game or pending challenge first.`
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
        gameLabel: 'Tic-Tac-Toe', gameEmoji: '✖⭕',
        challengerId: userId, opponentId: validOpponent.id, bet, guildId,
        idPrefix: 'tttch', challengeId
    }));
}

async function handleChallengeButton(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('tttch_')) return false;
    const m = customId.match(/^tttch_(accept|decline)_(.+)$/);
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
                `# ✖⭕ Challenge Declined\n\n<@${ch.opponentId}> declined the match.`
            ));
        await interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return true;
    }

    const economy = economyManager.loadEconomy();
    const challenger = economyManager.getUser(economy, ch.challengerId).userData;
    const opponent = economyManager.getUser(economy, ch.opponentId).userData;
    if (challenger.coins < ch.bet || opponent.coins < ch.bet) {
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
    if (!customId.startsWith('ttt_') || customId.startsWith('tttch_')) return false;

    const lastUnderscore = customId.lastIndexOf('_');
    const cellIdx = parseInt(customId.slice(lastUnderscore + 1), 10);
    const gameId  = customId.slice(4, lastUnderscore);
    const game = games.get(gameId);

    if (!game) {
        await interaction.reply({
            components: [new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Game Expired'))],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        }).catch(() => {});
        return true;
    }

    if (game.mode === 'solo') {
        if (interaction.user.id !== game.playerId) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Not your game.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }
        if (game.finished || game.board[cellIdx]) {
            await interaction.deferUpdate().catch(() => {});
            return true;
        }

        game.board[cellIdx] = 'X';
        let w = winner(game.board);
        if (!w && !isFull(game.board)) {
            const m = botMove(game.board);
            if (m !== -1) game.board[m] = 'O';
            w = winner(game.board);
        }

        let payout = null, info = null;
        if (w === 'X') {
            payout = game.bet * 2;
            info = `<:Checkedbox:1521227734943269077> +${formatCoins(game.bet, game.guildId)} profit`;
        } else if (w === 'O') {
            payout = 0;
            info = `<:Cancel:1521227723916181644> Lost ${formatCoins(game.bet, game.guildId)}`;
        } else if (isFull(game.board)) {
            payout = game.bet;
            info = `🤝 Bet of ${formatCoins(game.bet, game.guildId)} refunded`;
        }

        if (payout !== null) {
            game.finished = true;
            settleSolo(game.playerId, game.bet, payout);
            games.delete(gameId);
        }

        try {
            await interaction.update({ components: [buildContainer(game, info)], flags: MessageFlags.IsComponentsV2 });
        } catch (e) {
            if (e.code !== 10008 && e.code !== 40060) console.error('[TicTacToe] update error:', e);
        }
        return true;
    }

    // PvP mode
    const expectedPlayer = game.turn === 'X' ? game.xId : game.oId;
    if (interaction.user.id !== expectedPlayer) {
        if (interaction.user.id === game.xId || interaction.user.id === game.oId) {
            await interaction.reply({ content: '<:Sandwatch:1521228272426418367> Not your turn.', flags: MessageFlags.Ephemeral }).catch(() => {});
        } else {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Not your game.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return true;
    }
    if (game.finished || game.board[cellIdx]) {
        await interaction.deferUpdate().catch(() => {});
        return true;
    }

    game.board[cellIdx] = game.turn;
    const w = winner(game.board);

    let info = null, finished = false;
    if (w) {
        finished = true;
        const winnerId = w === 'X' ? game.xId : game.oId;
        const loserId = w === 'X' ? game.oId : game.xId;
        settlePvP({ winnerId, loserId, aId: game.xId, bId: game.oId, bet: game.bet, draw: false });
        info = `<:Checkedbox:1521227734943269077> <@${winnerId}> takes the pot of ${formatCoins(game.bet * 2, game.guildId)}`;
    } else if (isFull(game.board)) {
        finished = true;
        settlePvP({ winnerId: null, loserId: null, aId: game.xId, bId: game.oId, bet: game.bet, draw: true });
        info = `🤝 Both bets of ${formatCoins(game.bet, game.guildId)} refunded`;
    } else {
        game.turn = game.turn === 'X' ? 'O' : 'X';
    }

    if (finished) {
        game.finished = true;
        games.delete(gameId);
    }

    try {
        await interaction.update({ components: [buildContainer(game, info)], flags: MessageFlags.IsComponentsV2 });
    } catch (e) {
        if (e.code !== 10008 && e.code !== 40060) console.error('[TicTacToe] update error:', e);
    }
    return true;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tictactoe')
        .setDescription('Tic-Tac-Toe — bet vs the bot or challenge another user')
        .addStringOption(o => o.setName('bet').setDescription(`Amount to bet (max ${MAX_BET.toLocaleString()}) or "all"`).setRequired(true))
        .addUserOption(o => o.setName('opponent').setDescription('Challenge a player (optional, bot plays if empty)').setRequired(false)),
    prefix: 'tictactoe',
    aliases: ['ttt'],
    description: 'Bet vs the bot OR another user — winner takes 2× bet, draw refunds.',
    usage: 'tictactoe <bet> [@opponent]',
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
        if (interaction.customId.startsWith('tttch_')) return handleChallengeButton(interaction);
        return handleGameButton(interaction);
    }
};
