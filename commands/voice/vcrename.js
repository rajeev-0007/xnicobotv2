'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const vui = require('../../utils/voiceUI');

const isVoice = (ch) => ch && (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice);

module.exports = {
    name: 'vcrename',
    prefix: 'vcrename',
    description: 'Rename a voice channel',
    usage: 'vcrename [#channel] <new name>',
    category: 'voice',
    aliases: ['voicerename', 'renamevc', 'vrn'],
    permissions: ['ManageChannels'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.ManageChannels, 'Manage Channels');
        if (perr) return message.reply(vui.payload(perr));

        if (!args.length) {
            return message.reply(vui.payload(vui.usage(gid, 'Voice Rename', 'vcrename [#channel] <new name>', [
                'vcrename Gaming Lounge — renames your current VC', 'vcrename #General New Name'
            ])));
        }

        let channel, newName;
        const mentioned = message.mentions.channels.first();
        if (isVoice(mentioned)) {
            channel = mentioned;
            newName = args.slice(1).join(' ');
        } else {
            channel = message.member.voice?.channel;
            newName = args.join(' ');
        }

        if (!isVoice(channel)) return message.reply(vui.payload(vui.err(gid, 'No Voice Channel', 'Mention a voice channel or join one to rename it.')));
        if (!newName) return message.reply(vui.payload(vui.err(gid, 'No Name', 'Provide a new name for the voice channel.')));
        if (newName.length > 100) return message.reply(vui.payload(vui.err(gid, 'Name Too Long', 'Channel names must be **100 characters** or less.')));

        const oldName = channel.name;
        try {
            await channel.setName(newName);
            return message.reply(vui.payload(vui.ok(gid, 'Voice Channel Renamed', 'Renamed the voice channel.', {
                'Old Name': oldName, 'New Name': newName, Moderator: message.author.username
            }, vui.E.vol)));
        } catch (e) {
            return message.reply(vui.payload(vui.err(gid, 'Failed', `Could not rename the channel: ${e.message}`)));
        }
    }
};
