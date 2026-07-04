'use strict';

/**
 * fortune.js — prefix-only.
 * Cracks open a fortune cookie for the caller.
 */

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');

const FORTUNES = [
    "A pleasant surprise is waiting for you.",
    "Your hard work will soon pay off.",
    "Good things come to those who wait.",
    "An exciting opportunity is on the horizon.",
    "You will make new friends in unexpected places.",
    "Your creativity will lead to success.",
    "A journey of a thousand miles begins with a single step.",
    "Your kindness will be rewarded.",
    "Trust your instincts, they will guide you well.",
    "Change is coming, embrace it with open arms.",
    "Your persistence will break through any obstacle.",
    "A loved one will bring you great joy soon.",
    "Fortune favors the bold.",
    "Your positive attitude will attract success.",
    "An old friend will reconnect with you soon.",
    "Your talents will be recognized and appreciated.",
    "Take a chance, the odds are in your favor.",
    "Your generosity will come back to you tenfold.",
    "Great things never come from comfort zones.",
    "Your dream will become reality with dedication.",
    "Listen to your heart, it knows the way.",
    "Success is in your near future.",
    "Your smile will brighten someone's day today.",
    "Adventure awaits around the corner."
];

function buildFortune(username) {
    const fortune = FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
    const content =
        `# 🔮 Fortune Cookie\n\n` +
        `**${username}**, your fortune:\n\n` +
        `> *"${fortune}"*\n\n` +
        `-# 🥠 Crack open another fortune cookie for more wisdom!`;

    return new ContainerBuilder()
        .setAccentColor(COLORS.WARNING)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

module.exports = {
    name: 'fortune',
    prefix: 'fortune',
    aliases: ['fortunecookie', 'cookie'],
    description: 'Open a fortune cookie and receive your fortune',
    usage: 'fortune',
    category: 'fun',

    async executePrefix(message) {
        await message.reply({ components: [buildFortune(message.author.username)], flags: MessageFlags.IsComponentsV2 });
    }
};
