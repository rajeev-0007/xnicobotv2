'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getGuildMember, updateGuildMember } = require('../../utils/database');
const ui = require('../../utils/statsUI');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('addmessages')
        .setDescription('Adds the specified number of messages to a user')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
        .addIntegerOption(o => o.setName('amount').setDescription('Number of messages to add').setRequired(true).setMinValue(1)),
    prefix: 'addmessages',
    description: 'Adds the specified number of messages to a user',
    usage: 'addmessages <@user> <amount>',
    aliases: ['addmsgs'],
    category: 'stats',

    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const amount = interaction.options.getInteger('amount');
        const gid = interaction.guild.id;

        const member = await getGuildMember(gid, target.id);
        const current = member?.analytics?.totalMessages || 0;
        await updateGuildMember(gid, target.id, { analytics: { ...member?.analytics, totalMessages: current + amount } });

        return interaction.reply(ui.payload(ui.card({
            guildId: gid,
            title: `${ui.E.ok} Messages Added`,
            blocks: [ui.rows([
                `**User:** ${target.username}`,
                `**Added:** \`+${amount.toLocaleString()}\``,
                `**New Total:** \`${(current + amount).toLocaleString()}\``,
            ])],
        })));
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply(ui.payload(ui.err(message.guild.id, 'Permission Denied', 'You need **Manage Server** permission.')));
        }

        const target = message.mentions.users.first();
        const amount = parseInt(args.find(a => /^\d+$/.test(a)));

        if (!target || !amount || amount < 1) {
            return message.reply(ui.payload(ui.err(message.guild.id, 'Usage', '`addmessages @user <amount>`')));
        }

        const gid = message.guild.id;
        const member = await getGuildMember(gid, target.id);
        const current = member?.analytics?.totalMessages || 0;
        await updateGuildMember(gid, target.id, { analytics: { ...member?.analytics, totalMessages: current + amount } });

        return message.reply(ui.payload(ui.card({
            guildId: gid,
            title: `${ui.E.ok} Messages Added`,
            blocks: [ui.rows([
                `**User:** ${target.username}`,
                `**Added:** \`+${amount.toLocaleString()}\``,
                `**New Total:** \`${(current + amount).toLocaleString()}\``,
            ])],
        })));
    },
};
