'use strict';

/**
 * rebuild-emoji-manifest.js — regenerate assets/emojis/manifest.json by
 * scanning the emoji directory. Run this whenever new emoji PNGs/GIFs are
 * added so the auto-sync (utils/emojiAutoSync.js) uploads them as the bot's
 * Application Emojis (developer portal) on next startup.
 *
 * Emoji name = filename without extension (must be 2-32 chars, [A-Za-z0-9_]).
 *
 * Run: node scripts/rebuild-emoji-manifest.js
 */

const fs = require('fs');
const path = require('path');

const EMOJI_DIR = path.join(__dirname, '..', 'assets', 'emojis');
const MANIFEST = path.join(EMOJI_DIR, 'manifest.json');

function sanitizeName(base) {
    // Discord app-emoji names allow [A-Za-z0-9_], 2-32 chars.
    let n = base.replace(/[^A-Za-z0-9_]/g, '_');
    if (n.length < 2) n = `e_${n}`;
    return n.slice(0, 32);
}

function main() {
    if (!fs.existsSync(EMOJI_DIR)) {
        console.error('Emoji dir not found:', EMOJI_DIR);
        process.exit(1);
    }

    const files = fs.readdirSync(EMOJI_DIR).filter(f => /\.(png|gif)$/i.test(f));
    const seen = new Set();
    const manifest = [];

    for (const file of files.sort()) {
        const base = path.basename(file, path.extname(file));
        const name = sanitizeName(base);
        if (seen.has(name.toLowerCase())) {
            console.warn(`  ⚠ duplicate name "${name}" (${file}) — skipping`);
            continue;
        }
        seen.add(name.toLowerCase());
        manifest.push({ name, animated: /\.gif$/i.test(file), file });
    }

    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`✅ Wrote ${manifest.length} entries to manifest.json`);

    // Report the badge entries specifically
    const badges = manifest.filter(m => /^rank\d+$/.test(m.name) || /^rarity_/.test(m.name));
    console.log(`   Badge entries included: ${badges.map(b => b.name).join(', ')}`);
}

main();
