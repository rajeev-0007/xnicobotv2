const { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse } = require('../../utils/responseBuilder');

const jsonStore = require('../../utils/jsonStore');

function loadConfig() {
    if (!jsonStore.has('autonick')) {
        jsonStore.write('autonick', {});
        return {};
    }
    return jsonStore.read('autonick');
}

function saveConfig(config) {
    jsonStore.write('autonick', config);
}

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite message instead of execution.
     */
    premiumOnly: true,

    data: new SlashCommandBuilder()
        .setName('autonick')
        .setDescription('Setup auto-nickname for new members')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('Set auto-nickname format')
                .addStringOption(opt =>
                    opt.setName('format')
                        .setDescription('Nickname format (use {user} for username)')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('disable')
                .setDescription('Disable auto-nickname'))
        .addSubcommand(sub =>
            sub.setName('info')
                .setDescription('View current configuration')),

    prefix: 'autonick',
    description: 'Setup auto-nickname for new members',
    usage: 'autonick <setup/disable/info>',
    category: 'automation',

    async execute(interaction) {
        try {
        const config = loadConfig();
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'setup') {
            const format = interaction.options.getString('format');

            config[interaction.guild.id] = {
                format: format,
                enabled: true
            };
            saveConfig(config);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Toggleon:1521227758011809964> AutoNick Enabled\n\n` +
                        `**Format:** ${format}\n` +
                        `**Example:** ${format.replace(/{user}/g, interaction.user.username)}\n\n` +
                        `**Set by:** ${interaction.user.username}`
                    )
                );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (subcommand === 'disable') {
            if (config[interaction.guild.id]) {
                config[interaction.guild.id].enabled = false;
                saveConfig(config);
            }
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Toggleoff:1521227763816595559> AutoNick Disabled\n\nAuto-nickname system has been disabled.`
                    )
                );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (subcommand === 'info') {
            const guildConfig = config[interaction.guild.id];
            if (!guildConfig || !guildConfig.enabled) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Folder:1521228095225331765> AutoNick Status\n\n` +
                            `**Status:** <:Toggleoff:1521227763816595559> Disabled\n\n` +
                            `Use \`/autonick setup\` to enable it.`
                        )
                    );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Folder:1521228095225331765> AutoNick Configuration\n\n` +
                        `**Status:** <:Toggleon:1521227758011809964> Enabled\n` +
                        `**Format:** ${guildConfig.format}`
                    )
                );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        } catch (error) {
            console.error('[AutoNick] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Permission Denied\n\nYou need the **Manage Nicknames** permission!`
                    )
                );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
        const config = loadConfig();
        const subcommand = args[0]?.toLowerCase();

        if (subcommand === 'setup') {
            const formatInput = args.slice(1).join(' ');
            if (!formatInput) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Cancel:1521227723916181644> Missing Format\n\n` +
                            `Please provide a nickname format!\n\n` +
                            `**Usage:** \`-autonick setup Name {user}\`\n` +
                            `**Variable:** \`{user}\` - Username`
                        )
                    );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            config[message.guild.id] = {
                format: formatInput,
                enabled: true
            };
            saveConfig(config);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Toggleon:1521227758011809964> AutoNick Enabled\n\n` +
                        `**Format:** ${formatInput}\n` +
                        `**Example:** ${formatInput.replace(/{user}/g, message.author.username)}\n\n` +
                        `**Set by:** ${message.author.username}`
                    )
                );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (subcommand === 'disable') {
            if (config[message.guild.id]) {
                config[message.guild.id].enabled = false;
                saveConfig(config);
            }
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Toggleoff:1521227763816595559> AutoNick Disabled\n\nAuto-nickname system has been disabled.`
                    )
                );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (subcommand === 'info') {
            const guildConfig = config[message.guild.id];
            if (!guildConfig || !guildConfig.enabled) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Folder:1521228095225331765> AutoNick Status\n\n` +
                            `**Status:** <:Toggleoff:1521227763816595559> Disabled\n\n` +
                            `Use \`-autonick setup <format>\` to enable it.`
                        )
                    );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Folder:1521228095225331765> AutoNick Configuration\n\n` +
                        `**Status:** <:Toggleon:1521227758011809964> Enabled\n` +
                        `**Format:** ${guildConfig.format}`
                    )
                );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Folder:1521228095225331765> AutoNick\n\n` +
                    `**Usage:**\n` +
                    `\`-autonick setup Name {user}\` - Set format\n` +
                    `\`-autonick info\` - View config\n` +
                    `\`-autonick disable\` - Disable system\n\n` +
                    `**Variables:** \`{user}\` = username`
                )
            );
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[AutoNick] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
