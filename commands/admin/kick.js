const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildUserNotFound, buildInvalidUsage, buildModerationResponse } = require('../../utils/responseBuilder');
const { confirmAction } = require('../../utils/confirmAction');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a member from the server')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to kick')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for kicking')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),
    
    prefix: 'kick',
    description: 'Kick a member from the server',
    usage: 'kick <@user> [reason]',
    category: 'admin',
    aliases: ['k', 'boot'],
    
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

        if (user.id === interaction.user.id) {
            const container = buildErrorResponse('Cannot Kick Yourself', 'You cannot kick yourself from the server.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (user.id === interaction.client.user.id) {
            const container = buildErrorResponse('Cannot Kick Me', 'You cannot kick me.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (user.id === interaction.guild.ownerId) {
            const container = buildErrorResponse('Cannot Kick Owner', 'You cannot kick the server owner.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (!member.kickable) {
            const container = buildErrorResponse(
                'Cannot Kick User',
                'I cannot kick this user. They may have a higher role than me or have special permissions.',
                'Make sure my role is above the user\'s highest role.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        // ── Confirmation prompt ──
        const { confirmed, button } = await confirmAction(interaction, false, {
            title: 'Confirm Kick',
            description: `Are you sure you want to **kick** <@${user.id}> (\`${user.username}\`)?\n\n**Reason:** ${reason}`,
            confirmLabel: 'Kick User',
        });
        if (!confirmed) return;

        try {
            await member.kick(`${reason} | Kicked by ${interaction.user.username}`);
            
            const container = buildModerationResponse(
                'kick',
                `${user.username} (${user.id})`,
                `${interaction.user.username}`,
                reason
            );
            
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Kick Error:', error);
            const container = buildErrorResponse(
                'Kick Failed',
                'Failed to kick the user.',
                `Error: ${error.message}`
            );
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
            const container = buildPermissionDenied('Kick Members');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const member = message.mentions.members.first();
        if (!member) {
            const container = buildInvalidUsage(
                'kick',
                '-kick @user [reason]',
                ['-kick @BadUser Breaking rules', '-kick @Spammer Advertising']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const reason = args.slice(1).join(' ') || 'No reason provided';

        if (member.id === message.author.id) {
            const container = buildErrorResponse('Cannot Kick Yourself', 'You cannot kick yourself from the server.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (member.id === message.client.user.id) {
            const container = buildErrorResponse('Cannot Kick Me', 'You cannot kick me.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (member.id === message.guild.ownerId) {
            const container = buildErrorResponse('Cannot Kick Owner', 'You cannot kick the server owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!member.kickable) {
            const container = buildErrorResponse(
                'Cannot Kick User',
                'I cannot kick this user. They may have a higher role than me.',
                'Ensure my role is positioned above the target user\'s role.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // ── Confirmation prompt ──
        const { confirmed, button } = await confirmAction(message, true, {
            title: 'Confirm Kick',
            description: `Are you sure you want to **kick** <@${member.id}> (\`${member.user.username}\`)?\n\n**Reason:** ${reason}`,
            confirmLabel: 'Kick User',
        });
        if (!confirmed) return;

        try {
            await member.kick(`${reason} | Kicked by ${message.author.username}`);
            
            const container = buildModerationResponse(
                'kick',
                `${member.user.username} (${member.id})`,
                `${message.author.username}`,
                reason
            );
            
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Kick Error:', error);
            const container = buildErrorResponse(
                'Kick Failed',
                'Failed to kick the user.',
                `Error: ${error.message}`
            );
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
