'use strict';

/**
 * canvasWarmup.js — pre-fetches the most-used emoji assets at startup
 * so the very first card render doesn't pay download latency.
 *
 * The list covers:
 *   • Every Discord custom emoji ID referenced from canvasEmojiDefaults
 *     (medals, money, fire, lightning, shield, gamepad, …).
 *   • The hand-curated Twemoji glyphs used most often by economy and
 *     fun cards (animals, faces, hearts, medals, food).
 *
 * Everything else is loaded on-demand. The persistent disk cache means
 * even rare emojis are only fetched the first time they're seen — this
 * warmup just shortcuts the very first render after a fresh deploy.
 */

const imageCache = require('./imageCache');
const { getCanvasEmojiAssetUrl } = require('./canvasEmojiDefaults');

// Plain Unicode emojis that show up across cards. Anything in the
// design-icon overrides table (💰 → Money) is already handled; the
// list below is for the long tail (animals, faces, food …).
const COMMON_UNICODE_EMOJIS = [
    // Medals + trophies
    '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️',
    // Faces / reactions
    '😀', '😂', '😭', '😍', '🥰', '😎', '🤔', '😬', '🤷',
    // Hearts
    '❤️', '💖', '💗', '💕', '💞', '💔', '💘', '💍',
    // Animals (hunt + pet system)
    '🐶', '🐱', '🐭', '🐰', '🦊', '🐺', '🐻', '🐼', '🐯', '🦁',
    '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🦅', '🦉', '🦇',
    '🐗', '🐴', '🦌', '🐢', '🐍', '🐙', '🦀', '🐠', '🐟', '🐡',
    '🦈', '🐳', '🐋', '🐬', '🦦', '🦔', '🐉', '🦄',
    // Fish / fishing
    '🎣', '🪝',
    // Food / cooking
    '🍎', '🍌', '🍊', '🍇', '🍓', '🍒', '🍑', '🍍', '🥭', '🥥',
    '🍞', '🧀', '🍔', '🍕', '🌮', '🍣', '🍱', '🍜', '🍪', '🍰',
    // Games / slots
    '🎲', '🎯', '🎱', '🎰', '🃏', '🎮', '🕹️',
    // Adventure / map
    '🗺️', '⛰️', '🏞️', '🏝️', '🌋', '🏰', '🗡️', '⚔️',
    // Misc UI
    '<:Checkedbox:1521227734943269077>', '<:Cancel:1521227723916181644>', '⚠️', '⏳', '⌛', '⭐', '<:Star:1521227981685526568>', '🔥', '⚡', '💀',
    '🚀', '🌍', '🏠', '📍', '💰', '💵', '🪙', '💎', '👤', '🤖',
];

/**
 * Resolve every emoji to its CDN URL and pre-load it.
 * Returns the number of unique URLs warmed up.
 */
async function warmupCanvasEmojis({ concurrency = 8, timeout = 8000 } = {}) {
    const urls = new Set();
    for (const e of COMMON_UNICODE_EMOJIS) {
        const u = getCanvasEmojiAssetUrl(e);
        if (u) urls.add(u);
    }
    // Also pull every URL referenced by the canvasEmojiDefaults table
    // — the design-icon emojis (Money, Fire, Shield, …).
    const { _designEmojiUrls } = require('./canvasEmojiDefaults');
    if (Array.isArray(_designEmojiUrls)) {
        for (const u of _designEmojiUrls) urls.add(u);
    }

    const list = [...urls];
    await imageCache.warm(list, { concurrency, timeout });
    return list.length;
}

module.exports = { warmupCanvasEmojis, COMMON_UNICODE_EMOJIS };
