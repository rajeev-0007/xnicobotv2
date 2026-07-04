'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { db } = require('../../utils/database');
const ui = require('../../utils/statsUI');

function dbKey(guildId) { return `msg_blacklist_${guildId}`; }

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blacklistchannel')
        .setDescription('Blacklist a channel from message counting')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(o => o.setName('channel').setDescription('Channel to blacklist').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    prefix: 'blacklistchannel',
    description: 'Blacklists a channel — messages from that channel won\'t be counted',
    usage: 'blacklistchannel <#channel>',
    aliases: ['blchannel', 'msgblacklist'],
    category: 'stats',

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel');
        const gid = interaction.guild.id;

        const list = (await db.get(dbKey(gid))) || [];
        if (list.includes(channel.id)) {
            return interaction.reply(ui.payload(ui.err(gid, 'Already Blacklisted', `${channel} is already blacklisted.`)));
        }

        list.push(channel.id);
        await db.set(dbKey(gid), list);

        return interaction.reply(ui.payload(ui.card({
            guildId: gid,
            title: `${ui.E.ok} Channel Blacklisted`,
            blocks: [ui.rows([`**Channel:** ${channel}`, `Messages in this channel will no longer be counted.`])],
        })));
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply(ui.payload(ui.err(message.guild.id, 'Permission Denied', 'You need **Manage Server** permission.')));
        }

        const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]);
        if (!channel) {
            return message.reply(ui.payload(ui.err(message.guild.id, 'Usage', '`blacklistchannel #channel`')));
        }

        const gid = message.guild.id;
        const list = (await db.get(dbKey(gid))) || [];
        if (list.includes(channel.id)) {
            return message.reply(ui.payload(ui.err(gid, 'Already Blacklisted', `${channel} is already blacklisted.`)));
        }

        list.push(channel.id);
        await db.set(dbKey(gid), list);

        return message.reply(ui.payload(ui.card({
            guildId: gid,
            title: `${ui.E.ok} Channel Blacklisted`,
            blocks: [ui.rows([`**Channel:** ${channel}`, `Messages in this channel will no longer be counted.`])],
        })));
    },
};
