const { 
    SlashCommandBuilder,
    ContainerBuilder, 
    TextDisplayBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    MessageFlags, 
    PermissionFlagsBits,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied } = require('../../utils/responseBuilder');

const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');
const { createFooterText } = require('../../utils/theme');

function loadConfig() {
    if (!jsonStore.has('antiraid')) {
        jsonStore.write('antiraid', {});
        return {};
    }
    return jsonStore.read('antiraid');
}

function saveConfig(config, guildId) {
    jsonStore.write('antiraid', config);
    // Sync in-memory cache
    if (guildId && global.updateAntiraidCache) {
        global.updateAntiraidCache(guildId, config[guildId]);
    }
}

function getDefaultConfig() {
    return {
        enabled: false,
        joinRate: { enabled: true, limit: 10, timeWindow: 10000, action: 'kick' },
        accountAge: { enabled: true, minDays: 7, action: 'kick' },
        autoLockdown: { enabled: true, threshold: 15, duration: 300000 },
        suspiciousPatterns: { enabled: true, action: 'kick' },
        logChannel: null,
        whitelistedRoles: [],
        bypassRoleId: null
    };
}

function buildAntiraidPanel(guildConfig) {
    const statusEmoji = guildConfig.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';
    const logChannel = guildConfig.logChannel ? `<#${guildConfig.logChannel}>` : '*Not configured*';
    const bypassRole = guildConfig.bypassRoleId ? `<@&${guildConfig.bypassRoleId}>` : '*None*';

    // Format whitelisted roles
    const whitelistRoles = guildConfig.whitelistedRoles?.length > 0
        ? guildConfig.whitelistedRoles.slice(0, 3).map(id => `<@&${id}>`).join(', ') + (guildConfig.whitelistedRoles.length > 3 ? ` +${guildConfig.whitelistedRoles.length - 3} more` : '')
        : '*None*';

    const protectionStatus = [
        `${guildConfig.joinRate?.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>'} **Join Rate Limit** — \`${guildConfig.joinRate?.limit || 10} joins/${(guildConfig.joinRate?.timeWindow || 10000) / 1000}s\` → \`${guildConfig.joinRate?.action || 'kick'}\``,
        `${guildConfig.accountAge?.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>'} **Account Age Check** — Min: \`${guildConfig.accountAge?.minDays || 7} days\` → \`${guildConfig.accountAge?.action || 'kick'}\``,
        `${guildConfig.autoLockdown?.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>'} **Auto Lockdown** — After \`${guildConfig.autoLockdown?.threshold || 15}\` violations → Lock for \`${(guildConfig.autoLockdown?.duration || 300000) / 60000}min\``,
        `${guildConfig.suspiciousPatterns?.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>'} **Suspicious Patterns** → \`${guildConfig.suspiciousPatterns?.action || 'kick'}\``,
        ``,
        `**Bypass Role:** ${bypassRole}`,
        `**Log Channel:** ${logChannel}`,
        `-# <:Shield:1521227694677692467> Whitelisted Roles: ${whitelistRoles}`
    ].join('\n');

    const headerText = `# <:Shield:1521227694677692467> Anti-Raid Protection System\n\nProtect your server from coordinated attacks, bot raids, and suspicious join patterns.`;
    const statusSection = guildConfig.enabled
        ? `**System Status:** ${statusEmoji} ACTIVE - Server is protected`
        : `**System Status:** ${statusEmoji} INACTIVE - Enable protection below`;
    const protectionSection = `### <:Document:1521227875016114266> Protection Modules\n${protectionStatus}`;
    const descriptionText = `### <:Edit:1521227886634205298> How It Works\n` +
        `<:Lock:1521227892770734120> **Auto Lockdown** - Temporarily locks server when raid detected\n` +
        `<:Userplus:1521227719621218477> **Join Rate** - Limits mass joins within a time window\n` +
        `<:Commentblock:1521227898101432331> **Suspicious Patterns** - Detects bot-like usernames/behavior\n` +
        `<:Alarm:1521227869047750689> **Account Age** - Blocks accounts younger than X days`;

    const protectionButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('antiraid_joinrate')
                .setLabel('Join Rate')
                .setStyle(guildConfig.joinRate?.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Userplus:1521227719621218477>'),
            new ButtonBuilder()
                .setCustomId('antiraid_accountage')
                .setLabel('Account Age')
                .setStyle(guildConfig.accountAge?.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Alarm:1521227869047750689>'),
            new ButtonBuilder()
                .setCustomId('antiraid_lockdown')
                .setLabel('Auto Lockdown')
                .setStyle(guildConfig.autoLockdown?.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Lock:1521227892770734120>'),
            new ButtonBuilder()
                .setCustomId('antiraid_suspicious')
                .setLabel('Suspicious Patterns')
                .setStyle(guildConfig.suspiciousPatterns?.enabled ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Commentblock:1521227898101432331>')
        );

    const controlButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('antiraid_toggle')
                .setLabel(guildConfig.enabled ? 'Disable System' : 'Enable System')
                .setStyle(guildConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(guildConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Checkedbox:1521227734943269077>'),
            new ButtonBuilder()
                .setCustomId('antiraid_enable_all')
                .setLabel('Enable All')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:Lightningalt:1521227851796447472>'),
            new ButtonBuilder()
                .setCustomId('antiraid_disable_all')
                .setLabel('Disable All')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Cancel:1521227723916181644>')
        );

    const settingsButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('antiraid_settings')
                .setLabel('Settings')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Settings:1521227767780343879>'),
            new ButtonBuilder()
                .setCustomId('antiraid_logs')
                .setLabel('Set Log Channel')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Document:1521227875016114266>'),
            new ButtonBuilder()
                .setCustomId('antiraid_bypass')
                .setLabel('Bypass Role')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Shield:1521227694677692467>'),
            new ButtonBuilder()
                .setCustomId('antiraid_default')
                .setLabel('Default Rules')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:History:1521227863079256278>')
        );

    const container = new ContainerBuilder()
        .setAccentColor(guildConfig.enabled ? 0x57F287 : 0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(statusSection))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(protectionSection))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(descriptionText))
        .addActionRowComponents(protectionButtons)
        .addActionRowComponents(controlButtons)
        .addActionRowComponents(settingsButtons);

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(createFooterText()));

    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('antiraid')
        .setDescription('Configure anti-raid protection system')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    name: 'antiraid',
    prefix: 'antiraid',
    description: 'Configure anti-raid protection system',
    usage: 'antiraid',
    category: 'admin',
    aliases: ['araid', 'antiraid-setup'],

    async execute(interaction) {
        try {
            const config = loadConfig();
            const guildId = interaction.guild.id;
            let guildConfig = config[guildId] || getDefaultConfig();
            if (!config[guildId]) {
                config[guildId] = guildConfig;
                saveConfig(config, guildId);
            }

            const container = buildAntiraidPanel(guildConfig);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[AntiRaid] Error:', error);
            const { buildErrorResponse } = require('../../utils/responseBuilder');
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const container = buildPermissionDenied('Administrator');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const config = loadConfig();
            const guildId = message.guild.id;
            let guildConfig = config[guildId] || getDefaultConfig();
            if (!config[guildId]) {
                config[guildId] = guildConfig;
                saveConfig(config, guildId);
            }

            const container = buildAntiraidPanel(guildConfig);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[AntiRaid] Error:', error);
            const { buildErrorResponse } = require('../../utils/responseBuilder');
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async handleInteraction(interaction) {
        if (!interaction.isButton() && !interaction.isModalSubmit()) return false;
        
        const customId = interaction.customId;
        if (!customId.startsWith('antiraid_')) return false;

        // Check if config session has expired
        if (await checkAndExpire(interaction, 'config')) return true;

        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const container = buildPermissionDenied('Administrator');
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        const config = loadConfig();
        const guildId = interaction.guild.id;
        let guildConfig = config[guildId] || getDefaultConfig();

        if (interaction.isButton()) {
            if (customId === 'antiraid_toggle') {
                guildConfig.enabled = !guildConfig.enabled;
                config[guildId] = guildConfig;
                saveConfig(config, guildId);
                
                const container = buildAntiraidPanel(guildConfig);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return true;
            }

            if (customId === 'antiraid_enable_all') {
                guildConfig.enabled = true;
                if (!guildConfig.joinRate) guildConfig.joinRate = { enabled: true, limit: 10, timeWindow: 10000, action: 'kick' };
                if (!guildConfig.accountAge) guildConfig.accountAge = { enabled: true, minDays: 7, action: 'kick' };
                if (!guildConfig.autoLockdown) guildConfig.autoLockdown = { enabled: true, threshold: 15, duration: 300000 };
                if (!guildConfig.suspiciousPatterns) guildConfig.suspiciousPatterns = { enabled: true, action: 'kick' };
                guildConfig.joinRate.enabled = true;
                guildConfig.accountAge.enabled = true;
                guildConfig.autoLockdown.enabled = true;
                guildConfig.suspiciousPatterns.enabled = true;
                config[guildId] = guildConfig;
                saveConfig(config, guildId);

                const container = buildAntiraidPanel(guildConfig);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return true;
            }

            if (customId === 'antiraid_disable_all') {
                if (!guildConfig.joinRate) guildConfig.joinRate = { enabled: false, limit: 10, timeWindow: 10000, action: 'kick' };
                if (!guildConfig.accountAge) guildConfig.accountAge = { enabled: false, minDays: 7, action: 'kick' };
                if (!guildConfig.autoLockdown) guildConfig.autoLockdown = { enabled: false, threshold: 15, duration: 300000 };
                if (!guildConfig.suspiciousPatterns) guildConfig.suspiciousPatterns = { enabled: false, action: 'kick' };
                guildConfig.joinRate.enabled = false;
                guildConfig.accountAge.enabled = false;
                guildConfig.autoLockdown.enabled = false;
                guildConfig.suspiciousPatterns.enabled = false;
                config[guildId] = guildConfig;
                saveConfig(config, guildId);

                const container = buildAntiraidPanel(guildConfig);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return true;
            }

            if (customId === 'antiraid_joinrate') {
                if (!guildConfig.joinRate) guildConfig.joinRate = { enabled: false, limit: 10, timeWindow: 10000, action: 'kick' };
                guildConfig.joinRate.enabled = !guildConfig.joinRate.enabled;
                config[guildId] = guildConfig;
                saveConfig(config, guildId);

                const container = buildAntiraidPanel(guildConfig);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return true;
            }

            if (customId === 'antiraid_accountage') {
                if (!guildConfig.accountAge) guildConfig.accountAge = { enabled: false, minDays: 7, action: 'kick' };
                guildConfig.accountAge.enabled = !guildConfig.accountAge.enabled;
                config[guildId] = guildConfig;
                saveConfig(config, guildId);

                const container = buildAntiraidPanel(guildConfig);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return true;
            }

            if (customId === 'antiraid_lockdown') {
                if (!guildConfig.autoLockdown) guildConfig.autoLockdown = { enabled: false, threshold: 15, duration: 300000 };
                guildConfig.autoLockdown.enabled = !guildConfig.autoLockdown.enabled;
                config[guildId] = guildConfig;
                saveConfig(config, guildId);

                const container = buildAntiraidPanel(guildConfig);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return true;
            }

            if (customId === 'antiraid_suspicious') {
                if (!guildConfig.suspiciousPatterns) guildConfig.suspiciousPatterns = { enabled: false, action: 'kick' };
                guildConfig.suspiciousPatterns.enabled = !guildConfig.suspiciousPatterns.enabled;
                config[guildId] = guildConfig;
                saveConfig(config, guildId);

                const container = buildAntiraidPanel(guildConfig);
                await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return true;
            }

            if (customId === 'antiraid_settings') {
                const modal = new ModalBuilder()
                    .setCustomId('antiraid_modal_settings')
                    .setTitle('Anti-Raid Settings');

                const joinLimitInput = new TextInputBuilder()
                    .setCustomId('join_limit')
                    .setLabel('Join Rate Limit (users)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('10')
                    .setValue(String(guildConfig.joinRate?.limit || 10))
                    .setRequired(false);

                const joinWindowInput = new TextInputBuilder()
                    .setCustomId('join_window')
                    .setLabel('Join Rate Time Window (seconds)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('10')
                    .setValue(String((guildConfig.joinRate?.timeWindow || 10000) / 1000))
                    .setRequired(false);

                const accountAgeInput = new TextInputBuilder()
                    .setCustomId('account_age')
                    .setLabel('Minimum Account Age (days)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('7')
                    .setValue(String(guildConfig.accountAge?.minDays || 7))
                    .setRequired(false);

                const lockdownThresholdInput = new TextInputBuilder()
                    .setCustomId('lockdown_threshold')
                    .setLabel('Auto Lockdown Trigger Count')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('15')
                    .setValue(String(guildConfig.autoLockdown?.threshold || 15))
                    .setRequired(false);

                modal.addComponents(
                    new ActionRowBuilder().addComponents(joinLimitInput),
                    new ActionRowBuilder().addComponents(joinWindowInput),
                    new ActionRowBuilder().addComponents(accountAgeInput),
                    new ActionRowBuilder().addComponents(lockdownThresholdInput)
                );
                await interaction.showModal(modal);
                return true;
            }

            if (customId === 'antiraid_logs') {
                const modal = new ModalBuilder()
                    .setCustomId('antiraid_modal_logs')
                    .setTitle('Set Anti-Raid Log Channel');

                const channelInput = new TextInputBuilder()
                    .setCustomId('channel_id')
                    .setLabel('Channel ID or Mention')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Enter channel ID or #channel-mention')
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(channelInput));
                await interaction.showModal(modal);
                return true;
            }

            if (customId === 'antiraid_bypass') {
                const modal = new ModalBuilder()
                    .setCustomId('antiraid_modal_bypass')
                    .setTitle('Set Anti-Raid Bypass Role');

                const roleInput = new TextInputBuilder()
                    .setCustomId('role_id')
                    .setLabel('Role ID or Mention')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('Enter role ID or @role-mention')
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder().addComponents(roleInput));
                await interaction.showModal(modal);
                return true;
            }

            if (customId === 'antiraid_default') {
                const defaultConfig = getDefaultConfig();
                defaultConfig.enabled = true;
                defaultConfig.logChannel = guildConfig.logChannel;
                config[guildId] = defaultConfig;
                saveConfig(config, guildId);

                const successContainer = buildSuccessResponse('Rules Reset', 'Anti-Raid reset to default rules and enabled!');
                await interaction.reply({ components: [successContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

                const container = buildAntiraidPanel(defaultConfig);
                await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                return true;
            }
        }

        if (interaction.isModalSubmit()) {
            if (customId === 'antiraid_modal_settings') {
                const joinLimit = interaction.fields.getTextInputValue('join_limit');
                const joinWindow = interaction.fields.getTextInputValue('join_window');
                const accountAge = interaction.fields.getTextInputValue('account_age');
                const lockdownThreshold = interaction.fields.getTextInputValue('lockdown_threshold');

                if (!guildConfig.joinRate) guildConfig.joinRate = { enabled: true, limit: 10, timeWindow: 10000, action: 'kick' };
                if (!guildConfig.accountAge) guildConfig.accountAge = { enabled: true, minDays: 7, action: 'kick' };
                if (!guildConfig.autoLockdown) guildConfig.autoLockdown = { enabled: true, threshold: 15, duration: 300000 };

                if (joinLimit) guildConfig.joinRate.limit = parseInt(joinLimit) || 10;
                if (joinWindow) guildConfig.joinRate.timeWindow = (parseInt(joinWindow) || 10) * 1000;
                if (accountAge) guildConfig.accountAge.minDays = parseInt(accountAge) || 7;
                if (lockdownThreshold) guildConfig.autoLockdown.threshold = parseInt(lockdownThreshold) || 15;

                config[guildId] = guildConfig;
                saveConfig(config, guildId);

                const settingsContainer = buildSuccessResponse('Settings Updated', 'Anti-Raid settings have been updated successfully!');
                await interaction.reply({ components: [settingsContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

                const container = buildAntiraidPanel(guildConfig);
                await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                return true;
            }

            if (customId === 'antiraid_modal_logs') {
                const channelInput = interaction.fields.getTextInputValue('channel_id');
                const channelId = channelInput.replace(/[<#>]/g, '');
                
                const channel = interaction.guild.channels.cache.get(channelId);
                if (!channel) {
                    const errContainer = buildErrorResponse('Invalid Channel', 'The channel ID provided is invalid or not found in this server.');
                    await interaction.reply({ components: [errContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    return true;
                }

                guildConfig.logChannel = channelId;
                config[guildId] = guildConfig;
                saveConfig(config, guildId);

                const logContainer = buildSuccessResponse('Log Channel Set', `Anti-Raid events will be logged in ${channel}.`);
                await interaction.reply({ components: [logContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

                const container = buildAntiraidPanel(guildConfig);
                await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                return true;
            }

            if (customId === 'antiraid_modal_bypass') {
                const roleInput = interaction.fields.getTextInputValue('role_id');
                const roleId = roleInput.replace(/[<@&>]/g, '');
                
                const role = interaction.guild.roles.cache.get(roleId);
                if (!role) {
                    const errContainer = buildErrorResponse('Invalid Role', 'The role ID provided is invalid or not found in this server.');
                    await interaction.reply({ components: [errContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    return true;
                }

                guildConfig.bypassRoleId = roleId;
                config[guildId] = guildConfig;
                saveConfig(config, guildId);

                const bypassContainer = buildSuccessResponse('Bypass Role Set', `Members with ${role} will bypass Anti-Raid protection.`);
                await interaction.reply({ components: [bypassContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

                const container = buildAntiraidPanel(guildConfig);
                await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                return true;
            }
        }

        return false;
    }
};
