'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags,
    PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize
} = require('discord.js');
const {
    buildErrorResponse, buildPermissionDenied, buildRoleHierarchyError,
    buildInvalidUsage, BRANDING
} = require('../../utils/responseBuilder');

function validateRoleEdit(role, guild) {
    if (role.id === guild.id) {
        return buildErrorResponse('Invalid Role', 'You cannot modify the @everyone role.');
    }
    if (role.managed) {
        return buildErrorResponse(
            'Managed Role',
            `**${role.name}** is managed by a bot or integration and cannot be modified.`,
            'Configure that integration directly to change this role.'
        );
    }
    if (role.position >= guild.members.me.roles.highest.position) {
        return buildRoleHierarchyError('modify this role');
    }
    return null;
}

function buildResultContainer(role, mentionable, actorName) {
    return new ContainerBuilder()
        .setAccentColor(role.color || 0x57F287)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <:Userplus:1521227719621218477> Role Mentionability ${mentionable ? 'Enabled' : 'Disabled'}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### <:Invoice:1521227903956811836> Change\n` +
                `<:Caretright:1521227704953864202> **Role:** ${role}\n` +
                `<:Caretright:1521227704953864202> **Mentionable:** ${mentionable ? '<:Checkedbox:1521227734943269077> Yes' : '<:Cancel:1521227723916181644> No'}\n` +
                `<:Caretright:1521227704953864202> **Effect:** ${mentionable ? 'Anyone can ping this role.' : 'Only users with Mention Everyone can ping this role.'}\n` +
                `<:Caretright:1521227704953864202> **Moderator:** ${actorName}\n` +
                `<:Caretright:1521227704953864202> **Updated:** <t:${Math.floor(Date.now() / 1000)}:R>`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

module.exports = {
    name: 'role-mentionable',
    prefix: 'role-mentionable',
    description: 'Toggle whether a role can be mentioned by everyone',
    category: 'admin',
    usage: 'role-mentionable <@role> <on/off>',
    permissions: ['ManageRoles'],
    data: new SlashCommandBuilder()
        .setName('role-mentionable')
        .setDescription('Toggle whether a role can be mentioned by everyone')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to toggle mentionable status for')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('toggle')
                .setDescription('Enable or disable mentionable')
                .setRequired(true)
                .addChoices(
                    { name: 'On', value: 'on' },
                    { name: 'Off', value: 'off' },
                )),

    async execute(interaction) {
        try {
            const role = interaction.options.getRole('role');
            const toggle = interaction.options.getString('toggle');

            const validationError = validateRoleEdit(role, interaction.guild);
            if (validationError) {
                return interaction.reply({ components: [validationError], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const mentionable = toggle === 'on';
            if (role.mentionable === mentionable) {
                const container = buildErrorResponse(
                    'No Change',
                    `${role} is already ${mentionable ? 'mentionable' : 'not mentionable'}.`
                );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            await role.setMentionable(mentionable, `Changed by ${interaction.user.username}`);
            const container = buildResultContainer(role, mentionable, interaction.user.username);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[ROLE-MENTIONABLE] Slash error:', error);
            const container = buildErrorResponse('Failed to Update Role', 'An error occurred while updating the role.', error.message);
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
            if (!role || !args[1]) {
                const container = buildInvalidUsage(
                    'role-mentionable',
                    '-role-mentionable <@role> <on/off>',
                    ['-role-mentionable @Members on', '-role-mentionable @VIP off']
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const validationError = validateRoleEdit(role, message.guild);
            if (validationError) {
                return message.reply({ components: [validationError], flags: MessageFlags.IsComponentsV2 });
            }

            const toggle = args[1].toLowerCase();
            if (!['on', 'off', 'yes', 'no', 'true', 'false', 'enable', 'disable'].includes(toggle)) {
                const container = buildErrorResponse('Invalid Option', 'Please specify `on` or `off`.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const mentionable = ['on', 'yes', 'true', 'enable'].includes(toggle);
            if (role.mentionable === mentionable) {
                const container = buildErrorResponse('No Change', `${role} is already ${mentionable ? 'mentionable' : 'not mentionable'}.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            await role.setMentionable(mentionable, `Changed by ${message.author.username}`);
            const container = buildResultContainer(role, mentionable, message.author.username);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[ROLE-MENTIONABLE] Prefix error:', error);
            const container = buildErrorResponse('Failed to Update Role', 'An error occurred while updating the role.', error.message);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },
};
