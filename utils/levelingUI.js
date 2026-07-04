'use strict';

/**
 * Leveling UI Toolkit
 * ──────────────────────────────────────────────────────────────────────────
 * Minimal, professional Components V2 building blocks for the `leveling`
 * command category. Mirrors the webhook + voice + stats toolkits so the whole
 * bot shares one visual language:
 *
 *   • `applyStyle()` syncs every panel with `/bot-customize` (accent color +
 *     footer) and — unlike the global index.js patcher — also runs on
 *     interaction `update()` / `reply()` surfaces (button clicks), so the
 *     level-channel / level-roles / toggle button panels stay themed too.
 *   • `ok` / `err` / `warn` / `info` / `usage` / `list` share the same header
 *     language and caretright-bulleted detail layout with clean dividers.
 */

const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
    SeparatorSpacingSize, MessageFlags, PermissionFlagsBits
} = require('discord.js');
const botCustomize = require('./botCustomize');

/* ── Emojis ─────────────────────────────────────────────────────────────── */

const E = {
    ok:      '<:Checkedbox:1521227734943269077>',
    no:      '<:Cancel:1521227723916181644>',
    warn:    '<:Infotriangle:1521227710381428926>',
    info:    '<:Inforect:1521228008285929532>',
    gear:    '<:Settings:1521227767780343879>',
    bullet:  '<:Caretright:1521227704953864202>',
    xp:      '<:Lightning:1521227915537285150>',
    trophy:  '<:Award:1521228119640375336>',
    role:    '<:Userplus:1521227719621218477>',
    channel: '<:Hashtag:1521227771957870604>',
    bullhorn:'<:Bullhorn:1521227936575914016>',
    bookmark:'<:Bookmark:1521227835526742066>',
    doc:     '<:Document:1521227875016114266>',
    bulb:    '<:Lightbulbalt:1521227880703463675>',
    on:      '<:Toggleon:1521227758011809964>',
    off:     '<:Toggleoff:1521227763816595559>',
    trash:   '<:Trash:1521227750420254820>',
    fire:    '<:Fire:1521227907647668374>',
    block:   '<:Commentblock:1521227898101432331>',
};

const FOOTER_SENTINEL = '__xnicoFooterApplied';
const COLOR_OK = 0x57F287;
const COLOR_ERR = 0xED4245;
const COLOR_WARN = 0xFEE75C;
const COLOR_NEUTRAL = 0xCAD7E6;

/* ── Helpers ────────────────────────────────────────────────────────────── */

/** Turn an object {label: value} or array of strings into caretright rows. */
function rows(details) {
    if (!details) return '';
    const lines = Array.isArray(details)
        ? details
        : Object.entries(details).map(([k, v]) => `**${k}:** ${v}`);
    return lines.filter(Boolean).map(l => `${E.bullet} ${l}`).join('\n');
}

/**
 * Sync a container with the guild's `/bot-customize` accent color + footer.
 * Also runs on interaction update surfaces the global patcher never touches.
 */
function applyStyle(container, guildId, { footer = true } = {}) {
    if (!container || !container.data) return container;

    const color = guildId ? botCustomize.getEmbedColor(guildId) : COLOR_NEUTRAL;
    if (color === null) delete container.data.accent_color; // colorless mode
    else if (Number.isFinite(color)) container.data.accent_color = color;

    if (footer && !container[FOOTER_SENTINEL]) {
        const footerText = (guildId && botCustomize.getFooterText(guildId)) || '<:xnico:1486755083390550036> [xNico </>](https://discord.gg/Zs35X7Umak) Development';
        const kids = container.components || container.data.components || [];
        let lastText = null;
        for (let i = kids.length - 1; i >= 0; i--) {
            const k = kids[i];
            const type = k?.data?.type ?? k?.type;
            const content = k?.data?.content ?? k?.content;
            if (type === 10 && typeof content === 'string') { lastText = content; break; }
        }
        if (!(lastText && lastText.trimStart().startsWith('-#'))) {
            try {
                container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${String(footerText).slice(0, 100)}`));
            } catch { /* shape didn't allow appending */ }
        }
        container[FOOTER_SENTINEL] = true;
    }
    return container;
}

/** Standard V2 reply payload for a container. */
function payload(container) {
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function divider() {
    return new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);
}

/* ── Panels ─────────────────────────────────────────────────────────────── */

function _base(guildId, emoji, title, body, details, baseColor, note) {
    let content = `# ${emoji} ${title}`;
    if (body) content += `\n\n${body}`;
    const ctr = new ContainerBuilder().setAccentColor(baseColor);
    ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    if (details && (Array.isArray(details) ? details.length : Object.keys(details).length)) {
        ctr.addSeparatorComponents(divider());
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${E.doc} Details\n${rows(details)}`));
    }
    if (note) {
        ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${note}`));
    }
    return applyStyle(ctr, guildId);
}

/** Success panel. `emoji` overrides the default check. */
function ok(guildId, title, body, details = null, { emoji = E.ok, note = null } = {}) {
    return _base(guildId, emoji, title, body, details, COLOR_OK, note);
}

/** Error panel with optional hint line. */
function err(guildId, title, body, hint = null) {
    let content = `# ${E.no} ${title}`;
    if (body) content += `\n\n${body}`;
    if (hint) content += `\n\n-# ${hint}`;
    const ctr = new ContainerBuilder()
        .setAccentColor(COLOR_ERR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return applyStyle(ctr, guildId);
}

function warn(guildId, title, body, details = null) {
    return _base(guildId, E.warn, title, body, details, COLOR_WARN, null);
}

function info(guildId, title, body, details = null, note = null) {
    return _base(guildId, E.info, title, body, details, COLOR_NEUTRAL, note);
}

/** Standardized permission-denied panel. */
function permError(guildId, permName = 'Administrator') {
    return err(guildId, 'Missing Permission', `You need the **${permName}** permission.`);
}

/** Usage/help panel with commands + examples. */
function usage(guildId, title, commands = [], { emoji = E.xp, intro = null, examples = [], note = null } = {}) {
    let body = intro ? `${intro}\n\n` : '';
    if (commands.length) body += `### ${E.doc} Commands\n${rows(commands)}`;
    if (examples.length) body += `\n\n### ${E.bulb} Examples\n${rows(examples.map(e => `\`${e}\``))}`;
    const ctr = new ContainerBuilder()
        .setAccentColor(COLOR_NEUTRAL)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${emoji} ${title}\n\n${body}`));
    if (note) {
        ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${note}`));
    }
    return applyStyle(ctr, guildId);
}

/**
 * List panel — a header + caretright rows + optional note.
 * @param {string[]} lines already-formatted lines (without the caret prefix)
 */
function list(guildId, title, lines = [], { emoji = E.doc, subtitle = null, note = null, empty = 'Nothing configured yet.' } = {}) {
    let header = `# ${emoji} ${title}`;
    if (subtitle) header += `\n-# ${subtitle}`;
    const ctr = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
        .addSeparatorComponents(divider())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.length ? rows(lines) : `-# ${empty}`));
    if (note) {
        ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${note}`));
    }
    return applyStyle(ctr, guildId);
}

/** Returns an error container if the member lacks `perm`, else null. */
function requirePerm(member, guildId, permFlag = PermissionFlagsBits.Administrator, permName = 'Administrator') {
    if (member?.permissions?.has(permFlag)) return null;
    return permError(guildId, permName);
}

module.exports = {
    E, FOOTER_SENTINEL,
    rows, applyStyle, payload, divider,
    ok, err, warn, info, permError, usage, list, requirePerm,
    PermissionFlagsBits,
};
