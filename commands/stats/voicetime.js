'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getGuildMember } = require('../../utils/database');
const ui = require('../../utils/statsUI');
const { resolveUser } = require('../../utils/resolveUser');

function formatVoice(seconds) {
    if (!seconds || seconds <= 0) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('voicetime')
        .setDescription('Displays the voice time of you or a user')
        .addUserOption(o => o.setName('user').setDescription('User to check').setRequired(false)),
    prefix: 'voicetime',
    description: 'Displays the voice time of you or a user',
    usage: 'voicetime [@user]',
    aliases: ['vt', 'vctime'],
    category: 'stats',

    async execute(interaction) {
        const target = interaction.options.getUser('user') || interaction.user;
        const member = await getGuildMember(interaction.guild.id, target.id).catch(() => null);
        const seconds = member?.analytics?.voiceTime || 0;

        const container = ui.card({
            guildId: interaction.guild.id,
            title: `${ui.E.voice} Voice Time`,
            subtitle: `${target.username} in ${interaction.guild.name}`,
            blocks: [ui.rows([`**Total Voice Time:** \`${formatVoice(seconds)}\``])],
        });
        return interaction.reply(ui.payload(container));
    },

    async executePrefix(message, args) {
        const target = (await resolveUser(message, args)) || message.author;
        const member = await getGuildMember(message.guild.id, target.id).catch(() => null);
        const seconds = member?.analytics?.voiceTime || 0;

        const container = ui.card({
            guildId: message.guild.id,
            title: `${ui.E.voice} Voice Time`,
            subtitle: `${target.username} in ${message.guild.name}`,
            blocks: [ui.rows([`**Total Voice Time:** \`${formatVoice(seconds)}\``])],
        });
        return message.reply(ui.payload(container));
    },
};
