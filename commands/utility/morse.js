'use strict';

/**
 * morse.js — prefix-only.
 * Encode text to / decode text from Morse code.
 */

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const MORSE_CODE = {
    'A': '.-',    'B': '-...',  'C': '-.-.', 'D': '-..',  'E': '.',    'F': '..-.',
    'G': '--.',   'H': '....',  'I': '..',   'J': '.---', 'K': '-.-',  'L': '.-..',
    'M': '--',    'N': '-.',    'O': '---',  'P': '.--.', 'Q': '--.-', 'R': '.-.',
    'S': '...',   'T': '-',     'U': '..-',  'V': '...-', 'W': '.--',  'X': '-..-',
    'Y': '-.--',  'Z': '--..',
    '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
    '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
    ' ': '/'
};

const REVERSE_MORSE = Object.fromEntries(Object.entries(MORSE_CODE).map(([k, v]) => [v, k]));
const MAX_OUTPUT = 3900;

function encode(text) {
    return text.toUpperCase().split('').map(char => MORSE_CODE[char] || char).join(' ');
}

function decode(text) {
    return text.split(' ').map(code => REVERSE_MORSE[code] || code).join('');
}

function errorContainer(title, body) {
    return new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> ${title}\n\n${body}`));
}

module.exports = {
    name: 'morse',
    prefix: 'morse',
    aliases: ['morsecode'],
    description: 'Convert text to/from Morse code',
    usage: 'morse <text> [encode|decode]',
    category: 'utility',

    async executePrefix(message, args) {
        if (args.length === 0) {
            return message.reply({
                components: [errorContainer('Missing Text', 'Please provide text to convert!\n\n**Usage:** `morse <text> [encode|decode]`\n**Example:** `morse Hello World`')],
                flags: MessageFlags.IsComponentsV2
            });
        }

        // Allow trailing `encode`/`decode` flag.
        let mode = 'encode';
        let text = args.join(' ');
        const lastArg = args[args.length - 1].toLowerCase();
        if (lastArg === 'encode' || lastArg === 'decode') {
            mode = lastArg;
            text = args.slice(0, -1).join(' ');
        }

        if (!text) {
            return message.reply({
                components: [errorContainer('Missing Text', 'Please provide text to convert!')],
                flags: MessageFlags.IsComponentsV2
            });
        }

        try {
            const result = mode === 'encode' ? encode(text) : decode(text);
            if (result.length > MAX_OUTPUT) {
                return message.reply({
                    components: [errorContainer('Too Long', `Result is too long to display! (Max ${MAX_OUTPUT} characters)`)],
                    flags: MessageFlags.IsComponentsV2
                });
            }
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# 📡 Morse Code ${mode === 'encode' ? 'Encoder' : 'Decoder'}\n\n` +
                    `**Input:**\n${text}\n\n` +
                    `**Output:**\n\`${result}\``
                ));
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply({ components: [errorContainer('Error', error.message)], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
