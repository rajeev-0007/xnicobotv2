'use strict';

/**
 * channelinfo.js — prefix-only.
 * Displays metadata for the mentioned channel or the channel the
 * message was sent in.
 */

const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ChannelType, MessageFlags } = require('discord.js');

const CHANNEL_TYPES = {
    [ChannelType.GuildText]:         'Text Channel',
    [ChannelType.GuildVoice]:        'Voice Channel',
    [ChannelType.GuildCategory]:     'Category',
    [ChannelType.GuildAnnouncement]: 'Announcement Channel',
    [ChannelType.GuildStageVoice]:   'Stage Channel',
    [ChannelType.GuildForum]:        'Forum Channel'
};

function buildChannelInfo(channel) {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Pin:1521227932625014916> Channel Information: #${channel.name}`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `<:Fileuser:1521228225466859792> **Channel ID:** \`${channel.id}\`\n` +
                `<:Copy:1521227960554881084> **Type:** ${CHANNEL_TYPES[channel.type] || 'Unknown'}\n` +
                `<:Clock:1521228110408847623> **Created:** <t:${Math.floor(channel.createdTimestamp / 1000)}:R>` +
                (channel.parent ? `\n<:Folderopen:1521227986966417642> **Category:** ${channel.parent.name}` : '')
            )
        );

    if (channel.type === ChannelType.GuildText) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### <:Edit:1521227886634205298> Text Channel Settings\n` +
                `<:Edit:1521227886634205298> **Topic:** ${channel.topic || 'No topic set'}\n` +
                `<:Commentblock:1521227898101432331> **NSFW:** ${channel.nsfw ? 'Yes' : 'No'}\n` +
                `<:Timer:1521227971590095070> **Slowmode:** ${channel.rateLimitPerUser ? `${channel.rateLimitPerUser}s` : 'Disabled'}`
            )
        );
    }

    if (channel.type === ChannelType.GuildVoice) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### <:Volumeup:1521228004502536272> Voice Channel Settings\n` +
                `<:User:1521227714227343380> **User Limit:** ${channel.userLimit || 'Unlimited'}\n` +
                `<:Volumeup:1521228004502536272> **Bitrate:** ${channel.bitrate / 1000}kbps\n` +
                `<:User:1521227714227343380> **Connected:** ${channel.members.size}`
            )
        );
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    return container;
}

module.exports = {
    name: 'channelinfo',
    prefix: 'channelinfo',
    aliases: ['channel-info', 'cinfo'],
    description: 'Display information about a channel',
    usage: 'channelinfo [#channel]',
    category: 'basic',

    async executePrefix(message) {
        try {
            const channel = message.mentions.channels.first() || message.channel;
            const container = buildChannelInfo(channel);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[channelinfo]', error);
            await message.reply('<:Cancel:1521227723916181644> An error occurred while running this command.').catch(() => {});
        }
    }
};
