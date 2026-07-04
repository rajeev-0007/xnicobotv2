'use strict';

/**
 * Interaction Guards
 * ───────────────────────────────────────────────────────────────────
 * Reusable runtime checks shared across panel handlers. Each guard
 * either returns `false` (proceed) or replies to the interaction
 * with an appropriate gate UI and returns `true` (caller must abort).
 *
 * The dispatcher in `index.js` already enforces `premiumOnly` at
 * COMMAND ENTRY, but it does NOT see component / modal interactions
 * routed by customId prefix. Premium-gated commands that expose
 * `handleButton` / `handleModal` / `handleSelectMenu` / `handleInteraction`
 * MUST call `requirePremium(interaction)` at the top of those handlers
 * — otherwise anyone can press the button or submit the modal even
 * after their premium expires.
 *
 * This file also exports a `safeReply` helper that swallows
 * InteractionAlreadyReplied / Unknown Interaction races, which are
 * the dominant source of unhandled rejections in the codebase.
 */

const { MessageFlags } = require('discord.js');
const log = require('./logger-styled');

/* ═══════════════════════════════════════════════════════════════════
   PREMIUM GUARD
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Block the interaction if the user does NOT have premium access.
 * Pass through if they do. Always replies via the buildPremiumGate UI
 * for blocked users (ephemeral, V2 components).
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} [opts]
 * @param {string} [opts.commandName] - Display name for the gate UI (e.g. `/customshop buy`)
 * @returns {Promise<boolean>} `true` if the caller must abort (already replied), `false` to proceed.
 */
async function requirePremium(interaction, opts = {}) {
    if (!interaction || !interaction.user) return false; // defensive
    const premiumManager = require('./premiumManager');
    const guildId = interaction.guild?.id || null;
    if (premiumManager.hasPremiumAccess(interaction.user.id, guildId)) return false;

    const { buildPremiumGate } = require('./responseBuilder');
    const gate = buildPremiumGate(opts.commandName || null);
    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ components: [gate], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
        } else {
            await interaction.reply({ components: [gate], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
        }
    } catch (e) {
        log.error(`[premiumGuard] reply failed: ${e.message}`);
    }
    return true;
}

/**
 * Synchronous variant — only checks; never replies. Useful when a
 * caller wants to fork its UI for free vs premium without surfacing
 * a denial.
 */
function hasPremium(interaction) {
    if (!interaction || !interaction.user) return false;
    const premiumManager = require('./premiumManager');
    return premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild?.id || null);
}

/* ═══════════════════════════════════════════════════════════════════
   SAFE REPLY
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Reply to an interaction without throwing if it has already been
 * replied to, deferred, or expired (Unknown Interaction). Falls
 * through to followUp / editReply automatically based on state.
 *
 * NEVER throws — logs and resolves with `null` on terminal failure.
 *
 * @param {import('discord.js').Interaction} interaction
 * @param {object} payload  - Same shape as interaction.reply payload
 * @returns {Promise<import('discord.js').Message|null>}
 */
async function safeReply(interaction, payload) {
    if (!interaction) return null;
    try {
        if (interaction.replied) {
            return await interaction.followUp(payload);
        }
        if (interaction.deferred) {
            return await interaction.editReply(payload);
        }
        return await interaction.reply(payload);
    } catch (err) {
        // Common Discord codes:
        //   10062 - Unknown interaction (token expired, > 3s)
        //   40060 - Interaction has already been acknowledged
        //   10008 - Unknown message (the original was deleted)
        const code = err?.rawError?.code ?? err?.code;
        if (code === 10062 || code === 40060 || code === 10008) return null;
        log.error(`[safeReply] ${err.message}`);
        return null;
    }
}

/**
 * Update the interaction's parent message safely. Falls back to
 * editReply / reply if `update()` fails because the interaction
 * is already acknowledged or the original message is gone.
 */
async function safeUpdate(interaction, payload) {
    if (!interaction) return null;
    try {
        if (typeof interaction.update === 'function' && !interaction.replied && !interaction.deferred) {
            return await interaction.update(payload);
        }
        if (interaction.deferred && !interaction.replied) {
            return await interaction.editReply(payload);
        }
        if (interaction.replied) {
            return await interaction.followUp(payload);
        }
        return await interaction.reply(payload);
    } catch (err) {
        const code = err?.rawError?.code ?? err?.code;
        if (code === 10062 || code === 40060 || code === 10008) return null;
        log.error(`[safeUpdate] ${err.message}`);
        return null;
    }
}

/* ═══════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
    requirePremium,
    hasPremium,
    safeReply,
    safeUpdate
};
