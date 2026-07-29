/**
 * One-shot undo for config panels.
 *
 * Purpose: someone edits a panel, saves, and only then realises they overwrote
 * something they wanted. This keeps the single previous state so they can put it
 * back — once. After that it is gone, so it cannot be used to flip repeatedly
 * between two states or to resurrect a state from an hour ago that no longer
 * makes sense against the rest of the config.
 *
 * Bounded on purpose. This is the same shape as the bug fixed in draftStore:
 * a plain Map that only ever gets written is an unbounded leak, and config
 * snapshots are large (embed bodies, field arrays, permission maps). Entries
 * expire and the map is capped, so a busy shard cannot grow without limit.
 */

const DEFAULT_TTL_MS = 30 * 60 * 1000;   // half an hour to notice a mistake
const DEFAULT_MAX = 500;                 // ~one per active guild

/** scope -> Map<key, { snapshot, at, label }> */
const store = new Map();

let writes = 0;

function bucket(scope) {
    let m = store.get(scope);
    if (!m) {
        m = new Map();
        store.set(scope, m);
    }
    return m;
}

function sweep() {
    const now = Date.now();
    for (const [scope, m] of store) {
        for (const [key, entry] of m) {
            if (now - entry.at > DEFAULT_TTL_MS) m.delete(key);
        }
        if (m.size === 0) store.delete(scope);
    }
}

/**
 * Remember the state that is about to be replaced.
 *
 * Deep-cloned: callers hold live references to their config objects and mutate
 * them in place, so storing the reference would leave the snapshot tracking the
 * new value and silently make undo a no-op.
 *
 * @param {string} scope  e.g. 'welcomer'
 * @param {string} key    e.g. a guild id, or `msg:<id>` for a draft
 * @param {object} snapshot state BEFORE the change
 * @param {string} [label]  short description shown in the panel
 */
function record(scope, key, snapshot, label) {
    if (!scope || !key || snapshot === undefined || snapshot === null) return;

    let clone;
    try {
        clone = structuredClone(snapshot);
    } catch {
        try { clone = JSON.parse(JSON.stringify(snapshot)); } catch { return; }
    }

    const m = bucket(scope);
    m.set(key, { snapshot: clone, at: Date.now(), label: label || 'previous settings' });

    // LRU-ish trim: Map preserves insertion order, so the oldest key is first.
    while (m.size > DEFAULT_MAX) {
        const oldest = m.keys().next().value;
        m.delete(oldest);
    }

    if (++writes % 50 === 0) sweep();
}

/** Is there something to restore? Does NOT consume it. */
function has(scope, key) {
    const entry = bucket(scope).get(key);
    if (!entry) return false;
    if (Date.now() - entry.at > DEFAULT_TTL_MS) {
        bucket(scope).delete(key);
        return false;
    }
    return true;
}

/** Metadata for the panel label, without consuming. */
function describe(scope, key) {
    if (!has(scope, key)) return null;
    const entry = bucket(scope).get(key);
    return { at: entry.at, label: entry.label };
}

/**
 * Take the snapshot and DELETE it, so undo is available exactly once.
 * Returns null when there is nothing (or it expired).
 */
function consume(scope, key) {
    if (!has(scope, key)) return null;
    const entry = bucket(scope).get(key);
    bucket(scope).delete(key);
    return entry.snapshot;
}

/** Discard without restoring — used when a fresh panel supersedes the history. */
function clear(scope, key) {
    bucket(scope).delete(key);
}

function stats() {
    let total = 0;
    for (const m of store.values()) total += m.size;
    return { scopes: store.size, entries: total, ttlMs: DEFAULT_TTL_MS, max: DEFAULT_MAX };
}

module.exports = { record, has, describe, consume, clear, stats, DEFAULT_TTL_MS, DEFAULT_MAX };
