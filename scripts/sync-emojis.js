#!/usr/bin/env node
/**
 * sync-emojis.js — upload the repo's bundled emoji images (assets/emojis/)
 * to the bot's Application Emojis.
 *
 * This is the manual CLI front-end for utils/emojiSync.js. It uploads from
 * LOCAL files, so it does not depend on any external emoji server — a fresh
 * bot token can be fully provisioned with `node scripts/sync-emojis.js`.
 *
 * The bot also does this automatically on startup (utils/emojiAutoSync.js),
 * so this script is only needed for manual/one-off provisioning.
 *
 * USAGE:
 *   node scripts/sync-emojis.js --dry-run    # list what WOULD upload
 *   node scripts/sync-emojis.js              # upload missing emojis
 * ENV: TOKEN, CLIENT_ID  (root .env auto-loaded)
 *
 * NOTE: To (re)build assets/emojis/ from a server that already has the
 * emojis, use scripts/download-app-emojis.js first.
 */

'use strict';
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}

const { syncApplicationEmojis } = require('../utils/emojiSync');

const DRY_RUN = process.argv.includes('--dry-run');
const TOKEN = process.env.TOKEN || '';
const CLIENT_ID = process.env.CLIENT_ID || '';

async function main() {
    if (!TOKEN || !CLIENT_ID) {
        console.error('\n✖ TOKEN and CLIENT_ID must be set (in env or root .env).\n');
        process.exitCode = 1;
        return;
    }

    console.log(`\n  Syncing bundled emojis → application ${CLIENT_ID}${DRY_RUN ? '  [DRY RUN]' : ''}\n`);

    const result = await syncApplicationEmojis({
        token: TOKEN,
        applicationId: CLIENT_ID,
        dryRun: DRY_RUN,
        logger: (m) => console.log(m),
    });

    console.log('\n  ── Summary ─────────────────────────────');
    console.log(`  Bundled total: ${result.total}`);
    console.log(`  Uploaded: ${result.uploaded}`);
    console.log(`  Skipped (already present): ${result.skipped}`);
    console.log(`  Failed: ${result.failed}`);
    console.log(`  ${DRY_RUN ? '(dry run — nothing uploaded)' : 'Done.'}\n`);

    process.exitCode = result.failed > 0 ? 1 : 0;
}

main().catch(err => {
    console.error('\n✖ Sync crashed:', err.message);
    process.exitCode = 1;
});
