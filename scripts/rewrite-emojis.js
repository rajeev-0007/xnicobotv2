#!/usr/bin/env node
/**
 * rewrite-emojis.js — code cutover: replace every old custom-emoji reference
 * <a?:Name:OLDID> in the codebase with the CURRENT application emoji that has
 * the same name. Discord renders custom emojis by ID, so this points all the
 * hardcoded tags at the bot's own application emojis (uploaded earlier),
 * removing any dependence on external emoji servers.
 *
 * Matching is by NAME (case-insensitive). The application emoji's animated
 * flag decides the <a:…> vs <:…> prefix. References whose name has no
 * matching application emoji (e.g. Uncheckbox, nitro_boost, Link — the dead
 * ones) are left untouched and reported.
 *
 * USAGE:
 *   node scripts/rewrite-emojis.js --dry-run    # report changes, write nothing
 *   node scripts/rewrite-emojis.js              # apply
 * ENV: TOKEN, CLIENT_ID (root .env auto-loaded)
 */

'use strict';
const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}

const DRY_RUN = process.argv.includes('--dry-run');
const TOKEN = process.env.TOKEN || '';
const CLIENT_ID = process.env.CLIENT_ID || '';
const ROOT = path.join(__dirname, '..');
const IGNORE = new Set(['node_modules', '.git', '.tts-cache', 'assets', 'scripts']);
const TAG_RE = /<(a?):(\w+):(\d{17,20})>/g;

async function liveEmojiMap() {
    const res = await fetch(`https://discord.com/api/v10/applications/${CLIENT_ID}/emojis`, {
        headers: { Authorization: `Bot ${TOKEN}` },
    });
    if (!res.ok) throw new Error(`List failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
    const map = new Map(); // nameLower -> { id, animated, name }
    for (const e of items) map.set(e.name.toLowerCase(), { id: e.id, animated: !!e.animated, name: e.name });
    return map;
}

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (IGNORE.has(entry.name)) continue;
            yield* walk(path.join(dir, entry.name));
        } else if (/\.(js|json|md|html)$/i.test(entry.name)) {
            yield path.join(dir, entry.name);
        }
    }
}

/**
 * Build an OLD-ID -> { id, name, animated } map for the current app.
 * Strategy: scan the code for every <a?:Name:oldId> pair, then join each
 * old id to an application emoji by NAME. This captures emojis referenced
 * under multiple aliases that share one old id (e.g. Chat == Hashtag).
 */
function buildOldIdMap(files, emap) {
    const byOldId = new Map();
    for (const file of files) {
        let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { continue; }
        let m; TAG_RE.lastIndex = 0;
        while ((m = TAG_RE.exec(txt)) !== null) {
            const [, , name, oldId] = m;
            if (byOldId.has(oldId)) continue;
            const hit = emap.get(name.toLowerCase());
            if (hit) byOldId.set(oldId, hit);
        }
    }
    return byOldId;
}

async function main() {
    if (!TOKEN || !CLIENT_ID) { console.error('\n✖ TOKEN and CLIENT_ID required.\n'); process.exitCode = 1; return; }

    const emap = await liveEmojiMap();
    console.log(`\n  Loaded ${emap.size} application emojis.${DRY_RUN ? '  [DRY RUN]' : ''}\n`);

    const files = [...walk(ROOT)];
    const oldIdMap = buildOldIdMap(files, emap);

    const unmatched = new Map();   // "name:id" -> count
    let filesChanged = 0, totalReplacements = 0, alreadyCurrent = 0;

    for (const file of files) {
        let txt;
        try { txt = fs.readFileSync(file, 'utf8'); } catch { continue; }
        if (!txt.includes('<')) continue;

        let changed = 0;
        const out = txt.replace(TAG_RE, (full, a, name, id) => {
            // Prefer mapping by NAME, then by OLD ID (catches cross-named ids).
            const hit = emap.get(name.toLowerCase()) || oldIdMap.get(id);
            if (!hit) { const k = `${name}:${id}`; unmatched.set(k, (unmatched.get(k) || 0) + 1); return full; }
            const replacement = `<${hit.animated ? 'a' : ''}:${hit.name}:${hit.id}>`;
            if (replacement === full) { alreadyCurrent++; return full; }
            changed++;
            return replacement;
        });

        if (changed > 0) {
            filesChanged++;
            totalReplacements += changed;
            if (!DRY_RUN) fs.writeFileSync(file, out);
        }
    }

    console.log('  ── Summary ─────────────────────────────');
    console.log(`  Files ${DRY_RUN ? 'to change' : 'changed'}: ${filesChanged}`);
    console.log(`  Replacements: ${totalReplacements}`);
    console.log(`  Already current: ${alreadyCurrent}`);
    if (unmatched.size) {
        console.log(`\n  Left untouched (no application emoji match):`);
        for (const [k, count] of [...unmatched.entries()].sort()) {
            console.log(`    • ${k} (${count}x)`);
        }
    }
    console.log(`  ${DRY_RUN ? '(dry run — nothing written)' : 'Done.'}\n`);
}

main().catch(e => { console.error('✖ crashed:', e.message); process.exitCode = 1; });
