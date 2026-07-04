const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { buildErrorResponse, buildPermissionDenied, buildRoleHierarchyError, buildRoleNotFound, buildInvalidUsage, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');

module.exports = {
    name: 'move-role',
    prefix: 'move-role',
    description: 'Move a role up or down in hierarchy',
    category: 'admin',
    usage: 'move-role <@role> <up/down> [amount]',
    permissions: ['ManageRoles'],
    data: new SlashCommandBuilder()
        .setName('move-role')
        .setDescription('Move a role up or down in the hierarchy')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to move')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('direction')
                .setDescription('Direction to move the role')
                .setRequired(true)
                .addChoices(
                    { name: 'Up', value: 'up' },
                    { name: 'Down', value: 'down' }
                ))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of positions to move (default: 1)')
                .setRequired(false)
                .setMinValue(1)),

    async execute(interaction) {
        try {
            const role = interaction.options.getRole('role');
            const direction = interaction.options.getString('direction');
            const amount = interaction.options.getInteger('amount') || 1;

            if (role.id === interaction.guild.id) {
                const container = buildErrorResponse('Invalid Role', 'You cannot move the @everyone role.');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (role.managed) {
                const container = buildErrorResponse('Managed Role', `**${role.name}** is managed by a bot/integration and cannot be moved.`);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                const container = buildRoleHierarchyError('move this role');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const newPosition = direction === 'up'
                ? role.position + amount
                : role.position - amount;

            await role.setPosition(newPosition, { reason: `Moved by ${interaction.user.username}` });

            const container = buildSuccessResponse(
                'Role Moved',
                `Successfully moved ${role} **${direction}** by **${amount}** position(s).`,
                { 'Role': role.name, 'Direction': direction, 'Amount': `${amount}`, 'Moderator': interaction.user.username },
                true
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[MoveRole] Slash Error:', error);
            const container = buildErrorResponse('Failed to Move Role', 'An error occurred while moving the role.', `Error: ${error.message}`);
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
                const container = buildInvalidUsage('move-role', '-move-role @role <up/down> [amount]', ['-move-role @Members up 2', '-move-role @VIP down']);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.id === message.guild.id) {
                const container = buildErrorResponse('Invalid Role', 'You cannot move the @everyone role.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.managed) {
                const container = buildErrorResponse('Managed Role', `**${role.name}** is managed by a bot/integration and cannot be moved.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.position >= message.guild.members.me.roles.highest.position) {
                const container = buildRoleHierarchyError('move this role');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const direction = args[1]?.toLowerCase();
            if (!direction || (direction !== 'up' && direction !== 'down')) {
                const container = buildErrorResponse('Invalid Direction', 'Please specify `up` or `down`.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const amount = parseInt(args[2]) || 1;
            const newPosition = direction === 'up'
                ? role.position + amount
                : role.position - amount;

            await role.setPosition(newPosition, { reason: `Moved by ${message.author.username}` });

            const container = buildSuccessResponse(
                'Role Moved',
                `Successfully moved ${role} **${direction}** by **${amount}** position(s).`,
                { 'Role': role.name, 'Direction': direction, 'Amount': `${amount}`, 'Moderator': message.author.username },
                true
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[MoveRole] Error:', error);
            const container = buildErrorResponse('Failed to Move Role', 'An error occurred while moving the role.', `Error: ${error.message}`);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
