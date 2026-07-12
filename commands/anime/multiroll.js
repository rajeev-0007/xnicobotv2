'use strict';

/**
 * amulti — dedicated multi-roll (×5) command. Thin wrapper that reuses the
 * exact roll logic (cost, vote bonus, vote rarity boost, pity) from aroll.js
 * with multi forced on, so the ×5 gacha is discoverable as its own command.
 */

const { SlashCommandBuilder } = require('discord.js');
const roll = require('./roll');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('amulti')
        .setDescription('Do a ×5 multi-roll for anime character cards'),
    prefix: 'amulti',
    description: 'Do a ×5 multi-roll for anime character cards (gacha)',
    usage: 'amulti',
    aliases: ['aroll5', 'multiroll', 'x5roll'],
    category: 'anime',

    async executePrefix(message) {
        await message.channel.sendTyping().catch(() => {});
        return roll.handleRoll(message.reply.bind(message), message.author, message.guild?.id, true);
    },

    async execute(interaction) {
        await interaction.deferReply();
        return roll.handleRoll(
            async (payload) => { await interaction.editReply(payload); return interaction.fetchReply(); },
            interaction.user, interaction.guild?.id, true
        );
    },
};
