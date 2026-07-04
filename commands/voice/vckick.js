'use strict';

const { PermissionFlagsBits } = require('discord.js');
const vui = require('../../utils/voiceUI');
const { resolveUser } = require('../../utils/resolveUser');

module.exports = {
    name: 'vckick',
    prefix: 'vckick',
    description: 'Kick a user from their voice channel',
    usage: 'vckick <@user>',
    category: 'voice',
    aliases: ['voicekick', 'disconnectvc', 'vk'],
    permissions: ['MoveMembers'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.MoveMembers, 'Move Members');
        if (perr) return message.reply(vui.payload(perr));

        const resolved = await resolveUser(message, args);
        const member = resolved ? await message.guild.members.fetch(resolved.id).catch(() => null) : null;
        if (!member) return message.reply(vui.payload(vui.err(gid, 'No User Mentioned', 'Mention a user to kick from voice.', 'Example: `vckick @User`')));
        if (!member.voice.channel) return message.reply(vui.payload(vui.err(gid, 'Not in Voice', 'That user is not in a voice channel.')));

        const channelName = member.voice.channel.name;
        try {
            await member.voice.disconnect();
            return message.reply(vui.payload(vui.ok(gid, 'Voice Kicked', `Kicked **${member.user.username}** from voice.`, {
                User: `${member}`, Channel: channelName, Moderator: message.author.username
            }, vui.E.move)));
        } catch (e) {
            return message.reply(vui.payload(vui.err(gid, 'Failed', 'Could not kick the user from voice.', e.message)));
        }
    }
};
