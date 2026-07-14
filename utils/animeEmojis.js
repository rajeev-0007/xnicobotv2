'use strict';

/**
 * animeEmojis.js — Centralized custom-emoji map for the anime gacha system.
 *
 * Mirrors utils/economyEmojis.js. Use these instead of hardcoded Unicode
 * emojis so the anime commands share the bot's branded emoji set and stay
 * consistent. Every ID here is a REAL app emoji already used elsewhere in
 * the codebase (verified against the existing `<:Name:ID>` references) —
 * do NOT invent IDs, a wrong ID renders as broken text.
 *
 * NOTE ON RARITIES: the rarity tiers keep their colored-circle Unicode
 * (⚪🟢🔵🟣🟡🔴). There is no colored-gem custom emoji in the app set, and
 * the circles are the clearest, most professional ascending-tier indicator
 * that renders on every client. Forcing an unrelated custom emoji there
 * would look worse — so rarities stay as-is by design.
 *
 * NOTE ON CANVAS: custom emojis are message-only. They CANNOT be drawn on a
 * canvas (the Inter font has no emoji glyphs). Never put these strings into
 * canvas text — see utils/animeCardCanvas.js which uses clean typography.
 */

const EMOJIS = {
    // Collection / cards
    card:      '<:Box:1521228152414666833>',
    cards:     '<:Box:1521228152414666833>',
    box:       '<:Box:1521228152414666833>',
    collection:'<:Folder:1521228095225331765>',

    // Currency / value
    money:     '<:Money:1521228266957045900>',
    value:     '<:Money:1521228266957045900>',
    spent:     '<:Money:1521228266957045900>',

    // Rolling / gacha
    roll:      '<:Gamepad:1521228035213230090>',
    gacha:     '<:Gamepad:1521228035213230090>',
    shuffle:   '<:Shuffle:1521228321403437228>',
    refresh:   '<:Refresh:1521227946441052420>',

    // Trading / social
    trade:     '<:transfer:1521228019824590948>',
    transfer:  '<:transfer:1521228019824590948>',
    gift:      '<:Present:1521228115655917659>',
    present:   '<:Present:1521228115655917659>',
    heart:     '<:Heart:1521228100652765247>',
    favorite:  '<:Heart:1521228100652765247>',
    wishlist:  '<:Bookmark:1521227835526742066>',

    // Progress / stats / info
    stats:     '<:Inforect:1521228008285929532>',
    progress:  '<:Inforect:1521228008285929532>',
    chart:     '<:Inforect:1521228008285929532>',
    info:      '<:Infocircle:1521227700835057685>',
    search:    '<:Search:1521228231263387738>',
    user:      '<:User:1521227714227343380>',
    book:      '<:Book:1521228246748889179>',
    server:    '<:Server:1521228371051413546>',

    // Prestige / highlights
    shield:    '<:Shield:1521227694677692467>',
    trophy:    '<:Crown:1521227739988889764>',
    crown:     '<:Crown:1521227739988889764>',
    award:     '<:Award:1521228119640375336>',
    star:      '<:Star:1521227981685526568>',
    fire:      '<:Fire:1521227907647668374>',
    sparkle:   '<:Sketch:1521228025365004471>',
    lightning: '<:Lightning:1521227915537285150>',

    // Feedback
    check:     '<:Checkedbox:1521227734943269077>',
    cancel:    '<:Cancel:1521227723916181644>',
    lock:      '<:Lock:1521227892770734120>',
    warn:      '<:Infotriangle:1521227710381428926>',
    clock:     '<:Clock:1521228110408847623>',
    sandwatch: '<:Sandwatch:1521228272426418367>',
    upload:    '<:Upload:1521228365120405537>',
    download:  '<:Download:1521228191899975810>',
    // NOTE: rank badges are NOT defined here anymore. Leaderboard rank badges
    // live in utils/rankEmojis.js (rank1–rank10, resolved live by name), and
    // rarity crystal badges live in utils/rarityBadges.js. Keeping them out of
    // here avoids stale/duplicate emoji IDs.
};

/**
 * Ordered rank-badge emojis for leaderboard positions (1-based).
 * Delegates to the canonical rank badge source (utils/rankEmojis.js) so
 * every leaderboard in the bot shares one badge set (ranks 1–10).
 * @param {number} position 1-based rank
 * @returns {string}
 */
const { getRankEmoji } = require('./rankEmojis');
function rankBadge(position) {
    return getRankEmoji(position);
}

module.exports = { EMOJIS, rankBadge };
