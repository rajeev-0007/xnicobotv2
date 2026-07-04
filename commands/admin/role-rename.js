'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags,
    PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize
} = require('discord.js');
const {
    buildErrorResponse, buildPermissionDenied, buildRoleHierarchyError,
    buildInvalidUsage, BRANDING
} = require('../../utils/responseBuilder');

const MAX_ROLE_NAME = 100;

function validateRoleEdit(role, guild) {
    if (role.id === guild.id) {
        return buildErrorResponse('Invalid Role', 'You cannot rename the @everyone role.');
    }
    if (role.managed) {
        return buildErrorResponse(
            'Managed Role',
            `**${role.name}** is managed by a bot or integration and cannot be renamed.`,
            'Configure that integration directly to change this role.'
        );
    }
    if (role.position >= guild.members.me.roles.highest.position) {
        return buildRoleHierarchyError('rename this role');
    }
    return null;
}

function buildResultContainer(role, oldName, newName, actorName) {
    return new ContainerBuilder()
        .setAccentColor(role.color || 0x57F287)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Editalt:1521227921673556019> Role Renamed`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### <:Invoice:1521227903956811836> Change\n` +
                `<:Caretright:1521227704953864202> **Role:** ${role}\n` +
                `<:Caretright:1521227704953864202> **Old name:** \`${oldName}\`\n` +
                `<:Caretright:1521227704953864202> **New name:** \`${newName}\`\n` +
                `<:Caretright:1521227704953864202> **Moderator:** ${actorName}\n` +
                `<:Caretright:1521227704953864202> **Updated:** <t:${Math.floor(Date.now() / 1000)}:R>`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

module.exports = {
    name: 'role-rename',
    prefix: 'role-rename',
    description: 'Rename a role while keeping all its members and permissions',
    category: 'admin',
    usage: 'role-rename <@role> <new_name>',
    permissions: ['ManageRoles'],
    data: new SlashCommandBuilder()
        .setName('role-rename')
        .setDescription('Rename a role while keeping all its members and permissions')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to rename')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The new name for the role')
                .setMaxLength(MAX_ROLE_NAME)
                .setRequired(true)),

    async execute(interaction) {
        try {
            const role = interaction.options.getRole('role');
            const newName = interaction.options.getString('name').trim();

            const validationError = validateRoleEdit(role, interaction.guild);
            if (validationError) {
                return interaction.reply({ components: [validationError], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (newName.length === 0 || newName.length > MAX_ROLE_NAME) {
                const container = buildErrorResponse(
                    'Invalid Name',
                    `Role names must be between 1 and ${MAX_ROLE_NAME} characters.`
                );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            if (role.name === newName) {
                const container = buildErrorResponse('No Change', `${role} is already named **${newName}**.`);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const oldName = role.name;
            await role.setName(newName, `Renamed by ${interaction.user.username}`);
            const container = buildResultContainer(role, oldName, newName, interaction.user.username);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[ROLE-RENAME] Slash error:', error);
            const container = buildErrorResponse('Failed to Rename Role', 'An error occurred while renaming the role.', error.message);
            const fn = interaction.replied || interaction.deferred ? interaction.editReply : interaction.reply;
            await fn.call(interaction, { components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        if (!message.guild) {
            return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        }
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            const container = buildPermissionDenied('Manage Roles');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const role = message.mentions.roles.first();
            const newName = args.slice(1).join(' ').trim();

            if (!role || !newName) {
                const container = buildInvalidUsage(
                    'role-rename',
                    '-role-rename <@role> <new_name>',
                    ['-role-rename @Members Active Members', '-role-rename @VIP Premium Member']
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const validationError = validateRoleEdit(role, message.guild);
            if (validationError) {
                return message.reply({ components: [validationError], flags: MessageFlags.IsComponentsV2 });
            }

            if (newName.length > MAX_ROLE_NAME) {
                const container = buildErrorResponse(
                    'Invalid Name',
                    `Role names must be between 1 and ${MAX_ROLE_NAME} characters.`
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (role.name === newName) {
                const container = buildErrorResponse('No Change', `${role} is already named **${newName}**.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const oldName = role.name;
            await role.setName(newName, `Renamed by ${message.author.username}`);
            const container = buildResultContainer(role, oldName, newName, message.author.username);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[ROLE-RENAME] Prefix error:', error);
            const container = buildErrorResponse('Failed to Rename Role', 'An error occurred while renaming the role.', error.message);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },
};
