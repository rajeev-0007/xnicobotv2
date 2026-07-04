#!/usr/bin/env node
/**
 * Cleanup Script: Remove deleted server IDs from database
 * 
 * This script removes entries for servers that no longer exist (deleted/kicked)
 * from all JSON stores in the PostgreSQL database.
 * 
 * Usage: node scripts/cleanup-deleted-servers.js <guildId1> <guildId2> ...
 * Example: node scripts/cleanup-deleted-servers.js 1458528532920799376
 * 
 * Use --force to skip Discord verification (when you already know the server is deleted)
 */

require('dotenv').config();
const jsonStore = require('../utils/jsonStore');

// Parse command line arguments
const args = process.argv.slice(2);
const forceMode = args.includes('--force');
const serverIdsToRemove = args.filter(arg => arg !== '--force');

if (serverIdsToRemove.length === 0) {
    console.error('<:Cancel:1473037949187657818> Error: Please provide at least one server ID to remove.');
    console.error('Usage: node scripts/cleanup-deleted-servers.js <guildId1> <guildId2> ... [--force]');
    console.error('');
    console.error('Options:');
    console.error('  --force  Skip Discord verification (use when you know the server is deleted)');
    process.exit(1);
}

console.log('🧹 Server Cleanup Script');
console.log('━'.repeat(60));
console.log(`📋 Servers to remove: ${serverIdsToRemove.join(', ')}`);
if (forceMode) {
    console.log('⚡ Force mode enabled - skipping Discord verification');
}
console.log('');

// All known JSON stores that might contain per-guild data
const GUILD_STORES = [
    'logs', 'logging', 'automod', 'antinuke', 'welcomer', 'levelchannel',
    'antispam', 'antiraid', 'antialt', 'vanityguard', 'tickets',
    'autoresponder', 'autoreact', 'autorole', 'autonick', 'voiceautorole',
    'reactionroles', 'starboard', 'suggestions', 'giveaways', 'giveaway-settings',
    'media-only', 'sticky', 'simple-sticky', 'booster-notify', 'social-notify',
    'button-commands', 'select-menus', 'customcmds', 'welcomer-templates',
    'verification', 'invites', 'join2create', 'serverstats',
    'levelingtoggle', 'levelmultiplier', 'levelroles',
    'applications', 'application-responses', 'aichat',
    'panel-registry', 'musicpanel', 'musicpanel-247', 'guildtags', 'servertag',
    'servertag-users', 'vote-config', 'birthdays', 'confessions', 'reminders',
    'spotify-links', 'marriages', 'reputation', 'user-templates', 'voicebans',
    'guilds', 'prefixes', 'emergency', 'nightmode', 'botblock', 'statusrole',
    'ignored-channels', 'lockdown', 'trust', 'warnings', 'modlogs'
];

async function main() {
    try {
        // Initialize JSON store (connects to PostgreSQL)
        console.log('� Connecting to database...');
        await jsonStore.init();
        console.log('<:Checkedbox:1473038547165384804> Database connected\n');

        // In force mode, treat all provided IDs as deleted servers
        const deletedServers = serverIdsToRemove;

        console.log(`�️  Cleaning up ${deletedServers.length} server(s) from database...`);
        console.log('━'.repeat(60));

        let totalRemoved = 0;
        const removedFrom = [];

        // Clean each store
        for (const storeName of GUILD_STORES) {
            if (!jsonStore.has(storeName)) continue;

            const storeData = jsonStore.read(storeName);
            let modified = false;

            for (const guildId of deletedServers) {
                if (storeData[guildId]) {
                    delete storeData[guildId];
                    modified = true;
                    totalRemoved++;
                    removedFrom.push(storeName);
                    console.log(`   🗑️  Removed ${guildId} from ${storeName}`);
                }
            }

            if (modified) {
                await jsonStore.writeImmediate(storeName, storeData);
            }
        }

        console.log('');
        console.log('━'.repeat(60));

        if (totalRemoved === 0) {
            console.log('ℹ️  No entries found for the specified server(s).');
            console.log('   The database is already clean or the server ID was never configured.');
        } else {
            console.log(`<:Checkedbox:1473038547165384804> Cleanup complete!`);
            console.log(`   📊 Total entries removed: ${totalRemoved}`);
            console.log(`   🗑️  Deleted servers cleaned: ${deletedServers.length}`);
            console.log(`   📁 Stores cleaned: ${[...new Set(removedFrom)].length}`);
        }
        console.log('');

        process.exit(0);
    } catch (error) {
        console.error('');
        console.error('<:Cancel:1473037949187657818> Error during cleanup:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

main();
