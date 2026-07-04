'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const vui = require('../../utils/voiceUI');

module.exports = {
    name: 'vcdisconnectall',
    prefix: 'vcdisconnectall',
    description: 'Disconnect every member from every voice channel in the server',
    usage: 'vcdisconnectall',
    category: 'voice',
    aliases: ['vcdcall', 'disconnectallvc', 'vdca'],
    permissions: ['MoveMembers'],

    async executePrefix(message) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.MoveMembers, 'Move Members');
        if (perr) return message.reply(vui.payload(perr));

        const voiceChannels = message.guild.channels.cache
            .filter(ch => ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice);
        const occupied = voiceChannels.filter(ch => ch.members.size > 0);

        const allMembers = [];
        occupied.forEach(ch => ch.members.forEach(m => allMembers.push(m)));
        if (allMembers.length === 0) return message.reply(vui.payload(vui.err(gid, 'No Members', 'No members are connected to any voice channels.')));

        let done = 0, failed = 0;
        for (const m of allMembers) { try { await m.voice.disconnect('vcdisconnectall by moderator'); done++; } catch { failed++; } }

        return message.reply(vui.payload(vui.ok(gid, 'All Voice Disconnected', 'Disconnected every member from voice across the server.', {
            Disconnected: `${done}/${allMembers.length}`,
            'Channels Cleared': `${occupied.size}/${voiceChannels.size}`,
            ...(failed ? { Failed: `${failed}` } : {}),
            Moderator: message.author.username
        }, vui.E.move)));
    }
};
