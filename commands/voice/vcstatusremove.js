'use strict';

const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const vui = require('../../utils/voiceUI');
const { applyStatus } = require('./vcstatus');
const jsonStore = require('../../utils/jsonStore');

const STORE_NAME = 'vcstatus-persist';
const SET_VOICE_CHANNEL_STATUS_BIT = PermissionFlagsBits.SetVoiceChannelStatus ?? (1n << 48n);

function hasPermission(member) {
    if (!member?.permissions) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    try { if (member.permissions.has(SET_VOICE_CHANNEL_STATUS_BIT)) return true; } catch {}
    return member.permissions.has(PermissionFlagsBits.ManageChannels);
}

const isVoice = (ch) => ch && (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice);

module.exports = {
    name: 'vcstatusremove',
    prefix: 'vcstatusremove',
    description: 'Remove the voice channel status and clear any persistent status',
    usage: 'vcstatusremove [#channel]',
    category: 'voice',
    aliases: ['vcstatusclear', 'removestatus', 'clearstatus', 'vsr'],

    data: new SlashCommandBuilder()
        .setName('vcstatusremove')
        .setDescription('Remove voice channel status and clear persistence')
        .addChannelOption(o => o
            .setName('channel')
            .setDescription('Voice channel (defaults to your current VC)')
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
            .setRequired(false)),

    async _run(client, gid, member, channel, username, reply) {
        if (!hasPermission(member)) {
            return reply(vui.payload(vui.err(gid, 'Missing Permission', 'You need the **Manage Channels** permission.')));
        }
        if (!isVoice(channel)) {
            return reply(vui.payload(vui.err(gid, 'No Voice Channel', 'Mention a voice channel or join one.')));
        }
        try {
            await applyStatus(client, channel.id, null);
            const data = jsonStore.read(STORE_NAME) || {};
            delete data[channel.id];
            jsonStore.write(STORE_NAME, data);
            return reply(vui.payload(vui.ok(gid, 'Status Removed', `Cleared the status of **${channel.name}** and removed persistence.`, {
                Channel: `<#${channel.id}>`, 'Removed By': username
            }, vui.E.vol)));
        } catch (e) {
            return reply(vui.payload(vui.err(gid, 'Failed', `Could not clear status: ${e?.rawError?.message || e?.message}`)));
        }
    },

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel') || interaction.member?.voice?.channel;
        return this._run(interaction.client, interaction.guild.id, interaction.member, channel, interaction.user.username,
            (p) => interaction.reply({ ...p, flags: p.flags | MessageFlags.Ephemeral }));
    },

    async executePrefix(message) {
        const mentioned = message.mentions.channels.first();
        const channel = isVoice(mentioned) ? mentioned : message.member?.voice?.channel;
        return this._run(message.client, message.guild.id, message.member, channel, message.author.username,
            (p) => message.reply(p));
    }
};
