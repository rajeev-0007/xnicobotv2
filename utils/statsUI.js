'use strict';

/**
 * Stats UI Toolkit
 * ──────────────────────────────────────────────────────────────────────────
 * Minimal, professional Components V2 building blocks for the `stats`
 * command category. Mirrors the webhook + voice toolkits so the whole bot
 * shares one visual language:
 *
 *   • Guild styling — `applyStyle()` syncs every panel with `/bot-customize`
 *     (accent color + footer) and works on interaction updates too, not just
 *     the initial reply.
 *   • `card()` builds the standard stat panel: an avatar/icon header section,
 *     clean dividers, and one or more caretright-bulleted detail blocks.
 *   • `err()` / `info()` share the same header language as the rest of the bot.
 *
 * Keeping this in one place means every stats command stays small and looks
 * identical.
 */

const {
    ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
    SeparatorBuilder, SeparatorSpacingSize, MessageFlags
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
    msg:     '<:Bookopen:1521227911137595605>',
    voice:   '<:Volumeup:1521228004502536272>',
    xp:      '<:Lightning:1521227915537285150>',
    invite:  '<:Bullhorn:1521227936575914016>',
    award:   '<:Award:1521228119640375336>',
    ban:     '<:banhammer:1521227777083314529>',
    pin:     '<:Pin:1521227932625014916>',
    fire:    '<:Fire:1521227907647668374>',
    clock:   '<:Clock:1521228110408847623>',
    cmd:     '<:Gamepad:1521228035213230090>',
    doc:     '<:Document:1521227875016114266>',
    bulb:    '<:Lightbulbalt:1521227880703463675>',
    brand:   '<:xnico:1521228240440660180>',
};

const FOOTER_SENTINEL = '__xnicoFooterApplied';
const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';
const COLOR_ERR = 0xED4245;

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
    if (color === null) delete container.data.accent_color; // colorless mode
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

/** Standard V2 reply payload for a container. */
function payload(container) {
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/** A small divider separator. */
function divider() {
    return new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);
}

/** Format a "### heading\nbody" block. */
function block(heading, body) {
    return `### ${heading}\n${body}`;
}

/**
 * Build the standard stats card.
 *
 * @param {object} o
 * @param {string|null} o.guildId
 * @param {string} o.title     header title (may include an emoji prefix)
 * @param {string} [o.subtitle] small `-#` subtitle line under the title
 * @param {string} [o.thumbnail] URL used as the header thumbnail accessory
 * @param {string[]} o.blocks  body text blocks (each rendered as its own row,
 *                             separated by thin dividers)
 * @param {string} [o.note]    optional trailing `-#` hint line
 * @returns {ContainerBuilder}
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

/* ── Panels ─────────────────────────────────────────────────────────────── */

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

/** Neutral info panel. */
function info(guildId, title, body, details = null) {
    let content = `# ${E.info} ${title}`;
    if (body) content += `\n\n${body}`;
    const ctr = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    if (details && (Array.isArray(details) ? details.length : Object.keys(details).length)) {
        ctr.addSeparatorComponents(divider());
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(rows(details)));
    }
    return applyStyle(ctr, guildId);
}

module.exports = {
    E, DEFAULT_AVATAR,
    rows, applyStyle, payload, divider, block, card,
    err, info,
};
