'use strict';

/**
 * Fun UI Toolkit
 * ──────────────────────────────────────────────────────────────────────────
 * Minimal, professional Components V2 building blocks for the `fun` category.
 * Mirrors the webhook / voice / stats / leveling / social / games / basic
 * toolkits so the whole bot shares one visual language.
 *
 * Most fun commands render their own rich cards/containers and get the guild
 * accent + footer from the global reply patcher; this toolkit standardises the
 * scattered raw `content: '<:Cancel:…>'` error strings into one themed panel
 * (and is imported by percentCommandFactory so every "How X?" command shares
 * the same error style).
 */

const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
    SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const botCustomize = require('./botCustomize');

const E = {
    ok:     '<:Checkedbox:1521227734943269077>',
    no:     '<:Cancel:1521227723916181644>',
    warn:   '<:Infotriangle:1521227710381428926>',
    info:   '<:Inforect:1521228008285929532>',
    bullet: '<:Caretright:1521227704953864202>',
    bulb:   '<:Lightbulbalt:1521227880703463675>',
};

const FOOTER_SENTINEL = '__xnicoFooterApplied';
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

function payload(container, ephemeral = false) {
    const flags = ephemeral
        ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        : MessageFlags.IsComponentsV2;
    return { components: [container], flags };
}

function _panel(guildId, emoji, title, body, hint, color) {
    let content = `# ${emoji} ${title}`;
    if (body) content += `\n\n${body}`;
    if (hint) content += `\n\n-# ${hint}`;
    const ctr = new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return applyStyle(ctr, guildId);
}

const err  = (guildId, title, body, hint = null) => _panel(guildId, E.no,   title, body, hint, COLOR_ERR);
const warn = (guildId, title, body, hint = null) => _panel(guildId, E.warn, title, body, hint, COLOR_WARN);
const info = (guildId, title, body, hint = null) => _panel(guildId, E.info, title, body, hint, COLOR_NEUTRAL);

module.exports = { E, rows, applyStyle, payload, err, warn, info };
