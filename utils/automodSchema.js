'use strict';

/**
 * automodSchema — the single source of truth for AutoMod filters.
 *
 * ═══ WHY THIS EXISTS ═══
 * The filter list was re-declared SIX times inside utils/panels/automodPanel.js
 * alone (getDefaultConfig, the getGuildConfig merge, the activeCount array, the
 * enabledFilters array, the toggle-menu options, the configure-menu options),
 * plus again in commands/utility/automod.js, dashboard/server.js and
 * dashboard/public/modules.js. The configure menu even used a *different*
 * spelling for the same filters (`badwords`, `mentions`, `aitext`, `aiimage`
 * against config keys `badWords`, `massMention`, `aiText`, `aiImage`), an alias
 * layer kept in sync by hand.
 *
 * That is the same failure mode that let the `aiText`/`aiImage` filters be
 * enforced on new messages but not on edits: a list that must be updated in N
 * places will eventually be updated in N-1.
 *
 * ═══ WHICH ENGINE ENFORCES WHAT ═══
 * `engine` is not cosmetic. Filters differ in where they actually run:
 *   'bot'     — enforced by utils/automodScanner on messageCreate/messageUpdate
 *   'discord' — synced to Discord's native AutoMod by utils/automodSync and
 *               enforced by Discord before the message ever reaches the bot
 *   'both'    — has a bot-side filter AND a native rule
 * The panel surfaces this so an admin can tell why a filter behaves the way it
 * does (native rules block pre-publish; bot rules delete after the fact).
 */

/** Actions the bot-side enforcement understands, in ascending severity. */
const ACTION_LABELS = {
    warn: 'Warn',
    delete: 'Delete',
    timeout: 'Timeout',
    kick: 'Kick',
    ban: 'Ban',
};
const ALL_ACTIONS = Object.keys(ACTION_LABELS);

/** Selectable values for numeric settings — avoids a modal for simple numbers. */
const CHOICES = {
    messageLimit: [3, 4, 5, 6, 8, 10, 12, 15],
    timeWindow: [3_000, 5_000, 10_000, 15_000, 30_000, 60_000],
    mentionLimit: [3, 4, 5, 6, 8, 10, 15, 20],
    capsPercentage: [50, 60, 70, 80, 90],
    capsMinLength: [5, 10, 15, 20, 30],
    minSeverity: ['low', 'medium', 'high'],
};

/**
 * Field descriptors. `kind` drives which control the panel renders:
 *   'choice' — a select menu built from CHOICES[choices]
 *   'list'   — a comma/newline separated list, edited through a modal
 */
const FIELDS = {
    words: { kind: 'list', label: 'Word list', placeholder: 'word1, word2, word3', summary: (v) => `${v?.length || 0} words` },
    whitelist: { kind: 'list', label: 'Allowed domains', placeholder: 'youtube.com, github.com', summary: (v) => `${v?.length || 0} allowed` },
    messageLimit: { kind: 'choice', choices: 'messageLimit', label: 'Message limit', format: (v) => `${v} msgs` },
    timeWindow: { kind: 'choice', choices: 'timeWindow', label: 'Time window', format: (v) => `${Math.round(v / 1000)}s` },
    limit: { kind: 'choice', choices: 'mentionLimit', label: 'Mention limit', format: (v) => `${v}+ mentions` },
    percentage: { kind: 'choice', choices: 'capsPercentage', label: 'Caps threshold', format: (v) => `${v}%` },
    minLength: { kind: 'choice', choices: 'capsMinLength', label: 'Minimum length', format: (v) => `${v} chars` },
    minSeverity: { kind: 'choice', choices: 'minSeverity', label: 'Minimum severity', format: (v) => String(v) },
};

/** Ordered filter definitions. Order drives panel display order. */
const FILTERS = {
    badWords: {
        label: 'Bad Words',
        description: 'Blocks a custom word list, tolerant of leetspeak and spacing.',
        engine: 'both',
        fields: ['words'],
        defaults: { enabled: false, words: [], action: 'delete' },
    },
    spam: {
        label: 'Anti-Spam',
        description: 'Blocks message flooding within a rolling window.',
        engine: 'both',
        fields: ['messageLimit', 'timeWindow'],
        defaults: { enabled: false, messageLimit: 5, timeWindow: 5_000, action: 'timeout' },
    },
    links: {
        label: 'Link Filter',
        description: 'Blocks links, with an optional allowed-domain list.',
        engine: 'bot',
        fields: ['whitelist'],
        defaults: { enabled: false, action: 'delete', whitelist: [] },
    },
    invites: {
        label: 'Invite Blocker',
        description: 'Blocks Discord server invites.',
        engine: 'both',
        fields: [],
        defaults: { enabled: false, action: 'delete' },
    },
    massMention: {
        label: 'Mass Mentions',
        description: 'Blocks messages that mention many users or roles at once.',
        engine: 'both',
        fields: ['limit'],
        defaults: { enabled: false, limit: 5, action: 'delete' },
    },
    caps: {
        label: 'Caps Lock',
        description: 'Blocks messages that are mostly uppercase.',
        engine: 'bot',
        fields: ['percentage', 'minLength'],
        defaults: { enabled: false, percentage: 70, minLength: 10, action: 'delete' },
    },
    profanity: {
        label: 'Profanity',
        description: 'Discord\'s built-in profanity preset.',
        engine: 'discord',
        fields: [],
        defaults: { enabled: false, action: 'delete' },
    },
    sexualContent: {
        label: 'Sexual Content',
        description: 'Discord\'s built-in sexual-content preset.',
        engine: 'discord',
        fields: [],
        defaults: { enabled: false, action: 'delete' },
    },
    slurs: {
        label: 'Slurs',
        description: 'Discord\'s built-in slur preset.',
        engine: 'discord',
        fields: [],
        defaults: { enabled: false, action: 'delete' },
    },
    aiText: {
        label: 'AI Text Scan',
        description: 'Detects NSFW, slurs, hate and harassment in any language.',
        engine: 'bot',
        fields: ['minSeverity'],
        defaults: { enabled: false, action: 'delete', minSeverity: 'medium' },
        needsApiKey: true,
    },
    aiImage: {
        label: 'AI Image Scan',
        description: 'Detects NSFW, explicit and gore images in attachments.',
        engine: 'bot',
        fields: [],
        defaults: { enabled: false, action: 'delete' },
        needsApiKey: true,
    },
};

const FILTER_KEYS = Object.keys(FILTERS);

const FILTER_LABELS = Object.fromEntries(FILTER_KEYS.map(k => [k, FILTERS[k].label]));

/** Every filter accepts the same action set; kept as a map for symmetry. */
const ACTIONS_FOR = Object.fromEntries(FILTER_KEYS.map(k => [k, ALL_ACTIONS]));

/** Where a filter is enforced, for display. */
const ENGINE_LABELS = {
    bot: 'bot-side',
    discord: 'Discord native',
    both: 'bot + Discord',
};

/** The ONLY status emojis these panels may use. */
const STATUS = {
    ON: '<:Toggleon:1521227758011809964>',
    OFF: '<:Toggleoff:1521227763816595559>',
};
const toggle = (on) => (on ? STATUS.ON : STATUS.OFF);

function isValidAction(action) {
    return ALL_ACTIONS.includes(action);
}

function getDefaultConfig() {
    const cfg = {
        enabled: false,
        logChannel: null,
        ignoredRoles: [],
        ignoredChannels: [],
        bypassRoleId: null,
    };
    for (const key of FILTER_KEYS) {
        cfg[key] = { ...FILTERS[key].defaults };
    }
    return cfg;
}

/**
 * Merge a stored guild config over the defaults.
 *
 * Same correctness requirement as the anti-nuke schema: rows written before a
 * filter existed have no key for it, and the scanner reads
 * `config.<filter>?.enabled`, so an un-merged read silently disables new
 * filters for every existing guild.
 */
function withDefaults(stored) {
    const defaults = getDefaultConfig();
    if (!stored || typeof stored !== 'object') return defaults;

    const merged = { ...defaults, ...stored };
    for (const key of FILTER_KEYS) {
        merged[key] = { ...defaults[key], ...(stored[key] || {}) };
        if (!isValidAction(merged[key].action)) {
            merged[key].action = defaults[key].action;
        }
        // Coerce list fields so a malformed row can't crash `.length` reads.
        for (const field of FILTERS[key].fields) {
            if (FIELDS[field].kind === 'list' && !Array.isArray(merged[key][field])) {
                merged[key][field] = [...(defaults[key][field] || [])];
            }
        }
    }
    if (!Array.isArray(merged.ignoredRoles)) merged.ignoredRoles = [];
    if (!Array.isArray(merged.ignoredChannels)) merged.ignoredChannels = [];
    return merged;
}

/** One-line summary of a filter's settings, e.g. `5 msgs · 5s → Timeout`. */
function describeFilter(cfg, key) {
    const def = FILTERS[key];
    const mod = cfg?.[key] || {};
    const parts = [];
    for (const field of def.fields) {
        const meta = FIELDS[field];
        const value = mod[field];
        parts.push(meta.kind === 'list' ? meta.summary(value) : meta.format(value ?? def.defaults[field]));
    }
    const action = `→ ${ACTION_LABELS[mod.action] || mod.action || '—'}`;
    // The arrow reads as its own clause, so it is appended rather than joined —
    // otherwise a filter with settings renders as "3 words · → Delete".
    return parts.length ? `${parts.join(' · ')} ${action}` : action;
}

/** How many filters are enabled (derived — never a hardcoded /11). */
function countEnabled(cfg) {
    return FILTER_KEYS.filter(k => cfg?.[k]?.enabled).length;
}

/** Parse a user-supplied list field from modal text. */
function parseList(raw) {
    return String(raw || '')
        .split(/[,\n]/)
        .map(s => s.trim())
        .filter(Boolean)
        .filter((v, i, a) => a.indexOf(v) === i); // de-duplicate
}

module.exports = {
    FILTERS,
    FILTER_KEYS,
    FILTER_LABELS,
    FIELDS,
    CHOICES,
    ACTION_LABELS,
    ALL_ACTIONS,
    ACTIONS_FOR,
    ENGINE_LABELS,
    STATUS,
    toggle,
    isValidAction,
    getDefaultConfig,
    withDefaults,
    describeFilter,
    countEnabled,
    parseList,
};
