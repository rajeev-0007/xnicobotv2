/**
 * Bot Customization Utility
 * Centralized access to per-guild bot customization settings.
 * Used by commands and handlers to respect guild-specific config.
 */


const jsonStore = require('./jsonStore');

const EMBED_COLORS = {
    'colorless': { name: 'Colorless', color: null },
    'default': { name: 'Default', color: 0xCAD7E6 },
    'red': { name: 'Red', color: 0xED4245 },
    'green': { name: 'Green', color: 0x57F287 },
    'yellow': { name: 'Yellow', color: 0xFEE75C },
    'purple': { name: 'Purple', color: 0x9B59B6 },
    'pink': { name: 'Pink', color: 0xEB459E },
    'orange': { name: 'Orange', color: 0xE67E22 },
    'teal': { name: 'Teal', color: 0x1ABC9C },
    'gold': { name: 'Gold', color: 0xF1C40F },
    'navy': { name: 'Navy', color: 0x34495E },
    'black': { name: 'Black', color: 0x23272A },
    'white': { name: 'White', color: 0xFFFFFF }
};

const DEFAULTS = {
    nickname: null,
    avatarUrl: null,
    bannerUrl: null,
    aboutText: null,
    prefix: null,
    embedColor: 'default',
    footerText: null,
    footerIcon: null,
    language: 'en',
    dmOnJoin: false,
    dmMessage: null,
    commandCooldown: 5,
    deleteCommands: false,
    ephemeralResponses: false
};

// In-memory cache with TTL to avoid reading disk on every command
let _cache = {};
let _cacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds

function _loadConfig() {
    const now = Date.now();
    if (now - _cacheTime < CACHE_TTL && Object.keys(_cache).length > 0) {
        return _cache;
    }
    try {
        if (jsonStore.has('bot-customize')) {
            _cache = jsonStore.read('bot-customize');
            _cacheTime = now;
            return _cache;
        }
    } catch (e) {}
    _cache = {};
    _cacheTime = now;
    return _cache;
}

/**
 * Get the full guild customization config with defaults applied.
 * @param {string} guildId
 * @returns {object} Config with all keys guaranteed
 */
function getConfig(guildId) {
    if (!guildId) return { ...DEFAULTS };
    const all = _loadConfig();
    return { ...DEFAULTS, ...(all[guildId] || {}) };
}

/**
 * Get the resolved embed color (as integer) for a guild.
 * @param {string} guildId
 * @returns {number} Color integer
 */
function getEmbedColor(guildId) {
    const cfg = getConfig(guildId);
    const entry = EMBED_COLORS[cfg.embedColor];
    // Return null for 'colorless' so the runtime patcher skips setting accent_color
    if (!entry || entry.color === null) return null;
    return entry.color;
}

/**
 * Get the resolved embed color name for a guild.
 * @param {string} guildId
 * @returns {string} Color name
 */
function getEmbedColorName(guildId) {
    const cfg = getConfig(guildId);
    return EMBED_COLORS[cfg.embedColor]?.name || 'Default Blue';
}

/**
 * Get the custom footer text for a guild (or null).
 * @param {string} guildId
 * @returns {string|null}
 */
function getFooterText(guildId) {
    return getConfig(guildId).footerText;
}

/**
 * Get the custom footer icon URL for a guild (or null).
 * @param {string} guildId
 * @returns {string|null}
 */
function getFooterIcon(guildId) {
    return getConfig(guildId).footerIcon;
}

/**
 * Get the per-server banner URL (or null).
 * @param {string} guildId
 * @returns {string|null}
 */
function getBannerUrl(guildId) {
    return getConfig(guildId).bannerUrl;
}

/**
 * Get the per-server about/bio text (or null).
 * @param {string} guildId
 * @returns {string|null}
 */
function getAboutText(guildId) {
    return getConfig(guildId).aboutText;
}

/**
 * Get command cooldown in seconds for a guild.
 * @param {string} guildId
 * @returns {number}
 */
function getCooldown(guildId) {
    return getConfig(guildId).commandCooldown;
}

/**
 * Whether ephemeral responses are enabled for a guild.
 * @param {string} guildId
 * @returns {boolean}
 */
function isEphemeral(guildId) {
    return getConfig(guildId).ephemeralResponses;
}

/**
 * Whether command messages should be auto-deleted.
 * @param {string} guildId
 * @returns {boolean}
 */
function shouldDeleteCommands(guildId) {
    return getConfig(guildId).deleteCommands;
}

/**
 * Invalidate the in-memory cache (call after writes).
 */
function invalidateCache() {
    _cacheTime = 0;
    _cache = {};
}

module.exports = {
    getConfig,
    getEmbedColor,
    getEmbedColorName,
    getFooterText,
    getFooterIcon,
    getBannerUrl,
    getAboutText,
    getCooldown,
    isEphemeral,
    shouldDeleteCommands,
    invalidateCache,
    EMBED_COLORS,
    DEFAULTS
};
