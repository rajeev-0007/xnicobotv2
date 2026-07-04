'use strict';

const { PermissionFlagsBits } = require('discord.js');
const vui = require('../../utils/voiceUI');
const { resolveUser } = require('../../utils/resolveUser');

module.exports = {
    name: 'vcmute',
    prefix: 'vcmute',
    description: 'Server mute a user in voice',
    usage: 'vcmute <@user>',
    category: 'voice',
    aliases: ['voicemute', 'servermute', 'vm'],
    permissions: ['MuteMembers'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.MuteMembers, 'Mute Members');
        if (perr) return message.reply(vui.payload(perr));

        const resolved = await resolveUser(message, args);
        const member = resolved ? await message.guild.members.fetch(resolved.id).catch(() => null) : null;
        if (!member) return message.reply(vui.payload(vui.err(gid, 'No User Mentioned', 'Mention a user to mute.', 'Example: `vcmute @User`')));
        if (!member.voice.channel) return message.reply(vui.payload(vui.err(gid, 'Not in Voice', 'That user is not in a voice channel.')));

        try {
            await member.voice.setMute(true);
            return message.reply(vui.payload(vui.ok(gid, 'Voice Muted', `Server muted **${member.user.username}**.`, {
                User: `${member}`, Channel: member.voice.channel.name, Moderator: message.author.username
            }, vui.E.micOff)));
        } catch (e) {
            return message.reply(vui.payload(vui.err(gid, 'Failed', 'Could not mute the user.', e.message)));
        }
    }
};
