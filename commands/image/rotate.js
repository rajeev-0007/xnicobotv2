'use strict';

/**
 * rotate.js — prefix-only.
 * Rotate an image by N degrees (default 90, range -360..360).
 */

const { AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags } = require('discord.js');
const { getImageUrl, isImageApiConfigured, getUnavailableMessage } = require('../../utils/imageCommandHelper');
const { getImageApiUrl } = require('../../utils/imageApiHelper');

function isIntegerString(value) {
    return /^-?\d+$/.test(value);
}

function buildResponse(degrees, sourceType) {
    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`<:Refresh:1521227946441052420> **Rotated Image**\n-# Rotated ${sourceType} by ${degrees}°`)
        )
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://rotate.png'))
        );
}

module.exports = {
    name: 'rotate',
    prefix: 'rotate',
    aliases: ['turn'],
    description: 'Rotate an image',
    usage: 'rotate [degrees] [image|@user|url]',
    category: 'image',
    dmAllowed: true,

    async executePrefix(message, args) {
        if (!isImageApiConfigured()) return message.reply(getUnavailableMessage());

        const firstArg = args[0];
        const hasDegreesArg = !!firstArg && isIntegerString(firstArg);
        const degrees = hasDegreesArg ? parseInt(firstArg, 10) : 90;

        if (degrees < -360 || degrees > 360) {
            return message.reply('<:Cancel:1521227723916181644> Rotation degrees must be between `-360` and `360`.');
        }

        const imageArgs = hasDegreesArg ? args.slice(1) : args;
        const { url: imageUrl, source: sourceType } = await getImageUrl(message, imageArgs);

        try {
            const apiUrl = getImageApiUrl('rotate', imageUrl, { degrees });
            if (!apiUrl) return message.reply(getUnavailableMessage());

            const attachment = new AttachmentBuilder(apiUrl, { name: 'rotate.png' });
            await message.reply({
                components: [buildResponse(degrees, sourceType)],
                files: [attachment],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            console.error('[IMAGE] rotate error:', error.message);
            await message.reply('<:Cancel:1521227723916181644> Failed to rotate image.');
        }
    }
};
