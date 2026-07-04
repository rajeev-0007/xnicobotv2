#!/usr/bin/env node
/**
 * migrate-local-to-pg.js — one-time import of the bot's local json_stores
 * data into the shared PostgreSQL `json_store` table.
 *
 * WHY YOU NEED THIS
 *   The dashboard (e.g. on Vercel) and the bot only see each other's data
 *   when they share the SAME PostgreSQL database (DATABASE_URL). If the bot
 *   was previously running in LOCAL mode (no DATABASE_URL), all of its config
 *   lives in `json_stores/*.json` on the bot host and was never written to
 *   Postgres — so the dashboard shows nothing for those modules even though
 *   the bot "has" the config. This script copies that local data into the
 *   Postgres DB the dashboard reads, so existing settings finally appear.
 *
 * USAGE  (run on the machine that has the bot's json_stores/ folder)
 *   1. Set DATABASE_URL to the SAME connection string the dashboard uses.
 *      (a .env in the project root is loaded automatically.)
 *   2. Run one of:
 *        node scripts/migrate-local-to-pg.js            # safe merge (default)
 *        node scripts/migrate-local-to-pg.js --force    # local fully overwrites PG
 *        node scripts/migrate-local-to-pg.js --dry-run  # show what would change
 *
 * MODES
 *   default (merge)  For each local store: if Postgres has no row, insert it.
 *                    If a row exists, DEEP-MERGE local into it where Postgres
 *                    is missing keys — Postgres values WIN on conflict (it is
 *                    assumed newer). Purely additive and safe to re-run.
 *   --force          Local file content REPLACES the Postgres row entirely.
 *                    Use only if the local files are the source of truth.
 *   --dry-run        Reports the actions it WOULD take, writes nothing.
 *
 * This script never deletes anything.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Load .env from the project root so DATABASE_URL is available the same way
// the bot/dashboard see it. dotenv is already a dashboard dependency.
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}

const FORCE   = process.argv.includes('--force');
const DRY_RUN = process.argv.includes('--dry-run');
const STORE_DIR = path.join(__dirname, '..', 'json_stores');

function isPlainObject(v) {
    return v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Deep-merge `incoming` into `base` where base is missing keys.
 * EXISTING base values win on conflict (base is assumed to be the newer
 * Postgres data). Arrays are treated as scalars — base wins if present.
 */
function mergeFillGaps(base, incoming) {
    if (!isPlainObject(base)) return base === undefined ? incoming : base;
    if (!isPlainObject(incoming)) return base;
    const out = { ...base };
    for (const key of Object.keys(incoming)) {
        if (!(key in out) || out[key] === undefined || out[key] === null) {
            out[key] = incoming[key];
        } else if (isPlainObject(out[key]) && isPlainObject(incoming[key])) {
            out[key] = mergeFillGaps(out[key], incoming[key]);
        }
        // else: base already has a non-empty value — keep it (PG wins).
    }
    return out;
}

async function main() {
    if (!process.env.DATABASE_URL) {
        console.error('\n✖ DATABASE_URL is not set.');
        console.error('  Set it to the SAME Postgres URL the dashboard uses, then re-run.\n');
        process.exit(1);
    }

    if (!fs.existsSync(STORE_DIR)) {
        console.error(`\n✖ No local store directory found at: ${STORE_DIR}`);
        console.error('  Run this on the machine that has the bot\'s json_stores/ folder.\n');
        process.exit(1);
    }

    const files = fs.readdirSync(STORE_DIR).filter(f => f.endsWith('.json'));
    if (files.length === 0) {
        console.error(`\n✖ No .json files found in ${STORE_DIR} — nothing to migrate.\n`);
        process.exit(1);
    }

    const { getPool, closePool } = require('../utils/pgPool');
    const { initializeSchema } = require('../utils/pgSchema');
    const pool = getPool();

    console.log('\n  Local → PostgreSQL migration');
    console.log(`  Mode: ${FORCE ? 'FORCE (overwrite)' : 'merge (safe, additive)'}${DRY_RUN ? '  [DRY RUN]' : ''}`);
    console.log(`  Source: ${STORE_DIR}`);
    console.log(`  Stores found: ${files.length}\n`);

    // Make sure the json_store table exists before we touch it.
    if (!DRY_RUN) {
        try { await initializeSchema(); } catch (e) {
            console.error('✖ Could not ensure schema:', e.message);
            process.exit(1);
        }
    }

    let inserted = 0, merged = 0, overwritten = 0, skipped = 0, failed = 0;

    for (const file of files) {
        const storeName = path.basename(file, '.json');
        let local;
        try {
            local = JSON.parse(fs.readFileSync(path.join(STORE_DIR, file), 'utf8'));
        } catch (e) {
            console.warn(`  ⚠ ${storeName}: skipped (corrupt JSON — ${e.message})`);
            failed++;
            continue;
        }

        let existing = null;
        try {
            const { rows } = await pool.query('SELECT data FROM json_store WHERE store_name = $1', [storeName]);
            existing = rows[0] ? rows[0].data : null;
        } catch (e) {
            console.warn(`  ⚠ ${storeName}: could not read PG row (${e.message}) — treating as new`);
        }

        let finalData;
        let action;
        if (existing === null || existing === undefined) {
            finalData = local;
            action = 'insert';
        } else if (FORCE) {
            finalData = local;
            action = 'overwrite';
        } else {
            finalData = mergeFillGaps(existing, local);
            // If the merge produced no change, skip the write entirely.
            if (JSON.stringify(finalData) === JSON.stringify(existing)) {
                action = 'skip';
            } else {
                action = 'merge';
            }
        }

        if (action === 'skip') {
            skipped++;
            continue;
        }

        if (DRY_RUN) {
            console.log(`  • ${storeName}: would ${action}`);
            if (action === 'insert') inserted++;
            else if (action === 'overwrite') overwritten++;
            else merged++;
            continue;
        }

        try {
            await pool.query(
                `INSERT INTO json_store (store_name, data, updated_at)
                 VALUES ($1, $2::jsonb, NOW())
                 ON CONFLICT (store_name) DO UPDATE SET data = $2::jsonb, updated_at = NOW()`,
                [storeName, JSON.stringify(finalData)]
            );
            if (action === 'insert') { inserted++; console.log(`  ✔ ${storeName}: inserted`); }
            else if (action === 'overwrite') { overwritten++; console.log(`  ✔ ${storeName}: overwritten`); }
            else { merged++; console.log(`  ✔ ${storeName}: merged`); }
        } catch (e) {
            failed++;
            console.error(`  ✖ ${storeName}: write failed — ${e.message}`);
        }
    }

    console.log('\n  ── Summary ─────────────────────────────');
    console.log(`  Inserted (new):     ${inserted}`);
    if (FORCE) console.log(`  Overwritten:        ${overwritten}`);
    else       console.log(`  Merged (gap-fill):  ${merged}`);
    console.log(`  Skipped (no change):${skipped}`);
    console.log(`  Failed:             ${failed}`);
    console.log(`  ${DRY_RUN ? '(dry run — nothing was written)' : 'Done.'}\n`);

    try { await closePool(); } catch {}
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('\n✖ Migration crashed:', err.message);
    process.exit(1);
});
