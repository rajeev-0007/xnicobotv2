'use strict';

/**
 * animeApi.js — Fetches & caches a pool of real anime characters (with
 * images) from the AniList GraphQL API for the gacha/collection system.
 *
 * • No API key required.
 * • Characters are ranked by `favourites` and bucketed into rarities by
 *   percentile so there's always a full spread (mythic → common).
 * • The pool is cached in the `anime_pool` jsonStore and refreshed weekly.
 * • Each character keeps its stable AniList `id`, so collections persist
 *   even across pool refreshes.
 */

const axios = require('axios');
const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

const STORE = 'anime_pool';
const API = 'https://graphql.anilist.co';
const PAGES = 10;          // 10 × 50 = 500 characters
const PER_PAGE = 50;
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // weekly

// Rarity buckets by percentile of the favourites-sorted pool.
const RARITY_BUCKETS = [
    { key: 'mythic',    pct: 0.03 },
    { key: 'legendary', pct: 0.07 },
    { key: 'epic',      pct: 0.15 },
    { key: 'rare',      pct: 0.25 },
    { key: 'uncommon',  pct: 0.25 },
    { key: 'common',    pct: 0.25 },
];

const QUERY = `query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    characters(sort: FAVOURITES_DESC) {
      id
      name { full }
      image { large }
      favourites
      media(perPage: 1, sort: POPULARITY_DESC) { nodes { title { romaji english } } }
    }
  }
}`;

let _memPool = null;      // in-memory cache of the character array
let _fetching = null;     // in-flight fetch promise

function _loadCached() {
    try {
        const data = jsonStore.peek(STORE);
        if (data && Array.isArray(data.characters) && data.characters.length > 0) {
            return data;
        }
    } catch {}
    return null;
}

function _assignRarities(characters) {
    // characters already sorted by favourites desc
    const total = characters.length;
    let idx = 0;
    for (const bucket of RARITY_BUCKETS) {
        const count = Math.max(1, Math.round(total * bucket.pct));
        for (let i = 0; i < count && idx < total; i++, idx++) {
            characters[idx].rarity = bucket.key;
        }
    }
    // Anything left over → common
    while (idx < total) { characters[idx++].rarity = 'common'; }
    return characters;
}

async function _fetchFromApi() {
    const all = [];
    for (let page = 1; page <= PAGES; page++) {
        try {
            const res = await axios.post(API, { query: QUERY, variables: { page, perPage: PER_PAGE } }, {
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                timeout: 15000,
            });
            const chars = res.data?.data?.Page?.characters || [];
            for (const c of chars) {
                if (!c?.image?.large || !c?.name?.full) continue;
                const media = c.media?.nodes?.[0]?.title;
                all.push({
                    id: `al_${c.id}`,
                    name: c.name.full,
                    anime: media?.english || media?.romaji || 'Unknown',
                    image: c.image.large,
                    favourites: c.favourites || 0,
                });
            }
            // Gentle pacing to respect AniList rate limits (90/min).
            await new Promise(r => setTimeout(r, 700));
        } catch (err) {
            log.warning(`[AnimeAPI] page ${page} fetch failed: ${err.response?.status || err.message}`);
            // If we already have some data, stop early and use what we have.
            if (all.length >= PER_PAGE) break;
        }
    }

    if (all.length === 0) return null;

    // De-dupe by id, sort by favourites desc, assign rarities.
    const seen = new Set();
    const unique = all.filter(c => (seen.has(c.id) ? false : seen.add(c.id)));
    unique.sort((a, b) => b.favourites - a.favourites);
    _assignRarities(unique);

    const payload = { characters: unique, fetchedAt: Date.now() };
    try { await jsonStore.write(STORE, payload); } catch {}
    _memPool = payload;
    log.success(`[AnimeAPI] Cached ${unique.length} anime characters from AniList`);
    return payload;
}

/**
 * Ensure the character pool is loaded/fresh. Returns the character array.
 * Safe to call often — uses in-memory + jsonStore cache and only hits the
 * API when the cache is missing or older than REFRESH_MS.
 */
async function ensurePool() {
    if (_memPool && (Date.now() - _memPool.fetchedAt) < REFRESH_MS) {
        return _memPool.characters;
    }
    const cached = _loadCached();
    if (cached && (Date.now() - cached.fetchedAt) < REFRESH_MS) {
        _memPool = cached;
        return cached.characters;
    }
    // Stale or missing — refresh (single-flight).
    if (!_fetching) {
        _fetching = _fetchFromApi().finally(() => { _fetching = null; });
    }
    const fresh = await _fetching;
    if (fresh) return fresh.characters;
    // API failed but we have stale cache — use it rather than nothing.
    if (cached) { _memPool = cached; return cached.characters; }
    return [];
}

/** Synchronous access to whatever pool is already cached (may be empty). */
function getPoolSync() {
    if (_memPool) return _memPool.characters;
    const cached = _loadCached();
    if (cached) { _memPool = cached; return cached.characters; }
    return [];
}

function findById(id) {
    return getPoolSync().find(c => c.id === id) || null;
}

module.exports = { ensurePool, getPoolSync, findById };
