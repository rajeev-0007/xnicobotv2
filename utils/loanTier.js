'use strict';

/**
 * loanTier.js — Borrower reputation tiers for the /loan command.
 *
 * Reputation is tracked on userData by economyManager.repayLoan:
 *   • loanRepCount   — total loans fully cleared
 *   • loanLatePays   — loans cleared late (more than 5 days after take)
 *   • loanRepAmount  — total principal repaid (used for promotion gates)
 *
 * Score = clean repays = repCount - latePays.
 * The score determines the borrower's tier. A higher tier raises the
 * single-loan max AND the simultaneous total-debt cap. Each tier
 * also scales the daily interest down a touch — good borrowers get
 * better terms, the same way real-world credit works.
 */

const TIERS = [
    {
        id: 'newbie',
        label: 'New Borrower',
        emoji: '🪙',
        minScore: 0,
        maxLoan: 50_000,
        maxDebt: 50_000,
        interest: 0.10,         // 10% / day
        description: 'Default tier — repay 3 clean loans to unlock the next bracket.',
    },
    {
        id: 'reliable',
        label: 'Reliable',
        emoji: '🎖',
        minScore: 3,
        maxLoan: 100_000,
        maxDebt: 150_000,
        interest: 0.09,
        description: '3+ clean repays. Larger loans, slightly lower rate.',
    },
    {
        id: 'trusted',
        label: 'Trusted',
        emoji: '🏅',
        minScore: 7,
        maxLoan: 250_000,
        maxDebt: 400_000,
        interest: 0.08,
        description: '7+ clean repays. Substantial credit line at a friendlier rate.',
    },
    {
        id: 'vip',
        label: 'VIP Borrower',
        emoji: '👑',
        minScore: 15,
        maxLoan: 500_000,
        maxDebt: 750_000,
        interest: 0.07,
        description: '15+ clean repays. Top-tier limits, best interest rate.',
    },
];

/**
 * Resolve the tier object for a given userData record. Always returns
 * a tier (defaults to the newbie tier).
 */
function getLoanTier(userData) {
    const repCount  = Number(userData?.loanRepCount  || 0);
    const latePays  = Number(userData?.loanLatePays  || 0);
    const score = Math.max(0, repCount - latePays);

    let tier = TIERS[0];
    for (const t of TIERS) {
        if (score >= t.minScore) tier = t;
    }
    return { ...tier, score, repCount, latePays };
}

/**
 * What's the *next* tier the user is working toward? Returns null
 * once they hit the cap.
 */
function getNextTier(userData) {
    const current = getLoanTier(userData);
    const idx = TIERS.findIndex(t => t.id === current.id);
    return TIERS[idx + 1] || null;
}

module.exports = { getLoanTier, getNextTier, TIERS };
