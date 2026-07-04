'use strict';

/**
 * Owner UI Toolkit
 * ──────────────────────────────────────────────────────────────────────────
 * Minimal, professional Components V2 error panels for the owner-only command
 * category. Mirrors the other category toolkits.
 *
 * Unlike the other toolkits, the exported helpers return a COMPLETE reply
 * payload (`{ components, flags }`) so call sites can be converted with a
 * single inline `require('../../utils/ownerUI')` — no per-file import edits,
 * which keeps this large sweep low-risk. The container carries no fixed
 * guild id; the global reply patcher applies the guild accent + footer when
 * the payload is sent.
 */

const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const E = {
    no:   '<:Cancel:1521227723916181644>',
    ok:   '<:Checkedbox:1521227734943269077>',
    warn: '<:Infotriangle:1521227710381428926>',
};

const COLOR_ERR = 0xED4245;

/** Build an error payload. */
function errReply(title, body = '', { hint = null, ephemeral = false } = {}) {
    let content = `# ${E.no} ${title}`;
    if (body) content += `\n\n${body}`;
    if (hint) content += `\n\n-# ${hint}`;
    const ctr = new ContainerBuilder()
        .setAccentColor(COLOR_ERR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    const flags = ephemeral
        ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        : MessageFlags.IsComponentsV2;
    return { components: [ctr], flags };
}

/** Standard "owner only" gate panel. */
function ownerOnly(opts = {}) {
    return errReply('Owner Only', 'This command is only available to the bot owner.', opts);
}

module.exports = { E, errReply, ownerOnly };
