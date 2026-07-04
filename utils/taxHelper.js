'use strict';

/**
 * taxHelper.js — Wealth tax for the economy.
 *
 * Once a player crosses the wealth threshold (default 100,000 in
 * wallet), every further coin earned from passive sources (daily,
 * weekly, work, beg, crime, mine, fish, hunt, adventure, harvest,
 * heist) gets taxed at a fixed rate (default 18 percent).
 *
 * Why tax only the wealthy? It keeps the economy balanced — early
 * players still get full payouts, and end-game grinders contribute
 * back to the system instead of compounding indefinitely. The tax
 * NEVER applies to gambling wins or rewards from the shop, only to
 * income-style commands.
 *
 * Usage
 * ─────
 *   const { applyIncomeTax } = require('../../utils/taxHelper');
 *
 *   // After computing a gross reward and BEFORE crediting userData.coins:
 *   const { net, tax } = applyIncomeTax(grossReward, userData);
 *   userData.coins += net;
 *   if (tax > 0) {
 *     // optional: surface "-{tax} tax (X% bracket)" in your reply
 *   }
 *
 * The threshold check uses `wallet + bank` so a user can't dodge the
 * tax by parking their stack in the bank. Bank deposits/withdrawals
 * are themselves never taxed (they're internal transfers).
 */

const TAX_THRESHOLD  = 100_000;   // wealth (wallet+bank) at which tax kicks in
const TAX_RATE_DEFAULT = 0.18;    // 18% on every taxable coin earned past the threshold

/**
 * Apply income tax to a gross reward.
 *
 * @param {number} gross  Gross coins about to be credited.
 * @param {object} userData  The live economy user record.
 * @param {object} [opts]
 * @param {number} [opts.threshold=TAX_THRESHOLD]
 * @param {number} [opts.rate=TAX_RATE_DEFAULT]
 * @returns {{ net: number, tax: number, rate: number, taxed: boolean }}
 */
function applyIncomeTax(gross, userData, opts = {}) {
    const grossInt = Math.max(0, Math.floor(Number(gross) || 0));
    if (grossInt <= 0) {
        return { net: 0, tax: 0, rate: 0, taxed: false };
    }

    const threshold = Number(opts.threshold ?? TAX_THRESHOLD);
    const rate      = Number(opts.rate      ?? TAX_RATE_DEFAULT);

    const wealth = (Number(userData?.coins) || 0) + (Number(userData?.bank) || 0);
    if (wealth < threshold) {
        return { net: grossInt, tax: 0, rate: 0, taxed: false };
    }

    const tax = Math.floor(grossInt * rate);
    const net = grossInt - tax;
    return { net, tax, rate, taxed: true };
}

/**
 * Format a one-line "-X coins tax (18%)" footnote for replies. Returns
 * an empty string when there's no tax so callers can drop the line in
 * unconditionally.
 */
function formatTaxFootnote(taxResult, currencyName = 'coins') {
    if (!taxResult || !taxResult.taxed || !taxResult.tax) return '';
    const pct = Math.round(taxResult.rate * 100);
    return `-# 🏛️ Wealth tax: \`-${taxResult.tax.toLocaleString()}\` ${currencyName} *(${pct}% on income above ${TAX_THRESHOLD.toLocaleString()})*`;
}

module.exports = {
    applyIncomeTax,
    formatTaxFootnote,
    TAX_THRESHOLD,
    TAX_RATE_DEFAULT,
};
