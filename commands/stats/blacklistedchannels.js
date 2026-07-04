'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { db } = require('../../utils/database');
const ui = require('../../utils/statsUI');

function dbKey(guildId) { return `msg_blacklist_${guildId}`; }

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blacklistedchannels')
        .setDescription('Displays the blacklisted channels of this server'),
    prefix: 'blacklistedchannels',
    description: 'Displays the channels blacklisted from message counting',
    usage: 'blacklistedchannels',
    aliases: ['blchannels', 'msgblacklisted'],
    category: 'stats',

    async execute(interaction) {
        const gid = interaction.guild.id;
        const list = (await db.get(dbKey(gid))) || [];

        if (list.length === 0) {
            return interaction.reply(ui.payload(ui.card({
                guildId: gid,
                title: `${ui.E.info} Blacklisted Channels`,
                blocks: ['No channels are currently blacklisted.'],
                note: 'Use `blacklistchannel #channel` to blacklist one',
            })));
        }

        const lines = list.map(id => `<:Caretright:1521227704953864202> <#${id}>`);
        return interaction.reply(ui.payload(ui.card({
            guildId: gid,
            title: `${ui.E.info} Blacklisted Channels`,
            subtitle: `${list.length} channel${list.length > 1 ? 's' : ''} blacklisted`,
            blocks: [lines.join('\n')],
            note: 'Messages in these channels are not counted',
        })));
    },

    async executePrefix(message) {
        const gid = message.guild.id;
        const list = (await db.get(dbKey(gid))) || [];

        if (list.length === 0) {
            return message.reply(ui.payload(ui.card({
                guildId: gid,
                title: `${ui.E.info} Blacklisted Channels`,
                blocks: ['No channels are currently blacklisted.'],
                note: 'Use `blacklistchannel #channel` to blacklist one',
            })));
        }

        const lines = list.map(id => `<:Caretright:1521227704953864202> <#${id}>`);
        return message.reply(ui.payload(ui.card({
            guildId: gid,
            title: `${ui.E.info} Blacklisted Channels`,
            subtitle: `${list.length} channel${list.length > 1 ? 's' : ''} blacklisted`,
            blocks: [lines.join('\n')],
            note: 'Messages in these channels are not counted',
        })));
    },
};
