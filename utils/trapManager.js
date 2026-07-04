'use strict';

/**
 * trapManager.js — honeypot "trap" channels for catching compromised / spam
 * accounts (the classic crypto/fraud raid pattern where hacked accounts blast
 * the same message across channels).
 *
 * An admin marks one or more channels as TRAPS (clearly labelled "do not post
 * here"). Any non-exempt member who posts in a trap is auto-punished: their
 * message is deleted and they're timed out (≤ 28 days, Discord's hard cap) or
 * banned (for long/permanent durations), per the guild's configuration.
 *
 * Config (jsonStore 'trap', keyed by guildId) — a CRITICAL_STORE so it
 * survives restarts:
 *   {
 *     enabled, channels: [id], durationDays, deleteMessage,
 *     exemptRoles: [id], logChannel, reason
 *   }
 */

const { PermissionFlagsBits } = require('discord.js');
const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

const STORE = 'trap';
const MAX_TIMEOUT_DAYS = 28;                 // Discord communication_disabled_until cap
const DAY_MS = 24 * 60 * 60 * 1000;

function loadAll() {
    try { return jsonStore.has(STORE) ? (jsonStore.read(STORE) || {}) : {}; }
    catch { return {}; }
}
function getConfig(guildId) {
    return loadAll()[guildId] || null;
}
function saveConfig(guildId, partial) {
    const all = loadAll();
    all[guildId] = { ...(all[guildId] || {}), ...partial, updatedAt: Date.now() };
    jsonStore.writeImmediate(STORE, all);   // 'trap' is in CRITICAL_STORES too
    return all[guildId];
}

/** Default config shape. */
function defaults() {
    return {
        enabled: true,
        channels: [],
        durationDays: 7,         // ≤28 → timeout; >28 → ban
        deleteMessage: true,
        exemptRoles: [],
        logChannel: null,
        reason: 'Posted in a honeypot trap channel (likely compromised/spam account)',
    };
}

/**
 * Should this member be spared? Staff, the owner, admins, exempt roles, and
 * users who can manage the server are never punished by traps.
 */
function isExempt(member, cfg) {
    if (!member) return true;
    if (member.user?.bot) return true;
    if (member.id === member.guild.ownerId) return true;
    const perms = member.permissions;
    if (perms?.has(PermissionFlagsBits.Administrator) || perms?.has(PermissionFlagsBits.ManageGuild) || perms?.has(PermissionFlagsBits.ManageMessages)) return true;
    if (Array.isArray(cfg.exemptRoles) && cfg.exemptRoles.some(r => member.roles.cache.has(r))) return true;
    return false;
}

/**
 * messageCreate hook. Returns true if the message was in a trap channel
 * (handled), false otherwise.
 */
async function handleMessage(message) {
    try {
        if (!message.guild || message.author?.bot) return false;
        const cfg = jsonStore.peekGuild(STORE, message.guild.id);
        if (!cfg?.enabled || !Array.isArray(cfg.channels) || !cfg.channels.includes(message.channel.id)) return false;

        const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
        if (!member) return true;
        if (isExempt(member, cfg)) return true;

        // Delete the bait message first.
        if (cfg.deleteMessage !== false) {
            await message.delete().catch(() => {});
        }

        const me = message.guild.members.me;
        const days = Number(cfg.durationDays) || 7;
        const reason = cfg.reason || 'Trap channel triggered';
        let actionTaken = 'none';

        if (days > MAX_TIMEOUT_DAYS) {
            // Long/permanent → ban (timeout can't exceed 28 days).
            if (me?.permissions.has(PermissionFlagsBits.BanMembers) && member.bannable) {
                await member.ban({ deleteMessageSeconds: 7 * 24 * 3600, reason }).catch(() => {});
                actionTaken = 'banned';
            }
        } else {
            // Timeout for the configured number of days.
            if (me?.permissions.has(PermissionFlagsBits.ModerateMembers) && member.moderatable) {
                await member.timeout(days * DAY_MS, reason).catch(() => {});
                actionTaken = `timed out ${days}d`;
            }
        }

        await logTrap(message, member, cfg, actionTaken);
        return true;
    } catch (e) {
        log.debug?.(`[Trap] handleMessage error: ${e.message}`);
        return false;
    }
}

async function logTrap(message, member, cfg, actionTaken) {
    if (!cfg.logChannel) {
        log.warning(`[Trap] ${member.user.tag} triggered a trap in ${message.guild.name} → ${actionTaken}`);
        return;
    }
    try {
        const ch = await message.guild.channels.fetch(cfg.logChannel).catch(() => null);
        if (!ch?.isTextBased?.()) return;
        const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
        const content =
            `## <:Shield:1521227694677692467> Trap Triggered\n\n` +
            `<:Caretright:1521227704953864202> **User:** <@${member.id}> (\`${member.user.tag}\`)\n` +
            `<:Caretright:1521227704953864202> **Channel:** <#${message.channel.id}>\n` +
            `<:Caretright:1521227704953864202> **Action:** ${actionTaken}\n` +
            `<:Caretright:1521227704953864202> **Time:** <t:${Math.floor(Date.now() / 1000)}:R>`;
        await ch.send({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(content))], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    } catch {}
}

module.exports = { STORE, MAX_TIMEOUT_DAYS, defaults, getConfig, saveConfig, isExempt, handleMessage };
