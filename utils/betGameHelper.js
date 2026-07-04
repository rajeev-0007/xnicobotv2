/**
 * betGameHelper — shared utilities for bet-based mini-games.
 *
 * Every game in `commands/economy/` that follows the
 * "deduct on start, payout on resolution" pattern uses these helpers
 * so the bookkeeping stays consistent across:
 *   - up-front bet deduction
 *   - 2× win payout / refund / total loss
 *   - totalGambled / totalWon / totalLost stat updates
 *   - XP awards on resolution
 *
 * Bonuses
 * ───────
 *   `userData.bonuses.gamble` (set by the **Medal** shop item, capped
 *   at +25%) adds a small percentage on top of any winning payout.
 *   This is the single place that bonus actually fires — without it
 *   the medal would be paid for and never used.
 */

'use strict';

const economyManager = require('./economyManager');

/**
 * Deduct the bet from the user's wallet and update lifetime stats.
 * Call this once when the game *starts*.
 */
function deductBet(userId, bet) {
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);
    userData.coins -= bet;
    userData.totalGambled = (userData.totalGambled || 0) + bet;
    economyManager.saveEconomy(economy);
    return userData.coins;
}

/**
 * Resolve a finished game by crediting `payout` (gross, not profit)
 * to the user and updating stats.
 *
 * Examples:
 *   - bet 100, win 2x → settle(uid, 100, 200) → +100 profit recorded
 *   - bet 100, push   → settle(uid, 100, 100) → no profit, no loss
 *   - bet 100, lose   → settle(uid, 100, 0)   → -100 loss recorded
 *
 * Returns the post-settlement userData and the actual payout that
 * was credited (which may include the gamble-bonus boost on a win).
 */
function settle(userId, bet, payout) {
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);

    let actualPayout = payout;

    if (payout > bet) {
        // Win — apply the gamble bonus (Medal stack) to the *profit*
        // portion only, so a 2× win with +25% bonus pays
        //   stake + (profit × 1.25), not stake × 1.25.
        const gambleBonus = Number(userData.bonuses?.gamble || 0);
        if (gambleBonus > 0) {
            const profit = payout - bet;
            const extra = Math.floor(profit * gambleBonus);
            actualPayout = payout + extra;
        }
    }

    if (actualPayout > 0) {
        userData.coins += actualPayout;
        if (actualPayout > bet) {
            userData.totalWon = (userData.totalWon || 0) + (actualPayout - bet);
        }
    }
    if (actualPayout < bet) {
        userData.totalLost = (userData.totalLost || 0) + (bet - actualPayout);
    }
    economyManager.addXP(economy, userId, actualPayout > bet ? 8 : 2);
    economyManager.checkAllAchievements(economy, userId);
    economyManager.saveEconomy(economy);
    return { userData, payout: actualPayout };
}

module.exports = { deductBet, settle };
