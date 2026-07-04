'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const vui = require('../../utils/voiceUI');

const isVoice = (ch) => ch && (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice);

module.exports = {
    name: 'voicemoveall',
    prefix: 'voicemoveall',
    description: 'Move all members from every voice channel to one destination',
    usage: 'voicemoveall <#destination>',
    category: 'voice',
    aliases: ['vmoveall', 'moveallvc', 'vmva'],
    permissions: ['MoveMembers'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.MoveMembers, 'Move Members');
        if (perr) return message.reply(vui.payload(perr));

        if (!args.length) {
            return message.reply(vui.payload(vui.usage(gid, 'Voice Move All', 'voicemoveall <#destination>', [
                'voicemoveall #General', 'voicemoveall #Meeting'
            ])));
        }

        const destination = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]);
        if (!isVoice(destination)) return message.reply(vui.payload(vui.err(gid, 'Invalid Channel', 'Mention a valid voice channel as the destination.')));

        const allMembers = [];
        message.guild.channels.cache
            .filter(ch => isVoice(ch) && ch.id !== destination.id)
            .forEach(ch => ch.members.forEach(m => allMembers.push(m)));

        if (allMembers.length === 0) return message.reply(vui.payload(vui.err(gid, 'No Members', 'No members found in any voice channels to move.')));

        let done = 0, failed = 0;
        for (const m of allMembers) { try { await m.voice.setChannel(destination); done++; } catch { failed++; } }

        return message.reply(vui.payload(vui.ok(gid, 'Voice Move All Complete', `Moved all voice members to **${destination.name}**.`, {
            Destination: `#${destination.name}`,
            Moved: `${done}/${allMembers.length}`,
            ...(failed ? { Failed: `${failed}` } : {}),
            Moderator: message.author.username
        }, vui.E.move)));
    }
};
