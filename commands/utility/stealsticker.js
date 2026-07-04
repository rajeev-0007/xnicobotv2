'use strict';

/**
 * stealsticker — clone stickers from sticker URLs/IDs, custom emojis,
 * attachments, image URLs, and replied messages into the current server.
 *
 * Routes every primitive through `utils/emojiSystem.js` so parsing,
 * URL building, sanitization, and error translation stay consistent
 * with the rest of the emoji system.
 */

const {
    SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder,
    TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags,
} = require('discord.js');
const {
    COLORS, BRANDING, EMOJIS: PALETTE,
    buildProgressResponse, buildPermissionDenied, buildBotPermissionError,
} = require('../../utils/responseBuilder');
const {
    EMOJI_TAG_RE_GLOBAL, STICKER_URL_RE,
    canManageExpressions, botCanManageExpressions,
    sanitizeStickerName, sanitizeEmojiName,
    emojiCdnUrl, stickerCdnUrl,
    explainStickerError,
    STICKER_FORMAT, STICKER_FORMAT_LABEL, STICKER_FORMAT_EXT, SNOWFLAKE_RE,
} = require('../../utils/emojiSystem');

const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/apng']);
const IMAGE_EXT_RE = /\.(png|apng|jpe?g|gif|webp)(?:[?#]|$)/i;
const IMAGE_URL_RE = /https?:\/\/[^\s<>"]+\.(?:png|apng|jpe?g|gif|webp)(?:\?[^\s<>"]*)?/gi;

/* ─────────────────────── Format helpers ─────────────────────── */

const UNICODE_EMOJI_RE = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})(\uFE0F|\u200D|\p{Emoji_Presentation}|\p{Extended_Pictographic})*/u;

function extractUnicodeEmoji(str) {
    if (!str) return null;
    const m = String(str).match(UNICODE_EMOJI_RE);
    return m ? m[0] : null;
}

/* ─────────────────────── Source extraction ─────────────────────── */

function parseCustomEmojisFromText(text) {
    if (!text) return [];
    const out = [];
    const seen = new Set();
    EMOJI_TAG_RE_GLOBAL.lastIndex = 0;
    let m;
    while ((m = EMOJI_TAG_RE_GLOBAL.exec(text)) !== null) {
        if (seen.has(m[3])) continue;
        seen.add(m[3]);
        const animated = m[1] === 'a';
        out.push({
            type: 'emoji',
            id: m[3],
            name: m[2],
            url: emojiCdnUrl(m[3], animated, { size: 320 }),
            format: animated ? STICKER_FORMAT.GIF : STICKER_FORMAT.PNG,
            tags: '😀',
            description: '',
        });
    }
    return out;
}

async function resolveSticker(client, input, repliedMessage) {
    const fetchFull = async (id) => {
        try { return await client.rest.get(`/stickers/${id}`); }
        catch { return null; }
    };
    const fromMessageSticker = async (sticker) => {
        const full = await fetchFull(sticker.id);
        return {
            type: 'sticker',
            id: sticker.id,
            name: full?.name || sticker.name || 'sticker',
            tags: full?.tags || '😀',
            description: full?.description || '',
            format: full?.format_type || sticker.format || STICKER_FORMAT.PNG,
        };
    };

    // 1. Replied message
    if (repliedMessage?.stickers?.size > 0) {
        return fromMessageSticker(repliedMessage.stickers.first());
    }
    if (!input || typeof input !== 'string') return null;

    // 2. Sticker URL (with or without extension)
    const urlMatch = input.match(STICKER_URL_RE);
    if (urlMatch) {
        const id = urlMatch[1];
        const ext = (urlMatch[2] || '').toLowerCase();
        const formatFromExt = { png: STICKER_FORMAT.PNG, apng: STICKER_FORMAT.APNG, json: STICKER_FORMAT.LOTTIE, gif: STICKER_FORMAT.GIF };
        const full = await fetchFull(id);
        return {
            type: 'sticker',
            id,
            name: full?.name || 'sticker',
            tags: full?.tags || '😀',
            description: full?.description || '',
            format: full?.format_type || formatFromExt[ext] || STICKER_FORMAT.PNG,
        };
    }

    // 3. Bare snowflake
    const trimmed = input.trim();
    if (SNOWFLAKE_RE.test(trimmed)) {
        const full = await fetchFull(trimmed);
        if (!full) return null;
        return {
            type: 'sticker',
            id: trimmed,
            name: full.name || 'sticker',
            tags: full.tags || '😀',
            description: full.description || '',
            format: full.format_type || STICKER_FORMAT.PNG,
        };
    }
    return null;
}

function attachmentToSource(att) {
    if (!att) return null;
    const ct = att.contentType || '';
    const passesContentType = ct && VALID_IMAGE_TYPES.has(ct);
    const passesExt = IMAGE_EXT_RE.test(att.name || att.url || '');
    if (!passesContentType && !passesExt) return null;
    const baseName = (att.name || 'sticker').replace(/\.[^.]+$/, '');
    return {
        type: 'attachment',
        name: baseName, // sanitization happens at create time
        url: att.url,
        format: ct === 'image/gif' || /\.gif(?:[?#]|$)/i.test(att.name || att.url || '')
            ? STICKER_FORMAT.GIF
            : STICKER_FORMAT.PNG,
        tags: '😀',
        description: '',
    };
}

async function collectSources(client, textInput, repliedMessage, directAttachments) {
    const sources = [];

    // 1. Native sticker (reply or text URL/ID)
    const stickerData = await resolveSticker(client, textInput, repliedMessage);
    if (stickerData && stickerData.format !== STICKER_FORMAT.LOTTIE) sources.push(stickerData);

    // 2. Custom emojis in text → emoji-as-sticker
    if (textInput) {
        for (const e of parseCustomEmojisFromText(textInput)) sources.push(e);
    }

    // 3. Custom emojis in replied message body (only if it isn't itself a sticker reply)
    if (repliedMessage?.content && !repliedMessage.stickers?.size) {
        for (const e of parseCustomEmojisFromText(repliedMessage.content)) sources.push(e);
    }

    // 4. Direct attachments
    if (directAttachments?.size || directAttachments?.values) {
        const iter = directAttachments.values?.() || [];
        for (const att of iter) {
            const src = attachmentToSource(att);
            if (src) sources.push(src);
        }
    }

    // 5. Replied message attachments
    if (repliedMessage?.attachments?.size) {
        for (const [, att] of repliedMessage.attachments) {
            const src = attachmentToSource(att);
            if (src) sources.push(src);
        }
    }

    // 6. Image URLs in text
    if (textInput) {
        IMAGE_URL_RE.lastIndex = 0;
        let m;
        while ((m = IMAGE_URL_RE.exec(textInput)) !== null) {
            if (/cdn\.discordapp\.com\/emojis\//i.test(m[0])) continue;
            if (/stickers\/\d{17,20}/i.test(m[0])) continue;
            sources.push({
                type: 'url',
                name: 'sticker',
                url: m[0],
                format: /\.(gif|apng)(?:[?#]|$)/i.test(m[0]) ? STICKER_FORMAT.GIF : STICKER_FORMAT.PNG,
                tags: '😀',
                description: '',
            });
        }
    }

    return sources;
}

/* ─────────────────────── UI ─────────────────────── */

function sourceLabel(src) {
    switch (src) {
        case 'emoji':      return '`emoji → sticker`';
        case 'attachment': return '`attachment`';
        case 'url':        return '`image URL`';
        default:           return '';
    }
}

function buildSuccessSingle(sticker, sourceType) {
    const badge = sourceLabel(sourceType);
    return new ContainerBuilder()
        .setAccentColor(COLORS.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${PALETTE.SUCCESS} Sticker Stolen\n\n` +
            `**Name:** ${sticker.name}\n` +
            `**Tag:** ${sticker.tags}\n` +
            `**Format:** ${STICKER_FORMAT_LABEL[sticker.format] || 'PNG'}` +
            (badge ? `\n**Source:** ${badge}` : '')
        ))
;
}

function buildResultMulti(ok, fail) {
    const lines = [];
    if (ok.length) {
        lines.push(`### ${PALETTE.SUCCESS} Added (${ok.length})`);
        for (const { sticker, source } of ok) {
            const badge = sourceLabel(source);
            lines.push(`> **${sticker.name}** \`${STICKER_FORMAT_LABEL[sticker.format] || 'PNG'}\` ${badge}`.trim());
        }
    }
    if (fail.length) {
        if (ok.length) lines.push('');
        lines.push(`### ${PALETTE.ERROR} Failed (${fail.length})`);
        for (const { name, reason, source } of fail) {
            const badge = sourceLabel(source);
            lines.push(`> **${name}** — ${reason} ${badge}`.trim());
        }
    }
    const accent = ok.length ? COLORS.SUCCESS : COLORS.ERROR;
    return new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${PALETTE.STICKER} Steal Sticker Results\n` +
            `-# ${ok.length} succeeded, ${fail.length} failed\n\n` +
            (lines.join('\n') || '*Nothing was processed.*')
        ))
;
}

function buildErrorContainer(title, desc) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.ERROR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${PALETTE.ERROR} ${title}\n\n${desc}`));
}

const NO_SOURCE_MESSAGE =
    `**Supported sources:**\n` +
    `${PALETTE.BULLET} Sticker URL or ID (right-click sticker → Copy Link)\n` +
    `${PALETTE.BULLET} Custom Discord emojis (emoji → sticker conversion)\n` +
    `${PALETTE.BULLET} Image attachments (PNG, GIF, JPEG, WebP)\n` +
    `${PALETTE.BULLET} Direct image URLs\n` +
    `${PALETTE.BULLET} Reply to a message containing any of the above\n\n` +
    `**Examples:**\n` +
    '`/stealsticker source:<:emoji:123456789012345678>`\n' +
    '`/stealsticker image:<upload>`\n' +
    'Reply to a sticker message with `/stealsticker`';

/* ─────────────────────── Steal core ─────────────────────── */

async function createStickerFromSource(guild, user, source, customName, customEmoji) {
    const name = sanitizeStickerName(customName || source.name, 'sticker');

    let tag = '😀';
    if (customEmoji) {
        const ex = extractUnicodeEmoji(customEmoji);
        if (ex) tag = ex;
    } else if (source.tags) {
        const ex = extractUnicodeEmoji(source.tags);
        if (ex) tag = ex;
    }

    let fileUrl;
    if (source.type === 'sticker') {
        fileUrl = stickerCdnUrl(source.id, source.format);
    } else if (source.type === 'emoji') {
        fileUrl = source.url;
    } else {
        fileUrl = source.url;
    }

    return guild.stickers.create({
        file: fileUrl,
        name,
        tags: tag,
        description: (source.description || '').slice(0, 100) || undefined,
        reason: `Stolen by ${user.username} (source: ${source.type})`,
    });
}

/* ─────────────────────── Module ─────────────────────── */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stealsticker')
        .setDescription('Steal stickers from stickers, emojis, attachments, or image URLs')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
        .addStringOption(o => o
            .setName('source')
            .setDescription('Sticker URL/ID, emoji, or image URL to add as sticker')
            .setRequired(false))
        .addAttachmentOption(o => o
            .setName('image')
            .setDescription('Upload an image to add as sticker (PNG/GIF/JPEG/WebP)')
            .setRequired(false))
        .addStringOption(o => o
            .setName('name')
            .setDescription('Custom name for the sticker (2-30 characters)')
            .setRequired(false))
        .addStringOption(o => o
            .setName('emoji')
            .setDescription('Unicode emoji tag for the sticker (defaults to 😀)')
            .setRequired(false)),

    prefix: 'stealsticker',
    description: 'Steal stickers from stickers, emojis, attachments, or image URLs',
    usage: 'stealsticker <sticker-url/emoji/image> [name] — or reply to a message',
    category: 'utility',
    aliases: ['ss', 'stickerclone', 'stickersteal'],
    permissions: ['ManageGuildExpressions'],

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                components: [buildErrorContainer('Server Required', 'This command can only be used in a server.')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }
        if (!canManageExpressions(interaction.member)) {
            return interaction.reply({
                components: [buildPermissionDenied('Manage Expressions')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }
        if (!botCanManageExpressions(interaction.guild)) {
            return interaction.reply({
                components: [buildBotPermissionError('Manage Expressions')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        const sourceInput = interaction.options.getString('source');
        const attachment = interaction.options.getAttachment('image');
        const customName = interaction.options.getString('name');
        const emojiInput = interaction.options.getString('emoji');

        // Slash interactions don't carry the surrounding chat reply
        // context, so we don't try to fetch a "replied" message here.
        const attachments = new Map();
        if (attachment) attachments.set(attachment.id, attachment);

        const sources = await collectSources(interaction.client, sourceInput, null, attachments);

        if (!sources.length) {
            return interaction.reply({
                components: [buildErrorContainer('No Source Provided', NO_SOURCE_MESSAGE)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply();

        if (sources.length === 1) {
            const source = sources[0];
            if (source.format === STICKER_FORMAT.LOTTIE) {
                return interaction.editReply({
                    components: [buildErrorContainer('Unsupported Format',
                        'Lottie stickers (animated vector) cannot be cloned. Only PNG, APNG, and GIF are supported.')],
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => null);
            }
            try {
                const sticker = await createStickerFromSource(interaction.guild, interaction.user, source, customName, emojiInput);
                return interaction.editReply({
                    components: [buildSuccessSingle(sticker, source.type)],
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => null);
            } catch (err) {
                return interaction.editReply({
                    components: [buildErrorContainer('Failed to Steal Sticker', explainStickerError(err))],
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => null);
            }
        }

        await interaction.editReply({
            components: [buildProgressResponse('Steal Sticker In Progress', 0, sources.length, 'Adding stickers to this server...')],
            flags: MessageFlags.IsComponentsV2,
        });

        const ok = [];
        const fail = [];
        for (let i = 0; i < sources.length; i++) {
            const source = sources[i];
            if (source.format === STICKER_FORMAT.LOTTIE) {
                fail.push({ name: source.name || 'sticker', reason: 'Lottie format unsupported', source: source.type });
            } else {
                try {
                    const sticker = await createStickerFromSource(interaction.guild, interaction.user, source, null, emojiInput);
                    ok.push({ sticker, source: source.type });
                } catch (err) {
                    fail.push({ name: source.name || 'sticker', reason: explainStickerError(err), source: source.type });
                }
            }
            await interaction.editReply({
                components: [buildProgressResponse('Steal Sticker In Progress', i + 1, sources.length, 'Adding stickers to this server...', source.name || 'sticker')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => null);
        }

        await interaction.editReply({ components: [buildResultMulti(ok, fail)], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
    },

    async executePrefix(message, args) {
        if (!message.guild) {
            return message.reply({
                components: [buildErrorContainer('Server Required', 'This command can only be used in a server.')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }
        if (!canManageExpressions(message.member)) {
            return message.reply({
                components: [buildPermissionDenied('Manage Expressions')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }
        if (!botCanManageExpressions(message.guild)) {
            return message.reply({
                components: [buildBotPermissionError('Manage Expressions')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }

        let repliedMessage = null;
        if (message.reference?.messageId) {
            repliedMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
        }

        const textInput = args.join(' ') || null;
        const sources = await collectSources(message.client, textInput, repliedMessage, message.attachments);

        if (!sources.length) {
            return message.reply({
                components: [buildErrorContainer('No Source Provided', NO_SOURCE_MESSAGE)],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }

        // Custom name from tail arg, only if exactly one source.
        let customName = null;
        if (sources.length === 1 && args.length > 0) {
            const lastArg = args[args.length - 1];
            EMOJI_TAG_RE_GLOBAL.lastIndex = 0;
            const looksLikeToken = EMOJI_TAG_RE_GLOBAL.test(lastArg)
                || /^https?:\/\//i.test(lastArg)
                || SNOWFLAKE_RE.test(lastArg);
            if (!looksLikeToken) customName = lastArg;
        }

        const processing = await message.reply({
            components: [buildProgressResponse('Steal Sticker In Progress', 0, sources.length, 'Adding stickers to this server...')],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => null);
        if (!processing) return;

        if (sources.length === 1) {
            const source = sources[0];
            if (source.format === STICKER_FORMAT.LOTTIE) {
                return processing.edit({
                    components: [buildErrorContainer('Unsupported Format', 'Lottie stickers cannot be cloned.')],
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => {});
            }
            try {
                const sticker = await createStickerFromSource(message.guild, message.author, source, customName, null);
                return processing.edit({
                    components: [buildSuccessSingle(sticker, source.type)],
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => {});
            } catch (err) {
                return processing.edit({
                    components: [buildErrorContainer('Failed to Steal Sticker', explainStickerError(err))],
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => {});
            }
        }

        const ok = [];
        const fail = [];
        for (let i = 0; i < sources.length; i++) {
            const source = sources[i];
            if (source.format === STICKER_FORMAT.LOTTIE) {
                fail.push({ name: source.name || 'sticker', reason: 'Lottie format unsupported', source: source.type });
            } else {
                try {
                    const sticker = await createStickerFromSource(message.guild, message.author, source, null, null);
                    ok.push({ sticker, source: source.type });
                } catch (err) {
                    fail.push({ name: source.name || 'sticker', reason: explainStickerError(err), source: source.type });
                }
            }
            await processing.edit({
                components: [buildProgressResponse('Steal Sticker In Progress', i + 1, sources.length, 'Adding stickers to this server...', source.name || 'sticker')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => null);
        }

        await processing.edit({ components: [buildResultMulti(ok, fail)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    },
};
