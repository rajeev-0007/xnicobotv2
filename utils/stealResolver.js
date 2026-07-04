'use strict';

/**
 * stealResolver — unified steal-target detection.
 *
 * Used by `/steal` (and `-steal`) to take any user input — Discord
 * emoji/sticker, attachment, image URL, Tenor/Giphy link, or arbitrary
 * web URL — and turn it into a normalized source the bot can offer
 * the user as either an emoji OR a sticker.
 *
 * The detection is intentionally generous: we'd rather present a
 * preview the user can confirm than refuse a borderline URL.
 */

const VALID_IMAGE_TYPES = new Set([
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/apng',
]);
const IMAGE_EXT_RE = /\.(png|apng|jpe?g|gif|webp)(?:[?#].*)?$/i;
const SNOWFLAKE_RE = /^\d{17,20}$/;

/* ─────────────────────── Source factories ─────────────────────── */

function makeEmojiSource(input) {
    return {
        // For emoji creation: name (alphanumeric/underscore, 2-32) + animated flag
        kind: 'emoji',
        ...input,
    };
}

function makeStickerSource(input) {
    return {
        kind: 'sticker',
        ...input,
    };
}

/* ─────────────────────── Detectors ─────────────────────── */

/**
 * Detect a custom Discord emoji tag: <:name:id> or <a:name:id>
 */
function detectCustomEmoji(text) {
    if (!text || typeof text !== 'string') return null;
    const m = text.match(/<(a)?:([\w~]{1,32}):(\d{17,20})>/);
    if (!m) return null;
    const animated = m[1] === 'a';
    return {
        type: 'discord-emoji',
        animated,
        name: m[2],
        id: m[3],
        url: `https://cdn.discordapp.com/emojis/${m[3]}.${animated ? 'gif' : 'png'}?size=128`,
        previewUrl: `https://cdn.discordapp.com/emojis/${m[3]}.${animated ? 'gif' : 'png'}?size=320`,
        sourceLabel: 'Discord emoji',
    };
}

/**
 * Detect a sticker URL or bare sticker ID input.
 */
function detectStickerLink(text) {
    if (!text || typeof text !== 'string') return null;

    const urlMatch = text.match(/(?:cdn|media)\.discordapp\.(?:com|net)\/stickers\/(\d{17,20})\.?(\w+)?/i);
    if (urlMatch) {
        const id = urlMatch[1];
        const ext = (urlMatch[2] || 'png').toLowerCase();
        return {
            type: 'discord-sticker',
            id,
            name: 'sticker',
            ext,
            url: `https://cdn.discordapp.com/stickers/${id}.${ext}`,
            previewUrl: `https://media.discordapp.net/stickers/${id}.${ext === 'json' ? 'png' : ext}?size=320`,
            sourceLabel: 'Discord sticker',
        };
    }

    return null;
}

/**
 * Detect a direct image URL (png/gif/jpeg/webp/apng).
 */
function detectDirectImage(text) {
    if (!text || typeof text !== 'string') return null;
    const m = text.match(/https?:\/\/[^\s<>"]+\.(png|apng|jpe?g|gif|webp)(?:\?[^\s<>"]*)?(?:#[^\s<>"]*)?/i);
    if (!m) return null;
    const url = m[0];
    const ext = m[1].toLowerCase();
    const animated = ext === 'gif' || ext === 'apng';
    return {
        type: 'direct-image',
        url,
        previewUrl: url,
        animated,
        ext,
        name: extractNameFromUrl(url),
        sourceLabel: 'Image URL',
    };
}

/**
 * Detect Tenor links (tenor.com/view/foo-1234567).
 * Resolves to a direct .gif by hitting Tenor's `/view/` page and looking
 * for the og:image / og:video meta tags. We cap fetched bytes for safety.
 */
async function detectTenor(text) {
    if (!text || typeof text !== 'string') return null;
    const m = text.match(/https?:\/\/(?:www\.)?tenor\.com\/(?:view\/|[\w-]+\/)?\S*?(\d{6,20})/i);
    if (!m) return null;
    const pageUrl = m[0];
    const og = await scrapeOpenGraph(pageUrl);
    if (!og) return null;
    const url = og.video || og.image;
    if (!url) return null;
    return {
        type: 'tenor',
        url,
        previewUrl: og.image || url,
        animated: /\.(gif|mp4|webm)(\?|$)/i.test(url),
        ext: detectExtFromUrl(url) || 'gif',
        name: extractNameFromUrl(pageUrl) || 'tenor',
        sourceLabel: 'Tenor',
    };
}

/**
 * Detect Giphy links (giphy.com/gifs/foo-12345).
 */
async function detectGiphy(text) {
    if (!text || typeof text !== 'string') return null;
    const m = text.match(/https?:\/\/(?:www\.)?giphy\.com\/(?:gifs|stickers|clips)\/[\w-]+/i);
    if (!m) return null;
    const og = await scrapeOpenGraph(m[0]);
    if (!og?.image) return null;
    return {
        type: 'giphy',
        url: og.image,
        previewUrl: og.image,
        animated: true,
        ext: detectExtFromUrl(og.image) || 'gif',
        name: extractNameFromUrl(m[0]) || 'giphy',
        sourceLabel: 'Giphy',
    };
}

/**
 * Generic web page → check og:image. Lets users paste any link that
 * has a visible image preview (Twitter/X, Reddit, etc.).
 */
async function detectWebPage(text) {
    if (!text || typeof text !== 'string') return null;
    const m = text.match(/https?:\/\/[^\s<>"]+/i);
    if (!m) return null;
    // Skip URLs we already handle elsewhere
    if (/cdn\.discordapp\.com|media\.discordapp\.(com|net)|tenor\.com|giphy\.com/i.test(m[0])) return null;
    const og = await scrapeOpenGraph(m[0]);
    if (!og?.image) return null;
    return {
        type: 'webpage',
        url: og.image,
        previewUrl: og.image,
        animated: /\.(gif|apng)(\?|$)/i.test(og.image),
        ext: detectExtFromUrl(og.image) || 'png',
        name: extractNameFromUrl(m[0]) || 'web',
        sourceLabel: extractDomain(m[0]),
    };
}

/**
 * Detect message attachments (images uploaded with a message).
 */
function detectAttachments(attachments) {
    const out = [];
    if (!attachments?.size) return out;
    for (const [, att] of attachments) {
        if (!att.contentType || !VALID_IMAGE_TYPES.has(att.contentType)) {
            // Some clients omit contentType; fall back to extension
            if (!IMAGE_EXT_RE.test(att.name || att.url || '')) continue;
        }
        const ext = (att.contentType || '').split('/')[1] || (att.name?.match(IMAGE_EXT_RE)?.[1] || 'png');
        out.push({
            type: 'attachment',
            url: att.url,
            previewUrl: att.url,
            animated: ext === 'gif' || ext === 'apng',
            ext,
            name: extractNameFromUrl(att.name || att.url || 'image'),
            sourceLabel: 'Attachment',
        });
    }
    return out;
}

/* ─────────────────────── OG scraping ─────────────────────── */

const FETCH_LIMIT_BYTES = 256 * 1024;
const FETCH_TIMEOUT_MS = 6000;

async function scrapeOpenGraph(pageUrl) {
    let res;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        res = await fetch(pageUrl, {
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; xNicoBot/2.0; +https://xnico.bot)',
                'Accept': 'text/html,application/xhtml+xml',
            },
        });
        clearTimeout(timer);
    } catch { return null; }
    if (!res?.ok) return null;

    // Stream the first 256 KB only.
    let html = '';
    try {
        const reader = res.body?.getReader?.();
        if (!reader) {
            html = await res.text();
        } else {
            const decoder = new TextDecoder();
            let received = 0;
            while (received < FETCH_LIMIT_BYTES) {
                const { value, done } = await reader.read();
                if (done) break;
                received += value.length;
                html += decoder.decode(value, { stream: true });
            }
            try { reader.cancel(); } catch {}
        }
    } catch { return null; }

    if (!html) return null;
    const tags = {};
    const reMeta = /<meta[^>]+property=["']og:(image|video)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = reMeta.exec(html)) !== null) {
        const key = m[1].toLowerCase();
        if (!tags[key]) tags[key] = decodeHtmlEntities(m[2]);
    }
    // Some sites (e.g. Tenor) put og:image first in a different attribute order.
    if (!tags.image) {
        const alt = /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i.exec(html);
        if (alt) tags.image = decodeHtmlEntities(alt[1]);
    }
    return tags;
}

function decodeHtmlEntities(s) {
    return String(s)
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

function extractNameFromUrl(url) {
    if (!url) return 'image';
    const cleaned = String(url).split(/[?#]/)[0].replace(/\/+$/, '');
    const last = cleaned.split('/').pop() || 'image';
    return last.replace(/\.[^.]+$/, '');
}

function extractDomain(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return 'webpage'; }
}

function detectExtFromUrl(url) {
    const m = String(url || '').match(IMAGE_EXT_RE);
    return m ? m[1].toLowerCase() : null;
}

/* ─────────────────────── Public API ─────────────────────── */

/**
 * Resolve any combination of inputs into a list of normalized
 * "candidate" objects. Each candidate exposes:
 *   { type, url, previewUrl, animated, ext, name, sourceLabel }
 *
 * The caller can then ask the user whether to add each as emoji/sticker.
 */
async function resolveAnyInput({ textInput, repliedMessage, directAttachments }) {
    const candidates = [];
    const seen = new Set();
    const push = (c) => {
        if (!c) return;
        const key = c.url || `${c.type}:${c.id || c.name}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push(c);
    };

    // 1. Direct attachments (slash + prefix)
    for (const c of detectAttachments(directAttachments)) push(c);

    // 2. Replied-message attachments
    if (repliedMessage?.attachments?.size) {
        for (const c of detectAttachments(repliedMessage.attachments)) push(c);
    }

    // 3. Replied-message stickers
    if (repliedMessage?.stickers?.size) {
        for (const [, st] of repliedMessage.stickers) {
            if (st.format === 3) continue; // skip Lottie
            const ext = st.format === 4 ? 'gif' : 'png';
            push({
                type: 'discord-sticker',
                id: st.id,
                name: st.name || 'sticker',
                ext,
                url: `https://cdn.discordapp.com/stickers/${st.id}.${ext}`,
                previewUrl: `https://media.discordapp.net/stickers/${st.id}.${ext}?size=320`,
                animated: st.format === 4,
                sourceLabel: 'Discord sticker',
            });
        }
    }

    // 4. Text input — try every detector.
    const textPool = [];
    if (textInput) textPool.push(textInput);
    if (repliedMessage?.content) textPool.push(repliedMessage.content);

    for (const text of textPool) {
        // Discord emojis / stickers (cheap, no network)
        const allEmojiTags = matchAll(/<(a)?:([\w~]{1,32}):(\d{17,20})>/g, text);
        for (const m of allEmojiTags) {
            push(detectCustomEmoji(m[0]));
        }
        const stickerHit = detectStickerLink(text);
        if (stickerHit) push(stickerHit);

        // Direct images first (no network needed)
        const directHits = matchAll(/https?:\/\/[^\s<>"]+\.(?:png|apng|jpe?g|gif|webp)(?:\?[^\s<>"]*)?/gi, text);
        for (const m of directHits) {
            const single = detectDirectImage(m[0]);
            if (single) push(single);
        }

        // Network-backed detectors (run sequentially to keep the response snappy
        // and avoid hammering ourselves with parallel fetches on a long paste)
        const tenor = await detectTenor(text);
        if (tenor) push(tenor);
        const giphy = await detectGiphy(text);
        if (giphy) push(giphy);

        // Generic web page fallback — only if nothing direct matched.
        if (candidates.length === 0) {
            const webpage = await detectWebPage(text);
            if (webpage) push(webpage);
        }
    }

    return candidates;
}

function matchAll(re, str) {
    const out = [];
    if (!str) return out;
    let m;
    const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    while ((m = r.exec(str)) !== null) out.push(m);
    return out;
}

module.exports = {
    resolveAnyInput,
    detectCustomEmoji,
    detectStickerLink,
    detectDirectImage,
    detectAttachments,
    extractNameFromUrl,
    makeEmojiSource,
    makeStickerSource,
};
