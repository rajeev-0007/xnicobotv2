'use strict';

/**
 * emojify — convert ASCII text to regional-indicator (and digit
 * keycap) emojis. Pure Unicode output so the result renders the same
 * for everyone, including users without access to the bot's custom
 * emoji palette.
 */

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS, EMOJIS: PALETTE } = require('../../utils/responseBuilder');

const EMOJI_MAP = {
    a: '🇦', b: '🇧', c: '🇨', d: '🇩', e: '🇪', f: '🇫', g: '🇬', h: '🇭',
    i: '🇮', j: '🇯', k: '🇰', l: '🇱', m: '🇲', n: '🇳', o: '🇴', p: '🇵',
    q: '🇶', r: '🇷', s: '🇸', t: '🇹', u: '🇺', v: '🇻', w: '🇼', x: '🇽',
    y: '🇾', z: '🇿',
    0: '0\uFE0F\u20E3', 1: '1\uFE0F\u20E3', 2: '2\uFE0F\u20E3', 3: '3\uFE0F\u20E3',
    4: '4\uFE0F\u20E3', 5: '5\uFE0F\u20E3', 6: '6\uFE0F\u20E3', 7: '7\uFE0F\u20E3',
    8: '8\uFE0F\u20E3', 9: '9\uFE0F\u20E3',
    '!': '❗',
    '?': '❓',
    '#': '#\uFE0F\u20E3',
    '*': '*\uFE0F\u20E3',
    ' ': '   ' };

const MAX_OUTPUT_CHARS = 1800;

module.exports = {
    prefix: 'emojify',
    description: 'Convert text to regional indicator emojis',
    usage: 'emojify <text>',
    category: 'utility',
    aliases: ['emoji-text'],

    async executePrefix(message, args) {
        if (args.length === 0) {
            const c = buildErrorResponse(
                'No Text Provided',
                'Provide text to emojify.',
                '**Example:** `emojify hello`',
            );
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        const text = args.join(' ');
        const result = text.toLowerCase().split('').map(ch => EMOJI_MAP[ch] || ch).join('');

        if (result.length > MAX_OUTPUT_CHARS) {
            const c = buildErrorResponse('Too Long', `Result is too long to display (max ${MAX_OUTPUT_CHARS} characters).`);
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        const container = new ContainerBuilder()
            .setAccentColor(COLORS.INFO)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ${PALETTE.PALETTE} Emojify\n\n${result}`
            ));

        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    } };
