'use strict';

/**
 * rarityBadges.js — Single source of truth for the 6 rarity tiers shared by
 * the anime gacha system and the economy pets/weapons system.
 *
 * Provides:
 *   • RARITY_META      — name, color, order index per tier
 *   • RARITY_EMOJIS    — Discord custom emoji strings (update IDs after upload)
 *   • RARITY_FALLBACK  — Unicode circle used until custom emojis are uploaded
 *   • RARITY_BADGE_FILES — local crystal-badge PNG paths for canvas rendering
 *   • getRarityEmoji(tier)  — message emoji (custom if set, else Unicode)
 *   • loadRarityBadge(tier) — canvas image (local file, cached)
 *
 * Canvas cards should use loadRarityBadge(); message text should use
 * getRarityEmoji().
 */

const path = require('path');
const fs = require('fs');

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

const RARITY_META = {
    common:    { name: 'Common',    color: 0x95A5A6, index: 0 },
    uncommon:  { name: 'Uncommon',  color: 0x2ECC71, index: 1 },
    rare:      { name: 'Rare',      color: 0x3498DB, index: 2 },
    epic:      { name: 'Epic',      color: 0x9B59B6, index: 3 },
    legendary: { name: 'Legendary', color: 0xF1C40F, index: 4 },
    mythic:    { name: 'Mythic',    color: 0xE74C3C, index: 5 },
};

// Discord custom emoji references. Replace the IDs below after uploading the
// assets/emojis/rarity_<tier>.png crystals to your bot's emoji server.
// Until then getRarityEmoji() returns the Unicode fallback so nothing breaks.
const RARITY_EMOJIS = {
    common:    '<:rarity_common:0>',
    uncommon:  '<:rarity_uncommon:0>',
    rare:      '<:rarity_rare:0>',
    epic:      '<:rarity_epic:0>',
    legendary: '<:rarity_legendary:0>',
    mythic:    '<:rarity_mythic:0>',
};

// Clean Unicode fallback (renders on every client). Used while the custom
// emoji IDs above are still placeholders (id === 0).
const RARITY_FALLBACK = {
    common: '⚪', uncommon: '🟢', rare: '🔵',
    epic: '🟣', legendary: '🟡', mythic: '🔴',
};

const RARITY_BADGE_FILES = {};
for (const tier of RARITY_ORDER) {
    RARITY_BADGE_FILES[tier] = path.join(__dirname, `../assets/emojis/rarity_${tier}.png`);
}

/** Is a custom emoji configured (non-placeholder) for this tier? */
function hasCustomEmoji(tier) {
    const e = RARITY_EMOJIS[tier];
    return !!e && !/:0>$/.test(e);
}

/**
 * Message emoji for a rarity tier.
 * Resolution order:
 *   1. Live application emoji by name (rarity_<tier>) via emojiGuard — this is
 *      how the rest of the bot resolves its uploaded app emojis at runtime.
 *   2. A configured custom emoji string (non-placeholder) in RARITY_EMOJIS.
 *   3. Unicode circle fallback (always renders).
 */
function getRarityEmoji(tier) {
    const key = String(tier || '').toLowerCase();
    // 1) live app emoji by name
    try {
        const guard = require('./emojiGuard');
        if (typeof guard.remapByName === 'function') {
            const tag = guard.remapByName(`rarity_${key}`);
            if (tag) return tag;
        }
    } catch { /* guard not ready — fall through */ }
    // 2) explicit custom emoji
    if (hasCustomEmoji(key)) return RARITY_EMOJIS[key];
    // 3) Unicode fallback
    return RARITY_FALLBACK[key] || RARITY_FALLBACK.common;
}

// Small in-process cache for loaded canvas badge images.
const _badgeCache = new Map();

/**
 * Load the crystal badge image for canvas rendering. Returns a canvas Image
 * or null if the file is missing. Cached after first load.
 * @param {string} tier
 * @param {(p:string)=>Promise<any>} loadImage - @napi-rs/canvas loadImage
 */
async function loadRarityBadge(tier, loadImage) {
    const key = String(tier || '').toLowerCase();
    if (_badgeCache.has(key)) return _badgeCache.get(key);

    const file = RARITY_BADGE_FILES[key];
    if (!file || !fs.existsSync(file) || typeof loadImage !== 'function') {
        _badgeCache.set(key, null);
        return null;
    }
    try {
        const img = await loadImage(file);
        _badgeCache.set(key, img);
        return img;
    } catch {
        _badgeCache.set(key, null);
        return null;
    }
}

module.exports = {
    RARITY_ORDER,
    RARITY_META,
    RARITY_EMOJIS,
    RARITY_FALLBACK,
    RARITY_BADGE_FILES,
    getRarityEmoji,
    loadRarityBadge,
    hasCustomEmoji,
};
