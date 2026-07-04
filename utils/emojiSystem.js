'use strict';

/**
 * emojiSystem.js — single source of truth for emoji/sticker handling.
 *
 * Every emoji-related command (globalemoji, globalsticker, stealemoji,
 * stealsticker, steal, deleteemoji, renameemoji, sticker-delete,
 * autoreact, emoji-info) used to ship its own copy of:
 *
 *   • emoji tag parsing
 *   • snowflake detection
 *   • CDN URL building
 *   • Discord error-code translation
 *   • permission checks
 *   • name sanitization
 *
 * Each copy had subtle bugs (`\d{15,}` matched too liberally, names got
 * normalized to empty strings, wrong CDN host for stickers, missing
 * `?size=` hints, missing role-locked / unavailable handling, etc).
 *
 * This module is the canonical implementation. Every consumer should
 * route through here so there's exactly one regex, one URL builder,
 * one error translator, and one permission predicate.
 */

const { PermissionFlagsBits } = require('discord.js');

/* ─────────────────────── Constants ─────────────────────── */

const SNOWFLAKE_RE = /^\d{17,20}$/;
const EMOJI_TAG_RE = /<(a)?:([\w~]{2,32}):(\d{17,20})>/;
const EMOJI_TAG_RE_GLOBAL = /<(a)?:([\w~]{2,32}):(\d{17,20})>/g;
const STICKER_URL_RE = /(?:cdn|media)\.discordapp\.(?:com|net)\/stickers\/(\d{17,20})(?:\.(\w+))?/i;
const STICKER_URL_RE_GLOBAL = /(?:cdn|media)\.discordapp\.(?:com|net)\/stickers\/(\d{17,20})(?:\.(\w+))?/gi;

const VALID_EMOJI_NAME_RE = /^[a-zA-Z0-9_~]{2,32}$/;
const VALID_STICKER_NAME_RE = /^[\w ]{2,30}$/;

// Discord caps emoji uploads at 256 KB and stickers at 512 KB.
const EMOJI_MAX_BYTES = 256 * 1024;
const STICKER_MAX_BYTES = 512 * 1024;

const STICKER_FORMAT = {
    PNG: 1,
    APNG: 2,
    LOTTIE: 3,
    GIF: 4,
};

const STICKER_FORMAT_LABEL = {
    [STICKER_FORMAT.PNG]: 'PNG',
    [STICKER_FORMAT.APNG]: 'APNG',
    [STICKER_FORMAT.LOTTIE]: 'Lottie',
    [STICKER_FORMAT.GIF]: 'GIF',
};

const STICKER_FORMAT_EXT = {
    [STICKER_FORMAT.PNG]: 'png',
    [STICKER_FORMAT.APNG]: 'png',
    [STICKER_FORMAT.LOTTIE]: 'json',
    [STICKER_FORMAT.GIF]: 'gif',
};

/* ─────────────────────── CDN helpers ─────────────────────── */

/**
 * Build the canonical CDN URL for an emoji. Always uses cdn.discordapp.com
 * since `emojis.create` accepts any URL Discord can fetch — `media.…` adds
 * an unnecessary edge hop.
 *
 * @param {string} id - Snowflake
 * @param {boolean} animated
 * @param {object} [opts]
 * @param {number} [opts.size] - One of 16,32,64,128,256,512,1024,2048,4096
 * @returns {string}
 */
function emojiCdnUrl(id, animated, opts = {}) {
    const ext = animated ? 'gif' : 'png';
    const qs = opts.size ? `?size=${opts.size}` : '';
    return `https://cdn.discordapp.com/emojis/${id}.${ext}${qs}`;
}

/**
 * Build the canonical CDN URL for a sticker.
 * `cdn.discordapp.com` is used for raw downloads (sticker.create accepts it).
 * `media.discordapp.net` is used for previews (handles size resizing).
 *
 * @param {string} id
 * @param {number} format - STICKER_FORMAT.*
 * @param {object} [opts]
 * @param {number} [opts.size]
 * @param {boolean} [opts.preview] - if true, returns the media.discordapp.net resized URL
 */
function stickerCdnUrl(id, format, opts = {}) {
    const ext = STICKER_FORMAT_EXT[format] || 'png';
    if (opts.preview) {
        const previewExt = format === STICKER_FORMAT.LOTTIE ? 'png' : ext;
        const qs = opts.size ? `?size=${opts.size}` : '';
        return `https://media.discordapp.net/stickers/${id}.${previewExt}${qs}`;
    }
    return `https://cdn.discordapp.com/stickers/${id}.${ext}`;
}

/* ─────────────────────── Parsers ─────────────────────── */

/**
 * Parse a single custom-emoji tag. Returns `{animated, name, id}` or `null`.
 * Accepts either a tag (`<:name:id>`/`<a:name:id>`) or a bare snowflake.
 */
function parseEmojiInput(input) {
    if (!input || typeof input !== 'string') return null;
    const tagMatch = input.match(EMOJI_TAG_RE);
    if (tagMatch) {
        return { animated: tagMatch[1] === 'a', name: tagMatch[2], id: tagMatch[3] };
    }
    const trimmed = input.trim();
    if (SNOWFLAKE_RE.test(trimmed)) {
        return { animated: false, name: null, id: trimmed };
    }
    return null;
}

/**
 * Parse a free-form input string into a list of `{id, name, animated}`
 * entries. Handles emoji tags, bare snowflakes, comma/newline/space-separated
 * mixed input, and de-duplicates by id.
 */
function parseEmojiList(raw) {
    if (!raw || typeof raw !== 'string') return [];
    const out = [];
    const seen = new Set();

    // Tags first — they preserve animated flag and name hint.
    EMOJI_TAG_RE_GLOBAL.lastIndex = 0;
    let m;
    while ((m = EMOJI_TAG_RE_GLOBAL.exec(raw)) !== null) {
        if (seen.has(m[3])) continue;
        seen.add(m[3]);
        out.push({ animated: m[1] === 'a', name: m[2], id: m[3] });
    }

    // Bare snowflakes that weren't part of a tag.
    const bareRe = /\b(\d{17,20})\b/g;
    while ((m = bareRe.exec(raw)) !== null) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ animated: false, name: null, id: m[1] });
    }

    return out;
}

/**
 * Parse a free-form input string into a list of `{id}` sticker entries.
 * Handles bare snowflakes and Discord sticker URLs.
 */
function parseStickerList(raw) {
    if (!raw || typeof raw !== 'string') return [];
    const out = [];
    const seen = new Set();

    STICKER_URL_RE_GLOBAL.lastIndex = 0;
    let m;
    while ((m = STICKER_URL_RE_GLOBAL.exec(raw)) !== null) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ id: m[1], hintExt: (m[2] || '').toLowerCase() || null });
    }

    const bareRe = /\b(\d{17,20})\b/g;
    while ((m = bareRe.exec(raw)) !== null) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ id: m[1], hintExt: null });
    }

    return out;
}

/* ─────────────────────── Name sanitizers ─────────────────────── */

/**
 * Sanitize a string for use as an emoji name.
 * Discord requires 2-32 chars, alphanumeric/underscore.
 * Falls back to `fallback` when input is empty or invalid post-sanitization.
 */
function sanitizeEmojiName(raw, fallback = 'stolen_emoji') {
    const cleaned = String(raw || '')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')      // collapse runs of underscores
        .replace(/^_+|_+$/g, '')  // trim leading/trailing underscores
        .slice(0, 32);
    return cleaned.length >= 2 ? cleaned : fallback;
}

/**
 * Sanitize a string for use as a sticker name.
 * Discord requires 2-30 chars, with spaces allowed.
 */
function sanitizeStickerName(raw, fallback = 'sticker') {
    const cleaned = String(raw || '')
        .replace(/[^a-zA-Z0-9_ ]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 30);
    return cleaned.length >= 2 ? cleaned : fallback;
}

/* ─────────────────────── Permission helpers ─────────────────────── */

/**
 * True when the member can manage emojis/stickers in this server.
 * Includes both the explicit ManageGuildExpressions perm and Administrator,
 * which implicitly grants every permission. This is the canonical check —
 * use it everywhere instead of duplicating the logic.
 */
function canManageExpressions(member) {
    if (!member?.permissions) return false;
    return member.permissions.has(PermissionFlagsBits.ManageGuildExpressions)
        || member.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * True when the bot itself has ManageGuildExpressions in this guild.
 * Always run this before emoji/sticker `.create()` / `.delete()` calls
 * so we can show a clearer error than Discord's 50013 stack trace.
 */
function botCanManageExpressions(guild) {
    const me = guild?.members?.me;
    if (!me?.permissions) return false;
    return me.permissions.has(PermissionFlagsBits.ManageGuildExpressions)
        || me.permissions.has(PermissionFlagsBits.Administrator);
}

/* ─────────────────────── Error translators ─────────────────────── */

/**
 * Turn a Discord REST error into a short human-readable string.
 * Falls back to a trimmed `err.message` for unknown codes.
 */
function explainEmojiError(err) {
    if (!err) return 'Unknown error';
    switch (err.code) {
        case 30008: return 'Server emoji slots are full';
        case 50013: return 'Bot is missing **Manage Expressions**';
        case 50035: return 'Invalid emoji name or file';
        case 50045: return 'Asset is too large (max 256 KB)';
        case 50138: return 'Resource type does not match (file may be corrupt)';
    }
    return (err.message || 'Unknown error').slice(0, 120);
}

function explainStickerError(err) {
    if (!err) return 'Unknown error';
    switch (err.code) {
        case 30039: return 'Server sticker slots are full (boost level limited)';
        case 50013: return 'Bot is missing **Manage Expressions**';
        case 50035: return 'Invalid sticker name or tags';
        case 50046: return 'File is too large (max 512 KB)';
        case 50006: return 'Invalid source URL';
        case 50138: return 'Resource type does not match (file may be corrupt)';
    }
    return (err.message || 'Unknown error').slice(0, 120);
}

/* ─────────────────────── CDN probing ─────────────────────── */

/**
 * Probe a Discord-hosted emoji ID to check whether the asset exists and
 * whether it's animated. Tries `.gif` first because animated emojis only
 * resolve at the gif extension.
 *
 * @returns {Promise<{id, animated, url, ext} | null>}
 */
async function probeEmojiId(id, { timeoutMs = 4000 } = {}) {
    const sf = String(id || '').trim();
    if (!SNOWFLAKE_RE.test(sf)) return null;
    const tryFetch = async (ext) => {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(`https://cdn.discordapp.com/emojis/${sf}.${ext}`, {
                method: 'HEAD',
                signal: controller.signal,
            });
            return res.ok;
        } catch {
            return false;
        } finally {
            clearTimeout(t);
        }
    };
    if (await tryFetch('gif')) {
        return { id: sf, animated: true, ext: 'gif', url: emojiCdnUrl(sf, true, { size: 128 }) };
    }
    if (await tryFetch('png')) {
        return { id: sf, animated: false, ext: 'png', url: emojiCdnUrl(sf, false, { size: 128 }) };
    }
    return null;
}

/* ─────────────────────── Emoji role/availability inspector ─────────────────────── */

/**
 * Normalize a `GuildEmoji.roles` value into a plain id array.
 * djs versions vary: it can be `Manager`, `Collection`, or array.
 */
function emojiRoleIds(emoji) {
    if (!emoji) return [];
    const roles = emoji.roles;
    if (!roles) return [];
    if (typeof roles.cache?.keys === 'function') return [...roles.cache.keys()];
    if (Array.isArray(roles)) return [...roles];
    if (typeof roles.keys === 'function') return [...roles.keys()];
    return [];
}

/**
 * Capture the bot-relevant flags that determine whether the bot can
 * actually use this emoji inline cross-server. The browser uses these
 * to render lock/unavailable badges.
 */
function emojiUsability(emoji) {
    const roleIds = emojiRoleIds(emoji);
    const restricted = roleIds.length > 0;
    const available = emoji?.available !== false;
    return { restricted, available, usable: available && !restricted, roleIds };
}

module.exports = {
    // Regex
    SNOWFLAKE_RE,
    EMOJI_TAG_RE,
    EMOJI_TAG_RE_GLOBAL,
    STICKER_URL_RE,
    STICKER_URL_RE_GLOBAL,
    VALID_EMOJI_NAME_RE,
    VALID_STICKER_NAME_RE,

    // Constants
    EMOJI_MAX_BYTES,
    STICKER_MAX_BYTES,
    STICKER_FORMAT,
    STICKER_FORMAT_LABEL,
    STICKER_FORMAT_EXT,

    // CDN
    emojiCdnUrl,
    stickerCdnUrl,

    // Parsers
    parseEmojiInput,
    parseEmojiList,
    parseStickerList,

    // Sanitizers
    sanitizeEmojiName,
    sanitizeStickerName,

    // Permissions
    canManageExpressions,
    botCanManageExpressions,

    // Errors
    explainEmojiError,
    explainStickerError,

    // CDN probing
    probeEmojiId,

    // Inspectors
    emojiRoleIds,
    emojiUsability,
};
