'use strict';

/**
 * Anime Collection Manager
 * ─────────────────────────────────────────────────────────────────────────
 * Handles the anime gacha/collection system — rolling characters, managing
 * inventories, trading, wishlists, and collection stats.
 *
 * Uses the same jsonStore/PostgreSQL backend as the economy system.
 */

const jsonStore = require('./jsonStore');
const log = require('./logger-styled');
const animeApi = require('./animeApi');
const { EMOJIS: AE } = require('./animeEmojis');
const { getRarityEmoji } = require('./rarityBadges');

/* ═══════════════════════════════════════════════════════
   RARITY SYSTEM
   ═══════════════════════════════════════════════════════
   Emoji is sourced from the shared rarityBadges helper so the anime and
   economy (pets/weapons) systems use one consistent rarity emoji set.
   Returns branded custom emojis once uploaded, else Unicode circle fallback.
*/

// `emoji` is a getter so it resolves the live application emoji at usage time
// (app emojis aren't loaded yet when this module is first required).
const RARITIES = {
    common:    { name: 'Common',    get emoji() { return getRarityEmoji('common'); },    color: 0x95A5A6, weight: 50, value: 50 },
    uncommon:  { name: 'Uncommon',  get emoji() { return getRarityEmoji('uncommon'); },  color: 0x2ECC71, weight: 25, value: 150 },
    rare:      { name: 'Rare',      get emoji() { return getRarityEmoji('rare'); },      color: 0x3498DB, weight: 14, value: 400 },
    epic:      { name: 'Epic',      get emoji() { return getRarityEmoji('epic'); },      color: 0x9B59B6, weight: 7,  value: 1000 },
    legendary: { name: 'Legendary', get emoji() { return getRarityEmoji('legendary'); }, color: 0xF1C40F, weight: 3,  value: 3000 },
    mythic:    { name: 'Mythic',    get emoji() { return getRarityEmoji('mythic'); },    color: 0xE74C3C, weight: 1,  value: 10000 },
};

/* ═══════════════════════════════════════════════════════
   ANIME CHARACTER DATABASE
   ═══════════════════════════════════════════════════════ */

// Fallback pool — used only if the AniList API pool hasn't loaded yet.
const FALLBACK_CHARACTERS = [
    // ── Mythic ──
    { id: 'goku_ui', name: 'Goku (Ultra Instinct)', anime: 'Dragon Ball Super', rarity: 'mythic', image: 'https://i.imgur.com/QkN2BNZ.png' },
    { id: 'naruto_baryon', name: 'Naruto (Baryon Mode)', anime: 'Boruto', rarity: 'mythic', image: 'https://i.imgur.com/sJ5LNHP.png' },
    { id: 'saitama', name: 'Saitama', anime: 'One Punch Man', rarity: 'mythic', image: 'https://i.imgur.com/qHrXKaG.png' },
    { id: 'madara', name: 'Madara Uchiha', anime: 'Naruto Shippuden', rarity: 'mythic', image: 'https://i.imgur.com/VZqDL5Y.png' },
    { id: 'gojo', name: 'Gojo Satoru', anime: 'Jujutsu Kaisen', rarity: 'mythic', image: 'https://i.imgur.com/qXk1pN3.png' },

    // ── Legendary ──
    { id: 'itachi', name: 'Itachi Uchiha', anime: 'Naruto', rarity: 'legendary', image: 'https://i.imgur.com/LmRDXnA.png' },
    { id: 'levi', name: 'Levi Ackerman', anime: 'Attack on Titan', rarity: 'legendary', image: 'https://i.imgur.com/sTFkVRC.png' },
    { id: 'zoro', name: 'Roronoa Zoro', anime: 'One Piece', rarity: 'legendary', image: 'https://i.imgur.com/HVw8VaC.png' },
    { id: 'luffy_g5', name: 'Luffy (Gear 5)', anime: 'One Piece', rarity: 'legendary', image: 'https://i.imgur.com/J4r7KmT.png' },
    { id: 'vegeta_ue', name: 'Vegeta (Ultra Ego)', anime: 'Dragon Ball Super', rarity: 'legendary', image: 'https://i.imgur.com/TRpNqAH.png' },
    { id: 'sukuna', name: 'Ryomen Sukuna', anime: 'Jujutsu Kaisen', rarity: 'legendary', image: 'https://i.imgur.com/ZcSuNwM.png' },
    { id: 'aizen', name: 'Sosuke Aizen', anime: 'Bleach', rarity: 'legendary', image: 'https://i.imgur.com/dVq5NxL.png' },
    { id: 'guts', name: 'Guts (Berserker Armor)', anime: 'Berserk', rarity: 'legendary', image: 'https://i.imgur.com/R2sHpYK.png' },
    { id: 'rem', name: 'Rem', anime: 'Re:Zero', rarity: 'legendary', image: 'https://i.imgur.com/TqWLK2H.png' },
    { id: 'zero_two', name: 'Zero Two', anime: 'Darling in the Franxx', rarity: 'legendary', image: 'https://i.imgur.com/YNHM5kZ.png' },

    // ── Epic ──
    { id: 'kakashi', name: 'Kakashi Hatake', anime: 'Naruto', rarity: 'epic', image: 'https://i.imgur.com/qkJLR3V.png' },
    { id: 'todoroki', name: 'Shoto Todoroki', anime: 'My Hero Academia', rarity: 'epic', image: 'https://i.imgur.com/8Kp3Z5A.png' },
    { id: 'mikasa', name: 'Mikasa Ackerman', anime: 'Attack on Titan', rarity: 'epic', image: 'https://i.imgur.com/p4vQRLc.png' },
    { id: 'erza', name: 'Erza Scarlet', anime: 'Fairy Tail', rarity: 'epic', image: 'https://i.imgur.com/WnLvHZG.png' },
    { id: 'killua', name: 'Killua Zoldyck', anime: 'Hunter x Hunter', rarity: 'epic', image: 'https://i.imgur.com/YKj8nRL.png' },
    { id: 'tanjiro', name: 'Tanjiro Kamado', anime: 'Demon Slayer', rarity: 'epic', image: 'https://i.imgur.com/gT5KFRD.png' },
    { id: 'nezuko', name: 'Nezuko Kamado', anime: 'Demon Slayer', rarity: 'epic', image: 'https://i.imgur.com/Lh9NJKG.png' },
    { id: 'asta', name: 'Asta', anime: 'Black Clover', rarity: 'epic', image: 'https://i.imgur.com/pY5HL4v.png' },
    { id: 'megumin', name: 'Megumin', anime: 'Konosuba', rarity: 'epic', image: 'https://i.imgur.com/5xN8pTF.png' },
    { id: 'emilia', name: 'Emilia', anime: 'Re:Zero', rarity: 'epic', image: 'https://i.imgur.com/YqT5GzR.png' },
    { id: 'yor', name: 'Yor Forger', anime: 'Spy x Family', rarity: 'epic', image: 'https://i.imgur.com/WVf8q2P.png' },
    { id: 'power', name: 'Power', anime: 'Chainsaw Man', rarity: 'epic', image: 'https://i.imgur.com/Xt6nZRK.png' },
    { id: 'makima', name: 'Makima', anime: 'Chainsaw Man', rarity: 'epic', image: 'https://i.imgur.com/NfQ7LsA.png' },
    { id: 'gon', name: 'Gon Freecss', anime: 'Hunter x Hunter', rarity: 'epic', image: 'https://i.imgur.com/w8vLKzF.png' },

    // ── Rare ──
    { id: 'deku', name: 'Izuku Midoriya', anime: 'My Hero Academia', rarity: 'rare', image: 'https://i.imgur.com/YQJT2r9.png' },
    { id: 'bakugo', name: 'Katsuki Bakugo', anime: 'My Hero Academia', rarity: 'rare', image: 'https://i.imgur.com/hFP7D9X.png' },
    { id: 'sanji', name: 'Vinsmoke Sanji', anime: 'One Piece', rarity: 'rare', image: 'https://i.imgur.com/JXK6Lb2.png' },
    { id: 'hinata', name: 'Hinata Shoyo', anime: 'Haikyuu', rarity: 'rare', image: 'https://i.imgur.com/QTL8RmA.png' },
    { id: 'edward', name: 'Edward Elric', anime: 'Fullmetal Alchemist', rarity: 'rare', image: 'https://i.imgur.com/K5v7RLz.png' },
    { id: 'genos', name: 'Genos', anime: 'One Punch Man', rarity: 'rare', image: 'https://i.imgur.com/XnTkFyG.png' },
    { id: 'zenitsu', name: 'Zenitsu Agatsuma', anime: 'Demon Slayer', rarity: 'rare', image: 'https://i.imgur.com/Kd3RPvY.png' },
    { id: 'anya', name: 'Anya Forger', anime: 'Spy x Family', rarity: 'rare', image: 'https://i.imgur.com/pQxLN8R.png' },
    { id: 'denji', name: 'Denji', anime: 'Chainsaw Man', rarity: 'rare', image: 'https://i.imgur.com/vT3kXgN.png' },
    { id: 'light', name: 'Light Yagami', anime: 'Death Note', rarity: 'rare', image: 'https://i.imgur.com/JLk9F2P.png' },
    { id: 'l', name: 'L Lawliet', anime: 'Death Note', rarity: 'rare', image: 'https://i.imgur.com/HK6NRTB.png' },
    { id: 'senku', name: 'Senku Ishigami', anime: 'Dr. Stone', rarity: 'rare', image: 'https://i.imgur.com/RqY5pLD.png' },
    { id: 'nami', name: 'Nami', anime: 'One Piece', rarity: 'rare', image: 'https://i.imgur.com/VK2WLHY.png' },
    { id: 'sakura', name: 'Sakura Haruno', anime: 'Naruto', rarity: 'rare', image: 'https://i.imgur.com/wTPXnqM.png' },
    { id: 'asuna', name: 'Asuna Yuuki', anime: 'Sword Art Online', rarity: 'rare', image: 'https://i.imgur.com/gKq7NfD.png' },

    // ── Uncommon ──
    { id: 'usopp', name: 'Usopp', anime: 'One Piece', rarity: 'uncommon', image: 'https://i.imgur.com/kKR3nZH.png' },
    { id: 'chopper', name: 'Tony Tony Chopper', anime: 'One Piece', rarity: 'uncommon', image: 'https://i.imgur.com/aY2QKFV.png' },
    { id: 'shikamaru', name: 'Shikamaru Nara', anime: 'Naruto', rarity: 'uncommon', image: 'https://i.imgur.com/7zT2PLR.png' },
    { id: 'inosuke', name: 'Inosuke Hashibira', anime: 'Demon Slayer', rarity: 'uncommon', image: 'https://i.imgur.com/3NxPHvR.png' },
    { id: 'ochaco', name: 'Ochaco Uraraka', anime: 'My Hero Academia', rarity: 'uncommon', image: 'https://i.imgur.com/kZqV2TB.png' },
    { id: 'aqua', name: 'Aqua', anime: 'Konosuba', rarity: 'uncommon', image: 'https://i.imgur.com/qRYKTH5.png' },
    { id: 'subaru', name: 'Subaru Natsuki', anime: 'Re:Zero', rarity: 'uncommon', image: 'https://i.imgur.com/LPvWK7N.png' },
    { id: 'kirito', name: 'Kirito', anime: 'Sword Art Online', rarity: 'uncommon', image: 'https://i.imgur.com/Jn5RQTH.png' },
    { id: 'natsu', name: 'Natsu Dragneel', anime: 'Fairy Tail', rarity: 'uncommon', image: 'https://i.imgur.com/PYN8LqR.png' },
    { id: 'eren', name: 'Eren Yeager', anime: 'Attack on Titan', rarity: 'uncommon', image: 'https://i.imgur.com/K8nM3RL.png' },
    { id: 'loid', name: 'Loid Forger', anime: 'Spy x Family', rarity: 'uncommon', image: 'https://i.imgur.com/F7RpLqN.png' },
    { id: 'naruto_base', name: 'Naruto Uzumaki', anime: 'Naruto', rarity: 'uncommon', image: 'https://i.imgur.com/XK9nPzT.png' },

    // ── Common ──
    { id: 'konohamaru', name: 'Konohamaru', anime: 'Naruto', rarity: 'common', image: 'https://i.imgur.com/V8n3KqR.png' },
    { id: 'krillin', name: 'Krillin', anime: 'Dragon Ball', rarity: 'common', image: 'https://i.imgur.com/qN5xLPR.png' },
    { id: 'yamcha', name: 'Yamcha', anime: 'Dragon Ball', rarity: 'common', image: 'https://i.imgur.com/RqYK5nT.png' },
    { id: 'mineta', name: 'Minoru Mineta', anime: 'My Hero Academia', rarity: 'common', image: 'https://i.imgur.com/HY3qPKR.png' },
    { id: 'sakura_hk', name: 'Sakura Haruno (Kid)', anime: 'Naruto', rarity: 'common', image: 'https://i.imgur.com/F3qnKPR.png' },
    { id: 'tenten', name: 'Tenten', anime: 'Naruto', rarity: 'common', image: 'https://i.imgur.com/X8nRqLT.png' },
    { id: 'brook', name: 'Brook', anime: 'One Piece', rarity: 'common', image: 'https://i.imgur.com/P7nLqRT.png' },
    { id: 'franky', name: 'Franky', anime: 'One Piece', rarity: 'common', image: 'https://i.imgur.com/K9qnRPT.png' },
    { id: 'happy', name: 'Happy', anime: 'Fairy Tail', rarity: 'common', image: 'https://i.imgur.com/R8nKqPT.png' },
    { id: 'kon', name: 'Kon', anime: 'Bleach', rarity: 'common', image: 'https://i.imgur.com/T7nPqKR.png' },
    { id: 'elizabeth', name: 'Elizabeth', anime: 'Gintama', rarity: 'common', image: 'https://i.imgur.com/N3qKnPR.png' },
    { id: 'hawk', name: 'Hawk', anime: 'Seven Deadly Sins', rarity: 'common', image: 'https://i.imgur.com/Q5nRqKT.png' },
];

/**
 * Live character pool. Prefers the AniList API pool (real characters with
 * images); falls back to the built-in list until the API pool loads.
 */
function getCharacters() {
    const pool = animeApi.getPoolSync();
    return (pool && pool.length > 0) ? pool : FALLBACK_CHARACTERS;
}

/** Warm the API pool (call on bot ready). */
async function ensurePool() {
    try { return await animeApi.ensurePool(); }
    catch { return getCharacters(); }
}

/* ═══════════════════════════════════════════════════════
   ROLL COST & COOLDOWNS
   ═══════════════════════════════════════════════════════ */

const ROLL_COST = 100;
const MULTI_ROLL_COUNT = 5;   // ×5 multi-roll (capped to curb bulk rolling)
const MULTI_ROLL_COST = 450;  // 10% discount vs 5 singles (500)
const ROLL_COOLDOWN = 30000; // 30 seconds
const DAILY_FREE_ROLLS = 10;      // free rolls per day
const VOTE_BONUS_ROLLS = 2;       // extra rolls granted per vote once daily rolls are used
const VOTE_WINDOW_MS = 12 * 60 * 60 * 1000; // a vote counts for 12h

/* ═══════════════════════════════════════════════════════
   DATA ACCESS
   ═══════════════════════════════════════════════════════ */

function loadAnimeData() {
    try {
        let data = jsonStore.peek('anime_collection');
        if (!data) {
            data = {};
            jsonStore.cache.set('anime_collection', data);
        }
        return data;
    } catch (err) {
        log.error('[ANIME] load failed', err);
        return {};
    }
}

function saveAnimeData() {
    try {
        jsonStore.markDirty('anime_collection');
    } catch (err) {
        log.error('[ANIME] save failed', err);
    }
}

function getPlayerData(data, userId) {
    if (!data[userId]) {
        data[userId] = {
            collection: [],       // Array of { charId, obtainedAt, duplicate }
            wishlist: [],         // Array of character IDs
            favorites: [],        // Array of character IDs (max 5)
            totalRolls: 0,
            freeRollsToday: 0,
            lastFreeRollReset: 0,
            bonusRolls: 0,         // vote-granted bonus rolls (persist until used)
            lastVoteRollClaim: 0,  // timestamp of the vote already claimed for bonus rolls
            lastRoll: 0,
            totalSpent: 0,
            trades: 0,
            createdAt: Date.now(),
        };
    }
    return data[userId];
}

/* ═══════════════════════════════════════════════════════
   GACHA MECHANICS
   ═══════════════════════════════════════════════════════ */

/**
 * Vote boost: multiplies the weight of the high tiers so voters get
 * meaningfully better odds at Epic/Legendary/Mythic pulls. Base rates stay
 * low (mythic ≈ 1%); with a boost mythic ≈ 3%, legendary ≈ 2.5×, epic ≈ 1.5×.
 */
const VOTE_RARITY_MULTIPLIER = { epic: 1.5, legendary: 2.5, mythic: 3 };

/** Apply the vote-boost multiplier to a { rarity: weight } map. */
function applyVoteBoost(weights) {
    const out = {};
    for (const [k, w] of Object.entries(weights)) {
        out[k] = w * (VOTE_RARITY_MULTIPLIER[k] || 1);
    }
    return out;
}

/** True if the user has a vote within the active 12h window. */
function hasActiveVote(userId) {
    try {
        const userVotes = jsonStore.read('user-votes') || {};
        const v = userVotes[userId];
        return !!(v && v.lastVote && (Date.now() - v.lastVote < VOTE_WINDOW_MS));
    } catch {
        return false;
    }
}

function rollRarity(boost = false) {
    const base = {};
    for (const [key, r] of Object.entries(RARITIES)) base[key] = r.weight;
    const weights = boost ? applyVoteBoost(base) : base;

    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    let roll = Math.random() * totalWeight;

    for (const [key, w] of Object.entries(weights)) {
        roll -= w;
        if (roll <= 0) return key;
    }
    return 'common';
}

function rollCharacter(boost = false) {
    const CHARACTERS = getCharacters();
    const rarity = rollRarity(boost);
    const pool = CHARACTERS.filter(c => c.rarity === rarity);
    if (pool.length === 0) return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
    return pool[Math.floor(Math.random() * pool.length)];
}

function rollMultiple(count = MULTI_ROLL_COUNT, boost = false) {
    const results = [];
    // Guarantee at least 1 rare+ in a multi-roll
    let hasRareOrBetter = false;

    for (let i = 0; i < count; i++) {
        const char = rollCharacter(boost);
        results.push(char);
        if (['rare', 'epic', 'legendary', 'mythic'].includes(char.rarity)) {
            hasRareOrBetter = true;
        }
    }

    // Pity: if no rare+ in multi, replace the last one.
    // Guard against an empty rare bucket (degenerate/small pool) so we never
    // insert `undefined` into the results (which would crash addToCollection).
    if (!hasRareOrBetter) {
        const all = getCharacters();
        const rarePool = all.filter(c => c.rarity === 'rare');
        const pick = rarePool.length > 0
            ? rarePool[Math.floor(Math.random() * rarePool.length)]
            : all[Math.floor(Math.random() * all.length)];
        if (pick) results[count - 1] = pick;
    }

    return results.filter(Boolean);
}

/* ═══════════════════════════════════════════════════════
   COLLECTION HELPERS
   ═══════════════════════════════════════════════════════ */

function addToCollection(playerData, character) {
    const existing = playerData.collection.filter(c => c.charId === character.id);
    playerData.collection.push({
        charId: character.id,
        obtainedAt: Date.now(),
        duplicate: existing.length,
    });
    return existing.length > 0;
}

function getCollectionStats(playerData) {
    const CHARACTERS = getCharacters();
    const unique = new Set(playerData.collection.map(c => c.charId));
    const byRarity = {};

    for (const entry of playerData.collection) {
        const char = CHARACTERS.find(c => c.id === entry.charId);
        if (char) {
            byRarity[char.rarity] = (byRarity[char.rarity] || 0) + 1;
        }
    }

    return {
        total: playerData.collection.length,
        unique: unique.size,
        maxUnique: CHARACTERS.length,
        percentage: CHARACTERS.length ? Math.round((unique.size / CHARACTERS.length) * 100) : 0,
        byRarity,
    };
}

function getCollectionValue(playerData) {
    const CHARACTERS = getCharacters();
    let total = 0;
    for (const entry of playerData.collection) {
        const char = CHARACTERS.find(c => c.id === entry.charId);
        if (char) {
            total += RARITIES[char.rarity].value;
        }
    }
    return total;
}

function getDuplicates(playerData) {
    const counts = {};
    for (const entry of playerData.collection) {
        counts[entry.charId] = (counts[entry.charId] || 0) + 1;
    }
    return Object.entries(counts)
        .filter(([, count]) => count > 1)
        .map(([charId, count]) => ({ charId, count }));
}

function canAffordRoll(coins, multi = false) {
    return coins >= (multi ? MULTI_ROLL_COST : ROLL_COST);
}

/** Reset the daily counter if we've rolled past midnight. */
function resetDailyIfNeeded(playerData) {
    const today = new Date().setHours(0, 0, 0, 0);
    if ((playerData.lastFreeRollReset || 0) < today) {
        playerData.freeRollsToday = 0;
        playerData.lastFreeRollReset = Date.now();
    }
}

/**
 * Total free rolls currently available = remaining daily rolls + vote-bonus
 * rolls. Vote-bonus rolls persist across days until spent.
 */
function checkFreeRolls(playerData) {
    resetDailyIfNeeded(playerData);
    const dailyLeft = Math.max(0, DAILY_FREE_ROLLS - (playerData.freeRollsToday || 0));
    const bonus = playerData.bonusRolls || 0;
    return dailyLeft + bonus;
}

/** Only the remaining *daily* rolls (excludes vote-bonus rolls). */
function checkDailyRolls(playerData) {
    resetDailyIfNeeded(playerData);
    return Math.max(0, DAILY_FREE_ROLLS - (playerData.freeRollsToday || 0));
}

/**
 * Consume one free roll. Daily rolls are spent first; once those run out we
 * draw from vote-bonus rolls. Returns 'daily' | 'bonus' | 'none'.
 */
function useFreeRoll(playerData) {
    resetDailyIfNeeded(playerData);
    if ((playerData.freeRollsToday || 0) < DAILY_FREE_ROLLS) {
        playerData.freeRollsToday = (playerData.freeRollsToday || 0) + 1;
        return 'daily';
    }
    if ((playerData.bonusRolls || 0) > 0) {
        playerData.bonusRolls -= 1;
        return 'bonus';
    }
    return 'none';
}

/**
 * Grant vote-bonus rolls if the user has a fresh (unclaimed) vote within the
 * last 12h. Each individual vote can only be claimed once. Returns
 * { claimed, granted, reason }.
 *   reason: 'no-vote' | 'expired' | 'already-claimed'
 */
function claimVoteRolls(playerData, userId) {
    let userVotes = {};
    try { userVotes = jsonStore.read('user-votes') || {}; } catch { userVotes = {}; }
    const voteData = userVotes[userId];

    if (!voteData || !voteData.lastVote) return { claimed: false, reason: 'no-vote' };
    if (Date.now() - voteData.lastVote >= VOTE_WINDOW_MS) return { claimed: false, reason: 'expired' };
    if ((playerData.lastVoteRollClaim || 0) >= voteData.lastVote) {
        return { claimed: false, reason: 'already-claimed' };
    }

    playerData.bonusRolls = (playerData.bonusRolls || 0) + VOTE_BONUS_ROLLS;
    playerData.lastVoteRollClaim = voteData.lastVote;
    return { claimed: true, granted: VOTE_BONUS_ROLLS };
}

/* ═══════════════════════════════════════════════════════
   TRADING
   ═══════════════════════════════════════════════════════ */

function removeFromCollection(playerData, charId) {
    const idx = playerData.collection.findIndex(c => c.charId === charId);
    if (idx === -1) return false;
    playerData.collection.splice(idx, 1);
    return true;
}

function hasCharacter(playerData, charId) {
    return playerData.collection.some(c => c.charId === charId);
}

function getCharacterCount(playerData, charId) {
    return playerData.collection.filter(c => c.charId === charId).length;
}

/* ═══════════════════════════════════════════════════════
   SELL SYSTEM
   ═══════════════════════════════════════════════════════ */

function getSellValue(charId) {
    const char = getCharacters().find(c => c.id === charId);
    if (!char) return 0;
    return Math.floor(RARITIES[char.rarity].value * 0.5);
}

/* ═══════════════════════════════════════════════════════
   LOOKUP
   ═══════════════════════════════════════════════════════ */

function findCharacter(query) {
    const lower = query.toLowerCase();
    const CHARACTERS = getCharacters();
    return CHARACTERS.find(c => c.id === lower)
        || CHARACTERS.find(c => c.name.toLowerCase() === lower)
        || CHARACTERS.find(c => c.name.toLowerCase().includes(lower));
}

function getCharactersByAnime(anime) {
    const lower = anime.toLowerCase();
    return getCharacters().filter(c => c.anime.toLowerCase().includes(lower));
}

function getCharactersByRarity(rarity) {
    return getCharacters().filter(c => c.rarity === rarity);
}

/* ═══════════════════════════════════════════════════════
   UPGRADE / ASCENSION SYSTEM
   ═══════════════════════════════════════════════════════ */

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const UPGRADE_COST = { common: 200, uncommon: 500, rare: 1500, epic: 4000, legendary: 10000 };
const UPGRADE_SACRIFICE = 3; // cards of same rarity needed

function getNextRarity(rarity) {
    const idx = RARITY_ORDER.indexOf(rarity);
    if (idx < 0 || idx >= RARITY_ORDER.length - 1) return null;
    return RARITY_ORDER[idx + 1];
}

function canUpgrade(playerData, charId) {
    const char = getCharacters().find(c => c.id === charId);
    if (!char) return { ok: false, reason: 'Character not found.' };
    const next = getNextRarity(char.rarity);
    if (!next) return { ok: false, reason: 'This card is already at max rarity (Mythic).' };
    // Can't upgrade to mythic
    if (next === 'mythic') return { ok: false, reason: 'Cannot upgrade to Mythic — only obtainable by rolling!' };
    const sameRarity = playerData.collection.filter(e => {
        const c = getCharacters().find(ch => ch.id === e.charId);
        return c && c.rarity === char.rarity && e.charId !== charId;
    });
    const uniqueSacrifice = new Set(sameRarity.map(e => e.charId));
    if (uniqueSacrifice.size < UPGRADE_SACRIFICE) {
        return { ok: false, reason: `Need ${UPGRADE_SACRIFICE} other ${char.rarity} cards to sacrifice. You have ${uniqueSacrifice.size}.` };
    }
    return { ok: true, cost: UPGRADE_COST[char.rarity] || 1000, nextRarity: next, sacrificeNeeded: UPGRADE_SACRIFICE };
}

/**
 * Perform an upgrade: remove sacrifice cards, change character rarity in collection entry.
 * Returns the upgraded character data.
 */
function performUpgrade(playerData, charId) {
    const char = getCharacters().find(c => c.id === charId);
    const next = getNextRarity(char.rarity);

    // Remove sacrifice cards (3 other cards of the same rarity)
    const currentRarity = char.rarity;
    let removed = 0;
    const toRemove = [];
    for (const entry of playerData.collection) {
        if (removed >= UPGRADE_SACRIFICE) break;
        if (entry.charId === charId) continue;
        const c = getCharacters().find(ch => ch.id === entry.charId);
        if (c && c.rarity === currentRarity) {
            toRemove.push(entry);
            removed++;
        }
    }
    for (const entry of toRemove) {
        const idx = playerData.collection.indexOf(entry);
        if (idx !== -1) playerData.collection.splice(idx, 1);
    }

    // Return the "upgraded" character (virtual — we record the upgrade)
    return {
        ...char,
        rarity: next,
        upgraded: true,
        originalRarity: currentRarity,
    };
}

/* ═══════════════════════════════════════════════════════
   FUSION SYSTEM
   ═══════════════════════════════════════════════════════ */

const FUSION_COST = { common: 100, uncommon: 300, rare: 800, epic: 2000, legendary: 5000, mythic: 8000 };

/**
 * Fuse two owned cards into one random card.
 * 60% same rarity, 30% one up, 10% one down.
 */
function fuseCards(playerData, charId1, charId2) {
    const char1 = getCharacters().find(c => c.id === charId1);
    const char2 = getCharacters().find(c => c.id === charId2);
    if (!char1 || !char2) return null;

    // Determine base rarity (higher of the two)
    const idx1 = RARITY_ORDER.indexOf(char1.rarity);
    const idx2 = RARITY_ORDER.indexOf(char2.rarity);
    const baseIdx = Math.max(idx1, idx2);

    // Random outcome
    const roll = Math.random();
    let resultIdx;
    if (roll < 0.30) {
        // 30% chance: one tier up
        resultIdx = Math.min(baseIdx + 1, RARITY_ORDER.length - 1);
    } else if (roll < 0.90) {
        // 60% chance: same tier
        resultIdx = baseIdx;
    } else {
        // 10% chance: one tier down
        resultIdx = Math.max(baseIdx - 1, 0);
    }

    const resultRarity = RARITY_ORDER[resultIdx];
    const pool = getCharacters().filter(c => c.rarity === resultRarity);
    if (!pool.length) return null;

    // Remove both source cards from collection
    removeFromCollection(playerData, charId1);
    removeFromCollection(playerData, charId2);

    // Pick random result
    const result = pool[Math.floor(Math.random() * pool.length)];
    addToCollection(playerData, result);

    return {
        result,
        input1: char1,
        input2: char2,
        upgraded: resultIdx > baseIdx,
        downgraded: resultIdx < baseIdx,
    };
}

function getFusionCost(charId1, charId2) {
    const char1 = getCharacters().find(c => c.id === charId1);
    const char2 = getCharacters().find(c => c.id === charId2);
    if (!char1 || !char2) return 500;
    return (FUSION_COST[char1.rarity] || 500) + (FUSION_COST[char2.rarity] || 500);
}

/* ═══════════════════════════════════════════════════════
   MYSTERY BOX SYSTEM
   ═══════════════════════════════════════════════════════ */

const MYSTERY_BOXES = {
    bronze: {
        name: 'Bronze Box', emoji: AE.rank3, cost: 500, cards: 3,
        weights: { common: 45, uncommon: 30, rare: 15, epic: 7, legendary: 2.5, mythic: 0.5 },
    },
    silver: {
        name: 'Silver Box', emoji: AE.rank2, cost: 1500, cards: 3,
        weights: { common: 15, uncommon: 30, rare: 30, epic: 18, legendary: 6, mythic: 1 },
    },
    gold: {
        name: 'Gold Box', emoji: AE.rank1, cost: 5000, cards: 3,
        weights: { common: 0, uncommon: 0, rare: 10, epic: 50, legendary: 30, mythic: 10 },
    },
};

function openMysteryBox(tier = 'bronze', boost = false) {
    const box = MYSTERY_BOXES[tier];
    if (!box) return [];

    const weights = boost ? applyVoteBoost(box.weights) : box.weights;

    const results = [];
    for (let i = 0; i < box.cards; i++) {
        const totalWeight = Object.values(weights).reduce((s, w) => s + w, 0);
        let roll = Math.random() * totalWeight;
        let rarity = 'common';
        for (const [key, weight] of Object.entries(weights)) {
            roll -= weight;
            if (roll <= 0) { rarity = key; break; }
        }
        const pool = getCharacters().filter(c => c.rarity === rarity);
        if (pool.length) {
            results.push(pool[Math.floor(Math.random() * pool.length)]);
        } else {
            results.push(getCharacters()[Math.floor(Math.random() * getCharacters().length)]);
        }
    }
    return results;
}

/* ═══════════════════════════════════════════════════════
   ACHIEVEMENT SYSTEM
   ═══════════════════════════════════════════════════════ */

const ACHIEVEMENTS = [
    { id: 'first_roll', name: 'First Steps', desc: 'Roll your first character', emoji: AE.roll, reward: 50, check: pd => pd.totalRolls >= 1 },
    { id: 'rolls_10', name: 'Getting Started', desc: 'Roll 10 times', emoji: AE.gacha, reward: 100, check: pd => pd.totalRolls >= 10 },
    { id: 'rolls_50', name: 'Dedicated Roller', desc: 'Roll 50 times', emoji: AE.star, reward: 250, check: pd => pd.totalRolls >= 50 },
    { id: 'rolls_100', name: 'Roll Master', desc: 'Roll 100 times', emoji: AE.lightning, reward: 500, check: pd => pd.totalRolls >= 100 },
    { id: 'rolls_500', name: 'Gacha Addict', desc: 'Roll 500 times', emoji: AE.fire, reward: 2000, check: pd => pd.totalRolls >= 500 },
    { id: 'unique_5', name: 'Small Collection', desc: 'Collect 5 unique characters', emoji: AE.box, reward: 100, check: pd => new Set(pd.collection.map(c => c.charId)).size >= 5 },
    { id: 'unique_25', name: 'Card Enthusiast', desc: 'Collect 25 unique characters', emoji: AE.collection, reward: 500, check: pd => new Set(pd.collection.map(c => c.charId)).size >= 25 },
    { id: 'unique_50', name: 'Serious Collector', desc: 'Collect 50 unique characters', emoji: AE.award, reward: 1000, check: pd => new Set(pd.collection.map(c => c.charId)).size >= 50 },
    { id: 'unique_100', name: 'Master Collector', desc: 'Collect 100 unique characters', emoji: AE.crown, reward: 3000, check: pd => new Set(pd.collection.map(c => c.charId)).size >= 100 },
    { id: 'rarity_epic', name: 'Epic Find', desc: 'Own an Epic rarity card', emoji: '🟣', reward: 200, check: pd => pd.collection.some(e => { const c = getCharacters().find(ch => ch.id === e.charId); return c && c.rarity === 'epic'; }) },
    { id: 'rarity_legendary', name: 'Legendary Pull', desc: 'Own a Legendary rarity card', emoji: '🟡', reward: 500, check: pd => pd.collection.some(e => { const c = getCharacters().find(ch => ch.id === e.charId); return c && c.rarity === 'legendary'; }) },
    { id: 'rarity_mythic', name: 'Mythic Discovery', desc: 'Own a Mythic rarity card', emoji: '🔴', reward: 2000, check: pd => pd.collection.some(e => { const c = getCharacters().find(ch => ch.id === e.charId); return c && c.rarity === 'mythic'; }) },
    { id: 'first_trade', name: 'First Trade', desc: 'Complete your first trade', emoji: AE.trade, reward: 100, check: pd => pd.trades >= 1 },
    { id: 'trades_10', name: 'Trader', desc: 'Complete 10 trades', emoji: AE.stats, reward: 500, check: pd => pd.trades >= 10 },
    { id: 'spent_1000', name: 'Big Spender', desc: 'Spend 1,000 coins on rolls', emoji: AE.money, reward: 200, check: pd => pd.totalSpent >= 1000 },
    { id: 'spent_10000', name: 'Whale', desc: 'Spend 10,000 coins on rolls', emoji: AE.money, reward: 1000, check: pd => pd.totalSpent >= 10000 },
    { id: 'favorites_set', name: 'Favorites Set', desc: 'Set at least 3 favorites', emoji: AE.heart, reward: 100, check: pd => pd.favorites.length >= 3 },
    { id: 'wishlist_set', name: 'Wishful Thinking', desc: 'Add 5 characters to your wishlist', emoji: AE.wishlist, reward: 100, check: pd => pd.wishlist.length >= 5 },
];

function getUnlockedAchievements(playerData) {
    if (!playerData.achievements) playerData.achievements = [];
    return ACHIEVEMENTS.filter(a => playerData.achievements.includes(a.id));
}

function checkNewAchievements(playerData) {
    if (!playerData.achievements) playerData.achievements = [];
    const newlyUnlocked = [];
    for (const achievement of ACHIEVEMENTS) {
        if (playerData.achievements.includes(achievement.id)) continue;
        if (achievement.check(playerData)) {
            playerData.achievements.push(achievement.id);
            newlyUnlocked.push(achievement);
        }
    }
    return newlyUnlocked;
}

/* ═══════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════ */

module.exports = {
    RARITIES,
    RARITY_ORDER,
    // Live pool getter — always reflects the AniList API pool once loaded.
    get CHARACTERS() { return getCharacters(); },
    getCharacters,
    ensurePool,
    ROLL_COST,
    MULTI_ROLL_COUNT,
    MULTI_ROLL_COST,
    ROLL_COOLDOWN,
    DAILY_FREE_ROLLS,
    VOTE_BONUS_ROLLS,
    loadAnimeData,
    saveAnimeData,
    getPlayerData,
    rollCharacter,
    rollMultiple,
    rollRarity,
    addToCollection,
    getCollectionStats,
    getCollectionValue,
    getDuplicates,
    canAffordRoll,
    checkFreeRolls,
    checkDailyRolls,
    useFreeRoll,
    claimVoteRolls,
    hasActiveVote,
    VOTE_RARITY_MULTIPLIER,
    removeFromCollection,
    hasCharacter,
    getCharacterCount,
    getSellValue,
    findCharacter,
    getCharactersByAnime,
    getCharactersByRarity,
    // Upgrade
    UPGRADE_COST,
    UPGRADE_SACRIFICE,
    getNextRarity,
    canUpgrade,
    performUpgrade,
    // Fusion
    FUSION_COST,
    fuseCards,
    getFusionCost,
    // Mystery Box
    MYSTERY_BOXES,
    openMysteryBox,
    // Achievements
    ACHIEVEMENTS,
    getUnlockedAchievements,
    checkNewAchievements,
};

