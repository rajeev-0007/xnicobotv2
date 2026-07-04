'use strict';

/**
 * extract-emoji — pull every custom Discord emoji tag out of an
 * arbitrary message and list them with their CDN download URLs so
 * users can grab them externally.
 */

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS, EMOJIS: PALETTE } = require('../../utils/responseBuilder');
const { EMOJI_TAG_RE_GLOBAL, emojiCdnUrl } = require('../../utils/emojiSystem');

module.exports = {
    prefix: 'extract-emoji',
    description: 'Extract all custom emojis from text',
    usage: 'extract-emoji <text>',
    category: 'utility',
    aliases: ['getemoji', 'extractemoji'],

    async executePrefix(message, args) {
        if (!args.length) {
            const c = buildErrorResponse(
                'No Text Provided',
                'Provide text to extract emojis from.',
                '**Example:** `extract-emoji Hello <:Userplus:1521227719621218477>`',
            );
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        const text = args.join(' ');
        EMOJI_TAG_RE_GLOBAL.lastIndex = 0;

        const seen = new Set();
        const found = [];
        let m;
        while ((m = EMOJI_TAG_RE_GLOBAL.exec(text)) !== null) {
            if (seen.has(m[3])) continue;
            seen.add(m[3]);
            found.push({ tag: m[0], name: m[2], id: m[3], animated: m[1] === 'a' });
        }

        if (!found.length) {
            const c = buildErrorResponse('No Emojis Found', 'No custom Discord emojis were found in that text.');
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        const list = found.map((e, i) => {
            const url = emojiCdnUrl(e.id, e.animated);
            const idx = String(i + 1).padStart(2, '0');
            return `\`${idx}.\` ${e.tag} \`:${e.name}:\` — [download](${url})`;
        }).join('\n');

        const container = new ContainerBuilder()
            .setAccentColor(COLORS.INFO)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ${PALETTE.SEARCH} Extracted Emojis\n` +
                `-# Found **${found.length}** unique emoji${found.length === 1 ? '' : 's'}\n\n` +
                list
            ));

        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    } };
