const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { buildErrorResponse, buildPermissionDenied, buildRoleHierarchyError, buildRoleNotFound, buildInvalidUsage, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');

module.exports = {
    name: 'role-icon',
    prefix: 'role-icon',
    description: 'Set or remove role icon (requires boost level 2)',
    category: 'admin',
    usage: 'role-icon <@role> <emoji|remove>',
    permissions: ['ManageRoles'],
    data: new SlashCommandBuilder()
        .setName('role-icon')
        .setDescription('Set or remove a role icon (requires boost level 2)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to set the icon for')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('icon')
                .setDescription('Emoji to set as icon, or "remove" to clear it')
                .setRequired(true)),

    async execute(interaction) {
        try {
            if (interaction.guild.premiumTier < 2) {
                const container = buildErrorResponse('Boost Level Required', 'This server needs **Boost Level 2** or higher to use role icons.');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const role = interaction.options.getRole('role');
            const iconArg = interaction.options.getString('icon');

            if (role.id === interaction.guild.id) {
                const container = buildErrorResponse('Invalid Role', 'You cannot set an icon for the @everyone role.');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (role.managed) {
                const container = buildErrorResponse('Managed Role', `**${role.name}** is managed by a bot/integration and cannot be modified.`);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                const container = buildRoleHierarchyError('modify this role');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (iconArg.toLowerCase() === 'remove') {
                await role.setIcon(null, `Icon removed by ${interaction.user.username}`);
                const container = buildSuccessResponse(
                    'Role Icon Removed',
                    `Successfully removed the icon from ${role}.`,
                    { 'Role': role.name, 'Moderator': interaction.user.username },
                    true
                );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            await role.setIcon(iconArg, `Icon set by ${interaction.user.username}`);

            const container = buildSuccessResponse(
                'Role Icon Set',
                `Successfully set the icon for ${role}.`,
                { 'Role': role.name, 'Icon': iconArg, 'Moderator': interaction.user.username },
                true
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[RoleIcon] Slash Error:', error);
            const container = buildErrorResponse('Failed to Set Icon', 'An error occurred while setting the role icon.', `Error: ${error.message}`);
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            } else {
                await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    },

    async executePrefix(message, args) {
        if (!message.guild) return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            const container = buildPermissionDenied('Manage Roles');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            if (message.guild.premiumTier < 2) {
                const container = buildErrorResponse('Boost Level Required', 'This server needs **Boost Level 2** or higher to use role icons.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const role = message.mentions.roles.first();
            if (!role) {
                const container = buildInvalidUsage('role-icon', '-role-icon @role <emoji|remove>', ['-role-icon @VIP 🌟', '-role-icon @Members remove']);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.id === message.guild.id) {
                const container = buildErrorResponse('Invalid Role', 'You cannot set an icon for the @everyone role.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.managed) {
                const container = buildErrorResponse('Managed Role', `**${role.name}** is managed by a bot/integration and cannot be modified.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.position >= message.guild.members.me.roles.highest.position) {
                const container = buildRoleHierarchyError('modify this role');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const iconArg = args[1];
            if (!iconArg) {
                const container = buildInvalidUsage('role-icon', '-role-icon @role <emoji|remove>', ['-role-icon @VIP 🌟', '-role-icon @Members remove']);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (iconArg.toLowerCase() === 'remove') {
                await role.setIcon(null, `Icon removed by ${message.author.username}`);
                const container = buildSuccessResponse(
                    'Role Icon Removed',
                    `Successfully removed the icon from ${role}.`,
                    { 'Role': role.name, 'Moderator': message.author.username },
                    true
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            await role.setIcon(iconArg, `Icon set by ${message.author.username}`);

            const container = buildSuccessResponse(
                'Role Icon Set',
                `Successfully set the icon for ${role}.`,
                { 'Role': role.name, 'Icon': iconArg, 'Moderator': message.author.username },
                true
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[RoleIcon] Error:', error);
            const container = buildErrorResponse('Failed to Set Icon', 'An error occurred while setting the role icon.', `Error: ${error.message}`);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
