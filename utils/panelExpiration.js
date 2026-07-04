const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

/**
 * Centralized panel/builder session expiration manager.
 * Tracks message timestamps and auto-expires stale panels.
 */

// Session timeout durations (ms)
const TIMEOUTS = {
    builder: 30 * 60 * 1000,   // 30 minutes — builders (embed, components, message-builder, media-gallery)
    config: 30 * 60 * 1000,    // 30 minutes — config panels (welcomer, automod, autoresponder, etc.)
    setup: 15 * 60 * 1000,     // 15 minutes — setup wizards (quicksetup, ticket-setup, etc.)
    game: 10 * 60 * 1000,      // 10 minutes — games (hangman, blackjack, ttt, akinator)
    menu: 5 * 60 * 1000,       // 5 minutes  — menus (help, variables, shop)
};

// Global storage: messageId -> { timestamp, type, channelId, guildId }
if (!global.panelSessions) global.panelSessions = new Map();

// Auto-cleanup interval (runs every 5 minutes)
let cleanupInterval = null;

function startCleanup(client) {
    if (cleanupInterval) return;
    cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [messageId, session] of global.panelSessions.entries()) {
            const timeout = TIMEOUTS[session.type] || TIMEOUTS.config;
            if (now - session.timestamp > timeout) {
                expireMessage(client, session, messageId);
                global.panelSessions.delete(messageId);
            }
        }
    }, 5 * 60 * 1000);
}

async function expireMessage(client, session, messageId) {
    try {
        const guild = client.guilds.cache.get(session.guildId);
        if (!guild) return;
        const channel = guild.channels.cache.get(session.channelId);
        if (!channel) return;
        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) return;
        // Only edit messages owned by the bot
        if (message.author.id !== client.user.id) return;

        const expiredContainer = buildExpiredContainer(session.type);
        await message.edit({ components: [expiredContainer], embeds: [], files: [], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    } catch (e) {
        // Silent — message may already be deleted
    }
}

/**
 * Build a professional expired container for the given session type.
 */
function buildExpiredContainer(type = 'config') {
    const labels = {
        builder: { title: 'Builder Session Expired', desc: 'This builder session has expired due to inactivity (30 minutes). Please run the command again to start a new session.', icon: '<:Timer:1521227971590095070>' },
        config: { title: 'Configuration Session Expired', desc: 'This configuration session has expired due to inactivity (30 minutes). Please run the command again to continue setup.', icon: '<:Timer:1521227971590095070>' },
        setup: { title: 'Setup Session Expired', desc: 'This setup session has expired due to inactivity (15 minutes). Please run the command again to restart setup.', icon: '<:Timer:1521227971590095070>' },
        game: { title: 'Game Session Expired', desc: 'This game has expired due to inactivity (10 minutes). Start a new game to play again.', icon: '<:Timer:1521227971590095070>' },
        menu: { title: 'Menu Expired', desc: 'This menu has expired due to inactivity (5 minutes). Please run the command again to open a new menu.', icon: '<:Timer:1521227971590095070>' },
    };

    const info = labels[type] || labels.config;

    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(`# ${info.icon} ${info.title}\n\n${info.desc}`)
        );
}

/**
 * Register a panel session for a message.
 * Call this when a panel/builder is first created.
 * 
 * @param {string} messageId - The message ID of the panel
 * @param {object} opts - { channelId, guildId, type, userId }
 */
function registerSession(messageId, { channelId, guildId, type = 'config', userId = null }) {
    global.panelSessions.set(messageId, {
        timestamp: Date.now(),
        type,
        channelId,
        guildId,
        userId,
    });
}

/**
 * Refresh the timestamp for a panel session (call on every interaction).
 * Returns false if the session has expired (caller should show expiry UI).
 * Returns true if still valid (timestamp refreshed).
 * 
 * @param {string} messageId
 * @param {string} [type] - Override type for timeout lookup
 * @returns {boolean}
 */
function touchSession(messageId, type) {
    const session = global.panelSessions.get(messageId);
    if (!session) return true; // Not tracked — allow (backwards compat)
    
    const timeout = TIMEOUTS[type || session.type] || TIMEOUTS.config;
    if (Date.now() - session.timestamp > timeout) {
        global.panelSessions.delete(messageId);
        return false; // Expired
    }
    
    session.timestamp = Date.now();
    return true; // Still valid
}

/**
 * Check if a session is expired and handle the interaction update automatically.
 * Returns true if expired (caller should return early).
 * Returns false if still valid (caller should proceed normally).
 * 
 * @param {import('discord.js').Interaction} interaction
 * @param {string} [type] - Session type for timeout lookup
 * @returns {Promise<boolean>}
 */
async function checkAndExpire(interaction, type) {
    if (!interaction.message) return false;
    const messageId = interaction.message.id;
    const session = global.panelSessions.get(messageId);
    
    // Also check legacy global.builderTimestamps for backwards compatibility
    if (!session) {
        if (global.builderTimestamps) {
            const legacyTs = global.builderTimestamps.get(messageId);
            if (legacyTs) {
                const timeout = TIMEOUTS[type || 'config'] || TIMEOUTS.config;
                if (Date.now() - legacyTs > timeout) {
                    global.builderTimestamps.delete(messageId);
                    const container = buildExpiredContainer(type || 'config');
                    await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                    return true;
                }
                global.builderTimestamps.set(messageId, Date.now());
            }
        }
        // Auto-register session on first interaction (no explicit registration needed)
        registerSession(messageId, {
            channelId: interaction.channel?.id,
            guildId: interaction.guild?.id,
            type: type || 'config',
            userId: interaction.user?.id,
        });
        return false;
    }
    
    const timeout = TIMEOUTS[type || session.type] || TIMEOUTS.config;
    if (Date.now() - session.timestamp > timeout) {
        global.panelSessions.delete(messageId);
        const container = buildExpiredContainer(session.type);
        try {
            if (interaction.isModalSubmit()) {
                await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
            } else {
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            }
        } catch (e) {}
        return true;
    }
    
    // Refresh
    session.timestamp = Date.now();
    return false;
}

/**
 * Remove a session (e.g., when user closes panel manually).
 */
function removeSession(messageId) {
    global.panelSessions.delete(messageId);
    if (global.builderTimestamps) global.builderTimestamps.delete(messageId);
}

module.exports = {
    TIMEOUTS,
    startCleanup,
    buildExpiredContainer,
    registerSession,
    touchSession,
    checkAndExpire,
    removeSession,
};
