'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const vui = require('../../utils/voiceUI');

const VALID_BITRATES = [8, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384];
const isVoice = (ch) => ch && (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice);

module.exports = {
    name: 'vcbitrate',
    prefix: 'vcbitrate',
    description: 'Set the audio bitrate of a voice channel',
    usage: 'vcbitrate <kbps> [#channel]',
    category: 'voice',
    aliases: ['voicebitrate', 'setbitrate', 'vbr'],
    permissions: ['ManageChannels'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.ManageChannels, 'Manage Channels');
        if (perr) return message.reply(vui.payload(perr));

        if (!args.length) {
            return message.reply(vui.payload(vui.usage(gid, 'Voice Bitrate', 'vcbitrate <kbps> [#channel]', [
                'vcbitrate 96', 'vcbitrate 128 #Music', 'vcbitrate 64 — sets your current VC'
            ])));
        }

        const bitrate = parseInt(args[0], 10);
        if (isNaN(bitrate) || bitrate < 8 || bitrate > 384) {
            return message.reply(vui.payload(vui.err(gid, 'Invalid Bitrate', `Bitrate must be between **8** and **384** kbps.`, `Common values: ${VALID_BITRATES.join(', ')}`)));
        }

        const channel = message.mentions.channels.first() ||
            (args[1] ? message.guild.channels.cache.get(args[1]) : null) ||
            message.member.voice?.channel;
        if (!isVoice(channel)) return message.reply(vui.payload(vui.err(gid, 'No Voice Channel', 'Mention a voice channel or join one to set the bitrate.')));

        const maxBitrate = message.guild.maximumBitrate / 1000;
        if (bitrate > maxBitrate) {
            return message.reply(vui.payload(vui.err(gid, 'Bitrate Too High', `This server's maximum bitrate is **${maxBitrate} kbps** (Boost Level ${message.guild.premiumTier}).`)));
        }

        try {
            const oldBitrate = channel.bitrate / 1000;
            await channel.setBitrate(bitrate * 1000);
            return message.reply(vui.payload(vui.ok(gid, 'Bitrate Updated', `Updated audio quality for **${channel.name}**.`, {
                Channel: `#${channel.name}`,
                'Old Bitrate': `${oldBitrate} kbps`,
                'New Bitrate': `${bitrate} kbps`,
                'Server Max': `${maxBitrate} kbps`,
                Moderator: message.author.username
            }, vui.E.vol)));
        } catch (e) {
            return message.reply(vui.payload(vui.err(gid, 'Failed', `Could not update bitrate: ${e.message}`)));
        }
    }
};
