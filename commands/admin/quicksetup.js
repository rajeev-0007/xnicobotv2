'use strict';

/**
 * QuickSetup — One-click server protection
 * ──────────────────────────────────────────────────────────────────
 * Lets the server owner enable every protection module at once
 * (or pick a subset). Modules currently bundled:
 *
 *   - Anti-Alt   : reject young accounts (< 7 days)
 *   - Anti-Spam  : 10 spam filters → timeout
 *   - Anti-Raid  : join rate + age guard + auto-lockdown
 *   - Anti-Nuke  : 8 audit-log protections (ban/kick/channel/role/webhook/bot)
 *   - AutoMod    : 7 active filters (spam/links/invites/mentions/caps/profanity/slurs)
 *   - Logging    : route all 9 audit log channels to one place
 *   - Threat Mode: optional max-security overlay (stricter limits → kick)
 *
 * Behavior:
 *   - Session is per (user, guild) and lives 5 minutes.
 *   - Default selection: all 5 anti-* modules + Logging on, Threat Mode off.
 *   - Log channel is required when *any* module that supports logging is on.
 *   - Re-applying never wipes user-customized fields (whitelists, bypass
 *     roles, ignored channels, saved threat limits, etc).
 *   - Cache invalidation hooks for every cached module are honoured.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
    PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize,
    StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType
} = require('discord.js');
const { buildErrorResponse } = require('../../utils/responseBuilder');
const trust = require('../../utils/trustManager');
const jsonStore = require('../../utils/jsonStore');

/* ═══════════════════════════════════════════════════════════════════
   MODULE CATALOG
   ═══════════════════════════════════════════════════════════════════ */

const SYSTEMS = {
    antialt: {
        label: 'Anti-Alt',
        emoji: '<:Userblock:1521227822641975366>',
        description: 'Block accounts younger than 7 days',
        details: 'Min age `7 days` · Action: `kick`',
        defaultEnabled: true
    },
    antispam: {
        label: 'Anti-Spam',
        emoji: '<:Lightningalt:1521227851796447472>',
        description: '10 spam filters with timeout action',
        details: 'All 10 filters · Action: `timeout` · Duration: `60s`',
        defaultEnabled: true
    },
    antiraid: {
        label: 'Anti-Raid',
        emoji: '<:Shield:1521227694677692467>',
        description: 'Join rate limit + auto lockdown',
        details: 'Rate: `10/10s` · Age: `7d` · Lockdown: `15` joins · Action: `kick`',
        defaultEnabled: true
    },
    antinuke: {
        label: 'Anti-Nuke',
        emoji: '<:banhammer:1521227777083314529>',
        description: '8 audit-log protections (ban/kick/channels/roles/webhooks/bots)',
        details: 'Limits: `2-3/60s` · Action: `remove_roles` / `kick_bot`',
        defaultEnabled: true
    },
    automod: {
        label: 'AutoMod',
        emoji: '<:Settings:1521227767780343879>',
        description: 'Spam, links, invites, mentions, caps, profanity, slurs',
        details: 'Modules: `7/9` active · Action: `delete`',
        defaultEnabled: true
    },
    logging: {
        label: 'Logging',
        emoji: '<:Document:1521227875016114266>',
        description: 'Route all 9 audit log types to one channel',
        details: 'All 9 log types · Mode: `bot`',
        defaultEnabled: true,
        requiresLogChannel: true
    },
    threatmode: {
        label: 'Threat Mode',
        emoji: '<:Infotriangle:1521227710381428926>',
        description: 'Tighten anti-nuke to 1-2 actions / 30s · `kick` (overlay)',
        details: 'Limits: `1-2/30s` · Action: `kick`',
        defaultEnabled: false,
        requires: ['antinuke']
    }
};

const TIMEOUT_MS = 5 * 60 * 1000;

/* ═══════════════════════════════════════════════════════════════════
   STORE I/O
   ═══════════════════════════════════════════════════════════════════ */

function loadStore(name) { return jsonStore.read(name); }
function saveStore(name, data) { jsonStore.write(name, data); }

/* ═══════════════════════════════════════════════════════════════════
   SECURE PRESETS
   ═══════════════════════════════════════════════════════════════════ */

function presetAntialt() {
    return { enabled: true, minAge: 7 };
}

function presetAntispam(logChannel) {
    return {
        enabled: true,
        action: 'timeout',
        timeoutDuration: 60_000,
        whitelistedRoles: [],
        whitelistedChannels: [],
        logChannel: logChannel || null,
        filters: {
            messageSpam:   { enabled: true, maxMessages: 5, interval: 5000 },
            emojiSpam:     { enabled: true, maxEmojis: 10 },
            capsSpam:      { enabled: true, minLength: 10, maxPercent: 70 },
            linkSpam:      { enabled: true, maxLinks: 3, whitelistedDomains: [] },
            imageSpam:     { enabled: true, maxImages: 3, interval: 10_000 },
            stickerSpam:   { enabled: true, maxStickers: 3, interval: 10_000 },
            mentionSpam:   { enabled: true, maxMentions: 5 },
            duplicateSpam: { enabled: true, maxDuplicates: 3, interval: 30_000 },
            inviteSpam:    { enabled: true },
            newlineSpam:   { enabled: true, maxNewlines: 15 }
        }
    };
}

function presetAntiraid(logChannel) {
    return {
        enabled: true,
        joinRate:           { enabled: true, limit: 10, timeWindow: 10_000, action: 'kick' },
        accountAge:         { enabled: true, minDays: 7, action: 'kick' },
        autoLockdown:       { enabled: true, threshold: 15, duration: 300_000 },
        suspiciousPatterns: { enabled: true, action: 'kick' },
        logChannel:         logChannel || null,
        whitelistedRoles:   [],
        bypassRoleId:       null
    };
}

function presetAntinuke(logChannel) {
    return {
        enabled: true,
        banProtection:    { enabled: true, limit: 3, timeWindow: 60_000, action: 'remove_roles' },
        kickProtection:   { enabled: true, limit: 3, timeWindow: 60_000, action: 'remove_roles' },
        channelDelete:    { enabled: true, limit: 2, timeWindow: 60_000, action: 'remove_roles' },
        channelCreate:    { enabled: true, limit: 3, timeWindow: 60_000, action: 'remove_roles' },
        roleDelete:       { enabled: true, limit: 2, timeWindow: 60_000, action: 'remove_roles' },
        roleCreate:       { enabled: true, limit: 3, timeWindow: 60_000, action: 'remove_roles' },
        webhookCreate:    { enabled: true, limit: 2, timeWindow: 60_000, action: 'remove_roles' },
        botAdd:           { enabled: true, action: 'kick_bot' },
        whitelistedUsers: [],
        whitelistedRoles: [],
        bypassRoleId:     null,
        logChannel:       logChannel || null
    };
}

function presetAutomod(logChannel) {
    return {
        enabled: true,
        badWords:       { enabled: false, words: [], action: 'delete' },
        spam:           { enabled: true, maxMessages: 5, interval: 5000, action: 'delete' },
        links:          { enabled: true, action: 'delete', whitelist: [] },
        invites:        { enabled: true, action: 'delete' },
        massMention:    { enabled: true, maxMentions: 5, action: 'delete' },
        caps:           { enabled: true, percentage: 70, minLength: 10, action: 'delete' },
        profanity:      { enabled: true, action: 'delete' },
        sexualContent:  { enabled: true, action: 'delete' },
        slurs:          { enabled: true, action: 'delete' },
        logChannel:     logChannel || null,
        ignoredRoles:   [],
        ignoredChannels:[],
        bypassRoleId:   null
    };
}

const THREAT_LIMITS = {
    banProtection:  { limit: 2, timeWindow: 30_000, action: 'kick' },
    kickProtection: { limit: 2, timeWindow: 30_000, action: 'kick' },
    channelDelete:  { limit: 1, timeWindow: 30_000, action: 'kick' },
    channelCreate:  { limit: 2, timeWindow: 30_000, action: 'kick' },
    roleDelete:     { limit: 1, timeWindow: 30_000, action: 'kick' },
    roleCreate:     { limit: 2, timeWindow: 30_000, action: 'kick' },
    webhookCreate:  { limit: 1, timeWindow: 30_000, action: 'kick' },
    botAdd:         { action: 'kick_bot' }
};

const LOG_TYPES = ['message', 'member', 'voice', 'server', 'moderation', 'automod', 'security', 'boost', 'commands', 'reactions', 'pins'];

/* ═══════════════════════════════════════════════════════════════════
   APPLY ENGINE
   ═══════════════════════════════════════════════════════════════════ */

const PRESERVE_KEYS = [
    'whitelistedUsers', 'whitelistedRoles', 'whitelistedChannels',
    'ignoredRoles', 'ignoredChannels',
    'bypassRoleId',
    'logChannel',
    '_savedThreatLimits', '_savedLimits',
    'threatMode', 'superThreatMode'  // never wipe overlay flags
];

function applyMerge(generated, existing) {
    const out = { ...generated };
    for (const k of PRESERVE_KEYS) {
        if (existing && existing[k] !== undefined) out[k] = existing[k];
    }
    return out;
}

function fireCacheInvalidation(systemKey, guildId, config) {
    const data = config[guildId];
    if (systemKey === 'antialt'  && global.updateAntialtCache)  global.updateAntialtCache(guildId, data);
    if (systemKey === 'antiraid' && global.updateAntiraidCache) global.updateAntiraidCache(guildId, data);
    if (systemKey === 'antinuke' && global.reloadAntinukeCache) global.reloadAntinukeCache(config);
    if (systemKey === 'automod'  && global.updateAutomodCache)  global.updateAutomodCache(guildId, data);
}

function applyAntialt(guildId, enable) {
    const cfg = loadStore('antialt');
    if (!enable) {
        if (!cfg[guildId] || typeof cfg[guildId] !== 'object') cfg[guildId] = { enabled: false };
        else cfg[guildId].enabled = false;
    } else {
        cfg[guildId] = applyMerge(presetAntialt(), cfg[guildId] || {});
    }
    saveStore('antialt', cfg);
    fireCacheInvalidation('antialt', guildId, cfg);
}

function applyAntispam(guildId, enable, logChannelId) {
    const cfg = loadStore('antispam');
    if (!enable) {
        if (!cfg[guildId] || typeof cfg[guildId] !== 'object') cfg[guildId] = { enabled: false };
        else cfg[guildId].enabled = false;
    } else {
        cfg[guildId] = applyMerge(presetAntispam(logChannelId), cfg[guildId] || {});
        if (logChannelId) cfg[guildId].logChannel = logChannelId; // explicit override
    }
    saveStore('antispam', cfg);
    fireCacheInvalidation('antispam', guildId, cfg);
}

function applyAntiraid(guildId, enable, logChannelId) {
    const cfg = loadStore('antiraid');
    if (!enable) {
        if (!cfg[guildId] || typeof cfg[guildId] !== 'object') cfg[guildId] = { enabled: false };
        else cfg[guildId].enabled = false;
    } else {
        cfg[guildId] = applyMerge(presetAntiraid(logChannelId), cfg[guildId] || {});
        if (logChannelId) cfg[guildId].logChannel = logChannelId;
    }
    saveStore('antiraid', cfg);
    fireCacheInvalidation('antiraid', guildId, cfg);
}

function applyAntinuke(guildId, enable, logChannelId) {
    const cfg = loadStore('antinuke');
    if (!enable) {
        if (!cfg[guildId] || typeof cfg[guildId] !== 'object') cfg[guildId] = { enabled: false };
        else cfg[guildId].enabled = false;
    } else {
        cfg[guildId] = applyMerge(presetAntinuke(logChannelId), cfg[guildId] || {});
        if (logChannelId) cfg[guildId].logChannel = logChannelId;
    }
    saveStore('antinuke', cfg);
    fireCacheInvalidation('antinuke', guildId, cfg);
}

function applyAutomod(guildId, enable, logChannelId) {
    const cfg = loadStore('automod');
    if (!enable) {
        if (!cfg[guildId] || typeof cfg[guildId] !== 'object') cfg[guildId] = { enabled: false };
        else cfg[guildId].enabled = false;
    } else {
        cfg[guildId] = applyMerge(presetAutomod(logChannelId), cfg[guildId] || {});
        if (logChannelId) cfg[guildId].logChannel = logChannelId;
    }
    saveStore('automod', cfg);
    fireCacheInvalidation('automod', guildId, cfg);
}

function applyLogging(guildId, enable, logChannelId) {
    const cfg = loadStore('logs');
    if (!cfg[guildId] || typeof cfg[guildId] !== 'object') cfg[guildId] = {};

    if (!enable) {
        // Don't wipe existing manual setup; just clear the keys we'd have set.
        // (We only ever WROTE to these keys via this wizard, so clearing them
        //  effectively reverts the wizard's work.)
        for (const t of LOG_TYPES) delete cfg[guildId][t];
        saveStore('logs', cfg);
    } else {
        for (const t of LOG_TYPES) cfg[guildId][t] = logChannelId;
        cfg[guildId].mode = cfg[guildId].mode || 'bot';
        saveStore('logs', cfg);
    }

    // Invalidate logger cache so getLogChannel sees the new IDs immediately
    try { require('../../utils/logger').invalidateCache?.(); } catch {}
}

/**
 * Threat Mode: requires antinuke to already be enabled. Stashes the
 * current limits, then patches them with the stricter THREAT_LIMITS.
 * Reverts cleanly on disable by restoring `_savedThreatLimits`.
 */
function applyThreatMode(guildId, enable) {
    const cfg = loadStore('antinuke');
    const guild = cfg[guildId];
    if (!guild || typeof guild !== 'object') return false;
    if (!guild.enabled) return false;

    if (enable) {
        if (guild.superThreatMode) return false; // overlay conflict
        if (!guild.threatMode) {
            // Stash current values so we can restore them later
            guild._savedThreatLimits = {};
            for (const key of Object.keys(THREAT_LIMITS)) {
                guild._savedThreatLimits[key] = guild[key] ? { ...guild[key] } : null;
            }
            for (const [key, val] of Object.entries(THREAT_LIMITS)) {
                guild[key] = { ...(guild[key] || {}), enabled: true, ...val };
            }
            guild.threatMode = true;
        }
    } else {
        if (guild.threatMode && guild._savedThreatLimits) {
            for (const [key, val] of Object.entries(guild._savedThreatLimits)) {
                if (val) guild[key] = val;
            }
            delete guild._savedThreatLimits;
        }
        guild.threatMode = false;
    }

    cfg[guildId] = guild;
    saveStore('antinuke', cfg);
    fireCacheInvalidation('antinuke', guildId, cfg);
    return true;
}

const APPLIERS = {
    antialt:   (gid, enable) => applyAntialt(gid, enable),
    antispam:  (gid, enable, log) => applyAntispam(gid, enable, log),
    antiraid:  (gid, enable, log) => applyAntiraid(gid, enable, log),
    antinuke:  (gid, enable, log) => applyAntinuke(gid, enable, log),
    automod:   (gid, enable, log) => applyAutomod(gid, enable, log),
    logging:   (gid, enable, log) => applyLogging(gid, enable, log),
    threatmode:(gid, enable) => applyThreatMode(gid, enable)
};

function applySystemConfig(guildId, key, enable, logChannelId) {
    try {
        const fn = APPLIERS[key];
        if (!fn) return { ok: false, error: `Unknown system: ${key}` };
        const r = fn(guildId, enable, logChannelId);
        if (r === false) return { ok: false, error: 'Pre-condition failed' };
        return { ok: true };
    } catch (e) {
        console.error(`[QuickSetup] Failed to apply ${key}:`, e);
        return { ok: false, error: e.message || String(e) };
    }
}

/* ═══════════════════════════════════════════════════════════════════
   PANEL UI
   ═══════════════════════════════════════════════════════════════════ */

function buildPanel(session, guild) {
    const enabledKeys   = Object.entries(session.systems).filter(([, v]) => v).map(([k]) => k);
    const enabledCount  = enabledKeys.length;
    const totalSystems  = Object.keys(SYSTEMS).length;
    const logText       = session.logChannelId ? `<#${session.logChannelId}>` : '`Not set`';
    const requiresLog   = enabledKeys.some(k => SYSTEMS[k].requiresLogChannel);
    const missingLogReq = requiresLog && !session.logChannelId;

    // Auto-toggle dependencies (e.g. threatmode ⇒ antinuke)
    const issues = [];
    for (const key of enabledKeys) {
        const reqs = SYSTEMS[key].requires || [];
        for (const dep of reqs) {
            if (!session.systems[dep]) {
                issues.push(`<:Infotriangle:1521227710381428926> **${SYSTEMS[key].label}** requires **${SYSTEMS[dep].label}** to also be selected`);
            }
        }
    }

    const check   = '<:Checkedbox:1521227734943269077>';
    const uncheck = '<:Uncheckbox:1473038543768109076>';

    let header = `# <:Shield:1521227694677692467> Server Protection — Quick Setup\n`;
    header += `-# Apply professional security baselines to **${guild.name}** in one click`;

    const status = enabledCount === 0
        ? `<:idle:1521228053936603257> **No modules selected** — pick at least one below`
        : enabledCount === totalSystems
            ? `<:Settingsadjust:1521228059779403786> **All ${totalSystems} modules selected** — ready to apply`
            : `<:Toggleoff:1521227763816595559> **${enabledCount}/${totalSystems} modules selected**`;

    let modulesText = '### <:Document:1521227875016114266> Protection Modules\n';
    for (const [key, sys] of Object.entries(SYSTEMS)) {
        const on = session.systems[key];
        const icon = on ? check : uncheck;
        modulesText += `${icon} ${sys.emoji} **${sys.label}** — ${sys.description}\n`;
        if (on) modulesText += `-# ╰ ${sys.details}\n`;
    }

    const logSection = `### <:Bookmark:1521227835526742066> Log Channel\n`
        + `**Security logs:** ${logText}\n`
        + (missingLogReq
            ? `-# <:Cancel:1521227723916181644> Required for: ${enabledKeys.filter(k => SYSTEMS[k].requiresLogChannel).map(k => SYSTEMS[k].label).join(', ')}`
            : `-# Used by every selected module that supports it`);

    const issuesText = issues.length
        ? `### <:Infotriangle:1521227710381428926> Setup Warnings\n${issues.join('\n')}`
        : '';

    // ── Toggle select menu ────────────────────────────────────────
    const opts = Object.entries(SYSTEMS).map(([key, sys]) => ({
        label:       sys.label,
        description: `${session.systems[key] ? '✓ Enabled' : '✗ Disabled'} · ${sys.description}`.slice(0, 100),
        value:       key,
        emoji:       sys.emoji,
        default:     session.systems[key]
    }));

    const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('quicksetup_toggle')
            .setPlaceholder('Toggle protection modules…')
            .setMinValues(0)
            .setMaxValues(totalSystems)
            .addOptions(opts)
    );

    // ── Channel picker (real ChannelSelectMenu, not a typed modal) ──
    const channelRow = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('quicksetup_logchannel')
            .setPlaceholder(session.logChannelId ? 'Change log channel…' : 'Select log channel…')
            .setChannelTypes(ChannelType.GuildText)
            .setMinValues(0)
            .setMaxValues(1)
    );

    // ── Bulk + apply controls ────────────────────────────────────
    const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('quicksetup_enable_all')
            .setLabel('Enable All')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:Toggleon:1521227758011809964>')
            .setDisabled(enabledCount === totalSystems),
        new ButtonBuilder()
            .setCustomId('quicksetup_disable_all')
            .setLabel('Disable All')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Toggleoff:1521227763816595559>')
            .setDisabled(enabledCount === 0),
        new ButtonBuilder()
            .setCustomId('quicksetup_clear_log')
            .setLabel('Clear Log Channel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Trash:1521227750420254820>')
            .setDisabled(!session.logChannelId),
        new ButtonBuilder()
            .setCustomId('quicksetup_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('<:Cancel:1521227723916181644>')
    );

    const applyRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('quicksetup_apply')
            .setLabel(`Apply Configuration (${enabledCount} module${enabledCount === 1 ? '' : 's'})`)
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:Shield:1521227694677692467>')
            .setDisabled(enabledCount === 0 || missingLogReq)
    );

    const accent = missingLogReq
        ? 0xED4245
        : enabledCount === 0
            ? 0xCAD7E6
            : enabledCount === totalSystems
                ? 0x57F287
                : 0xFEE75C;

    const container = new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(status))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(modulesText))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(logSection));

    if (issuesText) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(issuesText));
    }

    container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(selectRow)
        .addActionRowComponents(channelRow)
        .addActionRowComponents(controlRow)
        .addActionRowComponents(applyRow)
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# <:Infotriangle:1521227710381428926> Changes are applied only when you click **Apply Configuration**.`
        ));

    return container;
}

function buildResultPanel(results, session, guild) {
    const check = '<:Checkedbox:1521227734943269077>';
    const cross = '<:Cancel:1521227723916181644>';
    const dash  = '<:Toggleoff:1521227763816595559>';

    const enabledSystems  = Object.entries(session.systems).filter(([, v]) => v);
    const disabledSystems = Object.entries(session.systems).filter(([, v]) => !v);
    const successCount    = Object.values(results).filter(r => r.ok).length;
    const failCount       = enabledSystems.length - successCount;
    const logText         = session.logChannelId ? `<#${session.logChannelId}>` : '`Not set`';

    const header = `# <:Shield:1521227694677692467> Setup Complete\n-# Configuration applied to **${guild.name}**`;
    const status = failCount === 0
        ? `<:Toggleon:1521227758011809964> **${successCount} module${successCount === 1 ? '' : 's'} enabled** · ${disabledSystems.length} kept disabled`
        : `<:Cancel:1521227723916181644> **${successCount} enabled, ${failCount} failed** · check bot permissions and try again`;

    let enabledText = '### <:Toggleon:1521227758011809964> Enabled Modules\n';
    if (enabledSystems.length === 0) {
        enabledText += '-# No modules were enabled\n';
    } else {
        for (const [key] of enabledSystems) {
            const sys = SYSTEMS[key];
            const r = results[key] || { ok: false, error: 'Not applied' };
            enabledText += `${r.ok ? check : cross} ${sys.emoji} **${sys.label}** — ${sys.details}`;
            if (!r.ok) enabledText += ` · ${r.error}`;
            enabledText += '\n';
        }
    }

    let disabledText = '';
    if (disabledSystems.length > 0) {
        disabledText = '### <:Toggleoff:1521227763816595559> Skipped Modules\n';
        for (const [key] of disabledSystems) {
            const sys = SYSTEMS[key];
            disabledText += `${dash} ${sys.emoji} ~~${sys.label}~~ — left disabled\n`;
        }
    }

    const tipsSection = `### <:Lightbulbalt:1521227880703463675> What's Next?\n`
        + `<:Caretright:1521227704953864202> Use \`/antinuke\` to add **whitelisted users** (trusted admins)\n`
        + `<:Caretright:1521227704953864202> Use \`/antiraid\` to set a **bypass role** for trusted members\n`
        + `<:Caretright:1521227704953864202> Use \`/automod\` to add **custom bad words**\n`
        + `<:Caretright:1521227704953864202> Use \`/antispam configure\` to fine-tune filter thresholds\n`
        + `<:Caretright:1521227704953864202> Use \`/superthreatmode\` for **maximum lockdown** (limits: 1, action: ban)\n`
        + `<:Caretright:1521227704953864202> Use \`/verification-setup\` to add **captcha gating** for new members`;

    const container = new ContainerBuilder()
        .setAccentColor(failCount === 0 ? 0x57F287 : 0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(status))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(enabledText));

    if (disabledText) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(disabledText));
    }

    container
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### <:Settings:1521227767780343879> Log Channel\n${logText}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(tipsSection))
;

    return container;
}

function buildExpiredPanel() {
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Alarm:1521227869047750689> Setup Session Expired\n`
            + `-# Run \`/quicksetup\` again to start a new session.`
        ))
;
}

/* ═══════════════════════════════════════════════════════════════════
   SESSION STATE
   ═══════════════════════════════════════════════════════════════════ */

const activeSessions = new Map();
const sessionTimers  = new Map();

function getSessionKey(userId, guildId) { return `${userId}_${guildId}`; }

function createSession(logChannelId) {
    const systems = {};
    for (const [k, v] of Object.entries(SYSTEMS)) systems[k] = v.defaultEnabled;
    return {
        systems,
        logChannelId: logChannelId || null,
        createdAt: Date.now()
    };
}

function setSessionTimer(key) {
    const old = sessionTimers.get(key);
    if (old) clearTimeout(old);
    const t = setTimeout(() => {
        activeSessions.delete(key);
        sessionTimers.delete(key);
    }, TIMEOUT_MS);
    if (t.unref) t.unref();
    sessionTimers.set(key, t);
}

function deleteSession(key) {
    activeSessions.delete(key);
    const t = sessionTimers.get(key);
    if (t) { clearTimeout(t); sessionTimers.delete(key); }
}

/* ═══════════════════════════════════════════════════════════════════
   COMMAND
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quicksetup')
        .setDescription('One-click server protection setup with selectable modules')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt => opt
            .setName('log-channel')
            .setDescription('Channel for security logs (optional — pick later)')
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(false)),

    prefix: 'quicksetup',
    description: 'One-click server protection setup with selectable modules',
    usage: 'quicksetup [#log-channel]',
    category: 'admin',
    aliases: ['securitysetup', 'setupsecurity', 'protectserver'],

    // Re-exported for tests / cross-command use
    SYSTEMS,
    applySystemConfig,

    async execute(interaction) {
        if (!trust.isServerOwner(interaction.guild, interaction.user.id)) {
            return interaction.reply({
                components: [buildErrorResponse('Permission Denied', 'Only the **server owner** can run security quick setup.')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }
        try {
            const logChannel = interaction.options.getChannel('log-channel');
            const key = getSessionKey(interaction.user.id, interaction.guild.id);

            const session = createSession(logChannel?.id || null);
            activeSessions.set(key, session);
            setSessionTimer(key);

            const panel = buildPanel(session, interaction.guild);
            await interaction.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        } catch (error) {
            console.error('[QuickSetup] Error:', error);
            return interaction.reply({
                components: [buildErrorResponse('Error', 'An error occurred while preparing security setup.', error.message)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }
    },

    async executePrefix(message, args) {
        if (!trust.isServerOwner(message.guild, message.author.id)) {
            return message.reply({
                components: [buildErrorResponse('Permission Denied', 'Only the **server owner** can run security quick setup.')],
                flags: MessageFlags.IsComponentsV2
            });
        }
        try {
            let logChannelId = null;
            if (args[0]) {
                const id = args[0].replace(/[<#>]/g, '');
                const ch = message.guild.channels.cache.get(id);
                if (ch && ch.type === ChannelType.GuildText) logChannelId = ch.id;
            }
            const key = getSessionKey(message.author.id, message.guild.id);
            const session = createSession(logChannelId);
            activeSessions.set(key, session);
            setSessionTimer(key);

            const panel = buildPanel(session, message.guild);
            await message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[QuickSetup] Error:', error);
            return message.reply({
                components: [buildErrorResponse('Error', 'An error occurred while preparing security setup.', error.message)],
                flags: MessageFlags.IsComponentsV2
            });
        }
    },

    /**
     * Unified router for buttons + selects + the legacy modal id
     * (still routed by index.js for backwards compatibility, but the
     *  primary log-channel picker is now a ChannelSelectMenu).
     */
    async handleInteraction(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('quicksetup_')) return false;

        // Permission re-check on every interaction (in case ownership changed)
        if (!trust.isServerOwner(interaction.guild, interaction.user.id)) {
            await interaction.reply({
                components: [buildErrorResponse('Permission Denied', 'Only the **server owner** can use this panel.')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }

        const key = getSessionKey(interaction.user.id, interaction.guild.id);
        let session = activeSessions.get(key);

        // Cancel works even with no session (user may have come back to a stale message)
        if (customId === 'quicksetup_cancel') {
            deleteSession(key);
            const c = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### <:Cancel:1521227723916181644> Setup Cancelled\n-# No changes were made to your security configuration.`
                ))
;
            await interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (!session) {
            await interaction.update({
                components: [buildExpiredPanel()],
                flags: MessageFlags.IsComponentsV2
            }).catch(async () => {
                await interaction.reply({
                    components: [buildExpiredPanel()],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                }).catch(() => {});
            });
            return true;
        }

        // Refresh TTL on any activity
        setSessionTimer(key);

        // ── Toggle modules via select ──
        if (customId === 'quicksetup_toggle' && interaction.isStringSelectMenu()) {
            const selected = interaction.values;
            for (const k of Object.keys(SYSTEMS)) session.systems[k] = selected.includes(k);

            // Auto-pull dependencies when threatmode toggled on
            for (const k of selected) {
                for (const dep of (SYSTEMS[k].requires || [])) session.systems[dep] = true;
            }

            await interaction.update({ components: [buildPanel(session, interaction.guild)], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        // ── Channel select picker ──
        if (customId === 'quicksetup_logchannel' && interaction.isChannelSelectMenu()) {
            session.logChannelId = interaction.values[0] || null;
            await interaction.update({ components: [buildPanel(session, interaction.guild)], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        // ── Bulk Enable / Disable ──
        if (customId === 'quicksetup_enable_all') {
            for (const k of Object.keys(SYSTEMS)) session.systems[k] = true;
            await interaction.update({ components: [buildPanel(session, interaction.guild)], flags: MessageFlags.IsComponentsV2 });
            return true;
        }
        if (customId === 'quicksetup_disable_all') {
            for (const k of Object.keys(SYSTEMS)) session.systems[k] = false;
            await interaction.update({ components: [buildPanel(session, interaction.guild)], flags: MessageFlags.IsComponentsV2 });
            return true;
        }
        if (customId === 'quicksetup_clear_log') {
            session.logChannelId = null;
            await interaction.update({ components: [buildPanel(session, interaction.guild)], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        // ── Legacy modal path (older button payload) ──
        // Kept for backwards compatibility with deployed sessions that
        // pre-date the channel-select picker. Treats the typed channel
        // ID just like the picker would.
        if (customId === 'quicksetup_modal_log' && interaction.isModalSubmit?.()) {
            const raw = interaction.fields.getTextInputValue('log_channel_id') || '';
            const channelId = raw.replace(/[<#>]/g, '').trim();
            const channel = interaction.guild.channels.cache.get(channelId);
            if (!channel || channel.type !== ChannelType.GuildText) {
                await interaction.reply({
                    components: [buildErrorResponse('Invalid Channel', 'That isn\'t a valid text channel.')],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
                return true;
            }
            session.logChannelId = channelId;
            await interaction.deferUpdate();
            await interaction.editReply({ components: [buildPanel(session, interaction.guild)], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        // ── Apply ──
        if (customId === 'quicksetup_apply') {
            // Final guardrail: refuse to apply if a module that needs a log channel is on but no channel set
            const enabledKeys = Object.entries(session.systems).filter(([, v]) => v).map(([k]) => k);
            const needsLog = enabledKeys.some(k => SYSTEMS[k].requiresLogChannel);
            if (needsLog && !session.logChannelId) {
                await interaction.reply({
                    components: [buildErrorResponse(
                        'Log Channel Required',
                        `The Logging module needs a target channel. Pick one from the menu above and try again.`
                    )],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
                return true;
            }

            await interaction.deferUpdate();

            // Resolve dependency order: anti-* modules first, threatmode after antinuke
            const ORDER = ['antialt', 'antispam', 'antiraid', 'antinuke', 'automod', 'logging', 'threatmode'];
            const results = {};

            for (const key of ORDER) {
                const enabled = !!session.systems[key];
                if (enabled) {
                    results[key] = applySystemConfig(interaction.guild.id, key, true, session.logChannelId);
                } else {
                    // Best-effort disable — don't surface errors for already-off modules
                    applySystemConfig(interaction.guild.id, key, false, session.logChannelId);
                }
            }

            deleteSession(key);

            const resultPanel = buildResultPanel(results, session, interaction.guild);
            await interaction.editReply({ components: [resultPanel], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        return false;
    }
};
