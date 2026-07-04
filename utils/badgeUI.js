/**
 * utils/badgeUI.js — Shared helpers for the owner badge command suite.
 *
 * DESIGN NOTE (FEAT-003):
 *   The validator helpers (parseHexColor, validateBadgeId, validateImageUrl)
 *   are pure JS and must remain require-able WITHOUT pulling in discord.js.
 *   The smoke test at .agents/tasks/.../scripts/smoke-badges.js requires this
 *   module to call only the validators, and the sandbox does not have
 *   node_modules installed, so any top-level `require('discord.js')` would
 *   crash the smoke test.
 *
 *   To keep this safe, discord.js is required LAZILY inside the container
 *   builders below — CommonJS allows mid-file `require()`. As long as
 *   nothing at the top of this file touches discord.js, importing this
 *   module is free of native-module side effects.
 */

'use strict';

// ── Constants ────────────────────────────────────────────────────────────

const BADGE_ICONS = {
    Cancel:      '<:Cancel:1521227723916181644>',
    Checkedbox:  '<:Checkedbox:1521227734943269077>',
    Sandwatch:   '<:Lightning:1521227915537285150>',
    Award:       '<:Award:1521228119640375336>',
    Trash:       '<:Trash:1521227750420254820>',
    Settings:    '<:Settings:1521227767780343879>',
    Edit:        '<:Edit:1521227886634205298>',
    Eye:         '<:Eye:1521227940480815156>',
    Palette:     '<:Palette:1521227950601539755>',
    Picture:     '<:Picture:1521227954191995024>',
    Info:        '<:Infotriangle:1521227710381428926>',
    Correct:     '<:Checkedbox:1521227734943269077>'
};

const DEFAULT_ACCENT = 0xCAD7E6;
const ERROR_ACCENT   = 0xED4245;
const FALLBACK_HEX   = '#bcf1e4';

// ── Pure validators (no discord.js dependency) ──────────────────────────

/**
 * Parse a hex color string into a normalized hex + integer color value.
 * @param {string} input
 * @param {string} [fallback] hex used when input is invalid
 * @returns {{ hex: string, value: number }}
 */
function parseHexColor(input, fallback = FALLBACK_HEX) {
    const safeFallback = (typeof fallback === 'string' && /^#[0-9a-fA-F]{6}$/.test(fallback))
        ? fallback.toLowerCase()
        : FALLBACK_HEX;
    let hex = (typeof input === 'string' ? input : '').trim();
    if (!hex.startsWith('#')) hex = `#${hex}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
        hex = safeFallback;
    } else {
        hex = hex.toLowerCase();
    }
    const value = parseInt(hex.slice(1), 16);
    return { hex, value: Number.isFinite(value) ? value : DEFAULT_ACCENT };
}

/**
 * Validate a badge ID. Lowercase letters/digits/hyphens, length 3-32.
 * @param {string} input
 * @returns {{ ok: boolean, value: string, error: string }}
 */
function validateBadgeId(input) {
    if (typeof input !== 'string') {
        return { ok: false, value: '', error: 'Badge ID must be a string.' };
    }
    const value = input.trim().toLowerCase();
    if (value.length < 3 || value.length > 32) {
        return { ok: false, value, error: 'Badge ID must be between 3 and 32 characters.' };
    }
    if (!/^[a-z0-9-]+$/.test(value)) {
        return { ok: false, value, error: 'Badge ID may only contain lowercase letters, digits, and hyphens.' };
    }
    return { ok: true, value, error: '' };
}

/**
 * Validate an image URL. Accepts null/empty (returns ok:true, value:null).
 * Otherwise must be http or https.
 * @param {string|null|undefined} input
 * @returns {{ ok: boolean, value: string|null, error: string }}
 */
function validateImageUrl(input) {
    if (input === null || input === undefined || input === '') {
        return { ok: true, value: null, error: '' };
    }
    if (typeof input !== 'string') {
        return { ok: false, value: null, error: 'Image URL must be a string.' };
    }
    const value = input.trim();
    if (value === '') {
        return { ok: true, value: null, error: '' };
    }
    if (!/^https?:\/\/[^\s]+$/i.test(value)) {
        return { ok: false, value: null, error: 'Image URL must start with http:// or https://.' };
    }
    return { ok: true, value, error: '' };
}

// ── V2 helpers (lazy discord.js loaders) ────────────────────────────────

let _v2Cache = null;
function _loadDiscordV2() {
    if (_v2Cache) return _v2Cache;
    // Lazy require so the validators above remain importable without node_modules.
    const {
        ContainerBuilder,
        TextDisplayBuilder,
        SectionBuilder,
        ThumbnailBuilder,
        SeparatorBuilder,
        SeparatorSpacingSize,
        MessageFlags,
        BaseInteraction
    } = require('discord.js');
    _v2Cache = {
        ContainerBuilder,
        TextDisplayBuilder,
        SectionBuilder,
        ThumbnailBuilder,
        SeparatorBuilder,
        SeparatorSpacingSize,
        MessageFlags,
        BaseInteraction
    };
    return _v2Cache;
}

/**
 * Decide whether a target object is an Interaction or a plain Message.
 * Exported for testability — the smoke harness can verify this without
 * having discord.js installed.
 *
 * The previous heuristic checked `!target.isRepliable`, but
 * `Message#isRepliable` exists as an instance method on the discord.js
 * v14 prototype, so the negation was always falsy for a Message and
 * the panel-refresh path on `interaction.message.edit(...)` fell into
 * the Interaction branch and posted a NEW reply instead of editing.
 *
 * The new discriminant prefers `instanceof BaseInteraction` when
 * discord.js is available, and falls back to a duck-typing check that
 * is genuinely distinct: only Interactions carry a `commandId` /
 * `applicationId` field, never a Message.
 *
 * @param {object} target  Anything with .edit / .reply / interaction-like fields.
 * @returns {boolean} true if target is an Interaction, false if it's a Message-like.
 */
function isInteractionTarget(target) {
    if (!target || typeof target !== 'object') return false;

    // 1) Prefer the strict instanceof check when discord.js is loaded.
    try {
        const { BaseInteraction } = _loadDiscordV2();
        if (BaseInteraction && target instanceof BaseInteraction) return true;
    } catch {
        // discord.js not installed — fall back to duck-typing below.
    }

    // 2) Duck-typing fallback that does NOT rely on `isRepliable` (which
    //    Message also exposes as a prototype method). `commandId` and
    //    `applicationId` are interaction-only own/inherited properties
    //    that are present on every chat-input, button, modal, and
    //    autocomplete interaction; a Message never has them.
    if ('commandId' in target) return true;
    if ('applicationId' in target && typeof target.deferReply === 'function') return true;
    if (typeof target.deferReply === 'function') return true;
    if (typeof target.isAutocomplete === 'function') return true;

    return false;
}

/**
 * Wrap a payload object with the IsComponentsV2 flag, preserving any
 * additional flags the caller already set.
 * @param {object} payload
 * @returns {object}
 */
function withV2(payload = {}) {
    const { MessageFlags } = _loadDiscordV2();
    const incoming = typeof payload.flags === 'number' ? payload.flags : 0;
    return { ...payload, flags: incoming | MessageFlags.IsComponentsV2 };
}

/**
 * Edit a V2 message regardless of source (Message, ButtonInteraction,
 * ModalSubmitInteraction). All paths must include `IsComponentsV2`.
 *
 * @param {object} target          Either a Message or an Interaction.
 * @param {object} payload         Components V2 payload. `flags` is forced.
 * @param {object} [opts]
 * @param {boolean} [opts.useUpdate=false]   If true and target is an interaction,
 *                                           prefer `interaction.update()` over `editReply()`.
 * @returns {Promise<any>}
 */
async function editV2Reply(target, payload, opts = {}) {
    if (!target) throw new Error('editV2Reply: target is required');

    // Compute the merged payload. If discord.js is unavailable (smoke
    // tests), fall back to the integer literal for IsComponentsV2.
    let v2Flag;
    try {
        v2Flag = _loadDiscordV2().MessageFlags.IsComponentsV2;
    } catch {
        v2Flag = 1 << 15; // discord.js v14 IsComponentsV2 = 32768
    }
    const merged = { ...payload, flags: (payload.flags || 0) | v2Flag };

    // Discriminate Message vs Interaction using the dedicated helper.
    // The previous `!target.isRepliable` check was wrong because
    // discord.js v14 Message.prototype.isRepliable exists as a method
    // (function references are truthy), so Messages were misrouted to
    // the Interaction branch and badge-edit panel refreshes posted a
    // new reply instead of editing the panel in place.
    if (!isInteractionTarget(target)) {
        if (typeof target.edit === 'function') {
            return target.edit(merged);
        }
        throw new Error('editV2Reply: target is not an interaction and has no .edit()');
    }

    // Interaction branch
    if (opts.useUpdate && typeof target.update === 'function' && !target.replied) {
        return target.update(merged);
    }
    if (target.deferred || target.replied) {
        return target.editReply(merged);
    }
    if (typeof target.update === 'function' && !target.replied) {
        return target.update(merged);
    }
    return target.reply(merged);
}

/**
 * Build a success container for badge actions.
 *
 * @param {string}  title
 * @param {string}  description
 * @param {object}  [badge]      Badge object (used for accent color + thumbnail fallback)
 * @param {object}  [user]       Discord user (preferred thumbnail source)
 * @param {string}  [accentHex]  Optional accent override
 * @returns {object} ContainerBuilder
 */
function buildSuccessContainer(title, description, badge = null, user = null, accentHex = null) {
    const {
        ContainerBuilder,
        TextDisplayBuilder,
        SectionBuilder,
        ThumbnailBuilder,
        SeparatorBuilder,
        SeparatorSpacingSize
    } = _loadDiscordV2();

    const colorSource = accentHex || (badge && badge.color) || FALLBACK_HEX;
    const { value: accent } = parseHexColor(colorSource, FALLBACK_HEX);

    const heading = `# ${BADGE_ICONS.Checkedbox} ${title}`;
    const thumbUrl = (user && typeof user.displayAvatarURL === 'function')
        ? user.displayAvatarURL({ size: 256 })
        : (badge && badge.imageUrl && /^https?:\/\//i.test(badge.imageUrl) ? badge.imageUrl : null);

    const container = new ContainerBuilder().setAccentColor(accent);

    if (thumbUrl) {
        const section = new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(heading))
            .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: thumbUrl } }));
        container.addSectionComponents(section);
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(heading));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(description));
    return container;
}

/**
 * Build a red error container for badge actions.
 *
 * @param {string} title
 * @param {string} message
 * @returns {object} ContainerBuilder
 */
function buildErrorContainer(title, message) {
    const {
        ContainerBuilder,
        TextDisplayBuilder
    } = _loadDiscordV2();

    const content = `# ${BADGE_ICONS.Cancel} ${title}\n\n${message}`;
    return new ContainerBuilder()
        .setAccentColor(ERROR_ACCENT)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

/**
 * Parse a prefix-style argument list with quoted-string support.
 * Returns the parsed tokens. Quoted segments may use single or double quotes.
 *
 * @param {string[]} args  args array from message handler
 * @returns {string[]}
 */
function parseQuoted(args) {
    if (!Array.isArray(args)) return [];
    const joined = args.join(' ');
    const tokens = [];
    let buf = '';
    let quote = null;
    for (let i = 0; i < joined.length; i++) {
        const ch = joined[i];
        if (quote) {
            if (ch === quote) { quote = null; continue; }
            buf += ch;
            continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === ' ') {
            if (buf.length > 0) { tokens.push(buf); buf = ''; }
            continue;
        }
        buf += ch;
    }
    if (buf.length > 0) tokens.push(buf);
    return tokens;
}

module.exports = {
    BADGE_ICONS,
    DEFAULT_ACCENT,
    ERROR_ACCENT,
    FALLBACK_HEX,
    parseHexColor,
    validateBadgeId,
    validateImageUrl,
    parseQuoted,
    withV2,
    editV2Reply,
    isInteractionTarget,
    buildSuccessContainer,
    buildErrorContainer
};
