'use strict';

/**
 * emoji-info — show metadata for a custom server emoji.
 * Accepts a custom emoji tag, an emoji name (with or without `:colons:`),
 * or a raw snowflake ID.
 */

const {
    ContainerBuilder, TextDisplayBuilder,
    MediaGalleryBuilder, MediaGalleryItemBuilder,
    SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS, EMOJIS: PALETTE } = require('../../utils/responseBuilder');
const { parseEmojiInput, emojiCdnUrl, emojiUsability } = require('../../utils/emojiSystem');

function findEmoji(guild, input) {
    if (!guild || !input) return null;
    const parsed = parseEmojiInput(input);
    if (parsed?.id) {
        const cached = guild.emojis.cache.get(parsed.id);
        if (cached) return cached;
    }
    const name = String(input).replace(/^:|:$/g, '').trim();
    if (!name) return null;
    return guild.emojis.cache.find(e => e.name.toLowerCase() === name.toLowerCase()) || null;
}

function buildEmojiInfoContainer(emoji) {
    const usability = emojiUsability(emoji);
    const stateBadge = !usability.available
        ? `${PALETTE.WARNING} \`unavailable\``
        : usability.restricted
            ? `${PALETTE.LOCK} \`role-locked\``
            : `${PALETTE.SUCCESS} \`usable\``;
    const previewUrl = emoji.imageURL?.({ size: 256 }) || emojiCdnUrl(emoji.id, !!emoji.animated, { size: 256 });

    return new ContainerBuilder()
        .setAccentColor(COLORS.INFO)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${emoji} Emoji Information`))
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(previewUrl)),
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**Name:** \`${emoji.name}\`\n` +
            `**ID:** \`${emoji.id}\`\n` +
            `**Animated:** ${emoji.animated ? 'Yes' : 'No'}\n` +
            `**State:** ${stateBadge}` +
            (usability.restricted ? `\n**Roles:** \`${usability.roleIds.length}\` restriction${usability.roleIds.length === 1 ? '' : 's'}` : '') +
            `\n**Created:** <t:${Math.floor(emoji.createdTimestamp / 1000)}:R>\n` +
            `**Tag:** \`<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>\`\n` +
            `**URL:** ${previewUrl}`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

module.exports = {
    name: 'emoji-info',
    prefix: 'emoji-info',
    aliases: ['emojiinfo', 'emoji-url', 'emojiurl'],
    description: 'Get information about a server emoji',
    usage: 'emoji-info <emoji|name|id>',
    category: 'basic',

    async executePrefix(message, args) {
        try {
            if (!args.length) {
                const err = buildErrorResponse('Missing Argument', 'Provide an emoji name, ID, or custom emoji tag.\n\n**Usage:** `emoji-info <emoji>`');
                return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
            if (!message.guild) {
                const err = buildErrorResponse('Server Required', 'This command must be used in a server.');
                return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
            const input = args.join(' ');
            const emoji = findEmoji(message.guild, input);
            if (!emoji) {
                const err = buildErrorResponse('Emoji Not Found', `Could not find emoji \`${input}\` in this server.`);
                return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
            const container = buildEmojiInfoContainer(emoji);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[emoji-info]', error);
            const err = buildErrorResponse('Unexpected Error', 'Something went wrong loading emoji info.');
            await message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    } };
