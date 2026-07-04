'use strict';
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, PermissionFlagsBits, ChannelType, SlashCommandBuilder } = require('discord.js');
const { buildPermissionDenied, COLORS } = require('../../utils/responseBuilder');

async function processUnlockAll(guild, user, targetRole) {
    const textChannels = guild.channels.cache.filter(ch => ch.type === ChannelType.GuildText);
    let processed = 0, failed = 0;
    for (const [, channel] of textChannels) {
        try {
            await channel.permissionOverwrites.edit(targetRole, { SendMessages: null }, { reason: `Unlockall by ${user.username}` });
            processed++;
        } catch { failed++; }
    }
    return { processed, failed, total: textChannels.size };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unlockall')
        .setDescription('Unlock all text channels in the server for a role (defaults to @everyone)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to unlock channels for (defaults to @everyone)')
                .setRequired(false)),

    prefix: 'unlockall',
    description: 'Unlock all text channels in the server for a role',
    usage: 'unlockall [@role]',
    category: 'admin',

    async execute(interaction) {
        try {
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
            const { processed, failed } = await processUnlockAll(interaction.guild, interaction.user, targetRole);

            let content = `# <:Unlock:1521228030842769610> All Channels Unlocked\n\n`;
            content += `Successfully unlocked all text channels for ${roleName}.\n\n`;
            content += `### <:Invoice:1521227903956811836> Results\n`;
            content += `> **Unlocked:** ${processed} channels\n`;
            if (failed > 0) content += `> **Failed:** ${failed} channels\n`;
            content += `\n**Unlocked By:** ${interaction.user.username}\n**Role:** ${roleName}\n\n`;
            content += `> <:Unlock:1521228030842769610> All text channels are now open. ${roleName} can send messages again.`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Unlockall error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred!', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
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
        const textChannels = message.guild.channels.cache.filter(ch => ch.type === ChannelType.GuildText);

        const processingContainer = new ContainerBuilder()
            .setAccentColor(COLORS.WARNING)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Unlock:1521228030842769610> Unlocking All Channels\n\n` +
                `<:Lightning:1521227915537285150> Processing ${textChannels.size} channels for ${roleName}...\n\n-# This may take a moment for large servers`
            ));

        const processingMsg = await message.reply({ components: [processingContainer], flags: MessageFlags.IsComponentsV2 });
        const { processed, failed } = await processUnlockAll(message.guild, message.author, targetRole);

        let content = `# <:Unlock:1521228030842769610> All Channels Unlocked\n\n`;
        content += `Successfully unlocked all text channels for ${roleName}.\n\n`;
        content += `### <:Invoice:1521227903956811836> Results\n`;
        content += `> **Unlocked:** ${processed} channels\n`;
        if (failed > 0) content += `> **Failed:** ${failed} channels\n`;
        content += `\n**Unlocked By:** ${message.author.username}\n**Role:** ${roleName}\n\n`;
        content += `> <:Unlock:1521228030842769610> All text channels are now open. ${roleName} can send messages again.`;

        const resultContainer = new ContainerBuilder()
            .setAccentColor(COLORS.SUCCESS)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

        processingMsg.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
};
