'use strict';

/**
 * pvpGameHelper — shared utilities for PvP bet-based mini-games.
 *
 * Used by tictactoe / connect4 / rps / dice when an opponent is
 * specified. Mirrors `betGameHelper` (which handles vs-bot games)
 * but applies the same up-front-deduction, winner-takes-pot model
 * across two real users instead of one user + bot.
 *
 * Bookkeeping rules:
 *   - On start: deduct `bet` from BOTH players, add to totalGambled.
 *   - On win:   credit winner with 2×bet (pot), record 1×bet profit
 *               on totalWon, record bet loss on loser's totalLost.
 *   - On draw:  refund bet to both (no profit/loss recorded).
 *
 * Validation helpers:
 *   - validateOpponent: ensures opponent isn't self/bot, both have
 *     enough coins, returns either { ok: true, balances } or
 *     { ok: false, message } with a ready-to-send container.
 */

const economyManager = require('./economyManager');
const {
    ContainerBuilder, TextDisplayBuilder, MessageFlags,
    ActionRowBuilder, ButtonBuilder, ButtonStyle
} = require('discord.js');

/**
 * Pre-flight check before posting a PvP challenge.
 *
 * @param {string} challengerId
 * @param {{id:string, bot?:boolean}} opponent  Discord User (or null for vs-bot)
 * @param {number} bet
 * @returns {{ok:true, challengerCoins:number, opponentCoins:number} |
 *           {ok:false, message:object}}
 */
function validateOpponent(challengerId, opponent, bet) {
    if (!opponent) return { ok: false, message: pvpError('No opponent provided.') };
    if (opponent.bot) return { ok: false, message: pvpError('You cannot challenge a bot.') };
    if (opponent.id === challengerId) return { ok: false, message: pvpError('You cannot challenge yourself.') };

    const economy = economyManager.loadEconomy();
    const cu = economyManager.getUser(economy, challengerId).userData;
    const ou = economyManager.getUser(economy, opponent.id).userData;

    if (cu.coins < bet) return { ok: false, message: pvpError(`You don't have enough coins. Balance: **${cu.coins.toLocaleString()}**`) };
    if (ou.coins < bet) return { ok: false, message: pvpError(`<@${opponent.id}> doesn't have enough coins to match the bet.`) };

    return { ok: true, challengerCoins: cu.coins, opponentCoins: ou.coins };
}

/** Deduct `bet` from both users and bump totalGambled on each. */
function deductBoth(challengerId, opponentId, bet) {
    const economy = economyManager.loadEconomy();
    const a = economyManager.getUser(economy, challengerId).userData;
    const b = economyManager.getUser(economy, opponentId).userData;

    a.coins -= bet;
    b.coins -= bet;
    a.totalGambled = (a.totalGambled || 0) + bet;
    b.totalGambled = (b.totalGambled || 0) + bet;

    economyManager.saveEconomy(economy);
}

/**
 * Resolve a finished PvP game.
 *
 * @param {string} winnerId  Winner user id, or null for draw
 * @param {string} loserId   Loser user id, or null for draw
 * @param {string} aId       Challenger id (used on draw to refund)
 * @param {string} bId       Opponent id (used on draw to refund)
 * @param {number} bet
 * @param {boolean} draw
 */
function settlePvP({ winnerId, loserId, aId, bId, bet, draw }) {
    const economy = economyManager.loadEconomy();

    if (draw) {
        const a = economyManager.getUser(economy, aId).userData;
        const b = economyManager.getUser(economy, bId).userData;
        a.coins += bet;
        b.coins += bet;
        economyManager.addXP(economy, aId, 3);
        economyManager.addXP(economy, bId, 3);
    } else {
        const w = economyManager.getUser(economy, winnerId).userData;
        const l = economyManager.getUser(economy, loserId).userData;
        w.coins += bet * 2;
        w.totalWon = (w.totalWon || 0) + bet;
        l.totalLost = (l.totalLost || 0) + bet;
        economyManager.addXP(economy, winnerId, 10);
        economyManager.addXP(economy, loserId, 2);
        economyManager.checkAllAchievements(economy, winnerId);
        economyManager.checkAllAchievements(economy, loserId);
    }

    economyManager.saveEconomy(economy);
}

function pvpError(text) {
    const c = new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`<:Cancel:1521227723916181644> ${text}`));
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Build a "challenge issued" container with Accept/Decline buttons.
 * The caller passes a unique id used in customIds so we can route
 * the click back to the game module's handleChallenge function.
 *
 * @param {object} opts
 * @param {string} opts.gameLabel    e.g. "Tic-Tac-Toe"
 * @param {string} opts.gameEmoji
 * @param {string} opts.challengerId
 * @param {string} opts.opponentId
 * @param {number} opts.bet
 * @param {string} opts.guildId      For currency formatting
 * @param {string} opts.idPrefix     Custom-id namespace (e.g. "tttch")
 * @param {string} opts.challengeId  Unique challenge id
 */
function buildChallenge({ gameLabel, gameEmoji = '⚔️', challengerId, opponentId, bet, guildId, idPrefix, challengeId }) {
    const { formatCoinsShort } = require('./currencyHelper');

    const content = [
        `# ${gameEmoji} ${gameLabel} Challenge`,
        ``,
        `<@${challengerId}> has challenged <@${opponentId}> to a match.`,
        ``,
        `**Bet:** ${formatCoinsShort(bet, guildId)} each`,
        `**Pot:** ${formatCoinsShort(bet * 2, guildId)}`,
        ``,
        `<@${opponentId}> — accept within 60s.`
    ].join('\n');

    const c = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${idPrefix}_accept_${challengeId}`)
                .setLabel('Accept')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:Checkedbox:1521227734943269077>'),
            new ButtonBuilder()
                .setCustomId(`${idPrefix}_decline_${challengeId}`)
                .setLabel('Decline')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Cancel:1521227723916181644>')
        ));

    return { components: [c], flags: MessageFlags.IsComponentsV2, allowedMentions: { users: [opponentId] } };
}

module.exports = {
    validateOpponent,
    deductBoth,
    settlePvP,
    pvpError,
    buildChallenge
};
