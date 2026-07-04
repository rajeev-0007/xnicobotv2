'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const vui = require('../../utils/voiceUI');

module.exports = {
    name: 'lockall-voice',
    prefix: 'lockall-voice',
    description: 'Lock all voice channels for a role (default: @everyone)',
    usage: 'lockall-voice [@role]',
    category: 'voice',
    aliases: ['lockvc', 'lockallvc', 'vla'],
    permissions: ['ManageChannels'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.ManageChannels, 'Manage Channels');
        if (perr) return message.reply(vui.payload(perr));

        let targetRole = message.mentions.roles.first();
        if (!targetRole && args[0]) {
            const id = args[0].replace(/[<@&>]/g, '');
            if (/^\d{17,20}$/.test(id)) targetRole = message.guild.roles.cache.get(id);
        }
        const roleId = targetRole?.id || message.guild.id;
        const roleName = targetRole?.name || '@everyone';

        const voiceChannels = message.guild.channels.cache.filter(c =>
            c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice);
        if (voiceChannels.size === 0) return message.reply(vui.payload(vui.err(gid, 'No Channels', 'No voice channels found in this server.')));

        let done = 0;
        for (const [, ch] of voiceChannels) { try { await ch.permissionOverwrites.edit(roleId, { Connect: false }); done++; } catch {} }

        return message.reply(vui.payload(vui.ok(gid, 'Voice Channels Locked', `Locked **${done}/${voiceChannels.size}** voice channels for **${roleName}**.`, {
            Locked: `${done}/${voiceChannels.size}`, Role: roleName, Effect: 'Cannot connect', Moderator: message.author.username
        }, vui.E.lock)));
    }
};
