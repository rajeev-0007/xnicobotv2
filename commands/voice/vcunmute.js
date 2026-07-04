'use strict';

const { PermissionFlagsBits } = require('discord.js');
const vui = require('../../utils/voiceUI');
const { resolveUser } = require('../../utils/resolveUser');

module.exports = {
    name: 'vcunmute',
    prefix: 'vcunmute',
    description: 'Remove server mute from a user in voice',
    usage: 'vcunmute <@user>',
    category: 'voice',
    aliases: ['voiceunmute', 'serverunmute', 'vum'],
    permissions: ['MuteMembers'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.MuteMembers, 'Mute Members');
        if (perr) return message.reply(vui.payload(perr));

        const resolved = await resolveUser(message, args);
        const member = resolved ? await message.guild.members.fetch(resolved.id).catch(() => null) : null;
        if (!member) return message.reply(vui.payload(vui.err(gid, 'No User Mentioned', 'Mention a user to unmute.', 'Example: `vcunmute @User`')));
        if (!member.voice.channel) return message.reply(vui.payload(vui.err(gid, 'Not in Voice', 'That user is not in a voice channel.')));

        try {
            await member.voice.setMute(false);
            return message.reply(vui.payload(vui.ok(gid, 'Voice Unmuted', `Unmuted **${member.user.username}**.`, {
                User: `${member}`, Channel: member.voice.channel.name, Moderator: message.author.username
            }, vui.E.vol)));
        } catch (e) {
            return message.reply(vui.payload(vui.err(gid, 'Failed', 'Could not unmute the user.', e.message)));
        }
    }
};
