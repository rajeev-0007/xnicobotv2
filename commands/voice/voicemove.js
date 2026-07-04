'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const vui = require('../../utils/voiceUI');

const isVoice = (ch) => ch && (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice);

module.exports = {
    name: 'voicemove',
    prefix: 'voicemove',
    description: 'Move users between voice channels',
    usage: 'voicemove <source|all> <#destination>',
    category: 'voice',
    aliases: ['vmove', 'movevc', 'vmv'],
    permissions: ['MoveMembers'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.MoveMembers, 'Move Members');
        if (perr) return message.reply(vui.payload(perr));

        if (args.length < 2) {
            return message.reply(vui.payload(vui.usage(gid, 'Voice Move', 'voicemove <source|all> <#destination>', [
                'voicemove all #General', 'voicemove #AFK #General'
            ])));
        }

        const sourceArg = args[0].toLowerCase();
        const destination = message.mentions.channels.last() || message.guild.channels.cache.get(args[1]);
        if (!isVoice(destination)) return message.reply(vui.payload(vui.err(gid, 'Invalid Channel', 'Provide a valid destination voice channel.')));

        let members = [];
        let sourceName = 'all channels';

        if (sourceArg === 'all') {
            message.guild.channels.cache
                .filter(isVoice)
                .forEach(ch => ch.members.forEach(m => members.push(m)));
        } else {
            const source = message.mentions.channels.first();
            if (!isVoice(source)) return message.reply(vui.payload(vui.err(gid, 'Invalid Source', 'Provide a valid source voice channel or use `all`.')));
            members = Array.from(source.members.values());
            sourceName = source.name;
        }

        if (members.length === 0) return message.reply(vui.payload(vui.err(gid, 'No Members', 'No members found in the source channel(s).')));

        let done = 0;
        for (const m of members) { try { await m.voice.setChannel(destination); done++; } catch {} }

        return message.reply(vui.payload(vui.ok(gid, 'Voice Move Complete', `Moved **${done}/${members.length}** members.`, {
            From: sourceName, To: destination.name, Moved: `${done}/${members.length}`, Moderator: message.author.username
        }, vui.E.move)));
    }
};
