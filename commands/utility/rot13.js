'use strict';

/**
 * rot13.js — prefix-only.
 * Encode/decode text with the ROT13 cipher (its own inverse).
 */

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const MAX_OUTPUT = 3900;

function rot13(input) {
    return input.replace(/[a-zA-Z]/g, char => {
        const start = char <= 'Z' ? 65 : 97;
        return String.fromCharCode(start + (char.charCodeAt(0) - start + 13) % 26);
    });
}

function errorContainer(title, body) {
    return new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> ${title}\n\n${body}`));
}

module.exports = {
    name: 'rot13',
    prefix: 'rot13',
    aliases: ['rotate13'],
    description: 'Encode/decode text using ROT13 cipher',
    usage: 'rot13 <text>',
    category: 'utility',

    async executePrefix(message, args) {
        if (args.length === 0) {
            return message.reply({
                components: [errorContainer('Missing Text', 'Please provide text to encode/decode!\n\n**Usage:** `rot13 <text>`\n**Example:** `rot13 Hello World`')],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const text = args.join(' ');
        try {
            const result = rot13(text);
            if (result.length > MAX_OUTPUT) {
                return message.reply({
                    components: [errorContainer('Too Long', `Result is too long to display! (Max ${MAX_OUTPUT} characters)`)],
                    flags: MessageFlags.IsComponentsV2
                });
            }
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:History:1521227863079256278> ROT13 Cipher\n\n` +
                    `**Input:**\n${text}\n\n` +
                    `**Output:**\n${result}\n\n` +
                    `-# ROT13 is its own inverse — run again to decode!`
                ));
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply({ components: [errorContainer('Error', error.message)], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
