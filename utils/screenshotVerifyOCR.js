'use strict';

/**
 * Screenshot Verification — OCR Engine
 * ──────────────────────────────────────────────────────────────────
 * Deterministic verification using Tesseract.js (pure JS / WebAssembly).
 * No native binary, no shell exec, nothing leaves the host.  Used as
 * the primary verifier (engine = ocr) or as a fast pre-check before
 * the LLM (engine = hybrid).
 *
 * Why Tesseract.js instead of node-tesseract-ocr?
 *   The CLI wrapper (`node-tesseract-ocr`) is affected by
 *   GHSA-8j44-735h-w4w2 — `recognize()` shell-interpolates its image
 *   path argument and there is no upstream patch.  Tesseract.js runs
 *   entirely in-process via WASM, so OS command injection isn't even
 *   in the threat model, and we no longer need a separately installed
 *   `tesseract` binary on the host.
 *
 * The OCR layer scores each task by how many of its expected tokens
 * appear in the extracted text.  Tokens come from three sources:
 *
 *   • per-task keywords        (admin-defined; weight 1.0)
 *   • the task target          (channel name / @handle / URL; weight 1.5)
 *   • the task type's defaults (e.g. "subscribed", "following"; weight 0.5)
 *
 * Output mirrors the shape returned by screenshotVerifyVision so the
 * pipeline can swap engines without branching:
 *
 *   {
 *     matched, taskId, confidence, reasoning,
 *     model: 'tesseract',
 *     raw:   '<truncated extracted text>'
 *   }
 *
 * Failure modes (worker init / network / timeout) → returns null so
 * the manager can fall back to AI or manual review.
 */

const path = require('path');
const log  = require('./logger-styled');

let tesseractModule = null;
let tesseractLoadError = null;
try {
    tesseractModule = require('tesseract.js');
} catch (e) {
    tesseractLoadError = e;
}

const REQUEST_TIMEOUT_MS = 20_000;
const RECOGNIZE_TIMEOUT_MS = 60_000;

/**
 * Strong tokens per task type — words/phrases that typically appear
 * on the *completed* version of the action ("Subscribed", "Following"
 * pill, etc).  These are weighted lower than admin-defined keywords
 * so the operator stays in control.
 */
const TYPE_HINTS = {
    youtube_subscribe: ['subscribed', 'subscribe', 'bell', 'notifications', 'youtube'],
    instagram_follow:  ['following', 'followers', 'instagram', 'message'],
    twitter_follow:    ['following', 'follow', 'twitter', 'x.com'],
    tiktok_follow:     ['following', 'follow', 'tiktok', 'fyp'],
    discord_join:      ['discord', 'members', 'channels', 'server', 'voice'],
    website_signup:    ['account', 'dashboard', 'welcome', 'profile', 'logout', 'sign out'],
    custom:            []
};

const LANGS = (process.env.TESSERACT_LANGS || 'eng').trim();

// Cache trained-data files locally so we don't re-download on every
// process start — same pattern as the existing .tts-cache directory.
const CACHE_DIR = path.resolve(process.cwd(), '.ocr-cache');

/**
 * Tesseract.js workers are expensive to spin up (~hundreds of ms +
 * downloading language data on first run), so we keep a single shared
 * worker and serialise recognise() calls through it.  The worker is
 * created lazily on first use.
 */
let workerPromise = null;
let recognizeQueue = Promise.resolve();

async function getWorker() {
    if (!tesseractModule) return null;
    if (workerPromise) return workerPromise;

    workerPromise = (async () => {
        const worker = await tesseractModule.createWorker(LANGS, 1, {
            cachePath:    CACHE_DIR,
            cacheMethod:  'refresh',
            gzip:         true,
            logger:       () => {},   // silence per-page progress noise
            errorHandler: (err) => log.debug(`[ScreenshotVerify/OCR] worker: ${err?.message || err}`)
        });
        return worker;
    })().catch(err => {
        // Reset so a future call can retry (e.g. transient network blip
        // while downloading language data).
        workerPromise = null;
        throw err;
    });

    return workerPromise;
}

function fetchImageBuffer(url) {
    return new Promise((resolve, reject) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
        fetch(url, { signal: ctrl.signal })
            .then(async res => {
                clearTimeout(timer);
                if (!res.ok) return reject(new Error(`HTTP ${res.status}`));
                const ab = await res.arrayBuffer();
                resolve(Buffer.from(ab));
            })
            .catch(err => {
                clearTimeout(timer);
                reject(err);
            });
    });
}

function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        promise.then(
            v => { clearTimeout(t); resolve(v); },
            e => { clearTimeout(t); reject(e); }
        );
    });
}

/**
 * Run an OCR job through the shared worker, serialising calls so we
 * never have two recognise() calls hitting the same WASM instance at
 * once (which would deadlock the worker).
 */
async function recognizeBuffer(buffer) {
    const worker = await getWorker();
    if (!worker) throw new Error('OCR worker unavailable');

    const job = recognizeQueue.then(() =>
        withTimeout(worker.recognize(buffer), RECOGNIZE_TIMEOUT_MS, 'OCR recognize')
    );
    // Keep the chain alive even on failure so the *next* job still runs.
    recognizeQueue = job.then(() => undefined, () => undefined);
    return job;
}

/**
 * Lower-case + collapse whitespace so token matching is stable across
 * line breaks and weird Tesseract spacing.
 */
function normalize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Pull the most useful tokens out of a target string. We strip leading
 * @, http(s)://, www., trailing slashes, and split on dots so that e.g.
 * "@xnico.bot" yields ["xnico.bot", "xnico", "bot"] and a substring
 * match in OCR text wins regardless of the exact form on screen.
 */
function tokensFromTarget(target) {
    if (!target) return [];
    const t = String(target).trim().toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/[\s,;]+/g, ' ')
        .replace(/[/]+$/, '');
    const out = new Set();
    if (t.length >= 3) out.add(t);
    for (const part of t.split(/[\s/]/)) {
        const stripped = part.replace(/^@+/, '').trim();
        if (stripped.length >= 3) out.add(stripped);
        for (const dot of stripped.split('.')) {
            if (dot.length >= 4) out.add(dot);
        }
    }
    return Array.from(out);
}

function tokenMatch(haystack, token) {
    if (!token) return false;
    const t = token.toLowerCase().trim();
    if (t.length < 2) return false;
    return haystack.includes(t);
}

/**
 * Score a single task against the extracted OCR text.  Score is
 * normalised to 0-100; the breakdown is preserved so the reasoning
 * string can explain *why* it scored what it did.
 */
function scoreTask(task, text) {
    const userKeywords = (task.keywords || [])
        .map(k => String(k || '').toLowerCase().trim())
        .filter(Boolean);

    const targetTokens = tokensFromTarget(task.target);
    const typeHints    = TYPE_HINTS[task.type] || [];

    let userHits = 0;
    for (const kw of userKeywords)   if (tokenMatch(text, kw))  userHits++;

    let targetHits = 0;
    for (const tk of targetTokens)   if (tokenMatch(text, tk))  targetHits++;

    let typeHits = 0;
    for (const th of typeHints)      if (tokenMatch(text, th))  typeHits++;

    // Weighted score. Admin keywords matter most; target is highest
    // weight per token (channel/handle on screen is the strongest
    // signal); type hints fill in the gap when no keywords were set.
    const userScore   = userKeywords.length ? (userHits / userKeywords.length) * 50 : 0;
    const targetScore = targetTokens.length ? Math.min(targetHits, targetTokens.length) / Math.max(targetTokens.length, 1) * 35 : 0;
    const typeScore   = typeHints.length    ? Math.min(typeHits, 3) / 3 * 25 : 0;

    // Bonus if both a target token AND a type hint matched — that's a
    // very strong "you're looking at the right page in the right state"
    // signal (e.g. saw "@xnico" + "subscribed").
    const synergy = (targetHits > 0 && typeHits > 0) ? 15 : 0;

    let total = userScore + targetScore + typeScore + synergy;

    // Penalty if the only matches are type hints with zero target
    // tokens — likely the user uploaded the *wrong* channel / page.
    if (targetTokens.length > 0 && targetHits === 0) total -= 15;

    // Clamp to 0-100 so downstream confidence comparisons stay sane.
    if (total < 0)   total = 0;
    if (total > 100) total = 100;
    total = Math.round(total);

    return {
        score: total,
        userHits, userKeywordCount: userKeywords.length,
        targetHits, targetTokenCount: targetTokens.length,
        typeHits, typeHintCount: typeHints.length,
        synergy: synergy > 0
    };
}

function buildReasoning(task, breakdown, text) {
    const parts = [];
    if (breakdown.targetHits > 0) {
        parts.push(`target match (${breakdown.targetHits}/${breakdown.targetTokenCount})`);
    } else if (breakdown.targetTokenCount > 0) {
        parts.push(`target NOT found on screen`);
    }
    if (breakdown.userHits > 0) {
        parts.push(`${breakdown.userHits}/${breakdown.userKeywordCount} keywords matched`);
    }
    if (breakdown.typeHits > 0) {
        parts.push(`${breakdown.typeHits} state hint${breakdown.typeHits === 1 ? '' : 's'} matched`);
    }
    if (breakdown.synergy) parts.push('target + state visible');

    if (parts.length === 0) {
        return `OCR found no recognisable evidence for "${task.name}".`;
    }
    return `OCR: ${parts.join(' · ')}.`;
}

/**
 * Run OCR on the screenshot and rank the configured tasks against the
 * extracted text.  Returns the same shape as the AI verifier so the
 * manager can call them interchangeably.
 *
 * @param {object} opts
 * @param {string} opts.imageUrl        Discord-CDN URL of the screenshot
 * @param {Array}  opts.tasks           guild's task list
 * @param {number} [opts.threshold=60]  minimum score to count as a match
 * @returns {Promise<object|null>}      decision or null on hard failure
 */
async function detectScreenshot({ imageUrl, tasks, threshold = 60 }) {
    if (!imageUrl || !Array.isArray(tasks) || tasks.length === 0) return null;

    if (!tesseractModule) {
        log.debug(`[ScreenshotVerify/OCR] tesseract.js not installed — ${tesseractLoadError?.message || 'load failed'}`);
        return null;
    }

    let buffer;
    try {
        buffer = await fetchImageBuffer(imageUrl);
    } catch (err) {
        log.warning(`[ScreenshotVerify/OCR] could not download image: ${err.message}`);
        return null;
    }

    if (!Buffer.isBuffer(buffer)) {
        log.warning('[ScreenshotVerify/OCR] image fetch did not return a Buffer — refusing to recognize.');
        return null;
    }

    let rawText;
    try {
        const result = await recognizeBuffer(buffer);
        rawText = result?.data?.text || '';
    } catch (err) {
        const msg = String(err?.message || err);
        log.warning(`[ScreenshotVerify/OCR] error: ${msg.slice(0, 200)}`);
        return null;
    }

    const text = normalize(rawText);

    // Score every task; pick the best one.
    let best = null;
    for (const t of tasks) {
        const breakdown = scoreTask(t, text);
        if (!best || breakdown.score > best.score) {
            best = { task: t, ...breakdown };
        }
    }
    if (!best) return null;

    const matched = best.score >= threshold && (
        // require *some* concrete evidence — not just synergy / type hints alone
        best.targetHits > 0 || best.userHits > 0 || best.typeHits >= 2
    );

    return {
        matched,
        taskId:     matched ? best.task.id : null,
        confidence: best.score,
        reasoning:  buildReasoning(best.task, best, text),
        model:      'tesseract',
        raw:        text.slice(0, 1500)
    };
}

/**
 * Cheap probe used by the setup panel to show whether OCR is currently
 * usable on this host.  With Tesseract.js we just confirm the module
 * loaded and a worker can be created — there's no external binary to
 * check for any more.
 */
async function isAvailable() {
    if (!tesseractModule) return false;
    try {
        await getWorker();
        return true;
    } catch {
        return false;
    }
}

/**
 * Best-effort cleanup. Useful from process-shutdown handlers; safe to
 * call when no worker has been created yet.
 */
async function shutdown() {
    if (!workerPromise) return;
    try {
        const worker = await workerPromise;
        if (worker && typeof worker.terminate === 'function') {
            await worker.terminate();
        }
    } catch {
        // ignore — we're shutting down
    } finally {
        workerPromise = null;
    }
}

module.exports = {
    detectScreenshot,
    isAvailable,
    shutdown,
    OCR_MODEL: 'tesseract',
    TYPE_HINTS
};
