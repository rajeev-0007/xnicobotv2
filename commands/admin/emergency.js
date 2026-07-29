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
    ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField,
    SlashCommandBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
    RoleSelectMenuBuilder, UserSelectMenuBuilder } = require('discord.js');
const { COLORS, buildErrorResponse } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');
const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');
const { createFooterText } = require('../../utils/theme');

/* ─────────────────── constants ─────────────────── */

const E = {
    shield:      '<:Shield:1521227694677692467>',
    // on/off removed: unused, and panel state now comes from utils/panelEmojis
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

/* ═══════════════════════════════════════════════════════════════════════════
 * PANEL — select menus, matching utils/panels/automodPanel.js
 *
 * ids are `emergency:<control>`; rows read collection -> configure -> system in
 * the same order as the AutoMod and AntiNuke panels, and the only emojis are the
 * enable/disable pair.
 *
 * The permission split from the prefix command is preserved exactly:
 *   activate / deactivate  -> authorised users OR the server owner
 *   targeted roles, authorised users -> server owner / extra owner ONLY
 * Widening either would be a privilege escalation, so the handler re-checks
 * rather than trusting that the option was rendered.
 * ═══════════════════════════════════════════════════════════════════════════ */

const EID = {
    system: 'emergency:system',
    access: 'emergency:access',
    pickRoles: 'emergency:pick:roles',
    pickUsers: 'emergency:pick:users',
};

// See utils/panelEmojis — one place to re-enable emojis for every panel.
const { stateEmoji, stateText, annotateState } = require('../../utils/panelEmojis');
/** For an option's `emoji` field. */
const emark = (v) => stateEmoji(v);
/** For inline panel text. */
const etext = (v) => stateText(v);

function emergencyMenuRow(customId, placeholder, options, { min = 1, max = 1 } = {}) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(placeholder.slice(0, 150))
            .setMinValues(min)
            .setMaxValues(max)
            .addOptions(options.slice(0, 25).map((o) => {
                const opt = new StringSelectMenuOptionBuilder()
                    .setValue(o.value)
                    .setLabel(o.label.slice(0, 100));
                if (o.description) opt.setDescription(o.description.slice(0, 100));
                // `state` is the source of truth; `emoji` is only a fallback for
                // callers that still pass one directly.
                if (o.state !== undefined) {
                    const g = stateEmoji(o.state);
                    if (g) opt.setEmoji(g);
                    else opt.setDescription(annotateState(o.description, o.state));
                } else if (o.emoji) {
                    opt.setEmoji(o.emoji);
                }
                return opt;
            }))
    );
}

/** picker: 'roles' | 'users' | null — rendered as an extra row in the same message. */
function buildEmergencyPanel(gc, guild, picker) {
    const cfg = gc || getDefault();
    const on = !!cfg.enabled;
    const roles = cfg.emergencyRoles || [];
    const auth = cfg.authorisedUsers || [];

    let head = '# Emergency mode\n';
    head += '-# Strips dangerous permissions from the targeted roles so a\n';
    head += '-# compromised account cannot damage the server.\n\n';
    head += etext(on) + ' **Emergency mode** ' + (on ? 'ACTIVE' : 'inactive') + '\n';
    if (on && cfg.activatedAt) {
        head += '-# Activated <t:' + Math.floor(new Date(cfg.activatedAt).getTime() / 1000) + ':R>'
            + (cfg.activatedBy ? ' by <@' + cfg.activatedBy + '>' : '') + '\n';
    }
    head += '\n**Targeted roles** \u00b7 ' + (roles.length
        ? roles.slice(0, 8).map(id => '<@&' + id + '>').join(' ') + (roles.length > 8 ? ' +' + (roles.length - 8) : '')
        : 'none set') + '\n';
    if (!roles.length) {
        head += '-# Nothing will be stripped until at least one role is targeted.\n';
    }
    head += '\n**Authorised** \u00b7 ' + (auth.length
        ? auth.slice(0, 8).map(id => '<@' + id + '>').join(' ') + (auth.length > 8 ? ' +' + (auth.length - 8) : '')
        : 'server owner only');

    const container = new ContainerBuilder()
        .setAccentColor(on ? COLOR_ACTIVE : COLOR_INACTIVE)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(head))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    container.addActionRowComponents(emergencyMenuRow(EID.access, 'Manage access\u2026', [
        { value: 'roles', label: 'Targeted roles', description: roles.length + ' role(s) will be stripped', state: roles.length > 0 },
        { value: 'users', label: 'Authorised users', description: auth.length + ' user(s) may activate', state: auth.length > 0 },
    ]));

    container.addActionRowComponents(emergencyMenuRow(EID.system, 'System settings\u2026', [
        {
            value: 'activate',
            label: on ? 'Already active' : 'Activate emergency mode',
            description: on ? 'Deactivate first to re-run' : 'Strip permissions from the targeted roles',
            state: on,
        },
        {
            value: 'deactivate',
            label: 'Deactivate emergency mode',
            description: on ? 'Restore the saved permissions' : 'Not currently active',
            state: !on,
        },
    ]));

    if (picker === 'roles') {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId(EID.pickRoles)
                .setPlaceholder('Roles to strip during emergency mode')
                .setMinValues(0)
                .setMaxValues(20)
        ));
    } else if (picker === 'users') {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new UserSelectMenuBuilder()
                .setCustomId(EID.pickUsers)
                .setPlaceholder('Users allowed to activate emergency mode')
                .setMinValues(0)
                .setMaxValues(20)
        ));
    }

    return container;
}

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

    /* Was prefixOnly, so /emergency did not exist — the file had no
     * SlashCommandBuilder and index.js only registers a slash command when
     * `!command.prefixOnly && 'execute' in command`. Everything is reachable from
     * the panel, so the slash command takes no options. */
    data: new SlashCommandBuilder()
        .setName('emergency')
        .setDescription('Emergency lockdown — strip dangerous permissions to protect the server')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    async execute(interaction) {
        const { gc } = getGuildConfig(interaction.guild.id);
        // Same gate as the prefix path: only authorised users or the owner.
        if (!isAuthorised(interaction.guild, interaction.user.id, gc)) {
            return interaction.reply({
                content: `${E.cancel} You are not authorised to use emergency commands.`,
                flags: MessageFlags.Ephemeral });
        }
        return interaction.reply({
            components: [buildEmergencyPanel(gc, interaction.guild, null)],
            flags: MessageFlags.IsComponentsV2 });
    },

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
    /**
     * Panel dispatch. Kept separate from the legacy button path so the stale
     * emergency_enable / emergency_disable buttons still posted in servers keep
     * working unchanged.
     */
    async _handlePanel(interaction, id) {
        const { config, gc } = getGuildConfig(interaction.guild.id);

        const render = async (picker) => {
            saveConfig(config);
            await interaction.update({
                components: [buildEmergencyPanel(gc, interaction.guild, picker || null)],
                flags: MessageFlags.IsComponentsV2 });
        };

        /* Owner-only surfaces. Re-checked here rather than relying on the option
         * having been rendered, because a custom id can be replayed by anyone who
         * can see the message. */
        const ownerOnly = async () => {
            if (trust.isServerOwner(interaction.guild, interaction.user.id)) return true;
            await interaction.reply({
                content: `${E.cancel} Only the **server owner** or **extra owner** can change this.`,
                flags: MessageFlags.Ephemeral }).catch(() => {});
            return false;
        };

        if (id === EID.access) {
            if (!await ownerOnly()) return true;
            const which = (interaction.values || [])[0];
            if (which !== 'roles' && which !== 'users') {
                await interaction.reply({
                    content: `${E.cancel} That option is not recognised. Re-open with \`/emergency\`.`,
                    flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
            await interaction.update({
                components: [buildEmergencyPanel(gc, interaction.guild, which)],
                flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (id === EID.pickRoles) {
            if (!await ownerOnly()) return true;
            gc.emergencyRoles = (interaction.values || []).slice(0, 20);
            await render();
            return true;
        }

        if (id === EID.pickUsers) {
            if (!await ownerOnly()) return true;
            gc.authorisedUsers = (interaction.values || []).slice(0, 20);
            await render();
            return true;
        }

        if (id === EID.system) {
            if (!isAuthorised(interaction.guild, interaction.user.id, gc)) {
                await interaction.reply({
                    content: `${E.cancel} You are not authorised to use emergency mode.`,
                    flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
            const choice = (interaction.values || [])[0];
            if (choice !== 'activate' && choice !== 'deactivate') {
                await interaction.reply({
                    content: `${E.cancel} That option is not recognised. Re-open with \`/emergency\`.`,
                    flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }

            if (choice === 'activate') {
                if (gc.enabled) {
                    await interaction.reply({ content: `${E.warn} Emergency mode is already active.`, flags: MessageFlags.Ephemeral }).catch(() => {});
                    return true;
                }
                if (!(gc.emergencyRoles || []).length) {
                    await interaction.reply({
                        content: `${E.cancel} No roles are targeted yet. Add some under **Manage access** first.`,
                        flags: MessageFlags.Ephemeral }).catch(() => {});
                    return true;
                }
                await interaction.deferUpdate().catch(() => {});
                try {
                    const { stripped, savedPerms } = await activate(interaction.guild, gc, interaction.user);
                    if (stripped === 0) {
                        await interaction.followUp({
                            content: `${E.cancel} Could not strip permissions from any role. Check that the bot's role sits above the targeted roles.`,
                            flags: MessageFlags.Ephemeral }).catch(() => {});
                        return true;
                    }
                    gc.enabled = true;
                    gc.activatedAt = new Date().toISOString();
                    gc.activatedBy = interaction.user.id;
                    gc.savedRolePerms = savedPerms;
                    saveConfig(config);
                } catch (err) {
                    console.error('[Emergency] panel activate error:', err);
                    await interaction.followUp({ content: `${E.cancel} Activation failed: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
                    return true;
                }
                await interaction.message.edit({
                    components: [buildEmergencyPanel(gc, interaction.guild, null)],
                    flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return true;
            }

            if (!gc.enabled) {
                await interaction.reply({ content: `${E.warn} Emergency mode is not active.`, flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
            await interaction.deferUpdate().catch(() => {});
            try {
                await deactivate(interaction.guild, gc);
                gc.enabled = false;
                gc.activatedAt = null;
                gc.activatedBy = null;
                gc.savedRolePerms = {};
                saveConfig(config);
            } catch (err) {
                console.error('[Emergency] panel deactivate error:', err);
                await interaction.followUp({ content: `${E.cancel} Deactivation failed: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
            await interaction.message.edit({
                components: [buildEmergencyPanel(gc, interaction.guild, null)],
                flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }

        return false;
    },

    async handleInteraction(interaction) {
        const id = interaction.customId;

        /* ── select panel (emergency:*) ── */
        if (id.startsWith('emergency:')) {
            return await this._handlePanel(interaction, id);
        }

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
