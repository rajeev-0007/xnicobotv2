'use strict';

const { PermissionFlagsBits } = require('discord.js');
const vui = require('../../utils/voiceUI');

module.exports = {
    name: 'vcmuteall',
    prefix: 'vcmuteall',
    description: 'Server mute all members in your voice channel',
    usage: 'vcmuteall',
    category: 'voice',
    aliases: ['muteallvc', 'servermuteall', 'vma'],
    permissions: ['MuteMembers'],

    async executePrefix(message) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.MuteMembers, 'Mute Members');
        if (perr) return message.reply(vui.payload(perr));

        const vc = message.member.voice.channel;
        if (!vc) return message.reply(vui.payload(vui.err(gid, 'Not in Voice', 'You must be in a voice channel to use this command.')));

        const members = vc.members.filter(m => !m.user.bot && !m.voice.serverMute);
        if (members.size === 0) return message.reply(vui.payload(vui.err(gid, 'No Members', 'No unmuted members found in your voice channel.')));

        let done = 0;
        for (const [, m] of members) { try { await m.voice.setMute(true); done++; } catch {} }

        return message.reply(vui.payload(vui.ok(gid, 'Voice Mute All Complete', `Muted **${done}/${members.size}** members.`, {
            Channel: vc.name, Muted: `${done}/${members.size}`, Moderator: message.author.username
        }, vui.E.micOff)));
    }
};
