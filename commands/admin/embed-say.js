'use strict';

const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ContainerBuilder,
    TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ChannelType
} = require('discord.js');
const {
    buildErrorResponse, buildPermissionDenied, buildInvalidUsage, BRANDING
} = require('../../utils/responseBuilder');

const MAX_LENGTH = 2000;

function buildSentReceipt(channel, actorName, sentMessage, original) {
    const truncated = original.length > 200 ? `${original.slice(0, 200)}…` : original;

    return new ContainerBuilder()
        .setAccentColor(0x57F287)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Message Sent`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### <:Document:1521227875016114266> Delivery\n` +
                `<:Caretright:1521227704953864202> **Channel:** ${channel}\n` +
                `<:Caretright:1521227704953864202> **Length:** \`${original.length}\` characters\n` +
                `<:Caretright:1521227704953864202> **Moderator:** ${actorName}\n` +
                (sentMessage ? `<:Caretright:1521227704953864202> **Jump:** [Open message](${sentMessage.url})` : '')
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### <:Hashtag:1521227771957870604> Preview\n> ${truncated.replace(/\n/g, '\n> ')}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

function isSendableTextChannel(channel) {
    return channel
        && [
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread,
        ].includes(channel.type);
}

module.exports = {
    description: 'Make the bot post a plain message in this channel (mentions are not parsed)',
    usage: 'embed-say <message>',
    category: 'admin',
    permissions: ['ManageMessages'],
    data: new SlashCommandBuilder()
        .setName('embed-say')
        .setDescription('Make the bot post a message in this channel')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('What should the bot say?')
                .setMaxLength(MAX_LENGTH)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        try {
            const text = interaction.options.getString('message');
            if (!isSendableTextChannel(interaction.channel)) {
                const container = buildErrorResponse(
                    'Unsupported Channel',
                    'This command can only post in text, announcement, or thread channels.'
                );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const sent = await interaction.channel.send({
                content: text,
                allowedMentions: { parse: [] },
            });

            const receipt = buildSentReceipt(interaction.channel, interaction.user.username, sent, text);
            await interaction.reply({ components: [receipt], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        } catch (error) {
            console.error('[EMBED-SAY] Slash error:', error);
            const container = buildErrorResponse('Failed to Send', 'Could not post the message.', error.message);
            const fn = interaction.replied || interaction.deferred ? interaction.editReply : interaction.reply;
            await fn.call(interaction, { components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        if (!message.guild) {
            return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        }
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            const container = buildPermissionDenied('Manage Messages');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const text = args.join(' ').trim();
        if (!text) {
            const container = buildInvalidUsage(
                'embed-say',
                '-embed-say <message>',
                ['-embed-say Welcome to the server!', '-embed-say Heads up: read #rules.']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        if (text.length > MAX_LENGTH) {
            const container = buildErrorResponse(
                'Message Too Long',
                `Discord limits messages to **${MAX_LENGTH}** characters. Your message is **${text.length}**.`
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        if (!isSendableTextChannel(message.channel)) {
            const container = buildErrorResponse(
                'Unsupported Channel',
                'This command can only post in text, announcement, or thread channels.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            await message.delete().catch(() => {});
            const sent = await message.channel.send({
                content: text,
                allowedMentions: { parse: [] },
            });

            const receipt = buildSentReceipt(message.channel, message.author.username, sent, text);
            await message.channel.send({ components: [receipt], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        } catch (error) {
            console.error('[EMBED-SAY] Prefix error:', error);
            const container = buildErrorResponse('Failed to Send', 'Could not post the message.', error.message);
            await message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },
};
