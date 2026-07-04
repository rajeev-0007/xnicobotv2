const { PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { updateGuildConfig } = require('../../utils/database');
const lui = require('../../utils/levelingUI');

const jsonStore = require('../../utils/jsonStore');

function getLevelChannel() {
    if (!jsonStore.has('levelchannel')) {
        jsonStore.write('levelchannel', {});
        return {};
    }
    return jsonStore.read('levelchannel');
}

function saveLevelChannel(data) {
    jsonStore.write('levelchannel', data);
}

module.exports = {
    data: null, // Prefix-only
    name: 'levelchannel',
    prefix: 'levelchannel',
    description: 'Set the level-up announcement channel',
    usage: 'levelchannel <set|remove> [#channel]',
    category: 'leveling',
    aliases: ['lvlchannel'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = lui.requirePerm(message.member, gid);
        if (perr) return message.reply(lui.payload(perr));

        const subcommand = args[0]?.toLowerCase();

        if (subcommand === 'set') {
            const channel = message.mentions.channels.first();
            if (!channel) {
                return message.reply(lui.payload(lui.err(gid, 'Missing Channel', 'Mention the channel to announce level-ups in.', 'Example: `levelchannel set #level-ups`')));
            }

            const levelChannels = getLevelChannel();
            levelChannels[gid] = channel.id;
            saveLevelChannel(levelChannels);

            await updateGuildConfig(gid, {
                'leveling.announcements.enabled': true,
                'leveling.announcements.channel': 'custom',
                'leveling.announcements.customChannelId': channel.id,
                'leveling.announcementChannel': channel.id
            }).catch(() => {});

            return message.reply(lui.payload(lui.ok(gid, 'Level Channel Set', `All level-up announcements will now be sent to ${channel}.`, {
                Channel: `${channel}`, Type: 'Custom Channel'
            }, { emoji: lui.E.bullhorn })));
        }

        if (subcommand === 'disable' || subcommand === 'remove') {
            const levelChannels = getLevelChannel();
            if (!levelChannels[gid]) {
                return message.reply(lui.payload(lui.warn(gid, 'Not Configured', 'No level channel is configured.', null)));
            }

            delete levelChannels[gid];
            saveLevelChannel(levelChannels);

            await updateGuildConfig(gid, {
                'leveling.announcements.channel': 'same',
                'leveling.announcements.customChannelId': null,
                'leveling.announcementChannel': null
            }).catch(() => {});

            return message.reply(lui.payload(lui.ok(gid, 'Level Channel Disabled', 'Level-up announcements will now appear in the same channel where users level up.', {
                Mode: 'Same Channel'
            })));
        }

        // Status panel
        const { ContainerBuilder, TextDisplayBuilder } = require('discord.js');
        const levelChannels = getLevelChannel();
        const channelId = levelChannels[gid];
        const channel = channelId ? message.guild.channels.cache.get(channelId) : null;

        const body =
            `${lui.rows([
                `**Status:** ${channelId ? `${lui.E.on} Active` : `${lui.E.off} Not Configured`}`,
                `**Channel:** ${channelId ? (channel || '`Deleted Channel`') : 'Same channel where users level up'}`,
            ])}` +
            `\n\n### ${lui.E.doc} Commands\n${lui.rows([
                '`levelchannel set #channel` — Set announcement channel',
                '`levelchannel disable` — Use same channel',
            ])}`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${lui.E.bullhorn} Level Announcement Channel`))
            .addSeparatorComponents(lui.divider())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

        const buttons = [];
        if (channelId) {
            buttons.push(new ButtonBuilder().setCustomId('levelchannel_disable').setLabel('Disable Channel').setStyle(ButtonStyle.Danger).setEmoji('<:Volumeoff:1521228297864745193>'));
        }
        buttons.push(new ButtonBuilder().setCustomId('levelchannel_help').setLabel('Help').setStyle(ButtonStyle.Secondary).setEmoji(lui.E.bulb));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(...buttons));

        return message.reply(lui.payload(lui.applyStyle(container, gid)));
    },
};
