/**
 * Currency Helper — per-guild currency + economy settings.
 *
 * Reads from jsonStore 'economy-settings':
 *   { [guildId]: {
 *       currency, currencyName,
 *       dailyReward, weeklyReward,
 *       workMinReward, workMaxReward,
 *       robChance, startingBalance,
 *       robEnabled, gamblingEnabled, shopEnabled
 *     }
 *   }
 *
 * The dashboard writes these via `PUT /api/guild/:id/economy-settings`
 * (dashboard/server.js). Until this helper exposed them, none of the
 * economy commands actually consulted the saved values — a server
 * could change "Daily Reward" in the dashboard and the bot kept
 * paying out the hardcoded random range. Now `getEconomySettings()`
 * returns a fully-defaulted object so commands can read once at the
 * top and apply the values directly.
 *
 * Usage:
 *   const helper = require('../../utils/currencyHelper');
 *   const cfg = helper.getEconomySettings(message.guild?.id);
 *   if (!cfg.gamblingEnabled) return message.reply('Gambling is disabled here.');
 *   const reward = helper.rollReward(cfg.workMin, cfg.workMax);
 */

const jsonStore = require('./jsonStore');

const DEFAULT_CURRENCY = '💰';
const DEFAULT_CURRENCY_NAME = 'coins';

// Default ranges match the historical hardcoded values in the
// commands so behaviour is unchanged when no dashboard config exists.
const DEFAULTS = Object.freeze({
    currency: DEFAULT_CURRENCY,
    currencyName: DEFAULT_CURRENCY_NAME,
    // Daily: random base reward between dailyMin..dailyMax (legacy was 500..1000)
    dailyMin: 500,
    dailyMax: 1000,
    // Weekly: legacy was 3000..6000
    weeklyMin: 3000,
    weeklyMax: 6000,
    // Work: legacy was 100..300 base earn
    workMin: 100,
    workMax: 300,
    // Rob: percent chance of success
    robChance: 50,
    startingBalance: 0,
    robEnabled: true,
    gamblingEnabled: true,
    shopEnabled: true
});

function loadSettings() {
    try { return jsonStore.peek('economy-settings') || {}; } catch { return {}; }
}

function getGuildSettings(guildId) {
    if (!guildId) return {};
    const all = loadSettings();
    return all[guildId] || {};
}

/**
 * Return a fully-defaulted economy settings object for a guild.
 * The dashboard stores `dailyReward` / `weeklyReward` as a single
 * "max" target with a min anchored at half — we expand that here so
 * commands can use a min/max range as before.
 */
function getEconomySettings(guildId) {
    const s = getGuildSettings(guildId);
    const num = (v, fallback) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : fallback;
    };
    const bool = (v, fallback) => typeof v === 'boolean' ? v : fallback;

    // Dashboard exposes a single dailyReward/weeklyReward number; treat
    // it as the cap and randomize within [cap/2, cap] so the values
    // still feel rewarding without being identical every claim.
    const dailyMax = num(s.dailyReward, DEFAULTS.dailyMax);
    const dailyMin = Math.max(1, Math.floor(dailyMax / 2));
    const weeklyMax = num(s.weeklyReward, DEFAULTS.weeklyMax);
    const weeklyMin = Math.max(1, Math.floor(weeklyMax / 2));

    return {
        currency: typeof s.currency === 'string' && s.currency ? s.currency : DEFAULTS.currency,
        currencyName: typeof s.currencyName === 'string' && s.currencyName ? s.currencyName : DEFAULTS.currencyName,

        dailyMin, dailyMax,
        weeklyMin, weeklyMax,

        workMin: num(s.workMinReward, DEFAULTS.workMin),
        workMax: num(s.workMaxReward, DEFAULTS.workMax),

        robChance: Math.min(100, Math.max(0, num(s.robChance, DEFAULTS.robChance))),
        startingBalance: num(s.startingBalance, DEFAULTS.startingBalance),

        robEnabled: bool(s.robEnabled, DEFAULTS.robEnabled),
        gamblingEnabled: bool(s.gamblingEnabled, DEFAULTS.gamblingEnabled),
        shopEnabled: bool(s.shopEnabled, DEFAULTS.shopEnabled)
    };
}

/** Roll a random integer in [min, max] (inclusive). Safe for swapped args. */
function rollReward(min, max) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    if (hi <= lo) return lo;
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

function getCurrency(guildId) {
    return getEconomySettings(guildId).currency;
}

function getCurrencyName(guildId) {
    return getEconomySettings(guildId).currencyName;
}

/**
 * Always returns the live currency symbol for a guild.
 *
 * Use this in place of any hardcoded `<:Money:…>` emoji so that when
 * an admin runs `/currency set <:Sketch:…> gems`, every economy
 * command (balance / shop / games / pay / rob / leaderboard / etc.)
 * picks up the new icon immediately. Without this helper, files that
 * baked the default `<:Money:…>` emoji into their own strings ignored
 * the per-guild override and kept showing the default.
 *
 * Falls back to the default currency emoji when no guildId is provided
 * (e.g. owner-only or non-guild contexts).
 */
function coinIcon(guildId) {
    if (!guildId) return DEFAULTS.currency;
    return getEconomySettings(guildId).currency || DEFAULTS.currency;
}

/**
 * Returns the guild's currency icon **only if** it is a valid value
 * for `ButtonBuilder#setEmoji` / select-menu `emoji` fields — i.e. a
 * unicode emoji or a `<:NAME:ID>` / `<a:NAME:ID>` custom emoji.
 *
 * The dashboard accepts free-form text in the currency field
 * (`$`, `coins`, `gold`, etc.) so callers that pass `coinIcon(...)`
 * straight into `setEmoji(...)` end up with Discord rejecting the
 * payload as `INVALID_FORM_BODY: emoji`. Use this helper everywhere
 * we're rendering an emoji on a component button/menu instead, and
 * fall back gracefully (return null) when the configured currency
 * isn't actually emoji-shaped.
 */
const CUSTOM_EMOJI_RE = /^<a?:[A-Za-z0-9_]+:\d{10,}>$/;
let _emojiRegex = null;
function _isUnicodeEmoji(str) {
    if (typeof str !== 'string' || !str) return false;
    try {
        if (!_emojiRegex) _emojiRegex = require('emoji-regex')();
        // Reset state for global regex
        _emojiRegex.lastIndex = 0;
        const m = _emojiRegex.exec(str);
        return !!m && m[0] === str;
    } catch {
        // Fallback: match a single non-ASCII character.
        return /^[^\u0000-\u007F]+$/.test(str) && [...str].length <= 4;
    }
}

function coinEmoji(guildId) {
    const raw = coinIcon(guildId);
    if (typeof raw !== 'string' || !raw) return null;
    if (CUSTOM_EMOJI_RE.test(raw)) return raw;
    if (_isUnicodeEmoji(raw)) return raw;
    return null;
}

function formatCoins(amount, guildId) {
    const cfg = getEconomySettings(guildId);
    const formatted = Number(amount || 0).toLocaleString();
    return `${cfg.currency} ${formatted} ${cfg.currencyName}`;
}

/**
 * Returns just the number + currency name, **without** the icon.
 *
 * Use this whenever the caller already prints `${coinIcon(...)}` on the
 * same line — otherwise the icon is rendered twice. Example:
 *   `${coinIcon(g)} **Balance:** ${formatCoinsAmount(amt, g)}`
 *   →  💰 **Balance:** 1,000 coins
 *
 * `formatCoins(...)` (with the icon baked in) stays available for code
 * that doesn't want to manage the icon separately.
 */
function formatCoinsAmount(amount, guildId) {
    const cfg = getEconomySettings(guildId);
    const formatted = Number(amount || 0).toLocaleString();
    return `${formatted} ${cfg.currencyName}`;
}

function formatCoinsShort(amount, guildId) {
    const cfg = getEconomySettings(guildId);
    return `${cfg.currency} ${Number(amount || 0).toLocaleString()}`;
}

module.exports = {
    DEFAULT_CURRENCY,
    DEFAULT_CURRENCY_NAME,
    DEFAULTS,
    getCurrency,
    getCurrencyName,
    coinIcon,
    coinEmoji,
    formatCoins,
    formatCoinsAmount,
    formatCoinsShort,
    getGuildSettings,
    getEconomySettings,
    rollReward,
    loadSettings
};
