const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { buildErrorResponse, buildPermissionDenied, buildRoleHierarchyError, buildRoleNotFound, buildInvalidUsage, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');

module.exports = {
    name: 'role-position-set',
    prefix: 'role-position-set',
    description: 'Set the position of a role in the hierarchy',
    category: 'admin',
    usage: 'role-position-set <@role> <position>',
    permissions: ['ManageRoles'],
    data: new SlashCommandBuilder()
        .setName('role-position-set')
        .setDescription('Set the position of a role in the hierarchy')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to reposition')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('position')
                .setDescription('The new position number (0 or greater)')
                .setRequired(true)
                .setMinValue(0)),

    async execute(interaction) {
        try {
            const role = interaction.options.getRole('role');
            const position = interaction.options.getInteger('position');

            if (role.id === interaction.guild.id) {
                const container = buildErrorResponse('Invalid Role', 'You cannot modify the @everyone role position.');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (role.managed) {
                const container = buildErrorResponse('Managed Role', `**${role.name}** is managed by a bot/integration and cannot be repositioned.`);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                const container = buildRoleHierarchyError('reposition this role');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            await role.setPosition(position, { reason: `Set by ${interaction.user.username}` });

            const container = buildSuccessResponse(
                'Role Position Set',
                `${role} position has been set to **${position}**.`,
                { 'Role': role.name, 'Position': `${position}`, 'Moderator': interaction.user.username },
                true
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[RolePositionSet] Slash Error:', error);
            const container = buildErrorResponse('Failed to Set Position', 'An error occurred while setting the role position.', `Error: ${error.message}`);
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
                const container = buildInvalidUsage('role-position-set', '-role-position-set @role <position>', ['-role-position-set @Members 5']);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.id === message.guild.id) {
                const container = buildErrorResponse('Invalid Role', 'You cannot modify the @everyone role position.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.managed) {
                const container = buildErrorResponse('Managed Role', `**${role.name}** is managed by a bot/integration and cannot be repositioned.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.position >= message.guild.members.me.roles.highest.position) {
                const container = buildRoleHierarchyError('reposition this role');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const position = parseInt(args[1]);
            if (isNaN(position) || position < 0) {
                const container = buildErrorResponse('Invalid Position', 'Please provide a valid position number (0 or greater).');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            await role.setPosition(position, { reason: `Set by ${message.author.username}` });

            const container = buildSuccessResponse(
                'Role Position Set',
                `${role} position has been set to **${position}**.`,
                { 'Role': role.name, 'Position': `${position}`, 'Moderator': message.author.username },
                true
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[RolePositionSet] Error:', error);
            const container = buildErrorResponse('Failed to Set Position', 'An error occurred while setting the role position.', `Error: ${error.message}`);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
