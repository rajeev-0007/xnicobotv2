'use strict';
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hide')
        .setDescription('Hide a channel from a role (defaults to @everyone)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to hide (defaults to current channel)')
                .setRequired(false))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to hide the channel from (defaults to @everyone)')
                .setRequired(false)),

    prefix: 'hide',
    description: 'Hide a channel from a role (defaults to @everyone)',
    usage: 'hide [#channel] [@role]',
    category: 'admin',

    async execute(interaction) {
        const channel    = interaction.options.getChannel('channel') || interaction.channel;
        const targetRole = interaction.options.getRole('role')       || interaction.guild.roles.everyone;
        const roleName   = targetRole.id === interaction.guild.roles.everyone.id ? '@everyone' : `<@&${targetRole.id}>`;

        try {
            await channel.permissionOverwrites.edit(targetRole, { ViewChannel: false });

            const container = buildSuccessResponse(
                'Channel Hidden',
                `Successfully hidden the channel from ${roleName}.`,
                {
                    'Channel':   `${channel}`,
                    'Role':      roleName,
                    'Hidden By': `${interaction.user.username}`,
                    'Status':    `Not visible to ${roleName}`
                },
                true
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Hide Channel Error:', error);
            const container = buildErrorResponse(
                'Failed to Hide Channel',
                'An error occurred while hiding the channel.',
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

        try {
            await channel.permissionOverwrites.edit(targetRole, { ViewChannel: false });

            const container = buildSuccessResponse(
                'Channel Hidden',
                `Successfully hidden the channel from ${roleName}.`,
                {
                    'Channel':   `${channel}`,
                    'Role':      roleName,
                    'Hidden By': `${message.author.username}`,
                    'Status':    `Not visible to ${roleName}`
                },
                true
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
        } catch (error) {
            console.error('Hide Channel Error:', error);
            const container = buildErrorResponse(
                'Failed to Hide Channel',
                'An error occurred while hiding the channel.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
