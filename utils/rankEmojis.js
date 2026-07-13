'use strict';

/**
 * rankEmojis.js — Rank badge emoji IDs for leaderboards.
 *
 * After uploading the badge images from assets/emojis/ to your bot's
 * emoji server, replace the placeholder IDs below with the real ones.
 *
 * Used by: liveleaderboard, messages leaderboard, any ranked display.
 */

// Discord custom emoji references (update IDs after uploading to your server)
const RANK_EMOJIS = {
    1:  '<:rank1:1522973015002976297>',
    2:  '<:rank2:1522973012385599519>',
    3:  '<:rank3:1522973009525080176>',
    4:  '<:rank4:1522973006874279936>',
    5:  '<:rank5:1522973004378935486>',
    6:  '<:rank6:1522973001849770044>',
    7:  '<:rank7:1522972998569689098>',
    8:  '<:rank8:1522972998569689098>',  // placeholder — update after upload
    9:  '<:rank9:1522972998569689098>',  // placeholder — update after upload
    10: '<:rank10:1522972998569689098>', // placeholder — update after upload
};

// CDN URLs for canvas rendering (these are pulled from the emoji IDs above)
// Update these after uploading your badge images to Discord
const RANK_BADGE_URLS = {
    1:  'https://cdn.discordapp.com/emojis/1522973015002976297.png',
    2:  'https://cdn.discordapp.com/emojis/1522973012385599519.png',
    3:  'https://cdn.discordapp.com/emojis/1522973009525080176.png',
    4:  'https://cdn.discordapp.com/emojis/1522973006874279936.png',
    5:  'https://cdn.discordapp.com/emojis/1522973004378935486.png',
    6:  'https://cdn.discordapp.com/emojis/1522973001849770044.png',
    7:  'https://cdn.discordapp.com/emojis/1522972998569689098.png',
    8:  'https://cdn.discordapp.com/emojis/1522972998569689098.png',  // placeholder
    9:  'https://cdn.discordapp.com/emojis/1522972998569689098.png',  // placeholder
    10: 'https://cdn.discordapp.com/emojis/1522972998569689098.png',  // placeholder
};

// Local file paths for canvas rendering (fallback if CDN fails)
const path = require('path');
const RANK_BADGE_FILES = {};
for (let i = 1; i <= 10; i++) {
    RANK_BADGE_FILES[i] = path.join(__dirname, `../assets/emojis/rank${i}.png`);
}

// Trophy emoji for top 3 (use in text messages, not canvas)
const TROPHY = '<:Crown:1521227739988889764>';

/**
 * Get the rank emoji string for a given position.
 * Resolution order:
 *   1. Live application emoji by name (rank<N>) via emojiGuard.
 *   2. Configured custom emoji in RANK_EMOJIS.
 *   3. Plain `#N` text for ranks > 10 or when nothing is available.
 */
function getRankEmoji(rank) {
    try {
        const guard = require('./emojiGuard');
        if (typeof guard.remapByName === 'function') {
            const tag = guard.remapByName(`rank${rank}`);
            if (tag) return tag;
        }
    } catch { /* guard not ready — fall through */ }
    return RANK_EMOJIS[rank] || `\`#${rank}\``;
}

/**
 * Get rank label for canvas rendering (no emoji, just text).
 */
function getRankLabel(rank) {
    if (rank === 1) return '1ST';
    if (rank === 2) return '2ND';
    if (rank === 3) return '3RD';
    return `#${rank}`;
}

module.exports = {
    RANK_EMOJIS,
    RANK_BADGE_URLS,
    RANK_BADGE_FILES,
    TROPHY,
    getRankEmoji,
    getRankLabel,
};
