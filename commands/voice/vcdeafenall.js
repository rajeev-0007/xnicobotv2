'use strict';

const { PermissionFlagsBits } = require('discord.js');
const vui = require('../../utils/voiceUI');

module.exports = {
    name: 'vcdeafenall',
    prefix: 'vcdeafenall',
    description: 'Server deafen all members in your voice channel',
    usage: 'vcdeafenall',
    category: 'voice',
    aliases: ['deafenallvc', 'serverdeafenall', 'vda'],
    permissions: ['DeafenMembers'],

    async executePrefix(message) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.DeafenMembers, 'Deafen Members');
        if (perr) return message.reply(vui.payload(perr));

        const vc = message.member.voice.channel;
        if (!vc) return message.reply(vui.payload(vui.err(gid, 'Not in Voice', 'You must be in a voice channel to use this command.')));

        const members = vc.members.filter(m => !m.user.bot && !m.voice.serverDeaf);
        if (members.size === 0) return message.reply(vui.payload(vui.err(gid, 'No Members', 'No undeafened members found in your voice channel.')));

        let done = 0;
        for (const [, m] of members) { try { await m.voice.setDeaf(true); done++; } catch {} }

        return message.reply(vui.payload(vui.ok(gid, 'Voice Deafen All Complete', `Deafened **${done}/${members.size}** members.`, {
            Channel: vc.name, Deafened: `${done}/${members.size}`, Moderator: message.author.username
        }, vui.E.volOff)));
    }
};
