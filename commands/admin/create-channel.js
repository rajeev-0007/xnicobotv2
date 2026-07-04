const { MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildHelpResponse } = require('../../utils/responseBuilder');

module.exports = {
    data: null,
    prefix: 'create-channel',
    description: 'Create a new channel in the server',
    usage: 'create-channel <type> <name>',
    category: 'admin',
    aliases: ['category-create'],

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const container = buildPermissionDenied('Manage Channels');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const type = args[0]?.toLowerCase();
        const name = args.slice(1).join(' ');

        if (!type || !['text', 'voice', 'category', 'announcement', 'stage', 'forum'].includes(type) || !name) {
            const container = buildHelpResponse(
                'Create Channel',
                'Create a new channel in the server.',
                '-create-channel <type> <name>',
                ['-create-channel text general-chat', '-create-channel voice Music Room', '-create-channel category Gaming'],
                [
                    { name: 'text', description: 'Create a text channel', required: false },
                    { name: 'voice', description: 'Create a voice channel', required: false },
                    { name: 'category', description: 'Create a category', required: false },
                    { name: 'announcement', description: 'Create an announcement channel', required: false },
                    { name: 'stage', description: 'Create a stage channel', required: false },
                    { name: 'forum', description: 'Create a forum channel', required: false }
                ]
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const channelTypes = {
            text: ChannelType.GuildText,
            voice: ChannelType.GuildVoice,
            category: ChannelType.GuildCategory,
            announcement: ChannelType.GuildAnnouncement,
            stage: ChannelType.GuildStageVoice,
            forum: ChannelType.GuildForum
        };

        const typeEmojis = {
            text: '<:Edit:1521227886634205298>',
            voice: '<:Volumeup:1521228004502536272>',
            category: '<:Folderopen:1521227986966417642>',
            announcement: '<:Bullhorn:1521227936575914016>',
            stage: '<:Userplus:1521227719621218477>',
            forum: '<:Hashtag:1521227771957870604>'
        };

        try {
            const channel = await message.guild.channels.create({
                name: name,
                type: channelTypes[type],
                reason: `Created by ${message.author.username}`
            });

            const container = buildSuccessResponse(
                `<:Checkedbox:1521227734943269077> ${typeEmojis[type]} Channel Created`,
                `<:Checkedbox:1521227734943269077> Successfully created a new ${type} channel.`,
                {
                    '<:Caretright:1521227704953864202> Name': name,
                    '<:Caretright:1521227704953864202> Channel': type === 'category' ? name : `${channel}`,
                    '<:Caretright:1521227704953864202> Type': type.charAt(0).toUpperCase() + type.slice(1),
                    '<:Caretright:1521227704953864202> ID': channel.id,
                    '<:Caretright:1521227704953864202> Created By': `${message.author.username}`
                }
            );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse(
                'Failed to Create Channel',
                'An error occurred while creating the channel.',
                `Error: ${error.message}`
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
