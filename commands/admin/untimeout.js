const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildPermissionDenied, buildUserNotFound, buildInvalidUsage, buildModerationResponse } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('untimeout')
        .setDescription('Remove timeout from a member')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to remove timeout from')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for removing the timeout')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    
    prefix: 'untimeout',
    description: 'Remove timeout from a member',
    usage: 'untimeout <@user> [reason]',
    category: 'admin',
    
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
                'User Not Timed Out',
                'This user does not have an active timeout.',
                'You can only remove timeouts from users who are currently timed out.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (!member.moderatable) {
            const container = buildErrorResponse(
                'Cannot Remove Timeout',
                'I cannot modify this user\'s timeout. They may have a higher role than me.',
                'Make sure my role is above the user\'s highest role.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        try {
            await member.timeout(null, `${reason} | Timeout removed by ${interaction.user.username}`);
            
            const container = buildModerationResponse(
                'untimeout',
                `${user.username} (${user.id})`,
                `${interaction.user.username}`,
                reason
            );
            
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Untimeout Error:', error);
            const container = buildErrorResponse(
                'Remove Timeout Failed',
                'Failed to remove the timeout.',
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
                'untimeout',
                '-untimeout @user [reason]',
                ['-untimeout @User Served their time', '-untimeout @Member Appealed successfully']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const reason = args.slice(1).join(' ') || 'No reason provided';

        if (!member.isCommunicationDisabled()) {
            const container = buildErrorResponse(
                'User Not Timed Out',
                'This user does not have an active timeout.',
                'You can only remove timeouts from users who are currently timed out.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!member.moderatable) {
            const container = buildErrorResponse(
                'Cannot Remove Timeout',
                'I cannot modify this user\'s timeout. They may have a higher role than me.',
                'Ensure my role is positioned above the target user\'s role.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            await member.timeout(null, `${reason} | Timeout removed by ${message.author.username}`);
            
            const container = buildModerationResponse(
                'untimeout',
                `${member.user.username} (${member.id})`,
                `${message.author.username}`,
                reason
            );
            
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Untimeout Error:', error);
            const container = buildErrorResponse(
                'Remove Timeout Failed',
                'Failed to remove the timeout.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
