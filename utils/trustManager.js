/**
 * Trust Manager — per-guild admin, moderator, and VC moderator trust system.
 *
 * Data file: datas/trust.json
 *
 * Structure per guild:
 * {
 *   "<guildId>": {
 *     "secondOwner": "<userId>" | null,
 *     "admins":  [{ "id": "<userId|roleId>", "type": "user"|"role", "addedBy": "<userId>", "addedAt": "<ISO>" }],
 *     "mods":    [... same shape ...],
 *     "vcmods":  [... same shape ...]
 *   }
 * }
 *
 * Permission hierarchy:
 *   Guild Owner > Second Owner > Admin > Mod > VC Mod
 *
 * Only the guild owner (or second owner where allowed) can manage these lists.
 */

const { PermissionFlagsBits } = require('discord.js');

const jsonStore = require('./jsonStore');

/* ─────────────────────── File I/O ─────────────────────── */

function load() {
    return jsonStore.read('trust');
}

function save(data) {
    jsonStore.write('trust', data);
}

function getGuild(guildId) {
    const data = load();
    if (!data[guildId]) {
        data[guildId] = { secondOwner: null, admins: [], mods: [], vcmods: [] };
        save(data);
    }
    return data[guildId];
}

/* ─────────────────────── Permission Checks ─────────────────────── */

/**
 * Returns true if the user is the Discord guild owner.
 */
function isGuildOwner(guild, userId) {
    return guild.ownerId === userId;
}

/**
 * Returns true if the user is the second owner of the guild.
 */
function isSecondOwner(guildId, userId) {
    const g = getGuild(guildId);
    return g.secondOwner === userId;
}

/**
 * Returns true if the user is guild owner or second owner.
 */
function isServerOwner(guild, userId) {
    return isGuildOwner(guild, userId) || isSecondOwner(guild.id, userId);
}

/**
 * Check if a user or any of their roles is in a trust list.
 */
function isInList(guildId, list, userId, memberRoles = []) {
    const g = getGuild(guildId);
    const entries = g[list] || [];
    return entries.some(e =>
        (e.type === 'user' && e.id === userId) ||
        (e.type === 'role' && memberRoles.includes(e.id))
    );
}

function isAdmin(guildId, userId, memberRoles = []) {
    return isInList(guildId, 'admins', userId, memberRoles);
}

function isMod(guildId, userId, memberRoles = []) {
    return isInList(guildId, 'mods', userId, memberRoles);
}

function isVcMod(guildId, userId, memberRoles = []) {
    return isInList(guildId, 'vcmods', userId, memberRoles);
}

/**
 * Returns true if the user has at least "admin" level trust (or is server owner).
 */
function hasAdminAccess(guild, userId, memberRoles = []) {
    return isServerOwner(guild, userId) || isAdmin(guild.id, userId, memberRoles);
}

/**
 * Returns true if the user has at least "mod" level trust.
 */
function hasModAccess(guild, userId, memberRoles = []) {
    return hasAdminAccess(guild, userId, memberRoles) || isMod(guild.id, userId, memberRoles);
}

/**
 * Returns true if the user has at least "vcmod" level trust.
 */
function hasVcModAccess(guild, userId, memberRoles = []) {
    return hasModAccess(guild, userId, memberRoles) || isVcMod(guild.id, userId, memberRoles);
}

/* ─────────────────────── Second Owner ─────────────────────── */

function setSecondOwner(guildId, userId) {
    const data = load();
    if (!data[guildId]) data[guildId] = { secondOwner: null, admins: [], mods: [], vcmods: [] };
    data[guildId].secondOwner = userId;
    save(data);
}

function removeSecondOwner(guildId) {
    const data = load();
    if (!data[guildId]) return false;
    if (!data[guildId].secondOwner) return false;
    data[guildId].secondOwner = null;
    save(data);
    return true;
}

function getSecondOwner(guildId) {
    return getGuild(guildId).secondOwner;
}

/* ─────────────────────── List Management ─────────────────────── */

/**
 * Add a user or role to a trust list.
 * @param {string} guildId
 * @param {'admins'|'mods'|'vcmods'} list
 * @param {string} id         User ID or Role ID
 * @param {'user'|'role'} type
 * @param {string} addedBy    ID of the user who added this entry
 * @returns {{ success: boolean, message: string }}
 */
function addToList(guildId, list, id, type, addedBy) {
    const data = load();
    if (!data[guildId]) data[guildId] = { secondOwner: null, admins: [], mods: [], vcmods: [] };

    const entries = data[guildId][list] || [];
    if (entries.some(e => e.id === id)) {
        return { success: false, message: 'Already in the list.' };
    }

    entries.push({ id, type, addedBy, addedAt: new Date().toISOString() });
    data[guildId][list] = entries;
    save(data);
    return { success: true, message: 'Added successfully.' };
}

/**
 * Remove a user or role from a trust list.
 */
function removeFromList(guildId, list, id) {
    const data = load();
    if (!data[guildId]) return { success: false, message: 'No entries found.' };

    const entries = data[guildId][list] || [];
    const before = entries.length;
    data[guildId][list] = entries.filter(e => e.id !== id);

    if (data[guildId][list].length === before) {
        return { success: false, message: 'Not found in the list.' };
    }

    save(data);
    return { success: true, message: 'Removed successfully.' };
}

/**
 * Get all entries in a trust list.
 */
function getList(guildId, list) {
    return getGuild(guildId)[list] || [];
}

/**
 * Reset an entire trust list.
 */
function resetList(guildId, list) {
    const data = load();
    if (!data[guildId]) return 0;
    const count = (data[guildId][list] || []).length;
    data[guildId][list] = [];
    save(data);
    return count;
}

/* ─────────────────────── Trust Role Configuration ─────────────────────── */

const TRUST_ROLE_CONFIG = {
    admins: {
        name: 'Trusted Admin',
        color: 0xE74C3C,
        permissions: [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ManageRoles,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.BanMembers,
            PermissionFlagsBits.KickMembers,
            PermissionFlagsBits.ViewAuditLog,
            PermissionFlagsBits.ManageWebhooks,
            PermissionFlagsBits.ManageEmojisAndStickers,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.DeafenMembers,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.ManageNicknames,
            PermissionFlagsBits.ModerateMembers
        ]
    },
    mods: {
        name: 'Trusted Moderator',
        color: 0x3498DB,
        permissions: [
            PermissionFlagsBits.KickMembers,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.DeafenMembers,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.ManageNicknames,
            PermissionFlagsBits.ViewAuditLog,
            PermissionFlagsBits.ModerateMembers
        ]
    },
    vcmods: {
        name: 'Trusted VC Mod',
        color: 0x2ECC71,
        permissions: [
            PermissionFlagsBits.MuteMembers,
            PermissionFlagsBits.DeafenMembers,
            PermissionFlagsBits.MoveMembers
        ]
    },
    secondOwner: {
        name: 'Second Owner',
        color: 0xF1C40F,
        permissions: [
            PermissionFlagsBits.Administrator
        ]
    }
};

/**
 * Find an existing trust role or create one with the proper permissions.
 */
async function findOrCreateTrustRole(guild, level) {
    const config = TRUST_ROLE_CONFIG[level];
    if (!config) throw new Error(`Unknown trust level: ${level}`);

    let role = guild.roles.cache.find(r => r.name === config.name);
    if (!role) {
        role = await guild.roles.create({
            name: config.name,
            color: config.color,
            permissions: config.permissions,
            reason: `Trust System: Auto-created ${config.name} role`
        });
    }
    return role;
}

/**
 * Assign the trust role to a user. Returns { success, role?, error? }.
 */
async function assignTrustRole(guild, userId, level) {
    try {
        const role = await findOrCreateTrustRole(guild, level);
        const member = await guild.members.fetch(userId);
        if (!member.roles.cache.has(role.id)) {
            await member.roles.add(role, `Trust System: Granted ${TRUST_ROLE_CONFIG[level].name}`);
        }
        return { success: true, role };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Remove the trust role from a user. Returns { success, error? }.
 */
async function removeTrustRole(guild, userId, level) {
    try {
        const config = TRUST_ROLE_CONFIG[level];
        const role = guild.roles.cache.find(r => r.name === config.name);
        if (!role) return { success: true };
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member && member.roles.cache.has(role.id)) {
            await member.roles.remove(role, `Trust System: Revoked ${config.name}`);
        }
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Remove trust role from ALL users who have it (used by reset commands).
 */
async function removeAllTrustRoles(guild, level) {
    const config = TRUST_ROLE_CONFIG[level];
    const role = guild.roles.cache.find(r => r.name === config.name);
    if (!role) return 0;
    let removed = 0;
    const members = role.members;
    for (const [, member] of members) {
        try {
            await member.roles.remove(role, `Trust System: ${config.name} list reset`);
            removed++;
        } catch {}
    }
    return removed;
}

/**
 * Send a confirmation prompt with Yes/Cancel buttons.
 * @param {Message} message - The original message
 * @param {ContainerBuilder} confirmContainer - The container to show
 * @param {Function} onConfirm - Callback(interaction) when confirmed
 */
async function withConfirmation(message, confirmContainer, onConfirm) {
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, ContainerBuilder: CB, TextDisplayBuilder: TD } = require('discord.js');

    const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('trust_confirm')
            .setLabel('Yes, proceed')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:Checkedbox:1521227734943269077>'),
        new ButtonBuilder()
            .setCustomId('trust_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('✖️')
    );

    confirmContainer.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    confirmContainer.addActionRowComponents(confirmRow);

    const sent = await message.reply({
        components: [confirmContainer],
        flags: MessageFlags.IsComponentsV2
    });

    try {
        const i = await sent.awaitMessageComponent({
            filter: btn => btn.user.id === message.author.id && ['trust_confirm', 'trust_cancel'].includes(btn.customId),
            time: 30000
        });

        if (i.customId === 'trust_confirm') {
            await onConfirm(i);
        } else {
            const cancelContainer = new CB()
                .addTextDisplayComponents(new TD().setContent(
                    `# <:Cancel:1521227723916181644> Action Cancelled\n\n> The operation was cancelled.`
                ));
            await i.update({ components: [cancelContainer], flags: MessageFlags.IsComponentsV2 });
        }
    } catch {
        const timeoutContainer = new CB()
            .addTextDisplayComponents(new TD().setContent(
                `# <:Alarm:1521227869047750689> Confirmation Timed Out\n\n> No response received within 30 seconds. Action cancelled.`
            ));
        await sent.edit({ components: [timeoutContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
}

/**
 * Send a DM notification to a user. Silently fails if DMs are closed.
 */
async function notifyUser(client, userId, content) {
    try {
        const user = await client.users.fetch(userId);
        await user.send(content);
        return true;
    } catch {
        return false;
    }
}

/* ─────────────────────── Exports ─────────────────────── */

module.exports = {
    // Permission checks
    isGuildOwner,
    isSecondOwner,
    isServerOwner,
    isAdmin,
    isMod,
    isVcMod,
    hasAdminAccess,
    hasModAccess,
    hasVcModAccess,

    // Second owner
    setSecondOwner,
    removeSecondOwner,
    getSecondOwner,

    // List management
    addToList,
    removeFromList,
    getList,
    resetList,

    // Role management
    TRUST_ROLE_CONFIG,
    findOrCreateTrustRole,
    assignTrustRole,
    removeTrustRole,
    removeAllTrustRoles,

    // Helpers
    withConfirmation,
    notifyUser
};
