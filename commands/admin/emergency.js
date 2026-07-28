'use strict';

/**
 * emergency.js — server-wide emergency lockdown.
 *
 * What it does:
 *   • Strips dangerous permissions (Admin, Ban, Kick, Manage *, Mention
 *     Everyone) from every role that has them — or only from a hand-
 *     picked list when the admin has configured `emergencyRoles`.
 *   • Saves every modified role's permission bitfield BEFORE editing,
 *     so `emergency disable` restores them exactly as they were.
 *   • Only the server owner / second owner / pre-authorised users
 *     can flip the switch.
 *
 * Bugs fixed this pass:
 *   • Status / toggle emojis were inverted (showed Toggle-OFF icon
 *     when the system was ACTIVE and vice-versa).
 *   • The activation banner used the same inverted icon.
 *   • Error copy referenced "extra owner" — that's not a concept in
 *     trustManager (only `secondOwner`), so users got confused.
 *   • Panel was completely text-only despite mentioning a "panel" —
 *     now ships with Enable/Disable buttons routed through the
 *     standard `handleInteraction` dispatcher.
 *   • Emoji choices polished: Bookmark → SettingsAdjust for "targeted
 *     roles", Userplus → User for "authorised users", etc.
 */

const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
    SeparatorSpacingSize, MessageFlags, PermissionFlagsBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const { COLORS, buildErrorResponse } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');
const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');
const { createFooterText } = require('../../utils/theme');

/* ─────────────────── constants ─────────────────── */

const E = {
    shield:      '<:Shield:1521227694677692467>',
    on:          '<:Toggleon:1521227758011809964>',
    off:         '<:Toggleoff:1521227763816595559>',
    ok:          '<:Checkedbox:1521227734943269077>',
    cancel:      '<:Cancel:1521227723916181644>',
    info:        '<:Inforect:1521228008285929532>',
    warn:        '<:Infotriangle:1521227710381428926>',
    user:        '<:User:1521227714227343380>',
    userPlus:    '<:Userplus:1521227719621218477>',
    settings:    '<:Settings:1521227767780343879>',
    bookmark:    '<:Bookmark:1521227835526742066>',
    lightning:   '<:Lightningalt:1521227851796447472>',
    ban:         '<:banhammer:1521227777083314529>',
    block:       '<:Userblock:1521227822641975366>',
    document:    '<:Document:1521227875016114266>',
    redo:        '<:History:1521227863079256278>' };

const DANGEROUS_PERMS = [
    'Administrator',
    'BanMembers',
    'KickMembers',
    'ManageChannels',
    'ManageGuild',
    'ManageRoles',
    'ManageWebhooks',
    'MentionEveryone',
];

const COLOR_ACTIVE   = 0xED4245; // red — system locked down
const COLOR_INACTIVE = 0x57F287; // green — operating normally

/* ─────────────────── persistence ─────────────────── */

function loadConfig() {
    if (!jsonStore.has('emergency')) {
        jsonStore.write('emergency', {});
        return {};
    }
    return jsonStore.read('emergency');
}

function saveConfig(config) {
    jsonStore.write('emergency', config);
}

function getDefault() {
    return {
        enabled: false,
        activatedAt: null,
        activatedBy: null,
        authorisedUsers: [],
        emergencyRoles: [],
        savedRolePerms: {} };
}

function getGuildConfig(guildId) {
    const config = loadConfig();
    if (!config[guildId]) {
        config[guildId] = getDefault();
        saveConfig(config);
    }
    return { config, gc: config[guildId] };
}

/* ─────────────────── auth ─────────────────── */

/**
 * Authorisation check: server owner, second owner, or any user
 * explicitly added with `emergency authorise add`.
 */
function isAuthorised(guild, userId, gc) {
    if (trust.isServerOwner(guild, userId)) return true;
    return Array.isArray(gc.authorisedUsers) && gc.authorisedUsers.includes(userId);
}

/* ─────────────────── core operations ─────────────────── */

/**
 * Activate emergency mode. Returns `{ stripped, savedPerms }`.
 * Throws if the bot doesn't have a high enough role to modify any
 * targeted role.
 */
async function activate(guild, gc, actor) {
    const botMember = guild.members.me;
    const botHighest = botMember.roles.highest;
    const savedPerms = {};
    let stripped = 0;

    const targetRoles = (gc.emergencyRoles?.length > 0)
        ? guild.roles.cache.filter(r => gc.emergencyRoles.includes(r.id))
        : guild.roles.cache.filter(r =>
            !r.managed &&
            r.position < botHighest.position &&
            DANGEROUS_PERMS.some(p => r.permissions.has(PermissionFlagsBits[p]))
        );

    for (const [roleId, role] of targetRoles) {
        if (role.position >= botHighest.position) continue;
        if (role.managed) continue;
        try {
            savedPerms[roleId] = role.permissions.bitfield.toString();
            const newPerms = new PermissionsBitField(role.permissions).remove(
                DANGEROUS_PERMS.map(p => PermissionFlagsBits[p])
            );
            await role.setPermissions(newPerms, `Emergency Mode activated by ${actor.tag}`);
            stripped++;
        } catch {
            // Skip roles we can't modify (managed integrations, role
            // hierarchy issues). Don't poison `savedPerms` with entries
            // we never actually wrote.
            delete savedPerms[roleId];
        }
    }

    return { stripped, savedPerms };
}

/**
 * Deactivate: re-apply each saved permission bitfield. Returns the
 * count of roles successfully restored.
 */
async function deactivate(guild, gc, actor) {
    let restored = 0;
    for (const [roleId, permBits] of Object.entries(gc.savedRolePerms || {})) {
        try {
            const role = guild.roles.cache.get(roleId);
            if (!role) continue;
            await role.setPermissions(BigInt(permBits), `Emergency Mode disabled by ${actor.tag}`);
            restored++;
        } catch {}
    }
    return restored;
}

/* ─────────────────── panel ─────────────────── */

function buildPanel(gc, guildName) {
    const isOn = !!gc.enabled;

    /* Status block uses an icon that REFLECTS THE CURRENT STATE
       (red ⛔ when locked, green ✓ when normal) — the previous version
       had this inverted. */
    const statusEmoji = isOn ? E.cancel : E.ok;
    const statusText = isOn
        ? '**EMERGENCY MODE ACTIVE** — Server is locked down'
        : '**Inactive** — Server is operating normally';

    let activatedInfo = '';
    if (isOn && gc.activatedAt) {
        const ts = Math.floor(new Date(gc.activatedAt).getTime() / 1000);
        activatedInfo = `\nActivated <t:${ts}:R> by <@${gc.activatedBy}>`;
    }

    const authCount = gc.authorisedUsers?.length || 0;
    const authDisplay = authCount > 0
        ? gc.authorisedUsers.map(id => `<@${id}>`).join(', ')
        : '*None — only server owner can use emergency mode*';

    const roleCount = gc.emergencyRoles?.length || 0;
    const roleDisplay = roleCount > 0
        ? gc.emergencyRoles.map(id => `<@&${id}>`).join(', ')
        : '*None — every role with dangerous perms will be targeted*';

    const headerText =
        `# ${E.shield} Emergency Mode\n` +
        `-# Critical lockdown system for **${guildName}**\n\n` +
        `${statusEmoji} ${statusText}${activatedInfo}`;

    const aboutText =
        `### ${E.info} What Emergency Mode Does\n` +
        `<:Caretright:1521227704953864202> Strips dangerous permissions from all roles (or specified roles)\n` +
        `<:Caretright:1521227704953864202> Removes: \`Admin\`, \`Ban\`, \`Kick\`, \`Manage Channels/Guild/Roles/Webhooks\`, \`Mention Everyone\`\n` +
        `<:Caretright:1521227704953864202> Saves all original permissions for restoration\n` +
        `<:Caretright:1521227704953864202> Only authorised users or the server owner can activate`;

    const authorisedText =
        `### ${E.user} Authorised Users (${authCount})\n${authDisplay}`;

    const rolesText =
        `### ${E.bookmark} Targeted Roles (${roleCount})\n${roleDisplay}\n` +
        `-# ${roleCount === 0 ? 'All roles with dangerous perms will be targeted' : 'Only these roles will be affected'}`;

    const commandsText =
        `### ${E.lightning} Commands\n` +
        `<:Caretright:1521227704953864202> \`emergency enable\` — activate emergency lockdown\n` +
        `<:Caretright:1521227704953864202> \`emergency disable\` — restore all permissions\n` +
        `<:Caretright:1521227704953864202> \`emergency role add @role\` — add a role to the target list\n` +
        `<:Caretright:1521227704953864202> \`emergency role remove @role\` — remove a role from the target list\n` +
        `<:Caretright:1521227704953864202> \`emergency role list\` — show targeted roles\n` +
        `<:Caretright:1521227704953864202> \`emergency authorise add @user\` — authorise a user\n` +
        `<:Caretright:1521227704953864202> \`emergency authorise remove @user\` — remove authorisation`;

    const buttonRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(isOn ? 'emergency_disable' : 'emergency_enable')
            .setLabel(isOn ? 'Disable Emergency' : 'Activate Emergency')
            .setStyle(isOn ? ButtonStyle.Success : ButtonStyle.Danger)
            .setEmoji(isOn ? E.ok : E.ban),
    );

    const container = new ContainerBuilder()
        .setAccentColor(isOn ? COLOR_ACTIVE : COLOR_INACTIVE)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(aboutText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(authorisedText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(rolesText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(commandsText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(buttonRow)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(createFooterText()))
;

    return container;
}

function buildSimpleResult(title, color, lines) {
    return new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}\n\n${lines.join('\n')}`));
}

/* ─────────────────── command ─────────────────── */

module.exports = {
    name: 'emergency',
    prefix: 'emergency',
    description: 'Emergency lockdown — strip dangerous permissions to protect the server',
    usage: 'emergency [enable|disable|role add/remove/list|authorise add/remove]',
    category: 'admin',
    aliases: ['emgs', 'emergencymode'],
    prefixOnly: true,

    async executePrefix(message, args) {
        const { config, gc } = getGuildConfig(message.guild.id);
        const sub = args[0]?.toLowerCase();

        /* ────── default panel ────── */
        if (!sub) {
            if (!isAuthorised(message.guild, message.author.id, gc)) {
                return message.reply(`${E.cancel} You are not authorised to use emergency commands.`);
            }
            return message.reply({
                components: [buildPanel(gc, message.guild.name)],
                flags: MessageFlags.IsComponentsV2 });
        }

        /* ────── enable ────── */
        if (sub === 'enable') {
            if (!isAuthorised(message.guild, message.author.id, gc)) {
                return message.reply(`${E.cancel} You are not authorised to activate emergency mode.`);
            }
            if (gc.enabled) {
                return message.reply(`${E.warn} Emergency Mode is already **active**. Use \`emergency disable\` to restore.`);
            }

            const statusMsg = await message.reply(`${E.lightning} Activating Emergency Mode — stripping dangerous permissions…`);
            try {
                const { stripped, savedPerms } = await activate(message.guild, gc, message.author);

                if (stripped === 0) {
                    await statusMsg.delete().catch(() => {});
                    return message.reply(
                        `${E.cancel} Could not strip permissions from any role. ` +
                        `Make sure the bot's role is positioned **above** the target roles.`
                    );
                }

                gc.enabled = true;
                gc.activatedAt = new Date().toISOString();
                gc.activatedBy = message.author.id;
                gc.savedRolePerms = savedPerms;
                saveConfig(config);

                const container = buildSimpleResult(`${E.cancel} Emergency Mode Activated`, COLOR_ACTIVE, [
                    `${E.ok} Stripped permissions from **${stripped}** role${stripped === 1 ? '' : 's'}`,
                    `${E.ok} Dangerous permissions removed`,
                    `${E.ok} Original permissions saved for restoration`,
                    ``,
                    `**Removed permissions:**`,
                    `> Admin, Ban, Kick, Manage Channels/Guild/Roles/Webhooks, Mention Everyone`,
                    ``,
                    `-# Use \`emergency disable\` (or the button) to restore all permissions`,
                ]);

                await statusMsg.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 })
                    .catch(() => message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }));
            } catch (err) {
                console.error('[Emergency] activate error:', err);
                await statusMsg.edit({
                    content: `${E.cancel} Failed to activate emergency mode: ${err.message}` }).catch(() => {});
            }
            return;
        }

        /* ────── disable ────── */
        if (sub === 'disable') {
            if (!isAuthorised(message.guild, message.author.id, gc)) {
                return message.reply(`${E.cancel} You are not authorised to disable emergency mode.`);
            }
            if (!gc.enabled) {
                return message.reply(`${E.warn} Emergency Mode is not currently active.`);
            }

            const statusMsg = await message.reply(`${E.lightning} Disabling Emergency Mode — restoring permissions…`);
            try {
                const restored = await deactivate(message.guild, gc, message.author);

                gc.enabled = false;
                gc.savedRolePerms = {};
                gc.activatedAt = null;
                gc.activatedBy = null;
                saveConfig(config);

                const container = buildSimpleResult(`${E.ok} Emergency Mode Disabled`, COLOR_INACTIVE, [
                    `${E.ok} Restored permissions for **${restored}** role${restored === 1 ? '' : 's'}`,
                    `${E.ok} Original permissions re-applied`,
                    `${E.ok} Server is operating normally`,
                    ``,
                    `-# All role permissions have been restored to their pre-emergency state`,
                ]);

                await statusMsg.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 })
                    .catch(() => message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }));
            } catch (err) {
                console.error('[Emergency] deactivate error:', err);
                await statusMsg.edit({
                    content: `${E.cancel} Failed to disable emergency mode: ${err.message}` }).catch(() => {});
            }
            return;
        }

        /* ────── role add/remove/list ────── */
        if (sub === 'role') {
            if (!trust.isServerOwner(message.guild, message.author.id)) {
                return message.reply(`${E.cancel} Only the **server owner** or **extra owner** can manage emergency roles.`);
            }
            const action = args[1]?.toLowerCase();

            if (action === 'add') {
                const role = message.mentions.roles.first();
                if (!role) {
                    return message.reply(`${E.cancel} Mention a role to add.\n**Usage:** \`emergency role add @role\``);
                }
                if (!gc.emergencyRoles) gc.emergencyRoles = [];
                if (gc.emergencyRoles.includes(role.id)) {
                    return message.reply(`${E.warn} **${role.name}** is already in the targeted role list.`);
                }
                gc.emergencyRoles.push(role.id);
                saveConfig(config);

                return message.reply({
                    components: [buildSimpleResult(`${E.ok} Targeted Role Added`, COLOR_INACTIVE, [
                        `**Role:** ${role} (\`${role.id}\`)`,
                        ``,
                        `> This role will be targeted when emergency mode is activated.`,
                        `-# Total targeted roles: ${gc.emergencyRoles.length}`,
                    ])],
                    flags: MessageFlags.IsComponentsV2 });
            }

            if (action === 'remove') {
                const role = message.mentions.roles.first();
                if (!role) {
                    return message.reply(`${E.cancel} Mention a role to remove.\n**Usage:** \`emergency role remove @role\``);
                }
                if (!gc.emergencyRoles?.includes(role.id)) {
                    return message.reply(`${E.warn} **${role.name}** is not in the targeted role list.`);
                }
                gc.emergencyRoles = gc.emergencyRoles.filter(id => id !== role.id);
                saveConfig(config);

                return message.reply({
                    components: [buildSimpleResult(`${E.cancel} Targeted Role Removed`, COLOR_ACTIVE, [
                        `**Role:** ${role} (\`${role.id}\`)`,
                        ``,
                        `> This role will no longer be targeted during emergency mode.`,
                        `-# Remaining targeted roles: ${gc.emergencyRoles.length}`,
                    ])],
                    flags: MessageFlags.IsComponentsV2 });
            }

            if (action === 'list') {
                const roles = gc.emergencyRoles || [];
                const display = roles.length > 0
                    ? roles.map((id, i) => `\`${i + 1}.\` <@&${id}>`).join('\n')
                    : '*No roles configured — all roles with dangerous perms will be targeted*';

                return message.reply({
                    components: [new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# ${E.shield} Targeted Roles\n\n` +
                            `### ${E.bookmark} Roles (${roles.length})\n${display}\n\n` +
                            `-# Use \`emergency role add @role\` or \`emergency role remove @role\` to manage`
                        ))],
                    flags: MessageFlags.IsComponentsV2 });
            }

            return message.reply(
                `${E.cancel} Invalid subcommand.\n` +
                `**Usage:** \`emergency role add @role\` | \`emergency role remove @role\` | \`emergency role list\``
            );
        }

        /* ────── authorise add/remove ────── */
        if (sub === 'authorise' || sub === 'authorize' || sub === 'auth') {
            if (!trust.isServerOwner(message.guild, message.author.id)) {
                return message.reply(`${E.cancel} Only the **server owner** or **extra owner** can manage authorised users.`);
            }
            const action = args[1]?.toLowerCase();

            if (action === 'add') {
                const user = message.mentions.users.first();
                if (!user) {
                    return message.reply(`${E.cancel} Mention a user to authorise.\n**Usage:** \`emergency authorise add @user\``);
                }
                if (user.bot) {
                    return message.reply(`${E.cancel} You cannot authorise a bot.`);
                }
                if (!gc.authorisedUsers) gc.authorisedUsers = [];
                if (gc.authorisedUsers.includes(user.id)) {
                    return message.reply(`${E.warn} **${user.username}** is already authorised.`);
                }
                gc.authorisedUsers.push(user.id);
                saveConfig(config);

                return message.reply({
                    components: [buildSimpleResult(`${E.ok} User Authorised`, COLOR_INACTIVE, [
                        `**User:** ${user} (\`${user.id}\`)`,
                        ``,
                        `> This user can now activate and deactivate emergency mode.`,
                        `-# Total authorised users: ${gc.authorisedUsers.length}`,
                    ])],
                    flags: MessageFlags.IsComponentsV2 });
            }

            if (action === 'remove') {
                const user = message.mentions.users.first();
                if (!user) {
                    return message.reply(`${E.cancel} Mention a user to remove.\n**Usage:** \`emergency authorise remove @user\``);
                }
                if (!gc.authorisedUsers?.includes(user.id)) {
                    return message.reply(`${E.warn} **${user.username}** is not authorised.`);
                }
                gc.authorisedUsers = gc.authorisedUsers.filter(id => id !== user.id);
                saveConfig(config);

                return message.reply({
                    components: [buildSimpleResult(`${E.cancel} Authorisation Removed`, COLOR_ACTIVE, [
                        `**User:** ${user} (\`${user.id}\`)`,
                        ``,
                        `> This user can no longer use emergency mode.`,
                        `-# Remaining authorised users: ${gc.authorisedUsers.length}`,
                    ])],
                    flags: MessageFlags.IsComponentsV2 });
            }

            return message.reply(
                `${E.cancel} Invalid subcommand.\n` +
                `**Usage:** \`emergency authorise add @user\` | \`emergency authorise remove @user\``
            );
        }

        /* ────── unknown subcommand → show panel ────── */
        if (!isAuthorised(message.guild, message.author.id, gc)) {
            return message.reply(`${E.cancel} You are not authorised to use emergency commands.`);
        }
        return message.reply({
            components: [buildPanel(gc, message.guild.name)],
            flags: MessageFlags.IsComponentsV2 });
    },

    /**
     * Routes Enable/Disable buttons from the emergency panel.
     * Called from index.js when a customId starts with `emergency_`.
     */
    async handleInteraction(interaction) {
        const id = interaction.customId;
        if (id !== 'emergency_enable' && id !== 'emergency_disable') return false;

        if (await checkAndExpire(interaction, 'config')) return true;

        const { config, gc } = getGuildConfig(interaction.guild.id);

        if (!isAuthorised(interaction.guild, interaction.user.id, gc)) {
            await interaction.reply({
                content: `${E.cancel} You are not authorised to use emergency mode.`,
                flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }

        await interaction.deferUpdate().catch(() => {});

        if (id === 'emergency_enable') {
            if (gc.enabled) {
                await interaction.followUp({
                    content: `${E.warn} Emergency mode is already active.`,
                    flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
            try {
                const { stripped, savedPerms } = await activate(interaction.guild, gc, interaction.user);
                if (stripped === 0) {
                    await interaction.followUp({
                        content: `${E.cancel} Could not strip permissions from any role. ` +
                                 `Make sure the bot's role is positioned above the target roles.`,
                        flags: MessageFlags.Ephemeral }).catch(() => {});
                    return true;
                }
                gc.enabled = true;
                gc.activatedAt = new Date().toISOString();
                gc.activatedBy = interaction.user.id;
                gc.savedRolePerms = savedPerms;
                saveConfig(config);
            } catch (err) {
                console.error('[Emergency] button activate error:', err);
                await interaction.followUp({
                    content: `${E.cancel} Failed: ${err.message}`,
                    flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
        } else {
            if (!gc.enabled) {
                await interaction.followUp({
                    content: `${E.warn} Emergency mode is not active.`,
                    flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
            try {
                await deactivate(interaction.guild, gc, interaction.user);
                gc.enabled = false;
                gc.savedRolePerms = {};
                gc.activatedAt = null;
                gc.activatedBy = null;
                saveConfig(config);
            } catch (err) {
                console.error('[Emergency] button deactivate error:', err);
                await interaction.followUp({
                    content: `${E.cancel} Failed: ${err.message}`,
                    flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
        }

        // Refresh the panel in place.
        await interaction.editReply({
            components: [buildPanel(gc, interaction.guild.name)],
            flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return true;
    } };
