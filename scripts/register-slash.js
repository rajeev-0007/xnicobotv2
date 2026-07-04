#!/usr/bin/env node
/**
 * scripts/register-slash.js — One-shot slash-command registrar.
 *
 * Loads the bot's command tree (honoring utils/slashBlocklist.js),
 * then forces a fresh push to Discord using the TOKEN + CLIENT_ID
 * from .env. Used after rotating tokens or when you want to
 * re-deploy slash commands without restarting the bot.
 *
 *   node scripts/register-slash.js
 *
 * The script logs in to fetch the current guild list (so guild-
 * specific commands can be deployed), then exits.
 */

'use strict';

require('dotenv').config();

const fs    = require('fs');
const path  = require('path');
const { Client, GatewayIntentBits } = require('discord.js');
const { autoRegister, invalidateCache } = require('../utils/slashRegistrar');
const { isSlashBlocked } = require('../utils/slashBlocklist');

const TOKEN     = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error('ERROR: TOKEN and CLIENT_ID must be set in .env');
    process.exit(1);
}

function loadCommands() {
    // Match the folder list from index.js so this script and the
    // boot-time registrar always see the same command universe.
    const folders = [
        'music', 'voice', 'basic', 'fun', 'games', 'action', 'admin',
        'automation', 'utility', 'owner', 'economy', 'leveling',
        'image', 'social', 'backup', 'webhook', 'dm', 'stats',
    ];

    const commands = [];
    const seen = new Set();
    let totalScanned = 0;
    let blocked = 0;
    let prefixOnly = 0;
    let invalid = 0;

    for (const folder of folders) {
        const folderPath = path.join(__dirname, '..', 'commands', folder);
        if (!fs.existsSync(folderPath)) continue;

        const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.js'));
        for (const file of files) {
            totalScanned++;
            try {
                const mod = require(path.join(folderPath, file));
                if (!mod.data || mod.prefixOnly || typeof mod.execute !== 'function') {
                    prefixOnly++;
                    continue;
                }
                const json = mod.data.toJSON();
                if (!json?.name) {
                    invalid++;
                    continue;
                }
                if (isSlashBlocked(json.name)) {
                    blocked++;
                    continue;
                }
                if (seen.has(json.name)) continue;
                seen.add(json.name);
                json.category = folder;
                commands.push(json);
            } catch (err) {
                invalid++;
                console.warn(`  Skipped commands/${folder}/${file}: ${err.message}`);
            }
        }
    }

    console.log(`Scanned ${totalScanned} files → ${commands.length} slash commands (`
        + `${blocked} blocklisted, ${prefixOnly} prefix-only, ${invalid} invalid).`);
    return commands;
}

(async () => {
    console.log('Loading commands…');
    const commands = loadCommands();
    if (commands.length === 0) {
        console.error('No slash commands found. Aborting.');
        process.exit(1);
    }

    // Force a re-register regardless of the cache state. This is the
    // whole point of running the script manually.
    invalidateCache();

    // We need a logged-in client so the registrar can enumerate guilds.
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    let timeout;
    let alreadyRan = false;
    const onReady = async () => {
        if (alreadyRan) return; // discord.js fires both ClientReady AND its 'ready' alias
        alreadyRan = true;
        clearTimeout(timeout);
        try {
            console.log(`Logged in as ${client.user.tag} (${client.user.id})`);
            console.log(`Visible in ${client.guilds.cache.size} guild(s). Registering…`);

            const result = await autoRegister({
                client,
                token: TOKEN,
                clientId: CLIENT_ID,
                commands,
                force: true,
            });

            if (result.registered) {
                console.log(
                    `\n✓ Registered: ${result.global} global + ${result.guild} guild commands `
                    + `(reason: ${result.reason}).`
                );
                if (result.dropped > 0) {
                    console.warn(`⚠  ${result.dropped} command(s) dropped (over the 200-per-guild cap).`);
                    console.warn('   Move them to utils/slashBlocklist.js or merge into subcommands.');
                }
            } else {
                console.log(`No registration performed (reason: ${result.reason}).`);
            }
        } catch (err) {
            console.error('Registration failed:', err);
        } finally {
            client.destroy();
            process.exit(0);
        }
    };
    // discord.js v14 emits ClientReady; the legacy 'ready' alias is being
    // deprecated in v15. The flag above prevents the dual listener from
    // firing the registration twice on current builds.
    const { Events } = require('discord.js');
    client.once(Events.ClientReady, onReady);

    // Hard timeout so a stuck login doesn't hang CI / scripts forever.
    timeout = setTimeout(() => {
        console.error('Login timed out after 30 seconds. Check TOKEN / CLIENT_ID and bot privilege.');
        client.destroy();
        process.exit(1);
    }, 30_000);

    try {
        await client.login(TOKEN);
    } catch (err) {
        clearTimeout(timeout);
        console.error('Login failed:', err.message);
        process.exit(1);
    }
})().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
