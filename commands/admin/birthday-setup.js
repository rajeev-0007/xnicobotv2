'use strict';

/**
 * /birthday-setup
 * ───────────────
 * Admin-facing setup panel for the birthday system. Every control is inline
 * on the panel — picking a channel, role, ping mode, hour, or message style
 * refreshes the panel in-place with a green confirmation notice.
 *
 * Components V2 layout (8 components, under the 10-per-container cap):
 *   1. Header text
 *   2. Separator
 *   3. Channel select (announcement channel)
 *   4. Role select (optional birthday role)
 *   5. String select — Ping Mode
 *   6. String select — Send Hour (UTC)
 *   7. String select — Message Style
 *   8. Action row of 5 buttons: Edit Message · Preview · Test Send · Public Panel · Toggle/Reset
 *
 * Auxiliary (button-spawned) ephemerals:
 *   • Public-panel channel picker (`bdaysetup_panelpick`)
 *   • Reset confirmation (`bdaysetup_resetconfirm` / `_resetcancel`)
 *   • Message-builder bridge (`bdaymsg_*` → utils/actionMessageBuilder)
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ChannelType,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder
} = require('discord.js');

const birthdayManager = require('../../utils/birthdayManager');
const messageBuilder = require('../../utils/actionMessageBuilder');

const SETUP_PREFIX = 'bdaysetup';
const BUILDER_PREFIX = 'bdaymsg';

// ── Helpers ────────────────────────────────────────────────────────────

function pingLabel(mode) {
    return ({
        everyone: '@everyone',
        here: '@here',
        role: 'Birthday role',
        user: 'User only',
        none: 'No ping'
    })[mode] || 'User only';
}

function styleLabel(t) {
    return ({
        simple: '💬 Simple',
        embed: '📝 Embed',
        components: '🎨 Components V2'
    })[t] || '📝 Embed';
}

function hourLabel(h) {
    const hh = Number.isInteger(h) ? h : 9;
    return `${String(hh).padStart(2, '0')}:00 UTC`;
}

function ensureManageGuild(interaction) {
    return interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild);
}

// ── Main setup panel ───────────────────────────────────────────────────

function buildSetupPanel(guild, opts = {}) {
    const cfg = birthdayManager.getGuildConfig(guild.id);
    const enabled = !!cfg.enabled;
    const notice = opts.notice;

    const channelTxt = cfg.channelId ? `<#${cfg.channelId}>` : '`Not set`';
    const roleTxt = cfg.roleId ? `<@&${cfg.roleId}>` : '`None`';
    const userCount = Object.keys(cfg.users || {}).length;
    const panelTxt = cfg.panel?.channelId
        ? `Posted in <#${cfg.panel.channelId}>`
        : '`Not posted yet`';

    const headerBlock =
        `# 🎂  Birthday System\n` +
        `-# Schedule birthday wishes for **${guild.name}**\n\n` +
        `### <:Settings:1521227767780343879> Configuration\n` +
        `**Status:** ${enabled
            ? '<:Toggleon:1521227758011809964> Enabled'
            : '<:Toggleoff:1521227763816595559> Disabled'}\n` +
        `**Announcement Channel:** ${channelTxt}\n` +
        `**Birthday Role:** ${roleTxt}\n` +
        `**Ping Mode:** \`${pingLabel(cfg.pingMode)}\`\n` +
        `**Send Hour:** \`${hourLabel(cfg.hour)}\`\n` +
        `**Message Style:** ${styleLabel(cfg.messageType)}\n\n` +
        `### <:User:1521227714227343380> Stats\n` +
        `**Saved Birthdays:** \`${userCount}\` · **Public Panel:** ${panelTxt}\n` +
        (notice ? `\n${notice}` : '') +
        `\n\n-# Members save with \`/birthday set\` or via the public panel.`;

    const container = new ContainerBuilder()
        .setAccentColor(enabled ? 0xFF6FA3 : 0x5865F2)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerBlock))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // ── Channel select ────────────────────────────────────────────────
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(`${SETUP_PREFIX}_channelpick`)
                .setPlaceholder(cfg.channelId ? 'Change announcement channel…' : 'Pick announcement channel…')
                .setMinValues(1)
                .setMaxValues(1)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    );

    // ── Role select ───────────────────────────────────────────────────
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId(`${SETUP_PREFIX}_rolepick`)
                .setPlaceholder(cfg.roleId ? 'Change birthday role…' : 'Pick optional birthday role…')
                .setMinValues(0)
                .setMaxValues(1)
        )
    );

    // ── Ping mode select ──────────────────────────────────────────────
    const pingOptions = [
        { label: 'User only', value: 'user', description: 'Mention only the birthday user', emoji: '<:User:1521227714227343380>' },
        { label: 'Birthday role', value: 'role', description: 'Ping the configured birthday role', emoji: '<:Pin:1521227932625014916>' },
        { label: '@here', value: 'here', description: 'Ping online members in the channel', emoji: '🔔' },
        { label: '@everyone', value: 'everyone', description: 'Ping every member', emoji: '<:Bullhorn:1521227936575914016>' },
        { label: 'No ping', value: 'none', description: 'Send the message silently', emoji: '<:Toggleoff:1521227763816595559>' }
    ].map(o => ({ ...o, default: cfg.pingMode === o.value }));
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`${SETUP_PREFIX}_pingpick`)
                .setPlaceholder(`🔔 Ping mode — currently: ${pingLabel(cfg.pingMode)}`)
                .addOptions(pingOptions)
        )
    );

    // ── Hour select (24 options) ──────────────────────────────────────
    const hourOptions = [];
    for (let h = 0; h < 24; h++) {
        const value = String(h);
        // Only set description for the special markers — Discord
        // rejects empty strings for option.description ("Received one
        // or more errors"), so omit the field entirely otherwise.
        const opt = {
            label: `${String(h).padStart(2, '0')}:00 UTC`,
            value,
            default: String(cfg.hour ?? 9) === value
        };
        if (h === 0) opt.description = 'Midnight UTC';
        else if (h === 12) opt.description = 'Noon UTC';
        hourOptions.push(opt);
    }
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`${SETUP_PREFIX}_hourpick`)
                .setPlaceholder(`🕒 Send hour (UTC) — currently: ${hourLabel(cfg.hour)}`)
                .addOptions(hourOptions)
        )
    );

    // ── Style select ──────────────────────────────────────────────────
    const styleOptions = [
        { label: 'Simple', value: 'simple', description: 'Plain text message', emoji: '<:Hashtag:1521227771957870604>' },
        { label: 'Embed', value: 'embed', description: 'Rich embed with title, color, and fields', emoji: '<:Document:1521227875016114266>' },
        { label: 'Components V2', value: 'components', description: 'Modern card-style layout', emoji: '<:Fire:1521227907647668374>' }
    ].map(o => ({ ...o, default: cfg.messageType === o.value }));
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`${SETUP_PREFIX}_msgstylepick`)
                .setPlaceholder(`🎨 Message style — currently: ${styleLabel(cfg.messageType)}`)
                .addOptions(styleOptions)
        )
    );

    // ── Buttons row ───────────────────────────────────────────────────
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_msgedit`)
                .setLabel('Edit Message')
                .setEmoji('<:Editalt:1521227921673556019>')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_preview`)
                .setLabel('Preview')
                .setEmoji('<:Eye:1521227940480815156>')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_test`)
                .setLabel('Test Send')
                .setEmoji('<:Fire:1521227907647668374>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!cfg.channelId),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_panel`)
                .setLabel('Send Public Panel')
                .setEmoji('<:Add:1521227828199293152>')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(!cfg.channelId)
        )
    );

    // ── Bottom row ────────────────────────────────────────────────────
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_toggle`)
                .setLabel(enabled ? 'Disable System' : 'Enable System')
                .setEmoji(enabled
                    ? '<:Toggleoff:1521227763816595559>'
                    : '<:Toggleon:1521227758011809964>')
                .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success)
                .setDisabled(!cfg.channelId),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_clearrole`)
                .setLabel('Clear Role')
                .setEmoji('<:Trash:1521227750420254820>')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!cfg.roleId),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_refresh`)
                .setLabel('Refresh')
                .setEmoji('<:Refresh:1521227946441052420>')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`${SETUP_PREFIX}_reset`)
                .setLabel('Reset')
                .setEmoji('<:Trash:1521227750420254820>')
                .setStyle(ButtonStyle.Danger)
        )
    );

    return container;
}

// ── Public "Set Your Birthday" panel ───────────────────────────────────

function buildPublicPanel(guild) {
    const container = new ContainerBuilder()
        .setAccentColor(0xFF6FA3)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# 🎂  Birthday Setup\n` +
            `-# Save your birthday for **${guild.name}** and join the celebration list.`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Lightbulbalt:1521227880703463675> How it works\n` +
            `> <:Caretright:1521227704953864202>  Click **Set Birthday** below\n` +
            `> <:Caretright:1521227704953864202>  Enter your birthday as \`DD-MM\` or \`DD-MM-YYYY\`\n` +
            `> <:Caretright:1521227704953864202>  We'll wish you in the announcement channel on your day\n\n` +
            `### <:Document:1521227875016114266> Privacy\n` +
            `Your birthday is stored only for this server. You can clear it ` +
            `anytime with **Remove**.`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('bdaypanel_set')
                    .setLabel('Set Birthday')
                    .setEmoji('🎂')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('bdaypanel_view')
                    .setLabel('View Mine')
                    .setEmoji('<:Eye:1521227940480815156>')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('bdaypanel_remove')
                    .setLabel('Remove')
                    .setEmoji('<:Trash:1521227750420254820>')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('bdaypanel_upcoming')
                    .setLabel('Upcoming')
                    .setEmoji('📅')
                    .setStyle(ButtonStyle.Secondary)
            )
        );

    return container;
}

// ── Refresh helper ─────────────────────────────────────────────────────

async function refreshPanel(interaction, notice) {
    const panel = buildSetupPanel(interaction.guild, { notice });
    const payload = {
        components: [panel],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    };
    if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => {});
    } else {
        await interaction.update(payload).catch(async () => {
            await interaction.reply(payload).catch(() => {});
        });
    }
}

// ── Command export ─────────────────────────────────────────────────────

module.exports = {
    data: new SlashCommandBuilder()
        .setName('birthday-setup')
        .setDescription('Configure the server birthday system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    prefix: 'birthday-setup',
    description: 'Configure the server birthday system (channel, role, message)',
    usage: 'birthday-setup',
    category: 'admin',
    aliases: ['birthdaysetup', 'bdaysetup', 'bday-setup'],

    SETUP_PREFIX,
    BUILDER_PREFIX,
    buildSetupPanel,
    buildPublicPanel,

    async execute(interaction) {
        if (!ensureManageGuild(interaction)) {
            return interaction.reply({
                content: '<:Cancel:1521227723916181644> You need **Manage Server** permission.',
                flags: MessageFlags.Ephemeral
            });
        }
        const panel = buildSetupPanel(interaction.guild);
        await interaction.reply({
            components: [panel],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    async executePrefix(message) {
        if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Manage Server** permission.');
        }
        const panel = buildSetupPanel(message.guild);
        await message.reply({
            components: [panel],
            flags: MessageFlags.IsComponentsV2
        });
    },

    /**
     * Master button/select/modal handler for the setup panel and
     * the message builder spawned from it.
     */
    async handleInteraction(interaction) {
        const id = interaction.customId;
        if (!id) return false;

        // Message builder bridge — handles both button + modal events.
        if (id.startsWith(BUILDER_PREFIX + '_')) {
            return handleMessageBuilderRouting(interaction);
        }

        if (!id.startsWith(SETUP_PREFIX + '_')) return false;

        if (!ensureManageGuild(interaction)) {
            await interaction.reply({
                content: '<:Cancel:1521227723916181644> You need **Manage Server** permission.',
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
            return true;
        }

        const action = id.replace(SETUP_PREFIX + '_', '');
        const guildId = interaction.guild.id;

        try {
            // ── Channel pick ──────────────────────────────────────────
            if (interaction.isChannelSelectMenu() && action === 'channelpick') {
                const channelId = interaction.values[0];
                const cfg = birthdayManager.getGuildConfig(guildId);
                cfg.channelId = channelId;
                birthdayManager.saveGuildConfig(guildId, cfg);
                await refreshPanel(interaction,
                    `<:Checkedbox:1521227734943269077> Announcement channel set to <#${channelId}>.`);
                return true;
            }

            // ── Role pick ─────────────────────────────────────────────
            if (interaction.isRoleSelectMenu() && action === 'rolepick') {
                const roleId = interaction.values[0] || null;
                const cfg = birthdayManager.getGuildConfig(guildId);

                if (roleId) {
                    const role = interaction.guild.roles.cache.get(roleId);
                    const me = interaction.guild.members.me;
                    if (role && me && me.roles.highest.comparePositionTo(role) <= 0) {
                        await refreshPanel(interaction,
                            `<:Cancel:1521227723916181644> I can't assign **${role.name}** — it's higher than my top role. Move my role above it or pick a lower role.`);
                        return true;
                    }
                    if (role && role.managed) {
                        await refreshPanel(interaction,
                            `<:Cancel:1521227723916181644> **${role.name}** is a managed/integration role and can't be auto-assigned.`);
                        return true;
                    }
                }

                cfg.roleId = roleId;
                birthdayManager.saveGuildConfig(guildId, cfg);
                await refreshPanel(interaction, roleId
                    ? `<:Checkedbox:1521227734943269077> Birthday role set to <@&${roleId}>.`
                    : `<:Checkedbox:1521227734943269077> Birthday role cleared.`);
                return true;
            }

            if (interaction.isButton() && action === 'clearrole') {
                const cfg = birthdayManager.getGuildConfig(guildId);
                cfg.roleId = null;
                birthdayManager.saveGuildConfig(guildId, cfg);
                await refreshPanel(interaction, '<:Checkedbox:1521227734943269077> Birthday role cleared.');
                return true;
            }

            // ── Ping mode (inline) ────────────────────────────────────
            if (interaction.isStringSelectMenu() && action === 'pingpick') {
                const val = interaction.values[0];
                const cfg = birthdayManager.getGuildConfig(guildId);
                cfg.pingMode = val;
                birthdayManager.saveGuildConfig(guildId, cfg);
                await refreshPanel(interaction,
                    `<:Checkedbox:1521227734943269077> Ping mode set to **${pingLabel(val)}**.`);
                return true;
            }

            // ── Hour (inline) ─────────────────────────────────────────
            if (interaction.isStringSelectMenu() && action === 'hourpick') {
                const hour = parseInt(interaction.values[0], 10);
                const cfg = birthdayManager.getGuildConfig(guildId);
                cfg.hour = isNaN(hour) ? 9 : Math.max(0, Math.min(23, hour));
                birthdayManager.saveGuildConfig(guildId, cfg);
                await refreshPanel(interaction,
                    `<:Checkedbox:1521227734943269077> Send hour set to **${hourLabel(cfg.hour)}**.`);
                return true;
            }

            // ── Message style (inline) ────────────────────────────────
            if (interaction.isStringSelectMenu() && action === 'msgstylepick') {
                const t = interaction.values[0];
                if (!['simple', 'embed', 'components'].includes(t)) {
                    await refreshPanel(interaction);
                    return true;
                }
                const cfg = birthdayManager.getGuildConfig(guildId);
                const wasSame = cfg.messageType === t;
                cfg.messageType = t;
                // Only reset template when user actually switches styles —
                // re-clicking the current style preserves their custom edits.
                if (!wasSame) {
                    cfg.messageData = birthdayManager.cloneTemplate(t);
                }
                birthdayManager.saveGuildConfig(guildId, cfg);
                await refreshPanel(interaction, wasSame
                    ? `<:Checkedbox:1521227734943269077> Style still set to **${styleLabel(t)}** — your custom message was preserved.`
                    : `<:Checkedbox:1521227734943269077> Style set to **${styleLabel(t)}** — default template loaded. Customize it with **Edit Message**.`);
                return true;
            }

            // ── Edit Message → spawn shared message builder ───────────
            if (interaction.isButton() && action === 'msgedit') {
                const cfg = birthdayManager.getGuildConfig(guildId);
                // Use cfg.messageType as the authoritative mode — it reflects the
                // style the admin just selected, even if messageData.mode is stale
                // (e.g. after switching style without having saved via the builder).
                const resolvedType = cfg.messageType || 'embed';
                const seed = cfg.messageData && Object.keys(cfg.messageData).length
                    ? cfg.messageData
                    : birthdayManager.cloneTemplate(resolvedType);
                const sessionData = {
                    ...messageBuilder.getDefaultMessageData(),
                    ...seed,
                    // Always force the mode to match cfg.messageType so the builder
                    // opens in the correct tab regardless of what messageData.mode says.
                    mode: resolvedType,
                    context: 'Birthday Wish'
                };
                messageBuilder.setSession(interaction.user.id, 'birthday', guildId, '', sessionData);
                const panel = messageBuilder.buildMessageBuilderPanel(sessionData, BUILDER_PREFIX, 'Birthday Wish');
                await interaction.reply({
                    components: [panel],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
                return true;
            }

            // ── Preview ───────────────────────────────────────────────
            if (interaction.isButton() && action === 'preview') {
                const cfg = birthdayManager.getGuildConfig(guildId);
                const data = cfg.messageData || birthdayManager.cloneTemplate(cfg.messageType || 'embed');
                // Authoritative mode: cfg.messageType wins over a potentially-stale
                // data.mode so preview always matches the selected style.
                const mode = cfg.messageType || data.mode || 'embed';
                const user = interaction.user;
                const guild = interaction.guild;
                const channel = interaction.channel;

                if (mode === 'components') {
                    const container = messageBuilder.buildComponentsV2Message(
                        data, user, guild, channel
                    );
                    await interaction.reply({
                        components: [container],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                    });
                } else if (mode === 'embed') {
                    const embed = messageBuilder.buildPreviewEmbed(data, user, guild, channel);
                    const rawContent = messageBuilder.replacePlaceholders(
                        data.content || '', user, guild, channel
                    );
                    const content = rawContent.trim() || undefined;
                    await interaction.reply({
                        content,
                        embeds: [embed],
                        flags: MessageFlags.Ephemeral,
                        allowedMentions: { parse: [] }
                    });
                } else {
                    // simple mode
                    const rawContent = messageBuilder.replacePlaceholders(
                        data.content || '', user, guild, channel
                    );
                    const content = rawContent.trim() || '*No content yet — use Edit Message.*';
                    await interaction.reply({
                        content,
                        flags: MessageFlags.Ephemeral,
                        allowedMentions: { parse: [] }
                    });
                }
                return true;
            }

            // ── Test Send ─────────────────────────────────────────────
            if (interaction.isButton() && action === 'test') {
                const cfg = birthdayManager.getGuildConfig(guildId);
                if (!cfg.channelId) {
                    await refreshPanel(interaction,
                        '<:Cancel:1521227723916181644> Set the announcement channel first.');
                    return true;
                }
                let channel = interaction.guild.channels.cache.get(cfg.channelId);
                if (!channel) channel = await interaction.guild.channels.fetch(cfg.channelId).catch(() => null);
                if (!channel || !channel.isTextBased?.()) {
                    await refreshPanel(interaction,
                        '<:Cancel:1521227723916181644> Configured channel is missing or not a text channel.');
                    return true;
                }
                const me = interaction.guild.members.me;
                const perms = channel.permissionsFor(me);
                if (!perms?.has(['ViewChannel', 'SendMessages'])) {
                    await refreshPanel(interaction,
                        `<:Cancel:1521227723916181644> I don't have **View Channel + Send Messages** in ${channel}.`);
                    return true;
                }

                // Defer so the 3-second window doesn't expire while the message is built/sent.
                await interaction.deferUpdate();

                try {
                    // Fetch a fresh GuildMember so avatar URL / roles cache is populated.
                    const member = await interaction.guild.members.fetch(interaction.user.id)
                        .catch(() => interaction.member);
                    await birthdayManager.sendBirthdayMessage(
                        interaction.client,
                        interaction.guild,
                        channel,
                        member,
                        { month: new Date().getUTCMonth() + 1, day: new Date().getUTCDate(), year: null },
                        cfg
                    );
                    const okPanel = buildSetupPanel(interaction.guild, {
                        notice: `<:Checkedbox:1521227734943269077> Test wish sent to ${channel}.`
                    });
                    await interaction.editReply({
                        components: [okPanel],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                    }).catch(() => {});
                } catch (e) {
                    const errPanel = buildSetupPanel(interaction.guild, {
                        notice: `<:Cancel:1521227723916181644> Test send failed: ${e.message || e}`
                    });
                    await interaction.editReply({
                        components: [errPanel],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                    }).catch(() => {});
                }
                return true;
            }


            // ── Send public Set-Birthday panel ────────────────────────
            if (interaction.isButton() && action === 'panel') {
                const row = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId(`${SETUP_PREFIX}_panelpick`)
                        .setPlaceholder('Pick the channel for the public Set-Birthday panel')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                );
                await interaction.reply({
                    content: '<:Add:1521227828199293152> Pick the channel where the public Set-Birthday panel should be posted:',
                    components: [row],
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }
            if (interaction.isChannelSelectMenu() && action === 'panelpick') {
                const channelId = interaction.values[0];
                const channel = interaction.guild.channels.cache.get(channelId)
                    || await interaction.guild.channels.fetch(channelId).catch(() => null);
                if (!channel) {
                    await interaction.update({ content: '<:Cancel:1521227723916181644> Channel not found.', components: [] });
                    return true;
                }
                const me = interaction.guild.members.me;
                const perms = channel.permissionsFor(me);
                if (!perms?.has(['ViewChannel', 'SendMessages'])) {
                    await interaction.update({
                        content: `<:Cancel:1521227723916181644> I don't have **View Channel + Send Messages** in ${channel}.`,
                        components: []
                    });
                    return true;
                }
                try {
                    const cfg = birthdayManager.getGuildConfig(guildId);
                    // Best-effort: delete the previous panel if one exists.
                    if (cfg.panel?.channelId && cfg.panel?.messageId) {
                        const oldCh = interaction.guild.channels.cache.get(cfg.panel.channelId)
                            || await interaction.guild.channels.fetch(cfg.panel.channelId).catch(() => null);
                        if (oldCh) {
                            const oldMsg = await oldCh.messages.fetch(cfg.panel.messageId).catch(() => null);
                            if (oldMsg) await oldMsg.delete().catch(() => {});
                        }
                    }
                    const panel = buildPublicPanel(interaction.guild);
                    const sent = await channel.send({
                        components: [panel],
                        flags: MessageFlags.IsComponentsV2
                    });
                    cfg.panel = { channelId: channel.id, messageId: sent.id };
                    birthdayManager.saveGuildConfig(guildId, cfg);
                    await interaction.update({
                        content: `<:Checkedbox:1521227734943269077> Public panel posted in ${channel}.`,
                        components: []
                    });
                } catch (e) {
                    await interaction.update({
                        content: `<:Cancel:1521227723916181644> Could not post panel: ${e.message || e}`,
                        components: []
                    });
                }
                return true;
            }

            // ── Toggle ────────────────────────────────────────────────
            if (interaction.isButton() && action === 'toggle') {
                const cfg = birthdayManager.getGuildConfig(guildId);
                if (!cfg.channelId) {
                    await refreshPanel(interaction,
                        '<:Cancel:1521227723916181644> Set the announcement channel first.');
                    return true;
                }
                cfg.enabled = !cfg.enabled;
                birthdayManager.saveGuildConfig(guildId, cfg);
                await refreshPanel(interaction, cfg.enabled
                    ? '<:Toggleon:1521227758011809964> Birthday system **enabled**.'
                    : '<:Toggleoff:1521227763816595559> Birthday system **disabled**.');
                return true;
            }

            // ── Refresh ───────────────────────────────────────────────
            if (interaction.isButton() && action === 'refresh') {
                await refreshPanel(interaction);
                return true;
            }

            // ── Reset (with confirmation) ─────────────────────────────
            if (interaction.isButton() && action === 'reset') {
                const confirmRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`${SETUP_PREFIX}_resetconfirm`)
                        .setLabel('Yes, reset settings')
                        .setEmoji('<:Trash:1521227750420254820>')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`${SETUP_PREFIX}_resetcancel`)
                        .setLabel('Cancel')
                        .setStyle(ButtonStyle.Secondary)
                );
                await interaction.reply({
                    content: '<:Cancel:1521227723916181644> Reset clears channel, role, ping mode, hour, and message template.\n' +
                             '**Saved member birthdays are preserved.** Continue?',
                    components: [confirmRow],
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }
            if (interaction.isButton() && action === 'resetconfirm') {
                const all = birthdayManager.loadAll();
                const preserveUsers = all[guildId]?.users || {};
                all[guildId] = { ...birthdayManager.getDefaultGuildConfig(), users: preserveUsers };
                birthdayManager.saveAll(all);
                await interaction.update({
                    content: '<:Checkedbox:1521227734943269077> Settings reset. Member birthdays were preserved.\n-# Re-open `/birthday-setup` to see the cleared panel.',
                    components: []
                });
                return true;
            }
            if (interaction.isButton() && action === 'resetcancel') {
                await interaction.update({
                    content: '<:Checkedbox:1521227734943269077> Reset cancelled.',
                    components: []
                });
                return true;
            }
        } catch (err) {
            require('../../utils/logger-styled').error('[birthday-setup] handler error:', err);
            const msg = `<:Cancel:1521227723916181644> Something went wrong: ${err.message || err}`;
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
                } else {
                    await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
                }
            } catch {}
            return true;
        }

        return false;
    }
};

// ── Internal: route message-builder interactions back to setup ────────

async function handleMessageBuilderRouting(interaction) {
    const guildId = interaction.guild.id;
    // Accept buttons, modals, AND string select menus (the builder uses selects for mode/style).
    if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return false;

    const onSave = async (i, data) => {
        const cfg = birthdayManager.getGuildConfig(guildId);
        cfg.messageData = {
            mode: data.mode,
            content: data.content || '',
            title: data.title || '',
            description: data.description || '',
            color: data.color || '#FF6FA3',
            image: data.image || '',
            thumbnail: data.thumbnail || '',
            footer: data.footer || '',
            footerIcon: data.footerIcon || '',
            author: data.author || '',
            authorIcon: data.authorIcon || '',
            fields: Array.isArray(data.fields) ? data.fields : []
        };
        cfg.messageType = data.mode || cfg.messageType || 'embed';
        birthdayManager.saveGuildConfig(guildId, cfg);
        const okMsg = '<:Checkedbox:1521227734943269077> Birthday message saved! Re-open `/birthday-setup` to refresh the panel.';
        if (i.deferred || i.replied) {
            await i.editReply({ content: okMsg, components: [], embeds: [] }).catch(() => {});
        } else {
            await i.update({ content: okMsg, components: [], embeds: [] }).catch(async () => {
                await i.reply({ content: okMsg, flags: MessageFlags.Ephemeral }).catch(() => {});
            });
        }
    };

    const onCancel = async (i) => {
        const cancelMsg = '<:Cancel:1521227723916181644> Edit cancelled.';
        if (i.deferred || i.replied) {
            await i.editReply({ content: cancelMsg, components: [], embeds: [] }).catch(() => {});
        } else {
            await i.update({ content: cancelMsg, components: [], embeds: [] }).catch(async () => {
                await i.reply({ content: cancelMsg, flags: MessageFlags.Ephemeral }).catch(() => {});
            });
        }
    };

    if (interaction.isModalSubmit()) {
        return await messageBuilder.handleModalSubmit(interaction, BUILDER_PREFIX, 'birthday', guildId, '');
    }
    return await messageBuilder.handleButtonInteraction(
        interaction, BUILDER_PREFIX, 'birthday', guildId, '', onSave, onCancel
    );
}
