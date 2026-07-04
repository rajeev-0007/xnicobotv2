'use strict';

const { PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

/* ─────────────────────────────────────────────────────────────
   HUMAN-READABLE PERMISSION NAMES
   ───────────────────────────────────────────────────────────── */

const PERMISSION_NAMES = {
    [PermissionFlagsBits.Administrator]: 'Administrator',
    [PermissionFlagsBits.ManageGuild]: 'Manage Server',
    [PermissionFlagsBits.ManageRoles]: 'Manage Roles',
    [PermissionFlagsBits.ManageChannels]: 'Manage Channels',
    [PermissionFlagsBits.ManageMessages]: 'Manage Messages',
    [PermissionFlagsBits.ManageWebhooks]: 'Manage Webhooks',
    [PermissionFlagsBits.ManageNicknames]: 'Manage Nicknames',
    [PermissionFlagsBits.ManageGuildExpressions]: 'Manage Expressions',
    [PermissionFlagsBits.ManageThreads]: 'Manage Threads',
    [PermissionFlagsBits.BanMembers]: 'Ban Members',
    [PermissionFlagsBits.KickMembers]: 'Kick Members',
    [PermissionFlagsBits.ModerateMembers]: 'Moderate Members (Timeout)',
    [PermissionFlagsBits.MoveMembers]: 'Move Members',
    [PermissionFlagsBits.MuteMembers]: 'Mute Members',
    [PermissionFlagsBits.DeafenMembers]: 'Deafen Members',
    [PermissionFlagsBits.SendMessages]: 'Send Messages',
    [PermissionFlagsBits.SendMessagesInThreads]: 'Send Messages in Threads',
    [PermissionFlagsBits.EmbedLinks]: 'Embed Links',
    [PermissionFlagsBits.AttachFiles]: 'Attach Files',
    [PermissionFlagsBits.AddReactions]: 'Add Reactions',
    [PermissionFlagsBits.UseExternalEmojis]: 'Use External Emojis',
    [PermissionFlagsBits.Connect]: 'Connect (Voice)',
    [PermissionFlagsBits.Speak]: 'Speak (Voice)',
    [PermissionFlagsBits.ViewChannel]: 'View Channel',
    [PermissionFlagsBits.ReadMessageHistory]: 'Read Message History',
    [PermissionFlagsBits.CreateInstantInvite]: 'Create Invite',
    [PermissionFlagsBits.ViewAuditLog]: 'View Audit Log',
    [PermissionFlagsBits.MentionEveryone]: 'Mention Everyone',
};

/* ─────────────────────────────────────────────────────────────
   COMMAND → REQUIRED BOT PERMISSIONS MAP
   ───────────────────────────────────────────────────────────── */

const COMMAND_PERMISSIONS = {
    // ── Admin: Moderation ──
    'ban':              [PermissionFlagsBits.BanMembers],
    'unban':            [PermissionFlagsBits.BanMembers],
    'hackban':          [PermissionFlagsBits.BanMembers],
    'softban':          [PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers],
    'massban':          [PermissionFlagsBits.BanMembers],
    'unbanall':         [PermissionFlagsBits.BanMembers],
    'banlist':          [PermissionFlagsBits.BanMembers],
    'kick':             [PermissionFlagsBits.KickMembers],
    'mute':             [PermissionFlagsBits.ModerateMembers],
    'unmute':           [PermissionFlagsBits.ModerateMembers],
    'timeout':          [PermissionFlagsBits.ModerateMembers],
    'untimeout':        [PermissionFlagsBits.ModerateMembers],
    'warn':             [PermissionFlagsBits.ModerateMembers],
    'clearwarnings':    [PermissionFlagsBits.ModerateMembers],
    'removewarn':       [PermissionFlagsBits.ModerateMembers],

    // ── Admin: Messages ──
    'clear':            [PermissionFlagsBits.ManageMessages],
    'embed-say':        [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.EmbedLinks],
    'pin-message':      [PermissionFlagsBits.ManageMessages],
    'media-only':       [PermissionFlagsBits.ManageMessages],
    'move-messages':    [PermissionFlagsBits.ManageMessages],
    'mention':          [PermissionFlagsBits.MentionEveryone],

    // ── Admin: Channels ──
    'lock':             [PermissionFlagsBits.ManageChannels],
    'unlock':           [PermissionFlagsBits.ManageChannels],
    'lockall':          [PermissionFlagsBits.ManageChannels],
    'unlockall':        [PermissionFlagsBits.ManageChannels],
    'lock-category':    [PermissionFlagsBits.ManageChannels],
    'unlock-category':  [PermissionFlagsBits.ManageChannels],
    'hide':             [PermissionFlagsBits.ManageChannels],
    'unhide':           [PermissionFlagsBits.ManageChannels],
    'hideall':          [PermissionFlagsBits.ManageChannels],
    'unhideall':        [PermissionFlagsBits.ManageChannels],
    'hide-category':    [PermissionFlagsBits.ManageChannels],
    'unhide-category':  [PermissionFlagsBits.ManageChannels],
    'nuke':             [PermissionFlagsBits.ManageChannels],
    'slowmode':         [PermissionFlagsBits.ManageChannels],
    'slowmode-all':     [PermissionFlagsBits.ManageChannels],
    'create-channel':   [PermissionFlagsBits.ManageChannels],
    'delete-channel':   [PermissionFlagsBits.ManageChannels],
    'channelclone':     [PermissionFlagsBits.ManageChannels],
    'channel-rename':   [PermissionFlagsBits.ManageChannels],
    'channel-topic':    [PermissionFlagsBits.ManageChannels],
    'channel-nsfw':     [PermissionFlagsBits.ManageChannels],
    'channel-position': [PermissionFlagsBits.ManageChannels],
    'channel-permissions': [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles],
    'clone-permissions':   [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles],
    'setcategory':      [PermissionFlagsBits.ManageChannels],
    'category-delete':  [PermissionFlagsBits.ManageChannels],
    'category-rename':  [PermissionFlagsBits.ManageChannels],
    'ignore-channels':  [PermissionFlagsBits.ManageChannels],
    'backup-channel':   [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages],

    // ── Admin: Roles ──
    'autorole':         [PermissionFlagsBits.ManageRoles],
    'addrole':          [PermissionFlagsBits.ManageRoles],
    'removerole':       [PermissionFlagsBits.ManageRoles],
    'roleall':          [PermissionFlagsBits.ManageRoles],
    'roleallbots':      [PermissionFlagsBits.ManageRoles],
    'roleallhumans':    [PermissionFlagsBits.ManageRoles],
    'massrole':         [PermissionFlagsBits.ManageRoles],
    'create-role':      [PermissionFlagsBits.ManageRoles],
    'delete-role':      [PermissionFlagsBits.ManageRoles],
    'move-role':        [PermissionFlagsBits.ManageRoles],
    'role-color':       [PermissionFlagsBits.ManageRoles],
    'role-hoist':       [PermissionFlagsBits.ManageRoles],
    'role-icon':        [PermissionFlagsBits.ManageRoles],
    'role-mentionable': [PermissionFlagsBits.ManageRoles],
    'role-position-set':[PermissionFlagsBits.ManageRoles],
    'role-rename':      [PermissionFlagsBits.ManageRoles],
    'reset-permissions':[PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels],

    // ── Admin: Nicknames ──
    'setnick':          [PermissionFlagsBits.ManageNicknames],
    'nickreset':        [PermissionFlagsBits.ManageNicknames],
    'massnick':         [PermissionFlagsBits.ManageNicknames],
    'autonick':         [PermissionFlagsBits.ManageNicknames],
    'inactive-members': [PermissionFlagsBits.ManageNicknames],

    // ── Admin: Emojis & Stickers ──
    'deleteemoji':      [PermissionFlagsBits.ManageGuildExpressions],
    'renameemoji':      [PermissionFlagsBits.ManageGuildExpressions],
    'sticker-delete':   [PermissionFlagsBits.ManageGuildExpressions],

    // ── Admin: Security ──
    'antiraid':         [PermissionFlagsBits.Administrator],
    'antinuke':         [PermissionFlagsBits.Administrator],
    'antialt':          [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.KickMembers],
    'antispam':         [PermissionFlagsBits.Administrator],
    'antilink':         [PermissionFlagsBits.ManageMessages],
    'antiinvite':       [PermissionFlagsBits.ManageMessages],
    'threatmode':       [PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers],
    'superthreatmode':  [PermissionFlagsBits.Administrator],
    'audit':            [PermissionFlagsBits.ViewAuditLog],

    // ── Admin: Server Settings ──
    'setprefix':        [PermissionFlagsBits.ManageGuild],
    'setbotname':       [PermissionFlagsBits.ManageNicknames],
    'bot-customize':    [PermissionFlagsBits.ManageGuild],
    'botprofile':       [PermissionFlagsBits.ManageGuild],
    'config':           [PermissionFlagsBits.ManageGuild],
    'automodconfig':    [PermissionFlagsBits.ManageGuild],
    'logging':          [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewAuditLog],
    'logging-setup':    [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewAuditLog],
    'warnconfig':       [PermissionFlagsBits.ManageGuild],
    'dm-user':          [PermissionFlagsBits.ManageMessages],
    'resetserver':      [PermissionFlagsBits.Administrator],
    'redeemserverkey':  [PermissionFlagsBits.ManageGuild],

    // ── Admin: Trust System ──
    'add-owner':        [PermissionFlagsBits.ManageGuild],
    'remove-owner':     [PermissionFlagsBits.ManageGuild],
    'add-admin':        [PermissionFlagsBits.ManageGuild],
    'removeadmin':      [PermissionFlagsBits.ManageGuild],
    'addmod':           [PermissionFlagsBits.ManageGuild],
    'removemod':        [PermissionFlagsBits.ManageGuild],
    'add-vcmod':        [PermissionFlagsBits.ManageGuild],
    'remove-vcmod':     [PermissionFlagsBits.ManageGuild],
    'whitelist':        [PermissionFlagsBits.ManageGuild],
    'unwhitelist':      [PermissionFlagsBits.ManageGuild],

    // ── Voice ──
    'vckick':           [PermissionFlagsBits.MoveMembers],
    'vckickall':        [PermissionFlagsBits.MoveMembers],
    'vcmute':           [PermissionFlagsBits.MuteMembers],
    'vcmuteall':        [PermissionFlagsBits.MuteMembers],
    'vcunmute':         [PermissionFlagsBits.MuteMembers],
    'vcunmuteall':      [PermissionFlagsBits.MuteMembers],
    'vcdeafen':         [PermissionFlagsBits.DeafenMembers],
    'vcdeafenall':      [PermissionFlagsBits.DeafenMembers],
    'vcundeafen':       [PermissionFlagsBits.DeafenMembers],
    'vcundeafenall':    [PermissionFlagsBits.DeafenMembers],
    'voiceban':         [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers],
    'voiceunban':       [PermissionFlagsBits.ManageChannels],
    'voicemove':        [PermissionFlagsBits.MoveMembers],
    'lockall-voice':    [PermissionFlagsBits.ManageChannels],
    'unlockall-voice':  [PermissionFlagsBits.ManageChannels],
    'join2create-setup':[PermissionFlagsBits.ManageChannels],
    'roleallvoice':     [PermissionFlagsBits.ManageRoles],
    'roleallvoice-off': [PermissionFlagsBits.ManageRoles],
    'speak':            [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
    'speak-config':     [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
    'join-greet':       [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],

    // ── Music ──
    'play':             [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
    'playtop':          [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
    'playskip':         [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
    'search':           [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
    'join':             [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
    'musicpanel':       [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.EmbedLinks],
    'removepanel':      [PermissionFlagsBits.ManageMessages],

    // ── Webhook ──
    'webhook-create':   [PermissionFlagsBits.ManageWebhooks],
    'webhook-delete':   [PermissionFlagsBits.ManageWebhooks],
    'webhook-info':     [PermissionFlagsBits.ManageWebhooks],
    'webhook-list':     [PermissionFlagsBits.ManageWebhooks],
    'webhook-rename':   [PermissionFlagsBits.ManageWebhooks],
    'webhook-send':     [PermissionFlagsBits.ManageWebhooks],

    // ── Utility: Setup & Automation ──
    'welcomer':         [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageWebhooks],
    'leave-setup':      [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageWebhooks],
    'verification-setup':[PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels],
    'screenshot-verify':[PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels],
    'reactionroles':    [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.AddReactions],
    'roletemplate':     [PermissionFlagsBits.ManageRoles],
    'automod':          [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageGuild],
    'giveaway':         [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AddReactions],
    'starboard-setup':  [PermissionFlagsBits.ManageMessages],
    'sticky-message':   [PermissionFlagsBits.ManageMessages],
    'ticket-setup':     [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles],
    'ticket-close':     [PermissionFlagsBits.ManageChannels],
    'ticket-add':       [PermissionFlagsBits.ManageChannels],
    'ticket-remove':    [PermissionFlagsBits.ManageChannels],
    'ticket-categories':[PermissionFlagsBits.ManageChannels],
    'serverstats':      [PermissionFlagsBits.ManageChannels],
    'invite-setup':     [PermissionFlagsBits.ManageGuild],
    'booster-notify':   [PermissionFlagsBits.ManageChannels],
    'social-notify':    [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageWebhooks],
    'announce':         [PermissionFlagsBits.ManageMessages],
    'poll':             [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AddReactions],
    'button-maker':     [PermissionFlagsBits.ManageMessages],
    'select-menu-maker':[PermissionFlagsBits.ManageMessages],
    'autoresponder':    [PermissionFlagsBits.ManageMessages],
    'autoreact':        [PermissionFlagsBits.AddReactions],

    // ── Utility: Emoji & Sticker ──
    'stealemoji':       [PermissionFlagsBits.ManageGuildExpressions],
    'stealsticker':     [PermissionFlagsBits.ManageGuildExpressions],
    'extract-emoji':    [PermissionFlagsBits.ManageGuildExpressions],
    'remove-duplicates':[PermissionFlagsBits.ManageGuildExpressions],

    // ── Leveling ──
    'levelroles':       [PermissionFlagsBits.ManageRoles],
    'leveling-setup':   [PermissionFlagsBits.ManageChannels],

    // ── Backup ──
    'server-backup-create': [PermissionFlagsBits.Administrator],
    'server-backup-load':   [PermissionFlagsBits.Administrator],
    'server-backup-list':   [PermissionFlagsBits.Administrator],
    'server-backup-delete': [PermissionFlagsBits.Administrator],
    'backup-create':    [PermissionFlagsBits.Administrator],
    'backup-load':      [PermissionFlagsBits.Administrator],
    'config-backup':    [PermissionFlagsBits.Administrator],
};

/* ─────────────────────────────────────────────────────────────
   PERMISSION CHECKING
   ───────────────────────────────────────────────────────────── */

/**
 * Get the permissions required for a specific command.
 * @param {string} commandName
 * @returns {bigint[]}
 */
function getRequiredPermissions(commandName) {
    return COMMAND_PERMISSIONS[commandName] || [];
}

/**
 * Check if the bot has all required permissions for a command.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildChannel} channel
 * @param {string} commandName
 * @returns {{ allowed: boolean, missing: string[] }}
 */
function checkBotPermissions(guild, channel, commandName) {
    if (!guild || !guild.members?.me) return { allowed: true, missing: [] };

    const required = getRequiredPermissions(commandName);
    if (required.length === 0) return { allowed: true, missing: [] };

    // Get bot permissions scoped to the channel (respects overwrites)
    let botPerms;
    try {
        botPerms = channel
            ? guild.members.me.permissionsIn(channel)
            : guild.members.me.permissions;
    } catch {
        botPerms = guild.members.me.permissions;
    }

    // Administrator overrides everything
    if (botPerms.has(PermissionFlagsBits.Administrator)) return { allowed: true, missing: [] };

    const missing = [];
    for (const perm of required) {
        if (!botPerms.has(perm)) {
            missing.push(PERMISSION_NAMES[perm] || `Unknown Permission`);
        }
    }

    return { allowed: missing.length === 0, missing };
}

/* ─────────────────────────────────────────────────────────────
   NOTIFICATION HELPERS
   ───────────────────────────────────────────────────────────── */

/**
 * Build a professional missing-permissions message.
 */
function buildPermissionMessage(commandName, missingPerms, guildName) {
    return [
        `## <:Cancel:1521227723916181644> Missing Bot Permissions`,
        ``,
        `I don't have the required permissions to run **\`${commandName}\`** in **${guildName}**.`,
        ``,
        `### Required Permissions`,
        ...missingPerms.map(p => `> • **${p}**`),
        ``,
        `-# Please ask a server administrator to grant me these permissions or move my role higher in the role hierarchy.`,
    ].join('\n');
}

/**
 * Notify the user about missing permissions.
 * Tries: DM first → channel reply fallback.
 * @param {import('discord.js').User} user
 * @param {import('discord.js').TextChannel} channel
 * @param {string} commandName
 * @param {string[]} missingPerms
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<boolean>} whether the DM was sent
 */
async function notifyMissingPermissions(user, channel, commandName, missingPerms, guild) {
    const content = buildPermissionMessage(commandName, missingPerms, guild?.name || 'this server');

    // Try DM first
    try {
        const container = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
        await user.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return true;
    } catch {
        // DMs closed — fall back to channel
    }

    // Fallback: reply in channel (ephemeral for slash, normal for prefix)
    try {
        const container = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
        await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {
            channel.send(content).catch(() => {});
        });
    } catch {
        // Cannot send anywhere — silent fail
    }

    return false;
}

/**
 * Notify for slash commands (uses interaction.reply ephemeral, with DM fallback).
 */
async function notifyMissingPermissionsSlash(interaction, commandName, missingPerms) {
    const content = buildPermissionMessage(commandName, missingPerms, interaction.guild?.name || 'this server');

    try {
        const container = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        const payload = { components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral };

        if (interaction.deferred) {
            await interaction.editReply(payload);
        } else if (!interaction.replied) {
            await interaction.reply(payload);
        }
    } catch {
        // Fallback: DM
        try {
            await interaction.user.send(content);
        } catch {
            // Silent fail
        }
    }
}

/* ─────────────────────────────────────────────────────────────
   ERROR DETECTION
   ───────────────────────────────────────────────────────────── */

/**
 * Check if an error is a Discord permission error.
 */
function isPermissionError(error) {
    return error.code === 50013 ||
           error.code === 50001 ||
           error.message?.includes('Missing Permissions') ||
           error.message?.includes('Missing Access');
}

/**
 * Infer likely missing permissions from a failed command.
 */
function inferPermissionsFromCommand(commandName, category) {
    const known = getRequiredPermissions(commandName);
    if (known.length > 0) {
        return known.map(p => PERMISSION_NAMES[p] || 'Unknown Permission');
    }

    // Category-level inference fallback
    const categoryInferences = {
        admin:   ['Manage Messages', 'Manage Roles', 'Manage Channels'],
        music:   ['Connect (Voice)', 'Speak (Voice)'],
        voice:   ['Connect (Voice)', 'Move Members', 'Mute Members'],
        webhook: ['Manage Webhooks'],
        backup:  ['Administrator'],
        leveling:['Manage Roles'],
    };

    return categoryInferences[category] || ['Ensure bot role has required permissions'];
}

module.exports = {
    checkBotPermissions,
    notifyMissingPermissions,
    notifyMissingPermissionsSlash,
    isPermissionError,
    inferPermissionsFromCommand,
    getRequiredPermissions,
    buildPermissionMessage,
    PERMISSION_NAMES,
    COMMAND_PERMISSIONS,
};
