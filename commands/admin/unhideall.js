'use strict';
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, PermissionFlagsBits, ChannelType, SlashCommandBuilder } = require('discord.js');
const { buildPermissionDenied, COLORS } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unhideall')
        .setDescription('Unhide all channels in the server for a role (defaults to @everyone)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to unhide channels for (defaults to @everyone)')
                .setRequired(false)),

    prefix: 'unhideall',
    description: 'Unhide all channels in the server for a role (defaults to @everyone)',
    usage: 'unhideall [@role]',
    category: 'admin',
    aliases: ['showall'],

    async execute(interaction) {
        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const container = new ContainerBuilder()
                .setAccentColor(COLORS.ERROR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Cancel:1521227723916181644> Bot Missing Permissions\n\nI need the **Manage Channels** permission.`
                ));
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const targetRole = interaction.options.getRole('role') || interaction.guild.roles.everyone;
        const roleName   = targetRole.id === interaction.guild.roles.everyone.id ? '@everyone' : `<@&${targetRole.id}>`;

        await interaction.deferReply();

        const channels = interaction.guild.channels.cache.filter(ch =>
            ch.type === ChannelType.GuildText ||
            ch.type === ChannelType.GuildVoice ||
            ch.type === ChannelType.GuildAnnouncement ||
            ch.type === ChannelType.GuildForum ||
            ch.type === ChannelType.GuildStageVoice
        );

        let unhidden = 0, failed = 0;
        for (const [, channel] of channels) {
            try {
                await channel.permissionOverwrites.edit(targetRole, { ViewChannel: null }, { reason: `Unhide all by ${interaction.user.username}` });
                unhidden++;
            } catch { failed++; }
        }

        const resultContainer = new ContainerBuilder()
            .setAccentColor(COLORS.SUCCESS)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Checkedbox:1521227734943269077> All Channels Unhidden\n\nSuccessfully made all channels visible to ${roleName}.\n\n### <:Bookopen:1521227911137595605> Results\n> **Unhidden:** ${unhidden} channels\n${failed > 0 ? `> **Failed:** ${failed} channels\n` : ''}\n**Unhidden By:** ${interaction.user.username}\n**Role:** ${roleName}\n\n> <:Checkedbox:1521227734943269077> All channels are now visible to ${roleName}.`
            ))
;

        await interaction.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const container = buildPermissionDenied('Administrator');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const container = new ContainerBuilder()
                .setAccentColor(COLORS.ERROR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Cancel:1521227723916181644> Bot Missing Permissions\n\nI need the **Manage Channels** permission.`
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const targetRole = message.mentions.roles.first() || message.guild.roles.everyone;
        const roleName   = targetRole.id === message.guild.roles.everyone.id ? '@everyone' : `<@&${targetRole.id}>`;

        const channels = message.guild.channels.cache.filter(ch =>
            ch.type === ChannelType.GuildText ||
            ch.type === ChannelType.GuildVoice ||
            ch.type === ChannelType.GuildAnnouncement ||
            ch.type === ChannelType.GuildForum ||
            ch.type === ChannelType.GuildStageVoice
        );

        const processingContainer = new ContainerBuilder()
            .setAccentColor(COLORS.WARNING)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <a:Loading:1521227993995940032> Unhiding All Channels\n\n> Processing ${channels.size} channels for ${roleName}...\n\n-# This may take a moment for large servers`
            ));

        const msg = await message.reply({ components: [processingContainer], flags: MessageFlags.IsComponentsV2 });

        let unhidden = 0, failed = 0;
        for (const [, channel] of channels) {
            try {
                await channel.permissionOverwrites.edit(targetRole, { ViewChannel: null }, { reason: `Unhide all by ${message.author.username}` });
                unhidden++;
            } catch { failed++; }
        }

        const resultContainer = new ContainerBuilder()
            .setAccentColor(COLORS.SUCCESS)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Checkedbox:1521227734943269077> All Channels Unhidden\n\nSuccessfully made all channels visible to ${roleName}.\n\n### <:Bookopen:1521227911137595605> Results\n> **Unhidden:** ${unhidden} channels\n${failed > 0 ? `> **Failed:** ${failed} channels\n` : ''}\n**Unhidden By:** ${message.author.username}\n**Role:** ${roleName}\n\n> <:Checkedbox:1521227734943269077> All channels are now visible to ${roleName}.\n> Use \`-hideall\` to hide them again.`
            ))
;

        await msg.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
};
