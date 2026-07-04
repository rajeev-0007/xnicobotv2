'use strict';

const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { createServerActivityCard } = require('../../utils/serverActivityCard');
const { getServerStats } = require('../../utils/activityTracker');
const ui = require('../../utils/statsUI');

async function resolveUserName(guild, id) {
    if (!id) return null;
    const m = guild.members.cache.get(id);
    if (m) return m.displayName;
    const u = guild.client.users.cache.get(id);
    if (u) return u.username;
    try { const f = await guild.client.users.fetch(id); return f.username; } catch { return id; }
}
function resolveChannelName(guild, id) {
    if (!id) return null;
    const ch = guild.channels.cache.get(id);
    return ch ? ch.name : id;
}

async function buildCard(guild) {
    const stats = getServerStats(guild.id);
    const names = {
        topMsgUser: await resolveUserName(guild, stats.topMsgUser?.id),
        topVcUser: await resolveUserName(guild, stats.topVcUser?.id),
        topMsgChannel: resolveChannelName(guild, stats.topMsgChannel?.id),
        topVcChannel: resolveChannelName(guild, stats.topVcChannel?.id),
    };
    const buf = await createServerActivityCard({
        serverName: guild.name,
        iconURL: guild.iconURL({ extension: 'png', size: 256 }) || null,
        createdTs: guild.createdTimestamp,
        invitedTs: guild.members.me?.joinedTimestamp || null,
        stats,
        names,
    });
    return new AttachmentBuilder(buf, { name: 'server-activity.png' });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('serveractivity')
        .setDescription('Server Overview — messages, voice, contributors, top members & a 14-day chart'),

    prefix: 'serveractivity',
    aliases: ['serverstats2', 'guildactivity', 'activitystats', 'activitygraph', 'serveroverview'],
    description: 'Server Overview dashboard — activity, top members/channels & 14-day chart (synced with leveling)',
    usage: 'serveractivity',
    category: 'stats',

    async execute(interaction) {
        await interaction.deferReply();
        try {
            await interaction.editReply({ files: [await buildCard(interaction.guild)] });
        } catch (error) {
            console.error('serveractivity error:', error);
            await interaction.editReply(ui.payload(ui.err(interaction.guild.id, 'Failed', 'Failed to build the server overview.')));
        }
    },

    async executePrefix(message) {
        try {
            await message.reply({ files: [await buildCard(message.guild)] });
        } catch (error) {
            console.error('serveractivity prefix error:', error);
            await message.reply(ui.payload(ui.err(message.guild.id, 'Failed', 'Failed to build the server overview.')));
        }
    }
};
