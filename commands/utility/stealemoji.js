'use strict';

/**
 * stealemoji — clone emojis from custom emoji tags, sticker URLs,
 * image URLs, attachments, and replied messages into the current server.
 *
 * Routes every primitive through `utils/emojiSystem.js` so parsing,
 * URL building, sanitization, and error translation match the rest of
 * the emoji system exactly.
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
    EMOJI_TAG_RE_GLOBAL, STICKER_URL_RE_GLOBAL,
    canManageExpressions, botCanManageExpressions,
    sanitizeEmojiName, emojiCdnUrl, stickerCdnUrl,
    explainEmojiError, STICKER_FORMAT, STICKER_FORMAT_EXT,
} = require('../../utils/emojiSystem');

const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/apng']);
const IMAGE_EXT_RE = /\.(png|apng|jpe?g|gif|webp)(?:\?[^\s<>"]*)?(?:#.*)?$/i;
const IMAGE_URL_RE = /https?:\/\/[^\s<>"]+\.(?:png|apng|jpe?g|gif|webp)(?:\?[^\s<>"]*)?/gi;

/* ─────────────────────── Source extraction ─────────────────────── */

/**
 * Pull every custom emoji tag out of a free-form string and turn it into
 * a normalized source descriptor.
 */
function parseEmojisFromText(text) {
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
            source: 'emoji',
            id: m[3],
            name: m[2],
            animated,
            url: emojiCdnUrl(m[3], animated),
        });
    }
    return out;
}

function parseStickerLinksFromText(text) {
    if (!text) return [];
    const out = [];
    const seen = new Set();
    STICKER_URL_RE_GLOBAL.lastIndex = 0;
    let m;
    while ((m = STICKER_URL_RE_GLOBAL.exec(text)) !== null) {
        const id = m[1];
        if (seen.has(id)) continue;
        seen.add(id);
        const ext = (m[2] || 'png').toLowerCase();
        if (ext === 'json') continue; // skip Lottie
        const format = ext === 'gif' ? STICKER_FORMAT.GIF
            : ext === 'apng' ? STICKER_FORMAT.APNG
            : STICKER_FORMAT.PNG;
        out.push({
            source: 'sticker',
            id,
            name: 'sticker',
            animated: ext === 'gif' || ext === 'apng',
            url: stickerCdnUrl(id, format),
        });
    }
    return out;
}

function parseImageUrlsFromText(text) {
    if (!text) return [];
    const out = [];
    IMAGE_URL_RE.lastIndex = 0;
    let m;
    while ((m = IMAGE_URL_RE.exec(text)) !== null) {
        // skip emoji and sticker CDN URLs (handled by their own parsers)
        if (/cdn\.discordapp\.com\/emojis\//i.test(m[0])) continue;
        if (/stickers\/\d{17,20}/i.test(m[0])) continue;
        out.push({
            source: 'url',
            id: null,
            name: 'image',
            animated: /\.(gif|apng)(?:[?#]|$)/i.test(m[0]),
            url: m[0],
        });
    }
    return out;
}

function attachmentToSource(att) {
    if (!att) return null;
    const ct = att.contentType || '';
    const passesContentType = ct && VALID_IMAGE_TYPES.has(ct);
    const passesExt = IMAGE_EXT_RE.test(att.name || att.url || '');
    if (!passesContentType && !passesExt) return null;
    const baseName = (att.name || 'emoji').replace(/\.[^.]+$/, '');
    return {
        source: 'attachment',
        id: null,
        name: baseName,
        animated: ct === 'image/gif' || /\.gif(?:[?#]|$)/i.test(att.name || att.url || ''),
        url: att.url,
    };
}

function extractStickersFromMessage(msg) {
    const out = [];
    if (!msg?.stickers?.size) return out;
    for (const [, sticker] of msg.stickers) {
        if (sticker.format === STICKER_FORMAT.LOTTIE) continue;
        const ext = STICKER_FORMAT_EXT[sticker.format] || 'png';
        out.push({
            source: 'sticker',
            id: sticker.id,
            name: sticker.name,
            animated: ext === 'gif',
            url: stickerCdnUrl(sticker.id, sticker.format),
        });
    }
    return out;
}

/**
 * Collect every stealable source from an arbitrary combination of text
 * input, replied message, and direct attachments. Deduped by snowflake.
 */
async function collectSources(textInput, repliedMessage, directAttachments) {
    const sources = [];
    const seenIds = new Set();
    const push = (src) => {
        if (!src) return;
        if (src.id && seenIds.has(src.id)) return;
        if (src.id) seenIds.add(src.id);
        sources.push(src);
    };

    if (textInput) {
        for (const e of parseEmojisFromText(textInput)) push(e);
        for (const s of parseStickerLinksFromText(textInput)) push(s);
        for (const u of parseImageUrlsFromText(textInput)) push(u);
    }

    if (directAttachments?.size || directAttachments?.values) {
        const iter = directAttachments.values?.() || [];
        for (const att of iter) push(attachmentToSource(att));
    }

    if (repliedMessage) {
        if (repliedMessage.content) {
            for (const e of parseEmojisFromText(repliedMessage.content)) push(e);
        }
        for (const s of extractStickersFromMessage(repliedMessage)) push(s);
        if (repliedMessage.attachments?.size) {
            for (const [, att] of repliedMessage.attachments) push(attachmentToSource(att));
        }
    }

    return sources;
}

/* ─────────────────────── UI ─────────────────────── */

function sourceLabel(src) {
    switch (src) {
        case 'sticker':    return '`sticker → emoji`';
        case 'attachment': return '`attachment`';
        case 'url':        return '`image URL`';
        default:           return '';
    }
}

function buildResultContainer(ok, fail) {
    const lines = [];
    if (ok.length) {
        lines.push(`### ${PALETTE.SUCCESS} Added (${ok.length})`);
        for (const { emoji, original } of ok) {
            const badge = sourceLabel(original.source);
            const animTag = emoji.animated ? ` *(animated)*` : '';
            lines.push(`> ${emoji} \`:${emoji.name}:\`${animTag} ${badge}`.trim());
        }
    }
    if (fail.length) {
        if (ok.length) lines.push('');
        lines.push(`### ${PALETTE.ERROR} Failed (${fail.length})`);
        for (const { original, reason } of fail) {
            const badge = sourceLabel(original.source);
            lines.push(`> \`:${original.name}:\` — ${reason} ${badge}`.trim());
        }
    }
    const accent = ok.length ? COLORS.SUCCESS : COLORS.ERROR;
    return new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${PALETTE.BRAND} Steal Emoji Results\n` +
            `-# ${ok.length} succeeded, ${fail.length} failed\n\n` +
            (lines.join('\n') || '*Nothing was processed.*')
        ))
;
}

function buildErrorContainer(desc) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.ERROR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${PALETTE.ERROR} Steal Emoji\n\n${desc}`
        ));
}

const NO_SOURCE_MESSAGE =
    'No valid sources found.\n\n' +
    `**Supported sources:**\n` +
    `${PALETTE.BULLET} Custom Discord emojis\n` +
    `${PALETTE.BULLET} Stickers (reply to a sticker message or paste a sticker URL)\n` +
    `${PALETTE.BULLET} Image attachments (PNG, GIF, JPEG, WebP)\n` +
    `${PALETTE.BULLET} Direct image URLs\n\n` +
    `**Examples:**\n` +
    '`/stealemoji emojis:<:name:123456789012345678>`\n' +
    '`/stealemoji image:<upload>`\n' +
    'Reply to a message containing a sticker with `/stealemoji`';

/* ─────────────────────── Steal core ─────────────────────── */

async function stealEmojis(guild, user, sources, onProgress) {
    const ok = [];
    const fail = [];
    let processed = 0;

    if (typeof onProgress === 'function') {
        await onProgress({ current: 0, total: sources.length, emoji: null });
    }

    for (const e of sources) {
        try {
            const created = await guild.emojis.create({
                attachment: e.url,
                name: sanitizeEmojiName(e.name, 'stolen_emoji'),
                reason: `Stolen by ${user.username} (source: ${e.source})`,
            });
            ok.push({ emoji: created, original: e });
        } catch (err) {
            fail.push({ original: e, reason: explainEmojiError(err) });
        }
        processed++;
        if (typeof onProgress === 'function') {
            await onProgress({ current: processed, total: sources.length, emoji: e });
        }
    }
    return { ok, fail };
}

/* ─────────────────────── Module ─────────────────────── */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stealemoji')
        .setDescription('Steal emojis from emojis, stickers, attachments, or image URLs')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
        .addStringOption(o => o
            .setName('emojis')
            .setDescription('Emojis, sticker URLs, or image URLs to add as emoji')
            .setRequired(false))
        .addAttachmentOption(o => o
            .setName('image')
            .setDescription('Upload an image to add as emoji (PNG/GIF/JPEG/WebP)')
            .setRequired(false))
        .addStringOption(o => o
            .setName('name')
            .setDescription('Custom name (only when stealing a single source)')
            .setRequired(false)),

    prefix: 'stealemoji',
    description: 'Steal emojis from emojis, stickers, attachments, or image URLs',
    usage: 'stealemoji <emojis/sticker-url/image-url> [name] — or reply to a message',
    category: 'utility',
    aliases: ['se', 'emojiclone', 'emojisteal'],
    permissions: ['ManageGuildExpressions'],

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                components: [buildErrorContainer('This command can only be used in a server.')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        // setDefaultMemberPermissions can be overridden by server admins,
        // so we still need an in-handler check to enforce intent.
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

        const emojiInput = interaction.options.getString('emojis');
        const attachment = interaction.options.getAttachment('image');
        const customName = interaction.options.getString('name');

        // NOTE: `interaction.message?.reference` is null for ApplicationCommand
        // interactions — Discord doesn't surface the surrounding chat context.
        // We intentionally don't try to fetch a "replied" message here; that
        // path only exists for prefix invocations.
        const attachments = new Map();
        if (attachment) attachments.set(attachment.id, attachment);

        const sources = await collectSources(emojiInput, null, attachments);

        if (!sources.length) {
            return interaction.reply({
                components: [buildErrorContainer(NO_SOURCE_MESSAGE)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        if (sources.length === 1 && customName) {
            sources[0].name = customName; // sanitization happens in `stealEmojis`
        }

        await interaction.deferReply();
        await interaction.editReply({
            components: [buildProgressResponse('Steal Emoji In Progress', 0, sources.length, 'Adding emojis to this server...')],
            flags: MessageFlags.IsComponentsV2,
        });

        const { ok, fail } = await stealEmojis(interaction.guild, interaction.user, sources, async ({ current, total, emoji }) => {
            await interaction.editReply({
                components: [buildProgressResponse(
                    'Steal Emoji In Progress',
                    current, total,
                    'Adding emojis to this server...',
                    emoji?.name ? `:${emoji.name}:` : null,
                )],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => null);
        });

        await interaction.editReply({ components: [buildResultContainer(ok, fail)], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
    },

    async executePrefix(message, args) {
        if (!message.guild) {
            return message.reply({
                components: [buildErrorContainer('This command can only be used in a server.')],
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
        const sources = await collectSources(textInput, repliedMessage, message.attachments);

        if (!sources.length) {
            return message.reply({
                components: [buildErrorContainer(NO_SOURCE_MESSAGE)],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }

        // If exactly one source AND the last arg is a plain word (not a tag/url),
        // treat it as the custom name.
        if (sources.length === 1 && args.length > 0) {
            const lastArg = args[args.length - 1];
            const looksLikeToken = EMOJI_TAG_RE_GLOBAL.test(lastArg) || /^https?:\/\//i.test(lastArg);
            EMOJI_TAG_RE_GLOBAL.lastIndex = 0;
            if (!looksLikeToken) sources[0].name = lastArg;
        }

        const progressMessage = await message.reply({
            components: [buildProgressResponse('Steal Emoji In Progress', 0, sources.length, 'Adding emojis to this server...')],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => null);
        if (!progressMessage) return;

        const { ok, fail } = await stealEmojis(message.guild, message.author, sources, async ({ current, total, emoji }) => {
            await progressMessage.edit({
                components: [buildProgressResponse(
                    'Steal Emoji In Progress',
                    current, total,
                    'Adding emojis to this server...',
                    emoji?.name ? `:${emoji.name}:` : null,
                )],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => null);
        });

        await progressMessage.edit({ components: [buildResultContainer(ok, fail)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    },
};
