#!/usr/bin/env node
/**
 * rewrite-bareid-emojis.js — second-stage cutover for BARE emoji id refs.
 *
 * The main rewrite-emojis.js only handles <a?:name:id> tags. Components use
 * a bare-id object form that it misses:
 *     emoji: { id: '1486755083390550036' }
 *     .setEmoji('1473038053219106847')
 * This script rewrites those old ids to the current application emoji ids.
 *
 * HOW IT BUILDS THE MAP:
 *   1. old id -> name   : scanned from the PRE-cutover code in git HEAD
 *                         (every <a?:name:id> tag).
 *   2. name  -> new id  : the running application's live emoji list.
 *   3. old id -> new id : joined by name.
 * Then it replaces any quoted old-emoji-id string literal with the new id.
 *
 * SAFETY: emoji ids are globally-unique snowflakes, so a quoted emoji id only
 * ever appears in an emoji context. We still skip utils/emojiGuard.js (its
 * BAD_EMOJI_FALLBACKS map intentionally keys on old ids) and scripts/.
 *
 * USAGE:
 *   node scripts/rewrite-bareid-emojis.js --dry-run
 *   node scripts/rewrite-bareid-emojis.js
 * ENV: TOKEN, CLIENT_ID (root .env auto-loaded)
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}

const DRY_RUN = process.argv.includes('--dry-run');
const TOKEN = process.env.TOKEN || '';
const CLIENT_ID = process.env.CLIENT_ID || '';
const ROOT = path.join(__dirname, '..');
const IGNORE_DIRS = new Set(['node_modules', '.git', '.tts-cache', 'assets', 'scripts']);
const SKIP_FILES = new Set([path.join('utils', 'emojiGuard.js')]);

async function liveByName() {
    const res = await fetch(`https://discord.com/api/v10/applications/${CLIENT_ID}/emojis`, {
        headers: { Authorization: `Bot ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`List failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
    const map = new Map();
    for (const e of items) map.set(e.name.toLowerCase(), { id: e.id, animated: !!e.animated, name: e.name });
    return map;
}

function oldIdToName() {
    // All <a?:name:id> tags from the pre-cutover tree (git HEAD).
    const out = execSync('git grep -hoE "<a?:[A-Za-z0-9_]+:[0-9]{15,20}>" HEAD -- "*.js" "*.json"', {
        cwd: ROOT, maxBuffer: 64 * 1024 * 1024,
    }).toString();
    const re = /<a?:([A-Za-z0-9_]+):(\d{15,20})>/g;
    const map = new Map(); // oldId -> nameLower
    let m;
    while ((m = re.exec(out)) !== null) {
        if (!map.has(m[2])) map.set(m[2], m[1].toLowerCase());
    }
    return map;
}

function* walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!IGNORE_DIRS.has(e.name)) yield* walk(path.join(dir, e.name)); }
        else if (/\.(js)$/i.test(e.name)) yield path.join(dir, e.name);
    }
}

async function main() {
    if (!TOKEN || !CLIENT_ID) { console.error('\n✖ TOKEN and CLIENT_ID required.\n'); process.exitCode = 1; return; }

    const nameMap = await liveByName();
    const oldNames = oldIdToName();

    // old id -> new id  (join by name)
    const idMap = new Map();
    for (const [oldId, name] of oldNames) {
        const hit = nameMap.get(name);
        if (hit && hit.id !== oldId) idMap.set(oldId, hit.id);
    }
    console.log(`\n  old→new id pairs: ${idMap.size} (from ${oldNames.size} old ids, ${nameMap.size} app emojis)${DRY_RUN ? '  [DRY RUN]' : ''}\n`);

    // Match any quoted snowflake; replace when it's a known old emoji id.
    const QUOTED = /(['"])(\d{15,20})\1/g;
    const unmapped = new Map();
    let filesChanged = 0, totalReplacements = 0;

    for (const file of walk(ROOT)) {
        const rel = path.relative(ROOT, file);
        if (SKIP_FILES.has(rel)) continue;
        let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { continue; }

        let changed = 0;
        const out = txt.replace(QUOTED, (full, q, id) => {
            const neu = idMap.get(id);
            if (!neu) {
                // Track old emoji ids we couldn't map (for reporting only).
                if (oldNames.has(id)) unmapped.set(id, oldNames.get(id));
                return full;
            }
            changed++;
            return `${q}${neu}${q}`;
        });

        if (changed > 0) {
            filesChanged++;
            totalReplacements += changed;
            console.log(`  ${DRY_RUN ? '•' : '✔'} ${rel}  (${changed})`);
            if (!DRY_RUN) fs.writeFileSync(file, out);
        }
    }

    console.log('\n  ── Summary ─────────────────────────────');
    console.log(`  Files ${DRY_RUN ? 'to change' : 'changed'}: ${filesChanged}`);
    console.log(`  Replacements: ${totalReplacements}`);
    if (unmapped.size) {
        console.log(`\n  Old emoji ids with no application match (left as-is):`);
        for (const [id, name] of unmapped) console.log(`    • ${name} (${id})`);
    }
    console.log(`  ${DRY_RUN ? '(dry run — nothing written)' : 'Done.'}\n`);
}

main().catch(e => { console.error('✖ crashed:', e.message); process.exitCode = 1; });
