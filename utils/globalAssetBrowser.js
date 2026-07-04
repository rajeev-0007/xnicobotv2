'use strict';

/**
 * globalAssetBrowser — shared helpers for the `globalemoji` and
 * `globalsticker` commands.
 *
 * Walks every guild the bot is in, flattens the requested asset type,
 * applies optional filters (name search, animated/static, specific guild,
 * usable/locked state) and caches the result against the panel message
 * so paging through pages does not re-scan every guild.
 *
 * Bot-internal emoji/sticker servers are hidden from these browsers via
 * the BLACKLISTED_GUILDS set below. Anything stored there is considered
 * private bot infrastructure (e.g. branded emojis used by responses).
 *
 * Low-level emoji/sticker primitives (URL construction, ID parsing, error
 * translation, name sanitization, permission checks) live in
 * `utils/emojiSystem.js` — this module only adds the browser-specific
 * scan/cache/filter behaviour on top.
 */

const {
    SNOWFLAKE_RE,
    emojiCdnUrl,
    stickerCdnUrl,
    parseEmojiList,
    parseStickerList,
    sanitizeEmojiName,
    sanitizeStickerName,
    explainEmojiError,
    explainStickerError,
    emojiUsability,
    probeEmojiId,
    STICKER_FORMAT,
    STICKER_FORMAT_LABEL,
    STICKER_FORMAT_EXT,
} = require('./emojiSystem');

const TIMEOUT_MS = 5 * 60 * 1000;
const SCAN_CACHE = new Map();

/**
 * Shared emoji palette for the global asset browsers.
 *
 * Every entry here is a custom emoji from one of the bot's own emoji
 * hosting servers (whitelisted in `utils/emojiGuard.js`), so they render
 * reliably in every client and survive the runtime emoji guard. Raw
 * Unicode glyphs are intentionally avoided — Discord clients render
 * many of them inconsistently (some fall outside the emoji guard's
 * validation window and get stripped to nothing), which is why the
 * previous browser UI looked half-broken.
 *
 * Use these instead of inline `<:Name:id>` literals so both `globalemoji`
 * and `globalsticker` stay visually consistent and a future palette swap
 * is a single-file change.
 */
const EMOJIS = {
    // Brand & header
    brand:     '<:xnico:1521228240440660180>',

    // Status
    success:   '<:Checkedbox:1521227734943269077>',
    error:     '<:Cancel:1521227723916181644>',
    info:      '<:Inforect:1521228008285929532>',
    warning:   '<:Infotriangle:1521227710381428926>',

    // Layout / list
    bullet:    '<:Caretright:1521227704953864202>',
    book:      '<:Bookopen:1521227911137595605>',
    document:  '<:Document:1521227875016114266>',
    bulb:      '<:Lightbulbalt:1521227880703463675>',
    settings:  '<:Settings:1521227767780343879>',
    star:      '<:Star:1521227981685526568>',

    // Asset type indicators
    animated:  '<:Lightning:1521227915537285150>',
    static:    '<:Picture:1521227954191995024>',
    sticker:   '<:Palette:1521227950601539755>',

    // State badges
    locked:    '<:Lock:1521227892770734120>',
    unavailable: '<:Infotriangle:1521227710381428926>',
    usable:    '<:Checkedbox:1521227734943269077>',

    // Navigation
    first:     '<:Caretleft:1521227977495543838>',
    prev:      '<:Caretleft:1521227977495543838>',
    next:      '<:Caretright:1521227704953864202>',
    last:      '<:Caretright:1521227704953864202>',
    back:      '<:Caretleft:1521227977495543838>',

    // Actions
    search:    '<:Search:1521228231263387738>',
    byid:      '<:Document:1521227875016114266>',
    reset:     '<:Refresh:1521227946441052420>',
    help:      '<:Lightbulbalt:1521227880703463675>',
};

/**
 * Hard-coded list of guilds whose emojis/stickers must NEVER be exposed
 * by the global browsers, even when the bot is a member. These are the
 * private servers used to host the bot's own UI emojis (Checkedbox,
 * Cancel, Document, etc.) — leaking them as stealable content would
 * pollute every server with our internal asset library.
 */
const BLACKLISTED_GUILDS = new Set([
    '1473039435041079612',
    '1473037697000935454',
    '1473038756981375188',
]);

function setScan(messageId, payload) {
    SCAN_CACHE.set(messageId, payload);
    const t = setTimeout(() => SCAN_CACHE.delete(messageId), TIMEOUT_MS + 30_000);
    // Don't keep the event loop alive just to evict a cache entry.
    if (typeof t.unref === 'function') t.unref();
}

function getScan(messageId) {
    return SCAN_CACHE.get(messageId) || null;
}

function clearScan(messageId) {
    SCAN_CACHE.delete(messageId);
}

function isBlacklistedGuild(guildId) {
    return BLACKLISTED_GUILDS.has(String(guildId));
}

/* ─────────────────────────── Emoji ─────────────────────────── */

/**
 * Walk every guild in `client.guilds.cache` and return a sorted list of
 * emoji descriptors that match the supplied filter options.
 *
 * Returned shape per entry:
 *   {
 *     id, name, animated,
 *     guildId, guildName,
 *     url,        // 128px preview (works regardless of role-locks)
 *     cdnUrl,     // raw cdn url used for emojis.create
 *     tag,        // <:name:id> — only inline-renderable for `usable` items
 *     restricted, available, usable,
 *     roleIds,
 *   }
 */
function flattenEmojis(client, opts = {}) {
    const search = (opts.search || '').toLowerCase().trim();
    const animatedOnly = !!opts.animatedOnly;
    const staticOnly = !!opts.staticOnly;
    const guildFilter = opts.guildFilter ? String(opts.guildFilter).toLowerCase() : null;
    const usableOnly = !!opts.usableOnly;
    const lockedOnly = !!opts.lockedOnly;

    const out = [];
    let guildsScanned = 0;
    for (const guild of client.guilds.cache.values()) {
        if (BLACKLISTED_GUILDS.has(guild.id)) continue;
        if (guildFilter
            && !guild.id.includes(guildFilter)
            && !guild.name.toLowerCase().includes(guildFilter)) continue;
        guildsScanned++;
        for (const emoji of guild.emojis.cache.values()) {
            if (animatedOnly && !emoji.animated) continue;
            if (staticOnly && emoji.animated) continue;
            if (search && !emoji.name.toLowerCase().includes(search)) continue;

            // Discord's `available` flips to false when the source guild loses
            // boosts mid-session — the emoji is still cached, but the bot can
            // no longer render it inline. Same idea for role-restricted
            // emojis: the bot needs to hold one of `emoji.roles` in the
            // source guild to put `<:tag:id>` in a message anywhere, so for
            // browser-display purposes we treat both as "preview-only".
            const usability = emojiUsability(emoji);

            if (usableOnly && !usability.usable) continue;
            if (lockedOnly && usability.usable) continue;

            const cdnUrl = emojiCdnUrl(emoji.id, !!emoji.animated);
            out.push({
                id: emoji.id,
                name: emoji.name,
                animated: !!emoji.animated,
                guildId: guild.id,
                guildName: guild.name,
                // Preview URL for thumbnails — always works regardless of
                // role restrictions, since Discord's CDN doesn't gate
                // emoji image fetches on the consumer's permissions.
                url: emoji.imageURL?.({ size: 128 }) || emojiCdnUrl(emoji.id, !!emoji.animated, { size: 128 }),
                // Full-size URL used for the actual `emojis.create` upload.
                cdnUrl,
                tag: emoji.toString(),
                ...usability,
            });
        }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return { items: out, guildsScanned };
}

/**
 * Resolve an emoji from a raw snowflake ID by probing the CDN.
 * Tries animated (.gif) first. Returns `null` if no asset is found.
 *
 * The returned shape mirrors `flattenEmojis` so the caller can use a
 * single render path for cache hits and probe results.
 */
async function fetchEmojiById(rawId, fallbackName) {
    const probed = await probeEmojiId(rawId);
    if (!probed) return null;
    const sanitized = sanitizeEmojiName(fallbackName, 'stolen_emoji');
    const cdnUrl = emojiCdnUrl(probed.id, probed.animated);
    return {
        id: probed.id,
        name: sanitized,
        animated: probed.animated,
        url: emojiCdnUrl(probed.id, probed.animated, { size: 128 }),
        cdnUrl,
        guildId: null,
        guildName: 'Direct ID',
        tag: probed.animated
            ? `<a:${fallbackName || 'emoji'}:${probed.id}>`
            : `<:${fallbackName || 'emoji'}:${probed.id}>`,
        restricted: false,
        available: true,
        usable: true,
        roleIds: [],
    };
}

// Re-export for callers that already import these from this module.
const parseEmojiIdInput = parseEmojiList;

/* ────────────────────────── Stickers ────────────────────────── */

function flattenStickers(client, opts = {}) {
    const search = (opts.search || '').toLowerCase().trim();
    const guildFilter = opts.guildFilter ? String(opts.guildFilter).toLowerCase() : null;
    const skipLottie = opts.skipLottie !== false;

    const out = [];
    let guildsScanned = 0;
    for (const guild of client.guilds.cache.values()) {
        if (BLACKLISTED_GUILDS.has(guild.id)) continue;
        if (guildFilter
            && !guild.id.includes(guildFilter)
            && !guild.name.toLowerCase().includes(guildFilter)) continue;
        guildsScanned++;
        for (const sticker of guild.stickers.cache.values()) {
            if (skipLottie && sticker.format === STICKER_FORMAT.LOTTIE) continue;
            if (search) {
                const haystack = `${sticker.name} ${sticker.tags || ''} ${sticker.description || ''}`.toLowerCase();
                if (!haystack.includes(search)) continue;
            }
            out.push({
                id: sticker.id,
                name: sticker.name,
                tags: sticker.tags || '',
                description: sticker.description || '',
                format: sticker.format,
                formatLabel: STICKER_FORMAT_LABEL[sticker.format] || 'Unknown',
                guildId: guild.id,
                guildName: guild.name,
                url: stickerCdnUrl(sticker.id, sticker.format, { preview: true, size: 320 }),
                cdnUrl: stickerCdnUrl(sticker.id, sticker.format),
            });
        }
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return { items: out, guildsScanned };
}

/**
 * Resolve a sticker from a raw snowflake ID using Discord's REST API.
 * The /stickers/{id} endpoint works for any sticker the bot can see,
 * including stickers from servers the bot is NOT in.
 *
 * Returns `null` if the sticker doesn't exist or is Lottie (un-cloneable).
 */
async function fetchStickerById(client, rawId) {
    const id = String(rawId || '').trim();
    if (!SNOWFLAKE_RE.test(id)) return null;

    let raw;
    try {
        raw = await client.rest.get(`/stickers/${id}`);
    } catch {
        return null;
    }
    if (!raw || raw.format_type === STICKER_FORMAT.LOTTIE) return null;

    return {
        id,
        name: raw.name || 'sticker',
        tags: raw.tags || '',
        description: raw.description || '',
        format: raw.format_type || STICKER_FORMAT.PNG,
        formatLabel: STICKER_FORMAT_LABEL[raw.format_type] || 'Unknown',
        guildId: null,
        guildName: 'Direct ID',
        url: stickerCdnUrl(id, raw.format_type, { preview: true, size: 320 }),
        cdnUrl: stickerCdnUrl(id, raw.format_type),
    };
}

const parseStickerIdInput = parseStickerList;

/* ─────────────────────── Sticker tag picker ────────────────────── */

const UNICODE_EMOJI_RE = /(\p{Emoji_Presentation}|\p{Extended_Pictographic})(\uFE0F|\u200D|\p{Emoji_Presentation}|\p{Extended_Pictographic})*/u;

function pickStickerTag(sticker) {
    if (!sticker?.tags) return '😀';
    const m = sticker.tags.match(UNICODE_EMOJI_RE);
    return m ? m[0] : '😀';
}

// Backward-compat name aliases so existing callers keep working without
// having to know about emojiSystem.js.
const sanitizeName = sanitizeEmojiName;

module.exports = {
    TIMEOUT_MS,
    EMOJIS,
    BLACKLISTED_GUILDS,
    isBlacklistedGuild,
    setScan,
    getScan,
    clearScan,

    // Emoji
    flattenEmojis,
    fetchEmojiById,
    parseEmojiIdInput,
    explainEmojiError,
    sanitizeName,
    sanitizeEmojiName,

    // Sticker
    flattenStickers,
    fetchStickerById,
    parseStickerIdInput,
    explainStickerError,
    pickStickerTag,
    sanitizeStickerName,

    // Format constants (re-exported)
    STICKER_FORMAT,
    STICKER_FORMAT_LABEL,
    STICKER_FORMAT_EXT,
};
