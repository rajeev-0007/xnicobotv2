'use strict';

/**
 * Admin UI Toolkit
 * ──────────────────────────────────────────────────────────────────────────
 * Minimal, professional Components V2 panels for the `admin` category
 * (moderation + server configuration). Mirrors the other category toolkits.
 *
 * Like ownerUI / utilityUI, helpers return a COMPLETE reply payload
 * (`{ components, flags }`) so call sites convert with a single inline
 * `require('../../utils/adminUI')` — no per-file import edits. The global
 * reply patcher applies the guild accent + footer when sent.
 */

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const E = {
    no:   '<:Cancel:1521227723916181644>',
    ok:   '<:Checkedbox:1521227734943269077>',
    warn: '<:Infotriangle:1521227710381428926>',
    info: '<:Inforect:1521228008285929532>',
};

const COLOR_ERR = 0xED4245;
const COLOR_WARN = 0xFEE75C;

function _payload(emoji, title, body, hint, color, ephemeral) {
    let content = `# ${emoji} ${title}`;
    if (body) content += `\n\n${body}`;
    if (hint) content += `\n\n-# ${hint}`;
    const ctr = new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    const flags = ephemeral
        ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        : MessageFlags.IsComponentsV2;
    return { components: [ctr], flags };
}

/** Error payload. */
function errReply(title, body = '', { hint = null, ephemeral = false } = {}) {
    return _payload(E.no, title, body, hint, COLOR_ERR, ephemeral);
}

/** Warning payload. */
function warnReply(title, body = '', { hint = null, ephemeral = false } = {}) {
    return _payload(E.warn, title, body, hint, COLOR_WARN, ephemeral);
}

/** Standard missing-permission payload. */
function permReply(permName = 'the required', { ephemeral = false } = {}) {
    return errReply('Missing Permission', `You need the **${permName}** permission.`, { ephemeral });
}

module.exports = { E, errReply, warnReply, permReply };
