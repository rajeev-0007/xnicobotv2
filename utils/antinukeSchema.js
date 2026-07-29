'use strict';

/**
 * antinukeSchema — the single source of truth for anti-nuke protections.
 *
 * ═══ WHY THIS EXISTS ═══
 * The protection list used to be re-declared in eleven places:
 * antinukePanel.js, index.js (ANTINUKE_ACTION_LABELS), securityUI.js
 * (ACTIONS_FOR), interactionHandlers.js, dashboard/server.js (twice),
 * dashboard/public/antinuke.js, and commands/admin/{anti,config,securitycheck,
 * quicksetup,threatmode,superthreatmode}.js.
 *
 * Adding a protection therefore meant editing eleven files, and missing one
 * produced a silent hole rather than an error. That is precisely how the
 * `aiText`/`aiImage` automod filters ended up enforced on new messages but not
 * on edited ones. Everything that needs to know about protections should now
 * derive it from here.
 *
 * ═══ AUDIT LOG EVENT TYPES ═══
 * The event wiring used bare integers (`checkAuditLogAntiNuke(guild, 12, …)`).
 * 12 is CHANNEL_DELETE, 32 is ROLE_DELETE — easy to transpose and impossible to
 * review. They are named here and referenced by name.
 */

/**
 * discord.js AuditLogEvent values we care about.
 * Mirrors discord-api-types so this module stays requireable without discord.js
 * (utils/storeSync.js has the same constraint, and lightweight harnesses rely
 * on it).
 */
const AUDIT = {
    CHANNEL_CREATE: 10,
    CHANNEL_UPDATE: 11,
    CHANNEL_OVERWRITE_CREATE: 13,
    CHANNEL_OVERWRITE_UPDATE: 14,
    CHANNEL_OVERWRITE_DELETE: 15,
    CHANNEL_DELETE: 12,
    MEMBER_KICK: 20,
    MEMBER_BAN_ADD: 22,
    BOT_ADD: 28,
    ROLE_CREATE: 30,
    ROLE_UPDATE: 31,
    ROLE_DELETE: 32,
    WEBHOOK_CREATE: 50,
    WEBHOOK_UPDATE: 51,
    WEBHOOK_DELETE: 52,
};

/** Punishments the engine actually implements, with display labels. */
const PUNISHMENT_LABELS = {
    remove_roles: 'Strip Roles',
    kick: 'Kick',
    ban: 'Ban',
    timeout: 'Timeout',
    kick_bot: 'Kick Bot',
    kick_both: 'Kick Bot & User',
    ban_bot: 'Ban Bot',
};

/** Punishments valid for a member (as opposed to a bot-add event). */
const MEMBER_PUNISHMENTS = ['remove_roles', 'kick', 'ban', 'timeout'];

/**
 * Permissions whose *addition* to a role is treated as an escalation attempt.
 *
 * Rate-limiting role edits alone is not enough: granting Administrator once is
 * already fatal, and it happens well below any sane "3 edits per minute"
 * threshold. When one of these is added by a non-exempt user, the edit is
 * escalated to a critical violation that fires immediately.
 *
 * Stored as BigInt strings so this module needs no discord.js import.
 */
const DANGEROUS_PERMISSIONS = {
    Administrator: 1n << 3n,
    ManageGuild: 1n << 5n,
    ManageRoles: 1n << 28n,
    ManageChannels: 1n << 4n,
    ManageWebhooks: 1n << 29n,
    BanMembers: 1n << 2n,
    KickMembers: 1n << 1n,
    ManageGuildExpressions: 1n << 30n,
    MentionEveryone: 1n << 17n,
    ModerateMembers: 1n << 40n,
};

/**
 * Ordered protection definitions. Order drives panel display order.
 *
 * auditType     which audit log event proves who did it
 * hasLimit      false = fires on every occurrence (bot adds are never "rate limited")
 * permissionsOnly  for edit protections: only count the edit when it actually
 *                  changed permissions. Renaming a channel is not an attack;
 *                  rewriting every channel's overwrites is. Without this, edit
 *                  protection would punish routine admin work.
 * escalates     dangerous-permission grants bypass the limit entirely
 */
const PROTECTIONS = {
    banProtection: {
        label: 'Ban Protection',
        short: 'Mass Ban',
        description: 'Detects mass member bans.',
        auditType: AUDIT.MEMBER_BAN_ADD,
        hasLimit: true, defaultLimit: 3, defaultWindow: 60_000,
        defaultAction: 'remove_roles', punishments: MEMBER_PUNISHMENTS,
    },
    kickProtection: {
        label: 'Kick Protection',
        short: 'Mass Kick',
        description: 'Detects mass member kicks.',
        auditType: AUDIT.MEMBER_KICK,
        hasLimit: true, defaultLimit: 3, defaultWindow: 60_000,
        defaultAction: 'remove_roles', punishments: MEMBER_PUNISHMENTS,
    },
    channelCreate: {
        label: 'Channel Create',
        short: 'Channel Spam',
        description: 'Detects mass channel creation.',
        auditType: AUDIT.CHANNEL_CREATE,
        hasLimit: true, defaultLimit: 3, defaultWindow: 60_000,
        defaultAction: 'remove_roles', punishments: MEMBER_PUNISHMENTS,
    },
    channelDelete: {
        label: 'Channel Delete',
        short: 'Channel Wipe',
        description: 'Detects mass channel deletion.',
        auditType: AUDIT.CHANNEL_DELETE,
        hasLimit: true, defaultLimit: 2, defaultWindow: 60_000,
        defaultAction: 'remove_roles', punishments: MEMBER_PUNISHMENTS,
        restoreKind: 'channel',
    },
    // ── NEW: edit protections ────────────────────────────────────────────
    // Previously channelUpdate/roleUpdate fired only the logger, so an
    // attacker could rewrite every channel's permission overwrites, or grant
    // themselves Administrator by editing a role they already hold, without
    // ever incrementing an anti-nuke counter.
    channelUpdate: {
        label: 'Channel Edit',
        short: 'Channel Edit',
        description: 'Detects mass channel permission rewrites.',
        auditType: AUDIT.CHANNEL_UPDATE,
        hasLimit: true, defaultLimit: 4, defaultWindow: 60_000,
        defaultAction: 'remove_roles', punishments: MEMBER_PUNISHMENTS,
        permissionsOnly: true,
    },
    roleCreate: {
        label: 'Role Create',
        short: 'Role Spam',
        description: 'Detects mass role creation.',
        auditType: AUDIT.ROLE_CREATE,
        hasLimit: true, defaultLimit: 3, defaultWindow: 60_000,
        defaultAction: 'remove_roles', punishments: MEMBER_PUNISHMENTS,
    },
    roleDelete: {
        label: 'Role Delete',
        short: 'Role Wipe',
        description: 'Detects mass role deletion.',
        auditType: AUDIT.ROLE_DELETE,
        hasLimit: true, defaultLimit: 2, defaultWindow: 60_000,
        defaultAction: 'remove_roles', punishments: MEMBER_PUNISHMENTS,
        restoreKind: 'role',
    },
    roleUpdate: {
        label: 'Role Edit',
        short: 'Role Edit',
        description: 'Detects role permission escalation and mass role edits.',
        auditType: AUDIT.ROLE_UPDATE,
        hasLimit: true, defaultLimit: 4, defaultWindow: 60_000,
        defaultAction: 'remove_roles', punishments: MEMBER_PUNISHMENTS,
        permissionsOnly: true,
        escalates: true,
    },
    webhookCreate: {
        label: 'Webhook Protection',
        short: 'Webhooks',
        description: 'Detects webhook creation and deletion.',
        auditType: AUDIT.WEBHOOK_CREATE,
        // webhookUpdate fires for create/update/delete, so all three audit
        // types are relevant. They are searched as alternates for ONE
        // violation rather than counted separately — see index.js.
        altAuditTypes: [AUDIT.WEBHOOK_UPDATE, AUDIT.WEBHOOK_DELETE],
        hasLimit: true, defaultLimit: 2, defaultWindow: 60_000,
        defaultAction: 'remove_roles', punishments: MEMBER_PUNISHMENTS,
    },
    botAdd: {
        label: 'Bot Add Protection',
        short: 'Bot Adds',
        description: 'Removes bots added by non-whitelisted users.',
        auditType: AUDIT.BOT_ADD,
        hasLimit: false,
        defaultAction: 'kick_bot', punishments: ['kick_bot', 'kick_both', 'ban_bot'],
    },
};

const PROTECTION_KEYS = Object.keys(PROTECTIONS);

/** Legacy label map shape, derived so it can never drift. */
const PROTECTION_LABELS = Object.fromEntries(
    PROTECTION_KEYS.map(k => [k, PROTECTIONS[k].label])
);

/** Allowed punishments per protection, derived. */
const ACTIONS_FOR = Object.fromEntries(
    PROTECTION_KEYS.map(k => [k, PROTECTIONS[k].punishments])
);

/** Limit / window bounds shared by the panel, slash options and modals. */
const LIMIT_MIN = 1;
const LIMIT_MAX = 20;
const WINDOW_MIN_SEC = 10;
const WINDOW_MAX_SEC = 600;

/** The ONLY status emojis these panels are allowed to use. */
const STATUS = {
    ON: '<:Toggleon:1521227758011809964>',
    OFF: '<:Toggleoff:1521227763816595559>',
};

const toggle = (on) => (on ? STATUS.ON : STATUS.OFF);

function isValidActionFor(moduleKey, action) {
    const allowed = ACTIONS_FOR[moduleKey];
    return Array.isArray(allowed) && allowed.includes(action);
}

/** Punishments valid for EVERY key in `moduleKeys` (their intersection). */
function commonActions(moduleKeys) {
    if (!Array.isArray(moduleKeys) || moduleKeys.length === 0) return [];
    let intersection = ACTIONS_FOR[moduleKeys[0]] || [];
    for (let i = 1; i < moduleKeys.length; i++) {
        const next = new Set(ACTIONS_FOR[moduleKeys[i]] || []);
        intersection = intersection.filter(a => next.has(a));
    }
    return intersection;
}

/** Fresh default config for a guild that has never configured anti-nuke. */
function getDefaultConfig() {
    const cfg = {
        enabled: false,
        whitelistedUsers: [],
        bypassRoleId: null,
        logChannel: null,
        // Power flags
        zeroTolerance: false,     // punish on the FIRST destructive action
        instantQuarantine: false, // strip roles immediately on detection
        autoRestore: false,       // recreate deleted channels/roles
    };
    for (const key of PROTECTION_KEYS) {
        const def = PROTECTIONS[key];
        const mod = { enabled: false, action: def.defaultAction };
        if (def.hasLimit) {
            mod.limit = def.defaultLimit;
            mod.timeWindow = def.defaultWindow;
        }
        if (def.permissionsOnly) mod.permissionsOnly = true;
        if (def.escalates) mod.escalationInstant = true;
        cfg[key] = mod;
    }
    return cfg;
}

/**
 * Merge a stored guild config over the defaults.
 *
 * REQUIRED for correctness, not just tidiness. Guild configs already in
 * PostgreSQL predate channelUpdate/roleUpdate, so their rows have no such key.
 * `checkAntiNuke` reads `config[action]?.enabled`, which would be `undefined`
 * for every existing server — the new edit protections would silently never
 * run for anyone who had already set anti-nuke up. Merging on read backfills
 * them instead of requiring a migration.
 *
 * Preserves unknown keys (threatMode, superThreatMode, saved limit snapshots)
 * so the threat-mode commands keep working.
 */
function withDefaults(stored) {
    const defaults = getDefaultConfig();
    if (!stored || typeof stored !== 'object') return defaults;

    const merged = { ...defaults, ...stored };
    for (const key of PROTECTION_KEYS) {
        merged[key] = { ...defaults[key], ...(stored[key] || {}) };
        // A stored action that is no longer legal for this module would be
        // silently ignored by the engine; fall back to the default so the
        // panel and the engine agree on what will happen.
        if (!isValidActionFor(key, merged[key].action)) {
            merged[key].action = defaults[key].action;
        }
    }
    if (!Array.isArray(merged.whitelistedUsers)) merged.whitelistedUsers = [];
    return merged;
}

function formatTimeWindow(ms) {
    const seconds = Number(ms) / 1000;
    if (!Number.isFinite(seconds) || seconds <= 0) return '60s';
    if (seconds >= 60) {
        const mins = seconds / 60;
        return `${Number.isInteger(mins) ? mins : mins.toFixed(1)}m`;
    }
    return `${seconds}s`;
}

/**
 * Which dangerous permissions an edit ADDED to a role.
 * Accepts anything BigInt-coercible (discord.js PermissionsBitField, string,
 * number) so callers don't need to normalize first.
 *
 * @returns {string[]} names of newly granted dangerous permissions
 */
function addedDangerousPermissions(oldPerms, newPerms) {
    let before;
    let after;
    try {
        before = BigInt(oldPerms ?? 0);
        after = BigInt(newPerms ?? 0);
    } catch {
        return [];
    }
    if (before === after) return [];

    const added = [];
    for (const [name, bit] of Object.entries(DANGEROUS_PERMISSIONS)) {
        if ((after & bit) === bit && (before & bit) !== bit) added.push(name);
    }
    return added;
}

module.exports = {
    AUDIT,
    PROTECTIONS,
    PROTECTION_KEYS,
    PROTECTION_LABELS,
    PUNISHMENT_LABELS,
    MEMBER_PUNISHMENTS,
    ACTIONS_FOR,
    DANGEROUS_PERMISSIONS,
    LIMIT_MIN,
    LIMIT_MAX,
    WINDOW_MIN_SEC,
    WINDOW_MAX_SEC,
    STATUS,
    toggle,
    isValidActionFor,
    commonActions,
    getDefaultConfig,
    withDefaults,
    formatTimeWindow,
    addedDangerousPermissions,
};
