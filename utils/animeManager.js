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

/* ═══════════════════════════════════════════════════════
   RARITY SYSTEM
   ═══════════════════════════════════════════════════════ */

const RARITIES = {
    common:    { name: 'Common',    emoji: '⚪', color: 0x95A5A6, weight: 50, value: 50 },
    uncommon:  { name: 'Uncommon',  emoji: '🟢', color: 0x2ECC71, weight: 25, value: 150 },
    rare:      { name: 'Rare',      emoji: '🔵', color: 0x3498DB, weight: 14, value: 400 },
    epic:      { name: 'Epic',      emoji: '🟣', color: 0x9B59B6, weight: 7,  value: 1000 },
    legendary: { name: 'Legendary', emoji: '🟡', color: 0xF1C40F, weight: 3,  value: 3000 },
    mythic:    { name: 'Mythic',    emoji: '🔴', color: 0xE74C3C, weight: 1,  value: 10000 },
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
const MULTI_ROLL_COUNT = 10;
const MULTI_ROLL_COST = 900; // 10% discount
const ROLL_COOLDOWN = 30000; // 30 seconds
const DAILY_FREE_ROLLS = 3;

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

function rollRarity() {
    const totalWeight = Object.values(RARITIES).reduce((sum, r) => sum + r.weight, 0);
    let roll = Math.random() * totalWeight;

    for (const [key, rarity] of Object.entries(RARITIES)) {
        roll -= rarity.weight;
        if (roll <= 0) return key;
    }
    return 'common';
}

function rollCharacter() {
    const CHARACTERS = getCharacters();
    const rarity = rollRarity();
    const pool = CHARACTERS.filter(c => c.rarity === rarity);
    if (pool.length === 0) return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)];
    return pool[Math.floor(Math.random() * pool.length)];
}

function rollMultiple(count = MULTI_ROLL_COUNT) {
    const results = [];
    // Guarantee at least 1 rare+ in a multi-roll
    let hasRareOrBetter = false;

    for (let i = 0; i < count; i++) {
        const char = rollCharacter();
        results.push(char);
        if (['rare', 'epic', 'legendary', 'mythic'].includes(char.rarity)) {
            hasRareOrBetter = true;
        }
    }

    // Pity: if no rare+ in multi, replace the last one
    if (!hasRareOrBetter) {
        const rarePool = getCharacters().filter(c => c.rarity === 'rare');
        results[count - 1] = rarePool[Math.floor(Math.random() * rarePool.length)];
    }

    return results;
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

function checkFreeRolls(playerData) {
    const now = Date.now();
    const today = new Date().setHours(0, 0, 0, 0);

    if (playerData.lastFreeRollReset < today) {
        playerData.freeRollsToday = 0;
        playerData.lastFreeRollReset = now;
    }

    return DAILY_FREE_ROLLS - playerData.freeRollsToday;
}

function useFreeRoll(playerData) {
    playerData.freeRollsToday++;
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
   EXPORTS
   ═══════════════════════════════════════════════════════ */

module.exports = {
    RARITIES,
    // Live pool getter — always reflects the AniList API pool once loaded.
    get CHARACTERS() { return getCharacters(); },
    getCharacters,
    ensurePool,
    ROLL_COST,
    MULTI_ROLL_COUNT,
    MULTI_ROLL_COST,
    ROLL_COOLDOWN,
    DAILY_FREE_ROLLS,
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
    useFreeRoll,
    removeFromCollection,
    hasCharacter,
    getCharacterCount,
    getSellValue,
    findCharacter,
    getCharactersByAnime,
    getCharactersByRarity,
};
