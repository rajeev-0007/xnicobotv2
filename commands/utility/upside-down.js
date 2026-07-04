'use strict';

/**
 * upside-down.js — prefix-only.
 * Render text upside down using Unicode lookalikes and reversal.
 */

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const FLIPPED = {
    'a': 'ɐ', 'b': 'q', 'c': 'ɔ', 'd': 'p', 'e': 'ǝ', 'f': 'ɟ', 'g': 'ƃ', 'h': 'ɥ', 'i': 'ᴉ', 'j': 'ɾ',
    'k': 'ʞ', 'l': 'l', 'm': 'ɯ', 'n': 'u', 'o': 'o', 'p': 'd', 'q': 'b', 'r': 'ɹ', 's': 's', 't': 'ʇ',
    'u': 'n', 'v': 'ʌ', 'w': 'ʍ', 'x': 'x', 'y': 'ʎ', 'z': 'z',
    'A': '∀', 'B': 'q', 'C': 'Ɔ', 'D': 'p', 'E': 'Ǝ', 'F': 'Ⅎ', 'G': 'פ', 'H': 'H', 'I': 'I', 'J': 'ſ',
    'K': 'ʞ', 'L': '˥', 'M': 'W', 'N': 'N', 'O': 'O', 'P': 'Ԁ', 'Q': 'Ό', 'R': 'ᴚ', 'S': 'S', 'T': '┴',
    'U': '∩', 'V': 'Λ', 'W': 'M', 'X': 'X', 'Y': '⅄', 'Z': 'Z',
    '0': '0', '1': 'Ɩ', '2': 'ᄅ', '3': 'Ɛ', '4': 'ㄣ', '5': 'ϛ', '6': '9', '7': 'ㄥ', '8': '8', '9': '6',
    '.': '˙', ',': '\'', '!': '¡', '?': '¿', '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{',
    '<': '>', '>': '<', '&': '⅋', '_': '‾', ';': '؛', '"': '„', '\'': ','
};

const MAX_OUTPUT = 2000;

function flipText(text) {
    return text.split('').map(c => FLIPPED[c] || c).reverse().join('');
}

function errorContainer(title, body) {
    return new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> ${title}\n\n${body}`));
}

module.exports = {
    name: 'upside-down',
    prefix: 'upside-down',
    aliases: ['upsidedown', 'fliptext'],
    description: 'Flip text upside down',
    usage: 'upside-down <text>',
    category: 'utility',

    async executePrefix(message, args) {
        if (args.length === 0) {
            return message.reply({
                components: [errorContainer('Missing Text', 'Please provide text to flip!\n\n**Usage:** `upside-down <text>`\n**Example:** `upside-down Hello World`')],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const text = args.join(' ');
        try {
            const result = flipText(text);
            if (result.length > MAX_OUTPUT) {
                return message.reply({
                    components: [errorContainer('Too Long', `Result is too long! (Max ${MAX_OUTPUT} characters)`)],
                    flags: MessageFlags.IsComponentsV2
                });
            }
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# 🙃 Upside Down Text\n\n**Original:**\n${text}\n\n**Flipped:**\n${result}`
                ));
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply({ components: [errorContainer('Error', error.message)], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
