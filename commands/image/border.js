'use strict';

/**
 * border.js — prefix-only.
 * Adds a coloured border to an image. The first argument is treated as
 * the colour unless it looks like a user mention or URL, in which case
 * the colour falls back to "black".
 */

const { AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags } = require('discord.js');
const { getImageUrl, isImageApiConfigured, getUnavailableMessage } = require('../../utils/imageCommandHelper');
const { getImageApiUrl } = require('../../utils/imageApiHelper');

function isImageReferenceArg(arg) {
    return /^<@!?(\d+)>$/.test(arg) || /^https?:\/\//i.test(arg);
}

function isValidBorderColor(color) {
    return /^[a-zA-Z]{3,20}$/.test(color) || /^#?[0-9a-fA-F]{3,6}$/.test(color);
}

function buildResponse(color, sourceType) {
    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`<:Attach:1521228039135170722> **Border Added**\n-# Added ${color} border to ${sourceType}`)
        )
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://border.png'))
        );
}

module.exports = {
    name: 'border',
    prefix: 'border',
    aliases: ['frame'],
    description: 'Add a border to an image',
    usage: 'border [color] [image|@user|url]',
    category: 'image',
    dmAllowed: true,

    async executePrefix(message, args) {
        if (!isImageApiConfigured()) return message.reply(getUnavailableMessage());

        const firstArg = args[0];
        const hasColorArg = !!firstArg && !isImageReferenceArg(firstArg);
        const color = hasColorArg ? firstArg : 'black';

        if (!isValidBorderColor(color)) {
            return message.reply('<:Cancel:1521227723916181644> Invalid border color. Use a color name or hex code (e.g. `#ff0000`).');
        }

        const imageArgs = hasColorArg ? args.slice(1) : args;
        const { url: imageUrl, source: sourceType } = await getImageUrl(message, imageArgs);

        try {
            const apiUrl = getImageApiUrl('border', imageUrl, { color });
            if (!apiUrl) return message.reply(getUnavailableMessage());

            const attachment = new AttachmentBuilder(apiUrl, { name: 'border.png' });
            await message.reply({
                components: [buildResponse(color, sourceType)],
                files: [attachment],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            console.error('[IMAGE] border error:', error.message);
            await message.reply('<:Cancel:1521227723916181644> Failed to add border to image.');
        }
    }
};
