const { PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { updateGuildConfig } = require('../../utils/database');
const lui = require('../../utils/levelingUI');

const jsonStore = require('../../utils/jsonStore');

function getToggle() {
    if (!jsonStore.has('levelingtoggle')) {
        jsonStore.write('levelingtoggle', {});
        return {};
    }
    return jsonStore.read('levelingtoggle');
}

function saveToggle(data) {
    jsonStore.write('levelingtoggle', data);
}

module.exports = {
    data: null, // Prefix-only
    name: 'toggleleveling',
    prefix: 'toggleleveling',
    description: 'Toggle leveling on or off for channels',
    usage: 'toggleleveling <on|off|enable|disable|list> [#channel]',
    category: 'leveling',
    aliases: ['togglelevel', 'togglexp'],

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = lui.requirePerm(message.member, gid);
        if (perr) return message.reply(lui.payload(perr));

        const subcommand = args[0]?.toLowerCase();

        if (subcommand === 'on') {
            const toggle = getToggle();
            if (!toggle[gid]) toggle[gid] = { enabled: true, disabledChannels: [] };
            toggle[gid].enabled = true;
            saveToggle(toggle);
            await updateGuildConfig(gid, { 'leveling.enabled': true }).catch(() => {});

            return message.reply(lui.payload(lui.ok(gid, 'Leveling System Enabled', 'Users will now gain XP when chatting in this server.', {
                Status: `${lui.E.on} Active`, 'XP Gain': 'All eligible channels',
            }, { emoji: lui.E.on, note: 'Use `toggleleveling disable #channel` to disable XP in specific channels' })));
        }

        if (subcommand === 'off') {
            const toggle = getToggle();
            if (!toggle[gid]) toggle[gid] = { enabled: false, disabledChannels: [] };
            toggle[gid].enabled = false;
            saveToggle(toggle);
            await updateGuildConfig(gid, { 'leveling.enabled': false }).catch(() => {});

            return message.reply(lui.payload(lui.err(gid, 'Leveling System Disabled', 'Users will no longer gain XP in this server.', 'Status: Inactive')));
        }

        if (subcommand === 'disable') {
            const channel = message.mentions.channels.first();
            if (!channel) {
                return message.reply(lui.payload(lui.err(gid, 'Missing Channel', 'Mention the channel to disable XP in.', 'Example: `toggleleveling disable #bot-spam`')));
            }

            const toggle = getToggle();
            if (!toggle[gid]) toggle[gid] = { enabled: true, disabledChannels: [] };

            if (toggle[gid].disabledChannels.includes(channel.id)) {
                return message.reply(lui.payload(lui.warn(gid, 'Already Disabled', `XP gain is already disabled in ${channel}.`)));
            }

            toggle[gid].disabledChannels.push(channel.id);
            saveToggle(toggle);

            return message.reply(lui.payload(lui.ok(gid, 'Channel XP Disabled', `XP gain has been disabled in ${channel}.`, {
                Channel: `${channel}`, 'Disabled Channels': `${toggle[gid].disabledChannels.length} total`,
            })));
        }

        if (subcommand === 'enable') {
            const channel = message.mentions.channels.first();
            const toggle = getToggle();
            if (!toggle[gid]) toggle[gid] = { enabled: true, disabledChannels: [] };

            if (!channel) {
                toggle[gid].enabled = true;
                saveToggle(toggle);
                await updateGuildConfig(gid, { 'leveling.enabled': true }).catch(() => {});
                return message.reply(lui.payload(lui.ok(gid, 'Leveling System Enabled', 'Users will now gain XP when chatting in this server.', {
                    Status: `${lui.E.on} Active`,
                }, { emoji: lui.E.on })));
            }

            const before = toggle[gid].disabledChannels.length;
            toggle[gid].disabledChannels = toggle[gid].disabledChannels.filter(id => id !== channel.id);
            saveToggle(toggle);

            if (before === toggle[gid].disabledChannels.length) {
                return message.reply(lui.payload(lui.warn(gid, 'Not in List', `${channel} was not in the disabled channels list.`)));
            }

            return message.reply(lui.payload(lui.ok(gid, 'Channel XP Enabled', `XP gain has been re-enabled in ${channel}.`, {
                Channel: `${channel}`, 'Disabled Channels': `${toggle[gid].disabledChannels.length} remaining`,
            })));
        }

        if (subcommand === 'list') {
            const toggle = getToggle();
            const guildToggle = toggle[gid];
            const isEnabled = guildToggle?.enabled !== false;
            const disabledChannels = guildToggle?.disabledChannels || [];

            const lines = [`**System Status:** ${isEnabled ? `${lui.E.on} Enabled` : `${lui.E.off} Disabled`}`];
            if (disabledChannels.length === 0) {
                lines.push('**Disabled Channels:** none — XP is active everywhere');
            } else {
                lines.push(`**Disabled Channels (${disabledChannels.length}):**`);
                for (const channelId of disabledChannels) {
                    const ch = message.guild.channels.cache.get(channelId);
                    lines.push(`${ch || `\`${channelId}\` (deleted)`}`);
                }
            }

            return message.reply(lui.payload(lui.list(gid, 'Leveling Toggle Status', lines, {
                emoji: lui.E.gear, note: 'Use `toggleleveling on/off` to toggle the system',
            })));
        }

        // No subcommand — toggle the system and show help
        const toggleConfig = getToggle();
        if (!toggleConfig[gid]) toggleConfig[gid] = { enabled: false, disabledChannels: [] };

        const isEnabled = toggleConfig[gid].enabled === true;
        toggleConfig[gid].enabled = !isEnabled;
        saveToggle(toggleConfig);
        await updateGuildConfig(gid, { 'leveling.enabled': !isEnabled }).catch(() => {});

        const newState = !isEnabled;
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ${lui.E.fire} Leveling System\n\n**Status:** ${newState ? `${lui.E.on} Enabled` : `${lui.E.off} Disabled`}`
            ))
            .addSeparatorComponents(lui.divider())
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${lui.E.doc} Available Commands\n${lui.rows([
                    '`toggleleveling on` — Enable leveling system',
                    '`toggleleveling off` — Disable leveling system',
                    '`toggleleveling enable #channel` — Re-enable XP in a channel',
                    '`toggleleveling disable #channel` — Disable XP in a channel',
                    '`toggleleveling list` — View disabled channels',
                ])}`
            ))
            .addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('toggleleveling_list').setLabel('View Disabled Channels').setStyle(ButtonStyle.Primary).setEmoji(lui.E.doc),
                new ButtonBuilder().setCustomId('toggleleveling_toggle').setLabel(newState ? 'Disable' : 'Enable').setStyle(newState ? ButtonStyle.Danger : ButtonStyle.Success).setEmoji(newState ? lui.E.off : lui.E.on)
            ));

        return message.reply(lui.payload(lui.applyStyle(container, gid)));
    },
};
