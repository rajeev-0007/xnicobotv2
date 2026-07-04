const { isOwner } = require('../../utils/helpers');
const premiumManager = require('../../utils/premiumManager');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');

/* ------------------ FILE HELPERS ------------------ */

function readConfig() {
    // Always read first - don't check has() as it might return false during initialization
    const data = jsonStore.read('noprefix');
    // If data is empty (no guild configs), return empty object
    // Don't write empty object as it could overwrite data during initialization
    return data && typeof data === 'object' ? data : {};
}

function writeConfig(data) {
    jsonStore.write('noprefix', data);
}

function readGlobalConfig() {
    // Always read first
    const data = jsonStore.read('globalnoprefix');
    // Return data if it exists and has users array, otherwise return default
    if (data && data.users && Array.isArray(data.users)) {
        return data;
    }
    return { users: [] };
}

function writeGlobalConfig(config) {
    jsonStore.write('globalnoprefix', config);
}

/* ------------------ VOTE-BASED NO-PREFIX ------------------ */
/*
 * Voting grants TEMPORARY global no-prefix access — no premium required.
 * Store shape: { [userId]: { expiresAt: <ms>, notifiedExpiry: <bool> } }
 * The default grant is 12 hours. Access is checked in the message handler
 * via `hasVoteNoPrefix()`, and expiry notifications are driven by
 * `expireVoteNoPrefix()` on a scheduler.
 */

const VOTE_NP_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

function readVoteConfig() {
    const data = jsonStore.read('vote-noprefix');
    return data && typeof data === 'object' ? data : {};
}

function writeVoteConfig(config) {
    jsonStore.write('vote-noprefix', config);
}

// Safety check - ensure jsonStore is initialized
function ensureStoreInitialized() {
    if (!jsonStore.initialized) {
        console.warn('[noprefix] jsonStore not initialized yet!');
        // Try to initialize (fire and forget)
        jsonStore.init().catch(err => console.error('[noprefix] Failed to init jsonStore:', err));
    }
}

/* ------------------ NORMALIZATION ------------------ */

function normalizeGuildConfig(guildConfig) {
    if (!guildConfig.serverWide) guildConfig.serverWide = false;
    if (!guildConfig.multiCommand) guildConfig.multiCommand = false;

    // Convert old string-array format → object format
    guildConfig.users = (guildConfig.users || []).map(u => {
        if (typeof u === 'string') {
            return { userId: u, expiresAt: null };
        }
        return {
            userId: u.userId,
            expiresAt: typeof u.expiresAt === 'number' ? u.expiresAt : null
        };
    });
}

/* ------------------ TIME PARSER ------------------ */

function parseDuration(input) {
    if (!input) return null;

    const match = input.match(/^(\d{1,4})(m|h|d)$/i);
    if (!match) return null;

    const value = Number(match[1]);
    const unit = match[2].toLowerCase();

    if (value <= 0) return null;

    const ms = {
        m: 60_000,
        h: 3_600_000,
        d: 86_400_000
    }[unit];

    return Date.now() + value * ms;
}

/* ------------------ CLEANUP ------------------ */

async function cleanupExpired(guildId, client, config) {
    const g = config[guildId];
    if (!g) return false;

    const now = Date.now();
    const remaining = [];
    let changed = false;

    for (const u of g.users) {
        if (!u.expiresAt || u.expiresAt > now) {
            remaining.push(u);
        } else {
            changed = true;
            // DM on expiry (safe)
            client.users.fetch(u.userId)
                .then(user => user.send(
                    `<:Lightning:1521227915537285150> **No-Prefix Access Expired**\n\n` +
                    `Your temporary no-prefix access has expired.\n` +
                    `You must now use the command prefix again.`
                ).catch(() => {}))
                .catch(() => {});
        }
    }

    if (changed) g.users = remaining;
    return changed;
}

/* ------------------ MODULE ------------------ */

module.exports = {
    data: null,
    ownerOnly: true,
    aliases: ['gnp', 'globalnoprefix'],

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        // Ensure jsonStore is initialized before reading/writing
        ensureStoreInitialized();

        const action = args[0]?.toLowerCase();
        const config = readConfig();
        const globalConfig = readGlobalConfig();

        // Server-wide features need a guild
        const guildId = message.guild?.id;
        let guildConfig = null;

        if (guildId) {
            if (!config[guildId]) {
                config[guildId] = { serverWide: false, users: [], multiCommand: false };
            }
            normalizeGuildConfig(config[guildId]);
            if (await cleanupExpired(guildId, message.client, config)) {
                writeConfig(config);
            }
            guildConfig = config[guildId];
        }

        /* -------- STATUS -------- */
        if (!action || action === 'list') {
            const globalList = globalConfig.users.length > 0
                ? globalConfig.users.map(id => `• <@${id}>`).join('\n')
                : 'None';

            const serverWideStatus = guildConfig
                ? (guildConfig.serverWide ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>')
                : 'N/A (DMs)';
            const multiStatus = guildConfig
                ? (guildConfig.multiCommand ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>')
                : 'N/A (DMs)';

            const container = new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
`# No-Prefix Configuration

**Server-Wide:** ${serverWideStatus}
**Multi-Command:** ${multiStatus}

**Global Users** (all servers)
${globalList}

**Usage**
\`noprefix add @user/ID\` - Grant global no-prefix access
\`noprefix remove @user/ID\` - Revoke global no-prefix access
\`noprefix list\` - List global users
\`noprefix on/off\` - Toggle server-wide no-prefix
\`noprefix multi on/off\` - Toggle multi-command
`
                )
            );

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        /* -------- SERVER WIDE -------- */
        if (['on', 'enable'].includes(action)) {
            if (!guildConfig) return message.reply(require('../../utils/ownerUI').errReply('Not In A Server', 'This must be used in a server.'));
            guildConfig.serverWide = true;
            writeConfig(config);
            return message.reply('<:Checkedbox:1521227734943269077> No-prefix enabled server-wide.');
        }

        if (['off', 'disable'].includes(action)) {
            if (!guildConfig) return message.reply(require('../../utils/ownerUI').errReply('Not In A Server', 'This must be used in a server.'));
            guildConfig.serverWide = false;
            writeConfig(config);
            return message.reply(require('../../utils/ownerUI').errReply('Disabled', 'No-prefix disabled server-wide.'));
        }

        /* -------- ADD USER (GLOBAL) -------- */
        if (action === 'add') {
            let user = message.mentions.users.first();
            if (!user && args[1] && /^\d{17,20}$/.test(args[1])) {
                try { user = await message.client.users.fetch(args[1]); } catch {}
            }
            if (!user) return message.reply(require('../../utils/ownerUI').errReply('User Not Found', 'Mention a user or provide a valid user ID.'));

            if (globalConfig.users.includes(user.id)) {
                return message.reply(require('../../utils/ownerUI').errReply('Already Enabled', `**${user.username}** already has global no-prefix access.`));
            }

            globalConfig.users.push(user.id);
            writeGlobalConfig(globalConfig);

            const container = new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Global No-Prefix Access Granted\n\n**User:** **${user.username}** (\`${user.id}\`)\n\nThey can now run commands without the prefix in **ALL** servers.`
                )
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        /* -------- REMOVE USER (GLOBAL) -------- */
        if (action === 'remove') {
            let user = message.mentions.users.first();
            if (!user && args[1] && /^\d{17,20}$/.test(args[1])) {
                try { user = await message.client.users.fetch(args[1]); } catch {}
            }
            if (!user) return message.reply(require('../../utils/ownerUI').errReply('User Not Found', 'Mention a user or provide a valid user ID.'));

            if (!globalConfig.users.includes(user.id)) {
                return message.reply(require('../../utils/ownerUI').errReply('Not Enabled', `**${user.username}** doesn't have global no-prefix access.`));
            }

            globalConfig.users = globalConfig.users.filter(id => id !== user.id);
            writeGlobalConfig(globalConfig);

            const container = new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Cancel:1521227723916181644> Global No-Prefix Access Removed\n\n**User:** **${user.username}** (\`${user.id}\`)\n\nThey must now use the prefix for commands.`
                )
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        /* -------- MULTI -------- */
        if (action === 'multi') {
            if (!guildConfig) return message.reply(require('../../utils/ownerUI').errReply('Not In A Server', 'This must be used in a server.'));
            const opt = args[1]?.toLowerCase();
            if (!['on', 'off', 'enable', 'disable'].includes(opt)) {
                return message.reply(require('../../utils/ownerUI').errReply('Invalid Usage', 'Use `noprefix multi on/off`.'));
            }

            guildConfig.multiCommand = ['on', 'enable'].includes(opt);
            writeConfig(config);
            return message.reply(
                guildConfig.multiCommand
                    ? '<:Checkedbox:1521227734943269077> Multi-command enabled.'
                    : '<:Cancel:1521227723916181644> Multi-command disabled.'
            );
        }

        return message.reply(require('../../utils/ownerUI').errReply('Invalid Option', 'Invalid option. Use `noprefix` to see available commands.'));
    },

    /* -------- RUNTIME CHECKS (READ-ONLY) -------- */

    /**
     * Check if a user has per-server no-prefix access.
     * Returns false if the user is not premium/owner, even if listed.
     */
    isNoPrefixEnabled(guildId, userId) {
        if (!premiumManager.hasPremiumAccess(userId, guildId)) return false;

        const config = readConfig();
        const g = config[guildId];
        if (!g) return false;

        normalizeGuildConfig(g);
        const now = Date.now();

        return g.serverWide || g.users.some(u =>
            u.userId === userId && (!u.expiresAt || u.expiresAt > now)
        );
    },

    /** Check if multi-command mode is enabled for a guild. */
    isMultiCommandEnabled(guildId) {
        const config = readConfig();
        return Boolean(config[guildId]?.multiCommand);
    },

    /**
     * Check if a user has global no-prefix access.
     * Returns false if the user is not premium/owner, even if listed.
     */
    isGlobalNoPrefixEnabled(userId) {
        if (!premiumManager.hasPremiumAccess(userId, null)) return false;

        const globalConfig = readGlobalConfig();
        return globalConfig.users.includes(userId);
    },

    /* -------- VOTE-BASED NO-PREFIX (NO PREMIUM REQUIRED) -------- */

    /**
     * Grant temporary global no-prefix access as a reward for voting.
     * Does NOT require premium. Extends from the current time (a fresh
     * vote resets the full window rather than stacking).
     * @param {string} userId
     * @param {number} [durationMs] defaults to 12 hours
     * @returns {number} the new expiry timestamp (ms)
     */
    grantVoteNoPrefix(userId, durationMs = VOTE_NP_DURATION_MS) {
        const config = readVoteConfig();
        const expiresAt = Date.now() + durationMs;
        config[userId] = { expiresAt, notifiedExpiry: false };
        writeVoteConfig(config);
        return expiresAt;
    },

    /**
     * Check if a user currently has active vote-based no-prefix access.
     * No premium check — voting alone unlocks it.
     */
    hasVoteNoPrefix(userId) {
        const config = readVoteConfig();
        const entry = config[userId];
        return Boolean(entry && entry.expiresAt && entry.expiresAt > Date.now());
    },

    /** Get the expiry timestamp (ms) of a user's vote no-prefix, or null. */
    getVoteNoPrefixExpiry(userId) {
        const config = readVoteConfig();
        const entry = config[userId];
        return entry && entry.expiresAt ? entry.expiresAt : null;
    },

    /**
     * Sweep expired vote-based no-prefix grants, DM each affected user once,
     * and persist. Intended to run on an interval scheduler.
     * @param {import('discord.js').Client} client
     * @returns {Promise<number>} number of users notified
     */
    async expireVoteNoPrefix(client) {
        const config = readVoteConfig();
        const now = Date.now();
        let changed = false;
        let notified = 0;

        for (const [userId, entry] of Object.entries(config)) {
            if (!entry || !entry.expiresAt) {
                delete config[userId];
                changed = true;
                continue;
            }
            if (entry.expiresAt <= now) {
                if (!entry.notifiedExpiry) {
                    try {
                        const user = await client.users.fetch(userId).catch(() => null);
                        if (user) {
                            const { ContainerBuilder: CB, TextDisplayBuilder: TDB, ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS, MessageFlags: MF } = require('discord.js');
                            const clientId = process.env.CLIENT_ID || client.user.id;
                            const container = new CB()
                                .setAccentColor(0xED4245)
                                .addTextDisplayComponents(new TDB().setContent(
                                    `# <:Lightning:1521227915537285150> Your No-Prefix Expired\n\n` +
                                    `Your **12h no-prefix** access has expired.\n` +
                                    `Vote again to re-activate no-prefix and keep running commands without the prefix!`
                                ));
                            const btn = new ARB().addComponents(
                                new BB().setLabel('Vote on Top.gg').setURL(`https://top.gg/bot/${clientId}/vote`).setStyle(BS.Link).setEmoji('<:topgg:1521228219066482790>'),
                                new BB().setLabel('Vote on DBL').setURL('https://discordbotlist.com/bots/xnico').setStyle(BS.Link).setEmoji('<:Cursor:1521228147071127732>')
                            );
                            await user.send({ components: [container, btn], flags: MF.IsComponentsV2 });
                            notified++;
                        }
                    } catch { /* DMs closed — still clear the entry */ }
                }
                delete config[userId];
                changed = true;
            }
        }

        if (changed) writeVoteConfig(config);
        return notified;
    }
};