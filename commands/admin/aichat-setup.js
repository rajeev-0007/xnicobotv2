const { SlashCommandBuilder, ChannelSelectMenuBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ContainerBuilder, TextDisplayBuilder, PermissionFlagsBits } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');
const { buildDefaultSystemPrompt } = require('../../utils/aiChatManager');

function loadConfig() {
    try {
        if (jsonStore.has('aichat')) {
            return jsonStore.read('aichat');
        }
    } catch (e) {
        console.error('Error loading AI chat config:', e);
    }
    return {};
}

function saveConfig(config) {
    try {
        jsonStore.write('aichat', config);
    } catch (e) {
        console.error('Error saving AI chat config:', e);
    }
}

function getGuildConfig(guildId) {
    const config = loadConfig();
    return config[guildId] || {
        enabled: false,
        channelId: null,
        model: 'llama-3.3-70b-versatile',
        maxTokens: 1024,
        systemPrompt: ''
    };
}

function buildSetupPanel(guildId) {
    const config = getGuildConfig(guildId);
    const channel = config.channelId ? `<#${config.channelId}>` : 'Not set';
    const status = config.enabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled';
    const promptStatus = config.systemPrompt?.trim() ? 'Custom' : 'Default smart prompt';

    const container = new ContainerBuilder()
        .setAccentColor(0x7c3aed)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                '# <:Settings:1521227767780343879> AI Chat Setup\n\n' +
                'Configure the AI chatbot for your server.\n' +
                'The bot will respond to messages in the designated channel.\n\n' +
                `**Status:** ${status}\n` +
                `**Channel:** ${channel}\n` +
                `**Model:** \`${config.model}\`\n` +
                `**Max Tokens:** ${config.maxTokens}\n` +
                `**System Prompt:** ${promptStatus}`
            )
        );

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('aichat_select_channel')
            .setLabel('Select Channel')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('aichat_select_model')
            .setLabel('AI Model')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('aichat_max_tokens')
            .setLabel('Max Tokens')
            .setStyle(ButtonStyle.Secondary)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('aichat_edit_prompt')
            .setLabel('System Prompt')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('aichat_reset_prompt')
            .setLabel('Reset Prompt')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('aichat_toggle')
            .setLabel(config.enabled ? 'Disable AI Chat' : 'Enable AI Chat')
            .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    );

    container.addActionRowComponents(row1, row2);
    return container;
}

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite message instead of execution.
     */
    premiumOnly: true,

    data: new SlashCommandBuilder()
        .setName('aichat-setup')
        .setDescription('Configure AI chatbot for your server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    prefix: 'aichat-setup',
    aliases: ['aichat', 'ai-setup', 'chatbot'],
    category: 'admin',
    description: 'Configure AI chatbot for your server',
    usage: 'aichat-setup',

    async execute(interaction) {
        const container = buildSetupPanel(interaction.guild.id);
        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ content: '<:Cancel:1521227723916181644> You need Administrator permission.' });
        }
        const container = buildSetupPanel(message.guild.id);
        await message.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    },

    async handleInteraction(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('aichat_')) return false;

        // ── Admin + Premium gate ───────────────────────────────────
        // Buttons / modals / selects on this panel route here directly,
        // so they bypass the slash-command dispatcher's `premiumOnly`
        // check. Re-validate so the panel fails closed when the server
        // loses premium AFTER the panel was opened, and so non-admins
        // can't poke at someone else's panel.
        if (!interaction.member?.permissions?.has?.(PermissionFlagsBits.Administrator)) {
            await interaction.reply({
                content: '<:Cancel:1521227723916181644> You need **Administrator** permission to configure AI chat.',
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
            return true;
        }
        const premiumManager = require('../../utils/premiumManager');
        if (!premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild?.id)) {
            const { buildPremiumGate } = require('../../utils/responseBuilder');
            await interaction.reply({
                components: [buildPremiumGate('/aichat-setup')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            }).catch(() => {});
            return true;
        }

        // Check if config session has expired
        if (await checkAndExpire(interaction, 'config')) return true;

        const guildId = interaction.guild.id;

        // Modal submissions
        if (interaction.isModalSubmit()) {
            if (customId === 'aichat_tokens_modal') {
                const maxTokens = parseInt(interaction.fields.getTextInputValue('max_tokens'));
                if (isNaN(maxTokens) || maxTokens < 50 || maxTokens > 4096) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> Max tokens must be between 50 and 4096.', flags: MessageFlags.Ephemeral });
                    return true;
                }
                const allConfig = loadConfig();
                const config = allConfig[guildId] || getGuildConfig(guildId);
                config.maxTokens = maxTokens;
                allConfig[guildId] = config;
                saveConfig(allConfig);
                await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Max tokens set to **${maxTokens}**`, flags: MessageFlags.Ephemeral });
            }

            if (customId === 'aichat_prompt_modal') {
                const systemPrompt = interaction.fields.getTextInputValue('system_prompt').trim();
                const allConfig = loadConfig();
                const config = allConfig[guildId] || getGuildConfig(guildId);
                config.systemPrompt = systemPrompt;
                allConfig[guildId] = config;
                saveConfig(allConfig);
                await interaction.reply({ content: '<:Checkedbox:1521227734943269077> AI system prompt updated successfully.', flags: MessageFlags.Ephemeral });
            }

            return true;
        }

        // Channel select menu
        if (interaction.isChannelSelectMenu()) {
            if (customId === 'aichat_channel_select') {
                const channelId = interaction.values[0];
                const allConfig = loadConfig();
                const config = allConfig[guildId] || getGuildConfig(guildId);
                config.channelId = channelId;
                allConfig[guildId] = config;
                saveConfig(allConfig);
                await interaction.reply({ content: `<:Checkedbox:1521227734943269077> AI chat channel set to <#${channelId}>`, flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        // String select menu
        if (interaction.isStringSelectMenu()) {
            if (customId === 'aichat_model_select') {
                const model = interaction.values[0];
                const allConfig = loadConfig();
                const config = allConfig[guildId] || getGuildConfig(guildId);
                config.model = model;
                allConfig[guildId] = config;
                saveConfig(allConfig);
                await interaction.reply({ content: `<:Checkedbox:1521227734943269077> AI model set to **${model}**`, flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        // Button interactions
        if (customId === 'aichat_select_channel') {
            const row = new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId('aichat_channel_select')
                    .setPlaceholder('Select a channel for AI chat')
                    .addChannelTypes(0)
            );
            await interaction.reply({ components: [new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:Hashtag:1521227771957870604> Select a channel for AI chat:'))
                .addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        else if (customId === 'aichat_select_model') {
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId('aichat_model_select')
                    .setPlaceholder('Choose AI model')
                    .addOptions(
                        { label: 'Llama 3.3 70B Versatile (Best)', value: 'llama-3.3-70b-versatile' },
                        { label: 'Llama 3.1 8B Instant (Fast)', value: 'llama-3.1-8b-instant' },
                        { label: 'Llama 3 70B 8K', value: 'llama3-70b-8192' },
                        { label: 'Llama 3 8B 8K (Compact)', value: 'llama3-8b-8192' },
                        { label: 'Mixtral 8x7B 32K (Balanced)', value: 'mixtral-8x7b-32768' },
                        { label: 'Gemma 2 9B (Compact)', value: 'gemma2-9b-it' }
                    )
            );
            await interaction.reply({ components: [new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('<:Settings:1521227767780343879> Select the AI model:'))
                .addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        else if (customId === 'aichat_max_tokens') {
            const config = getGuildConfig(guildId);
            const modal = new ModalBuilder()
                .setCustomId('aichat_tokens_modal')
                .setTitle('Set Max Tokens Per Response');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('max_tokens')
                        .setLabel('Max Tokens (50-4096)')
                        .setStyle(TextInputStyle.Short)
                        .setValue(String(config.maxTokens))
                        .setMinLength(2)
                        .setMaxLength(4)
                        .setPlaceholder('150')
                        .setRequired(true)
                )
            );
            await interaction.showModal(modal);
        }

        else if (customId === 'aichat_edit_prompt') {
            const config = getGuildConfig(guildId);
            const defaultPrompt = buildDefaultSystemPrompt();
            const modal = new ModalBuilder()
                .setCustomId('aichat_prompt_modal')
                .setTitle('Edit AI System Prompt');

            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('system_prompt')
                        .setLabel('System Prompt')
                        .setStyle(TextInputStyle.Paragraph)
                        .setValue((config.systemPrompt?.trim() || defaultPrompt).slice(0, 4000))
                        .setMaxLength(4000)
                        .setPlaceholder('Describe how the AI should respond, your owner profile, and bot identity.')
                        .setRequired(true)
                )
            );

            await interaction.showModal(modal);
        }

        else if (customId === 'aichat_reset_prompt') {
            const allConfig = loadConfig();
            const config = allConfig[guildId] || getGuildConfig(guildId);
            config.systemPrompt = '';
            allConfig[guildId] = config;
            saveConfig(allConfig);

            const container = buildSetupPanel(guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        else if (customId === 'aichat_toggle') {
            const config = getGuildConfig(guildId);
            if (!config.channelId) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Please select a channel first!', flags: MessageFlags.Ephemeral });
                return true;
            }
            config.enabled = !config.enabled;
            const allConfig = loadConfig();
            allConfig[guildId] = config;
            saveConfig(allConfig);

            const container = buildSetupPanel(guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        return true;
    }
};
