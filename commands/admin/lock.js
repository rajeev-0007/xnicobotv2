'use strict';
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Lock a channel to prevent a role from sending messages (defaults to @everyone)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to lock (defaults to current channel)')
                .addChannelTypes(ChannelType.GuildText))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to lock the channel for (defaults to @everyone)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for locking the channel')
                .setRequired(false)),

    prefix: 'lock',
    description: 'Lock a channel to prevent a role from sending messages',
    usage: 'lock [#channel] [@role] [reason]',
    category: 'admin',

    async execute(interaction) {
        const channel    = interaction.options.getChannel('channel') || interaction.channel;
        const targetRole = interaction.options.getRole('role')       || interaction.guild.roles.everyone;
        const reason     = interaction.options.getString('reason')   || 'No reason provided';
        const roleName   = targetRole.id === interaction.guild.roles.everyone.id ? '@everyone' : `<@&${targetRole.id}>`;

        if (channel.type !== ChannelType.GuildText) {
            const container = buildErrorResponse(
                'Invalid Channel Type',
                'You can only lock text channels.',
                'Please select a text channel to lock.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        try {
            await channel.permissionOverwrites.edit(targetRole, { SendMessages: false });

            const container = buildSuccessResponse(
                'Channel Locked',
                `The channel has been locked. ${roleName} cannot send messages.`,
                {
                    'Channel':   `${channel}`,
                    'Role':      roleName,
                    'Locked By': `${interaction.user.username}`,
                    'Reason':    reason
                },
                true
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse(
                'Failed to Lock Channel',
                'An error occurred while locking the channel.',
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
            const container = buildErrorResponse('Invalid Channel Type', 'You can only lock text channels.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            await channel.permissionOverwrites.edit(targetRole, { SendMessages: false });

            const container = buildSuccessResponse(
                'Channel Locked',
                `The channel has been locked. ${roleName} cannot send messages.`,
                {
                    'Channel':   `${channel}`,
                    'Role':      roleName,
                    'Locked By': `${message.author.username}`,
                    'Reason':    reason
                },
                true
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
        } catch (error) {
            const container = buildErrorResponse(
                'Failed to Lock Channel',
                'An error occurred while locking the channel.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
