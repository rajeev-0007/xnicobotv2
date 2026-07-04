'use strict';
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unhide')
        .setDescription('Unhide a channel for a role (defaults to @everyone)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to unhide (defaults to current channel)')
                .setRequired(false))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to unhide the channel for (defaults to @everyone)')
                .setRequired(false)),

    prefix: 'unhide',
    description: 'Unhide a channel for a role (defaults to @everyone)',
    usage: 'unhide [#channel] [@role]',
    category: 'admin',
    aliases: ['show'],

    async execute(interaction) {
        const channel    = interaction.options.getChannel('channel') || interaction.channel;
        const targetRole = interaction.options.getRole('role')       || interaction.guild.roles.everyone;
        const roleName   = targetRole.id === interaction.guild.roles.everyone.id ? '@everyone' : `<@&${targetRole.id}>`;

        try {
            await channel.permissionOverwrites.edit(targetRole, { ViewChannel: null });

            const container = buildSuccessResponse(
                'Channel Unhidden',
                `The channel is now visible to ${roleName}.`,
                {
                    'Channel':     `${channel}`,
                    'Role':        roleName,
                    'Unhidden By': `${interaction.user.username}`,
                    'Status':      `Visible to ${roleName}`
                },
                true
            );
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse(
                'Failed to Unhide Channel',
                'An error occurred while unhiding the channel.',
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
            await channel.permissionOverwrites.edit(targetRole, { ViewChannel: null });

            const container = buildSuccessResponse(
                'Channel Unhidden',
                `The channel is now visible to ${roleName}.`,
                {
                    'Channel':     `${channel}`,
                    'Role':        roleName,
                    'Unhidden By': `${message.author.username}`,
                    'Status':      `Visible to ${roleName}`
                },
                true
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
        } catch (error) {
            console.error('Unhide Channel Error:', error);
            const container = buildErrorResponse(
                'Failed to Unhide Channel',
                'An error occurred while unhiding the channel.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
