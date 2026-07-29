const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags,
    PermissionFlagsBits, ChannelType, SlashCommandBuilder, ActionRowBuilder,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');
const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire, registerSession } = require('../../utils/panelExpiration');

function loadConfig() {
    if (!jsonStore.has('nightmode')) {
        jsonStore.write('nightmode', {});
        return {};
    }
    return jsonStore.read('nightmode');
}

function saveConfig(config) {
    jsonStore.write('nightmode', config);
}

function getDefault() {
    return {
        enabled: false,
        activatedAt: null,
        activatedBy: null,
        disabledChannels: [],
        savedPermissions: {}
    };
}

/* ── Shared lock/unlock ──
 * Extracted from executePrefix so the prefix command, the slash command and the
 * panel all drive ONE implementation. Three copies of a permission-rewriting
 * loop is how /leave-setup ended up reading a config shape nothing wrote.
 *
 * Only text-style channels are targeted: voice has separate Connect/Speak
 * permissions, and thread permissions are inherited from the parent and cannot
 * be overwritten directly.
 */
const NIGHT_TEXT_TYPES = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildForum,
    ChannelType.GuildMedia,
]);

async function lockChannels(guild, actorTag) {
    const everyoneRole = guild.roles.everyone;
    const channels = guild.channels.cache.filter(c =>
        NIGHT_TEXT_TYPES.has(c.type) &&
        c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.ManageChannels)
    );

    const savedPerms = {};
    let locked = 0;
    for (const [channelId, channel] of channels) {
        try {
            const overwrites = channel.permissionOverwrites.cache.get(everyoneRole.id);
            savedPerms[channelId] = {
                hadOverwrite: !!overwrites,
                allow: overwrites?.allow?.bitfield?.toString() || '0',
                deny: overwrites?.deny?.bitfield?.toString() || '0'
            };
            await channel.permissionOverwrites.edit(everyoneRole, {
                SendMessages: false,
                AddReactions: false,
                CreatePublicThreads: false
            }, { reason: `Night Mode enabled by ${actorTag}` });
            locked++;
        } catch (err) {
            // Skip channels we cannot modify
        }
    }
    return { savedPerms, locked };
}

async function unlockChannels(guild, savedPerms, actorTag) {
    const everyoneRole = guild.roles.everyone;
    let restored = 0;
    for (const [channelId, perms] of Object.entries(savedPerms || {})) {
        try {
            const channel = guild.channels.cache.get(channelId);
            if (!channel) continue;

            const allowBits = BigInt(perms.allow || '0');
            const denyBits = BigInt(perms.deny || '0');

            if (!perms.hadOverwrite) {
                await channel.permissionOverwrites.delete(everyoneRole, 'Night Mode disabled — restoring original state (no prior overwrite)');
            } else {
                await channel.permissionOverwrites.set([
                    { id: everyoneRole.id, allow: allowBits, deny: denyBits },
                    ...channel.permissionOverwrites.cache
                        .filter(o => o.id !== everyoneRole.id)
                        .map(o => ({ id: o.id, allow: o.allow.bitfield, deny: o.deny.bitfield }))
                ], `Night Mode disabled by ${actorTag}`);
            }
            restored++;
        } catch (err) {
            // Skip channels we cannot modify
        }
    }
    return { restored };
}

/* ── Panel — select menus, matching utils/panels/automodPanel.js ── */
const NID = { system: 'nightmode:system' };
// See utils/panelEmojis — one place to re-enable emojis for every panel.
const { stateEmoji, stateText, annotateState } = require('../../utils/panelEmojis');
/** For an option's `emoji` field. */
const nmark = (v) => stateEmoji(v);
/** For inline panel text. */
const ntext = (v) => stateText(v);

function buildNightPanel(guildConfig) {
    const cfg = guildConfig || getDefault();
    const on = !!cfg.enabled;
    const lockedCount = Object.keys(cfg.savedPermissions || {}).length;

    let head = '# Night mode\n';
    head += '-# Locks every text channel by revoking Send Messages, Add\n';
    head += '-# Reactions and Create Threads for @everyone.\n\n';
    head += ntext(on) + ' **Night mode** ' + (on ? 'ACTIVE' : 'inactive') + '\n';
    if (on) {
        if (cfg.activatedAt) {
            head += '-# Locked <t:' + Math.floor(new Date(cfg.activatedAt).getTime() / 1000) + ':R>'
                + (cfg.activatedBy ? ' by <@' + cfg.activatedBy + '>' : '') + '\n';
        }
        head += '\n**Locked channels** \u00b7 ' + lockedCount + '\n';
        head += '-# Original permissions are saved and restored on deactivate.';
    } else {
        head += '\n-# Nothing is locked. Activating saves each channel\u2019s current\n';
        head += '-# permissions first, so deactivating restores them exactly.';
    }

    return new ContainerBuilder()
        .setAccentColor(on ? 0xED4245 : COLORS.PRIMARY)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(head))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(NID.system)
                .setPlaceholder('System settings\u2026')
                .setMinValues(1)
                .setMaxValues(1)
                .addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setValue('activate')
                        .setLabel(on ? 'Already locked' : 'Lock all channels')
                        .setDescription(annotateState(on ? 'Deactivate first to re-run' : 'Revoke Send Messages for @everyone', on)),
                    new StringSelectMenuOptionBuilder()
                        .setValue('deactivate')
                        .setLabel('Unlock all channels')
                        .setDescription(annotateState(on ? 'Restore the saved permissions' : 'Not currently locked', !on))
                )
        ));
}

function buildPanel(guildConfig, guildName) {
    const statusEmoji = guildConfig.enabled
        ? stateText(true)
        : stateText(false);
    const statusText = guildConfig.enabled
        ? '**Active** — Server is in night mode'
        : '**Inactive** — Server is operating normally';

    let activatedInfo = '';
    if (guildConfig.enabled && guildConfig.activatedAt) {
        activatedInfo = `\n-# Activated <t:${Math.floor(new Date(guildConfig.activatedAt).getTime() / 1000)}:R> by <@${guildConfig.activatedBy}>`;
    }

    const content =
        `# <:Shield:1521227694677692467> Night Mode\n` +
        `-# Server lockdown for **${guildName}**\n\n` +
        `${statusEmoji} ${statusText}${activatedInfo}\n\n` +
        `### <:Document:1521227875016114266> What Night Mode Does\n` +
        `<:Caretright:1521227704953864202> Revokes \`Send Messages\` for \`@everyone\` in all channels\n` +
        `<:Caretright:1521227704953864202> Prevents new messages from being sent server-wide\n` +
        `<:Caretright:1521227704953864202> Saves current permissions for restoration on disable\n` +
        `<:Caretright:1521227704953864202> Staff with \`Manage Messages\` can still communicate\n\n` +
        `### <:Lightningalt:1521227851796447472> Commands\n` +
        `<:Caretright:1521227704953864202> \`nightmode enable\` — Lock the server down\n` +
        `<:Caretright:1521227704953864202> \`nightmode disable\` — Restore normal permissions\n\n` +
        `-# <:Infotriangle:1521227710381428926> Use during raids or off-hours to prevent damage`;

    const container = new ContainerBuilder()
        .setAccentColor(guildConfig.enabled ? 0xED4245 : 0x57F287);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return container;
}

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite message instead of execution.
     */
    premiumOnly: true,

    name: 'nightmode',
    prefix: 'nightmode',
    description: 'Lock or unlock the server by revoking send-message permissions in all channels',
    usage: 'nightmode [enable|disable]',
    category: 'admin',
    aliases: ['nmode', 'lockserver'],

    /* Was prefixOnly, so /nightmode did not exist: index.js only registers a
     * slash command when `!command.prefixOnly && 'execute' in command`. The
     * premiumOnly gate above is enforced on BOTH paths (index.js checks it for
     * slash and prefix alike), so adding the slash command does not open a
     * premium bypass. */
    data: new SlashCommandBuilder()
        .setName('nightmode')
        .setDescription('Lock or unlock every text channel for @everyone')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!trust.isServerOwner(interaction.guild, interaction.user.id)) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> Only the **server owner** or **extra owner** can use night mode.',
                flags: MessageFlags.Ephemeral });
        }
        const config = loadConfig();
        if (!config[interaction.guild.id]) config[interaction.guild.id] = getDefault();
        const sent = await interaction.reply({
            components: [buildNightPanel(config[interaction.guild.id])],
            flags: MessageFlags.IsComponentsV2, fetchReply: true });
        try { registerSession(sent.id, { channelId: interaction.channel?.id, guildId: interaction.guild.id, type: 'panel', userId: interaction.user.id }); } catch { }
        return sent;
    },

    async handleInteraction(interaction) {
        const id = interaction.customId || '';
        if (!id.startsWith('nightmode:')) return false;
        if (!interaction.guild) return false;
        // Panels expire after 5 minutes of inactivity (TIMEOUTS.panel).
        if (await checkAndExpire(interaction, 'panel')) return true;

        // Same gate as execute/executePrefix — re-checked because a custom id can
        // be replayed by anyone who can see the message.
        if (!trust.isServerOwner(interaction.guild, interaction.user.id)) {
            await interaction.reply({
                content: '<:Cancel:1521227723916181644> Only the **server owner** or **extra owner** can use night mode.',
                flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }

        if (id !== NID.system) return false;

        const config = loadConfig();
        const guildId = interaction.guild.id;
        if (!config[guildId]) config[guildId] = getDefault();
        const gc = config[guildId];

        const choice = (interaction.values || [])[0];
        if (choice !== 'activate' && choice !== 'deactivate') {
            await interaction.reply({
                content: '<:Cancel:1521227723916181644> That option is not recognised. Re-open with `/nightmode`.',
                flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }

        if (choice === 'activate') {
            if (gc.enabled) {
                await interaction.reply({ content: '<:Infotriangle:1521227710381428926> Night mode is already active.', flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
            await interaction.deferUpdate().catch(() => {});
            const { savedPerms, locked } = await lockChannels(interaction.guild, interaction.user.tag);
            if (locked === 0) {
                await interaction.followUp({
                    content: '<:Cancel:1521227723916181644> Could not lock any channels. Check that the bot has **Manage Channels** and its role sits above the channels.',
                    flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
            gc.enabled = true;
            gc.activatedAt = new Date().toISOString();
            gc.activatedBy = interaction.user.id;
            gc.savedPermissions = savedPerms;
            saveConfig(config);
        } else {
            if (!gc.enabled) {
                await interaction.reply({ content: '<:Infotriangle:1521227710381428926> Night mode is not active.', flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
            await interaction.deferUpdate().catch(() => {});
            await unlockChannels(interaction.guild, gc.savedPermissions, interaction.user.tag);
            gc.enabled = false;
            gc.activatedAt = null;
            gc.activatedBy = null;
            gc.savedPermissions = {};
            saveConfig(config);
        }

        await interaction.message.edit({
            components: [buildNightPanel(gc)],
            flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return true;
    },

    async executePrefix(message, args) {
        if (!trust.isServerOwner(message.guild, message.author.id)) {
            return message.reply(require('../../utils/adminUI').errReply('Not Allowed', 'Only the **server owner** or **extra owner** can use this command.'));
        }

        const config = loadConfig();
        const guildId = message.guild.id;
        if (!config[guildId]) config[guildId] = getDefault();
        const guildConfig = config[guildId];

        const sub = args[0]?.toLowerCase();

        if (!sub) {
            const panel = buildPanel(guildConfig, message.guild.name);
            return message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        }

        if (sub === 'enable') {
            if (guildConfig.enabled) {
                return message.reply(require('../../utils/adminUI').errReply('Already Active', 'Night Mode is already **active**.', { hint: 'Use `nightmode disable` to restore.' }));
            }

            const statusMsg = await message.reply('<a:Loading:1521227993995940032> Enabling Night Mode — locking all channels...');

            const { savedPerms, locked } = await lockChannels(message.guild, message.author.tag);

            if (locked === 0) {
                try { await statusMsg.delete(); } catch {}
                return message.reply(require('../../utils/adminUI').errReply('Failed', 'Could not lock any channels. Make sure the bot has **Manage Channels** permission and its role is positioned above the channels.'));
            }

            guildConfig.enabled = true;
            guildConfig.activatedAt = new Date().toISOString();
            guildConfig.activatedBy = message.author.id;
            guildConfig.savedPermissions = savedPerms;
            saveConfig(config);

            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Shield:1521227694677692467> Night Mode Enabled\n\n` +
                    `<:Checkedbox:1521227734943269077> Locked **${locked}** channels\n` +
                    `<:Checkedbox:1521227734943269077> \`Send Messages\` revoked for @everyone\n` +
                    `<:Checkedbox:1521227734943269077> Permissions saved for restoration\n\n` +
                    `-# Use \`nightmode disable\` to restore all permissions`
                ));

            try {
                await statusMsg.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch {
                await message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            return;
        }

        if (sub === 'disable') {
            if (!guildConfig.enabled) {
                return message.reply(require('../../utils/adminUI').errReply('Not Active', 'Night Mode is not currently active.'));
            }

            const statusMsg = await message.reply('<a:Loading:1521227993995940032> Disabling Night Mode — restoring permissions...');

            const { restored } = await unlockChannels(message.guild, guildConfig.savedPermissions, message.author.tag);

            guildConfig.enabled = false;
            guildConfig.savedPermissions = {};
            guildConfig.activatedAt = null;
            guildConfig.activatedBy = null;
            saveConfig(config);

            const container = new ContainerBuilder()
                .setAccentColor(0x57F287)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Night Mode Disabled\n\n` +
                    `<:Checkedbox:1521227734943269077> Restored **${restored}** channels\n` +
                    `<:Checkedbox:1521227734943269077> Original permissions re-applied\n` +
                    `<:Checkedbox:1521227734943269077> Server is operating normally\n\n` +
                    `-# All channel permissions have been restored to their pre-lockdown state`
                ));

            try {
                await statusMsg.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch {
                await message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            return;
        }

        const panel = buildPanel(guildConfig, message.guild.name);
        return message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    }
};
