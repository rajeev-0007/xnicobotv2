'use strict';

const { PermissionFlagsBits } = require('discord.js');
const vui = require('../../utils/voiceUI');

module.exports = {
    name: 'vckickall',
    prefix: 'vckickall',
    description: 'Kick all members from your current voice channel',
    usage: 'vckickall',
    category: 'voice',
    aliases: ['kickallvc', 'disconnectall', 'vka'],
    permissions: ['MoveMembers'],

    async executePrefix(message) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.MoveMembers, 'Move Members');
        if (perr) return message.reply(vui.payload(perr));

        const channel = message.member.voice.channel;
        if (!channel) return message.reply(vui.payload(vui.err(gid, 'Not in Voice', 'You must be in a voice channel to use this command.')));

        const members = channel.members.filter(m => m.id !== message.author.id);
        if (members.size === 0) return message.reply(vui.payload(vui.err(gid, 'No Members', 'There are no other members in your voice channel.')));

        const msg = await message.reply(vui.payload(vui.warn(gid, 'Voice Kick All', `Kicking **${members.size}** member${members.size === 1 ? '' : 's'} from **${channel.name}**…`)));

        let done = 0;
        for (const [, m] of members) { try { await m.voice.disconnect(); done++; } catch {} }

        const result = vui.ok(gid, 'Voice Kick Complete', `Kicked **${done}/${members.size}** members.`, {
            Channel: channel.name, Kicked: `${done}/${members.size}`, Moderator: message.author.username
        }, vui.E.move);
        return msg.edit(vui.payload(result)).catch(() => message.reply(vui.payload(result)));
    }
};
