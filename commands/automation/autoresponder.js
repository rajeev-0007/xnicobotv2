const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { buildSafeListText } = require('../../utils/componentHelpers');

function loadConfig() {
    if (!jsonStore.has('autoresponder')) {
        jsonStore.write('autoresponder', {});
        return {};
    }
    try {
        return jsonStore.read('autoresponder');
    } catch (error) {
        console.error('Error loading autoresponder config:', error);
        return {};
    }
}

function saveConfig(config) {
    jsonStore.write('autoresponder', config);
}

function ensureGuildConfig(config, guildId) {
    if (!config[guildId]) {
        config[guildId] = { enabled: false, responses: [] };
    }
    if (!config[guildId].responses) {
        config[guildId].responses = [];
    }
    return config[guildId];
}

function updateCache(guildId, data) {
    if (global.updateAutoresponderCache) {
        global.updateAutoresponderCache(guildId, data);
    }
}

function buildPanelButtons(guildConfig) {
    const setupButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('autoresponder_add')
                .setLabel('Add Response')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Add:1521227828199293152>'),
            new ButtonBuilder()
                .setCustomId('autoresponder_list')
                .setLabel('List All')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Bookopen:1521227911137595605>'),
            new ButtonBuilder()
                .setCustomId('autoresponder_remove')
                .setLabel('Remove Response')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>')
        );

    const controlButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('autoresponder_toggle')
                .setLabel(guildConfig.enabled ? 'Disable' : 'Enable')
                .setStyle(guildConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(guildConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
            new ButtonBuilder()
                .setCustomId('autoresponder_clear')
                .setLabel('Clear All')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>')
        );

    return { setupButtons, controlButtons };
}

function buildPanelContent(guildConfig) {
    const statusText = guildConfig.enabled ? '<:Toggleon:1521227758011809964>  **Enabled**' : '<:Toggleoff:1521227763816595559> **Disabled**';
    const countText = `**Total Responses:** ${guildConfig.responses?.length || 0}`;

    return `# <:Fire:1521227907647668374> Autoresponder System\n\n**Status:** ${statusText}\n${countText}\n\n**Setup autoresponders to automatically reply when users send specific messages!**\n\n**How it works:**\n<:Add:1521227828199293152> **Add Response** - Create a new trigger → response pair\n<:Bookopen:1521227911137595605> **List All** - View all configured responses\n<:Trash:1521227750420254820> **Remove Response** - Delete a specific response\n\n**Controls:**\n${guildConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'} **${guildConfig.enabled ? 'Disable' : 'Enable'}** - Turn the system on/off\n<:Trash:1521227750420254820> **Clear All** - Remove all responses\n\n**Tips:**\n• Triggers are case-insensitive\n• Triggers can be partial matches (e.g., "hello" matches "hello there")\n• Supports Components v2 for beautiful responses!\n\n**Slash Commands:**\n\`/autoresponder add\` - Add a response directly\n\`/autoresponder remove\` - Remove by number\n\`/autoresponder list\` - View all responses\n\`/autoresponder toggle\` - Enable/disable\n\`/autoresponder clear\` - Remove all`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoresponder')
        .setDescription('Setup autoresponder system to automatically reply to messages')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Open the autoresponder setup panel'))
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a new autoresponse trigger')
                .addStringOption(opt =>
                    opt.setName('trigger')
                        .setDescription('Message content to match (case-insensitive)')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('response')
                        .setDescription('Response message to send')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove an autoresponse by number')
                .addIntegerOption(opt =>
                    opt.setName('number')
                        .setDescription('The number of the response to remove (from /autoresponder list)')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('View all configured autoresponses'))
        .addSubcommand(sub =>
            sub.setName('toggle')
                .setDescription('Enable or disable the autoresponder system'))
        .addSubcommand(sub =>
            sub.setName('clear')
                .setDescription('Remove all autoresponses'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    prefix: 'autoresponder',
    aliases: ['autoresponse', 'ares'],
    description: 'Setup autoresponder system to automatically reply to messages',
    category: 'automation',
    usage: 'autoresponder [setup/add/remove/list/toggle/clear]',

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const config = loadConfig();
        const guildId = interaction.guild.id;
        const guildConfig = ensureGuildConfig(config, guildId);

        try {
            if (subcommand === 'setup') {
                await this.showPanel(interaction, guildConfig);
            } else if (subcommand === 'add') {
                await this.handleAdd(interaction, config, guildId, guildConfig);
            } else if (subcommand === 'remove') {
                await this.handleRemove(interaction, config, guildId, guildConfig);
            } else if (subcommand === 'list') {
                await this.handleList(interaction, guildConfig);
            } else if (subcommand === 'toggle') {
                await this.handleToggle(interaction, config, guildId, guildConfig);
            } else if (subcommand === 'clear') {
                await this.handleClear(interaction, config, guildId, guildConfig);
            }
        } catch (error) {
            console.error('Autoresponder command error:', error);
            const errMsg = '<:Cancel:1521227723916181644> An error occurred processing this command.';
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: errMsg, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    },

    async showPanel(interaction, guildConfig) {
        const { setupButtons, controlButtons } = buildPanelButtons(guildConfig);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(buildPanelContent(guildConfig)))
            .addActionRowComponents(setupButtons)
            .addActionRowComponents(controlButtons);

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async handleAdd(interaction, config, guildId, guildConfig) {
        const trigger = interaction.options.getString('trigger').toLowerCase();
        const response = interaction.options.getString('response');

        // Check for duplicate trigger
        const existing = guildConfig.responses.find(r => r.trigger === trigger);
        if (existing) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> A response for trigger \`${trigger}\` already exists! Remove it first.`,
                flags: MessageFlags.Ephemeral
            });
        }

        guildConfig.responses.push({ trigger, response });
        saveConfig(config);
        updateCache(guildId, config[guildId]);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Autoresponse Added\n\n` +
                    `**Trigger:** \`${trigger}\`\n` +
                    `**Response:** ${response.substring(0, 100)}${response.length > 100 ? '...' : ''}\n\n` +
                    `-# Total responses: ${guildConfig.responses.length}` +
                    `${!guildConfig.enabled ? '\n\n⚠️ **Note:** System is currently disabled. Use \`/autoresponder toggle\` to enable.' : ''}`
                )
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleRemove(interaction, config, guildId, guildConfig) {
        const number = interaction.options.getInteger('number');
        const index = number - 1;

        if (index < 0 || index >= guildConfig.responses.length) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Invalid number! Use \`/autoresponder list\` to see responses (1-${guildConfig.responses.length}).`,
                flags: MessageFlags.Ephemeral
            });
        }

        const removed = guildConfig.responses.splice(index, 1)[0];
        saveConfig(config);
        updateCache(guildId, config[guildId]);

        await interaction.reply({
            content: `<:Checkedbox:1521227734943269077> Removed autoresponse: \`${removed.trigger}\``,
            flags: MessageFlags.Ephemeral
        });
    },

    async handleList(interaction, guildConfig) {
        if (!guildConfig.responses || guildConfig.responses.length === 0) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Fire:1521227907647668374> No Autoresponses\n\n` +
                        `You haven't set any autoresponses yet.\n\n` +
                        `**Get started:**\n` +
                        `\`/autoresponder add trigger:hello response:Hi there! 👋\`\n\n` +
                        `Or use \`/autoresponder setup\` for the interactive panel.`
                    )
                );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        // Build response lines first, then trim to fit Discord's 4 000-char
        // per-TextDisplay cap. With many or long responses, the naive
        // concat would exceed the cap and Discord would reject the panel.
        const lineEntries = guildConfig.responses.map((item, index) => {
            const truncResponse = item.response.substring(0, 50);
            return `**${index + 1}.** \`${item.trigger}\`\n-# → ${truncResponse}${item.response.length > 50 ? '...' : ''}`;
        });
        const { content: listText } = buildSafeListText({
            header:
                `# <:Fire:1521227907647668374> Autoresponse List\n` +
                `**Status:** ${guildConfig.enabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n`,
            lines: lineEntries,
            separator: '\n\n',
            footer: `-# Use \`/autoresponder remove number:<n>\` to remove a response`,
            overflowHint: '\n\n-# +${n} more not shown — remove some entries to see them all',
        });

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(listText));

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleToggle(interaction, config, guildId, guildConfig) {
        guildConfig.enabled = !guildConfig.enabled;
        saveConfig(config);
        updateCache(guildId, config[guildId]);

        await interaction.reply({
            content: `${guildConfig.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>'} Autoresponder system **${guildConfig.enabled ? 'enabled' : 'disabled'}**!`,
            flags: MessageFlags.Ephemeral
        });
    },

    async handleClear(interaction, config, guildId, guildConfig) {
        const count = guildConfig.responses.length;
        guildConfig.responses = [];
        saveConfig(config);
        updateCache(guildId, config[guildId]);

        await interaction.reply({
            content: `<:Trash:1521227750420254820> Cleared **${count}** autoresponse(s)!`,
            flags: MessageFlags.Ephemeral
        });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Manage Guild** permission to use this command!');
        }

        const config = loadConfig();
        const guildId = message.guild.id;
        const guildConfig = ensureGuildConfig(config, guildId);

        const subcommand = args[0]?.toLowerCase();

        // No args or 'setup' — show interactive panel
        if (!subcommand || subcommand === 'setup' || subcommand === 'help') {
            const { setupButtons, controlButtons } = buildPanelButtons(guildConfig);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(buildPanelContent(guildConfig)))
                .addActionRowComponents(setupButtons)
                .addActionRowComponents(controlButtons);

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (subcommand === 'add') {
            const trigger = args[1]?.toLowerCase();
            const response = args.slice(2).join(' ');
            if (!trigger || !response) {
                return message.reply('<:Cancel:1521227723916181644> **Usage:** `-autoresponder add <trigger> <response>`\n**Example:** `-autoresponder add hello Hi there! Welcome!`');
            }
            const existing = guildConfig.responses.find(r => r.trigger === trigger);
            if (existing) {
                return message.reply(`<:Cancel:1521227723916181644> A response for trigger \`${trigger}\` already exists! Remove it first.`);
            }
            guildConfig.responses.push({ trigger, response });
            saveConfig(config);
            updateCache(guildId, config[guildId]);
            return message.reply(`<:Checkedbox:1521227734943269077> Autoresponse added!\n**Trigger:** \`${trigger}\`\n**Response:** ${response.substring(0, 100)}`);
        }

        if (subcommand === 'remove') {
            const index = parseInt(args[1]) - 1;
            if (isNaN(index) || index < 0 || index >= guildConfig.responses.length) {
                return message.reply(`<:Cancel:1521227723916181644> Invalid number! Use \`-autoresponder list\` to see responses (1-${guildConfig.responses.length}).`);
            }
            const removed = guildConfig.responses.splice(index, 1)[0];
            saveConfig(config);
            updateCache(guildId, config[guildId]);
            return message.reply(`<:Checkedbox:1521227734943269077> Removed autoresponse: \`${removed.trigger}\``);
        }

        if (subcommand === 'list') {
            if (!guildConfig.responses.length) {
                return message.reply('<:Cancel:1521227723916181644> No autoresponses configured.');
            }
            const lineEntries = guildConfig.responses.map((item, i) =>
                `**${i + 1}.** \`${item.trigger}\` → ${item.response.substring(0, 50)}${item.response.length > 50 ? '...' : ''}`
            );
            const { content: listText } = buildSafeListText({
                header: `# <:Fire:1521227907647668374> Autoresponses`,
                lines: lineEntries,
                separator: '\n',
                overflowHint: '\n-# +${n} more not shown — remove some entries to see them all',
            });
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(listText));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (subcommand === 'toggle') {
            guildConfig.enabled = !guildConfig.enabled;
            saveConfig(config);
            updateCache(guildId, config[guildId]);
            return message.reply(`<:Checkedbox:1521227734943269077> Autoresponder **${guildConfig.enabled ? 'enabled' : 'disabled'}**!`);
        }

        if (subcommand === 'clear') {
            const count = guildConfig.responses.length;
            guildConfig.responses = [];
            saveConfig(config);
            updateCache(guildId, config[guildId]);
            return message.reply(`<:Trash:1521227750420254820> Cleared **${count}** autoresponse(s)!`);
        }

        return message.reply('<:Lightbulbalt:1521227880703463675> Unknown subcommand. Use `-autoresponder setup` for the panel or try: `add`, `remove`, `list`, `toggle`, `clear`');
    }
};
