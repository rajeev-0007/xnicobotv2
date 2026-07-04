const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildHelpResponse } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('create-role')
        .setDescription('Create a new role in the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The name of the role to create')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('color')
                .setDescription('Color in hex (#FF0000) or name (RED, BLUE, etc.)')
                .setRequired(false)),
    prefix: 'create-role',
    description: 'Create a new role in the server',
    usage: 'create-role <name> [color]',
    category: 'admin',

    async execute(interaction) {
        try {
            const name = interaction.options.getString('name');
            const colorArg = interaction.options.getString('color');

            const colorMap = {
                'RED': 'Red', 'BLUE': 'Blue', 'GREEN': 'Green', 'YELLOW': 'Yellow',
                'PURPLE': 'Purple', 'ORANGE': 'Orange', 'AQUA': 'Aqua', 'GOLD': 'Gold',
                'WHITE': 'White', 'BLACK': 'Default', 'PINK': 'LuminousVividPink',
                'GREY': 'Grey', 'GRAY': 'Grey', 'NAVY': 'Navy', 'BLURPLE': 'Blurple',
                'FUCHSIA': 'Fuchsia'
            };

            let color = null;
            if (colorArg) {
                color = colorArg.startsWith('#') ? colorArg : (colorMap[colorArg.toUpperCase()] || null);
            }

            const role = await interaction.guild.roles.create({
                name: name,
                color: color,
                reason: `Created by ${interaction.user.username}`
            });

            const container = buildSuccessResponse(
                'Role Created',
                'Successfully created a new role.',
                {
                    'Role': `${role}`,
                    'Name': name,
                    'Color': color || 'Default',
                    'ID': role.id,
                    'Position': `${role.position}`,
                    'Created By': `${interaction.user.username}`
                }
            );

            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[CreateRole] Slash Error:', error);
            const container = buildErrorResponse('Failed to Create Role', 'An error occurred while creating the role.', `Error: ${error.message}`);
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

        if (!args.length) {
            const container = buildHelpResponse(
                'Create Role',
                'Create a new role in the server with optional color.',
                '-create-role <name> [color]',
                ['-create-role VIP #FFD700', '-create-role Member BLUE', '-create-role Guest'],
                [
                    { name: 'name', description: 'The name of the role to create', required: true },
                    { name: 'color', description: 'Color in hex (#FF0000) or name (RED, BLUE, etc.)', required: false }
                ]
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Color name map: user input → Discord.js Colors enum key (PascalCase)
        const colorMap = {
            'RED': 'Red', 'BLUE': 'Blue', 'GREEN': 'Green', 'YELLOW': 'Yellow',
            'PURPLE': 'Purple', 'ORANGE': 'Orange', 'AQUA': 'Aqua', 'GOLD': 'Gold',
            'WHITE': 'White', 'BLACK': 'Default', 'PINK': 'LuminousVividPink',
            'GREY': 'Grey', 'GRAY': 'Grey', 'NAVY': 'Navy', 'BLURPLE': 'Blurple',
            'FUCHSIA': 'Fuchsia'
        };
        const colorArg = args[args.length - 1];
        let name, color;

        if (colorArg.startsWith('#') || colorMap[colorArg.toUpperCase()]) {
            name = args.slice(0, -1).join(' ');
            color = colorArg.startsWith('#') ? colorArg : colorMap[colorArg.toUpperCase()];
            
            if (!name) {
                name = colorArg;
                color = null;
            }
        } else {
            name = args.join(' ');
            color = null;
        }

        try {
            const role = await message.guild.roles.create({
                name: name,
                color: color,
                reason: `Created by ${message.author.username}`
            });

            const container = buildSuccessResponse(
                '<:Checkedbox:1521227734943269077> Role Created',
                `<:Checkedbox:1521227734943269077> Successfully created a new role.`,
                {
                    '<:Caretright:1521227704953864202> Role': `${role}`,
                    '<:Caretright:1521227704953864202> Name': name,
                    '<:Caretright:1521227704953864202> Color': color || 'Default',
                    '<:Caretright:1521227704953864202> ID': role.id,
                    '<:Caretright:1521227704953864202> Position': `${role.position}`,
                    '<:Caretright:1521227704953864202> Created By': `${message.author.username}`
                }
            );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse(
                'Failed to Create Role',
                'An error occurred while creating the role.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
