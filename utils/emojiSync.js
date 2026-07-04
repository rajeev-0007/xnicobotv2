'use strict';

/**
 * emojiSync.js — upload the repo's bundled emoji images (assets/emojis/) to
 * a bot application's Application Emojis.
 *
 * This is the SINGLE source of truth for emoji syncing, used by:
 *   • scripts/sync-emojis.js   (manual CLI)
 *   • utils/emojiAutoSync.js   (automatic on bot startup / new token)
 *
 * Because it uploads from local files, it does NOT depend on any external
 * server's CDN — so a brand-new bot token can be fully provisioned with the
 * bot's emoji set automatically.
 *
 * Application emojis are usable by the bot in EVERY server with no per-guild
 * upload, which is why we can drop the old "emoji server" entirely.
 */

const fs = require('fs');
const path = require('path');

const EMOJI_DIR = path.join(__dirname, '..', 'assets', 'emojis');
const MANIFEST = path.join(EMOJI_DIR, 'manifest.json');
const API = 'https://discord.com/api/v10';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Load the bundled emoji manifest (or derive it from the folder). */
function loadManifest() {
    try {
        if (fs.existsSync(MANIFEST)) {
            return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
        }
    } catch {}
    // Fallback: scan the directory.
    if (!fs.existsSync(EMOJI_DIR)) return [];
    return fs.readdirSync(EMOJI_DIR)
        .filter(f => /\.(png|gif)$/i.test(f))
        .map(f => ({
            name: path.basename(f, path.extname(f)),
            animated: /\.gif$/i.test(f),
            file: f,
        }));
}

async function apiCall(token, method, endpoint, body, logger) {
    for (let attempt = 0; attempt < 5; attempt++) {
        const res = await fetch(`${API}${endpoint}`, {
            method,
            headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (res.status === 429) {
            const data = await res.json().catch(() => ({}));
            const wait = (data.retry_after || 1) * 1000 + 250;
            logger?.(`  …rate limited, waiting ${Math.ceil(wait)}ms`);
            await sleep(wait);
            continue;
        }
        return res;
    }
    throw new Error('Rate limited too many times');
}

async function listAppEmojis(token, appId, logger) {
    const res = await apiCall(token, 'GET', `/applications/${appId}/emojis`, null, logger);
    if (!res.ok) throw new Error(`List failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
}

function fileToDataUri(file, animated) {
    const buf = fs.readFileSync(path.join(EMOJI_DIR, file));
    const mime = animated ? 'image/gif' : 'image/png';
    return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * Ensure the given application has every bundled emoji (matched by name).
 * Uploads only the ones that are missing — safe and idempotent.
 *
 * @param {object} opts
 * @param {string} opts.token          bot token
 * @param {string} opts.applicationId  application (client) id
 * @param {function} [opts.logger]     line logger (defaults to console.log)
 * @param {boolean} [opts.dryRun]
 * @returns {Promise<{ uploaded, skipped, failed, total, map }>}
 *          map = { emojiName: emojiId } for every emoji now on the app
 */
async function syncApplicationEmojis({ token, applicationId, logger, dryRun = false } = {}) {
    const log = logger || ((m) => console.log(m));
    if (!token || !applicationId) throw new Error('token and applicationId are required');

    const manifest = loadManifest();
    if (manifest.length === 0) {
        log('  ⚠ No bundled emojis found in assets/emojis/ — nothing to sync.');
        return { uploaded: 0, skipped: 0, failed: 0, total: 0, map: {} };
    }

    const existing = await listAppEmojis(token, applicationId, log);
    const byName = new Map(existing.map(e => [e.name.toLowerCase(), e]));
    const map = {};
    for (const e of existing) map[e.name] = e.id;

    let uploaded = 0, skipped = 0, failed = 0;

    for (const entry of manifest) {
        const present = byName.get(entry.name.toLowerCase());
        if (present) { skipped++; continue; }

        if (dryRun) { log(`  • ${entry.name}: would upload`); uploaded++; continue; }

        try {
            const image = fileToDataUri(entry.file, entry.animated);
            const res = await apiCall(token, 'POST', `/applications/${applicationId}/emojis`,
                { name: entry.name, image }, log);
            if (!res.ok) {
                failed++;
                log(`  ✖ ${entry.name}: ${res.status} ${(await res.text()).slice(0, 120)}`);
            } else {
                const created = await res.json();
                map[created.name] = created.id;
                uploaded++;
                log(`  ✔ ${entry.name}: uploaded (${created.id})`);
            }
        } catch (e) {
            failed++;
            log(`  ✖ ${entry.name}: ${e.message}`);
        }
        await sleep(350);
    }

    return { uploaded, skipped, failed, total: manifest.length, map };
}

module.exports = { syncApplicationEmojis, loadManifest, listAppEmojis, EMOJI_DIR };
