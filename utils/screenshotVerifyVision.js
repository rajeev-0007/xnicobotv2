'use strict';

/**
 * Screenshot Verification Vision Client
 * ──────────────────────────────────────────────────────────────────
 * Calls a vision-capable LLM (Groq's `meta-llama/llama-4-scout-17b-...`)
 * to classify a submitted screenshot against the guild's configured
 * tasks. Returns a structured decision the manager can act on.
 *
 * Output shape:
 *   {
 *     matched:    boolean,    // did *any* task match
 *     taskId:     string|null,
 *     confidence: number,     // 0-100
 *     reasoning:  string,     // short human-readable rationale
 *     model:      string,     // model id used
 *     raw:        string|null // raw model output for debugging
 *   }
 *
 * Failure modes:
 *   - GROQ_API_KEY missing            → returns null (manager will queue for review)
 *   - HTTP / timeout error            → returns null
 *   - JSON parse fail / invalid shape → returns { matched: false, ... }
 */

const log = require('./logger-styled');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const REQUEST_TIMEOUT_MS = 25_000;

function buildSystemPrompt() {
    return [
        'You are a strict, professional screenshot verifier for a Discord server.',
        'You receive ONE image plus a list of verification tasks the server expects.',
        'Each task has an id, name, type (e.g. youtube_subscribe, instagram_follow, twitter_follow, tiktok_follow, discord_join, website_signup, custom), a target (channel/handle/URL), and optional keywords.',
        '',
        'Your job:',
        '1. Decide if the screenshot is genuine evidence that the user completed exactly one of these tasks.',
        '2. Look for clear visual proof: e.g. a YouTube "Subscribed" button (gray, with bell icon), an Instagram "Following" pill, an X/Twitter "Following" button, a TikTok "Following" state, server membership UI, or a logged-in dashboard for a website.',
        '3. Verify the target matches when possible (channel name, @handle, URL on screen).',
        '4. Reject if the screenshot is unrelated, blank, a meme, a photo of an unrelated screen, the unverified state ("Subscribe" / "Follow" — i.e. *not yet* completed), or appears edited / impossible to verify.',
        '',
        'Confidence guidelines (0-100):',
        '  90-100: Clear match, target visible, completed state visible.',
        '  70-89:  Likely match, completed state visible but target name partially obscured / unclear.',
        '  50-69:  Ambiguous, partial evidence.',
        '  0-49:   No real evidence or wrong state.',
        '',
        'Respond with STRICT JSON only — no commentary, no markdown, no code fences. Schema:',
        '{"matched": boolean, "taskId": string|null, "confidence": integer, "reasoning": string}',
        '',
        '`matched` is true only when confidence ≥ 50 and you can name a single matching task.',
        '`reasoning` must be ≤ 280 characters, describe what you saw, and be safe to show users (no slurs, no PII).'
    ].join('\n');
}

function buildUserPrompt(tasks) {
    const list = tasks.map((t, i) => {
        const lines = [
            `${i + 1}. id: ${t.id}`,
            `   name: ${t.name}`,
            `   type: ${t.type}`,
            t.target      ? `   target: ${t.target}`         : null,
            t.description ? `   description: ${t.description}` : null,
            (t.keywords && t.keywords.length)
                ? `   keywords: ${t.keywords.join(', ')}`
                : null
        ].filter(Boolean).join('\n');
        return lines;
    }).join('\n\n');

    return [
        'Verify the attached screenshot against these tasks:',
        '',
        list,
        '',
        'Return JSON only.'
    ].join('\n');
}

/**
 * Best-effort parser for the model output. Strips code fences if the
 * model ignored instructions and shoehorns the JSON anyway.
 */
function parseModelJson(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let trimmed = raw.trim();

    // Strip ```json … ``` fences
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) trimmed = fence[1].trim();

    // If the model added prose, grab the first {…} block
    if (!trimmed.startsWith('{')) {
        const open = trimmed.indexOf('{');
        const close = trimmed.lastIndexOf('}');
        if (open >= 0 && close > open) trimmed = trimmed.slice(open, close + 1);
    }

    try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function clampConfidence(n) {
    if (typeof n !== 'number' || isNaN(n)) return 0;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return Math.round(n);
}

function sanitizeReasoning(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/\s+/g, ' ').trim().slice(0, 280);
}

/**
 * Run vision classification.
 *
 * @param {object} opts
 * @param {string} opts.imageUrl                URL Discord-CDN serves the screenshot at
 * @param {Array}  opts.tasks                   list of task objects (from guild config)
 * @returns {Promise<object|null>}
 */
async function detectScreenshot({ imageUrl, tasks }) {
    if (!imageUrl || !Array.isArray(tasks) || tasks.length === 0) return null;

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey.length < 10) {
        log.debug('[ScreenshotVerify] GROQ_API_KEY missing — falling back to manual review');
        return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const body = {
            model: VISION_MODEL,
            temperature: 0.0,
            max_tokens: 400,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: buildSystemPrompt() },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: buildUserPrompt(tasks) },
                        { type: 'image_url', image_url: { url: imageUrl } }
                    ]
                }
            ]
        };

        const response = await fetch(GROQ_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            log.warning(`[ScreenshotVerify] Vision API ${response.status}: ${text.slice(0, 200)}`);
            return null;
        }

        const json = await response.json();
        const raw  = json?.choices?.[0]?.message?.content;
        const parsed = parseModelJson(raw);

        if (!parsed) {
            return {
                matched:    false,
                taskId:     null,
                confidence: 0,
                reasoning:  'Could not interpret AI response.',
                model:      VISION_MODEL,
                raw:        raw || null
            };
        }

        // Validate that taskId, if present, refers to a real task
        const validIds = new Set(tasks.map(t => t.id));
        const claimedTaskId = parsed.taskId && validIds.has(parsed.taskId) ? parsed.taskId : null;

        const confidence = clampConfidence(parsed.confidence);
        const matched    = !!parsed.matched && !!claimedTaskId && confidence >= 50;

        return {
            matched,
            taskId:     matched ? claimedTaskId : null,
            confidence,
            reasoning:  sanitizeReasoning(parsed.reasoning),
            model:      VISION_MODEL,
            raw:        null
        };
    } catch (err) {
        if (err.name === 'AbortError') {
            log.warning('[ScreenshotVerify] Vision API timed out');
        } else {
            log.warning(`[ScreenshotVerify] Vision API error: ${err.message}`);
        }
        return null;
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    detectScreenshot,
    VISION_MODEL
};
