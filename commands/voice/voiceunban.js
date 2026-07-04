'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const vui = require('../../utils/voiceUI');
const jsonStore = require('../../utils/jsonStore');
const { resolveUser } = require('../../utils/resolveUser');

const loadBans = () => { try { if (jsonStore.has('voicebans')) return jsonStore.read('voicebans'); } catch {} return {}; };
const saveBans = (b) => jsonStore.write('voicebans', b);

module.exports = {
    name: 'voiceunban',
    prefix: 'voiceunban',
    description: 'Remove voice ban from a user — restores Connect permission on all voice channels',
    usage: 'voiceunban <@user>',
    category: 'voice',
    aliases: ['vunban', 'vub'],
    permissions: ['MoveMembers', 'ManageChannels'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = vui.requirePerm(message.member, gid, PermissionFlagsBits.MoveMembers, 'Move Members');
        if (perr) return message.reply(vui.payload(perr));
        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply(vui.payload(vui.err(gid, 'Missing Bot Permission', 'I need the **Manage Channels** permission to remove voice bans.')));
        }

        const user = await resolveUser(message, args);
        if (!user) return message.reply(vui.payload(vui.err(gid, 'No User Mentioned', 'Mention a user to unban from voice.', 'Example: `voiceunban @User`')));

        const member = await message.guild.members.fetch(user.id).catch(() => null);
        if (!member) return message.reply(vui.payload(vui.err(gid, 'User Not Found', 'That user is not in this server.')));

        const bans = loadBans();
        const banInfo = bans[gid]?.[member.id];

        try {
            const voiceChannels = message.guild.channels.cache.filter(c =>
                c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice);
            let restored = 0;
            for (const [, ch] of voiceChannels) {
                try {
                    const overwrite = ch.permissionOverwrites.cache.get(member.id);
                    if (overwrite && overwrite.deny.has(PermissionFlagsBits.Connect)) {
                        await ch.permissionOverwrites.edit(member.id, { Connect: null });
                        restored++;
                    }
                } catch {}
            }

            if (bans[gid]) {
                delete bans[gid][member.id];
                if (Object.keys(bans[gid]).length === 0) delete bans[gid];
                saveBans(bans);
            }

            const details = {
                User: `${member}`,
                'Channels Restored': `${restored}/${voiceChannels.size}`,
                Moderator: message.author.username
            };
            if (banInfo) {
                details['Original Reason'] = banInfo.reason;
                details['Banned By'] = `<@${banInfo.bannedBy}>`;
            }

            return message.reply(vui.payload(vui.ok(gid, 'Voice Unban Applied', `**${user.username}** has been unbanned from voice channels.`, details, vui.E.unlock)));
        } catch (e) {
            return message.reply(vui.payload(vui.err(gid, 'Failed', 'Could not remove voice ban.', e.message)));
        }
    }
};
