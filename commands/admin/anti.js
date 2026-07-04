const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    MessageFlags,
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { loadConfig, saveConfig, getDefaultConfig } = require('../../utils/panels/antinukePanel');
const { checkAndExpire } = require('../../utils/panelExpiration');
const { buildErrorResponse } = require('../../utils/responseBuilder');
const { THEME, formatCheck, createFooterText } = require('../../utils/theme');
const { ACTIONS_FOR, isValidActionFor, commonActions, v2InvalidReply } = require('../../utils/securityUI');
const trust = require('../../utils/trustManager');

// --- Protection category metadata ---
const CATEGORIES = {
    ban:            { key: 'banProtection',  label: 'Ban Protection',     emoji: '<:banhammer:1521227777083314529>', hasLimit: true, defaultLimit: 3, defaultAction: 'remove_roles' },
    kick:           { key: 'kickProtection', label: 'Kick Protection',    emoji: '<:Userblock:1521227822641975366>', hasLimit: true, defaultLimit: 3, defaultAction: 'remove_roles' },
    channel_delete: { key: 'channelDelete',  label: 'Channel Delete',     emoji: '<:Trash:1521227750420254820>', hasLimit: true, defaultLimit: 2, defaultAction: 'remove_roles' },
    channel_create: { key: 'channelCreate',  label: 'Channel Create',     emoji: '<:Add:1521227828199293152>', hasLimit: true, defaultLimit: 3, defaultAction: 'remove_roles' },
    role_delete:    { key: 'roleDelete',     label: 'Role Delete',        emoji: '<:Userplus:1521227719621218477>', hasLimit: true, defaultLimit: 2, defaultAction: 'remove_roles' },
    role_create:    { key: 'roleCreate',     label: 'Role Create',        emoji: '<:Userplus:1521227719621218477>', hasLimit: true, defaultLimit: 3, defaultAction: 'remove_roles' },
    webhook:        { key: 'webhookCreate',  label: 'Webhook Protection', emoji: '<:Bookmark:1521227835526742066>', hasLimit: true, defaultLimit: 2, defaultAction: 'remove_roles' },
    bot_add:        { key: 'botAdd',         label: 'Bot Add Protection', emoji: '<:bots:1521227848101396610>', hasLimit: false, defaultAction: 'kick_bot' }
};

const VALID_ACTIONS = ['remove_roles', 'kick', 'ban', 'kick_bot', 'kick_both', 'ban_bot', 'timeout']; // exhaustive set; per-module validation uses ACTIONS_FOR
const LIMIT_MIN = 1;
const LIMIT_MAX = 10;
const WINDOW_MIN = 10;
const WINDOW_MAX = 300;

// --------------- Panel builder ---------------
function buildAntiPanel(guildConfig, guildName) {
    const enabledCount = Object.values(CATEGORIES).filter(c => guildConfig[c.key]?.enabled).length;
    const threatActive = guildConfig.threatMode || guildConfig.superThreatMode;

    const headerText = `# <:Shield:1521227694677692467> Anti-Nuke Limits\n-# Set protection limits manually for ${guildName}`;

    let statusText = guildConfig.enabled
        ? `${THEME.EMOJIS.SUCCESS} **System Active** — \`${enabledCount}/8\` protections enabled`
        : `${THEME.EMOJIS.OFFLINE} **System Inactive** — Enable antinuke first`;

    if (threatActive) {
        const mode = guildConfig.superThreatMode ? 'Super Threat' : 'Threat';
        statusText += `\n<:Infotriangle:1521227710381428926> **${mode} Mode** is active — limits are overridden. Disable it first to edit manually.`;
    }

    let limitsGrid = '### <:Lightningalt:1521227851796447472> Protection Limits\n';
    for (const [, cat] of Object.entries(CATEGORIES)) {
        const prot = guildConfig[cat.key];
        const status = formatCheck(prot?.enabled);
        if (cat.hasLimit) {
            limitsGrid += `${status} ${cat.emoji} **${cat.label}** — Limit: \`${prot?.limit || cat.defaultLimit}\` • Window: \`${((prot?.timeWindow || 60000) / 1000)}s\` • Action: \`${prot?.action || cat.defaultAction}\`\n`;
        } else {
            limitsGrid += `${status} ${cat.emoji} **${cat.label}** — Action: \`${prot?.action || cat.defaultAction}\`\n`;
        }
    }

    const selectMenu = new ActionRowBuilder()
        .addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('anti_select_category')
                .setPlaceholder('Select a protection to configure')
                .setDisabled(threatActive)
                .addOptions(
                    Object.entries(CATEGORIES).map(([value, cat]) => ({
                        label: cat.label,
                        description: cat.hasLimit
                            ? `Limit: ${guildConfig[cat.key]?.limit || cat.defaultLimit} | Action: ${guildConfig[cat.key]?.action || cat.defaultAction}`
                            : `Action: ${guildConfig[cat.key]?.action || cat.defaultAction}`,
                        value,
                        emoji: cat.emoji
                    }))
                )
        );

    const quickButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('anti_set_all_limits')
                .setLabel('Set All Limits')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Lightningalt:1521227851796447472>')
                .setDisabled(threatActive),
            new ButtonBuilder()
                .setCustomId('anti_set_all_actions')
                .setLabel('Set All Actions')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Bookmark:1521227835526742066>')
                .setDisabled(threatActive),
            new ButtonBuilder()
                .setCustomId('anti_reset_defaults')
                .setLabel('Reset Defaults')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:History:1521227863079256278>')
                .setDisabled(threatActive)
        );

    const container = new ContainerBuilder()
        .setAccentColor(guildConfig.enabled ? 0x57F287 : 0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(limitsGrid))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(selectMenu)
        .addActionRowComponents(quickButtons)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(createFooterText()))
;

    return container;
}

// --------------- Module ---------------
module.exports = {
    data: new SlashCommandBuilder()
        .setName('anti')
        .setDescription('Set guild\'s anti nuke limit manually')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    prefix: 'anti',
    description: 'Set guild\'s anti nuke limit manually',
    usage: 'anti',
    category: 'admin',
    aliases: ['antilimit', 'antinukelimit'],

    async execute(interaction) {
        if (!trust.isServerOwner(interaction.guild, interaction.user.id)) {
            const container = buildErrorResponse('Permission Denied', 'Only the **server owner** can configure antinuke limits.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        try {
            const config = loadConfig();
            const guildId = interaction.guild.id;
            if (!config[guildId]) { config[guildId] = getDefaultConfig(); saveConfig(config); }
            await interaction.reply({ components: [buildAntiPanel(config[guildId], interaction.guild.name)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[Anti] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message) {
        if (!trust.isServerOwner(message.guild, message.author.id)) {
            const container = buildErrorResponse('Permission Denied', 'Only the **server owner** can configure antinuke limits.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        try {
            const config = loadConfig();
            const guildId = message.guild.id;
            if (!config[guildId]) { config[guildId] = getDefaultConfig(); saveConfig(config); }
            await message.reply({ components: [buildAntiPanel(config[guildId], message.guild.name)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[Anti] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async handleInteraction(interaction) {
        // Check if config session has expired
        if (await checkAndExpire(interaction, 'config')) return true;

        if (!trust.isServerOwner(interaction.guild, interaction.user.id)) {
            const container = buildErrorResponse('Permission Denied', 'Only the **server owner** can use this panel.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const config = loadConfig();
        const guildId = interaction.guild.id;
        if (!config[guildId]) config[guildId] = getDefaultConfig();
        const guildConfig = config[guildId];
        const customId = interaction.customId;

        // Block edits if threat mode is active
        if ((guildConfig.threatMode || guildConfig.superThreatMode) && customId !== 'anti_reset_defaults') {
            const mode = guildConfig.superThreatMode ? 'Super Threat' : 'Threat';
            const container = buildErrorResponse('Threat Mode Active', `**${mode} Mode** is active. Disable it first before changing limits manually.`);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        // --- Select a category to edit ---
        if (customId === 'anti_select_category') {
            const selected = interaction.values[0];
            const cat = CATEGORIES[selected];
            if (!cat) return;

            const modal = new ModalBuilder()
                .setCustomId(`anti_modal_${selected}`)
                .setTitle(`Configure ${cat.label}`);

            const rows = [];
            if (cat.hasLimit) {
                rows.push(
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('limit').setLabel(`Limit (${LIMIT_MIN}-${LIMIT_MAX})`)
                            .setStyle(TextInputStyle.Short).setValue(String(guildConfig[cat.key]?.limit || cat.defaultLimit))
                            .setRequired(true).setMinLength(1).setMaxLength(2)
                    ),
                    new ActionRowBuilder().addComponents(
                        new TextInputBuilder().setCustomId('timewindow').setLabel(`Time Window in seconds (${WINDOW_MIN}-${WINDOW_MAX})`)
                            .setStyle(TextInputStyle.Short).setValue(String((guildConfig[cat.key]?.timeWindow || 60000) / 1000))
                            .setRequired(true).setMinLength(1).setMaxLength(3)
                    )
                );
            }
            rows.push(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('action').setLabel(`Action: ${ACTIONS_FOR[cat.key].join(' / ')}`)
                        .setStyle(TextInputStyle.Short).setValue(guildConfig[cat.key]?.action || cat.defaultAction).setRequired(true)
                )
            );
            modal.addComponents(...rows);
            return interaction.showModal(modal);
        }

        // --- Modal submit for individual category ---
        if (customId.startsWith('anti_modal_') && !customId.startsWith('anti_modal_all_')) {
            const catKey = customId.replace('anti_modal_', '');
            const cat = CATEGORIES[catKey];
            if (!cat) return;

            const action = interaction.fields.getTextInputValue('action').toLowerCase().trim();
            // Validate the action is allowed for THIS specific module —
            // saving e.g. `kick_bot` on `banProtection` would silently no-op
            // because the engine routes `kick_bot` to bot-add only.
            if (!isValidActionFor(cat.key, action)) {
                const allowed = ACTIONS_FOR[cat.key].map(a => `\`${a}\``).join(', ');
                return interaction.reply(v2InvalidReply(
                    `Invalid action for **${cat.label}**. Allowed: ${allowed}`,
                ));
            }

            if (!guildConfig[cat.key]) guildConfig[cat.key] = {};
            guildConfig[cat.key].action = action;

            if (cat.hasLimit) {
                const limit = parseInt(interaction.fields.getTextInputValue('limit'));
                const timeWindow = parseInt(interaction.fields.getTextInputValue('timewindow'));
                if (isNaN(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX) {
                    return interaction.reply(v2InvalidReply(
                        `Limit must be between **${LIMIT_MIN}** and **${LIMIT_MAX}**.`,
                    ));
                }
                if (isNaN(timeWindow) || timeWindow < WINDOW_MIN || timeWindow > WINDOW_MAX) {
                    return interaction.reply(v2InvalidReply(
                        `Time window must be between **${WINDOW_MIN}** and **${WINDOW_MAX}** seconds.`,
                    ));
                }
                guildConfig[cat.key].limit = limit;
                guildConfig[cat.key].timeWindow = timeWindow * 1000;
            }

            saveConfig(config);
            return interaction.update({ components: [buildAntiPanel(guildConfig, interaction.guild.name)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        // --- Set All Limits (modal) ---
        if (customId === 'anti_set_all_limits') {
            const modal = new ModalBuilder().setCustomId('anti_modal_all_limits').setTitle('Set All Protection Limits');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('limit').setLabel(`Limit for all (${LIMIT_MIN}-${LIMIT_MAX})`)
                        .setStyle(TextInputStyle.Short).setPlaceholder('e.g. 3').setRequired(true).setMinLength(1).setMaxLength(2)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('timewindow').setLabel(`Time window for all (seconds, ${WINDOW_MIN}-${WINDOW_MAX})`)
                        .setStyle(TextInputStyle.Short).setPlaceholder('e.g. 60').setRequired(true).setMinLength(1).setMaxLength(3)
                )
            );
            return interaction.showModal(modal);
        }

        if (customId === 'anti_modal_all_limits') {
            const limit = parseInt(interaction.fields.getTextInputValue('limit'));
            const timeWindow = parseInt(interaction.fields.getTextInputValue('timewindow'));
            if (isNaN(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX) {
                return interaction.reply({ components: [buildErrorResponse('Invalid Limit', `Limit must be between **${LIMIT_MIN}** and **${LIMIT_MAX}**.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            if (isNaN(timeWindow) || timeWindow < WINDOW_MIN || timeWindow > WINDOW_MAX) {
                return interaction.reply({ components: [buildErrorResponse('Invalid Time Window', `Time window must be between **${WINDOW_MIN}** and **${WINDOW_MAX}** seconds.`)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            for (const cat of Object.values(CATEGORIES)) {
                if (cat.hasLimit && guildConfig[cat.key]) {
                    guildConfig[cat.key].limit = limit;
                    guildConfig[cat.key].timeWindow = timeWindow * 1000;
                }
            }
            saveConfig(config);
            return interaction.update({ components: [buildAntiPanel(guildConfig, interaction.guild.name)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        // --- Set All Actions (modal) ---
        if (customId === 'anti_set_all_actions') {
            // Note: botAdd has its own action set (kick_bot/kick_both/ban_bot)
            // and isn't covered by this bulk apply — its action is only
            // configurable via the per-category modal.
            const bulkKeys = Object.values(CATEGORIES).filter(c => c.hasLimit).map(c => c.key);
            const allowed = commonActions(bulkKeys);
            const modal = new ModalBuilder().setCustomId('anti_modal_all_actions').setTitle('Set All Protection Actions');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('action').setLabel(`Action — ${allowed.join(' / ')}`)
                        .setStyle(TextInputStyle.Short).setPlaceholder('e.g. remove_roles').setRequired(true)
                )
            );
            return interaction.showModal(modal);
        }

        if (customId === 'anti_modal_all_actions') {
            const bulkKeys = Object.values(CATEGORIES).filter(c => c.hasLimit).map(c => c.key);
            const allowed = commonActions(bulkKeys);
            const action = interaction.fields.getTextInputValue('action').toLowerCase().trim();
            if (!allowed.includes(action)) {
                return interaction.reply({
                    components: [buildErrorResponse('Invalid Action', `Allowed actions for bulk apply: \`${allowed.join('`, `')}\`\n\n*Note: \`kick_bot\` / \`ban_bot\` only apply to the **Bot Add** module — set those individually.*`)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            for (const cat of Object.values(CATEGORIES)) {
                if (cat.hasLimit && guildConfig[cat.key]) {
                    guildConfig[cat.key].action = action;
                }
            }
            saveConfig(config);
            return interaction.update({ components: [buildAntiPanel(guildConfig, interaction.guild.name)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        // --- Reset Defaults ---
        if (customId === 'anti_reset_defaults') {
            const preserved = {
                whitelistedUsers: guildConfig.whitelistedUsers || [],
                bypassRoleId: guildConfig.bypassRoleId || null,
                logChannel: guildConfig.logChannel || null
            };
            config[guildId] = { ...getDefaultConfig(), ...preserved, enabled: guildConfig.enabled };
            // Clear all threat-mode tracking state. Without this, a future
            // threat-mode toggle could try to "restore" stale saved limits
            // that no longer match the new defaults.
            delete config[guildId].threatMode;
            delete config[guildId].superThreatMode;
            delete config[guildId]._savedLimits;
            delete config[guildId]._savedThreatLimits;
            delete config[guildId]._preThreatEnabled;
            delete config[guildId]._preSuperEnabled;
            saveConfig(config);
            return interaction.update({ components: [buildAntiPanel(config[guildId], interaction.guild.name)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
        return false;
    }
};
