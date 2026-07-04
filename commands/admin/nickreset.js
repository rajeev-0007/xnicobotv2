const { PermissionFlagsBits, SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require('discord.js');
const { buildErrorResponse, buildPermissionDenied, buildUserNotFound, buildInvalidUsage, buildRoleHierarchyError } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nickreset')
        .setDescription("Reset a user's nickname to their default username")
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to reset nickname for')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

    prefix: 'nickreset',
    description: "Reset a user's nickname to their default username",
    usage: 'nickreset <@user>',
    category: 'admin',

    async execute(interaction) {
        const user = interaction.options.getUser('user');
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);

        if (!member) {
            const container = buildUserNotFound(user.username);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (member.id === interaction.guild.ownerId) {
            const container = buildErrorResponse('Cannot Reset Owner', "I cannot reset the nickname of the server owner.");
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (member.roles.highest.position >= interaction.guild.members.me.roles.highest.position) {
            const container = buildRoleHierarchyError('reset this user\'s nickname');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (interaction.member.roles.highest.position <= member.roles.highest.position && interaction.user.id !== interaction.guild.ownerId) {
            const container = buildErrorResponse('Insufficient Permissions', 'You cannot reset the nickname of someone with a higher or equal role.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        try {
            const oldNick = member.nickname || 'None';
            await member.setNickname(null);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Nickname Reset`)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(
                            `**<:User:1521227714227343380> User:** ${user.username}\n` +
                            `**<:Edit:1521227886634205298> Old Nickname:** ${oldNick}\n` +
                            `**👮 Moderator:** ${interaction.user.username}`
                        )
                );
            
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse('Reset Failed', 'Failed to reset the nickname.', `Error: ${error.message}`);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageNicknames)) {
            const container = buildPermissionDenied('Manage Nicknames');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
            const container = buildErrorResponse('Missing Bot Permission', 'I need the **Manage Nicknames** permission to use this command.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const member = message.mentions.members.first();
        if (!member) {
            const container = buildInvalidUsage('nickreset', '-nickreset @user', ['-nickreset @User']);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (member.roles.highest.position >= message.member.roles.highest.position && message.author.id !== message.guild.ownerId) {
            const container = buildErrorResponse('Insufficient Permissions', 'You cannot reset the nickname of someone with equal or higher roles.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (member.roles.highest.position >= message.guild.members.me.roles.highest.position) {
            const container = buildRoleHierarchyError('reset this user\'s nickname');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const oldNick = member.nickname || 'None';
            await member.setNickname(null);
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Nickname Reset`)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(
                            `**<:User:1521227714227343380> User:** ${member.user.username}\n` +
                            `**<:Edit:1521227886634205298> Old Nickname:** ${oldNick}\n` +
                            `**👮 Moderator:** ${message.author.username}`
                        )
                );
            
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse('Reset Failed', 'Failed to reset the nickname.', `Error: ${error.message}`);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
