const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ChannelType, OverwriteType, ContainerBuilder, TextDisplayBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { loadConfig, getDefaultConfig, buildAntiNukePanel, refreshAntiNukePanel, saveConfig, PROTECTION_KEYS, PROTECTION_LABELS, PUNISHMENT_LABELS, AVAILABLE_PUNISHMENTS, formatTimeWindow } = require('../../utils/panels/antinukePanel');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied } = require('../../utils/responseBuilder');
const { registerPanel } = require('../../utils/panelRegistry');

async function refreshAntiNukePanelCompat(interactionOrMessage, guildConfig) {
    const container = buildAntiNukePanel(guildConfig);

    try {
        if (interactionOrMessage.update) {
            await interactionOrMessage.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } else {
            await interactionOrMessage.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    } catch (error) {
        console.error('Error refreshing antinuke panel:', error);
    }
}

const _logChannelLocks = new Set();

// ── Max Power chooser panel ──
// Lets the admin pick individually which advanced protections to enable
// (each optional), plus quick Enable All / Disable All buttons.
function buildPowerContainer(guildConfig) {
    const zt = !!guildConfig.zeroTolerance;
    const iq = !!guildConfig.instantQuarantine;
    const ar = !!guildConfig.autoRestore;
    const on = '<:Toggleon:1521227758011809964>';
    const off = '<:Toggleoff:1521227763816595559>';

    return new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `## <:Lightning:1521227915537285150> Max Power Protection\n` +
            `-# Choose which advanced responses to enable — each is optional.\n\n` +
            `${zt ? on : off} **Zero-Tolerance** — punish on the **first** destructive action (limit = 1)\n` +
            `${iq ? on : off} **Instant Quarantine** — strip the offender's roles **immediately** on detection\n` +
            `${ar ? on : off} **Auto-Restore** — automatically **recreate** channels/roles a nuker deletes`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('antinuke_power_select')
                .setPlaceholder('Select which protections to enable')
                .setMinValues(0)
                .setMaxValues(3)
                .addOptions([
                    { label: 'Zero-Tolerance', description: 'Punish on the first destructive action', value: 'zeroTolerance', emoji: '<:Lightningalt:1521227851796447472>', default: zt },
                    { label: 'Instant Quarantine', description: "Strip offender's roles immediately", value: 'instantQuarantine', emoji: '<:Userblock:1521227822641975366>', default: iq },
                    { label: 'Auto-Restore', description: 'Recreate deleted channels & roles', value: 'autoRestore', emoji: '<:History:1521227863079256278>', default: ar }
                ])
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('antinuke_power_all').setLabel('Enable All').setStyle(ButtonStyle.Danger).setEmoji('<:Checkedbox:1521227734943269077>'),
            new ButtonBuilder().setCustomId('antinuke_power_none').setLabel('Disable All').setStyle(ButtonStyle.Secondary).setEmoji('<:Cancel:1521227723916181644>')
        ));
}

async function ensureLogChannel(guild, guildConfig, config, guildId) {
    if (guildConfig.logChannel) {
        const existing = guild.channels.cache.get(guildConfig.logChannel);
        if (existing) return;
    }

    if (_logChannelLocks.has(guildId)) return;
    _logChannelLocks.add(guildId);

    try {
        const existingChannel = guild.channels.cache.find(c => c.name === 'antinuke-logs' && c.type === ChannelType.GuildText);
        if (existingChannel) {
            guildConfig.logChannel = existingChannel.id;
            config[guildId] = guildConfig;
            saveConfig(config);
            _logChannelLocks.delete(guildId);
            return;
        }

        const botMember = guild.members.me;
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) { _logChannelLocks.delete(guildId); return; }

        const logChannel = await guild.channels.create({
            name: 'antinuke-logs',
            type: ChannelType.GuildText,
            topic: 'Anti-Nuke protection logs — automated by xNico',
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                    type: OverwriteType.Role
                },
                {
                    id: botMember.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
                    type: OverwriteType.Member
                },
                {
                    id: guild.ownerId,
                    allow: [PermissionFlagsBits.ViewChannel],
                    type: OverwriteType.Member
                }
            ],
            reason: 'Anti-Nuke: Auto-created log channel'
        });

        guildConfig.logChannel = logChannel.id;
        config[guildId] = guildConfig;
        saveConfig(config);
    } catch (err) {
        console.error('Failed to create antinuke log channel:', err.message);
    } finally {
        _logChannelLocks.delete(guildId);
    }
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('antinuke')
        .setDescription('Configure server anti-nuke protection system')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    refreshAntiNukePanel: refreshAntiNukePanelCompat,

    async execute(interaction) {
        const config = loadConfig();
        const guildId = interaction.guild.id;
        const guildConfig = config[guildId] || getDefaultConfig();
        if (!config[guildId]) { config[guildId] = guildConfig; saveConfig(config); }

        const container = buildAntiNukePanel(guildConfig);
        const reply = await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, fetchReply: true });
        registerPanel(guildId, 'antinuke', interaction.channel.id, reply.id);
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const container = buildPermissionDenied('Administrator');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const config = loadConfig();
        const guildId = message.guild.id;
        const defaultConfig = getDefaultConfig();

        const guildConfig = config[guildId] || defaultConfig;
        if (!config[guildId]) {
            config[guildId] = defaultConfig;
            saveConfig(config);
        }

        const container = buildAntiNukePanel(guildConfig);

        try {
            const reply = await message.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2
            });

            registerPanel(guildId, 'antinuke', message.channel.id, reply.id);
        } catch (error) {
            console.error('Error sending antinuke panel:', error);
            const errContainer = buildErrorResponse('Panel Error', 'There was an error displaying the anti-nuke panel. Please try again.');
            await message.reply({ components: [errContainer], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async handleInteraction(interaction) {
        if (!interaction.guild || !interaction.member) return;

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            const container = buildPermissionDenied('Administrator or Manage Guild');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const config = loadConfig();
        const guildId = interaction.guild.id;
        let guildConfig = config[guildId];

        if (!guildConfig) {
            const container = buildErrorResponse('Not Configured', 'Anti-Nuke configuration not found! Use `/antinuke` or `-antinuke` first.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const { updatePanel } = require('../../utils/panelRegistry');

        try {
            if (interaction.isStringSelectMenu() && interaction.customId === 'antinuke_protection_select') {
                const selectedProtections = interaction.values;
                const protectionMap = {
                    'ban': 'banProtection',
                    'kick': 'kickProtection',
                    'channel_delete': 'channelDelete',
                    'channel_create': 'channelCreate',
                    'role_delete': 'roleDelete',
                    'role_create': 'roleCreate',
                    'webhook': 'webhookCreate',
                    'bot_add': 'botAdd'
                };

                for (const protection of selectedProtections) {
                    const configKey = protectionMap[protection];
                    if (configKey && guildConfig[configKey]) {
                        guildConfig[configKey].enabled = !guildConfig[configKey].enabled;
                    }
                }

                config[guildId] = guildConfig;
                saveConfig(config);

                await interaction.deferUpdate();
                await updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
                    await refreshAntiNukePanel(message, guildConfig);
                });
                return;
            }

            if (interaction.isStringSelectMenu() && interaction.customId === 'antinuke_action_select') {
                const [protectionKey, newAction] = interaction.values[0].split(':');
                if (!protectionKey || !newAction) return;

                if (guildConfig[protectionKey]) {
                    guildConfig[protectionKey].action = newAction;
                    if (protectionKey === 'channelDelete' && guildConfig.channelCreate) {
                        guildConfig.channelCreate.action = newAction;
                    }
                    if (protectionKey === 'roleDelete' && guildConfig.roleCreate) {
                        guildConfig.roleCreate.action = newAction;
                    }
                }

                config[guildId] = guildConfig;
                saveConfig(config);

                const label = PROTECTION_LABELS[protectionKey] || protectionKey;
                const actionLabel = PUNISHMENT_LABELS[newAction] || newAction;

                await interaction.reply({
                    components: [buildSuccessResponse('Action Updated', `**${label}** punishment set to **${actionLabel}**`)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });

                await updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
                    await refreshAntiNukePanel(message, guildConfig);
                });
                return;
            }

            if (interaction.customId === 'antinuke_enable_all') {
                PROTECTION_KEYS.forEach(protection => {
                    if (guildConfig[protection]) {
                        guildConfig[protection].enabled = true;
                    }
                });
                guildConfig.enabled = true;
                config[guildId] = guildConfig;
                saveConfig(config);

                await interaction.deferUpdate();

                ensureLogChannel(interaction.guild, guildConfig, config, guildId).catch(() => {});

                await updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
                    await refreshAntiNukePanel(message, guildConfig);
                });
                return;
            }

            if (interaction.customId === 'antinuke_disable_all') {
                PROTECTION_KEYS.forEach(protection => {
                    if (guildConfig[protection]) {
                        guildConfig[protection].enabled = false;
                    }
                });
                guildConfig.enabled = false;
                config[guildId] = guildConfig;
                saveConfig(config);

                await interaction.deferUpdate();
                await updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
                    await refreshAntiNukePanel(message, guildConfig);
                });
                return;
            }

            if (interaction.customId === 'antinuke_toggle') {
                guildConfig.enabled = !guildConfig.enabled;
                config[guildId] = guildConfig;
                saveConfig(config);

                await interaction.deferUpdate();

                if (guildConfig.enabled) {
                    ensureLogChannel(interaction.guild, guildConfig, config, guildId).catch(() => {});
                }

                await updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
                    await refreshAntiNukePanel(message, guildConfig);
                });
                return;
            }

            if (interaction.customId === 'antinuke_settings') {
                const modal = new ModalBuilder()
                    .setCustomId('antinuke_modal_settings')
                    .setTitle('Anti-Nuke Limits & Time Windows');

                const banInput = new TextInputBuilder()
                    .setCustomId('ban_settings')
                    .setLabel('Ban: limit, time (seconds)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('3, 60')
                    .setValue(`${guildConfig.banProtection?.limit || 3}, ${(guildConfig.banProtection?.timeWindow || 60000) / 1000}`)
                    .setRequired(false);

                const kickInput = new TextInputBuilder()
                    .setCustomId('kick_settings')
                    .setLabel('Kick: limit, time (seconds)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('3, 60')
                    .setValue(`${guildConfig.kickProtection?.limit || 3}, ${(guildConfig.kickProtection?.timeWindow || 60000) / 1000}`)
                    .setRequired(false);

                const channelInput = new TextInputBuilder()
                    .setCustomId('channel_settings')
                    .setLabel('Channel Create/Delete: limit, time (sec)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('2, 60')
                    .setValue(`${guildConfig.channelDelete?.limit || 2}, ${(guildConfig.channelDelete?.timeWindow || 60000) / 1000}`)
                    .setRequired(false);

                const roleInput = new TextInputBuilder()
                    .setCustomId('role_settings')
                    .setLabel('Role Create/Delete: limit, time (sec)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('2, 60')
                    .setValue(`${guildConfig.roleDelete?.limit || 2}, ${(guildConfig.roleDelete?.timeWindow || 60000) / 1000}`)
                    .setRequired(false);

                const webhookInput = new TextInputBuilder()
                    .setCustomId('webhook_settings')
                    .setLabel('Webhook: limit, time (seconds)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('2, 60')
                    .setValue(`${guildConfig.webhookCreate?.limit || 2}, ${(guildConfig.webhookCreate?.timeWindow || 60000) / 1000}`)
                    .setRequired(false);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(banInput),
                    new ActionRowBuilder().addComponents(kickInput),
                    new ActionRowBuilder().addComponents(channelInput),
                    new ActionRowBuilder().addComponents(roleInput),
                    new ActionRowBuilder().addComponents(webhookInput)
                );
                return await interaction.showModal(modal);
            }

            if (interaction.customId === 'antinuke_whitelist') {
                const currentWhitelist = guildConfig.whitelistedUsers?.join(', ') || '';
                const modal = new ModalBuilder()
                    .setCustomId('antinuke_modal_whitelist')
                    .setTitle('Manage Whitelisted Users');

                const usersInput = new TextInputBuilder()
                    .setCustomId('whitelist_users')
                    .setLabel('User IDs (comma separated)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setPlaceholder('123456789, 987654321')
                    .setValue(currentWhitelist)
                    .setRequired(false);

                modal.addComponents(new ActionRowBuilder().addComponents(usersInput));
                return await interaction.showModal(modal);
            }

            if (interaction.customId === 'antinuke_logs') {
                const currentLog = guildConfig.logChannel ? `<#${guildConfig.logChannel}>` : '`None`';
                const row = new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId('antinuke_select_log_channel')
                        .setPlaceholder('Select the Anti-Nuke log channel')
                        .addChannelTypes(ChannelType.GuildText)
                        .setMinValues(1)
                        .setMaxValues(1)
                );
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `## <:Document:1521227875016114266> Set Anti-Nuke Log Channel\nCurrent: ${currentLog}\n\nSelect the channel where Anti-Nuke events will be logged.`
                    ))
                    .addActionRowComponents(row);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (interaction.customId === 'antinuke_bypass_role') {
                const currentBypass = guildConfig.bypassRoleId ? `<@&${guildConfig.bypassRoleId}>` : '`None`';
                const row = new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder()
                        .setCustomId('antinuke_select_bypass_role')
                        .setPlaceholder('Select the bypass role')
                        .setMinValues(1)
                        .setMaxValues(1)
                );
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `## <:Shield:1521227694677692467> Set Anti-Nuke Bypass Role\nCurrent: ${currentBypass}\n\nMembers with this role will bypass Anti-Nuke protection.`
                    ))
                    .addActionRowComponents(row);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (interaction.customId === 'antinuke_default') {
                const defaultConfig = getDefaultConfig();
                PROTECTION_KEYS.forEach(key => {
                    guildConfig[key] = { ...defaultConfig[key], enabled: true };
                });
                guildConfig.enabled = true;

                config[guildId] = guildConfig;
                saveConfig(config);

                await interaction.reply({ components: [buildSuccessResponse('Rules Reset', 'Anti-Nuke reset to default rules and enabled!')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

                ensureLogChannel(interaction.guild, guildConfig, config, guildId).catch(() => {});

                await updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
                    await refreshAntiNukePanel(message, guildConfig);
                });
                return;
            }

            if (interaction.customId === 'antinuke_power') {
                // Open the chooser so the admin can pick which advanced
                // protections to enable (each optional) instead of toggling
                // all three at once.
                return interaction.reply({
                    components: [buildPowerContainer(guildConfig)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }

            if (interaction.isStringSelectMenu() && interaction.customId === 'antinuke_power_select') {
                const sel = interaction.values || [];
                guildConfig.zeroTolerance = sel.includes('zeroTolerance');
                guildConfig.instantQuarantine = sel.includes('instantQuarantine');
                guildConfig.autoRestore = sel.includes('autoRestore');
                config[guildId] = guildConfig;
                saveConfig(config);
                await interaction.update({ components: [buildPowerContainer(guildConfig)], flags: MessageFlags.IsComponentsV2 });
                await updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
                    await refreshAntiNukePanel(message, guildConfig);
                });
                return;
            }

            if (interaction.customId === 'antinuke_power_all' || interaction.customId === 'antinuke_power_none') {
                const next = interaction.customId === 'antinuke_power_all';
                guildConfig.zeroTolerance = next;
                guildConfig.instantQuarantine = next;
                guildConfig.autoRestore = next;
                config[guildId] = guildConfig;
                saveConfig(config);
                await interaction.update({ components: [buildPowerContainer(guildConfig)], flags: MessageFlags.IsComponentsV2 });
                await updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
                    await refreshAntiNukePanel(message, guildConfig);
                });
                return;
            }

            if (interaction.isChannelSelectMenu() && interaction.customId === 'antinuke_select_log_channel') {
                const channelId = interaction.values[0];
                const channel = interaction.guild.channels.cache.get(channelId);
                if (!channel) {
                    return interaction.reply({ components: [buildErrorResponse('Invalid Channel', 'The selected channel was not found.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                }
                guildConfig.logChannel = channelId;
                config[guildId] = guildConfig;
                saveConfig(config);
                await interaction.reply({ components: [buildSuccessResponse('Log Channel Set', `Anti-Nuke logs will be sent to ${channel}.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                await updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
                    await refreshAntiNukePanel(message, guildConfig);
                });
                return;
            }

            if (interaction.isRoleSelectMenu() && interaction.customId === 'antinuke_select_bypass_role') {
                const roleId = interaction.values[0];
                const role = interaction.guild.roles.cache.get(roleId);
                if (!role) {
                    return interaction.reply({ components: [buildErrorResponse('Invalid Role', 'The selected role was not found.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                }
                guildConfig.bypassRoleId = roleId;
                config[guildId] = guildConfig;
                saveConfig(config);
                await interaction.reply({ components: [buildSuccessResponse('Bypass Role Set', `Anti-Nuke bypass role set to ${role}.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                await updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
                    await refreshAntiNukePanel(message, guildConfig);
                });
                return;
            }
        } catch (error) {
            console.error('Anti-Nuke Button Error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ components: [buildErrorResponse('Error', 'An error occurred while processing the button.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    },

    async handleModal(interaction) {
        if (!interaction.isModalSubmit()) return;

        const config = loadConfig();
        const guildId = interaction.guild.id;
        const guildConfig = config[guildId];

        if (!guildConfig) {
            return interaction.reply({ components: [buildErrorResponse('Not Configured', 'Anti-Nuke config not found.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (interaction.customId === 'antinuke_modal_whitelist') {
            const usersInput = interaction.fields.getTextInputValue('whitelist_users');
            const userIds = usersInput ? usersInput.split(',').map(id => id.trim()).filter(id => id && /^\d{17,19}$/.test(id)) : [];

            guildConfig.whitelistedUsers = userIds;
            config[guildId] = guildConfig;
            saveConfig(config);

            await interaction.reply({
                components: [buildSuccessResponse('Whitelist Updated', `${userIds.length} user(s) whitelisted successfully.`)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });

            const { updatePanel } = require('../../utils/panelRegistry');
            await updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
                await refreshAntiNukePanel(message, guildConfig);
            });
        }

        if (interaction.customId === 'antinuke_modal_settings') {
            function parseLimitTime(input, defaultLimit, defaultTime) {
                if (!input || !input.trim()) return { limit: defaultLimit, timeWindow: defaultTime };
                const parts = input.split(',').map(s => s.trim());
                const limit = Math.max(1, Math.min(20, parseInt(parts[0]) || defaultLimit));
                const timeSec = parts.length > 1 ? Math.max(10, Math.min(300, parseInt(parts[1]) || (defaultTime / 1000))) : (defaultTime / 1000);
                return { limit, timeWindow: timeSec * 1000 };
            }

            const banParsed = parseLimitTime(interaction.fields.getTextInputValue('ban_settings'), 3, 60000);
            const kickParsed = parseLimitTime(interaction.fields.getTextInputValue('kick_settings'), 3, 60000);
            const channelParsed = parseLimitTime(interaction.fields.getTextInputValue('channel_settings'), 2, 60000);
            const roleParsed = parseLimitTime(interaction.fields.getTextInputValue('role_settings'), 2, 60000);
            const webhookParsed = parseLimitTime(interaction.fields.getTextInputValue('webhook_settings'), 2, 60000);

            if (guildConfig.banProtection) { guildConfig.banProtection.limit = banParsed.limit; guildConfig.banProtection.timeWindow = banParsed.timeWindow; }
            if (guildConfig.kickProtection) { guildConfig.kickProtection.limit = kickParsed.limit; guildConfig.kickProtection.timeWindow = kickParsed.timeWindow; }
            if (guildConfig.channelDelete) { guildConfig.channelDelete.limit = channelParsed.limit; guildConfig.channelDelete.timeWindow = channelParsed.timeWindow; }
            if (guildConfig.channelCreate) { guildConfig.channelCreate.limit = channelParsed.limit; guildConfig.channelCreate.timeWindow = channelParsed.timeWindow; }
            if (guildConfig.roleDelete) { guildConfig.roleDelete.limit = roleParsed.limit; guildConfig.roleDelete.timeWindow = roleParsed.timeWindow; }
            if (guildConfig.roleCreate) { guildConfig.roleCreate.limit = roleParsed.limit; guildConfig.roleCreate.timeWindow = roleParsed.timeWindow; }
            if (guildConfig.webhookCreate) { guildConfig.webhookCreate.limit = webhookParsed.limit; guildConfig.webhookCreate.timeWindow = webhookParsed.timeWindow; }

            config[guildId] = guildConfig;
            saveConfig(config);

            const summary =
                `**Ban:** \`${banParsed.limit}/${banParsed.timeWindow / 1000}s\` • ` +
                `**Kick:** \`${kickParsed.limit}/${kickParsed.timeWindow / 1000}s\` • ` +
                `**Channel:** \`${channelParsed.limit}/${channelParsed.timeWindow / 1000}s\`\n` +
                `**Role:** \`${roleParsed.limit}/${roleParsed.timeWindow / 1000}s\` • ` +
                `**Webhook:** \`${webhookParsed.limit}/${webhookParsed.timeWindow / 1000}s\``;

            await interaction.reply({
                components: [buildSuccessResponse('Limits & Time Updated', summary)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });

            const { updatePanel } = require('../../utils/panelRegistry');
            await updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
                await refreshAntiNukePanel(message, guildConfig);
            });
        }
    }
};
