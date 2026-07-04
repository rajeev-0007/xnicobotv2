'use strict';

/**
 * Games UI Toolkit
 * ──────────────────────────────────────────────────────────────────────────
 * Minimal, professional Components V2 building blocks for the `games`
 * category. Mirrors the webhook / voice / stats / leveling / social toolkits.
 *
 * Games send result panels through `channel.send()` (win / lose / timeout),
 * which the global index.js reply patcher never touches — so `applyStyle()`
 * here is what keeps those follow-up panels themed with the guild's
 * `/bot-customize` accent + footer.
 */

const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
    SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const botCustomize = require('./botCustomize');

const E = {
    ok:      '<:Checkedbox:1521227734943269077>',
    no:      '<:Cancel:1521227723916181644>',
    warn:    '<:Infotriangle:1521227710381428926>',
    info:    '<:Inforect:1521228008285929532>',
    bullet:  '<:Caretright:1521227704953864202>',
    timer:   '<:Alarm:1521227869047750689>',
    gift:    '<:Present:1521228115655917659>',
    clock:   '<:Clock:1521228110408847623>',
    bulb:    '<:Lightbulbalt:1521227880703463675>',
    doc:     '<:Document:1521227875016114266>',
};

const FOOTER_SENTINEL = '__xnicoFooterApplied';
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

function divider() {
    return new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);
}

/**
 * Generic themed panel. `color` is a pre-style fallback; applyStyle syncs it
 * to the guild accent unless the guild is in 'colorless' mode.
 */
function panel(guildId, { emoji, title, body = '', note = null, color = COLOR_NEUTRAL }) {
    let content = emoji ? `# ${emoji} ${title}` : `# ${title}`;
    if (body) content += `\n\n${body}`;
    const ctr = new ContainerBuilder().setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    if (note) {
        ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${note}`));
    }
    return applyStyle(ctr, guildId);
}

const ok      = (guildId, title, body, note) => panel(guildId, { emoji: E.ok,   title, body, note, color: COLOR_OK });
const err     = (guildId, title, body, note) => panel(guildId, { emoji: E.no,   title, body, note, color: COLOR_ERR });
const warn    = (guildId, title, body, note) => panel(guildId, { emoji: E.warn, title, body, note, color: COLOR_WARN });
const info    = (guildId, title, body, note) => panel(guildId, { emoji: E.info, title, body, note, color: COLOR_NEUTRAL });
const timeout = (guildId, title, body, note) => panel(guildId, { emoji: E.timer, title, body, note, color: COLOR_WARN });

module.exports = {
    E, rows, applyStyle, payload, divider, panel,
    ok, err, warn, info, timeout,
};
