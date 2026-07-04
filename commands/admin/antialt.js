const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { buildErrorResponse, buildPermissionDenied, COLORS, EMOJIS } = require('../../utils/responseBuilder');
const { checkAndExpire } = require('../../utils/panelExpiration');

const jsonStore = require('../../utils/jsonStore');
const { createFooterText } = require('../../utils/theme');

function loadConfig() {
    if (!jsonStore.has('antialt')) {
        jsonStore.write('antialt', {});
        return {};
    }
    return jsonStore.read('antialt');
}

function saveConfig(config) {
    jsonStore.write('antialt', config);
}

function ensureGuildConfig(config, guildId) {
    if (!config[guildId]) {
        config[guildId] = { enabled: false, minAge: 7, action: 'kick', logChannel: null };
    }
    // Backfill fields added after initial schema (action / logChannel)
    if (!config[guildId].action) config[guildId].action = 'kick';
    if (config[guildId].logChannel === undefined) config[guildId].logChannel = null;
    return config[guildId];
}

const VALID_ACTIONS = ['kick', 'ban', 'log_only'];

function buildStatusPanel(guildConfig) {
    const isOn = guildConfig.enabled;
    const log = guildConfig.logChannel ? `<#${guildConfig.logChannel}>` : '`Not configured`';

    const text =
        `# <:Shield:1521227694677692467> Anti-Alt Account Detection\n` +
        `-# Block accounts younger than your minimum age threshold\n\n` +
        (isOn
            ? `${EMOJIS.SUCCESS} **System Armed** — Detecting alts on join`
            : `${EMOJIS.ERROR} **System Offline** — Alt detection disabled`) +
        `\n\n### <:Settings:1521227767780343879> Configuration\n` +
        `<:Alarm:1521227869047750689> **Minimum Account Age:** \`${guildConfig.minAge}\` day${guildConfig.minAge === 1 ? '' : 's'}\n` +
        `<:banhammer:1521227777083314529> **Action on Detection:** \`${guildConfig.action || 'kick'}\`\n` +
        `<:Document:1521227875016114266> **Log Channel:** ${log}\n\n` +
        `### <:Lightbulbalt:1521227880703463675> What It Does\n` +
        `When a member joins, their account creation date is compared against your minimum age. ` +
        `Accounts younger than the threshold trigger the configured action.`;

    const toggle = new ButtonBuilder()
        .setCustomId('antialt_toggle')
        .setLabel(isOn ? 'Disable' : 'Enable')
        .setStyle(isOn ? ButtonStyle.Danger : ButtonStyle.Success)
        .setEmoji(isOn ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>');

    const setAge = new ButtonBuilder()
        .setCustomId('antialt_set_age')
        .setLabel('Set Minimum Age')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('<:Alarm:1521227869047750689>');

    const setAction = new ButtonBuilder()
        .setCustomId('antialt_set_action')
        .setLabel('Set Action')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('<:banhammer:1521227777083314529>');

    const setLog = new ButtonBuilder()
        .setCustomId('antialt_set_log')
        .setLabel('Set Log Channel')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('<:Document:1521227875016114266>');

    return new ContainerBuilder()
        .setAccentColor(isOn ? 0x57F287 : 0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(new ActionRowBuilder().addComponents(toggle, setAge, setAction, setLog))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(createFooterText()))
;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('antialt')
        .setDescription('Configure anti-alt account detection')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('enable')
                .setDescription('Enable anti-alt detection'))
        .addSubcommand(sub =>
            sub.setName('disable')
                .setDescription('Disable anti-alt detection'))
        .addSubcommand(sub =>
            sub.setName('age')
                .setDescription('Set minimum account age')
                .addIntegerOption(opt =>
                    opt.setName('days')
                        .setDescription('Minimum account age in days')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(365)))
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('View current anti-alt configuration')),

    prefix: 'antialt',
    description: 'Configure anti-alt account detection',
    usage: 'antialt <enable/disable/age/status>',
    category: 'admin',

    async execute(interaction) {
        try {
            const config = loadConfig();
            const guildConfig = ensureGuildConfig(config, interaction.guild.id);
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'enable') {
                config[interaction.guild.id].enabled = true;
                saveConfig(config);
                if (global.updateAntialtCache) global.updateAntialtCache(interaction.guild.id, config[interaction.guild.id]);
                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.PRIMARY)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# ${EMOJIS.SUCCESS} Anti-Alt Enabled\n\nAccounts younger than **${guildConfig.minAge} days** will be detected.`
                        )
                    )
;
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (subcommand === 'disable') {
                config[interaction.guild.id].enabled = false;
                saveConfig(config);
                if (global.updateAntialtCache) global.updateAntialtCache(interaction.guild.id, config[interaction.guild.id]);
                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.PRIMARY)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# ${EMOJIS.ERROR} Anti-Alt Disabled\n\nAlt account detection has been turned off.`
                        )
                    )
;
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (subcommand === 'age') {
                const days = interaction.options.getInteger('days');
                config[interaction.guild.id].minAge = days;
                saveConfig(config);
                if (global.updateAntialtCache) global.updateAntialtCache(interaction.guild.id, config[interaction.guild.id]);
                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.PRIMARY)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# ${EMOJIS.SUCCESS} Age Updated\n\nMinimum account age set to **${days} days**.`
                        )
                    )
;
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            await interaction.reply({ components: [buildStatusPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[AntiAlt] Error:', error);
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
            const guildConfig = ensureGuildConfig(config, message.guild.id);
            const subcommand = args[0]?.toLowerCase();

            if (subcommand === 'enable') {
                config[message.guild.id].enabled = true;
                saveConfig(config);
                if (global.updateAntialtCache) global.updateAntialtCache(message.guild.id, config[message.guild.id]);
                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.PRIMARY)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# ${EMOJIS.SUCCESS} Anti-Alt Enabled\n\nAccounts younger than **${guildConfig.minAge} days** will be detected.`
                        )
                    )
;
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (subcommand === 'disable') {
                config[message.guild.id].enabled = false;
                saveConfig(config);
                if (global.updateAntialtCache) global.updateAntialtCache(message.guild.id, config[message.guild.id]);
                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.PRIMARY)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# ${EMOJIS.ERROR} Anti-Alt Disabled\n\nAlt account detection has been turned off.`
                        )
                    )
;
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (subcommand === 'age') {
                const days = parseInt(args[1]);
                if (isNaN(days) || days < 1) {
                    const container = new ContainerBuilder()
                        .setAccentColor(COLORS.ERROR)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# ${EMOJIS.ERROR} Invalid Days\n\nPlease provide a valid number of days!\n\n**Usage:** \`-antialt age <days>\``
                            )
                        );
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                config[message.guild.id].minAge = days;
                saveConfig(config);
                if (global.updateAntialtCache) global.updateAntialtCache(message.guild.id, config[message.guild.id]);
                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.PRIMARY)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# ${EMOJIS.SUCCESS} Age Updated\n\nMinimum account age set to **${days} days**.`
                        )
                    )
;
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            await message.reply({ components: [buildStatusPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[AntiAlt] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    /* ──────────────────── interactive panel handler ────────────── */

    async handleInteraction(interaction) {
        if (!interaction.customId?.startsWith('antialt_')) return false;
        if (await checkAndExpire(interaction, 'config')) return true;

        if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({
                components: [buildPermissionDenied('Administrator')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }

        const config = loadConfig();
        const guildId = interaction.guild.id;
        const guildConfig = ensureGuildConfig(config, guildId);
        const id = interaction.customId;

        if (interaction.isButton()) {
            if (id === 'antialt_toggle') {
                guildConfig.enabled = !guildConfig.enabled;
                saveConfig(config);
                if (global.updateAntialtCache) global.updateAntialtCache(guildId, guildConfig);
                await interaction.update({ components: [buildStatusPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return true;
            }
            if (id === 'antialt_set_age') {
                const modal = new ModalBuilder()
                    .setCustomId('antialt_modal_age')
                    .setTitle('Set Minimum Account Age')
                    .addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('days')
                            .setLabel('Minimum age in days (1–365)')
                            .setStyle(TextInputStyle.Short)
                            .setValue(String(guildConfig.minAge || 7))
                            .setPlaceholder('e.g. 7')
                            .setRequired(true)
                            .setMinLength(1).setMaxLength(3),
                    ));
                await interaction.showModal(modal);
                return true;
            }
            if (id === 'antialt_set_action') {
                const modal = new ModalBuilder()
                    .setCustomId('antialt_modal_action')
                    .setTitle('Set Action on Detection')
                    .addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('action')
                            .setLabel(`Action: ${VALID_ACTIONS.join(' / ')}`)
                            .setStyle(TextInputStyle.Short)
                            .setValue(guildConfig.action || 'kick')
                            .setRequired(true),
                    ));
                await interaction.showModal(modal);
                return true;
            }
            if (id === 'antialt_set_log') {
                const modal = new ModalBuilder()
                    .setCustomId('antialt_modal_log')
                    .setTitle('Set Log Channel')
                    .addComponents(new ActionRowBuilder().addComponents(
                        new TextInputBuilder()
                            .setCustomId('channel')
                            .setLabel('Channel ID or #mention (empty to clear)')
                            .setStyle(TextInputStyle.Short)
                            .setValue(guildConfig.logChannel || '')
                            .setRequired(false),
                    ));
                await interaction.showModal(modal);
                return true;
            }
        }

        if (interaction.isModalSubmit()) {
            if (id === 'antialt_modal_age') {
                const days = parseInt(interaction.fields.getTextInputValue('days'), 10);
                if (isNaN(days) || days < 1 || days > 365) {
                    await interaction.reply({
                        components: [buildErrorResponse('Invalid Age', 'Minimum age must be between **1** and **365** days.')],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    return true;
                }
                guildConfig.minAge = days;
                saveConfig(config);
                if (global.updateAntialtCache) global.updateAntialtCache(guildId, guildConfig);
                await interaction.update({ components: [buildStatusPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return true;
            }
            if (id === 'antialt_modal_action') {
                const action = interaction.fields.getTextInputValue('action').toLowerCase().trim();
                if (!VALID_ACTIONS.includes(action)) {
                    await interaction.reply({
                        components: [buildErrorResponse('Invalid Action', `Allowed: \`${VALID_ACTIONS.join('`, `')}\``)],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    return true;
                }
                guildConfig.action = action;
                saveConfig(config);
                if (global.updateAntialtCache) global.updateAntialtCache(guildId, guildConfig);
                await interaction.update({ components: [buildStatusPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return true;
            }
            if (id === 'antialt_modal_log') {
                const raw = interaction.fields.getTextInputValue('channel').trim();
                if (!raw) {
                    guildConfig.logChannel = null;
                } else {
                    const channelId = raw.replace(/[<#>]/g, '');
                    const channel = interaction.guild.channels.cache.get(channelId);
                    if (!channel) {
                        await interaction.reply({
                            components: [buildErrorResponse('Invalid Channel', 'Channel not found in this server.')],
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                        return true;
                    }
                    guildConfig.logChannel = channelId;
                }
                saveConfig(config);
                if (global.updateAntialtCache) global.updateAntialtCache(guildId, guildConfig);
                await interaction.update({ components: [buildStatusPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return true;
            }
        }
        return false;
    } };
