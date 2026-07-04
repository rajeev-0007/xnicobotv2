'use strict';

/**
 * emojiAutoSync.js — automatically provision the running bot's application
 * with the bundled emoji set (assets/emojis/) on startup.
 *
 * WHY:
 *   Application emoji IDs are per-application. When you deploy with a NEW bot
 *   token, that application starts with no emojis. This module detects that
 *   (the application id changed, or emojis are missing) and uploads the
 *   bundled images automatically — so a new token "just works" without
 *   touching any emoji server.
 *
 * HOW IT DECIDES TO SYNC:
 *   A small state file (.emoji-sync-state.json) records the last application
 *   id that was fully synced and how many emojis it had. On startup we sync
 *   when:
 *     • the application id differs from the recorded one (NEW TOKEN), or
 *     • the application is missing any bundled emoji, or
 *     • the state file is absent.
 *
 * Call ensureEmojisSynced(client) once from the 'ready' handler.
 */

const fs = require('fs');
const path = require('path');
const log = require('./logger-styled');
const { syncApplicationEmojis, loadManifest } = require('./emojiSync');

const STATE_FILE = path.join(__dirname, '..', '.emoji-sync-state.json');

function readState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeState(state) {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
}

/**
 * Ensure the running application has the full bundled emoji set.
 * @param {import('discord.js').Client} client  a logged-in client
 * @param {object} [opts]
 * @param {boolean} [opts.force]  re-check even if state matches
 */
async function ensureEmojisSynced(client, { force = false } = {}) {
    try {
        const token = client?.token || process.env.TOKEN;
        const appId = client?.application?.id || process.env.CLIENT_ID;
        if (!token || !appId) {
            log.warning('[EmojiSync] Skipped — no token/application id available.');
            return;
        }

        const manifest = loadManifest();
        if (manifest.length === 0) {
            log.warning('[EmojiSync] No bundled emojis in assets/emojis/ — skipping.');
            return;
        }

        const state = readState();
        const sameApp = state.applicationId === appId;
        // Consider it done when we've already synced THIS application against
        // the CURRENT bundled set. We key on the manifest size rather than the
        // live emoji count because Discord silently de-duplicates byte-identical
        // images, so the app may stably hold fewer emojis than the manifest
        // lists — requiring an exact count match would retry forever.
        const alreadyDone = sameApp && state.manifestCount === manifest.length;

        if (!force && alreadyDone) {
            log.debug(`[EmojiSync] Application ${appId} already synced for current emoji set.`);
            return;
        }

        if (!sameApp) {
            log.info(`[EmojiSync] New application detected (${appId}) — provisioning emojis...`);
        } else {
            log.info('[EmojiSync] Verifying application emojis...');
        }

        const result = await syncApplicationEmojis({
            token,
            applicationId: appId,
            logger: (m) => log.debug(m),
        });

        const finalCount = Object.keys(result.map).length;
        writeState({
            applicationId: appId,
            emojiCount: finalCount,
            manifestCount: manifest.length,
            lastSync: new Date().toISOString(),
        });

        if (result.uploaded > 0 || result.failed > 0) {
            log.success(`[EmojiSync] Done — uploaded ${result.uploaded}, skipped ${result.skipped}, failed ${result.failed} (app now has ${finalCount}).`);
        } else {
            log.info(`[EmojiSync] All ${finalCount} emojis already present.`);
        }

        // Refresh emojiGuard's registry so components immediately resolve
        // the freshly-uploaded application emoji ids (critical on a new token
        // where the app started empty before this sync ran).
        if (result.uploaded > 0) {
            try {
                const emojiGuard = require('./emojiGuard');
                if (typeof emojiGuard.loadApplicationEmojis === 'function') {
                    await emojiGuard.loadApplicationEmojis(client);
                }
            } catch {}
        }
    } catch (e) {
        log.error(`[EmojiSync] Auto-sync failed: ${e.message}`);
    }
}

module.exports = { ensureEmojisSynced };
