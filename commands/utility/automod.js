'use strict';

/**
 * /automod — AutoMod configuration panel.
 *
 * The UI is entirely select-menu driven (see utils/panels/automodPanel.js for
 * the design rules and the custom-ID scheme). This file only routes those IDs
 * onto config mutations.
 *
 * Multi-selects use "selection IS the state": the submitted values are the
 * complete desired set, so handlers assign rather than toggle.
 */

const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
} = require('discord.js');

const {
    loadConfig,
    saveConfig,
    getGuildConfig,
    getDefaultConfig,
    buildAutomodPanel,
    buildFilterPanel,
    buildLogChannelPicker,
    buildBypassRolePicker,
    buildIgnoreChannelsPicker,
    buildIgnoreRolesPicker,
} = require('../../utils/panels/automodPanel');
const schema = require('../../utils/automodSchema');
const { buildPermissionDenied, buildErrorResponse, buildSuccessResponse } = require('../../utils/responseBuilder');
const { registerPanel, updatePanel } = require('../../utils/panelRegistry');

const {
    FILTERS, FILTER_KEYS, FILTER_LABELS, FIELDS, CHOICES,
    withDefaults, isValidAction, parseList,
} = schema;

/**
 * Custom IDs from the previous button-based panel. Panels already posted in
 * servers keep those components, so without this every stale panel would
 * silently do nothing when clicked.
 */
const LEGACY_IDS = new Set([
    'automod_toggle', 'automod_enable_all', 'automod_default', 'automod_status',
    'automod_logs', 'automod_bypass_role', 'automod_settings', 'automod_ignore_channels',
    'automod_toggle_filters', 'automod_configure_filter',
    'automod_select_log_channel', 'automod_select_ignore_channels',
    'automod_select_bypass_role', 'automod_select_ignore_roles',
]);
const LEGACY_MODAL_PREFIX = 'automod_modal_';

function outdatedNotice(interaction) {
    return interaction.reply({
        components: [buildErrorResponse(
            'Panel Outdated',
            'This AutoMod panel was created by an older version of the bot.',
            'Run `/automod` again to open the current panel.'
        )],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    }).catch(() => { });
}

/** Parse `automod:f:<field>:<key>` / `automod:f:set:<field>:<key>`. */
function parseFilterId(customId) {
    const parts = String(customId).split(':');
    if (parts[0] !== 'automod' || parts[1] !== 'f') return null;

    if (parts[2] === 'set' && parts.length === 5) {
        const [, , , field, key] = parts;
        if (!FILTER_KEYS.includes(key)) return null;
        return { op: 'set', field, key };
    }
    if (parts.length === 4) {
        const [, , op, key] = parts;
        if (!FILTER_KEYS.includes(key)) return null;
        return { op, key };
    }
    return null;
}

/** Re-render the persistent panel message in the channel. */
function syncPanel(interaction, guildId) {
    return updatePanel(interaction.client, guildId, 'automod', async (message) => {
        // Editing a Components V2 message REQUIRES the IsComponentsV2 flag —
        // omitting it makes discord.js throw "Received one or more errors".
        await message.edit({
            components: [buildAutomodPanel(getGuildConfig(guildId))],
            flags: MessageFlags.IsComponentsV2,
        });
    }).catch(() => { });
}

/** Push the config to Discord's native AutoMod rules in the background. */
function syncToDiscord(interaction, guildConfig) {
    try {
        const { syncToDiscord: push, removeAllBotRules } = require('../../utils/automodSync');
        const guild = interaction.guild;
        if (!guild) return;
        if (guildConfig.enabled) {
            push(guild, guildConfig).catch(() => { });
        } else {
            removeAllBotRules(guild).catch(() => { });
        }
    } catch { /* native sync is best-effort; bot-side filters still run */ }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('Configure automatic moderation system')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction) {
        const guildId = interaction.guild.id;
        const container = buildAutomodPanel(getGuildConfig(guildId));
        const reply = await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2, fetchReply: true });
        registerPanel(guildId, 'automod', interaction.channel.id, reply.id);
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [buildPermissionDenied('Manage Guild')], flags: MessageFlags.IsComponentsV2 });
        }
        const guildId = message.guild.id;
        const container = buildAutomodPanel(getGuildConfig(guildId));
        const reply = await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        registerPanel(guildId, 'automod', message.channel.id, reply.id);
    },

    /**
     * @returns {Promise<boolean>} true when the interaction was consumed
     */
    async handleInteraction(interaction) {
        const id = interaction.customId || '';
        if (!id.startsWith('automod')) return false;
        if (!interaction.guild || !interaction.member) return false;

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({
                components: [buildPermissionDenied('Manage Guild')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
            return true;
        }

        // Panel session expiry — owned here now that index.js routes to this
        // handler before interactionHandlers.
        try {
            const { checkAndExpire } = require('../../utils/panelExpiration');
            if (await checkAndExpire(interaction, 'config')) return true;
        } catch { /* expiry is a nicety, never block a config change on it */ }

        if (LEGACY_IDS.has(id)) {
            await outdatedNotice(interaction);
            return true;
        }

        const guildId = interaction.guild.id;
        const config = loadConfig();
        // Normalized so filters added since this guild last saved are present
        // rather than undefined.
        const guildConfig = withDefaults(config[guildId]);
        config[guildId] = guildConfig;

        const persist = () => {
            config[guildId] = guildConfig;
            saveConfig(config, guildId);
        };

        try {
            /* ── main: which filters are enabled ── */
            if (id === 'automod:filters') {
                const selected = new Set(interaction.values || []);
                for (const key of FILTER_KEYS) {
                    guildConfig[key].enabled = selected.has(key);
                }
                persist();
                await interaction.update({ components: [buildAutomodPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 });
                syncToDiscord(interaction, guildConfig);
                return true;
            }

            /* ── main: open a filter sub-panel ── */
            if (id === 'automod:configure') {
                const key = interaction.values?.[0];
                const panel = buildFilterPanel(guildConfig, key);
                if (!panel) {
                    await interaction.reply({
                        components: [buildErrorResponse('Unknown Filter', 'That filter no longer exists.')],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    });
                    return true;
                }
                await interaction.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                return true;
            }

            /* ── main: system actions ── */
            if (id === 'automod:system') {
                const choice = interaction.values?.[0];

                if (choice === 'toggle') {
                    guildConfig.enabled = !guildConfig.enabled;
                    persist();
                    await interaction.update({ components: [buildAutomodPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 });
                    syncToDiscord(interaction, guildConfig);
                    return true;
                }

                const pickers = {
                    logchannel: { picker: buildLogChannelPicker, title: 'Log channel', current: () => (guildConfig.logChannel ? `<#${guildConfig.logChannel}>` : '`not set`') },
                    bypassrole: { picker: buildBypassRolePicker, title: 'Bypass role', current: () => (guildConfig.bypassRoleId ? `<@&${guildConfig.bypassRoleId}>` : '`none`') },
                    ignorechannels: { picker: buildIgnoreChannelsPicker, title: 'Ignored channels', current: () => `${guildConfig.ignoredChannels.length} selected` },
                    ignoreroles: { picker: buildIgnoreRolesPicker, title: 'Ignored roles', current: () => `${guildConfig.ignoredRoles.length} selected` },
                };
                if (pickers[choice]) {
                    const { picker, title, current } = pickers[choice];
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}\nCurrently ${current()}.`))
                        .addActionRowComponents(picker());
                    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    return true;
                }

                if (choice === 'reset') {
                    const defaults = getDefaultConfig();
                    for (const key of FILTER_KEYS) guildConfig[key] = { ...defaults[key] };
                    persist();
                    await interaction.update({ components: [buildAutomodPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 });
                    syncToDiscord(interaction, guildConfig);
                    return true;
                }

                return true;
            }

            /* ── filter sub-panel ── */
            const parsed = parseFilterId(id);
            if (parsed) {
                const { op, key, field } = parsed;
                const target = guildConfig[key];

                if (op === 'action') {
                    const action = interaction.values?.[0];
                    // Guard rather than trusting the payload: a stale panel could
                    // submit an action the enforcement layer ignores.
                    if (!isValidAction(action)) {
                        await interaction.reply({
                            components: [buildErrorResponse('Invalid Action', `\`${action}\` is not a valid AutoMod action.`)],
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                        });
                        return true;
                    }
                    target.action = action;
                } else if (op === 'set') {
                    const meta = FIELDS[field];
                    if (!meta || meta.kind !== 'choice' || !FILTERS[key].fields.includes(field)) return true;
                    const allowed = CHOICES[meta.choices];
                    const raw = interaction.values?.[0];
                    // Numeric choices are stored as numbers; minSeverity is a string.
                    const value = typeof allowed[0] === 'number' ? parseInt(raw, 10) : raw;
                    if (!allowed.some(v => String(v) === String(value))) return true;
                    target[field] = value;
                } else if (op === 'nav') {
                    const choice = interaction.values?.[0] || '';

                    if (choice === 'toggle') {
                        target.enabled = !target.enabled;
                    } else if (choice === 'reset') {
                        Object.assign(target, { ...FILTERS[key].defaults });
                    } else if (choice === 'back') {
                        await interaction.update({ components: [buildAutomodPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 });
                        return true;
                    } else if (choice.startsWith('list:')) {
                        const listField = choice.slice(5);
                        const meta = FIELDS[listField];
                        if (!meta || meta.kind !== 'list' || !FILTERS[key].fields.includes(listField)) return true;
                        const modal = new ModalBuilder()
                            .setCustomId(`automod:modal:list:${key}:${listField}`)
                            .setTitle(`${FILTER_LABELS[key]} — ${meta.label}`.slice(0, 45))
                            .addComponents(new ActionRowBuilder().addComponents(
                                new TextInputBuilder()
                                    .setCustomId('value')
                                    .setLabel(meta.label.slice(0, 45))
                                    .setStyle(TextInputStyle.Paragraph)
                                    .setPlaceholder(meta.placeholder)
                                    .setValue((target[listField] || []).join(', '))
                                    .setRequired(false)
                            ));
                        await interaction.showModal(modal);
                        return true;
                    } else {
                        return true;
                    }
                } else {
                    return true;
                }

                persist();
                await interaction.update({ components: [buildFilterPanel(guildConfig, key)], flags: MessageFlags.IsComponentsV2 });
                syncPanel(interaction, guildId);
                syncToDiscord(interaction, guildConfig);
                return true;
            }

            /* ── pickers ── */
            if (id === 'automod:pick:logchannel') {
                guildConfig.logChannel = interaction.values?.[0] || null;
                persist();
                await interaction.update({
                    components: [buildSuccessResponse('Log Channel Set', `AutoMod events will be logged to <#${guildConfig.logChannel}>.`)],
                    flags: MessageFlags.IsComponentsV2,
                });
                syncPanel(interaction, guildId);
                syncToDiscord(interaction, guildConfig);
                return true;
            }

            if (id === 'automod:pick:bypassrole') {
                guildConfig.bypassRoleId = interaction.values?.[0] || null;
                persist();
                await interaction.update({
                    components: [buildSuccessResponse('Bypass Role Set', `<@&${guildConfig.bypassRoleId}> is now exempt from AutoMod.`)],
                    flags: MessageFlags.IsComponentsV2,
                });
                syncPanel(interaction, guildId);
                return true;
            }

            if (id === 'automod:pick:ignorechannels') {
                guildConfig.ignoredChannels = [...(interaction.values || [])];
                persist();
                await interaction.update({
                    components: [buildSuccessResponse(
                        'Ignored Channels Updated',
                        guildConfig.ignoredChannels.length === 0
                            ? 'AutoMod now applies to every channel.'
                            : `${guildConfig.ignoredChannels.length} channel(s) are exempt from AutoMod.`
                    )],
                    flags: MessageFlags.IsComponentsV2,
                });
                syncPanel(interaction, guildId);
                return true;
            }

            if (id === 'automod:pick:ignoreroles') {
                guildConfig.ignoredRoles = [...(interaction.values || [])];
                persist();
                await interaction.update({
                    components: [buildSuccessResponse(
                        'Ignored Roles Updated',
                        guildConfig.ignoredRoles.length === 0
                            ? 'AutoMod now applies to every member.'
                            : `${guildConfig.ignoredRoles.length} role(s) are exempt from AutoMod.`
                    )],
                    flags: MessageFlags.IsComponentsV2,
                });
                syncPanel(interaction, guildId);
                return true;
            }

            return false;
        } catch (error) {
            console.error('AutoMod interaction error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    components: [buildErrorResponse('Error', 'An error occurred while updating AutoMod.')],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                }).catch(() => { });
            }
            return true;
        }
    },

    async handleModal(interaction) {
        const id = interaction.customId || '';

        if (id.startsWith(LEGACY_MODAL_PREFIX)) {
            await outdatedNotice(interaction);
            return true;
        }
        if (!id.startsWith('automod:modal:list:')) return false;

        const [, , , key, field] = id.split(':');
        if (!FILTER_KEYS.includes(key) || !FILTERS[key].fields.includes(field)) return false;
        if (FIELDS[field]?.kind !== 'list') return false;

        const guildId = interaction.guild.id;
        const config = loadConfig();
        const guildConfig = withDefaults(config[guildId]);

        guildConfig[key][field] = parseList(interaction.fields.getTextInputValue('value'));
        config[guildId] = guildConfig;
        saveConfig(config, guildId);

        const count = guildConfig[key][field].length;
        await interaction.reply({
            components: [buildSuccessResponse(
                `${FILTER_LABELS[key]} Updated`,
                count === 0
                    ? `The ${FIELDS[field].label.toLowerCase()} is now empty.`
                    : `${count} entr${count === 1 ? 'y' : 'ies'} saved.`
            )],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });

        syncPanel(interaction, guildId);
        syncToDiscord(interaction, guildConfig);
        return true;
    },
};
