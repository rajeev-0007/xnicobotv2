'use strict';

/**
 * imagine.js — prefix-only.
 * Generate an AI image from a prompt with optional --style/--size/
 * --negative/--model flags.
 */

const { AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse } = require('../../utils/responseBuilder');
const { isImageApiConfigured, getUnavailableMessage } = require('../../utils/imageCommandHelper');
const { buildImageApiRequestUrl } = require('../../utils/imageApiHelper');
const log = require('../../utils/logger-styled');

const DEFAULT_SIZE = 'square';
const VALID_SIZES = new Set(['square', 'portrait', 'landscape']);

function truncate(text, maxLength = 220) {
    const value = String(text || '').trim();
    if (value.length <= maxLength) return value;
    return `${value.slice(0, maxLength - 3)}...`;
}

function parsePrefixArgs(args) {
    const result = { prompt: '', negative: '', style: '', size: DEFAULT_SIZE, model: '' };
    const promptParts = [];

    for (const arg of args) {
        if (arg.startsWith('--negative=')) { result.negative = arg.slice('--negative='.length).trim(); continue; }
        if (arg.startsWith('--style='))    { result.style    = arg.slice('--style='.length).trim();    continue; }
        if (arg.startsWith('--size='))     { result.size     = arg.slice('--size='.length).trim().toLowerCase() || DEFAULT_SIZE; continue; }
        if (arg.startsWith('--model='))    { result.model    = arg.slice('--model='.length).trim();    continue; }
        promptParts.push(arg);
    }

    result.prompt = promptParts.join(' ').trim();
    if (!VALID_SIZES.has(result.size)) result.size = DEFAULT_SIZE;
    return result;
}

function buildImagineContainer(opts) {
    const lines = [
        '# <:Image:1521227966435037255> AI Image Generated',
        '',
        `**Prompt:** ${truncate(opts.prompt)}`,
        `**Size:** ${opts.size}`
    ];
    if (opts.style)    lines.push(`**Style:** ${truncate(opts.style, 120)}`);
    if (opts.negative) lines.push(`**Negative Prompt:** ${truncate(opts.negative, 120)}`);
    if (opts.model)    lines.push(`**Model:** ${truncate(opts.model, 80)}`);

    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')))
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://imagine.png'))
        );
}

module.exports = {
    name: 'imagine',
    prefix: 'imagine',
    aliases: ['imggen', 'aiimage', 'generateimage'],
    description: 'Generate an AI image from a prompt',
    usage: 'imagine <prompt> [--style=cinematic] [--size=square] [--negative=blurry] [--model=name]',
    category: 'image',

    async executePrefix(message, args) {
        if (!isImageApiConfigured()) return message.reply(getUnavailableMessage());

        const parsed = parsePrefixArgs(args);

        if (!parsed.prompt) {
            const container = buildErrorResponse(
                'Missing Prompt',
                'Please provide a prompt for the image you want to generate.',
                '**Example:** `imagine futuristic cyberpunk city at sunset --style=cinematic --size=landscape`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const apiUrl = buildImageApiRequestUrl('imagine', {
                prompt: parsed.prompt, negative: parsed.negative,
                style: parsed.style, size: parsed.size, model: parsed.model
            });
            if (!apiUrl) return message.reply(getUnavailableMessage());

            const attachment = new AttachmentBuilder(apiUrl, { name: 'imagine.png' });
            await message.reply({
                components: [buildImagineContainer(parsed)],
                files: [attachment],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            log.error('[IMAGE] imagine error:', error.message);
            await message.reply('<:Cancel:1521227723916181644> Failed to generate the image. Check your image API configuration and try again.');
        }
    }
};
