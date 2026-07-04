'use strict';

const { PermissionFlagsBits } = require('discord.js');
const vui = require('../../utils/voiceUI');
const { resolveUser } = require('../../utils/resolveUser');

module.exports = {
    name: 'vcundeafen',
    prefix: 'vcundeafen',
    description: 'Remove server deafen from a user in voice',
    usage: 'vcundeafen <@user>',
    category: 'voice',
    aliases: ['voiceundeafen', 'serverundeafen', 'vud'],
    permissions: ['DeafenMembers'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.DeafenMembers, 'Deafen Members');
        if (perr) return message.reply(vui.payload(perr));

        const resolved = await resolveUser(message, args);
        const member = resolved ? await message.guild.members.fetch(resolved.id).catch(() => null) : null;
        if (!member) return message.reply(vui.payload(vui.err(gid, 'No User Mentioned', 'Mention a user to undeafen.', 'Example: `vcundeafen @User`')));
        if (!member.voice.channel) return message.reply(vui.payload(vui.err(gid, 'Not in Voice', 'That user is not in a voice channel.')));

        try {
            await member.voice.setDeaf(false);
            return message.reply(vui.payload(vui.ok(gid, 'Voice Undeafened', `Undeafened **${member.user.username}**.`, {
                User: `${member}`, Channel: member.voice.channel.name, Moderator: message.author.username
            }, vui.E.vol)));
        } catch (e) {
            return message.reply(vui.payload(vui.err(gid, 'Failed', 'Could not undeafen the user.', e.message)));
        }
    }
};
