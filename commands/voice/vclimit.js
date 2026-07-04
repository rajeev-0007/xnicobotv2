'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const vui = require('../../utils/voiceUI');

const isVoice = (ch) => ch && (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice);

module.exports = {
    name: 'vclimit',
    prefix: 'vclimit',
    description: 'Set the user limit on a voice channel',
    usage: 'vclimit <limit> [#channel]',
    category: 'voice',
    aliases: ['voicelimit', 'setlimit', 'vl'],
    permissions: ['ManageChannels'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.ManageChannels, 'Manage Channels');
        if (perr) return message.reply(vui.payload(perr));

        if (!args.length) {
            return message.reply(vui.payload(vui.usage(gid, 'Voice Limit', 'vclimit <limit> [#channel]', [
                'vclimit 10', 'vclimit 5 #Gaming', 'vclimit 0 — removes the limit'
            ])));
        }

        const limit = parseInt(args[0], 10);
        if (isNaN(limit) || limit < 0 || limit > 99) {
            return message.reply(vui.payload(vui.err(gid, 'Invalid Limit', 'User limit must be a number between **0** and **99**.', 'Use `0` to remove the limit.')));
        }

        const channel = message.mentions.channels.first() ||
            (args[1] ? message.guild.channels.cache.get(args[1]) : null) ||
            message.member.voice?.channel;
        if (!isVoice(channel)) return message.reply(vui.payload(vui.err(gid, 'No Voice Channel', 'Mention a voice channel or join one to set the limit.')));

        try {
            await channel.setUserLimit(limit);
            return message.reply(vui.payload(vui.ok(gid, 'User Limit Updated',
                limit === 0 ? `Removed the user limit from **${channel.name}**.` : `Set the user limit to **${limit}** in **${channel.name}**.`,
                {
                    Channel: `#${channel.name}`,
                    Limit: limit === 0 ? 'Unlimited' : `${limit} users`,
                    'Current Members': `${channel.members.size}`,
                    Moderator: message.author.username
                }, vui.E.vol)));
        } catch (e) {
            return message.reply(vui.payload(vui.err(gid, 'Failed', `Could not update user limit: ${e.message}`)));
        }
    }
};
