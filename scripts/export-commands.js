#!/usr/bin/env node
/**
 * scripts/export-commands.js — Export a CLEAN application-commands JSON.
 *
 * Produces `commands.json` (a plain JSON array of Discord slash-command
 * objects) that you can paste / upload to top.gg's command list.
 *
 *   node scripts/export-commands.js
 *
 * Why this exists:
 *   The bot attaches an internal `category` field to each command object for
 *   its own bookkeeping. Discord ignores that unknown field, but top.gg's
 *   parser rejects it ("We were unable to parse your application command
 *   JSON"). This script calls each command's `.toJSON()` and strips every
 *   non-standard field, so the output is pure, valid Discord command JSON.
 *
 * Offline: no bot token, no login, no network needed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

let isSlashBlocked = () => false;
try { ({ isSlashBlocked } = require('../utils/slashBlocklist')); } catch { /* optional */ }

// Same folder universe the bot loads commands from.
const FOLDERS = [
    'music', 'voice', 'basic', 'fun', 'games', 'action', 'admin',
    'automation', 'utility', 'owner', 'economy', 'leveling',
    'image', 'social', 'backup', 'webhook', 'dm', 'stats',
];

// Only these top-level keys are part of Discord's application-command schema.
// Anything else (e.g. the bot's internal `category`) is dropped.
const ALLOWED = new Set([
    'name', 'name_localizations', 'description', 'description_localizations',
    'options', 'default_member_permissions', 'dm_permission',
    'default_permission', 'nsfw', 'type', 'contexts', 'integration_types',
]);

function clean(obj) {
    const out = {};
    for (const key of Object.keys(obj)) {
        if (!ALLOWED.has(key)) continue;
        out[key] = obj[key];
    }
    return out;
}

const commands = [];
const seen = new Set();
let scanned = 0, skipped = 0;

for (const folder of FOLDERS) {
    const dir = path.join(__dirname, '..', 'commands', folder);
    if (!fs.existsSync(dir)) continue;

    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
        scanned++;
        try {
            const mod = require(path.join(dir, file));
            if (!mod.data || mod.prefixOnly || typeof mod.execute !== 'function') { skipped++; continue; }

            const json = mod.data.toJSON();
            if (!json || !json.name) { skipped++; continue; }
            if (isSlashBlocked(json.name) || seen.has(json.name)) { skipped++; continue; }

            seen.add(json.name);
            commands.push(clean(json));
        } catch (err) {
            skipped++;
            console.warn(`  Skipped commands/${folder}/${file}: ${err.message}`);
        }
    }
}

commands.sort((a, b) => a.name.localeCompare(b.name));

const outPath = path.join(__dirname, '..', 'commands.json');
const jsonText = JSON.stringify(commands, null, 2);

// Round-trip parse to guarantee the output is valid JSON before writing.
JSON.parse(jsonText);
fs.writeFileSync(outPath, jsonText);

console.log(`Scanned ${scanned} files, skipped ${skipped}.`);
console.log(`Wrote ${outPath}`);
console.log(`${commands.length} commands, ${(jsonText.length / 1024).toFixed(1)} KB of valid JSON.`);
console.log('Upload / paste commands.json into top.gg.');
