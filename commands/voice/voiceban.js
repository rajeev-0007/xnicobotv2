'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const vui = require('../../utils/voiceUI');
const jsonStore = require('../../utils/jsonStore');
const { resolveUser } = require('../../utils/resolveUser');

const loadBans = () => { try { if (jsonStore.has('voicebans')) return jsonStore.read('voicebans'); } catch {} return {}; };
const saveBans = (b) => jsonStore.write('voicebans', b);

module.exports = {
    name: 'voiceban',
    prefix: 'voiceban',
    description: 'Ban a user from all voice channels — disconnects and prevents rejoining',
    usage: 'voiceban <@user> [reason]',
    category: 'voice',
    aliases: ['vban', 'vb'],
    permissions: ['MoveMembers', 'ManageChannels'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.MoveMembers, 'Move Members');
        if (perr) return message.reply(vui.payload(perr));
        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply(vui.payload(vui.err(gid, 'Missing Bot Permission', 'I need the **Manage Channels** permission to enforce voice bans.')));
        }

        const resolved = await resolveUser(message, args);
        const member = resolved ? await message.guild.members.fetch(resolved.id).catch(() => null) : null;
        const reason = args.slice(1).join(' ') || 'No reason provided';

        if (!member) {
            return message.reply(vui.payload(vui.usage(gid, 'Voice Ban', 'voiceban <@user> [reason]', [
                'voiceban @User Spamming in VC', 'voiceban @User'
            ])));
        }
        if (member.id === message.author.id) return message.reply(vui.payload(vui.err(gid, 'Invalid Target', 'You cannot voice ban yourself.')));
        if (member.id === message.guild.members.me.id) return message.reply(vui.payload(vui.err(gid, 'Invalid Target', 'I cannot voice ban myself.')));

        const prevChannel = member.voice.channel?.name || 'N/A';
        try {
            if (member.voice.channel) await member.voice.disconnect(reason);

            const voiceChannels = message.guild.channels.cache.filter(c =>
                c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice);
            let denied = 0;
            for (const [, ch] of voiceChannels) { try { await ch.permissionOverwrites.edit(member.id, { Connect: false }); denied++; } catch {} }

            const bans = loadBans();
            if (!bans[gid]) bans[gid] = {};
            bans[gid][member.id] = { reason, bannedBy: message.author.id, bannedAt: new Date().toISOString() };
            saveBans(bans);

            const panel = vui.ok(gid, 'Voice Ban Applied', `**${member.user.username}** has been banned from all voice channels.`, {
                User: `${member}`,
                'Previous Channel': prevChannel,
                'Channels Denied': `${denied}/${voiceChannels.size}`,
                Reason: reason,
                Moderator: message.author.username
            }, vui.E.ban);
            return message.reply(vui.payload(panel));
        } catch (e) {
            return message.reply(vui.payload(vui.err(gid, 'Failed', 'Could not voice ban the user.', e.message)));
        }
    }
};
