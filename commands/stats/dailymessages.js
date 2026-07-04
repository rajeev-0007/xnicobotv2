'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const ui = require('../../utils/statsUI');
const { resolveUser } = require('../../utils/resolveUser');

function getTodayCount(guildId, userId) {
    try {
        const tracker = require('../../utils/activityTracker');
        const stats = tracker.getUserStats(guildId, userId);
        // getUserStats returns a snapshot with msg daily breakdown
        // dayKey gives today's key
        const today = tracker.dayKey();
        return stats?.msg?.[today] || 0;
    } catch {
        return 0;
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dailymessages')
        .setDescription('Displays messages sent today by you or a user')
        .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(false)),
    prefix: 'dailymessages',
    description: 'Displays the number of messages sent today by you or a user',
    usage: 'dailymessages [@user]',
    aliases: ['dailymsgs', 'todaymsgs'],
    category: 'stats',

    async execute(interaction) {
        const target = interaction.options.getUser('user') || interaction.user;
        const count = getTodayCount(interaction.guild.id, target.id);

        const container = ui.card({
            guildId: interaction.guild.id,
            title: `${ui.E.msg} Daily Messages`,
            subtitle: `${target.username} — Today`,
            blocks: [ui.rows([`**Messages Today:** \`${count.toLocaleString()}\``])],
        });
        return interaction.reply(ui.payload(container));
    },

    async executePrefix(message, args) {
        const target = (await resolveUser(message, args)) || message.author;
        const count = getTodayCount(message.guild.id, target.id);

        const container = ui.card({
            guildId: message.guild.id,
            title: `${ui.E.msg} Daily Messages`,
            subtitle: `${target.username} — Today`,
            blocks: [ui.rows([`**Messages Today:** \`${count.toLocaleString()}\``])],
        });
        return message.reply(ui.payload(container));
    },
};
