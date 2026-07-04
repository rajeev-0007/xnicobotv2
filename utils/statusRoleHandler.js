/**
 * statusRoleHandler.js — applies the "Status Roles" feature at runtime.
 *
 * Why this exists:
 *   The dashboard ("Status Roles" module) and the `statusrole` command both
 *   persist config to the jsonStore `statusrole` store, but until now nothing
 *   in the bot *applied* it — there was no PresenceUpdate listener, so saving
 *   a rule had no live effect. This module is the missing consumer.
 *
 * Config schema (jsonStore 'statusrole'):
 *   {
 *     [guildId]: {
 *       enabled: boolean,
 *       entries: [ { text, roleId, setBy, setAt, updatedAt } ]
 *     }
 *   }
 *
 * Matching: a member "matches" an entry when their custom-status text
 * CONTAINS the entry text (case-insensitive) — same semantics the command
 * documents ("Contains (case-insensitive)").
 *
 * Requires the GuildPresences privileged intent (added in index.js) so the
 * gateway streams presence updates.
 */

const { ActivityType } = require('discord.js');
const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

/**
 * Extract a member's custom-status text (the "state" of the Custom activity).
 * Returns '' when the member has no custom status set.
 * @param {import('discord.js').Presence|null} presence
 * @returns {string}
 */
function getCustomStatusText(presence) {
    if (!presence || !Array.isArray(presence.activities)) return '';
    const custom = presence.activities.find(a => a.type === ActivityType.Custom);
    // .state holds the custom status text; .name is literally "Custom Status".
    return (custom && typeof custom.state === 'string') ? custom.state : '';
}

/**
 * Read the statusrole config for a single guild. Read-through (peek) so it
 * always reflects the latest dashboard/command write without a TTL cache.
 * @param {string} guildId
 * @returns {{ enabled: boolean, entries: Array }|null}
 */
function getGuildConfig(guildId) {
    try {
        if (!jsonStore.has('statusrole')) return null;
        const all = jsonStore.peek('statusrole') || {};
        return all[guildId] || null;
    } catch {
        return null;
    }
}

/**
 * Reconcile a member's status roles against the configured rules.
 * Adds roles whose text matches the current status and removes
 * status-managed roles that no longer match. Only touches roles that
 * are referenced by a rule — never strips unrelated roles.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {string} statusText  the member's current custom-status text
 * @param {{ enabled: boolean, entries: Array }} guildConfig
 */
async function reconcileMember(member, statusText, guildConfig) {
    if (!member || !guildConfig || guildConfig.enabled === false) return;
    if (!Array.isArray(guildConfig.entries) || guildConfig.entries.length === 0) return;
    if (member.user?.bot) return;

    const guild = member.guild;
    const me = guild.members.me;
    if (!me || !me.permissions.has('ManageRoles')) return;

    const status = (statusText || '').toLowerCase();
    const myTop = me.roles.highest.position;

    for (const entry of guildConfig.entries) {
        if (!entry || !entry.text || !entry.roleId) continue;
        const role = guild.roles.cache.get(entry.roleId);
        if (!role) continue;
        // Skip roles we can't manage (hierarchy / managed) to avoid noisy errors.
        if (role.managed || role.position >= myTop) continue;

        const matches = status.includes(String(entry.text).toLowerCase());
        const hasRole = member.roles.cache.has(role.id);

        try {
            if (matches && !hasRole) {
                await member.roles.add(role, 'Status role: custom status matched rule');
            } else if (!matches && hasRole) {
                await member.roles.remove(role, 'Status role: custom status no longer matches');
            }
        } catch (e) {
            log.debug?.(`[statusrole] role update failed in ${guild.id} for ${member.id}: ${e.message}`);
        }
    }
}

/**
 * PresenceUpdate handler. Fires whenever a member's presence changes.
 * @param {import('discord.js').Presence|null} oldPresence
 * @param {import('discord.js').Presence} newPresence
 */
async function handlePresenceUpdate(oldPresence, newPresence) {
    try {
        const guild = newPresence?.guild;
        if (!guild) return;

        const guildConfig = getGuildConfig(guild.id);
        if (!guildConfig || guildConfig.enabled === false) return;
        if (!Array.isArray(guildConfig.entries) || guildConfig.entries.length === 0) return;

        const oldText = getCustomStatusText(oldPresence);
        const newText = getCustomStatusText(newPresence);
        // Nothing relevant changed — avoid redundant role churn.
        if (oldText === newText) return;

        let member = newPresence.member;
        if (!member) {
            try { member = await guild.members.fetch(newPresence.userId); } catch { return; }
        }

        await reconcileMember(member, newText, guildConfig);
    } catch (e) {
        log.error?.(`[statusrole] presenceUpdate handler error: ${e.message}`);
    }
}

/**
 * Scan every cached member of a guild and reconcile their status roles.
 * Used by `statusrole scan`. Requires the GuildPresences intent so member
 * presences are populated. Returns a summary count.
 *
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ scanned: number, updated: number }>}
 */
async function scanGuild(guild) {
    const result = { scanned: 0, updated: 0 };
    const guildConfig = getGuildConfig(guild.id);
    if (!guildConfig || guildConfig.enabled === false) return result;
    if (!Array.isArray(guildConfig.entries) || guildConfig.entries.length === 0) return result;

    // Ensure members are in cache (GuildMembers intent is enabled).
    let members;
    try { members = await guild.members.fetch(); }
    catch { members = guild.members.cache; }

    for (const [, member] of members) {
        if (member.user?.bot) continue;
        result.scanned++;
        const statusText = getCustomStatusText(member.presence);
        const before = new Set(member.roles.cache.keys());
        await reconcileMember(member, statusText, guildConfig);
        // Detect whether anything changed for the summary.
        const after = new Set(member.roles.cache.keys());
        if (before.size !== after.size) result.updated++;
    }
    return result;
}

module.exports = {
    getCustomStatusText,
    getGuildConfig,
    reconcileMember,
    handlePresenceUpdate,
    scanGuild,
};
