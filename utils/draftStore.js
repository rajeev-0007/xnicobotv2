'use strict';

/**
 * draftStore — a bounded, expiring store for in-progress UI drafts.
 *
 * ═══ WHY THIS EXISTS ═══
 * commands/utility/message-builder.js held its drafts in a bare
 * `const builderData = new Map()` keyed `${guildId}-${userId}`. Two defects
 * followed from that:
 *
 *   1. UNBOUNDED LEAK. Entries were written in ten places and deleted in none.
 *      Only the sibling `builderSessions` map got a setTimeout eviction. Every
 *      user who ever opened the builder, in every guild, left a permanent entry
 *      holding embed content, field arrays, button definitions and image URLs.
 *      For a bot on thousands of guilds that grows without limit for the
 *      lifetime of the process.
 *
 *   2. CROSS-PANEL COLLISION. Because the key was per (guild, user) rather than
 *      per panel, one person with two builder panels open in the same guild had
 *      both editing a single draft — typing in one silently rewrote the other,
 *      and whichever was saved last won.
 *
 * A draft belongs to a specific panel message, so the key should be the message
 * id. This store adds the two properties a plain Map lacks: entries expire, and
 * the total is capped.
 *
 * ═══ EVICTION ═══
 * Lazy on access plus a sweep on write, so there is no interval to leak. When
 * the cap is reached the least-recently-touched entry is dropped, which for
 * drafts means the panel nobody has interacted with for longest.
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000;   // 30 min: comfortably longer than a
                                         // panel session, short enough to bound.
const DEFAULT_MAX_ENTRIES = 2000;
const SWEEP_EVERY_WRITES = 50;           // amortised cleanup cadence

class DraftStore {
    /**
     * @param {object} [opts]
     * @param {number} [opts.ttlMs]
     * @param {number} [opts.maxEntries]
     * @param {string} [opts.name] for diagnostics
     */
    constructor(opts = {}) {
        this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
        this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
        this.name = opts.name || 'drafts';
        /** @type {Map<string, {value:any, touched:number}>} */
        this._map = new Map();
        this._writes = 0;
        this.evictions = 0;
    }

    get size() { return this._map.size; }

    _expired(entry, now) {
        return now - entry.touched > this.ttlMs;
    }

    /** Drop everything past its TTL. */
    sweep(now = Date.now()) {
        let removed = 0;
        for (const [key, entry] of this._map) {
            if (this._expired(entry, now)) {
                this._map.delete(key);
                removed++;
            }
        }
        this.evictions += removed;
        return removed;
    }

    /**
     * Enforce the cap by dropping least-recently-touched entries.
     *
     * Map preserves insertion order and `set` on an existing key does NOT move
     * it, so `touch`/`set` re-insert to keep order meaningful as recency.
     */
    _enforceCap() {
        while (this._map.size > this.maxEntries) {
            const oldest = this._map.keys().next().value;
            if (oldest === undefined) break;
            this._map.delete(oldest);
            this.evictions++;
        }
    }

    /**
     * @returns {*} the stored value, or undefined when absent/expired
     */
    get(key) {
        const entry = this._map.get(key);
        if (!entry) return undefined;
        if (this._expired(entry, Date.now())) {
            this._map.delete(key);
            this.evictions++;
            return undefined;
        }
        // Re-insert so iteration order tracks recency for _enforceCap.
        this._map.delete(key);
        entry.touched = Date.now();
        this._map.set(key, entry);
        return entry.value;
    }

    has(key) {
        return this.get(key) !== undefined;
    }

    set(key, value) {
        this._map.delete(key);
        this._map.set(key, { value, touched: Date.now() });

        if (++this._writes % SWEEP_EVERY_WRITES === 0) this.sweep();
        this._enforceCap();
        return value;
    }

    /**
     * Read-modify-write helper. Seeds from `factory()` when absent, so callers
     * do not have to repeat the `get(key) || {...defaults}` dance that made the
     * original code write a fresh entry on every miss.
     */
    ensure(key, factory) {
        const existing = this.get(key);
        if (existing !== undefined) return existing;
        return this.set(key, factory());
    }

    delete(key) {
        return this._map.delete(key);
    }

    clear() {
        this._map.clear();
    }

    /** Diagnostics for owner commands. */
    stats() {
        return {
            name: this.name,
            size: this._map.size,
            maxEntries: this.maxEntries,
            ttlMinutes: Math.round(this.ttlMs / 60000),
            evictions: this.evictions,
        };
    }
}

module.exports = DraftStore;
module.exports.DEFAULT_TTL_MS = DEFAULT_TTL_MS;
module.exports.DEFAULT_MAX_ENTRIES = DEFAULT_MAX_ENTRIES;
