'use strict';

const { PermissionFlagsBits } = require('discord.js');
const vui = require('../../utils/voiceUI');

module.exports = {
    name: 'vcunmuteall',
    prefix: 'vcunmuteall',
    description: 'Server unmute all members in your voice channel',
    usage: 'vcunmuteall',
    category: 'voice',
    aliases: ['unmuteallvc', 'vuma'],
    permissions: ['MuteMembers'],

    async executePrefix(message) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.MuteMembers, 'Mute Members');
        if (perr) return message.reply(vui.payload(perr));

        const vc = message.member.voice.channel;
        if (!vc) return message.reply(vui.payload(vui.err(gid, 'Not in Voice', 'You must be in a voice channel to use this command.')));

        const members = vc.members.filter(m => !m.user.bot && m.voice.serverMute);
        if (members.size === 0) return message.reply(vui.payload(vui.err(gid, 'No Members', 'No muted members found in your voice channel.')));

        let done = 0;
        for (const [, m] of members) { try { await m.voice.setMute(false); done++; } catch {} }

        return message.reply(vui.payload(vui.ok(gid, 'Voice Unmute All Complete', `Unmuted **${done}/${members.size}** members.`, {
            Channel: vc.name, Unmuted: `${done}/${members.size}`, Moderator: message.author.username
        }, vui.E.vol)));
    }
};
