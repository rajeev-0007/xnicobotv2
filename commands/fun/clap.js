'use strict';

/**
 * clap.js — prefix-only.
 * Insert 👏 between every word.
 */

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

function buildClap(text) {
    const clapped = text.split(/\s+/).filter(Boolean).join(' 👏 ');
    return new ContainerBuilder()
        .setAccentColor(COLORS.FUN || 0xCAD7E6)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# 👏 Clap Text\n\n${clapped} 👏`)
        );
}

module.exports = {
    name: 'clap',
    prefix: 'clap',
    aliases: ['clapback'],
    description: 'Add 👏 between each word',
    usage: 'clap <text>',
    category: 'fun',

    async executePrefix(message, args) {
        const text = args.join(' ');
        if (!text) {
            const container = buildErrorResponse(
                'No Text Provided',
                'Please provide text to clap!',
                '**Example:** `clap hello world`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        await message.reply({ components: [buildClap(text)], flags: MessageFlags.IsComponentsV2 });
    }
};
