const { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');

function loadConfig() {
    if (!jsonStore.has('autorole')) {
        jsonStore.write('autorole', {});
        return {};
    }
    try {
        return jsonStore.read('autorole');
    } catch {
        return {};
    }
}

function saveConfig(config) {
    jsonStore.write('autorole', config);
}

// Ensure guild config has the correct shape { humans: [], bots: [] }
function ensureGuildConfig(config, guildId) {
    if (!config[guildId] || typeof config[guildId] !== 'object' || Array.isArray(config[guildId])) {
        // Migrate from old format (bare string roleId) to new format
        const oldRoleId = typeof config[guildId] === 'string' ? config[guildId] : null;
        config[guildId] = {
            humans: oldRoleId ? [oldRoleId] : [],
            bots: []
        };
    }
    if (!Array.isArray(config[guildId].humans)) config[guildId].humans = [];
    if (!Array.isArray(config[guildId].bots)) config[guildId].bots = [];
    return config[guildId];
}

function validateRole(role, guild) {
    if (!role) return 'Invalid role! Please mention a valid role or provide a role ID.';
    if (role.position >= guild.members.me.roles.highest.position) return `I cannot assign ${role} because it is higher than or equal to my highest role.`;
    if (role.managed) return 'This role is managed by an integration and cannot be used.';
    return null;
}

function buildStatusPanel(guildConfig, guild) {
    const hasHumans = guildConfig.humans.length > 0;
    const hasBots = guildConfig.bots.length > 0;
    const isActive = hasHumans || hasBots;

    let content = `# <:Bookopen:1521227911137595605> Autorole Status\n\n`;
    content += `**Status:** ${isActive ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled'}\n\n`;

    if (hasHumans) {
        const humanRoles = guildConfig.humans.map(id => {
            const r = guild.roles.cache.get(id);
            return r ? `${r}` : `*Unknown (${id})*`;
        }).join(', ');
        content += `**Human Roles:** ${humanRoles}\n`;
    } else {
        content += `**Human Roles:** None\n`;
    }

    if (hasBots) {
        const botRoles = guildConfig.bots.map(id => {
            const r = guild.roles.cache.get(id);
            return r ? `${r}` : `*Unknown (${id})*`;
        }).join(', ');
        content += `**Bot Roles:** ${botRoles}\n`;
    } else {
        content += `**Bot Roles:** None\n`;
    }

    if (!isActive) {
        content += `\nUse \`/autorole humans @role\` or \`/autorole bots @role\` to configure.`;
    }

    return new ContainerBuilder()
        .setAccentColor(isActive ? 0x57F287 : 0xFEE75C)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('autorole')
        .setDescription('Automatically assign roles to new members (humans & bots separately)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addSubcommand(sub =>
            sub.setName('humans')
                .setDescription('Set autorole for human members')
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('Role to give new human members')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('bots')
                .setDescription('Set autorole for bots')
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('Role to give new bots')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('Remove an autorole')
                .addStringOption(opt =>
                    opt.setName('type')
                        .setDescription('Remove from humans or bots')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Humans', value: 'humans' },
                            { name: 'Bots', value: 'bots' }
                        ))
                .addRoleOption(opt =>
                    opt.setName('role')
                        .setDescription('Role to remove from autorole')
                        .setRequired(true)))
        .addSubcommand(sub =>
            sub.setName('disable')
                .setDescription('Disable all autoroles'))
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('View current autorole configuration')),

    prefix: 'autorole',
    description: 'Automatically assign roles to new members (humans & bots separately)',
    usage: 'autorole <humans/bots/remove/disable/status> [@role]',
    category: 'automation',

    async execute(interaction) {
        try {
            if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Cancel:1521227723916181644> Bot Missing Permissions\n\nI need the **Manage Roles** permission to assign roles.`
                        )
                    );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const config = loadConfig();
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'humans' || subcommand === 'bots') {
                const role = interaction.options.getRole('role');
                const error = validateRole(role, interaction.guild);
                if (error) {
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${error}`));
                    return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                }

                const guildConfig = ensureGuildConfig(config, interaction.guild.id);

                if (guildConfig[subcommand].includes(role.id)) {
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# <:Cancel:1521227723916181644> Already Configured\n\n${role} is already in the **${subcommand}** autorole list.`
                        ));
                    return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                }

                guildConfig[subcommand].push(role.id);
                saveConfig(config);

                const label = subcommand === 'humans' ? 'human members' : 'bots';
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Autorole Configured\n\n` +
                        `${role} will now be assigned to new **${label}** when they join.\n\n` +
                        `**Total ${subcommand} roles:** ${guildConfig[subcommand].length}\n` +
                        `**Configured by:** ${interaction.user.username}`
                    ));
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (subcommand === 'remove') {
                const type = interaction.options.getString('type');
                const role = interaction.options.getRole('role');
                const guildConfig = ensureGuildConfig(config, interaction.guild.id);

                const index = guildConfig[type].indexOf(role.id);
                if (index === -1) {
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# <:Cancel:1521227723916181644> Not Found\n\n${role} is not in the **${type}** autorole list.`
                        ));
                    return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                }

                guildConfig[type].splice(index, 1);
                saveConfig(config);

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Autorole Removed\n\n${role} has been removed from the **${type}** autorole list.`
                    ));
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (subcommand === 'disable') {
                delete config[interaction.guild.id];
                saveConfig(config);

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Toggleoff:1521227763816595559> Autorole Disabled\n\nAll autoroles have been cleared. New members will no longer receive automatic roles.`
                    ));
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (subcommand === 'status') {
                const guildConfig = ensureGuildConfig(config, interaction.guild.id);
                const container = buildStatusPanel(guildConfig, interaction.guild);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
        } catch (error) {
            console.error('Autorole execute error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred!', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    },

    async executePrefix(message, args) {
        try {
            if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Permission Denied\n\nYou need the **Manage Roles** permission.`
                    ));
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Bot Missing Permissions\n\nI need the **Manage Roles** permission to assign roles.`
                    ));
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const config = loadConfig();

            if (!args.length) {
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Shield:1521227694677692467> Autorole\n\n` +
                        `**Usage:**\n` +
                        `\`-autorole humans @role\` - Set autorole for human members\n` +
                        `\`-autorole bots @role\` - Set autorole for bots\n` +
                        `\`-autorole remove humans @role\` - Remove a human autorole\n` +
                        `\`-autorole remove bots @role\` - Remove a bot autorole\n` +
                        `\`-autorole disable\` - Disable all autoroles\n` +
                        `\`-autorole status\` - View current config`
                    ));
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const sub = args[0]?.toLowerCase();

            if (sub === 'disable' || sub === 'off') {
                delete config[message.guild.id];
                saveConfig(config);
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Toggleoff:1521227763816595559> Autorole Disabled\n\nAll autoroles have been cleared.`
                    ));
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (sub === 'status' || sub === 'view') {
                const guildConfig = ensureGuildConfig(config, message.guild.id);
                const container = buildStatusPanel(guildConfig, message.guild);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (sub === 'remove') {
                const type = args[1]?.toLowerCase();
                if (type !== 'humans' && type !== 'bots') {
                    return message.reply('<:Cancel:1521227723916181644> Usage: `-autorole remove humans/bots @role`');
                }
                const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[2]);
                if (!role) {
                    return message.reply('<:Cancel:1521227723916181644> Please mention a valid role!');
                }
                const guildConfig = ensureGuildConfig(config, message.guild.id);
                const index = guildConfig[type].indexOf(role.id);
                if (index === -1) {
                    return message.reply(`<:Cancel:1521227723916181644> ${role} is not in the **${type}** autorole list.`);
                }
                guildConfig[type].splice(index, 1);
                saveConfig(config);
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Autorole Removed\n\n${role} removed from **${type}** autorole list.`
                    ));
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (sub === 'humans' || sub === 'bots') {
                const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
                const error = validateRole(role, message.guild);
                if (error) {
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${error}`));
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }

                const guildConfig = ensureGuildConfig(config, message.guild.id);
                if (guildConfig[sub].includes(role.id)) {
                    return message.reply(`<:Cancel:1521227723916181644> ${role} is already in the **${sub}** autorole list.`);
                }

                guildConfig[sub].push(role.id);
                saveConfig(config);

                const label = sub === 'humans' ? 'human members' : 'bots';
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Autorole Configured\n\n` +
                        `${role} will now be assigned to new **${label}**.\n\n` +
                        `**Total ${sub} roles:** ${guildConfig[sub].length}\n` +
                        `**Configured by:** ${message.author.username}`
                    ));
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Backwards compatibility: -autorole @role (sets as human autorole)
            const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
            if (role) {
                const error = validateRole(role, message.guild);
                if (error) {
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${error}`));
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }

                const guildConfig = ensureGuildConfig(config, message.guild.id);
                if (!guildConfig.humans.includes(role.id)) {
                    guildConfig.humans.push(role.id);
                }
                saveConfig(config);

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Autorole Configured\n\n` +
                        `${role} will now be assigned to new **human members**.\n\n` +
                        `**Tip:** Use \`-autorole bots @role\` to set a separate bot autorole.\n` +
                        `**Configured by:** ${message.author.username}`
                    ));
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // Unknown subcommand
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Cancel:1521227723916181644> Invalid Usage\n\n` +
                    `Use \`-autorole humans @role\`, \`-autorole bots @role\`, \`-autorole status\`, or \`-autorole disable\``
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Autorole prefix error:', error);
        }
    }
};
