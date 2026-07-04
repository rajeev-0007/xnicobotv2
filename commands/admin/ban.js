const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildUserNotFound, buildInvalidUsage, buildModerationResponse } = require('../../utils/responseBuilder');
const { confirmAction } = require('../../utils/confirmAction');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a member from the server')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to ban')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for banning')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('delete_days')
                .setDescription('Number of days of messages to delete (0-7)')
                .setMinValue(0)
                .setMaxValue(7)
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    
    prefix: 'ban',
    description: 'Ban a member from the server',
    usage: 'ban <@user> [reason]',
    category: 'admin',
    aliases: ['b'],
    
    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';
        const deleteDays = interaction.options.getInteger('delete_days') || 0;
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        if (user.id === interaction.user.id) {
            const container = buildErrorResponse('Cannot Ban Yourself', 'You cannot ban yourself from the server.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (user.id === interaction.client.user.id) {
            const container = buildErrorResponse('Cannot Ban Me', 'You cannot ban me.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (user.id === interaction.guild.ownerId) {
            const container = buildErrorResponse('Cannot Ban Owner', 'You cannot ban the server owner.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (member && !member.bannable) {
            const container = buildErrorResponse(
                'Cannot Ban User',
                'I cannot ban this user. They may have a higher role than me or have special permissions.',
                'Make sure my role is above the user\'s highest role.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        // ── Confirmation prompt ──
        const { confirmed, button } = await confirmAction(interaction, false, {
            title: 'Confirm Ban',
            description: `Are you sure you want to **ban** <@${user.id}> (\`${user.username}\`)?\n\n**Reason:** ${reason}${deleteDays ? `\n**Delete messages:** ${deleteDays} day(s)` : ''}`,
            confirmLabel: 'Ban User',
        });
        if (!confirmed) return;

        try {
            await interaction.guild.members.ban(user, { 
                reason: `${reason} | Banned by ${interaction.user.username}`,
                deleteMessageSeconds: deleteDays * 24 * 60 * 60
            });
            
            const container = buildModerationResponse(
                'ban',
                `${user.username} (${user.id})`,
                `${interaction.user.username}`,
                reason
            );
            
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Ban Error:', error);
            const container = buildErrorResponse(
                'Ban Failed',
                'Failed to ban the user.',
                `Error: ${error.message}`
            );
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
            const container = buildPermissionDenied('Ban Members');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const user = message.mentions.users.first();
        if (!user) {
            const container = buildInvalidUsage(
                'ban',
                '-ban @user [reason]',
                ['-ban @BadUser Spamming', '-ban @Troll Breaking rules']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const reason = args.slice(1).join(' ') || 'No reason provided';
        const member = await message.guild.members.fetch(user.id).catch(() => null);

        if (user.id === message.author.id) {
            const container = buildErrorResponse('Cannot Ban Yourself', 'You cannot ban yourself from the server.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (user.id === message.client.user.id) {
            const container = buildErrorResponse('Cannot Ban Me', 'You cannot ban me.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (user.id === message.guild.ownerId) {
            const container = buildErrorResponse('Cannot Ban Owner', 'You cannot ban the server owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (member && !member.bannable) {
            const container = buildErrorResponse(
                'Cannot Ban User',
                'I cannot ban this user. They may have a higher role than me.',
                'Ensure my role is positioned above the target user\'s role.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // ── Confirmation prompt ──
        const { confirmed, button } = await confirmAction(message, true, {
            title: 'Confirm Ban',
            description: `Are you sure you want to **ban** <@${user.id}> (\`${user.username}\`)?\n\n**Reason:** ${reason}`,
            confirmLabel: 'Ban User',
        });
        if (!confirmed) return;

        try {
            await message.guild.members.ban(user, { 
                reason: `${reason} | Banned by ${message.author.username}`
            });
            
            const container = buildModerationResponse(
                'ban',
                `${user.username} (${user.id})`,
                `${message.author.username}`,
                reason
            );
            
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Ban Error:', error);
            const container = buildErrorResponse(
                'Ban Failed',
                'Failed to ban the user.',
                `Error: ${error.message}`
            );
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
