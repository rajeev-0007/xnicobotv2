'use strict';

/**
 * rankEmojis.js — Rank badges (1–10) for leaderboards.
 *
 * The badge images live in assets/emojis/rank1.png … rank10.png and are
 * uploaded to the bot's Application Emojis automatically (via the manifest +
 * emojiAutoSync). At runtime:
 *   • Message text  → getRankEmoji() resolves the live app emoji by NAME
 *     (rank<N>) through emojiGuard, so it always points at the current upload
 *     — no hardcoded/stale IDs. Falls back to `#N` text before the guard loads.
 *   • Canvas cards  → load the local PNG files directly (RANK_BADGE_FILES).
 *
 * Used by: liveleaderboard, unified /leaderboard, invite/anime leaderboards.
 */

const path = require('path');

// Local badge PNGs — the single source of truth for canvas rendering.
const RANK_BADGE_FILES = {};
for (let i = 1; i <= 10; i++) {
    RANK_BADGE_FILES[i] = path.join(__dirname, `../assets/emojis/rank${i}.png`);
}

// Real Application Emoji IDs (uploaded via scripts/sync-emojis.js). Used as a
// solid fallback for message text when the live guard registry isn't loaded.
const RANK_EMOJIS = {
    1:  '<:rank1:1526519368245055678>',
    2:  '<:rank2:1526519372271714464>',
    3:  '<:rank3:1526519376529068062>',
    4:  '<:rank4:1526519380379308134>',
    5:  '<:rank5:1526519384234004623>',
    6:  '<:rank6:1526519390432919582>',
    7:  '<:rank7:1526519394388148247>',
    8:  '<:rank8:1525949016536256656>',
    9:  '<:rank9:1525949019409354833>',
    10: '<:rank10:1525949013843775620>',
};

// CDN URLs (from the same IDs) — canvas fallback if a local PNG is missing.
const RANK_BADGE_URLS = {};
for (const [n, tag] of Object.entries(RANK_EMOJIS)) {
    const id = tag.match(/:(\d+)>/)[1];
    RANK_BADGE_URLS[n] = `https://cdn.discordapp.com/emojis/${id}.png`;
}

// Trophy emoji for top 3 (use in text messages, not canvas).
const TROPHY = '<:Crown:1521227739988889764>';

/**
 * Rank emoji string for a position.
 *   1. Live application emoji by name (rank<N>) via emojiGuard.
 *   2. Hardcoded real app-emoji ID (RANK_EMOJIS).
 *   3. Plain `#N` text (ranks > 10, or when nothing is available).
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

/** Text label for canvas rendering (no emoji). */
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
