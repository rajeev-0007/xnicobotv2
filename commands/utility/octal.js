'use strict';

/**
 * octal.js — prefix-only.
 * Encode text to / decode text from octal (base 8).
 */

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const MAX_OUTPUT = 3900;

function encode(text) {
    return text.split('').map(c => c.charCodeAt(0).toString(8).padStart(3, '0')).join(' ');
}

function decode(text) {
    const codes = text.replace(/[^0-7\s]/g, '').split(/\s+/).filter(Boolean);
    return codes.map(o => {
        const dec = parseInt(o, 8);
        return Number.isFinite(dec) ? String.fromCharCode(dec) : '';
    }).join('');
}

function errorContainer(title, body) {
    return new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> ${title}\n\n${body}`));
}

module.exports = {
    name: 'octal',
    prefix: 'octal',
    aliases: ['oct'],
    description: 'Convert text to/from octal (base 8)',
    usage: 'octal <text> [encode|decode]',
    category: 'utility',

    async executePrefix(message, args) {
        if (args.length === 0) {
            return message.reply({
                components: [errorContainer('Missing Text', 'Please provide text to convert!\n\n**Usage:** `octal <text> [encode|decode]`\n**Example:** `octal Hello World`')],
                flags: MessageFlags.IsComponentsV2
            });
        }

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

            if (mode === 'decode' && !result) {
                return message.reply({
                    components: [errorContainer('Invalid Format', 'Invalid octal format! Use space-separated octal codes (digits 0-7).')],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            if (result.length > MAX_OUTPUT) {
                return message.reply({
                    components: [errorContainer('Too Long', `Result is too long to display! (Max ${MAX_OUTPUT} characters)`)],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            const truncate = (s, n = 200) => s.length > n ? s.substring(0, n) + '...' : s;

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# 🔢 Octal ${mode === 'encode' ? 'Encoder' : 'Decoder'}\n\n` +
                    `**Input:**\n${truncate(text)}\n\n` +
                    `**Output:**\n\`${truncate(result)}\``
                ));
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply({ components: [errorContainer('Error', error.message)], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
