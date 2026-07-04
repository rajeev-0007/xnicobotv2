'use strict';
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, PermissionFlagsBits, ChannelType, SlashCommandBuilder } = require('discord.js');
const { buildPermissionDenied, COLORS } = require('../../utils/responseBuilder');
const { confirmAction } = require('../../utils/confirmAction');

async function processHideAll(guild, user, targetRole) {
    const channels = guild.channels.cache.filter(ch =>
        ch.type === ChannelType.GuildText ||
        ch.type === ChannelType.GuildVoice ||
        ch.type === ChannelType.GuildAnnouncement ||
        ch.type === ChannelType.GuildForum ||
        ch.type === ChannelType.GuildStageVoice
    );
    let hidden = 0, failed = 0;
    for (const [, channel] of channels) {
        try {
            await channel.permissionOverwrites.edit(targetRole, { ViewChannel: false }, { reason: `Hide all by ${user.username}` });
            hidden++;
        } catch { failed++; }
    }
    return { hidden, failed, total: channels.size };
}

function buildResultContent(hidden, failed, user, roleName) {
    return `# <:Lock:1521227892770734120> All Channels Hidden\n\nSuccessfully hidden all channels from ${roleName}.\n\n### <:Bookopen:1521227911137595605> Results\n> **Hidden:** ${hidden} channels\n${failed > 0 ? `> **Failed:** ${failed} channels\n` : ''}\n**Hidden By:** ${user.username}\n**Role:** ${roleName}\n\n> <:Lock:1521227892770734120> All channels are now invisible to ${roleName}.\n> Use \`/unhideall\` or \`-unhideall\` to make them visible again.`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hideall')
        .setDescription('Hide all channels in the server from a role (defaults to @everyone)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to hide channels from (defaults to @everyone)')
                .setRequired(false)),

    prefix: 'hideall',
    description: 'Hide all channels in the server from a role (defaults to @everyone)',
    usage: 'hideall [@role]',
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

            const { confirmed, button } = await confirmAction(interaction, false, {
                title: 'Confirm Hide All Channels',
                description: `Hide **every channel** in this server from ${roleName}?\n\nThey won't be able to see any channels until you run \`/unhideall\`.`,
                confirmLabel: 'Hide All',
            });
            if (!confirmed) return;

            const { hidden, failed } = await processHideAll(interaction.guild, interaction.user, targetRole);

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    buildResultContent(hidden, failed, interaction.user, roleName)
                ))
;

            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        } catch (error) {
            console.error('Hideall error:', error);
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

        const targetRole = message.mentions.roles.first() || message.guild.roles.everyone;
        const roleName   = targetRole.id === message.guild.roles.everyone.id ? '@everyone' : `<@&${targetRole.id}>`;

        const channels = message.guild.channels.cache.filter(ch =>
            ch.type === ChannelType.GuildText ||
            ch.type === ChannelType.GuildVoice ||
            ch.type === ChannelType.GuildAnnouncement ||
            ch.type === ChannelType.GuildForum ||
            ch.type === ChannelType.GuildStageVoice
        );

        const { confirmed, button } = await confirmAction(message, true, {
            title: 'Confirm Hide All Channels',
            description: `Hide **all ${channels.size} channels** in this server from ${roleName}?\n\nThey won't be able to see any channels until you run \`-unhideall\`.`,
            confirmLabel: 'Hide All',
        });
        if (!confirmed) return;

        const { hidden, failed } = await processHideAll(message.guild, message.author, targetRole);

        const resultContainer = new ContainerBuilder()
            .setAccentColor(COLORS.SUCCESS)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                buildResultContent(hidden, failed, message.author, roleName)
            ))
;

        await button.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
};
