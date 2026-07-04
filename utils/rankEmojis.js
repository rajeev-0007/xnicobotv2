'use strict';

/**
 * rankEmojis.js — Rank badge emoji IDs for leaderboards.
 *
 * After uploading the badge images from assets/emojis/ to your bot's
 * emoji server, replace the placeholder IDs below with the real ones.
 *
 * Used by: liveleaderboard, messages leaderboard, any ranked display.
 */

// Replace these with your actual emoji IDs after uploading
const RANK_EMOJIS = {
    1: '<:rank1:1522972998569689098>',  // Champion — wings + 3 hearts
    2: '<:rank2:1522973001849770044>',  // Runner up — wings + heart + chevrons  
    3: '<:rank3:1522973004378935486>',  // Third — wings + heart
    4: '<:rank4:1522973006874279936>',  // 4th — shield + 2 chevrons
    5: '<:rank5:1522973009525080176>',  // 5th — shield + 3 chevrons
    6: '<:rank6:1522973012385599519>',  // 6th — wings + single heart (large)
    7: '<:rank7:1522973015002976297>',  // 7th — wings + heart + chevrons (small)
};

// Trophy emoji for top 3 (use in text messages, not canvas)
const TROPHY = '<:Crown:1521227739988889764>';

/**
 * Get the rank emoji string for a given position.
 * Falls back to a plain number for ranks > 7.
 */
function getRankEmoji(rank) {
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
    TROPHY,
    getRankEmoji,
    getRankLabel,
};
