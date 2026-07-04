'use strict';

/**
 * Social UI Toolkit
 * ──────────────────────────────────────────────────────────────────────────
 * Minimal, professional Components V2 building blocks for the `social`
 * command category (badges, rep, marry/divorce, profiles). Mirrors the
 * webhook / voice / stats / leveling toolkits so the whole bot shares one
 * visual language.
 *
 *   • `applyStyle()` syncs every panel with `/bot-customize` (accent + footer)
 *     and works on interaction updates too.
 *   • `card()` builds an avatar-headed panel; `ok`/`err`/`warn`/`info`/`usage`
 *     are the shared status panels.
 */

const {
    ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
    SeparatorBuilder, SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const botCustomize = require('./botCustomize');

const E = {
    ok:      '<:Checkedbox:1521227734943269077>',
    no:      '<:Cancel:1521227723916181644>',
    warn:    '<:Infotriangle:1521227710381428926>',
    info:    '<:Inforect:1521228008285929532>',
    bullet:  '<:Caretright:1521227704953864202>',
    user:    '<:User:1521227714227343380>',
    star:    '<:Star:1521227981685526568>',
    gift:    '<:Present:1521228115655917659>',
    clock:   '<:Clock:1521228110408847623>',
    badge:   '<:Award:1521228119640375336>',
    doc:     '<:Document:1521227875016114266>',
    bulb:    '<:Lightbulbalt:1521227880703463675>',
    heart:   '💗',
    ring:    '💍',
    broken:  '💔',
    couple:  '💑',
};

const FOOTER_SENTINEL = '__xnicoFooterApplied';
const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';
const COLOR_OK = 0x57F287;
const COLOR_ERR = 0xED4245;
const COLOR_WARN = 0xFEE75C;
const COLOR_NEUTRAL = 0xCAD7E6;

function rows(details) {
    if (!details) return '';
    const lines = Array.isArray(details)
        ? details
        : Object.entries(details).map(([k, v]) => `**${k}:** ${v}`);
    return lines.filter(Boolean).map(l => `${E.bullet} ${l}`).join('\n');
}

function applyStyle(container, guildId, { footer = true } = {}) {
    if (!container || !container.data) return container;

    const color = guildId ? botCustomize.getEmbedColor(guildId) : COLOR_NEUTRAL;
    if (color === null) delete container.data.accent_color;
    else if (Number.isFinite(color)) container.data.accent_color = color;

    if (footer && !container[FOOTER_SENTINEL]) {
        const footerText = (guildId && botCustomize.getFooterText(guildId)) || 'xNico </>';
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

function divider() {
    return new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);
}

/**
 * Avatar-headed card. blocks are text bodies separated by thin dividers.
 */
function card({ guildId, title, subtitle, thumbnail, blocks = [], note }) {
    const ctr = new ContainerBuilder();
    const headerText = `# ${title}` + (subtitle ? `\n-# ${subtitle}` : '');
    if (thumbnail) {
        ctr.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
                .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: thumbnail } }))
        );
    } else {
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
    }
    const body = blocks.filter(Boolean);
    if (body.length) {
        ctr.addSeparatorComponents(divider());
        body.forEach((b, i) => {
            if (i > 0) ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
            ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(b));
        });
    }
    if (note) {
        ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${note}`));
    }
    return applyStyle(ctr, guildId);
}

function _base(guildId, emoji, title, body, details, baseColor, note) {
    let content = `# ${emoji} ${title}`;
    if (body) content += `\n\n${body}`;
    const ctr = new ContainerBuilder().setAccentColor(baseColor);
    ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    if (details && (Array.isArray(details) ? details.length : Object.keys(details).length)) {
        ctr.addSeparatorComponents(divider());
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(rows(details)));
    }
    if (note) {
        ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${note}`));
    }
    return applyStyle(ctr, guildId);
}

function ok(guildId, title, body, details = null, { emoji = E.ok, note = null } = {}) {
    return _base(guildId, emoji, title, body, details, COLOR_OK, note);
}

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

function usage(guildId, title, usageStr, { emoji = E.info, intro = null, examples = [] } = {}) {
    let body = intro ? `${intro}\n\n` : '';
    body += `### ${E.doc} Usage\n${E.bullet} \`${usageStr}\``;
    if (examples.length) body += `\n\n### ${E.bulb} Examples\n${rows(examples.map(e => `\`${e}\``))}`;
    const ctr = new ContainerBuilder()
        .setAccentColor(COLOR_NEUTRAL)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${emoji} ${title}\n\n${body}`));
    return applyStyle(ctr, guildId);
}

module.exports = {
    E, DEFAULT_AVATAR,
    rows, applyStyle, payload, divider, card,
    ok, err, warn, info, usage,
};
