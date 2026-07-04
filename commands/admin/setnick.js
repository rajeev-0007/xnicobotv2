const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildUserNotFound, buildInvalidUsage, buildRoleHierarchyError } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setnick')
        .setDescription("Change a user's nickname")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to change nickname')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('nickname')
                .setDescription('The new nickname (leave empty to reset)')
                .setMaxLength(32)),
    
    prefix: 'setnick',
    description: 'Change a user\'s nickname',
    usage: 'setnick <@user> [nickname]',
    category: 'admin',
    
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const nickname = interaction.options.getString('nickname');
        
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

        if (member.id === interaction.guild.ownerId) {
            const container = buildErrorResponse(
                'Cannot Change Owner Nickname',
                'I cannot change the nickname of the server owner.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (member.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
            const container = buildRoleHierarchyError('change this user\'s nickname');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
            const container = buildErrorResponse(
                'Insufficient Permissions',
                'You cannot change the nickname of someone with a higher or equal role.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        try {
            const oldNick = member.displayName;
            await member.setNickname(nickname);
            
            const container = buildSuccessResponse(
                nickname ? 'Nickname Changed' : 'Nickname Reset',
                `Successfully updated the user's nickname.`,
                {
                    'User': `${user.username}`,
                    'Previous': oldNick,
                    'New Nickname': nickname || 'Reset to original',
                    'Changed By': `${interaction.user.username}`
                }
            );
            
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse(
                'Failed to Change Nickname',
                'An error occurred while changing the nickname.',
                `Error: ${error.message}`
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
            const container = buildPermissionDenied('Manage Nicknames');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const user = message.mentions.users.first();
        if (!user) {
            const container = buildInvalidUsage(
                'setnick',
                '-setnick @user [nickname]',
                ['-setnick @User NewNick', '-setnick @User (to reset)']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const nickname = args.slice(1).join(' ') || null;
        
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

        if (member.id === message.guild.ownerId) {
            const container = buildErrorResponse(
                'Cannot Change Owner Nickname',
                'I cannot change the nickname of the server owner.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (member.roles.highest.position >= message.guild.members.me.roles.highest.position) {
            const container = buildRoleHierarchyError('change this user\'s nickname');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (message.member.roles.highest.position <= member.roles.highest.position && message.author.id !== message.guild.ownerId) {
            const container = buildErrorResponse(
                'Insufficient Permissions',
                'You cannot change the nickname of someone with a higher or equal role.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const oldNick = member.displayName;
            await member.setNickname(nickname);
            
            const container = buildSuccessResponse(
                nickname ? 'Nickname Changed' : 'Nickname Reset',
                `Successfully updated the user's nickname.`,
                {
                    'User': `${user.username}`,
                    'Previous': oldNick,
                    'New Nickname': nickname || 'Reset to original',
                    'Changed By': `${message.author.username}`
                }
            );
            
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse(
                'Failed to Change Nickname',
                'An error occurred while changing the nickname.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
