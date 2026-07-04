/**
 * Economy guards — short-circuit a command when the dashboard has
 * disabled it for the current guild. Each guard returns `true` when
 * the command should NOT proceed (it has already replied to the user
 * with a "feature disabled" container) and `false` otherwise.
 *
 * Usage:
 *   const { gamblingGuard, shopGuard } = require('../../utils/economyGuards');
 *
 *   async executePrefix(message, args) {
 *     if (await gamblingGuard(message)) return;
 *     // ...rest of handler
 *   }
 *
 *   async execute(interaction) {
 *     if (await gamblingGuard(interaction)) return;
 *     // ...rest of handler
 *   }
 *
 * The helpers accept either a Message or an Interaction — they pick
 * the right reply method automatically. They also tolerate plain
 * objects with a `reply` function and a `guild` field, used by the
 * legacy "fake message" wrappers some commands build.
 */

'use strict';

const { MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay } = require('./componentHelpers');
const { getEconomySettings } = require('./currencyHelper');

function getGuildId(ctx) {
    if (!ctx) return null;
    if (ctx.guild?.id) return ctx.guild.id;
    if (ctx.guildId) return ctx.guildId;
    if (ctx.message?.guild?.id) return ctx.message.guild.id;
    if (ctx.interaction?.guild?.id) return ctx.interaction.guild.id;
    return null;
}

function getReplyFn(ctx) {
    if (!ctx) return null;
    // Discord.js Interaction
    if (typeof ctx.reply === 'function' && (ctx.replied !== undefined || ctx.deferred !== undefined)) {
        return (opts) => {
            if (ctx.replied || ctx.deferred) {
                return typeof ctx.followUp === 'function'
                    ? ctx.followUp(opts)
                    : ctx.reply(opts);
            }
            return ctx.reply(opts);
        };
    }
    // Discord.js Message or plain { reply: fn } shim
    if (typeof ctx.reply === 'function') return ctx.reply.bind(ctx);
    return null;
}

function denyContainer(title, reason) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, [
        `# <:Cancel:1521227723916181644> ${title}`,
        '',
        reason,
        '',
        `-# A server admin can re-enable this in the dashboard.`
    ].join('\n'));
    return c;
}

/**
 * Block gambling commands when `gamblingEnabled` is false in the
 * dashboard's economy settings for this guild. Returns true when
 * the command was blocked AND the user has been notified.
 */
async function gamblingGuard(ctx) {
    const guildId = getGuildId(ctx);
    if (!guildId) return false; // DMs / no guild — don't block
    const cfg = getEconomySettings(guildId);
    if (cfg.gamblingEnabled) return false;

    const reply = getReplyFn(ctx);
    if (!reply) return true; // can't reply — but still block
    try {
        await reply({
            components: [denyContainer('Gambling Disabled', 'Gambling is turned off in this server.')],
            flags: MessageFlags.IsComponentsV2
        });
    } catch {}
    return true;
}

/**
 * Block shop / buy / sell-item commands when `shopEnabled` is false
 * in the dashboard's economy settings for this guild. Returns true
 * when the command was blocked AND the user has been notified.
 */
async function shopGuard(ctx) {
    const guildId = getGuildId(ctx);
    if (!guildId) return false;
    const cfg = getEconomySettings(guildId);
    if (cfg.shopEnabled) return false;

    const reply = getReplyFn(ctx);
    if (!reply) return true;
    try {
        await reply({
            components: [denyContainer('Shop Disabled', 'The shop is turned off in this server.')],
            flags: MessageFlags.IsComponentsV2
        });
    } catch {}
    return true;
}

/**
 * Block rob command when `robEnabled` is false. Same contract as
 * the other guards.
 */
async function robGuard(ctx) {
    const guildId = getGuildId(ctx);
    if (!guildId) return false;
    const cfg = getEconomySettings(guildId);
    if (cfg.robEnabled) return false;

    const reply = getReplyFn(ctx);
    if (!reply) return true;
    try {
        await reply({
            components: [denyContainer('Rob Disabled', 'The rob command is turned off in this server.')],
            flags: MessageFlags.IsComponentsV2
        });
    } catch {}
    return true;
}

module.exports = { gamblingGuard, shopGuard, robGuard };
