#!/usr/bin/env node
/**
 * download-app-emojis.js — save the bot's current APPLICATION emojis to
 * assets/emojis/ so the repo becomes self-contained.
 *
 * After this runs, the emoji images live in the repo and the upload/sync
 * no longer depends on any external server's CDN. The auto-sync
 * (utils/emojiAutoSync.js) uploads from this folder to whatever token's
 * application is running.
 *
 * Output:
 *   assets/emojis/<name>.png        (static)
 *   assets/emojis/<name>.gif        (animated)
 *   assets/emojis/manifest.json     [{ name, animated, file }]
 *
 * USAGE:  node scripts/download-app-emojis.js
 * ENV:    TOKEN, CLIENT_ID  (root .env auto-loaded)
 */

'use strict';
const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}

const TOKEN = process.env.TOKEN || '';
const CLIENT_ID = process.env.CLIENT_ID || '';
const OUT_DIR = path.join(__dirname, '..', 'assets', 'emojis');

async function main() {
    if (!TOKEN || !CLIENT_ID) {
        console.error('\n✖ TOKEN and CLIENT_ID must be set.\n');
        process.exitCode = 1; return;
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const res = await fetch(`https://discord.com/api/v10/applications/${CLIENT_ID}/emojis`, {
        headers: { Authorization: `Bot ${TOKEN}` },
    });
    if (!res.ok) { console.error('✖ List failed:', res.status, await res.text()); process.exitCode = 1; return; }
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);

    console.log(`\n  Downloading ${items.length} application emojis to assets/emojis/ ...\n`);
    const manifest = [];
    let ok = 0, fail = 0;

    for (const e of items) {
        const ext = e.animated ? 'gif' : 'png';
        const file = `${e.name}.${ext}`;
        const url = `https://cdn.discordapp.com/emojis/${e.id}.${ext}?size=128&quality=lossless`;
        try {
            const img = await fetch(url);
            if (!img.ok) throw new Error(`CDN ${img.status}`);
            const buf = Buffer.from(await img.arrayBuffer());
            fs.writeFileSync(path.join(OUT_DIR, file), buf);
            manifest.push({ name: e.name, animated: !!e.animated, file });
            ok++;
            console.log(`  ✔ ${file}`);
        } catch (err) {
            fail++;
            console.error(`  ✖ ${e.name}: ${err.message}`);
        }
    }

    manifest.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

    console.log(`\n  Saved ${ok} images, ${fail} failed. Manifest: assets/emojis/manifest.json\n`);
    process.exitCode = fail > 0 ? 1 : 0;
}

main().catch(e => { console.error('✖ crashed:', e.message); process.exitCode = 1; });
