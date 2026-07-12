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
let _lastFailAt = 0;      // timestamp of the last failed full fetch
const FAIL_COOLDOWN_MS = 5 * 60 * 1000; // after a failed fetch, wait before retrying

const UA = 'xNicoBot/1.0 (+https://github.com/Rajeev0007/xnicobotv2)';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

/** Fetch a single page, handling GraphQL errors + one 429 retry. */
async function _fetchPage(page) {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const res = await axios.post(
                API,
                { query: QUERY, variables: { page, perPage: PER_PAGE } },
                {
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': UA },
                    timeout: 15000,
                    validateStatus: () => true, // we inspect the status ourselves
                },
            );

            // Rate limited — respect Retry-After (seconds), then retry once.
            if (res.status === 429) {
                const retryAfter = Number(res.headers?.['retry-after']) || 3;
                log.warning(`[AnimeAPI] page ${page} rate-limited (429) — waiting ${retryAfter}s`);
                await sleep(Math.min(retryAfter, 10) * 1000);
                continue;
            }

            if (res.status >= 400) {
                log.warning(`[AnimeAPI] page ${page} HTTP ${res.status}`);
                return null;
            }

            // AniList returns GraphQL errors with HTTP 200 — surface them.
            if (Array.isArray(res.data?.errors) && res.data.errors.length) {
                log.warning(`[AnimeAPI] page ${page} GraphQL error: ${res.data.errors[0]?.message || 'unknown'}`);
                return null;
            }

            return res.data?.data?.Page?.characters || [];
        } catch (err) {
            log.warning(`[AnimeAPI] page ${page} fetch failed: ${err.response?.status || err.message}`);
            return null;
        }
    }
    return null;
}

async function _fetchFromApi() {
    const all = [];
    for (let page = 1; page <= PAGES; page++) {
        const chars = await _fetchPage(page);
        if (chars === null) {
            // Hard failure for this page — keep what we have if it's usable.
            if (all.length >= PER_PAGE) break;
            continue;
        }
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
        await sleep(700);
    }

    if (all.length === 0) {
        _lastFailAt = Date.now();
        log.warning('[AnimeAPI] fetch produced no characters — using fallback/cache until retry');
        return null;
    }

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
    // If a recent fetch failed, don't hammer the API (or block commands for
    // 7-15s) on every call. Serve stale cache if we have it, else empty (the
    // manager falls back to its built-in character list).
    if (Date.now() - _lastFailAt < FAIL_COOLDOWN_MS) {
        return cached ? (_memPool = cached).characters : [];
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
