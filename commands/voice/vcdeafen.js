'use strict';

const { PermissionFlagsBits } = require('discord.js');
const vui = require('../../utils/voiceUI');
const { resolveUser } = require('../../utils/resolveUser');

module.exports = {
    name: 'vcdeafen',
    prefix: 'vcdeafen',
    description: 'Server deafen a user in voice',
    usage: 'vcdeafen <@user>',
    category: 'voice',
    aliases: ['voicedeafen', 'serverdeafen', 'vd'],
    permissions: ['DeafenMembers'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.DeafenMembers, 'Deafen Members');
        if (perr) return message.reply(vui.payload(perr));

        const resolved = await resolveUser(message, args);
        const member = resolved ? await message.guild.members.fetch(resolved.id).catch(() => null) : null;
        if (!member) return message.reply(vui.payload(vui.err(gid, 'No User Mentioned', 'Mention a user to deafen.', 'Example: `vcdeafen @User`')));
        if (!member.voice.channel) return message.reply(vui.payload(vui.err(gid, 'Not in Voice', 'That user is not in a voice channel.')));

        try {
            await member.voice.setDeaf(true);
            return message.reply(vui.payload(vui.ok(gid, 'Voice Deafened', `Server deafened **${member.user.username}**.`, {
                User: `${member}`, Channel: member.voice.channel.name, Moderator: message.author.username
            }, vui.E.volOff)));
        } catch (e) {
            return message.reply(vui.payload(vui.err(gid, 'Failed', 'Could not deafen the user.', e.message)));
        }
    }
};
