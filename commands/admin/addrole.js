const { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildUserNotFound, buildRoleNotFound, buildRoleHierarchyError, buildInvalidUsage } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addrole')
        .setDescription('Add a role to a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to add the role to')
                .setRequired(true))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to add')
                .setRequired(true)),
    
    prefix: 'addrole',
    description: 'Add a role to a user',
    usage: 'addrole <@user> <@role>',
    category: 'admin',
    
    async execute(interaction) {
        try {
            const user = interaction.options.getUser('user');
            const role = interaction.options.getRole('role');

            if (role.id === interaction.guild.id) {
                const container = buildErrorResponse('Invalid Role', 'You cannot assign the @everyone role.');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (role.managed) {
                const container = buildErrorResponse('Managed Role', `**${role.name}** is managed by a bot/integration and cannot be assigned manually.`);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            let member;
            try {
                member = await interaction.guild.members.fetch(user.id);
            } catch (e) {
                const container = buildUserNotFound(user.username);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (!member) {
                const container = buildUserNotFound(user.username);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (member.roles.cache.has(role.id)) {
                const container = buildErrorResponse(
                    'Role Already Assigned',
                    `**${user.username}** already has the ${role} role.`,
                    'Try adding a different role or check the user\'s current roles.'
                );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                const container = buildRoleHierarchyError('add this role');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (interaction.member.roles.highest.position <= role.position) {
                const container = buildErrorResponse(
                    'Insufficient Permissions',
                    'You cannot add a role that is higher than or equal to your highest role.',
                    'Contact a server administrator if you need to assign this role.'
                );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            await member.roles.add(role, `Added by ${interaction.user.username}`);

            const container = buildSuccessResponse(
                'Role Added',
                `Successfully added a role to the user.`,
                {
                    'User': `${user.username}`,
                    'Role': `${role}`,
                    'Moderator': `${interaction.user.username}`
                },
                true
            );

            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[AddRole] Slash Error:', error);
            const container = buildErrorResponse(
                'Failed to Add Role',
                'An error occurred while adding the role.',
                `Error: ${error.message}`
            );
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            } else {
                await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            const container = buildPermissionDenied('Manage Roles');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const user = message.mentions.users.first();

            if (!user) {
                const container = buildInvalidUsage(
                    'addrole',
                    '-addrole @user @role',
                    ['-addrole @Rex @Member', '-addrole @Rex @VIP']
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const role = message.mentions.roles.first() ||
                         message.guild.roles.cache.find(r => r.name.toLowerCase() === args.slice(1).join(' ').toLowerCase());

            if (!role) {
                const container = buildRoleNotFound(args.slice(1).join(' '));
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.id === message.guild.id) {
                const container = buildErrorResponse('Invalid Role', 'You cannot assign the @everyone role.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.managed) {
                const container = buildErrorResponse('Managed Role', `**${role.name}** is managed by a bot/integration and cannot be assigned manually.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            let member;
            try {
                member = await message.guild.members.fetch(user.id);
            } catch (e) {
                const container = buildUserNotFound(user.username);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (!member) {
                const container = buildUserNotFound(user.username);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (member.roles.cache.has(role.id)) {
                const container = buildErrorResponse(
                    'Role Already Assigned',
                    `**${user.username}** already has the ${role} role.`
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.position >= message.guild.members.me.roles.highest.position) {
                const container = buildRoleHierarchyError('add this role');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (message.member.roles.highest.position <= role.position) {
                const container = buildErrorResponse(
                    'Insufficient Permissions',
                    'You cannot add a role that is higher than or equal to your highest role.'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            await member.roles.add(role, `Added by ${message.author.username}`);

            const container = buildSuccessResponse(
                'Role Added',
                `Successfully added a role to the user.`,
                {
                    'User': `${user.username}`,
                    'Role': `${role}`,
                    'Moderator': `${message.author.username}`
                },
                true
            );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[AddRole] Error:', error);
            const container = buildErrorResponse(
                'Failed to Add Role',
                'An error occurred while adding the role.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
