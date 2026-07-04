'use strict';
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlock a channel to allow a role to send messages (defaults to @everyone)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to unlock (defaults to current channel)')
                .addChannelTypes(ChannelType.GuildText))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to unlock the channel for (defaults to @everyone)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for unlocking the channel')
                .setRequired(false)),

    prefix: 'unlock',
    description: 'Unlock a channel to allow a role to send messages',
    usage: 'unlock [#channel] [@role] [reason]',
    category: 'admin',

    async execute(interaction) {
        const channel    = interaction.options.getChannel('channel') || interaction.channel;
        const targetRole = interaction.options.getRole('role')       || interaction.guild.roles.everyone;
        const reason     = interaction.options.getString('reason')   || 'No reason provided';
        const roleName   = targetRole.id === interaction.guild.roles.everyone.id ? '@everyone' : `<@&${targetRole.id}>`;

        if (channel.type !== ChannelType.GuildText) {
            const container = buildErrorResponse(
                'Invalid Channel Type',
                'You can only unlock text channels.',
                'Please select a text channel to unlock.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        try {
            await channel.permissionOverwrites.edit(targetRole, { SendMessages: null });

            const container = buildSuccessResponse(
                'Channel Unlocked',
                `The channel has been unlocked. ${roleName} can send messages again.`,
                {
                    'Channel':     `${channel}`,
                    'Role':        roleName,
                    'Unlocked By': `${interaction.user.username}`,
                    'Reason':      reason
                },
                true
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse(
                'Failed to Unlock Channel',
                'An error occurred while unlocking the channel.',
                `Error: ${error.message}`
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const container = buildPermissionDenied('Manage Channels');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const channel    = message.mentions.channels.first() || message.channel;
        const targetRole = message.mentions.roles.first()    || message.guild.roles.everyone;
        const roleName   = targetRole.id === message.guild.roles.everyone.id ? '@everyone' : `<@&${targetRole.id}>`;
        const reason     = args.filter(a => !a.startsWith('<#') && !a.startsWith('<@&')).join(' ') || 'No reason provided';

        if (channel.type !== ChannelType.GuildText) {
            const container = buildErrorResponse('Invalid Channel Type', 'You can only unlock text channels.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            await channel.permissionOverwrites.edit(targetRole, { SendMessages: null });

            const container = buildSuccessResponse(
                'Channel Unlocked',
                `The channel has been unlocked. ${roleName} can send messages again.`,
                {
                    'Channel':     `${channel}`,
                    'Role':        roleName,
                    'Unlocked By': `${message.author.username}`,
                    'Reason':      reason
                },
                true
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
        } catch (error) {
            const container = buildErrorResponse(
                'Failed to Unlock Channel',
                'An error occurred while unlocking the channel.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
