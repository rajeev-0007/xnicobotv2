'use strict';

const { PermissionFlagsBits } = require('discord.js');
const vui = require('../../utils/voiceUI');

module.exports = {
    name: 'vcdrag',
    prefix: 'vcdrag',
    description: 'Pull mentioned users into your current voice channel',
    usage: 'vcdrag <@user> [@user2 ...]',
    category: 'voice',
    aliases: ['vdrag', 'vcpull', 'pull'],
    permissions: ['MoveMembers'],

    async executePrefix(message) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.MoveMembers, 'Move Members');
        if (perr) return message.reply(vui.payload(perr));

        const destination = message.member.voice?.channel;
        if (!destination) return message.reply(vui.payload(vui.err(gid, 'Not in Voice', 'Join a voice channel first — users are pulled to the channel you are in.')));

        const targets = [...message.mentions.members.values()];
        if (targets.length === 0) {
            return message.reply(vui.payload(vui.usage(gid, 'Voice Drag', 'vcdrag <@user> [@user2 ...]', [
                'vcdrag @User', 'vcdrag @User1 @User2'
            ])));
        }

        let done = 0, skipped = 0;
        for (const m of targets) {
            if (!m.voice.channel || m.voice.channelId === destination.id) { skipped++; continue; }
            try { await m.voice.setChannel(destination); done++; } catch { skipped++; }
        }

        if (done === 0) {
            return message.reply(vui.payload(vui.err(gid, 'Nobody Moved', 'None of the mentioned users could be pulled — they may not be in a voice channel.')));
        }

        return message.reply(vui.payload(vui.ok(gid, 'Voice Drag Complete', `Pulled **${done}** user${done === 1 ? '' : 's'} into **${destination.name}**.`, {
            Destination: `<#${destination.id}>`,
            Pulled: `${done}/${targets.length}`,
            ...(skipped ? { Skipped: `${skipped}` } : {}),
            Moderator: message.author.username
        }, vui.E.move)));
    }
};
