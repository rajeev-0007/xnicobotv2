'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { db } = require('../../utils/database');
const ui = require('../../utils/statsUI');

function dbKey(guildId) { return `msg_blacklist_${guildId}`; }

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unblacklistchannel')
        .setDescription('Remove a channel from the message counting blacklist')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addChannelOption(o => o.setName('channel').setDescription('Channel to unblacklist').addChannelTypes(ChannelType.GuildText).setRequired(true)),
    prefix: 'unblacklistchannel',
    description: 'Unblacklists a channel — messages will be counted again',
    usage: 'unblacklistchannel <#channel>',
    aliases: ['unblchannel', 'msgunblacklist'],
    category: 'stats',

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel');
        const gid = interaction.guild.id;

        const list = (await db.get(dbKey(gid))) || [];
        const idx = list.indexOf(channel.id);
        if (idx === -1) {
            return interaction.reply(ui.payload(ui.err(gid, 'Not Blacklisted', `${channel} is not currently blacklisted.`)));
        }

        list.splice(idx, 1);
        await db.set(dbKey(gid), list);

        return interaction.reply(ui.payload(ui.card({
            guildId: gid,
            title: `${ui.E.ok} Channel Unblacklisted`,
            blocks: [ui.rows([`**Channel:** ${channel}`, `Messages in this channel will now be counted.`])],
        })));
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply(ui.payload(ui.err(message.guild.id, 'Permission Denied', 'You need **Manage Server** permission.')));
        }

        const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]);
        if (!channel) {
            return message.reply(ui.payload(ui.err(message.guild.id, 'Usage', '`unblacklistchannel #channel`')));
        }

        const gid = message.guild.id;
        const list = (await db.get(dbKey(gid))) || [];
        const idx = list.indexOf(channel.id);
        if (idx === -1) {
            return message.reply(ui.payload(ui.err(gid, 'Not Blacklisted', `${channel} is not currently blacklisted.`)));
        }

        list.splice(idx, 1);
        await db.set(dbKey(gid), list);

        return message.reply(ui.payload(ui.card({
            guildId: gid,
            title: `${ui.E.ok} Channel Unblacklisted`,
            blocks: [ui.rows([`**Channel:** ${channel}`, `Messages in this channel will now be counted.`])],
        })));
    },
};
