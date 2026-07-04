const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildPermissionDenied, buildLoadingResponse } = require('../../utils/responseBuilder');
const { confirmAction } = require('../../utils/confirmAction');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('nuke')
        .setDescription('Clone and delete a channel (nuclear option)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to nuke')
                .addChannelTypes(ChannelType.GuildText)),
    
    prefix: 'nuke',
    description: 'Clone and delete a channel (nuclear option)',
    usage: 'nuke [#channel]',
    category: 'admin',
    
    async execute(interaction) {
        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const container = buildErrorResponse('Missing Bot Permission', 'I need the **Manage Channels** permission to nuke channels.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const channel = interaction.options.getChannel('channel') || interaction.channel;

        if (channel.type !== ChannelType.GuildText) {
            const container = buildErrorResponse('Invalid Channel Type', 'You can only nuke text channels!');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        // ── Confirmation prompt ──
        const { confirmed, button } = await confirmAction(interaction, false, {
            title: 'Confirm Nuke',
            description: `Are you sure you want to **nuke** <#${channel.id}>?\n\nThis clones the channel and **deletes the original** — every message is permanently lost. **This cannot be undone.**`,
            confirmLabel: 'Nuke Channel',
        });
        if (!confirmed) return;

        try {
            const position = channel.position;
            const newChannel = await channel.clone();
            await newChannel.setPosition(position);
            await channel.delete();

            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Trash:1521227750420254820> Channel Nuked`)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(
                            `<:Fire:1521227907647668374> **This channel has been completely reset!**\n\n` +
                            `### <:Document:1521227875016114266> Details\n` +
                            `> <:User:1521227714227343380> **Moderator:** ${interaction.user.username}\n` +
                            `> <:Alarm:1521227869047750689> **Time:** <t:${Math.floor(Date.now() / 1000)}:R>`
                        )
                )
;
            
            await newChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            // Update the confirmation prompt if it survived (different channel nuked)
            await button.editReply({
                components: [buildLoadingResponse('Channel Nuked', `Recreated <#${newChannel.id}> successfully.`)],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
        } catch (error) {
            console.error('Nuke Error:', error);
            const container = buildErrorResponse('Nuke Failed', 'Failed to nuke the channel.', `Error: ${error.message}`);
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const container = buildPermissionDenied('Manage Channels');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const container = buildErrorResponse('Missing Bot Permission', 'I need the **Manage Channels** permission to nuke channels.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const channel = message.mentions.channels.first() || message.channel;

        if (channel.type !== ChannelType.GuildText) {
            const container = buildErrorResponse('Invalid Channel Type', 'You can only nuke text channels!');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // ── Confirmation prompt ──
        const { confirmed, button } = await confirmAction(message, true, {
            title: 'Confirm Nuke',
            description: `Are you sure you want to **nuke** <#${channel.id}>?\n\nThis clones the channel and **deletes the original** — every message is permanently lost. **This cannot be undone.**`,
            confirmLabel: 'Nuke Channel',
        });
        if (!confirmed) return;

        try {
            const position = channel.position;
            const newChannel = await channel.clone();
            await newChannel.setPosition(position);
            await channel.delete();

            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Trash:1521227750420254820> Channel Nuked`)
                )
                .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(
                            `<:Fire:1521227907647668374> **This channel has been completely reset!**\n\n` +
                            `### <:Document:1521227875016114266> Details\n` +
                            `> <:User:1521227714227343380> **Moderator:** ${message.author.username}\n` +
                            `> <:Alarm:1521227869047750689> **Time:** <t:${Math.floor(Date.now() / 1000)}:R>`
                        )
                )
;
            
            await newChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
            await button.editReply({
                components: [buildLoadingResponse('Channel Nuked', `Recreated <#${newChannel.id}> successfully.`)],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => {});
        } catch (error) {
            console.error('Nuke Error:', error);
            const container = buildErrorResponse('Nuke Failed', 'Failed to nuke the channel.', `Error: ${error.message}`);
            await button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    }
};
