const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { buildSafeListText } = require('../../utils/componentHelpers');

function loadConfig() {
    if (!jsonStore.has('autoreact')) {
        jsonStore.write('autoreact', {});
        return {};
    }
    try {
        return jsonStore.read('autoreact');
    } catch (error) {
        console.error('Error loading autoreact config:', error);
        return {};
    }
}

function saveConfig(config) {
    jsonStore.write('autoreact', config);
}

function ensureGuildConfig(config, guildId) {
    if (!config[guildId]) {
        config[guildId] = { enabled: false, reactions: [] };
    }
    if (!config[guildId].reactions) {
        config[guildId].reactions = [];
    }
    return config[guildId];
}

function updateCache(guildId, data) {
    if (global.updateAutoreactCache) {
        global.updateAutoreactCache(guildId, data);
    }
}

function buildPanelButtons(guildConfig) {
    const setupButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('autoreact_add')
                .setLabel('Add Reaction')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Add:1521227828199293152>'),
            new ButtonBuilder()
                .setCustomId('autoreact_list')
                .setLabel('List All')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Bookopen:1521227911137595605>'),
            new ButtonBuilder()
                .setCustomId('autoreact_remove')
                .setLabel('Remove Reaction')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>')
        );

    const controlButtons = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('autoreact_toggle')
                .setLabel(guildConfig.enabled ? 'Disable' : 'Enable')
                .setStyle(guildConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
                .setEmoji(guildConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
            new ButtonBuilder()
                .setCustomId('autoreact_clear')
                .setLabel('Clear All')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>')
        );

    return { setupButtons, controlButtons };
}

function buildPanelContent(guildConfig) {
    const statusText = guildConfig.enabled ? '<:Toggleon:1521227758011809964>  **Enabled**' : '<:Toggleoff:1521227763816595559> **Disabled**';
    const countText = `**Total Reactions:** ${guildConfig.reactions?.length || 0}`;

    return `# 😄 Autoreact System\n\n**Status:** ${statusText}\n${countText}\n\n**Setup autoreactions to automatically react when users send specific messages!**\n\n**How it works:**\n<:Add:1521227828199293152> **Add Reaction** - Create a trigger → emoji reaction\n<:Bookopen:1521227911137595605> **List All** - View all configured reactions\n<:Trash:1521227750420254820> **Remove Reaction** - Delete a specific reaction\n\n**Controls:**\n${guildConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'} **${guildConfig.enabled ? 'Disable' : 'Enable'}** - Turn the system on/off\n<:Trash:1521227750420254820> **Clear All** - Remove all reactions\n\n**Emoji Support:**\n• Unicode emojis: 😀, 👍, <:Heart:1521228100652765247>, etc.\n• Custom server emojis: :emojiname:\n• Multiple reactions per trigger!\n\n**Tips:**\n• Triggers are case-insensitive\n• Triggers can be partial matches\n\n**Slash Commands:**\n\`/autoreact add\` - Add a reaction directly\n\`/autoreact remove\` - Remove by number\n\`/autoreact list\` - View all reactions\n\`/autoreact toggle\` - Enable/disable\n\`/autoreact clear\` - Remove all`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autoreact')
        .setDescription('Setup autoreact system to automatically react to messages')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Open the autoreact setup panel'))
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('Add a new autoreaction trigger')
                .addStringOption(opt =>
                    opt.setName('trigger')
                        .setDescription('Message content to match (case-insensitive)')
                        .setRequired(true))
                .addStringOption(opt =>
                    opt.setName('emojis')
                        .setDescription('Emojis to react with (space-separated)')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove an autoreaction by number')
                .addIntegerOption(opt =>
                    opt.setName('number')
                        .setDescription('The number of the reaction to remove (from /autoreact list)')
                        .setRequired(true)
                        .setMinValue(1)))
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('View all configured autoreactions'))
        .addSubcommand(sub =>
            sub.setName('toggle')
                .setDescription('Enable or disable the autoreact system'))
        .addSubcommand(sub =>
            sub.setName('clear')
                .setDescription('Remove all autoreactions'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    prefix: 'autoreact',
    aliases: ['ar'],
    description: 'Setup autoreact system to automatically react to messages',
    category: 'automation',
    usage: 'autoreact [setup/add/remove/list/toggle/clear]',

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
            console.error('Autoreact command error:', error);
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
        const emojisInput = interaction.options.getString('emojis');
        const emojis = emojisInput.split(/\s+/).filter(e => e.trim());

        if (emojis.length === 0) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Please provide at least one emoji!', flags: MessageFlags.Ephemeral });
        }

        // Check for duplicate trigger
        const existing = guildConfig.reactions.find(r => r.trigger === trigger);
        if (existing) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> A reaction for trigger \`${trigger}\` already exists! Remove it first.`,
                flags: MessageFlags.Ephemeral
            });
        }

        guildConfig.reactions.push({ trigger, emojis });
        saveConfig(config);
        updateCache(guildId, config[guildId]);

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Autoreaction Added\n\n` +
                    `**Trigger:** \`${trigger}\`\n` +
                    `**Emojis:** ${emojis.join(' ')}\n\n` +
                    `-# Total reactions: ${guildConfig.reactions.length}` +
                    `${!guildConfig.enabled ? '\n\n⚠️ **Note:** System is currently disabled. Use \`/autoreact toggle\` to enable.' : ''}`
                )
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async handleRemove(interaction, config, guildId, guildConfig) {
        const number = interaction.options.getInteger('number');
        const index = number - 1;

        if (index < 0 || index >= guildConfig.reactions.length) {
            return interaction.reply({
                content: `<:Cancel:1521227723916181644> Invalid number! Use \`/autoreact list\` to see available reactions (1-${guildConfig.reactions.length}).`,
                flags: MessageFlags.Ephemeral
            });
        }

        const removed = guildConfig.reactions.splice(index, 1)[0];
        saveConfig(config);
        updateCache(guildId, config[guildId]);

        await interaction.reply({
            content: `<:Checkedbox:1521227734943269077> Removed autoreaction: \`${removed.trigger}\` → ${removed.emojis.join(' ')}`,
            flags: MessageFlags.Ephemeral
        });
    },

    async handleList(interaction, guildConfig) {
        if (!guildConfig.reactions || guildConfig.reactions.length === 0) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# 😄 No Autoreactions\n\n` +
                        `You haven't set any autoreactions yet.\n\n` +
                        `**Get started:**\n` +
                        `\`/autoreact add trigger:hello emojis:👋 😄\`\n\n` +
                        `Or use \`/autoreact setup\` for the interactive panel.`
                    )
                );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const lineEntries = guildConfig.reactions.map((item, index) =>
            `**${index + 1}.** \`${item.trigger}\` → ${item.emojis.join(' ')}`
        );
        const { content: listText } = buildSafeListText({
            header:
                `# 😄 Autoreaction List\n` +
                `**Status:** ${guildConfig.enabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n`,
            lines: lineEntries,
            separator: '\n',
            footer: `\n-# Use \`/autoreact remove number:<n>\` to remove a reaction`,
            overflowHint: '\n-# +${n} more not shown — remove some entries to see them all',
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
            content: `${guildConfig.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>'} Autoreact system **${guildConfig.enabled ? 'enabled' : 'disabled'}**!`,
            flags: MessageFlags.Ephemeral
        });
    },

    async handleClear(interaction, config, guildId, guildConfig) {
        const count = guildConfig.reactions.length;
        guildConfig.reactions = [];
        saveConfig(config);
        updateCache(guildId, config[guildId]);

        await interaction.reply({
            content: `<:Trash:1521227750420254820> Cleared **${count}** autoreaction(s)!`,
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
            const emojis = args.slice(2);
            if (!trigger || emojis.length === 0) {
                return message.reply('<:Cancel:1521227723916181644> **Usage:** `-autoreact add <trigger> <emoji1> [emoji2...]`\n**Example:** `-autoreact add hello 👋 😄`');
            }
            const existing = guildConfig.reactions.find(r => r.trigger === trigger);
            if (existing) {
                return message.reply(`<:Cancel:1521227723916181644> A reaction for trigger \`${trigger}\` already exists! Remove it first.`);
            }
            guildConfig.reactions.push({ trigger, emojis });
            saveConfig(config);
            updateCache(guildId, config[guildId]);
            return message.reply(`<:Checkedbox:1521227734943269077> Autoreaction added!\n**Trigger:** \`${trigger}\`\n**Emojis:** ${emojis.join(' ')}`);
        }

        if (subcommand === 'remove') {
            const index = parseInt(args[1]) - 1;
            if (isNaN(index) || index < 0 || index >= guildConfig.reactions.length) {
                return message.reply(`<:Cancel:1521227723916181644> Invalid number! Use \`-autoreact list\` to see reactions (1-${guildConfig.reactions.length}).`);
            }
            const removed = guildConfig.reactions.splice(index, 1)[0];
            saveConfig(config);
            updateCache(guildId, config[guildId]);
            return message.reply(`<:Checkedbox:1521227734943269077> Removed: \`${removed.trigger}\` → ${removed.emojis.join(' ')}`);
        }

        if (subcommand === 'list') {
            if (!guildConfig.reactions.length) {
                return message.reply('<:Cancel:1521227723916181644> No autoreactions configured.');
            }
            const lineEntries = guildConfig.reactions.map((item, i) =>
                `**${i + 1}.** \`${item.trigger}\` → ${item.emojis.join(' ')}`
            );
            const { content: listText } = buildSafeListText({
                header: `# 😄 Autoreactions`,
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
            return message.reply(`<:Checkedbox:1521227734943269077> Autoreact **${guildConfig.enabled ? 'enabled' : 'disabled'}**!`);
        }

        if (subcommand === 'clear') {
            const count = guildConfig.reactions.length;
            guildConfig.reactions = [];
            saveConfig(config);
            updateCache(guildId, config[guildId]);
            return message.reply(`<:Trash:1521227750420254820> Cleared **${count}** autoreaction(s)!`);
        }

        return message.reply('<:Lightbulbalt:1521227880703463675> Unknown subcommand. Use `-autoreact setup` for the panel or try: `add`, `remove`, `list`, `toggle`, `clear`');
    }
};
