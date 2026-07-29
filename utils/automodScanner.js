'use strict';

/**
 * automodScanner — the single implementation of the AutoMod filter chain.
 *
 * ═══ WHY THIS EXISTS ═══
 * The filter chain was implemented twice: once in index.js's messageCreate
 * handler and again, copy-pasted, in messageUpdate so edited messages could not
 * be used to slip content past the filters.
 *
 * The two copies drifted. When the `aiText` and `aiImage` filters were added,
 * only the messageCreate copy learned about them — so AI moderation (the
 * multilingual slur / NSFW / harassment scanner, and image scanning entirely)
 * could be bypassed completely by posting a harmless message and then editing
 * it to the real payload. Roughly a hundred duplicated lines guaranteed that
 * would happen again on the next filter added.
 *
 * Both paths now call scanMessage(). A new filter is added once, here, and is
 * live on creation and on edit simultaneously.
 *
 * ═══ CONTRACT ═══
 * The scanner is a pure detector: it decides WHAT was violated and returns a
 * list. It never deletes, times out, replies or logs — the caller owns
 * enforcement, because that part is genuinely different between the two paths
 * (an edit has already been seen, message references differ, etc.).
 */

/** Filters that only make sense for a newly posted message. */
const CREATE_ONLY_FILTERS = new Set([
    // Spam is a message-rate limiter keyed on a sliding window. An edit is not
    // a new message, so counting it would let a single edited message trip the
    // limit and would double-count the original post.
    'spam',
]);

/** Severity ranking used to pick which violation's action wins. */
const SEVERITY_ORDER = { warn: 0, delete: 1, timeout: 2, kick: 3, ban: 4 };

const URL_REGEX = /https?:\/\/[^\s<]+|www\.[^\s<]+|[a-zA-Z0-9][-a-zA-Z0-9]*\.(com|net|org|io|gg|tv|me|co|xyz|info|online|site|tech|dev|app|live|pro|cc|ru|cn|tk|ml|ga|cf|gq|pw|top|club|vip|ws|link|click|download|stream|fun|icu|buzz|monster|rest|hair|sbs|cfd)(?:[\/\?#][^\s]*)?/gi;

// Built fresh per call: a /g regex carries lastIndex, and `.test()` on a shared
// instance advances it, so a module-level constant would intermittently miss
// matches on subsequent messages.
const inviteRegex = () => /(discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg|invite\.gg|discord\.me)\/[a-zA-Z0-9-]+/gi;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i;
/** Cap per-message vision API calls. */
const MAX_IMAGES_SCANNED = 3;

function normalizeText(text) {
    try {
        return require('./aiModeration').normalizeText(text) || '';
    } catch {
        return '';
    }
}

const isWordChar = (ch) => !!ch && /[a-z0-9]/i.test(ch);

/**
 * Normalize `content` while remembering where each normalized character came
 * from in the original string.
 *
 * aiModeration.normalizeText folds leetspeak/diacritics and DELETES in-word
 * separators, which is what lets "b.a.d.w.o.r.d" match "badword". The catch is
 * that deleting separators also deletes word boundaries, so a plain
 * `normalized.includes(word)` test — which is what the original code did — has
 * no way to tell "badword" inside "badwordsmith" from a real hit. That is the
 * classic Scunthorpe problem: a "hell" filter would flag "hello" and "shell",
 * and an "ass" filter would flag "class" and "pass".
 *
 * Normalization is character-wise, so building an index map lets us match on the
 * normalized text and then verify the boundaries against the ORIGINAL string.
 *
 * @returns {{norm: string, map: number[]}} map[i] = original index of norm[i]
 */
function buildNormalizedIndex(content) {
    let norm = '';
    const map = [];
    for (let i = 0; i < content.length; i++) {
        const piece = normalizeText(content[i]);
        for (const ch of piece) {
            norm += ch;
            map.push(i);
        }
    }
    return { norm, map };
}

/**
 * Does `wordNorm` occur in the normalized content as a whole word?
 *
 * A hit counts only when the characters flanking it IN THE ORIGINAL STRING are
 * not word characters, so:
 *   "b.a.d.w.o.r.d here"  -> match   (flanked by start / space)
 *   "b a d w o r d here"  -> match
 *   "my badwordsmith"     -> no match (followed by 's')
 *   "abadword"            -> no match (preceded by 'a')
 */
function normalizedWholeWordHit(content, index, wordNorm) {
    if (!wordNorm || !index.norm) return false;
    let from = 0;
    for (;;) {
        const at = index.norm.indexOf(wordNorm, from);
        if (at === -1) return false;

        const origStart = index.map[at];
        const origEnd = index.map[at + wordNorm.length - 1];
        const before = origStart > 0 ? content[origStart - 1] : '';
        const after = origEnd < content.length - 1 ? content[origEnd + 1] : '';

        if (!isWordChar(before) && !isWordChar(after)) return true;
        from = at + 1; // keep looking; a later occurrence may be a real word
    }
}

/**
 * Is this member exempt from AutoMod in this channel?
 *
 * Previously duplicated too, and the copies disagreed: messageCreate also
 * consulted the shared `ignored-channels` store while messageUpdate only looked
 * at the module's own ignoredChannels list, so a channel ignored globally still
 * had its edits scanned.
 *
 * @param {object} params
 * @param {import('discord.js').GuildMember|null} params.member
 * @param {string} params.channelId
 * @param {object} params.config      automod guild config
 * @param {string[]} [params.globallyIgnoredChannels]
 */
function isExempt({ member, channelId, config, globallyIgnoredChannels }) {
    if (!config) return true;
    if (config.ignoredRoles?.some(roleId => member?.roles?.cache?.has(roleId))) return true;
    if (config.ignoredChannels?.includes(channelId)) return true;
    if (Array.isArray(globallyIgnoredChannels) && globallyIgnoredChannels.includes(channelId)) return true;
    if (member?.permissions?.has?.('Administrator')) return true;
    if (config.bypassRoleId && member?.roles?.cache?.has(config.bypassRoleId)) return true;
    return false;
}

/* ───────────────────────── individual filters ───────────────────────── */

function checkBadWords(content, contentLower, config) {
    const cfg = config.badWords;
    if (!cfg?.enabled || !cfg.words?.length) return null;

    // Built once per message rather than per word.
    const index = buildNormalizedIndex(content);

    for (const word of cfg.words) {
        const wordLower = String(word).toLowerCase().trim();
        if (!wordLower) continue;
        try {
            // Literal word-boundary match on the raw text.
            const escaped = wordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:[^a-zA-Z0-9]|$)`, 'i');
            // Obfuscation-tolerant match, still boundary-checked (see
            // normalizedWholeWordHit — the previous unbounded includes() flagged
            // "badwordsmith" for a "badword" filter).
            const normHit = normalizedWholeWordHit(content, index, normalizeText(wordLower));

            if (regex.test(contentLower) || contentLower === wordLower || normHit) {
                return { filter: 'badWords', action: cfg.action || 'delete', reason: `Bad word detected: ||${wordLower}||` };
            }
        } catch {
            // Invalid regex — fall back to a plain substring match.
            if (contentLower.includes(wordLower)) {
                return { filter: 'badWords', action: cfg.action || 'delete', reason: 'Bad word detected' };
            }
        }
    }
    return null;
}

function checkSpam(message, config, guildId, spamTracker) {
    const cfg = config.spam;
    if (!cfg?.enabled || !spamTracker) return null;

    const key = `${guildId}-${message.author.id}`;
    const now = Date.now();
    const timeWindow = cfg.timeWindow || 5000;
    const messageLimit = cfg.messageLimit || 5;

    if (!spamTracker.has(key)) spamTracker.set(key, []);
    const userMessages = spamTracker.get(key);
    userMessages.push(now);

    const recent = userMessages.filter(t => now - t < timeWindow);
    spamTracker.set(key, recent);

    // Bound the tracker so a busy guild can't grow it without limit.
    if (spamTracker.size > 500) {
        const cleanupNow = Date.now();
        for (const [k, msgs] of spamTracker.entries()) {
            const still = msgs.filter(t => cleanupNow - t < 30000);
            if (still.length === 0) spamTracker.delete(k);
            else spamTracker.set(k, still);
        }
    }

    if (recent.length >= messageLimit) {
        return {
            filter: 'spam',
            action: cfg.action || 'timeout',
            reason: `Spam detected (${recent.length} msgs in ${timeWindow / 1000}s)`,
        };
    }
    return null;
}

function checkLinks(content, config) {
    const cfg = config.links;
    if (!cfg?.enabled) return null;

    const urls = content.match(URL_REGEX);
    if (!urls?.length) return null;

    const whitelist = cfg.whitelist || [];
    let blocked = false;
    if (whitelist.length === 0) {
        blocked = true; // no whitelist means block every link
    } else {
        for (const url of urls) {
            const urlLower = url.toLowerCase();
            const allowed = whitelist.some(d => urlLower.includes(String(d).toLowerCase().trim()));
            if (!allowed) { blocked = true; break; }
        }
    }
    return blocked
        ? { filter: 'links', action: cfg.action || 'delete', reason: 'Unauthorized link detected' }
        : null;
}

function checkInvites(content, config) {
    const cfg = config.invites;
    if (!cfg?.enabled) return null;
    return inviteRegex().test(content)
        ? { filter: 'invites', action: cfg.action || 'delete', reason: 'Discord invite link detected' }
        : null;
}

function checkMassMention(message, config) {
    const cfg = config.massMention;
    if (!cfg?.enabled) return null;

    const limit = cfg.limit || 5;
    const total = (message.mentions?.users?.size || 0)
        + (message.mentions?.roles?.size || 0)
        + (message.mentions?.everyone ? 1 : 0);

    return total >= limit
        ? { filter: 'massMention', action: cfg.action || 'delete', reason: `Mass mention detected (${total} mentions)` }
        : null;
}

function checkCaps(content, config) {
    const cfg = config.caps;
    if (!cfg?.enabled) return null;

    const minLength = cfg.minLength || 10;
    const percentage = cfg.percentage || 70;
    const letters = content.replace(/[^a-zA-Z]/g, '');
    if (letters.length < minLength) return null;

    const upper = (content.match(/[A-Z]/g) || []).length;
    const ratio = (upper / letters.length) * 100;
    return ratio >= percentage
        ? { filter: 'caps', action: cfg.action || 'delete', reason: `Excessive caps (${Math.round(ratio)}%)` }
        : null;
}

async function checkAiText(content, config, guildId, log) {
    const cfg = config.aiText;
    if (!cfg?.enabled || !content || content.trim().length < 3) return null;
    try {
        const aiMod = require('./aiModeration');
        if (!aiMod.hasApiKey()) return null;
        const result = await aiMod.analyzeText(content, { guildId });
        if (!result?.flagged) return null;

        const rank = { low: 1, medium: 2, high: 3 };
        const minSev = cfg.minSeverity || 'medium';
        if ((rank[result.severity] || 2) < (rank[minSev] || 2)) return null;

        const cats = result.categories?.length ? result.categories.join(', ') : 'inappropriate content';
        return {
            filter: 'aiText',
            action: cfg.action || 'delete',
            reason: `AI flagged ${cats} (${result.severity})${result.reason ? ': ' + result.reason : ''}`,
        };
    } catch (e) {
        log?.debug?.('[AutoMod] AI text scan error: ' + e.message);
        return null;
    }
}

async function checkAiImage(message, config, guildId, log) {
    const cfg = config.aiImage;
    if (!cfg?.enabled || !(message.attachments?.size > 0)) return null;
    try {
        const aiMod = require('./aiModeration');
        if (!aiMod.hasApiKey()) return null;

        const images = [...message.attachments.values()]
            .filter(a => (a.contentType && a.contentType.startsWith('image/')) || IMAGE_EXT.test(a.name || ''))
            .slice(0, MAX_IMAGES_SCANNED);

        for (const img of images) {
            const result = await aiMod.analyzeImage(img.url, { guildId });
            if (result?.flagged) {
                return {
                    filter: 'aiImage',
                    action: cfg.action || 'delete',
                    reason: `AI flagged ${result.category} image (${result.confidence}%)${result.reason ? ': ' + result.reason : ''}`,
                };
            }
        }
        return null;
    } catch (e) {
        log?.debug?.('[AutoMod] AI image scan error: ' + e.message);
        return null;
    }
}

/* ───────────────────────────── public API ───────────────────────────── */

/**
 * Run every enabled filter against a message.
 *
 * Every filter runs — the chain deliberately does not short-circuit on the
 * first hit, matching Discord's native AutoMod, so the log can report
 * everything that was wrong rather than just the first thing noticed.
 *
 * @param {import('discord.js').Message} message
 * @param {object} config     the guild's automod config (defaults already merged)
 * @param {object} [opts]
 * @param {'create'|'edit'} [opts.mode='create']
 * @param {string}  [opts.guildId]
 * @param {Map}     [opts.spamTracker]  required for the spam filter
 * @param {object}  [opts.log]
 * @param {boolean} [opts.hasScannableAttachment]
 * @returns {Promise<Array<{filter:string,action:string,reason:string}>>}
 */
async function scanMessage(message, config, opts = {}) {
    const mode = opts.mode === 'edit' ? 'edit' : 'create';
    const guildId = opts.guildId || message.guild?.id;
    const log = opts.log;
    const content = message.content || '';
    const contentLower = content.toLowerCase();

    const violations = [];
    const applies = (filter) => !(mode === 'edit' && CREATE_ONLY_FILTERS.has(filter));

    const push = (v) => {
        if (!v) return;
        // Mark edit-originated hits so moderators can tell from the log that the
        // content arrived via an edit rather than the original post.
        if (mode === 'edit') v.reason = `${v.reason} (edited)`;
        violations.push(v);
    };

    if (applies('badWords')) push(checkBadWords(content, contentLower, config));
    if (applies('spam')) push(checkSpam(message, config, guildId, opts.spamTracker));
    if (applies('links')) push(checkLinks(content, config));
    if (applies('invites')) push(checkInvites(content, config));
    if (applies('massMention')) push(checkMassMention(message, config));
    if (applies('caps')) push(checkCaps(content, config));

    // AI scans are last: they are the only network calls in the chain, and
    // running them after the cheap filters keeps quota and latency down.
    if (applies('aiText')) push(await checkAiText(content, config, guildId, log));
    if (applies('aiImage')) push(await checkAiImage(message, config, guildId, log));

    return violations;
}

/**
 * Pick the violation whose action should be enforced (the most severe), and
 * summarise every reason for the log.
 *
 * @param {Array<{filter:string,action:string,reason:string}>} violations
 * @returns {{primary:object, action:string, allReasons:string, filters:string[]}|null}
 */
function resolveAction(violations) {
    if (!violations?.length) return null;
    const sorted = [...violations].sort(
        (a, b) => (SEVERITY_ORDER[b.action] || 0) - (SEVERITY_ORDER[a.action] || 0)
    );
    const primary = sorted[0];
    return {
        primary,
        action: primary.action,
        allReasons: sorted.map(v => v.reason).join(' | '),
        filters: sorted.map(v => v.filter),
    };
}

module.exports = {
    scanMessage,
    resolveAction,
    isExempt,
    SEVERITY_ORDER,
    CREATE_ONLY_FILTERS,
    // Exported for tests.
    _filters: { checkBadWords, checkSpam, checkLinks, checkInvites, checkMassMention, checkCaps, checkAiText, checkAiImage },
};
