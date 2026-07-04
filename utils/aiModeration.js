'use strict';

/**
 * aiModeration.js — AI-powered content moderation for AutoMod.
 *
 * Provides three capabilities, all backed by Groq's OpenAI-compatible API
 * (the same GROQ_API_KEY already used by aiChatManager + screenshotVerify):
 *
 *   1. analyzeText(text)   → multilingual NSFW / slur / hate / harassment
 *                            classification. Works in ANY language because
 *                            the LLM understands the meaning, not a fixed
 *                            word list.
 *   2. analyzeImage(url)   → NSFW / explicit / gore image classification via
 *                            a vision model (Discord CDN URL passed directly).
 *   3. normalizeText(text) → leetspeak + diacritic + confusable folding so
 *                            the classic keyword filter catches obfuscated
 *                            bad words ("f.u.c.k", "ｆｕｃｋ", "fück", "phuck").
 *
 * Design goals
 * ────────────
 *   • NEVER throw into the messageCreate hot path — every public function
 *     resolves to a safe "not flagged" result on any error/timeout.
 *   • Cheap by default: short-circuits empty/owner-disabled cases, caches
 *     identical text + image results, and rate-limits API usage per guild
 *     so a spam wave can't burn the API quota or stall the event loop.
 *   • If GROQ_API_KEY is missing the AI checks silently no-op (the rest of
 *     AutoMod keeps working).
 */

const crypto = require('crypto');
const log = require('./logger-styled');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Fast, cheap classifier for text; vision model for images. Both can be
// overridden via env without a code change.
const TEXT_MODEL  = process.env.AI_MODERATION_MODEL || 'llama-3.1-8b-instant';
const VISION_MODEL = process.env.AI_MODERATION_VISION_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

const TEXT_TIMEOUT_MS  = 8_000;
const IMAGE_TIMEOUT_MS = 12_000;

// ── Caches (bounded Maps with TTL) ───────────────────────────────────────
const TEXT_CACHE_TTL  = 30 * 60 * 1000;   // 30 min
const IMAGE_CACHE_TTL = 60 * 60 * 1000;   // 1 h
const MAX_CACHE = 1500;
const _textCache  = new Map();   // hash → { result, at }
const _imageCache = new Map();   // urlKey → { result, at }

// ── Per-guild rate limiter ───────────────────────────────────────────────
// Caps how many AI calls a single guild can make in a rolling window so a
// flood can't exhaust the API. When over budget we skip the AI check (the
// keyword/preset filters still run).
const RATE_WINDOW_MS   = 10_000;
const TEXT_MAX_PER_WIN = 25;
const IMG_MAX_PER_WIN  = 12;
const _rate = new Map();   // guildId → { text: number[], image: number[] }

function _withinBudget(guildId, kind) {
    const now = Date.now();
    let entry = _rate.get(guildId);
    if (!entry) { entry = { text: [], image: [] }; _rate.set(guildId, entry); }
    const arr = entry[kind];
    // drop timestamps outside the window
    while (arr.length && now - arr[0] > RATE_WINDOW_MS) arr.shift();
    const cap = kind === 'image' ? IMG_MAX_PER_WIN : TEXT_MAX_PER_WIN;
    if (arr.length >= cap) return false;
    arr.push(now);
    // light memory hygiene
    if (_rate.size > 5000) {
        for (const [g, e] of _rate) {
            if (!e.text.length && !e.image.length) _rate.delete(g);
        }
    }
    return true;
}

function _cacheGet(map, key, ttl) {
    const hit = map.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > ttl) { map.delete(key); return null; }
    return hit.result;
}

function _cacheSet(map, key, result) {
    if (map.size >= MAX_CACHE) {
        // evict oldest ~10%
        let n = Math.ceil(MAX_CACHE * 0.1);
        for (const k of map.keys()) { map.delete(k); if (--n <= 0) break; }
    }
    map.set(key, { result, at: Date.now() });
}

function hasApiKey() {
    const k = process.env.GROQ_API_KEY;
    return !!(k && k.length >= 10);
}

/* ─────────────────────── Text normalization ─────────────────────── */

// Common leetspeak / homoglyph substitutions → plain latin letters.
const LEET_MAP = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g',
    '@': 'a', '$': 's', '!': 'i', '|': 'i', '£': 'l', '€': 'e', '+': 't',
    '¡': 'i', 'ø': 'o', 'ß': 'b',
};

/**
 * Normalize text for keyword matching across languages & obfuscation:
 *   • Unicode NFKD → strip combining diacritics (fück → fuck, café → cafe)
 *   • fold full-width / fancy unicode letters to ASCII where possible
 *   • apply leetspeak map (@→a, 3→e, …)
 *   • collapse repeated separators used to split words (f.u.c.k, f u c k)
 *
 * Returns a lowercased, separator-collapsed string. Safe on any input.
 */
function normalizeText(input) {
    if (!input) return '';
    let s = String(input);
    try { s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); } catch {}
    s = s.toLowerCase();
    // leet / homoglyph substitution
    s = s.replace(/[0134578@$!|£€+¡øß9]/g, (c) => LEET_MAP[c] || c);
    // remove zero-width + common in-word separators so "f.u c-k" → "fuck"
    s = s.replace(/[\u200b-\u200f\u2060\ufeff]/g, '');
    s = s.replace(/[\s._\-*~`'"^]+/g, (m) => (/\s{2,}/.test(m) ? ' ' : ''));
    return s;
}

/* ─────────────────────── Text classification ─────────────────────── */

const TEXT_SYSTEM_PROMPT =
    'You are a strict, multilingual content-moderation classifier for a Discord server. ' +
    'You understand every language and detect meaning even when words are obfuscated, ' +
    'transliterated, or written in non-Latin scripts. Classify the USER message for the ' +
    'following categories: sexual (explicit sexual content / NSFW), slur (racial, ethnic, ' +
    'homophobic, transphobic or other identity slurs), hate (dehumanizing or hateful speech ' +
    'toward a protected group), harassment (targeted insults, threats, bullying), and ' +
    'profanity (strong vulgar language / bad words in any language). ' +
    'Respond ONLY with compact JSON, no prose, in this exact schema: ' +
    '{"flagged":boolean,"categories":string[],"severity":"low"|"medium"|"high","reason":string}. ' +
    'Set flagged=true only if the message actually contains disallowed content. ' +
    'severity: "high" for slurs/hate/explicit sexual/threats, "medium" for clear profanity or ' +
    'sexual references, "low" for mild. reason must be a short English explanation (max 12 words). ' +
    'Do NOT flag ordinary criticism, neutral discussion of topics, medical/educational language, ' +
    'or quoted song lyrics that are not slurs.';

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };

function _parseJsonLoose(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); } catch {}
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return null;
}

/**
 * Classify a text message.
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.guildId] for rate limiting
 * @returns {Promise<{flagged:boolean,categories:string[],severity:string,reason:string}>}
 */
async function analyzeText(text, opts = {}) {
    const SAFE = { flagged: false, categories: [], severity: 'low', reason: '' };
    if (!text) return SAFE;
    const trimmed = String(text).trim();
    // Skip trivially short content (a single emoji / "ok") — not worth an API call.
    if (trimmed.replace(/\s/g, '').length < 3) return SAFE;
    if (!hasApiKey()) return SAFE;

    const key = crypto.createHash('sha1').update(trimmed.slice(0, 1000)).digest('hex');
    const cached = _cacheGet(_textCache, key, TEXT_CACHE_TTL);
    if (cached) return cached;

    if (opts.guildId && !_withinBudget(opts.guildId, 'text')) return SAFE;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEXT_TIMEOUT_MS);
    try {
        const res = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: TEXT_MODEL,
                temperature: 0,
                max_tokens: 200,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: TEXT_SYSTEM_PROMPT },
                    { role: 'user', content: trimmed.slice(0, 2000) },
                ],
            }),
            signal: controller.signal,
        });

        if (!res.ok) {
            if (res.status === 429) log.debug('[AIModeration] text rate-limited by provider');
            else log.debug(`[AIModeration] text API ${res.status}`);
            return SAFE;
        }

        const json = await res.json();
        const parsed = _parseJsonLoose(json?.choices?.[0]?.message?.content);
        if (!parsed) return SAFE;

        const result = {
            flagged: !!parsed.flagged,
            categories: Array.isArray(parsed.categories) ? parsed.categories.slice(0, 6).map(String) : [],
            severity: ['low', 'medium', 'high'].includes(parsed.severity) ? parsed.severity : 'medium',
            reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 140) : '',
        };
        _cacheSet(_textCache, key, result);
        return result;
    } catch (err) {
        if (err.name !== 'AbortError') log.debug(`[AIModeration] text error: ${err.message}`);
        return SAFE;
    } finally {
        clearTimeout(timer);
    }
}

/* ─────────────────────── Image classification ─────────────────────── */

const IMAGE_SYSTEM_PROMPT =
    'You are a strict image-safety classifier for a Discord server. Look at the image and ' +
    'determine whether it contains content that should be removed: pornographic or sexually ' +
    'explicit imagery, nudity, sexual acts, gore / graphic violence / blood, or other obviously ' +
    'NSFW material. Respond ONLY with compact JSON in this schema: ' +
    '{"flagged":boolean,"category":string,"confidence":number,"reason":string}. ' +
    'category is one of "sexual","nudity","gore","violence","safe". confidence is 0-100. ' +
    'reason is a short English explanation (max 12 words). Only set flagged=true when you are ' +
    'reasonably confident the image is NSFW or graphically violent. Ordinary photos, memes, ' +
    'art without explicit nudity, and screenshots are safe.';

/**
 * Classify an image by URL (Discord CDN URL works directly).
 * @param {string} imageUrl
 * @param {object} [opts]
 * @returns {Promise<{flagged:boolean,category:string,confidence:number,reason:string}>}
 */
async function analyzeImage(imageUrl, opts = {}) {
    const SAFE = { flagged: false, category: 'safe', confidence: 0, reason: '' };
    if (!imageUrl || !hasApiKey()) return SAFE;

    const urlKey = String(imageUrl).split('?')[0];
    const cached = _cacheGet(_imageCache, urlKey, IMAGE_CACHE_TTL);
    if (cached) return cached;

    if (opts.guildId && !_withinBudget(opts.guildId, 'image')) return SAFE;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    try {
        const res = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: VISION_MODEL,
                temperature: 0,
                max_tokens: 200,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: IMAGE_SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Classify this image.' },
                            { type: 'image_url', image_url: { url: imageUrl } },
                        ],
                    },
                ],
            }),
            signal: controller.signal,
        });

        if (!res.ok) {
            if (res.status === 429) log.debug('[AIModeration] image rate-limited by provider');
            else log.debug(`[AIModeration] image API ${res.status}`);
            return SAFE;
        }

        const json = await res.json();
        const parsed = _parseJsonLoose(json?.choices?.[0]?.message?.content);
        if (!parsed) return SAFE;

        let confidence = Number(parsed.confidence);
        if (!Number.isFinite(confidence)) confidence = parsed.flagged ? 75 : 0;
        confidence = Math.max(0, Math.min(100, confidence));

        const result = {
            flagged: !!parsed.flagged && confidence >= 55,
            category: typeof parsed.category === 'string' ? parsed.category.slice(0, 24) : 'unknown',
            confidence,
            reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 140) : '',
        };
        _cacheSet(_imageCache, urlKey, result);
        return result;
    } catch (err) {
        if (err.name !== 'AbortError') log.debug(`[AIModeration] image error: ${err.message}`);
        return SAFE;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    analyzeText,
    analyzeImage,
    normalizeText,
    hasApiKey,
    TEXT_MODEL,
    VISION_MODEL,
};
