'use strict';

const { PermissionFlagsBits } = require('discord.js');
const vui = require('../../utils/voiceUI');

module.exports = {
    name: 'vcundeafenall',
    prefix: 'vcundeafenall',
    description: 'Server undeafen all members in your voice channel',
    usage: 'vcundeafenall',
    category: 'voice',
    aliases: ['undeafenallvc', 'vuda'],
    permissions: ['DeafenMembers'],

    async executePrefix(message) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.DeafenMembers, 'Deafen Members');
        if (perr) return message.reply(vui.payload(perr));

        const vc = message.member.voice.channel;
        if (!vc) return message.reply(vui.payload(vui.err(gid, 'Not in Voice', 'You must be in a voice channel to use this command.')));

        const members = vc.members.filter(m => !m.user.bot && m.voice.serverDeaf);
        if (members.size === 0) return message.reply(vui.payload(vui.err(gid, 'No Members', 'No deafened members found in your voice channel.')));

        let done = 0;
        for (const [, m] of members) { try { await m.voice.setDeaf(false); done++; } catch {} }

        return message.reply(vui.payload(vui.ok(gid, 'Voice Undeafen All Complete', `Undeafened **${done}/${members.size}** members.`, {
            Channel: vc.name, Undeafened: `${done}/${members.size}`, Moderator: message.author.username
        }, vui.E.vol)));
    }
};
