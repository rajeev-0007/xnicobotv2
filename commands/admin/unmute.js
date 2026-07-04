const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildUserNotFound, buildInvalidUsage, buildModerationResponse } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Remove timeout from a member (unmute them)')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to unmute')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for unmuting')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    
    prefix: 'unmute',
    description: 'Remove timeout from a member (unmute them)',
    usage: 'unmute <@user> [reason]',
    category: 'admin',
    aliases: [],
    
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        
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

        if (!member.isCommunicationDisabled()) {
            const container = buildErrorResponse(
                'User Not Muted',
                'This user is not currently timed out.',
                'You can only unmute users who have an active timeout.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (!member.moderatable) {
            const container = buildErrorResponse(
                'Cannot Unmute User',
                'I cannot unmute this user. They may have a higher role than me or have special permissions.',
                'Make sure my role is above the user\'s highest role.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        try {
            await member.timeout(null, `${reason} | Unmuted by ${interaction.user.username}`);
            
            const container = buildModerationResponse(
                'unmute',
                `${user.username} (${user.id})`,
                `${interaction.user.username}`,
                reason
            );
            
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Unmute Error:', error);
            const container = buildErrorResponse(
                'Unmute Failed',
                'Failed to unmute the user.',
                `Error: ${error.message}`
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.guild) return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
            const container = buildPermissionDenied('Moderate Members');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const member = message.mentions.members.first();
        if (!member) {
            const container = buildInvalidUsage(
                'unmute',
                '-unmute @user [reason]',
                ['-unmute @User Served their time', '-unmute @Member Appealed successfully']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const reason = args.slice(1).join(' ') || 'No reason provided';

        if (!member.isCommunicationDisabled()) {
            const container = buildErrorResponse(
                'User Not Muted',
                'This user is not currently timed out.',
                'You can only unmute users who have an active timeout.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!member.moderatable) {
            const container = buildErrorResponse(
                'Cannot Unmute User',
                'I cannot unmute this user. They may have a higher role than me.',
                'Ensure my role is positioned above the target user\'s role.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            await member.timeout(null, `${reason} | Unmuted by ${message.author.username}`);
            
            const container = buildModerationResponse(
                'unmute',
                `${member.user.username} (${member.id})`,
                `${message.author.username}`,
                reason
            );
            
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Unmute Error:', error);
            const container = buildErrorResponse(
                'Unmute Failed',
                'Failed to unmute the user.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
