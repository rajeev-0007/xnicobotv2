const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildInvalidUsage, buildRoleNotFound, buildRoleHierarchyError } = require('../../utils/responseBuilder');

module.exports = {
    prefix: 'delete-role',
    description: 'Delete a role from the server',
    usage: 'delete-role <@role>',
    category: 'admin',
    data: new SlashCommandBuilder()
        .setName('delete-role')
        .setDescription('Delete a role from the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to delete')
                .setRequired(true)),

    async execute(interaction) {
        try {
            const role = interaction.options.getRole('role');

            if (role.managed) {
                const container = buildErrorResponse('Cannot Delete Managed Role', 'This role is managed by an integration (bot, boost, etc.) and cannot be deleted.');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (role.position >= interaction.guild.members.me.roles.highest.position) {
                const container = buildRoleHierarchyError('delete this role');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (role.position >= interaction.member.roles.highest.position) {
                const container = buildErrorResponse('Insufficient Permissions', 'You cannot delete a role that is higher than or equal to your highest role.');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const roleName = role.name;
            const roleColor = role.hexColor;
            const memberCount = role.members.size;

            await role.delete(`Deleted by ${interaction.user.username}`);

            const container = buildSuccessResponse(
                'Role Deleted',
                'Successfully deleted the role.',
                {
                    'Role Name': roleName,
                    'Color': roleColor,
                    'Members Affected': `${memberCount}`,
                    'Deleted By': `${interaction.user.username}`
                }
            );

            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[DeleteRole] Slash Error:', error);
            const container = buildErrorResponse('Failed to Delete Role', 'An error occurred while deleting the role.', `Error: ${error.message}`);
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

        const role = message.mentions.roles.first() || 
                     message.guild.roles.cache.find(r => r.name.toLowerCase() === args.join(' ').toLowerCase());
        
        if (!role) {
            const container = buildInvalidUsage(
                'delete-role',
                '-delete-role @role',
                ['-delete-role @OldRole', '-delete-role @TempRole']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (role.managed) {
            const container = buildErrorResponse(
                '<:Cancel:1521227723916181644> Cannot Delete Managed Role',
                '<:Infotriangle:1521227710381428926> This role is managed by an integration (bot, boost, etc.) and cannot be deleted.',
                '<:Caretright:1521227704953864202> Managed roles are created by Discord or bots automatically.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (role.position >= message.guild.members.me.roles.highest.position) {
            const container = buildRoleHierarchyError('delete this role');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (role.position >= message.member.roles.highest.position) {
            const container = buildErrorResponse(
                '<:Cancel:1521227723916181644> Insufficient Permissions',
                '<:Infotriangle:1521227710381428926> You cannot delete a role that is higher than or equal to your highest role.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const roleName = role.name;
            const roleColor = role.hexColor;
            const memberCount = role.members.size;
            
            await role.delete(`Deleted by ${message.author.username}`);

            const container = buildSuccessResponse(
                '<:Checkedbox:1521227734943269077> Role Deleted',
                `<:Caretright:1521227704953864202> Successfully deleted the role.`,
                {
                    '<:Caretright:1521227704953864202> Role Name': roleName,
                    '<:Caretright:1521227704953864202> Color': roleColor,
                    '<:Caretright:1521227704953864202> Members Affected': `${memberCount}`,
                    '<:Caretright:1521227704953864202> Deleted By': `${message.author.username}`
                }
            );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse(
                '<:Cancel:1521227723916181644> Failed to Delete Role',
                '<:Infotriangle:1521227710381428926> An error occurred while deleting the role.',
                `<:Caretright:1521227704953864202> Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
