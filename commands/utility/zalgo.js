'use strict';

/**
 * zalgo.js — prefix-only.
 * Decorate text with combining diacritics for a creepy "Zalgo" look.
 */

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const ZALGO_CHARS = [
    '\u0300', '\u0301', '\u0302', '\u0303', '\u0304', '\u0305', '\u0306', '\u0307',
    '\u0308', '\u0309', '\u030A', '\u030B', '\u030C', '\u030D', '\u030E', '\u030F',
    '\u0310', '\u0311', '\u0312', '\u0313', '\u0314', '\u0315', '\u0316', '\u0317'
];

const DEFAULT_INTENSITY = 3;
const MAX_OUTPUT = 2000;

function zalgoize(text, intensity) {
    return text.split('').map(char => {
        if (char === ' ') return char;
        let glitched = char;
        for (let i = 0; i < intensity; i++) {
            glitched += ZALGO_CHARS[Math.floor(Math.random() * ZALGO_CHARS.length)];
        }
        return glitched;
    }).join('');
}

function errorContainer(title, body) {
    return new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> ${title}\n\n${body}`));
}

module.exports = {
    name: 'zalgo',
    prefix: 'zalgo',
    aliases: ['creepy', 'glitch'],
    description: 'Convert text to creepy Zalgo text',
    usage: 'zalgo <text>',
    category: 'utility',

    async executePrefix(message, args) {
        if (args.length === 0) {
            return message.reply({
                components: [errorContainer('Missing Text', 'Please provide text to convert!\n\n**Usage:** `zalgo <text>`\n**Example:** `zalgo Hello World`')],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const text = args.join(' ');
        try {
            const result = zalgoize(text, DEFAULT_INTENSITY);
            if (result.length > MAX_OUTPUT) {
                return message.reply({
                    components: [errorContainer('Too Long', `Result is too long! (Max ${MAX_OUTPUT} characters)`)],
                    flags: MessageFlags.IsComponentsV2
                });
            }
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 👹 Zalgo Text\n\n${result}`));
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply({ components: [errorContainer('Error', error.message)], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
