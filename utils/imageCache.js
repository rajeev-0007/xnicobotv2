'use strict';

/**
 * imageCache.js — high-performance loader for canvas image assets.
 *
 * Three layers of caching:
 *   1. In-memory LRU cache of decoded `@napi-rs/canvas` Image objects.
 *      Hot path: zero allocations, just a Map lookup + LRU bump.
 *   2. In-flight request dedup. If 12 cards render at once and all
 *      need the same Twemoji 🏆 PNG, only ONE network fetch happens —
 *      the rest await the same Promise.
 *   3. Persistent disk cache for stable URLs (Twemoji, font CDN, etc).
 *      First render downloads, every subsequent render reads from disk
 *      so we never pay network latency for those assets again.
 *
 * Plus negative caching: failed loads back off for 30s so we don't
 * hammer dead URLs every single render.
 */

const { loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const DISK_CACHE_DIR = path.join(__dirname, '..', '.tts-cache', 'image-cache');

/* Hosts whose responses are safe to persist on disk. We never cache
 * personalised content like user avatars (they change frequently) — only
 * static asset hosts where the URL fully identifies the resource. */
const PERSISTABLE_HOSTS = new Set([
    'cdn.jsdelivr.net',
    'cdn.discordapp.com',          // custom emoji PNGs are immutable per ID
    'media.discordapp.net',
    'raw.githubusercontent.com',
]);

class ImageCache {
    constructor() {
        // Memory cache uses Map iteration order to implement LRU — every
        // hit deletes & re-inserts so the most-recently-used keys are at
        // the tail and the oldest are at the head, ready for eviction.
        this.cache = new Map();
        this.inflight = new Map();          // url → Promise<Image|null>
        this.failedAttempts = new Map();    // url → ts of last failure
        this.maxCacheSize = 800;
        this.failedRetryDelay = 30_000;
        this.cacheStats = { hits: 0, misses: 0, failures: 0, dedupedHits: 0, diskHits: 0 };

        try { fs.mkdirSync(DISK_CACHE_DIR, { recursive: true }); } catch {}
    }

    /* ─────────────────── URL canonicalisation ─────────────────── */

    normalizeUrl(url) {
        if (!url) return null;
        try {
            const u = new URL(url);
            // Discord CDN echoes `?size=...` for cache-busting but the same
            // emoji ID always returns the same image, so drop the query
            // string for cache-key purposes.
            if (u.hostname.includes('discord')) {
                u.searchParams.delete('size');
                u.searchParams.delete('quality');
            }
            return u.toString();
        } catch {
            return String(url);
        }
    }

    _shouldPersist(url) {
        try {
            const host = new URL(url).hostname;
            return PERSISTABLE_HOSTS.has(host);
        } catch {
            return false;
        }
    }

    _diskPath(url) {
        const hash = crypto.createHash('sha1').update(url).digest('hex');
        return path.join(DISK_CACHE_DIR, hash);
    }

    /* ─────────────────── network fetch ─────────────────── */

    _fetchBuffer(url, timeout) {
        return new Promise((resolve, reject) => {
            let resolved = false;
            const lib = url.startsWith('https://') ? https : http;
            const timer = setTimeout(() => {
                if (resolved) return;
                resolved = true;
                req.destroy();
                reject(new Error('Image load timeout'));
            }, timeout);

            const finish = (err, val) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                err ? reject(err) : resolve(val);
            };

            const req = lib.get(url, { headers: { 'User-Agent': 'xNico-Canvas/1.0' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    res.resume();
                    return this._fetchBuffer(res.headers.location, timeout).then(
                        (b) => finish(null, b),
                        (e) => finish(e)
                    );
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return finish(new Error(`HTTP ${res.statusCode}`));
                }
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => finish(null, Buffer.concat(chunks)));
                res.on('error', finish);
            });
            req.on('error', finish);
        });
    }

    /* ─────────────────── public API ─────────────────── */

    async loadWithCache(url, timeout = 5000) {
        if (!url) return null;
        const key = this.normalizeUrl(url);

        // L1: memory cache
        if (this.cache.has(key)) {
            this.cacheStats.hits++;
            // LRU bump
            const img = this.cache.get(key);
            this.cache.delete(key);
            this.cache.set(key, img);
            return img;
        }

        // Negative cache: don't retry recently failed URLs
        const failedAt = this.failedAttempts.get(key);
        if (failedAt && (Date.now() - failedAt) < this.failedRetryDelay) {
            this.cacheStats.failures++;
            return null;
        }

        // In-flight dedup: if another caller is already loading this URL,
        // share the Promise instead of starting a second request.
        if (this.inflight.has(key)) {
            this.cacheStats.dedupedHits++;
            return this.inflight.get(key);
        }

        const promise = this._loadAndStore(url, key, timeout)
            .finally(() => this.inflight.delete(key));
        this.inflight.set(key, promise);
        return promise;
    }

    async _loadAndStore(url, key, timeout) {
        try {
            // L2: persistent disk cache for stable URLs
            if (this._shouldPersist(url)) {
                const diskPath = this._diskPath(key);
                if (fs.existsSync(diskPath)) {
                    try {
                        const img = await loadImage(diskPath);
                        this._memoryStore(key, img);
                        this.cacheStats.diskHits++;
                        return img;
                    } catch {
                        // disk file corrupt — wipe and fall through to network
                        try { fs.unlinkSync(diskPath); } catch {}
                    }
                }

                // Network → disk → decode
                try {
                    const buf = await this._fetchBuffer(url, timeout);
                    try { fs.writeFileSync(diskPath, buf); } catch {}
                    const img = await loadImage(buf);
                    this._memoryStore(key, img);
                    this.cacheStats.misses++;
                    return img;
                } catch (err) {
                    this.failedAttempts.set(key, Date.now());
                    this.cacheStats.failures++;
                    return null;
                }
            }

            // Non-persistable (avatars etc.): straight to memory cache
            const img = await Promise.race([
                loadImage(url),
                new Promise((_, reject) => setTimeout(
                    () => reject(new Error('Image load timeout')), timeout
                )),
            ]);
            this._memoryStore(key, img);
            this.cacheStats.misses++;
            return img;
        } catch (err) {
            this.failedAttempts.set(key, Date.now());
            this.cacheStats.failures++;
            return null;
        }
    }

    _memoryStore(key, img) {
        if (this.cache.size >= this.maxCacheSize) this.evictOldest();
        this.cache.set(key, img);
    }

    /**
     * Pre-warm the cache with a list of asset URLs.
     * Used at startup for common Twemoji glyphs etc. so the first card
     * render doesn't pay download latency.
     */
    async warm(urls = [], { timeout = 5000, concurrency = 8 } = {}) {
        const queue = [...urls];
        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
            while (queue.length) {
                const u = queue.shift();
                await this.loadWithCache(u, timeout).catch(() => {});
            }
        });
        await Promise.all(workers);
    }

    evictOldest() {
        // Map iterates insertion-order, so the first 20% of keys are the
        // least recently used after our LRU bumps.
        const toRemove = Math.max(1, Math.floor(this.maxCacheSize * 0.2));
        const it = this.cache.keys();
        for (let i = 0; i < toRemove; i++) {
            const next = it.next();
            if (next.done) break;
            this.cache.delete(next.value);
        }
    }

    clear() {
        this.cache.clear();
        this.inflight.clear();
        this.failedAttempts.clear();
        this.cacheStats = { hits: 0, misses: 0, failures: 0, dedupedHits: 0, diskHits: 0 };
    }

    clearOldEntries() {
        if (this.cache.size > this.maxCacheSize * 0.85) this.evictOldest();
        const now = Date.now();
        for (const [url, ts] of this.failedAttempts.entries()) {
            if (now - ts > this.failedRetryDelay) this.failedAttempts.delete(url);
        }
    }

    getStats() {
        const total = this.cacheStats.hits + this.cacheStats.misses + this.cacheStats.dedupedHits + this.cacheStats.diskHits;
        const hitRate = total > 0
            ? ((this.cacheStats.hits + this.cacheStats.dedupedHits + this.cacheStats.diskHits) / total * 100).toFixed(2)
            : '0.00';
        return {
            ...this.cacheStats,
            cacheSize: this.cache.size,
            inflight: this.inflight.size,
            hitRate: `${hitRate}%`,
        };
    }
}

const globalImageCache = new ImageCache();

module.exports = globalImageCache;
