/**
 * Unified Bet Helper — shared by all gambling/game commands.
 * 
 * Rules:
 *   - No minimum bet (any amount ≥ 1)
 *   - Maximum bet: 100,000 coins
 *   - "all" bets up to max
 *   - Validates balance
 *   - Returns parsed bet or error message
 */

const { createContainer, addTextDisplay, MessageFlags } = require('./componentHelpers');
const economyManager = require('./economyManager');

const MAX_BET = 100_000;

/**
 * Parse and validate a bet amount.
 * @param {string} input - The bet input (number or "all")
 * @param {number} balance - User's current coin balance
 * @returns {{ valid: boolean, amount?: number, error?: object }}
 */
function parseBet(input, balance) {
    if (!input) {
        return { valid: false, error: betError(`Specify a bet amount.\n\n**Max bet:** ${MAX_BET.toLocaleString()} coins\n**Usage:** \`<command> <amount>\` or \`<command> all\``) };
    }

    const lower = String(input).toLowerCase();
    let amount;

    if (lower === 'all' || lower === 'max') {
        amount = Math.min(MAX_BET, balance);
    } else if (lower.endsWith('k')) {
        amount = Math.round(parseFloat(lower) * 1000);
    } else {
        amount = parseInt(lower, 10);
    }

    if (!amount || isNaN(amount) || amount < 1) {
        return { valid: false, error: betError('Enter a valid bet amount (1 or more).') };
    }

    if (amount > MAX_BET) {
        return { valid: false, error: betError(`Maximum bet is **${MAX_BET.toLocaleString()}** coins.`) };
    }

    if (amount > balance) {
        return { valid: false, error: betError(`Not enough coins. Your balance: **${balance.toLocaleString()}**`) };
    }

    return { valid: true, amount };
}

function betError(msg) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `<:Cancel:1521227723916181644> ${msg}`);
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Process a bet result — update user data, save economy.
 * @param {string} userId
 * @param {number} bet
 * @param {boolean} won
 * @param {number} [multiplier=1] - Win multiplier (1 = 1x, 2 = 2x payout)
 * @returns {{ userData, profit }}
 */
function processBetResult(userId, bet, won, multiplier = 1) {
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);

    const profit = won ? Math.floor(bet * multiplier) : -bet;

    if (won) {
        userData.coins += Math.floor(bet * multiplier);
        userData.totalWon = (userData.totalWon || 0) + Math.floor(bet * multiplier);
    } else {
        userData.coins -= bet;
        userData.totalLost = (userData.totalLost || 0) + bet;
    }

    userData.totalGambled = (userData.totalGambled || 0) + bet;
    economyManager.addXP(economy, userId, won ? 5 : 2);
    economyManager.checkAllAchievements(economy, userId);
    economyManager.saveEconomy(economy);

    return { userData, profit };
}

/**
 * Get user balance quickly.
 */
function getBalance(userId) {
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);
    return userData.coins;
}

module.exports = {
    MAX_BET,
    parseBet,
    betError,
    processBetResult,
    getBalance
};
