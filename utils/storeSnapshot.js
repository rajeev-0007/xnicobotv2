'use strict';

/**
 * storeSnapshot.js — full json_store backup & recovery.
 *
 * The custom jsonStore persists each "store" as one row in the
 * PostgreSQL `json_store` table (or a file in json_stores/ in local
 * fallback mode). There was previously NO way to snapshot or roll back
 * that data, so a bad write / accidental wipe was unrecoverable.
 *
 * This module writes timestamped snapshots of EVERY store to a local
 * `store_snapshots/` directory (gzip-compressed JSON), keeps the most
 * recent N, and can restore an individual store or all stores from a
 * snapshot. Snapshots run automatically on an interval and can be taken
 * / restored on demand by the bot owner.
 *
 * Snapshots are intentionally written to the local disk (not the same
 * PG table) so a PG-side wipe can still be recovered from disk.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

const SNAPSHOT_DIR = path.join(__dirname, '..', 'store_snapshots');
const MAX_SNAPSHOTS = 48;            // keep the newest 48 (e.g. ~2 days at hourly)
const AUTO_INTERVAL_MS = 60 * 60 * 1000;  // hourly
const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;  // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;  // cleanup check every 1 hour

let _autoTimer = null;
let _cleanupTimer = null;

function _ensureDir() {
    if (!fs.existsSync(SNAPSHOT_DIR)) {
        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    }
}

/**
 * Snapshot every store currently in the jsonStore cache to a single
 * gzipped file. Returns { success, name, stores, bytes } or { success:false }.
 */
async function createSnapshot(reason = 'manual') {
    try {
        _ensureDir();

        // Pull the freshest copy of everything. In PG mode, refresh() with
        // no args reloads the whole table into cache first so the snapshot
        // reflects the database, not a possibly-stale cache.
        try { await jsonStore.refresh(); } catch {}

        const all = {};
        let storeCount = 0;
        // jsonStore exposes its cache as a Map via the `cache` field.
        const cache = jsonStore.cache;
        if (cache && typeof cache.forEach === 'function') {
            cache.forEach((value, key) => {
                all[key] = value;
                storeCount++;
            });
        }

        const payload = {
            version: 1,
            createdAt: new Date().toISOString(),
            reason,
            storeCount,
            stores: all,
        };

        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const name = `snapshot-${ts}.json.gz`;
        const filePath = path.join(SNAPSHOT_DIR, name);

        const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'));
        fs.writeFileSync(filePath, gz);

        _pruneOld();

        log.info(`[StoreSnapshot] Created ${name} (${storeCount} stores, ${(gz.length / 1024).toFixed(1)} KB, reason: ${reason})`);
        return { success: true, name, stores: storeCount, bytes: gz.length };
    } catch (err) {
        log.error('[StoreSnapshot] Snapshot failed: ' + err.message);
        return { success: false, error: err.message };
    }
}

function _pruneOld() {
    try {
        const files = listSnapshots();
        if (files.length === 0) return;

        const now = Date.now();
        const toDelete = [];
        let keptByAge = 0;
        let keptByCount = 0;

        // First pass: mark files older than 24 hours for deletion
        for (const f of files) {
            const age = now - f.createdAt.getTime();
            if (age > MAX_SNAPSHOT_AGE_MS) {
                toDelete.push(f);
            } else {
                keptByAge++;
            }
        }

        // Second pass: if we still have more than MAX_SNAPSHOTS, delete oldest
        const remainingFiles = files.filter(f => !toDelete.includes(f));
        if (remainingFiles.length > MAX_SNAPSHOTS) {
            const excess = remainingFiles.slice(MAX_SNAPSHOTS);
            toDelete.push(...excess);
            keptByCount = MAX_SNAPSHOTS;
        } else {
            keptByCount = remainingFiles.length;
        }

        // Delete marked files
        if (toDelete.length > 0) {
            let deletedCount = 0;
            let freedBytes = 0;

            for (const f of toDelete) {
                try {
                    const filePath = path.join(SNAPSHOT_DIR, f.name);
                    freedBytes += f.size;
                    fs.unlinkSync(filePath);
                    deletedCount++;
                } catch {}
            }

            if (deletedCount > 0) {
                log.info(
                    `[StoreSnapshot] Cleanup: Deleted ${deletedCount} old snapshot(s) ` +
                    `(freed ${(freedBytes / 1024 / 1024).toFixed(2)} MB), ` +
                    `kept ${keptByCount} recent snapshot(s)`
                );
            }
        }
    } catch (err) {
        log.error(`[StoreSnapshot] Cleanup failed: ${err.message}`);
    }
}

/**
 * List available snapshots, newest first.
 * @returns {Array<{name, size, createdAt}>}
 */
function listSnapshots() {
    try {
        _ensureDir();
        return fs.readdirSync(SNAPSHOT_DIR)
            .filter(f => f.endsWith('.json.gz'))
            .map(f => {
                const stat = fs.statSync(path.join(SNAPSHOT_DIR, f));
                return { name: f, size: stat.size, createdAt: stat.mtime };
            })
            .sort((a, b) => b.createdAt - a.createdAt);
    } catch {
        return [];
    }
}

function _readSnapshot(name) {
    // Guard against path traversal.
    const safe = path.basename(name);
    const filePath = path.join(SNAPSHOT_DIR, safe);
    if (!fs.existsSync(filePath)) return null;
    try {
        const raw = zlib.gunzipSync(fs.readFileSync(filePath));
        return JSON.parse(raw.toString('utf8'));
    } catch (err) {
        log.error(`[StoreSnapshot] Failed to read ${safe}: ${err.message}`);
        return null;
    }
}

/**
 * Inspect a snapshot without restoring it.
 * @returns {{success, createdAt, reason, storeCount, storeNames}|{success:false}}
 */
function inspectSnapshot(name) {
    const snap = _readSnapshot(name);
    if (!snap) return { success: false, error: 'Snapshot not found or unreadable.' };
    return {
        success: true,
        createdAt: snap.createdAt,
        reason: snap.reason,
        storeCount: snap.storeCount,
        storeNames: Object.keys(snap.stores || {}),
    };
}

/**
 * Restore stores from a snapshot.
 *
 * @param {string} name        snapshot file name
 * @param {object} [opts]
 * @param {string[]} [opts.only]  restore only these store names (default: all)
 * @param {boolean} [opts.merge]  for object stores, merge keys instead of
 *                                replacing the whole store (default false =
 *                                full replace from the snapshot)
 * @returns {{success, restored:string[]}|{success:false}}
 */
async function restoreSnapshot(name, opts = {}) {
    const snap = _readSnapshot(name);
    if (!snap || !snap.stores) return { success: false, error: 'Snapshot not found or unreadable.' };

    const only = Array.isArray(opts.only) && opts.only.length ? new Set(opts.only) : null;
    const merge = !!opts.merge;
    const restored = [];

    for (const [storeName, value] of Object.entries(snap.stores)) {
        if (only && !only.has(storeName)) continue;
        try {
            if (merge && value && typeof value === 'object' && !Array.isArray(value)) {
                const current = jsonStore.read(storeName) || {};
                const mergedData = { ...current, ...value };
                await jsonStore.writeImmediate(storeName, mergedData);
            } else {
                await jsonStore.writeImmediate(storeName, value);
            }
            restored.push(storeName);
        } catch (err) {
            log.error(`[StoreSnapshot] Restore failed for ${storeName}: ${err.message}`);
        }
    }

    log.info(`[StoreSnapshot] Restored ${restored.length} store(s) from ${name}`);
    return { success: true, restored };
}

/**
 * Start the automatic hourly snapshot timer (idempotent). Also takes one
 * snapshot shortly after boot so there's always a recent recovery point.
 * Additionally starts the cleanup timer to remove snapshots older than 24 hours.
 */
function startAuto() {
    if (_autoTimer) return;
    
    // First snapshot 2 min after start (let stores finish loading).
    setTimeout(() => { 
        createSnapshot('auto-boot').catch(() => {}); 
    }, 2 * 60 * 1000).unref?.();
    
    // Schedule hourly snapshots
    _autoTimer = setInterval(() => { 
        createSnapshot('auto').catch(() => {}); 
    }, AUTO_INTERVAL_MS);
    if (_autoTimer.unref) _autoTimer.unref();
    
    // Schedule cleanup checks (runs every hour to remove old snapshots)
    _cleanupTimer = setInterval(() => {
        _pruneOld();
    }, CLEANUP_INTERVAL_MS);
    if (_cleanupTimer.unref) _cleanupTimer.unref();
    
    // Run initial cleanup after 5 minutes
    setTimeout(() => {
        _pruneOld();
    }, 5 * 60 * 1000).unref?.();
    
    log.success('[StoreSnapshot] Auto-snapshot scheduler started (hourly, 24h retention)');
}

/**
 * Stop all automatic timers (for graceful shutdown).
 */
function stopAuto() {
    if (_autoTimer) {
        clearInterval(_autoTimer);
        _autoTimer = null;
    }
    if (_cleanupTimer) {
        clearInterval(_cleanupTimer);
        _cleanupTimer = null;
    }
    log.info('[StoreSnapshot] Auto-snapshot scheduler stopped');
}

/**
 * Manually trigger cleanup of old snapshots (24h+).
 * Can be called by a command or maintenance script.
 * @returns {{success, deleted, kept, freedMB}}
 */
function cleanupOld() {
    try {
        const files = listSnapshots();
        if (files.length === 0) {
            return { success: true, deleted: 0, kept: 0, freedMB: 0 };
        }

        const now = Date.now();
        const toDelete = [];
        let keptCount = 0;

        // Mark files older than 24 hours
        for (const f of files) {
            const age = now - f.createdAt.getTime();
            if (age > MAX_SNAPSHOT_AGE_MS) {
                toDelete.push(f);
            } else {
                keptCount++;
            }
        }

        // Also respect MAX_SNAPSHOTS limit
        const remainingFiles = files.filter(f => !toDelete.includes(f));
        if (remainingFiles.length > MAX_SNAPSHOTS) {
            const excess = remainingFiles.slice(MAX_SNAPSHOTS);
            toDelete.push(...excess);
            keptCount = MAX_SNAPSHOTS;
        } else {
            keptCount = remainingFiles.length;
        }

        // Delete marked files
        let deletedCount = 0;
        let freedBytes = 0;

        for (const f of toDelete) {
            try {
                const filePath = path.join(SNAPSHOT_DIR, f.name);
                freedBytes += f.size;
                fs.unlinkSync(filePath);
                deletedCount++;
            } catch {}
        }

        return {
            success: true,
            deleted: deletedCount,
            kept: keptCount,
            freedMB: (freedBytes / 1024 / 1024).toFixed(2)
        };
    } catch (err) {
        log.error(`[StoreSnapshot] Manual cleanup failed: ${err.message}`);
        return { success: false, error: err.message };
    }
}

module.exports = {
    createSnapshot,
    listSnapshots,
    inspectSnapshot,
    restoreSnapshot,
    cleanupOld,
    startAuto,
    stopAuto,
    SNAPSHOT_DIR,
    MAX_SNAPSHOT_AGE_MS,
};
