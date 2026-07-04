'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const vui = require('../../utils/voiceUI');

const isVoice = (ch) => ch && (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice);

module.exports = {
    name: 'vclock',
    prefix: 'vclock',
    description: 'Lock a single voice channel so a role cannot connect (default: @everyone)',
    usage: 'vclock [#channel] [@role]',
    category: 'voice',
    aliases: ['lockvoice', 'vclk'],
    permissions: ['ManageChannels'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.ManageChannels, 'Manage Channels');
        if (perr) return message.reply(vui.payload(perr));

        const channel = message.mentions.channels.first() ||
            (args[0] && isVoice(message.guild.channels.cache.get(args[0])) ? message.guild.channels.cache.get(args[0]) : null) ||
            message.member.voice?.channel;
        if (!isVoice(channel)) return message.reply(vui.payload(vui.err(gid, 'No Voice Channel', 'Mention a voice channel or join one to lock it.')));

        const targetRole = message.mentions.roles.first();
        const roleId = targetRole?.id || message.guild.id;
        const roleName = targetRole?.name || '@everyone';

        try {
            await channel.permissionOverwrites.edit(roleId, { Connect: false });
            return message.reply(vui.payload(vui.ok(gid, 'Voice Channel Locked', `Locked **${channel.name}** for **${roleName}**.`, {
                Channel: `<#${channel.id}>`, Role: roleName, Effect: 'Cannot connect', Moderator: message.author.username
            }, vui.E.lock)));
        } catch (e) {
            return message.reply(vui.payload(vui.err(gid, 'Failed', `Could not lock the channel: ${e.message}`)));
        }
    }
};
