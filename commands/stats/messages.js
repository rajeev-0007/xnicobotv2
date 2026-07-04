'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getGuildMember } = require('../../utils/database');
const ui = require('../../utils/statsUI');
const { resolveUser } = require('../../utils/resolveUser');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('messages')
        .setDescription('Displays the number of messages sent by you or a user')
        .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(false)),
    prefix: 'messages',
    description: 'Displays the number of messages sent by you or a user',
    usage: 'messages [@user]',
    aliases: ['msgs'],
    category: 'stats',

    async execute(interaction) {
        const target = interaction.options.getUser('user') || interaction.user;
        const member = await getGuildMember(interaction.guild.id, target.id).catch(() => null);
        const count = member?.analytics?.totalMessages || 0;

        const container = ui.card({
            guildId: interaction.guild.id,
            title: `${ui.E.msg} Messages`,
            subtitle: `${target.username} in ${interaction.guild.name}`,
            blocks: [ui.rows([`**Total Messages:** \`${count.toLocaleString()}\``])],
        });
        return interaction.reply(ui.payload(container));
    },

    async executePrefix(message, args) {
        const target = (await resolveUser(message, args)) || message.author;
        const member = await getGuildMember(message.guild.id, target.id).catch(() => null);
        const count = member?.analytics?.totalMessages || 0;

        const container = ui.card({
            guildId: message.guild.id,
            title: `${ui.E.msg} Messages`,
            subtitle: `${target.username} in ${message.guild.name}`,
            blocks: [ui.rows([`**Total Messages:** \`${count.toLocaleString()}\``])],
        });
        return message.reply(ui.payload(container));
    },
};
