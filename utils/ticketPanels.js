/**
 * Ticket Panels Helper
 *
 * Centralizes the per-guild ticket configuration so the rest of the
 * codebase (commands + index.js interaction handlers) doesn't need to
 * know about the multi-panel data shape directly.
 *
 * Schema (v2):
 *   guildConfig = {
 *     supportRoleId,
 *     categoryId,                // default Discord category for new ticket channels
 *     transcriptMode,            // auto | manual | both | off
 *     transcriptChannelId,       // log channel for transcript dumps
 *     categories: [               // pool of categories the admin has defined
 *       { id, label, emoji, description }
 *     ],
 *     panels: {                  // every panel posted in the server
 *       [panelId]: {
 *         channelId,             // where this panel lives
 *         messageId,             // the panel message we keep updated
 *         label,                 // a human label so admins can pick it
 *         categoryIds,           // which categories this panel exposes (subset of pool)
 *         supportRoleId,         // optional override; falls back to guild-level
 *         channelCategoryId,     // optional override for ticket channel parent
 *         panelMessage,          // optional custom panel message (V2 builder data)
 *       }
 *     },
 *     tickets: { ... },
 *     nextTicketNumber,
 *     // ── legacy fields (kept for backwards-compat reads/migration) ──
 *     channelId, panelMessageId, panelMessage, welcomeMessage
 *   }
 */

const jsonStore = require('./jsonStore');

const TICKETS_KEY = 'tickets';

/* ─────────────────────────── load / save ─────────────────────────── */

function readAll() {
    if (!jsonStore.has(TICKETS_KEY)) {
        jsonStore.write(TICKETS_KEY, {});
        return {};
    }
    const data = jsonStore.read(TICKETS_KEY);
    if (Array.isArray(data)) {
        jsonStore.write(TICKETS_KEY, {});
        return {};
    }
    return data;
}

function saveAll(config) {
    jsonStore.write(TICKETS_KEY, config);
}

/* ─────────────────────────── migration ───────────────────────────── */

/**
 * Convert a legacy single-panel config to the multi-panel shape in-place.
 * Idempotent — calling it on an already-migrated config is a no-op.
 */
function ensureMigrated(guildConfig) {
    if (!guildConfig) return guildConfig;
    if (!guildConfig.panels) guildConfig.panels = {};

    const hasLegacyPanel =
        guildConfig.channelId &&
        guildConfig.panelMessageId &&
        Object.keys(guildConfig.panels).length === 0;

    if (hasLegacyPanel) {
        guildConfig.panels.default = {
            channelId:  guildConfig.channelId,
            messageId:  guildConfig.panelMessageId,
            label:      'Default',
            categoryIds: (guildConfig.categories || []).map(c => c.id),
            supportRoleId:     null,   // fall back to guild-level
            channelCategoryId: null,   // fall back to guild-level
            panelMessage: guildConfig.panelMessage || null,
        };
    }
    return guildConfig;
}

/* ─────────────────────────── helpers ─────────────────────────────── */

function newPanelId() {
    // Short, URL-safe, time-sortable. 8 hex chars is plenty for per-guild panel ids.
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Resolve the categories that a panel exposes.
 * Returns the *full* category objects (label/emoji/description), filtered to
 * the panel's whitelist. Falls back to the full pool if the whitelist is empty
 * or unset (e.g. fresh setup before the admin picks per-panel categories).
 */
function resolvePanelCategories(guildConfig, panel) {
    const pool = guildConfig.categories || [];
    const whitelist = panel?.categoryIds;
    if (!whitelist || whitelist.length === 0) return pool;
    const set = new Set(whitelist);
    return pool.filter(c => set.has(c.id));
}

/**
 * Resolve the role used to gate a ticket created from a given panel.
 * Panel-level override wins, otherwise falls back to the guild-level support role.
 */
function resolveSupportRoleId(guildConfig, panel) {
    return panel?.supportRoleId || guildConfig?.supportRoleId || null;
}

/**
 * Resolve the Discord category (parent) where the ticket channel will live.
 */
function resolveChannelCategoryId(guildConfig, panel) {
    return panel?.channelCategoryId || guildConfig?.categoryId || null;
}

/**
 * Lookup the panel that owns a given message id. Used to migrate existing
 * panels and to drive panel-aware updates.
 */
function findPanelByMessageId(guildConfig, messageId) {
    if (!guildConfig?.panels) return null;
    for (const [id, panel] of Object.entries(guildConfig.panels)) {
        if (panel.messageId === messageId) return { panelId: id, panel };
    }
    return null;
}

module.exports = {
    TICKETS_KEY,
    readAll,
    saveAll,
    ensureMigrated,
    newPanelId,
    resolvePanelCategories,
    resolveSupportRoleId,
    resolveChannelCategoryId,
    findPanelByMessageId,
};
