'use strict';

/**
 * ascii.js — prefix-only.
 * Renders short text (max 10 chars) as block-style ASCII art.
 */

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

const ASCII_GLYPHS = {
    'A': ['  A  ', ' A A ', 'AAAAA', 'A   A', 'A   A'],
    'B': ['BBBB ', 'B   B', 'BBBB ', 'B   B', 'BBBB '],
    'C': [' CCC ', 'C   C', 'C    ', 'C   C', ' CCC '],
    'D': ['DDDD ', 'D   D', 'D   D', 'D   D', 'DDDD '],
    'E': ['EEEEE', 'E    ', 'EEE  ', 'E    ', 'EEEEE'],
    'F': ['FFFFF', 'F    ', 'FFF  ', 'F    ', 'F    '],
    'G': [' GGG ', 'G    ', 'G  GG', 'G   G', ' GGG '],
    'H': ['H   H', 'H   H', 'HHHHH', 'H   H', 'H   H'],
    'I': ['IIIII', '  I  ', '  I  ', '  I  ', 'IIIII'],
    'J': ['JJJJJ', '    J', '    J', 'J   J', ' JJJ '],
    'K': ['K   K', 'K  K ', 'KKK  ', 'K  K ', 'K   K'],
    'L': ['L    ', 'L    ', 'L    ', 'L    ', 'LLLLL'],
    'M': ['M   M', 'MM MM', 'M M M', 'M   M', 'M   M'],
    'N': ['N   N', 'NN  N', 'N N N', 'N  NN', 'N   N'],
    'O': [' OOO ', 'O   O', 'O   O', 'O   O', ' OOO '],
    'P': ['PPPP ', 'P   P', 'PPPP ', 'P    ', 'P    '],
    'Q': [' QQQ ', 'Q   Q', 'Q   Q', 'Q  Q ', ' QQ Q'],
    'R': ['RRRR ', 'R   R', 'RRRR ', 'R  R ', 'R   R'],
    'S': [' SSS ', 'S    ', ' SSS ', '    S', ' SSS '],
    'T': ['TTTTT', '  T  ', '  T  ', '  T  ', '  T  '],
    'U': ['U   U', 'U   U', 'U   U', 'U   U', ' UUU '],
    'V': ['V   V', 'V   V', 'V   V', ' V V ', '  V  '],
    'W': ['W   W', 'W   W', 'W W W', 'WW WW', 'W   W'],
    'X': ['X   X', ' X X ', '  X  ', ' X X ', 'X   X'],
    'Y': ['Y   Y', ' Y Y ', '  Y  ', '  Y  ', '  Y  '],
    'Z': ['ZZZZZ', '   Z ', '  Z  ', ' Z   ', 'ZZZZZ'],
    ' ': ['     ', '     ', '     ', '     ', '     '],
    '0': [' 000 ', '0   0', '0   0', '0   0', ' 000 '],
    '1': ['  1  ', ' 11  ', '  1  ', '  1  ', '11111'],
    '2': [' 222 ', '2   2', '  22 ', ' 2   ', '22222'],
    '3': ['3333 ', '    3', ' 333 ', '    3', '3333 '],
    '4': ['4   4', '4   4', '44444', '    4', '    4'],
    '5': ['55555', '5    ', '5555 ', '    5', '5555 '],
    '6': [' 666 ', '6    ', '6666 ', '6   6', ' 666 '],
    '7': ['77777', '    7', '   7 ', '  7  ', '  7  '],
    '8': [' 888 ', '8   8', ' 888 ', '8   8', ' 888 '],
    '9': [' 999 ', '9   9', ' 9999', '    9', ' 999 ']
};

function generateAscii(text) {
    const lines = ['', '', '', '', ''];
    for (const char of text.toUpperCase()) {
        const glyph = ASCII_GLYPHS[char] || ASCII_GLYPHS[' '];
        for (let i = 0; i < 5; i++) lines[i] += glyph[i] + ' ';
    }
    return lines.join('\n');
}

function buildAscii(text) {
    const ascii = generateAscii(text);
    const content =
        `# <:Palette:1521227950601539755> ASCII Art\n\n` +
        `\`\`\`\n${ascii}\n\`\`\`\n` +
        `-# Input: ${text.toUpperCase()}`;

    return new ContainerBuilder()
        .setAccentColor(COLORS.INFO)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

module.exports = {
    name: 'ascii',
    prefix: 'ascii',
    aliases: ['asciiart', 'textart'],
    description: 'Convert text to ASCII art',
    usage: 'ascii <text>',
    category: 'fun',

    async executePrefix(message, args) {
        const text = args.join(' ').substring(0, 10);
        if (!text) {
            const container = buildErrorResponse(
                'No Text Provided',
                'Please provide text to convert (max 10 characters).',
                '**Example:** `ascii HELLO`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildAscii(text);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
