'use strict';

/**
 * Voice UI Toolkit
 * ──────────────────────────────────────────────────────────────────────────
 * Minimal, professional Components V2 building blocks for the `voice`
 * command category. Mirrors the webhook toolkit:
 *
 *   • Guild styling — `applyStyle()` syncs every panel with `/bot-customize`
 *     (accent color + footer) and works on interaction updates too, not just
 *     the initial prefix reply.
 *   • Consistent panels — `ok` / `err` / `warn` / `info` / `usage` all share
 *     the same header + caretright-bulleted detail layout with clean dividers.
 *
 * One place for the visual language keeps all 30+ voice commands identical.
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
    user:    '<:User:1521227714227343380>',
    vol:     '<:Volumeup:1521228004502536272>',
    volOff:  '<:Volumeoff:1521228297864745193>',
    mic:     '<:Microphone:1521227746376683590>',
    micOff:  '<:Microphoneoff:1521228303762063380>',
    lock:    '<:Lock:1521227892770734120>',
    unlock:  '<:Unlock:1521228030842769610>',
    move:    '<:History:1521227863079256278>',
    ban:     '<:banhammer:1521227777083314529>',
    clock:   '<:Clock:1521228110408847623>',
    bolt:    '<:Lightning:1521227915537285150>',
    doc:     '<:Document:1521227875016114266>',
    bulb:    '<:Lightbulbalt:1521227880703463675>',
};

const FOOTER_SENTINEL = '__xnicoFooterApplied';
const COLOR_OK = 0x57F287;
const COLOR_ERR = 0xED4245;
const COLOR_WARN = 0xFEE75C;

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

    const color = guildId ? botCustomize.getEmbedColor(guildId) : 0xCAD7E6;
    if (color === null) delete container.data.accent_color;
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

function payload(container) {
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/* ── Panels ─────────────────────────────────────────────────────────────── */

function _base(guildId, emoji, title, body, details, baseColor) {
    let content = `# ${emoji} ${title}`;
    if (body) content += `\n\n${body}`;
    const ctr = new ContainerBuilder().setAccentColor(baseColor);
    ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    if (details && (Array.isArray(details) ? details.length : Object.keys(details).length)) {
        ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${E.gear} Details\n${rows(details)}`));
    }
    return applyStyle(ctr, guildId);
}

/** Success panel. `emoji` overrides the default check. */
function ok(guildId, title, body, details = null, emoji = E.ok) {
    return _base(guildId, emoji, title, body, details, COLOR_OK);
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
    return _base(guildId, E.warn, title, body, details, COLOR_WARN);
}

function info(guildId, title, body, details = null) {
    return _base(guildId, E.info, title, body, details, 0xCAD7E6);
}

/** Standardized permission-denied panel. */
function permError(guildId, permName) {
    return err(guildId, 'Missing Permission', `You need the **${permName}** permission.`);
}

/** Usage/help panel with examples. */
function usage(guildId, title, usageStr, examples = []) {
    let body = `### ${E.doc} Usage\n${E.bullet} \`${usageStr}\``;
    if (examples.length) {
        body += `\n\n### ${E.bulb} Examples\n` + examples.map(e => `${E.bullet} \`${e}\``).join('\n');
    }
    const ctr = new ContainerBuilder()
        .setAccentColor(0xCAD7E6)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${E.vol} ${title}\n\n${body}`));
    return applyStyle(ctr, guildId);
}

/* ── Guards ─────────────────────────────────────────────────────────────── */

/** Returns an error container if the member lacks `perm`, else null. */
function requirePerm(member, guildId, permFlag, permName) {
    if (member?.permissions?.has(permFlag)) return null;
    return permError(guildId, permName);
}

module.exports = {
    E, FOOTER_SENTINEL,
    rows, applyStyle, payload,
    ok, err, warn, info, permError, usage, requirePerm,
    PermissionFlagsBits,
};
