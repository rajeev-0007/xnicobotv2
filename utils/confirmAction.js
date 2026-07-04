'use strict';

/**
 * confirmAction.js — Reusable "Are you sure?" confirmation prompt for
 * destructive / high-impact moderation commands (ban, kick, etc.).
 *
 * Shows a Components V2 panel with Confirm / Cancel buttons, waits for the
 * command invoker to choose, and reports the outcome. Works for BOTH slash
 * interactions and prefix (message) commands.
 *
 * Usage (inside a command, AFTER all validation passes):
 *
 *   const { confirmAction } = require('../../utils/confirmAction');
 *   const { confirmed, button } = await confirmAction(interaction, false, {
 *       title: 'Confirm Ban',
 *       description: `Are you sure you want to **ban** <@${user.id}>?`,
 *       confirmLabel: 'Ban User',
 *   });
 *   if (!confirmed) return;
 *   // ...perform the action...
 *   await button.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
 *
 * © Rajeev (Rexzy) — xNico
 */

const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags, ComponentType
} = require('discord.js');

// Custom IDs are namespaced so the global interactionCreate handler ignores
// them (it early-returns on `modconfirm:`), letting the per-message collector
// own the click exclusively.
const ACCEPT_ID = 'modconfirm:accept';
const CANCEL_ID = 'modconfirm:cancel';

const WARN_COLOR    = 0xFEE75C; // yellow — pending confirmation
const SUCCESS_COLOR = 0x57F287; // green  — confirmed/processing
const MUTED_COLOR   = 0x99AAB5; // grey   — cancelled / timed out

function buildConfirmPanel({ title, description, confirmLabel = 'Confirm', danger = true, timeoutSec = 30 }) {
    const container = new ContainerBuilder()
        .setAccentColor(WARN_COLOR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ⚠️ ${title}\n\n${description}`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# This action requires confirmation • auto-cancels in ${timeoutSec}s`
        ));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(ACCEPT_ID)
            .setLabel(confirmLabel)
            .setEmoji('✅')
            .setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(CANCEL_ID)
            .setLabel('Cancel')
            .setEmoji('✖️')
            .setStyle(ButtonStyle.Secondary)
    );
    container.addActionRowComponents(row);
    return container;
}

function simplePanel(accent, content) {
    return new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

/**
 * Present a confirmation prompt and await the invoker's decision.
 *
 * @param {import('discord.js').CommandInteraction|import('discord.js').Message} ctx
 * @param {boolean} isPrefix  true for prefix (message) commands
 * @param {object}  opts
 * @param {string}  opts.title
 * @param {string}  opts.description
 * @param {string}  [opts.confirmLabel='Confirm']
 * @param {boolean} [opts.danger=true]    red confirm button for destructive ops
 * @param {number}  [opts.timeoutSec=30]
 * @returns {Promise<{confirmed: boolean, button: import('discord.js').ButtonInteraction|null}>}
 *          When confirmed, `button` is the (already-acknowledged) button
 *          interaction — call `button.editReply(...)` to show the final result.
 */
async function confirmAction(ctx, isPrefix, opts) {
    const invokerId = isPrefix ? ctx.author.id : ctx.user.id;
    const timeoutSec = opts.timeoutSec || 30;
    const panel = buildConfirmPanel({ ...opts, timeoutSec });
    const payload = { components: [panel], flags: MessageFlags.IsComponentsV2 };

    // ── Send the prompt and resolve the underlying message ──
    let promptMsg;
    try {
        if (isPrefix) {
            promptMsg = await ctx.reply(payload);
        } else {
            if (ctx.deferred || ctx.replied) {
                promptMsg = await ctx.followUp({ ...payload, fetchReply: true });
            } else {
                await ctx.reply(payload);
                promptMsg = await ctx.fetchReply();
            }
        }
    } catch {
        return { confirmed: false, button: null };
    }

    // ── Await the invoker's choice ──
    try {
        const button = await promptMsg.awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: (i) => (i.customId === ACCEPT_ID || i.customId === CANCEL_ID) && i.user.id === invokerId,
            time: timeoutSec * 1000,
        });

        if (button.customId === CANCEL_ID) {
            await button.update({
                components: [simplePanel(MUTED_COLOR, '# ✖️ Cancelled\n\nNo action was taken.')],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
            return { confirmed: false, button: null };
        }

        // Confirmed — show a transient state and hand the button back so the
        // caller can replace it with the final result via button.editReply().
        await button.update({
            components: [simplePanel(SUCCESS_COLOR, '# ⏳ Confirmed\n\nProcessing the action…')],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => {});
        return { confirmed: true, button };
    } catch {
        // Timed out — disable the prompt.
        const timeoutPanel = simplePanel(MUTED_COLOR, '# ⏱️ Confirmation Timed Out\n\nNo response received — the action was cancelled.');
        try {
            if (isPrefix) {
                await promptMsg.edit({ components: [timeoutPanel], flags: MessageFlags.IsComponentsV2 });
            } else {
                await ctx.editReply({ components: [timeoutPanel], flags: MessageFlags.IsComponentsV2 });
            }
        } catch { /* ignore */ }
        return { confirmed: false, button: null };
    }
}

module.exports = { confirmAction, ACCEPT_ID, CANCEL_ID };
