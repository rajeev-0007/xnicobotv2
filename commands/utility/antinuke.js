'use strict';

/**
 * /antinuke — anti-nuke configuration panel.
 *
 * The UI is entirely select-menu driven (see utils/panels/antinukePanel.js for
 * the design rules and the custom-ID scheme). This file only routes those IDs
 * onto config mutations.
 *
 * Multi-selects use "selection IS the state" semantics: the submitted values
 * are the complete desired set, so handlers assign rather than toggle. The old
 * toggle-on-select behaviour meant re-opening a panel and re-picking an
 * already-enabled module silently turned it OFF.
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ChannelType,
    OverwriteType,
    ContainerBuilder,
    TextDisplayBuilder,
} = require('discord.js');

const {
    loadConfig,
    saveConfig,
    getGuildConfig,
    getDefaultConfig,
    buildAntiNukePanel,
    buildModulePanel,
    buildLogChannelPicker,
    buildBypassRolePicker,
    refreshAntiNukePanel,
    PROTECTION_KEYS,
    PROTECTION_LABELS,
    PUNISHMENT_LABELS,
    AVAILABLE_PUNISHMENTS,
    LIMIT_CHOICES,
    WINDOW_CHOICES,
    POWER_FLAGS,
    formatTimeWindow,
} = require('../../utils/panels/antinukePanel');
const { withDefaults, isValidActionFor } = require('../../utils/antinukeSchema');
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

/**
 * Custom IDs from the previous button-based panel. Panels already posted in
 * servers keep those components (Discord stores them on the message), so
 * without this every stale panel would silently do nothing.
 */
const LEGACY_IDS = new Set([
    'antinuke_toggle', 'antinuke_enable_all', 'antinuke_disable_all',
    'antinuke_protection_select', 'antinuke_action_select',
    'antinuke_settings', 'antinuke_whitelist', 'antinuke_logs',
    'antinuke_bypass_role', 'antinuke_default', 'antinuke_power',
    'antinuke_power_select', 'antinuke_power_all', 'antinuke_power_none',
    'antinuke_select_log_channel', 'antinuke_select_bypass_role',
    'antinuke_modal_settings',
]);

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
            return;
        }

        const botMember = guild.members.me;
        if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) return;

        const logChannel = await guild.channels.create({
            name: 'antinuke-logs',
            type: ChannelType.GuildText,
            topic: 'Anti-Nuke protection logs — automated by xNico',
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel], type: OverwriteType.Role },
                { id: botMember.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], type: OverwriteType.Member },
                { id: guild.ownerId, allow: [PermissionFlagsBits.ViewChannel], type: OverwriteType.Member },
            ],
            reason: 'Anti-Nuke: Auto-created log channel',
        });

        guildConfig.logChannel = logChannel.id;
        config[guildId] = guildConfig;
        saveConfig(config);
    } catch (err) {
        console.error('Failed to create antinuke log channel:', err.message);
    } finally {
        // Previously released on some paths only, so an early return left the
        // guild permanently locked out of log-channel creation.
        _logChannelLocks.delete(guildId);
    }
}

/** Parse `antinuke:mod:<field>:<key>`. */
function parseModuleId(customId) {
    const parts = String(customId).split(':');
    if (parts.length !== 4 || parts[0] !== 'antinuke' || parts[1] !== 'mod') return null;
    const [, , field, key] = parts;
    if (!PROTECTION_KEYS.includes(key)) return null;
    return { field, key };
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
        if (!config[guildId]) { config[guildId] = getDefaultConfig(); saveConfig(config); }

        const container = buildAntiNukePanel(config[guildId]);
        const reply = await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, fetchReply: true });
        registerPanel(guildId, 'antinuke', interaction.channel.id, reply.id);
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ components: [buildPermissionDenied('Administrator')], flags: MessageFlags.IsComponentsV2 });
        }

        const config = loadConfig();
        const guildId = message.guild.id;
        if (!config[guildId]) { config[guildId] = getDefaultConfig(); saveConfig(config); }

        try {
            const reply = await message.reply({
                components: [buildAntiNukePanel(config[guildId])],
                flags: MessageFlags.IsComponentsV2,
            });
            registerPanel(guildId, 'antinuke', message.channel.id, reply.id);
        } catch (error) {
            console.error('Error sending antinuke panel:', error);
            await message.reply({
                components: [buildErrorResponse('Panel Error', 'There was an error displaying the anti-nuke panel. Please try again.')],
                flags: MessageFlags.IsComponentsV2,
            });
        }
    },

    /**
     * @returns {Promise<boolean>} true when the interaction was consumed
     */
    async handleInteraction(interaction) {
        const customId = interaction.customId || '';
        if (!customId.startsWith('antinuke')) return false;
        if (!interaction.guild || !interaction.member) return false;

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)
            && !interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({
                components: [buildPermissionDenied('Administrator or Manage Guild')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
            return true;
        }

        // Panel session expiry. This used to run inside
        // interactionHandlers.handleAntiNukeButtons, which sat in front of this
        // handler; now that index.js routes here first, the check has to live
        // here or stale panels would silently keep working.
        try {
            const { checkAndExpire } = require('../../utils/panelExpiration');
            if (await checkAndExpire(interaction, 'config')) return true;
        } catch { /* expiry is a nicety — never block a config change on it */ }

        // Stale panel from the old button layout.
        if (LEGACY_IDS.has(customId)) {
            await interaction.reply({
                components: [buildErrorResponse(
                    'Panel Outdated',
                    'This anti-nuke panel was created by an older version of the bot.',
                    'Run `/antinuke` again to open the current panel.'
                )],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            }).catch(() => { });
            return true;
        }

        const config = loadConfig();
        const guildId = interaction.guild.id;
        // Normalized so protections added since this guild last saved (e.g.
        // channelUpdate/roleUpdate) are present rather than undefined.
        const guildConfig = withDefaults(config[guildId]);
        config[guildId] = guildConfig;

        const { updatePanel } = require('../../utils/panelRegistry');
        const persist = () => { config[guildId] = guildConfig; saveConfig(config); };
        const syncPanel = () => updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
            await refreshAntiNukePanel(message, guildConfig);
        }).catch(() => { });

        try {
            /* ── main: which protections are enabled ── */
            if (customId === 'antinuke:modules') {
                const selected = new Set(interaction.values || []);
                for (const key of PROTECTION_KEYS) {
                    guildConfig[key].enabled = selected.has(key);
                }
                persist();
                await interaction.update({ components: [buildAntiNukePanel(guildConfig)], flags: MessageFlags.IsComponentsV2 });
                if (selected.size > 0 && guildConfig.enabled) {
                    ensureLogChannel(interaction.guild, guildConfig, config, guildId).catch(() => { });
                }
                return true;
            }

            /* ── main: response mode flags ── */
            if (customId === 'antinuke:power') {
                const selected = new Set(interaction.values || []);
                for (const f of POWER_FLAGS) guildConfig[f.key] = selected.has(f.key);
                persist();
                await interaction.update({ components: [buildAntiNukePanel(guildConfig)], flags: MessageFlags.IsComponentsV2 });
                return true;
            }

            /* ── main: open a module sub-panel ── */
            if (customId === 'antinuke:configure') {
                const key = interaction.values?.[0];
                const panel = buildModulePanel(guildConfig, key);
                if (!panel) {
                    await interaction.reply({
                        components: [buildErrorResponse('Unknown Protection', 'That protection no longer exists.')],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    });
                    return true;
                }
                await interaction.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            /* ── main: system actions ── */
            if (customId === 'antinuke:system') {
                const choice = interaction.values?.[0];

                if (choice === 'arm') {
                    guildConfig.enabled = !guildConfig.enabled;
                    persist();
                    await interaction.update({ components: [buildAntiNukePanel(guildConfig)], flags: MessageFlags.IsComponentsV2 });
                    if (guildConfig.enabled) {
                        ensureLogChannel(interaction.guild, guildConfig, config, guildId).catch(() => { });
                    }
                    return true;
                }

                if (choice === 'logchannel') {
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `### Log channel\nCurrently ${guildConfig.logChannel ? `<#${guildConfig.logChannel}>` : '`not set`'}.`
                        ))
                        .addActionRowComponents(buildLogChannelPicker());
                    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    return true;
                }

                if (choice === 'bypassrole') {
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `### Bypass role\nCurrently ${guildConfig.bypassRoleId ? `<@&${guildConfig.bypassRoleId}>` : '`none`'}.\nMembers with this role are exempt from anti-nuke.`
                        ))
                        .addActionRowComponents(buildBypassRolePicker());
                    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    return true;
                }

                if (choice === 'whitelist') {
                    const modal = new ModalBuilder()
                        .setCustomId('antinuke:modal:whitelist')
                        .setTitle('Whitelisted users')
                        .addComponents(new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('whitelist_users')
                                .setLabel('User IDs (comma separated)')
                                .setStyle(TextInputStyle.Paragraph)
                                .setPlaceholder('123456789012345678, 987654321098765432')
                                .setValue((guildConfig.whitelistedUsers || []).join(', '))
                                .setRequired(false)
                        ));
                    await interaction.showModal(modal);
                    return true;
                }

                if (choice === 'reset') {
                    const defaults = getDefaultConfig();
                    for (const key of PROTECTION_KEYS) guildConfig[key] = { ...defaults[key] };
                    for (const f of POWER_FLAGS) guildConfig[f.key] = defaults[f.key];
                    persist();
                    await interaction.update({ components: [buildAntiNukePanel(guildConfig)], flags: MessageFlags.IsComponentsV2 });
                    return true;
                }

                return true;
            }

            /* ── module sub-panel ── */
            const mod = parseModuleId(customId);
            if (mod) {
                const { field, key } = mod;
                const target = guildConfig[key];

                if (field === 'action') {
                    const action = interaction.values?.[0];
                    // Guard rather than trusting the payload: a stale panel could
                    // submit a punishment the engine ignores for this module,
                    // which would silently save as "does nothing".
                    if (!isValidActionFor(key, action)) {
                        await interaction.reply({
                            components: [buildErrorResponse('Invalid Response', `\`${action}\` is not a valid response for ${PROTECTION_LABELS[key]}.`)],
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                        });
                        return true;
                    }
                    target.action = action;
                } else if (field === 'limit') {
                    const n = parseInt(interaction.values?.[0], 10);
                    if (!LIMIT_CHOICES.includes(n)) return true;
                    target.limit = n;
                } else if (field === 'window') {
                    const ms = parseInt(interaction.values?.[0], 10);
                    if (!WINDOW_CHOICES.includes(ms)) return true;
                    target.timeWindow = ms;
                } else if (field === 'flags') {
                    const selected = new Set(interaction.values || []);
                    // Only assign flags this protection actually defines.
                    if ('permissionsOnly' in target || selected.has('permissionsOnly')) {
                        target.permissionsOnly = selected.has('permissionsOnly');
                    }
                    if ('escalationInstant' in target || selected.has('escalationInstant')) {
                        target.escalationInstant = selected.has('escalationInstant');
                    }
                } else if (field === 'nav') {
                    const choice = interaction.values?.[0];
                    if (choice === 'toggle') {
                        target.enabled = !target.enabled;
                    } else if (choice === 'reset') {
                        target.enabled = getDefaultConfig()[key].enabled;
                        Object.assign(target, getDefaultConfig()[key]);
                    } else if (choice === 'back') {
                        await interaction.update({ components: [buildAntiNukePanel(guildConfig)], flags: MessageFlags.IsComponentsV2 });
                        return true;
                    }
                } else {
                    return true;
                }

                persist();
                await interaction.update({ components: [buildModulePanel(guildConfig, key)], flags: MessageFlags.IsComponentsV2 });
                syncPanel();
                return true;
            }

            /* ── pickers ── */
            if (customId === 'antinuke:pick:logchannel') {
                const channelId = interaction.values?.[0];
                const channel = interaction.guild.channels.cache.get(channelId);
                if (!channel) {
                    await interaction.reply({
                        components: [buildErrorResponse('Invalid Channel', 'The selected channel was not found.')],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    });
                    return true;
                }
                guildConfig.logChannel = channelId;
                persist();
                await interaction.update({
                    components: [buildSuccessResponse('Log Channel Set', `Anti-nuke events will be logged to ${channel}.`)],
                    flags: MessageFlags.IsComponentsV2,
                });
                syncPanel();
                return true;
            }

            if (customId === 'antinuke:pick:bypassrole') {
                const roleId = interaction.values?.[0];
                const role = interaction.guild.roles.cache.get(roleId);
                if (!role) {
                    await interaction.reply({
                        components: [buildErrorResponse('Invalid Role', 'The selected role was not found.')],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    });
                    return true;
                }
                guildConfig.bypassRoleId = roleId;
                persist();
                await interaction.update({
                    components: [buildSuccessResponse('Bypass Role Set', `${role} is now exempt from anti-nuke.`)],
                    flags: MessageFlags.IsComponentsV2,
                });
                syncPanel();
                return true;
            }

            return false;
        } catch (error) {
            console.error('Anti-Nuke interaction error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    components: [buildErrorResponse('Error', 'An error occurred while updating anti-nuke.')],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                }).catch(() => { });
            }
            return true;
        }
    },

    async handleModal(interaction) {
        if (!interaction.isModalSubmit()) return false;
        const customId = interaction.customId || '';

        if (customId === 'antinuke_modal_settings' || customId === 'antinuke_modal_whitelist') {
            // Legacy modals. The limits modal is gone entirely — thresholds and
            // windows are select menus on each module's sub-panel now.
            await interaction.reply({
                components: [buildErrorResponse(
                    'Panel Outdated',
                    'This form came from an older version of the bot.',
                    'Run `/antinuke` again to open the current panel.'
                )],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            }).catch(() => { });
            return true;
        }

        if (customId !== 'antinuke:modal:whitelist') return false;

        const config = loadConfig();
        const guildId = interaction.guild.id;
        const guildConfig = withDefaults(config[guildId]);

        const raw = interaction.fields.getTextInputValue('whitelist_users') || '';
        const ids = raw
            .split(',')
            .map(s => s.trim())
            .filter(s => /^\d{17,20}$/.test(s));
        // De-duplicate so the same id can't be listed twice.
        guildConfig.whitelistedUsers = [...new Set(ids)];

        config[guildId] = guildConfig;
        saveConfig(config);

        await interaction.reply({
            components: [buildSuccessResponse(
                'Whitelist Updated',
                guildConfig.whitelistedUsers.length === 0
                    ? 'The whitelist is now empty.'
                    : `${guildConfig.whitelistedUsers.length} user(s) are exempt from anti-nuke.`
            )],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });

        const { updatePanel } = require('../../utils/panelRegistry');
        await updatePanel(interaction.client, guildId, 'antinuke', async (message) => {
            await refreshAntiNukePanel(message, guildConfig);
        }).catch(() => { });
        return true;
    },
};
