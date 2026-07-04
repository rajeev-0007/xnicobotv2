const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { buildErrorResponse, buildPermissionDenied, buildRoleHierarchyError, buildInvalidUsage, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');

module.exports = {
    prefix: 'role-color',
    description: 'Change a role\'s color',
    usage: 'role-color <@role> <hex color>',
    category: 'admin',
    data: new SlashCommandBuilder()
        .setName('role-color')
        .setDescription('Change a role\'s color')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to change color of')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('color')
                .setDescription('Hex color code (e.g. #FF5733)')
                .setRequired(true)),

    async execute(interaction) {
        try {
            const role = interaction.options.getRole('role');
            const colorArg = interaction.options.getString('color');

            if (role.id === interaction.guild.id) {
                const container = buildErrorResponse('Invalid Role', 'You cannot change the @everyone role color.');
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

            const hexColor = colorArg.replace('#', '');
            if (!/^[0-9A-F]{6}$/i.test(hexColor)) {
                const container = buildErrorResponse('Invalid Color', 'Invalid hex color! Use format: `#RRGGBB` (e.g. `#FF5733`).');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            await role.setColor(`#${hexColor}`, `Color changed by ${interaction.user.username}`);

            const container = buildSuccessResponse(
                'Role Color Changed',
                `Successfully changed the color of ${role}.`,
                { 'Role': role.name, 'New Color': `#${hexColor}`, 'Moderator': interaction.user.username },
                true
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[RoleColor] Slash Error:', error);
            const container = buildErrorResponse('Failed to Change Color', 'An error occurred while changing the role color.', `Error: ${error.message}`);
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
            const role = message.mentions.roles.first();
            if (!role) {
                const container = buildInvalidUsage('role-color', '-role-color @role <hex color>', ['-role-color @Members #FF5733', '-role-color @VIP #00FF00']);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.id === message.guild.id) {
                const container = buildErrorResponse('Invalid Role', 'You cannot change the @everyone role color.');
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

            const colorArg = args[1];
            if (!colorArg) {
                const container = buildErrorResponse('Missing Color', 'Please provide a hex color. Example: `#FF5733`');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const hexColor = colorArg.replace('#', '');

            if (!/^[0-9A-F]{6}$/i.test(hexColor)) {
                const container = buildErrorResponse('Invalid Color', 'Invalid hex color! Use format: `#RRGGBB` (e.g. `#FF5733`).');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            await role.setColor(`#${hexColor}`, `Color changed by ${message.author.username}`);

            const container = buildSuccessResponse(
                'Role Color Changed',
                `Successfully changed the color of ${role}.`,
                { 'Role': role.name, 'New Color': `#${hexColor}`, 'Moderator': message.author.username },
                true
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[RoleColor] Error:', error);
            const container = buildErrorResponse('Failed to Change Color', 'An error occurred while changing the role color.', `Error: ${error.message}`);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
