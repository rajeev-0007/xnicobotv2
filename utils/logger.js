'use strict';

const {
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    SectionBuilder, ThumbnailBuilder, AuditLogEvent, MessageFlags, ChannelType,
    WebhookClient, EmbedBuilder
} = require('discord.js');

const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

/* ═══════════════════════════════════════════════════════
   ACCENT COLORS  (used for ContainerBuilder)
   ═══════════════════════════════════════════════════════ */
const Colors = {
    success:    0x57F287,
    error:      0xED4245,
    warning:    0xFEE75C,
    info:       0xCAD7E6,
    muted:      0x99AAB5,
    moderation: 0xE67E22,
    join:       0x57F287,
    leave:      0xED4245,
    update:     0xCAD7E6,
    voice:      0x9B59B6,
    server:     0x3498DB,
    thread:     0x1ABC9C,
    invite:     0xE91E63,
    timeout:    0xF39C12,
    emoji:      0xE67E22,
    boost:      0xF47FFF,
};

/* ═══════════════════════════════════════════════════════
   CUSTOM EMOJIS
   ═══════════════════════════════════════════════════════ */
const E = {
    success:    '<:Checkedbox:1521227734943269077>',
    error:      '<:Cancel:1521227723916181644>',
    settings:   '<:Settings:1521227767780343879>',
    shield:     '<:Shield:1521227694677692467>',
    moderate:   '<:banhammer:1521227777083314529>',
    pin:        '<:Pin:1521227932625014916>',
    mail:       '<:Envelope:1521228013910626426>',
    read:       '<:Bookopen:1521227911137595605>',
    messages:   '<:Hashtag:1521227771957870604>',
    info:       '<:Inforect:1521228008285929532>',
    stats:      '<:Lightning:1521227915537285150>',
    discord:    '<:xnico:1521228240440660180>',
    shine:      '<:Fire:1521227907647668374>',
    volume:     '<:Volumeup:1521228004502536272>',
    mute:       '<:Volumeoff:1521228297864745193>',
    link:       '<:Attach:1521228039135170722>',
    bolt:       '<:Lightning:1521227915537285150>',
    announce:   '<:Bullhorn:1521227936575914016>',
    dot:        '<:Caretright:1521227704953864202>',
    giveaway:   '<:Money:1521228266957045900>',
    games:      '<:Gamepad:1521228035213230090>',
    folder:     '<:Folder:1521228095225331765>',
    palette:    '<:Palette:1521227950601539755>',
    wdot:       '<:Server:1521228371051413546>',
    voice:      '<:Microphone:1521227746376683590>',
    boost:      '<:Sketch:1521228025365004471>',
    clock:      '<:Clock:1521228110408847623>',
    user:       '<:User:1521227714227343380>',
    copy:       '<:Copy:1521227960554881084>',
    eye:        '<:Eye:1521227940480815156>',
    lock:       '<:Lock:1521227892770734120>',
    unlock:     '<:Unlock:1521228030842769610>',
};

/* ═══════════════════════════════════════════════════════
   CONFIG HELPERS (cached)
   ═══════════════════════════════════════════════════════ */
let _logsCache = null;
let _logsCacheTime = 0;
const CACHE_TTL = 10_000;

function loadLogs() {
    const now = Date.now();
    if (_logsCache && (now - _logsCacheTime) < CACHE_TTL) return _logsCache;
    try {
        if (!jsonStore.has('logs')) return {};
        _logsCache = jsonStore.read('logs');
        _logsCacheTime = now;
        return _logsCache;
    } catch { return {}; }
}

function invalidateCache() { _logsCache = null; }

function getLogChannel(guild, type) {
    const logs = loadLogs();
    const guildLogs = logs[guild.id];
    if (!guildLogs || !guildLogs[type]) return null;
    return guild.channels.cache.get(guildLogs[type]);
}

/**
 * Get the log delivery mode for a guild ('bot' or 'webhook').
 * Defaults to 'bot' if not configured.
 */
function getLogMode(guild) {
    const logs = loadLogs();
    const guildLogs = logs[guild.id];
    if (!guildLogs) return 'bot';
    return guildLogs.mode || 'bot';
}

/**
 * Get the webhook URL for a specific log type in a guild.
 * Returns null if not configured.
 */
function getLogWebhook(guild, type) {
    const logs = loadLogs();
    const guildLogs = logs[guild.id];
    if (!guildLogs || !guildLogs.webhooks || !guildLogs.webhooks[type]) return null;
    return guildLogs.webhooks[type];
}

/**
 * Remove a dead/invalid webhook URL from a guild's logging config so the bot
 * stops retrying it (which otherwise spams the console on every log event).
 * If no webhooks remain for the guild, it reverts to bot-channel mode.
 */
function disableLogWebhook(guildId, type) {
    try {
        if (!jsonStore.has('logs')) return;
        const logs = jsonStore.read('logs');
        const g = logs[guildId];
        if (!g || !g.webhooks || !g.webhooks[type]) return;

        delete g.webhooks[type];
        if (Object.keys(g.webhooks).length === 0) {
            g.mode = 'bot'; // no webhooks left — fall back to channel logging
        }
        jsonStore.write('logs', logs);
        invalidateCache();
    } catch { /* non-fatal */ }
}

/* ═══════════════════════════════════════════════════════
   FILTERS — per-guild ignore lists (users/channels/bots) and
   per-type toggles. Stored under `logs[guildId].filters`.
   Layout:
     filters: {
       ignoredUsers:    [userId, ...],
       ignoredChannels: [channelId, ...],
       ignoredRoles:    [roleId, ...],
       ignoreBots:      true|false,
       disabledTypes:   [type, ...],   // soft-disable a log type without deleting its channel
     }
   ═══════════════════════════════════════════════════════ */
function getFilters(guild) {
    if (!guild) return null;
    const logs = loadLogs();
    const g = logs[guild.id];
    return g?.filters || null;
}

/**
 * Should this event be skipped due to per-guild filters?
 *
 * @param {import('discord.js').Guild} guild
 * @param {string} type      log category key
 * @param {Object} subject   { user?, channel?, member? } — any combination
 * @returns {boolean} true if the event should be skipped
 */
function isFiltered(guild, type, subject = {}) {
    const f = getFilters(guild);
    if (!f) return false;

    if (Array.isArray(f.disabledTypes) && f.disabledTypes.includes(type)) return true;

    const userId = subject.user?.id || subject.member?.id || subject.member?.user?.id;
    if (userId && Array.isArray(f.ignoredUsers) && f.ignoredUsers.includes(userId)) return true;

    if (f.ignoreBots && (subject.user?.bot || subject.member?.user?.bot)) return true;

    const channelId = subject.channel?.id;
    if (channelId && Array.isArray(f.ignoredChannels) && f.ignoredChannels.includes(channelId)) return true;

    if (Array.isArray(f.ignoredRoles) && f.ignoredRoles.length > 0) {
        const roles = subject.member?.roles?.cache;
        if (roles) {
            for (const id of f.ignoredRoles) if (roles.has(id)) return true;
        }
    }
    return false;
}

/* ═══════════════════════════════════════════════════════
   AUDIT-LOG EXECUTOR LOOKUP
   ═══════════════════════════════════════════════════════ */
const _auditCache = new Map();        // key: `${guildId}:${type}:${targetId}` -> { entry, time }
const AUDIT_CACHE_TTL = 5_000;

/**
 * Best-effort lookup of who performed an audit-log-worthy action.
 * Returns `{ executor, reason, entry } | null`. Falls back to `null`
 * silently if the bot lacks ViewAuditLog or the entry is too old.
 *
 * Why filter by createdTimestamp: audit log entries are kept forever, so
 * matching by target id alone would attribute future moderation events
 * to whoever last touched that user (false positives).
 *
 * @param {import('discord.js').Guild} guild
 * @param {number} type        AuditLogEvent.* enum value
 * @param {string} [targetId]  filter to a specific target id
 * @param {number} [maxAgeMs=10000]  reject entries older than this
 */
async function fetchExecutor(guild, type, targetId, maxAgeMs = 10_000) {
    if (!guild) return null;
    const cacheKey = `${guild.id}:${type}:${targetId || '*'}`;
    const cached = _auditCache.get(cacheKey);
    if (cached && (Date.now() - cached.time) < AUDIT_CACHE_TTL) return cached.value;

    try {
        const auditLogs = await guild.fetchAuditLogs({ type, limit: 4 });
        for (const entry of auditLogs.entries.values()) {
            if (targetId && entry.target?.id !== targetId) continue;
            if ((Date.now() - entry.createdTimestamp) > maxAgeMs) continue;
            const value = { executor: entry.executor, reason: entry.reason || null, entry };
            _auditCache.set(cacheKey, { value, time: Date.now() });
            return value;
        }
    } catch {
        // Bot likely missing ViewAuditLog — fail soft.
    }
    _auditCache.set(cacheKey, { value: null, time: Date.now() });
    return null;
}

/* ═══════════════════════════════════════════════════════
   VOICE DURATION TRACKING
   Tracks join timestamps per (guildId, userId) so leave/switch
   events can render "spent 23m 14s in #vc-name".
   ═══════════════════════════════════════════════════════ */
const _voiceJoinTimes = new Map();     // `${guildId}:${userId}` -> { channelId, joinedAt }

function _voiceKey(guildId, userId) { return `${guildId}:${userId}`; }

function _formatDuration(ms) {
    if (!ms || ms < 0) return 'less than a second';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    if (min < 60) return remSec ? `${min}m ${remSec}s` : `${min}m`;
    const hr = Math.floor(min / 60);
    const remMin = min % 60;
    if (hr < 24) return remMin ? `${hr}h ${remMin}m` : `${hr}h`;
    const day = Math.floor(hr / 24);
    const remHr = hr % 24;
    return remHr ? `${day}d ${remHr}h` : `${day}d`;
}

/**
 * Format a "by whom" footer line for moderation logs. Always returns a
 * single string — never null — so callers can interpolate freely.
 */
function _byLine(executor, reason) {
    if (!executor) return `${E.shield} **Moderator:** *Unknown* (no audit-log entry within 10s)`;
    const tag = executor.tag || executor.username || executor.id;
    let line = `${E.shield} **Moderator:** ${tag} (\`${executor.id}\`)`;
    if (reason) line += `\n${E.read} **Reason:** ${reason}`;
    else line += `\n${E.read} **Reason:** *No reason provided*`;
    return line;
}

/**
 * Format a user identity line consistently across all logs.
 * Includes username, mention, and id.
 */
function _userLine(user, label = 'User') {
    if (!user) return `${E.user} **${label}:** *Unknown*`;
    const tag = user.tag || user.username || user.id;
    return `${E.user} **${label}:** ${tag} (<@${user.id}>) \`${user.id}\``;
}

/**
 * Format a channel identity line (mention + name + id).
 */
function _channelLine(channel, label = 'Channel') {
    if (!channel) return `${E.pin} **${label}:** *Unknown*`;
    const mention = channel.toString?.() || `<#${channel.id}>`;
    return `${E.pin} **${label}:** ${mention} (\`${channel.id}\`)`;
}

/* Webhook client cache to avoid recreating clients repeatedly */
const _webhookClients = new Map();
const WEBHOOK_CACHE_TTL = 300_000; // 5 minutes

function getOrCreateWebhookClient(url) {
    const cached = _webhookClients.get(url);
    if (cached && (Date.now() - cached.time) < WEBHOOK_CACHE_TTL) return cached.client;
    try {
        const client = new WebhookClient({ url });
        _webhookClients.set(url, { client, time: Date.now() });
        return client;
    } catch {
        return null;
    }
}

/* ═══════════════════════════════════════════════════════
   V2 COMPONENT HELPERS
   ═══════════════════════════════════════════════════════ */
function ts(date = new Date()) { return `<t:${Math.floor(date.getTime() / 1000)}:F>`; }
function tsR(date) { return `<t:${Math.floor(date.getTime() / 1000)}:R>`; }

function buildLogContainer(accentColor) {
    return new ContainerBuilder().setAccentColor(accentColor);
}

function text(content) {
    return new TextDisplayBuilder().setContent(content);
}

function separator(small = true) {
    return new SeparatorBuilder().setSpacing(small ? SeparatorSpacingSize.Small : SeparatorSpacingSize.Large).setDivider(true);
}

function section(textContent, thumbnailUrl) {
    const s = new SectionBuilder()
        .addTextDisplayComponents(text(textContent));
    if (thumbnailUrl) {
        s.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl));
    }
    return s;
}

/**
 * Send a log message. Supports both bot channel messages and webhook delivery.
 * All log messages suppress pings — mentions display as text but never notify.
 * @param {import('discord.js').TextChannel} channel - The log channel
 * @param {ContainerBuilder} container - The Components V2 container
 * @param {import('discord.js').Guild} [guild] - The guild (needed for webhook mode lookup)
 * @param {string} [logType] - The log type key (message/member/voice/server/moderation)
 */
async function sendLog(channel, container, guild, logType) {
    const noMentions = { parse: [] }; // Suppress ALL pings (users, roles, everyone)

    // Check if webhook mode is enabled and a webhook URL is configured
    if (guild && logType) {
        const mode = getLogMode(guild);
        if (mode === 'webhook') {
            const webhookUrl = getLogWebhook(guild, logType);
            if (webhookUrl) {
                try {
                    const webhookClient = getOrCreateWebhookClient(webhookUrl);
                    if (webhookClient) {
                        await webhookClient.send({
                            components: [container],
                            allowedMentions: noMentions,
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications
                        });
                        return;
                    }
                } catch (whErr) {
                    // Dead/invalid webhook → remove it from config so we stop
                    // retrying it on every event (that was the source of console
                    // spam). Then fall through to the bot-channel message.
                    const code = whErr?.code;
                    const msg = whErr?.message || '';
                    const isDead = code === 10015 // Unknown Webhook
                        || code === 50027         // Invalid Webhook Token
                        || /unknown webhook|invalid webhook token|404/i.test(msg);

                    if (isDead) {
                        disableLogWebhook(guild.id, logType);
                        _webhookClients.delete(webhookUrl);
                        log.debug(`Logger: removed dead webhook for ${logType} in ${guild.id}`);
                    } else {
                        log.debug(`Logger: webhook send failed for ${logType} in ${guild.id}: ${msg}`);
                    }
                }
            }
            // If webhook URL is missing but mode is webhook, fall through to bot send
        }
    }

    // Bot channel message (default) – suppress notifications and all pings
    try {
        await channel.send({
            components: [container],
            allowedMentions: noMentions,
            flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications
        });
    } catch (error) {
        try {
            await channel.send({
                components: [container],
                allowedMentions: noMentions,
                flags: MessageFlags.SuppressNotifications
            });
        } catch (e) {
            log.error('Logger: Failed to send log:', e.message);
        }
    }
}

/* ═══════════════════════════════════════════════════════
   <:Editalt:1521227921673556019> MESSAGE LOGS
   ═══════════════════════════════════════════════════════ */

async function logMessageDelete(message) {
    if (!message.guild || message.author?.bot && getFilters(message.guild)?.ignoreBots !== false) {
        // Default: skip bot-author deletions unless filter explicitly allows them
        if (message.author?.bot) return;
    }
    if (isFiltered(message.guild, 'message', { user: message.author, channel: message.channel, member: message.member })) return;
    const channel = getLogChannel(message.guild, 'message');
    if (!channel) return;

    const content = message.content
        ? (message.content.length > 1000 ? message.content.substring(0, 997) + '...' : message.content)
        : '*No text content*';

    let attachments = '';
    if (message.attachments?.size > 0) {
        attachments = message.attachments.map(a => `> ${E.link} [${a.name || 'file'}](${a.proxyURL})`).slice(0, 5).join('\n');
        if (message.attachments.size > 5) attachments += `\n> *...and ${message.attachments.size - 5} more*`;
    }

    // Best-effort executor lookup (admin/mod deleting another user's message
    // shows up in audit logs as MessageDelete; self-deletes don't).
    const audit = await fetchExecutor(message.guild, AuditLogEvent.MessageDelete, message.author?.id);
    const deletedBy = audit?.executor && audit.executor.id !== message.author?.id
        ? `\n${E.shield} **Deleted by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>) \`${audit.executor.id}\``
        : `\n${E.shield} **Deleted by:** Author (self-delete)`;

    const messageAge = message.createdTimestamp
        ? `\n${E.clock} **Sent:** ${tsR(message.createdAt)}`
        : '';

    const c = buildLogContainer(Colors.error);
    c.addSectionComponents(
        section(
            `# ${E.error} Message Deleted\n` +
            `${_userLine(message.author, 'Author')}\n` +
            `${_channelLine(message.channel)}` +
            deletedBy +
            messageAge,
            message.author?.displayAvatarURL?.({ size: 128 }) || undefined
        )
    );
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(
        `### ${E.read} Content\n` +
        `>>> ${content}`
    ));

    if (attachments) {
        c.addSeparatorComponents(separator());
        c.addTextDisplayComponents(text(`### ${E.link} Attachments\n${attachments}`));
    }

    if (audit?.reason) {
        c.addSeparatorComponents(separator());
        c.addTextDisplayComponents(text(`### ${E.info} Audit Reason\n> ${audit.reason}`));
    }

    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Message ID: ${message.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, message.guild, 'message');
}

async function logMessageUpdate(oldMessage, newMessage) {
    if (!newMessage.guild || newMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;
    if (isFiltered(newMessage.guild, 'message', { user: newMessage.author, channel: newMessage.channel, member: newMessage.member })) return;
    const channel = getLogChannel(newMessage.guild, 'message');
    if (!channel) return;

    const before = oldMessage.content
        ? (oldMessage.content.length > 500 ? oldMessage.content.substring(0, 497) + '...' : oldMessage.content)
        : '*No content*';
    const after = newMessage.content
        ? (newMessage.content.length > 500 ? newMessage.content.substring(0, 497) + '...' : newMessage.content)
        : '*No content*';

    const editedAfter = oldMessage.createdTimestamp
        ? `${E.clock} **Edited after:** ${_formatDuration(Date.now() - oldMessage.createdTimestamp)}\n`
        : '';

    const c = buildLogContainer(Colors.warning);
    c.addSectionComponents(
        section(
            `# ${E.settings} Message Edited\n` +
            `${_userLine(newMessage.author, 'Author')}\n` +
            `${_channelLine(newMessage.channel)}\n` +
            editedAfter +
            `${E.link} **[Jump to Message](${newMessage.url})**`,
            newMessage.author.displayAvatarURL({ size: 128 })
        )
    );
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(
        `### ${E.error} Before\n>>> ${before}`
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(
        `### ${E.success} After\n>>> ${after}`
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Message ID: ${newMessage.id} • User ID: ${newMessage.author.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, newMessage.guild, 'message');
}

async function logMessageBulkDelete(messages, ch) {
    if (!ch.guild) return;
    if (isFiltered(ch.guild, 'message', { channel: ch })) return;
    const logChannel = getLogChannel(ch.guild, 'message');
    if (!logChannel) return;

    const uniqueAuthors = [...new Set(messages.filter(m => m.author).map(m => m.author.id))];
    const msgArray = [...messages.values()];
    const preview = msgArray
        .filter(m => m.content)
        .slice(0, 5)
        .map(m => `> **${m.author?.username || 'Unknown'}:** ${m.content.substring(0, 80)}${m.content.length > 80 ? '...' : ''}`)
        .join('\n');

    // Best-effort moderator lookup — bulk-delete is audit-logged.
    const audit = await fetchExecutor(ch.guild, AuditLogEvent.MessageBulkDelete);
    const byLine = audit?.executor
        ? `\n${E.shield} **Performed by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>) \`${audit.executor.id}\``
        : '';

    const c = buildLogContainer(Colors.error);
    c.addTextDisplayComponents(text(
        `# ${E.error} Bulk Message Delete\n` +
        `${E.messages} **Messages Deleted:** ${messages.size}\n` +
        `${_channelLine(ch)}\n` +
        `${E.discord} **Unique Authors:** ${uniqueAuthors.length}` +
        byLine +
        (audit?.reason ? `\n${E.read} **Reason:** ${audit.reason}` : '')
    ));
    if (preview) {
        c.addSeparatorComponents(separator());
        c.addTextDisplayComponents(text(`### ${E.read} Preview\n${preview}`));
    }
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Channel ID: ${ch.id} • ${tsR(new Date())}`));

    await sendLog(logChannel, c, ch.guild, 'message');
}

/* ═══════════════════════════════════════════════════════
   <:User:1521227714227343380> MEMBER LOGS
   ═══════════════════════════════════════════════════════ */

async function logMemberJoin(member) {
    if (isFiltered(member.guild, 'member', { user: member.user, member })) return;
    const channel = getLogChannel(member.guild, 'member');
    if (!channel) return;

    const accountAge = Date.now() - member.user.createdTimestamp;
    const days = Math.floor(accountAge / (1000 * 60 * 60 * 24));
    const risk = days < 1 ? `${E.error} **Very New (< 1 day)** — possible alt`
              : days < 7 ? `${E.info} **New Account (${days}d)**`
              : days < 30 ? `${E.success} **Recent (${days}d)**`
              :              `${E.success} **Established (${days}d)**`;

    // Best-effort invite-tracker lookup — see utils/inviteManager for the
    // before/after diff. This shows which invite link they came in through.
    let inviteLine = '';
    try {
        const { inviteCache } = require('./inviteManager');
        const cached = inviteCache.get(member.guild.id);
        if (cached?.lastUsedInvite?.userId === member.id && cached.lastUsedInvite.code) {
            const inv = cached.lastUsedInvite;
            inviteLine = `\n${E.link} **Invite:** \`${inv.code}\` by ${inv.inviterId ? `<@${inv.inviterId}>` : '*Unknown*'} (${inv.uses || '?'} uses)`;
        }
    } catch { /* invite manager optional */ }

    const c = buildLogContainer(Colors.join);
    c.addSectionComponents(
        section(
            `# ${E.success} Member Joined\n` +
            `${_userLine(member.user, 'User')}\n` +
            `${E.stats} **Member #${member.guild.memberCount}**` +
            inviteLine,
            member.user.displayAvatarURL({ size: 256 })
        )
    );
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(
        `### ${E.info} Account Info\n` +
        `> ${E.read} **Created:** ${tsR(member.user.createdAt)} (\`${days}d ago\`)\n` +
        `> ${E.shield} **Risk Level:** ${risk}\n` +
        `> ${E.moderate} **Bot:** ${member.user.bot ? 'Yes' : 'No'}\n` +
        `> ${E.discord} **System User:** ${member.user.system ? 'Yes' : 'No'}`
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} User ID: ${member.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, member.guild, 'member');
}

async function logMemberLeave(member) {
    if (isFiltered(member.guild, 'member', { user: member.user, member })) return;
    const channel = getLogChannel(member.guild, 'member');
    if (!channel) return;
    if (!member.user) return;

    const roles = member.roles?.cache
        ?.filter(r => r.id !== member.guild.id)
        ?.sort((a, b) => b.position - a.position)
        ?.map(r => r.toString())
        ?.slice(0, 15) || [];

    let rolesDisplay = roles.length > 0 ? roles.join(' ') : '*No roles*';
    if (rolesDisplay.length > 900) rolesDisplay = rolesDisplay.substring(0, 897) + '...';

    const memberDuration = member.joinedAt
        ? _formatDuration(Date.now() - member.joinedAt.getTime())
        : 'Unknown';

    // Best-effort kick detection. If the audit log has a recent
    // MemberKick entry for this user, surface it here instead of
    // showing a generic "left" event so mods see the cause.
    const kickAudit = await fetchExecutor(member.guild, AuditLogEvent.MemberKick, member.id);
    const isKick = !!kickAudit?.executor;

    const headerEmoji = isKick ? E.moderate : E.error;
    const headerLabel = isKick ? 'Member Kicked' : 'Member Left';
    const accent = isKick ? Colors.moderation : Colors.leave;

    const causeBlock = isKick
        ? `\n${E.shield} **Kicked by:** ${kickAudit.executor.tag || kickAudit.executor.username} (<@${kickAudit.executor.id}>) \`${kickAudit.executor.id}\`` +
          `\n${E.read} **Reason:** ${kickAudit.reason || '*No reason provided*'}`
        : '';

    const c = buildLogContainer(accent);
    c.addSectionComponents(
        section(
            `# ${headerEmoji} ${headerLabel}\n` +
            `${_userLine(member.user, 'User')}\n` +
            `${E.stats} **Members Now:** ${member.guild.memberCount}` +
            causeBlock,
            member.user.displayAvatarURL?.({ size: 256 }) || undefined
        )
    );
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(
        `### ${E.info} Membership Info\n` +
        `> ${E.read} **Joined:** ${member.joinedAt ? tsR(member.joinedAt) : 'Unknown'}\n` +
        `> ${E.clock} **Time in Server:** ${memberDuration}\n` +
        `> ${E.palette} **Roles Had:** ${rolesDisplay}`
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} User ID: ${member.id} • ${tsR(new Date())}`));

    // Kicks should also reach the moderation log if configured.
    await sendLog(channel, c, member.guild, 'member');
    if (isKick) {
        const modChannel = getLogChannel(member.guild, 'moderation');
        if (modChannel && modChannel.id !== channel.id) {
            await sendLog(modChannel, c, member.guild, 'moderation');
        }
    }
}

async function logMemberUpdate(oldMember, newMember) {
    if (isFiltered(newMember.guild, 'member', { user: newMember.user, member: newMember })) return;
    const channel = getLogChannel(newMember.guild, 'member');
    if (!channel) return;

    const changes = [];

    // Nickname change — attribute via audit log when changed by another user.
    if (oldMember.nickname !== newMember.nickname) {
        const audit = await fetchExecutor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
        const by = audit?.executor && audit.executor.id !== newMember.id
            ? ` *by ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>)*`
            : ' *(self)*';
        changes.push(
            `### ${E.settings} Nickname Changed${by}\n` +
            `> ${E.error} **Before:** ${oldMember.nickname || '*None*'}\n` +
            `> ${E.success} **After:** ${newMember.nickname || '*None*'}`
        );
    }

    // Role changes — also audit-attributed.
    const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));

    if (addedRoles.size > 0 || removedRoles.size > 0) {
        const audit = await fetchExecutor(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
        const by = audit?.executor
            ? ` *by ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>)*`
            : '';
        if (addedRoles.size > 0) {
            changes.push(`### ${E.success} Roles Added${by}\n> ${addedRoles.map(r => r.toString()).join(' ')}`);
        }
        if (removedRoles.size > 0) {
            changes.push(`### ${E.error} Roles Removed${by}\n> ${removedRoles.map(r => r.toString()).join(' ')}`);
        }
    }

    // Server-specific avatar change
    if (oldMember.avatar !== newMember.avatar) {
        const oldAvatar = oldMember.avatar ? oldMember.displayAvatarURL({ size: 256 }) : null;
        const newAvatar = newMember.avatar ? newMember.displayAvatarURL({ size: 256 }) : null;
        changes.push(
            `### ${E.palette} Server Avatar Changed\n` +
            `> ${E.error} **Before:** ${oldAvatar ? `[Old Avatar](${oldAvatar})` : '*None*'}\n` +
            `> ${E.success} **After:** ${newAvatar ? `[New Avatar](${newAvatar})` : '*None*'}`
        );
    }

    // Timeout change — surface moderator + reason via MemberUpdate audit entry.
    if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
        const audit = await fetchExecutor(newMember.guild, AuditLogEvent.MemberUpdate, newMember.id);
        const by = audit?.executor
            ? `\n> ${E.shield} **Moderator:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>)`
            : '';
        const reason = audit?.reason ? `\n> ${E.read} **Reason:** ${audit.reason}` : '';
        if (newMember.communicationDisabledUntilTimestamp && newMember.communicationDisabledUntilTimestamp > Date.now()) {
            changes.push(
                `### ${E.mute} Member Timed Out\n` +
                `> ${E.moderate} **Until:** <t:${Math.floor(newMember.communicationDisabledUntilTimestamp / 1000)}:F>\n` +
                `> ${E.clock} **Expires:** ${tsR(new Date(newMember.communicationDisabledUntilTimestamp))}` +
                by + reason
            );
        } else if (oldMember.communicationDisabledUntilTimestamp && (!newMember.communicationDisabledUntilTimestamp || newMember.communicationDisabledUntilTimestamp <= Date.now())) {
            changes.push(`### ${E.success} Timeout Removed\n> ${E.shine} Member can speak again` + by + reason);
        }
    }

    // Boost status
    if (!oldMember.premiumSince && newMember.premiumSince) {
        changes.push(`### ${E.boost} Started Boosting\n> ${E.shine} Now boosting the server!`);
    } else if (oldMember.premiumSince && !newMember.premiumSince) {
        changes.push(`### ${E.error} Stopped Boosting\n> Member is no longer boosting`);
    }

    // Pending verification
    if (oldMember.pending && !newMember.pending) {
        changes.push(`### ${E.success} Passed Membership Screening\n> Member completed the membership gate`);
    }

    if (changes.length === 0) return;

    const c = buildLogContainer(Colors.update);
    c.addSectionComponents(
        section(
            `# ${E.settings} Member Updated\n` +
            `${_userLine(newMember.user, 'User')}`,
            newMember.user.displayAvatarURL({ size: 128 })
        )
    );

    for (const change of changes) {
        c.addSeparatorComponents(separator());
        c.addTextDisplayComponents(text(change));
    }

    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} User ID: ${newMember.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, newMember.guild, 'member');
}

/* ═══════════════════════════════════════════════════════
   <:Bookopen:1521227911137595605> USER UPDATE LOGS (avatar, username, global name, banner)
   ═══════════════════════════════════════════════════════ */

async function logUserUpdate(oldUser, newUser, client) {
    const guilds = client.guilds.cache.filter(g => g.members.cache.has(newUser.id));

    for (const [, guild] of guilds) {
        const channel = getLogChannel(guild, 'member');
        if (!channel) continue;

        const changes = [];

        // Username change
        if (oldUser.username !== newUser.username) {
            changes.push(
                `### ${E.settings} Username Changed\n` +
                `> ${E.error} **Before:** \`${oldUser.username}\`\n` +
                `> ${E.success} **After:** \`${newUser.username}\``
            );
        }

        // Display name (global name) change
        if (oldUser.globalName !== newUser.globalName) {
            changes.push(
                `### ${E.shine} Display Name Changed\n` +
                `> ${E.error} **Before:** ${oldUser.globalName || '*None*'}\n` +
                `> ${E.success} **After:** ${newUser.globalName || '*None*'}`
            );
        }

        // Avatar change
        if (oldUser.avatar !== newUser.avatar) {
            const oldUrl = oldUser.avatar ? oldUser.displayAvatarURL({ size: 256 }) : null;
            const newUrl = newUser.avatar ? newUser.displayAvatarURL({ size: 256 }) : null;
            changes.push(
                `### ${E.palette} Avatar Changed\n` +
                `> ${E.error} **Before:** ${oldUrl ? `[Old Avatar](${oldUrl})` : '*Default*'}\n` +
                `> ${E.success} **After:** ${newUrl ? `[New Avatar](${newUrl})` : '*Default*'}`
            );
        }

        // Banner change
        if (oldUser.banner !== newUser.banner) {
            changes.push(`### ${E.palette} Banner Changed\n> User updated their profile banner`);
        }

        // Discriminator change
        if (oldUser.discriminator !== newUser.discriminator) {
            changes.push(
                `### ${E.discord} Discriminator Changed\n` +
                `> **Before:** #${oldUser.discriminator} → **After:** #${newUser.discriminator}`
            );
        }

        if (changes.length === 0) continue;

        const c = buildLogContainer(Colors.update);
        c.addSectionComponents(
            section(
                `# ${E.discord} User Profile Updated\n` +
                `${E.shine} **User:** ${newUser.username} (\`${newUser.id}\`)\n` +
                `${E.discord} **User ID:** \`${newUser.id}\``,
                newUser.displayAvatarURL({ size: 256 })
            )
        );

        for (const change of changes) {
            c.addSeparatorComponents(separator());
            c.addTextDisplayComponents(text(change));
        }

        c.addSeparatorComponents(separator());
        c.addTextDisplayComponents(text(`-# ${E.wdot} User ID: ${newUser.id} • ${tsR(new Date())}`));

        await sendLog(channel, c, guild, 'member');
    }
}

/* ═══════════════════════════════════════════════════════
   <:Volumeup:1521228004502536272> VOICE LOGS
   ═══════════════════════════════════════════════════════ */

async function logVoiceStateUpdate(oldState, newState) {
    if (isFiltered(newState.guild, 'voice', { user: newState.member?.user, member: newState.member, channel: newState.channel || oldState.channel })) return;
    const channel = getLogChannel(newState.guild, 'voice');
    if (!channel) return;

    const member = newState.member;
    if (!member || !member.user) return;

    const avatar = member.user.displayAvatarURL?.({ size: 128 }) || undefined;
    const tag = member.user.username || 'Unknown User';

    // Voice Join — record time so leave/switch can show duration.
    if (!oldState.channel && newState.channel) {
        _voiceJoinTimes.set(_voiceKey(newState.guild.id, member.id), {
            channelId: newState.channel.id,
            joinedAt: Date.now(),
        });
        const memberCount = newState.channel.members?.size || 1;
        const c = buildLogContainer(Colors.join);
        c.addSectionComponents(
            section(
                `# ${E.success} Voice Channel Join\n` +
                `${_userLine(member.user, 'User')}\n` +
                `${E.volume} **Channel:** ${newState.channel} (\`${newState.channel.id}\`)\n` +
                `${E.discord} **Members in VC:** ${memberCount}`,
                avatar
            )
        );
        c.addSeparatorComponents(separator());
        c.addTextDisplayComponents(text(`-# ${E.wdot} Channel ID: ${newState.channel.id} • User ID: ${member.id} • ${tsR(new Date())}`));
        return sendLog(channel, c, newState.guild, 'voice');
    }

    // Voice Leave — compute duration since join (if we tracked it).
    if (oldState.channel && !newState.channel) {
        const k = _voiceKey(newState.guild.id, member.id);
        const tracked = _voiceJoinTimes.get(k);
        const duration = tracked ? _formatDuration(Date.now() - tracked.joinedAt) : 'Unknown';
        _voiceJoinTimes.delete(k);
        const remaining = oldState.channel.members?.size || 0;

        // Detect forced disconnect by a moderator via audit log.
        const audit = await fetchExecutor(newState.guild, AuditLogEvent.MemberDisconnect);
        const forcedBy = audit?.executor && audit.executor.id !== member.id
            ? `\n${E.shield} **Disconnected by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>)` +
              (audit.reason ? `\n${E.read} **Reason:** ${audit.reason}` : '')
            : '';

        const c = buildLogContainer(Colors.leave);
        c.addSectionComponents(
            section(
                `# ${E.error} Voice Channel Leave\n` +
                `${_userLine(member.user, 'User')}\n` +
                `${E.mute} **Channel:** ${oldState.channel.name} (\`${oldState.channel.id}\`)\n` +
                `${E.clock} **Time in VC:** ${duration}\n` +
                `${E.discord} **Remaining:** ${remaining === 0 ? 'Channel empty' : `${remaining} members`}` +
                forcedBy,
                avatar
            )
        );
        c.addSeparatorComponents(separator());
        c.addTextDisplayComponents(text(`-# ${E.wdot} Channel ID: ${oldState.channel.id} • User ID: ${member.id} • ${tsR(new Date())}`));
        return sendLog(channel, c, newState.guild, 'voice');
    }

    // Voice Switch
    if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
        const k = _voiceKey(newState.guild.id, member.id);
        const tracked = _voiceJoinTimes.get(k);
        const duration = tracked ? _formatDuration(Date.now() - tracked.joinedAt) : null;
        _voiceJoinTimes.set(k, { channelId: newState.channel.id, joinedAt: Date.now() });

        // Forced move? MemberMove audit entry.
        const audit = await fetchExecutor(newState.guild, AuditLogEvent.MemberMove);
        const forcedBy = audit?.executor
            ? `\n${E.shield} **Moved by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>)`
            : '';

        const c = buildLogContainer(Colors.voice);
        c.addSectionComponents(
            section(
                `# ${E.voice} Voice Channel Switch\n` +
                `${_userLine(member.user, 'User')}\n` +
                `${E.error} **From:** ${oldState.channel.name}` +
                (duration ? ` (${duration})` : '') + `\n` +
                `${E.success} **To:** ${newState.channel.name}` +
                forcedBy,
                avatar
            )
        );
        c.addSeparatorComponents(separator());
        c.addTextDisplayComponents(text(`-# ${E.wdot} User ID: ${member.id} • ${tsR(new Date())}`));
        return sendLog(channel, c, newState.guild, 'voice');
    }

    // Voice State Changes (mute/deaf/stream/video/suppress)
    const voiceChanges = [];
    if (oldState.selfMute !== newState.selfMute) {
        voiceChanges.push(`> ${newState.selfMute ? E.mute : E.volume} **Self Mute:** ${newState.selfMute ? 'Muted' : 'Unmuted'}`);
    }
    if (oldState.selfDeaf !== newState.selfDeaf) {
        voiceChanges.push(`> ${newState.selfDeaf ? E.mute : E.volume} **Self Deaf:** ${newState.selfDeaf ? 'Deafened' : 'Undeafened'}`);
    }
    if (oldState.serverMute !== newState.serverMute) {
        const audit = await fetchExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        const by = audit?.executor && audit.executor.id !== member.id ? ` *by ${audit.executor.tag || audit.executor.username}*` : '';
        voiceChanges.push(`> ${newState.serverMute ? E.error : E.success} **Server Mute:** ${newState.serverMute ? 'Muted' : 'Unmuted'}${by}`);
    }
    if (oldState.serverDeaf !== newState.serverDeaf) {
        const audit = await fetchExecutor(newState.guild, AuditLogEvent.MemberUpdate, member.id);
        const by = audit?.executor && audit.executor.id !== member.id ? ` *by ${audit.executor.tag || audit.executor.username}*` : '';
        voiceChanges.push(`> ${newState.serverDeaf ? E.error : E.success} **Server Deaf:** ${newState.serverDeaf ? 'Deafened' : 'Undeafened'}${by}`);
    }
    if (oldState.streaming !== newState.streaming) {
        voiceChanges.push(`> ${newState.streaming ? E.bolt : E.wdot} **Streaming:** ${newState.streaming ? 'Started' : 'Stopped'}`);
    }
    if (oldState.selfVideo !== newState.selfVideo) {
        voiceChanges.push(`> ${newState.selfVideo ? E.success : E.error} **Camera:** ${newState.selfVideo ? 'Turned On' : 'Turned Off'}`);
    }
    if (oldState.suppress !== newState.suppress) {
        voiceChanges.push(`> ${newState.suppress ? E.mute : E.volume} **Stage Suppressed:** ${newState.suppress ? 'Yes' : 'No'}`);
    }

    if (voiceChanges.length > 0 && newState.channel) {
        const c = buildLogContainer(Colors.update);
        c.addSectionComponents(
            section(
                `# ${E.settings} Voice State Update\n` +
                `${_userLine(member.user, 'User')}\n` +
                `${E.volume} **Channel:** ${newState.channel.name} (\`${newState.channel.id}\`)`,
                avatar
            )
        );
        c.addSeparatorComponents(separator());
        c.addTextDisplayComponents(text(`### ${E.info} Changes\n${voiceChanges.join('\n')}`));
        c.addSeparatorComponents(separator());
        c.addTextDisplayComponents(text(`-# ${E.wdot} User ID: ${member.id} • ${tsR(new Date())}`));
        return sendLog(channel, c, newState.guild, 'voice');
    }
}

/* ═══════════════════════════════════════════════════════
   🏗️ CHANNEL LOGS
   ═══════════════════════════════════════════════════════ */

const CHANNEL_TYPE_NAMES = {
    [ChannelType.GuildText]: 'Text Channel',
    [ChannelType.GuildVoice]: 'Voice Channel',
    [ChannelType.GuildCategory]: 'Category',
    [ChannelType.GuildAnnouncement]: 'Announcement',
    [ChannelType.GuildStageVoice]: 'Stage Channel',
    [ChannelType.GuildForum]: 'Forum Channel',
    [ChannelType.GuildMedia]: 'Media Channel',
    [ChannelType.PublicThread]: 'Public Thread',
    [ChannelType.PrivateThread]: 'Private Thread',
    [ChannelType.AnnouncementThread]: 'Announcement Thread',
};

async function logChannelCreate(ch) {
    if (!ch.guild) return;
    if (isFiltered(ch.guild, 'server', { channel: ch })) return;
    const logChannel = getLogChannel(ch.guild, 'server');
    if (!logChannel) return;

    const typeName = CHANNEL_TYPE_NAMES[ch.type] || `Type ${ch.type}`;
    const audit = await fetchExecutor(ch.guild, AuditLogEvent.ChannelCreate, ch.id);
    const byLine = audit?.executor
        ? `\n${E.shield} **Created by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>) \`${audit.executor.id}\``
        : '';

    const c = buildLogContainer(Colors.success);
    c.addTextDisplayComponents(text(
        `# ${E.success} Channel Created\n` +
        `${_channelLine(ch)}\n` +
        `${E.read} **Type:** ${typeName}` +
        (ch.parent ? `\n${E.folder} **Category:** ${ch.parent.name}` : '') +
        byLine +
        (audit?.reason ? `\n${E.read} **Reason:** ${audit.reason}` : '')
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Channel ID: ${ch.id} • ${tsR(new Date())}`));

    await sendLog(logChannel, c, ch.guild, 'server');
}

async function logChannelDelete(ch) {
    if (!ch.guild) return;
    if (isFiltered(ch.guild, 'server', { channel: ch })) return;
    const logChannel = getLogChannel(ch.guild, 'server');
    if (!logChannel) return;

    const typeName = CHANNEL_TYPE_NAMES[ch.type] || `Type ${ch.type}`;
    const audit = await fetchExecutor(ch.guild, AuditLogEvent.ChannelDelete, ch.id);
    const byLine = audit?.executor
        ? `\n${E.shield} **Deleted by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>) \`${audit.executor.id}\``
        : '';

    const c = buildLogContainer(Colors.error);
    c.addTextDisplayComponents(text(
        `# ${E.error} Channel Deleted\n` +
        `${E.pin} **Channel:** #${ch.name} (\`${ch.id}\`)\n` +
        `${E.read} **Type:** ${typeName}` +
        (ch.parent ? `\n${E.folder} **Was in:** ${ch.parent.name}` : '') +
        byLine +
        (audit?.reason ? `\n${E.read} **Reason:** ${audit.reason}` : '')
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Channel ID: ${ch.id} • ${tsR(new Date())}`));

    await sendLog(logChannel, c, ch.guild, 'server');
}

async function logChannelUpdate(oldChannel, newChannel) {
    if (!newChannel.guild) return;
    const channel = getLogChannel(newChannel.guild, 'server');
    if (!channel) return;

    const changes = [];

    if (oldChannel.name !== newChannel.name) {
        changes.push(`> ${E.settings} **Name:** \`${oldChannel.name}\` → \`${newChannel.name}\``);
    }
    if (oldChannel.topic !== newChannel.topic) {
        const oldTopic = (oldChannel.topic || '*None*').substring(0, 100);
        const newTopic = (newChannel.topic || '*None*').substring(0, 100);
        changes.push(`> ${E.read} **Topic:** ${oldTopic} → ${newTopic}`);
    }
    if (oldChannel.nsfw !== newChannel.nsfw) {
        changes.push(`> ${E.error} **NSFW:** ${oldChannel.nsfw ? 'On' : 'Off'} → ${newChannel.nsfw ? 'On' : 'Off'}`);
    }
    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        changes.push(`> ${E.moderate} **Slowmode:** ${oldChannel.rateLimitPerUser || 0}s → ${newChannel.rateLimitPerUser || 0}s`);
    }
    if (oldChannel.bitrate !== newChannel.bitrate) {
        changes.push(`> ${E.volume} **Bitrate:** ${(oldChannel.bitrate || 0) / 1000}kbps → ${(newChannel.bitrate || 0) / 1000}kbps`);
    }
    if (oldChannel.userLimit !== newChannel.userLimit) {
        changes.push(`> ${E.discord} **User Limit:** ${oldChannel.userLimit || '∞'} → ${newChannel.userLimit || '∞'}`);
    }
    if (oldChannel.parentId !== newChannel.parentId) {
        changes.push(`> ${E.folder} **Category:** ${oldChannel.parent?.name || '*None*'} → ${newChannel.parent?.name || '*None*'}`);
    }

    if (changes.length === 0) return;

    const audit = await fetchExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    const byLine = audit?.executor
        ? `\n${E.shield} **Updated by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>) \`${audit.executor.id}\``
        : '';

    const c = buildLogContainer(Colors.update);
    c.addTextDisplayComponents(text(
        `# ${E.settings} Channel Updated\n` +
        `${_channelLine(newChannel)}` +
        byLine +
        (audit?.reason ? `\n${E.read} **Reason:** ${audit.reason}` : '')
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`### ${E.info} Changes\n${changes.join('\n')}`));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Channel ID: ${newChannel.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, newChannel.guild, 'server');
}

/* ═══════════════════════════════════════════════════════
   <:Userplus:1521227719621218477> ROLE LOGS
   ═══════════════════════════════════════════════════════ */

async function logRoleCreate(role) {
    const channel = getLogChannel(role.guild, 'server');
    if (!channel) return;

    const audit = await fetchExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
    const byLine = audit?.executor
        ? `\n${E.shield} **Created by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>) \`${audit.executor.id}\``
        : '';

    const c = buildLogContainer(role.color || Colors.success);
    c.addTextDisplayComponents(text(
        `# ${E.success} Role Created\n` +
        `${E.shield} **Role:** ${role} (\`${role.id}\`)\n` +
        `${E.palette} **Color:** ${role.hexColor}\n` +
        `${E.stats} **Position:** #${role.position}\n` +
        `${E.moderate} **Hoisted:** ${role.hoist ? 'Yes' : 'No'} • **Mentionable:** ${role.mentionable ? 'Yes' : 'No'}` +
        byLine +
        (audit?.reason ? `\n${E.read} **Reason:** ${audit.reason}` : '')
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Role ID: ${role.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, role.guild, 'server');
}

async function logRoleDelete(role) {
    const channel = getLogChannel(role.guild, 'server');
    if (!channel) return;

    const audit = await fetchExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
    const byLine = audit?.executor
        ? `\n${E.shield} **Deleted by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>) \`${audit.executor.id}\``
        : '';

    const c = buildLogContainer(Colors.error);
    c.addTextDisplayComponents(text(
        `# ${E.error} Role Deleted\n` +
        `${E.shield} **Role:** @${role.name} (\`${role.id}\`)\n` +
        `${E.palette} **Color:** ${role.hexColor}\n` +
        `${E.stats} **Had Position:** #${role.position}\n` +
        `${E.discord} **Had Members:** ${role.members?.size || 0}` +
        byLine +
        (audit?.reason ? `\n${E.read} **Reason:** ${audit.reason}` : '')
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Role ID: ${role.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, role.guild, 'server');
}

async function logRoleUpdate(oldRole, newRole) {
    const channel = getLogChannel(newRole.guild, 'server');
    if (!channel) return;

    const changes = [];

    if (oldRole.name !== newRole.name) {
        changes.push(`> ${E.settings} **Name:** \`${oldRole.name}\` → \`${newRole.name}\``);
    }
    if (oldRole.color !== newRole.color) {
        changes.push(`> ${E.palette} **Color:** ${oldRole.hexColor} → ${newRole.hexColor}`);
    }
    if (oldRole.hoist !== newRole.hoist) {
        changes.push(`> ${E.stats} **Hoisted:** ${oldRole.hoist ? 'Yes' : 'No'} → ${newRole.hoist ? 'Yes' : 'No'}`);
    }
    if (oldRole.mentionable !== newRole.mentionable) {
        changes.push(`> ${E.announce} **Mentionable:** ${oldRole.mentionable ? 'Yes' : 'No'} → ${newRole.mentionable ? 'Yes' : 'No'}`);
    }
    if (oldRole.icon !== newRole.icon) {
        changes.push(`> ${E.shine} **Icon:** Changed`);
    }
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) {
        const added = newRole.permissions.toArray().filter(p => !oldRole.permissions.has(p));
        const removed = oldRole.permissions.toArray().filter(p => !newRole.permissions.has(p));
        if (added.length > 0) changes.push(`> ${E.success} **Perms Added:** ${added.slice(0, 8).join(', ')}${added.length > 8 ? ` +${added.length - 8} more` : ''}`);
        if (removed.length > 0) changes.push(`> ${E.error} **Perms Removed:** ${removed.slice(0, 8).join(', ')}${removed.length > 8 ? ` +${removed.length - 8} more` : ''}`);
    }

    if (changes.length === 0) return;

    const audit = await fetchExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    const byLine = audit?.executor
        ? `\n${E.shield} **Updated by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>) \`${audit.executor.id}\``
        : '';

    const c = buildLogContainer(newRole.color || Colors.update);
    c.addTextDisplayComponents(text(
        `# ${E.settings} Role Updated\n` +
        `${E.shield} **Role:** ${newRole} (\`${newRole.id}\`)` +
        byLine +
        (audit?.reason ? `\n${E.read} **Reason:** ${audit.reason}` : '')
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`### ${E.info} Changes\n${changes.join('\n')}`));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Role ID: ${newRole.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, newRole.guild, 'server');
}

/* ═══════════════════════════════════════════════════════
   🏛️ GUILD UPDATE LOGS
   ═══════════════════════════════════════════════════════ */

async function logGuildUpdate(oldGuild, newGuild) {
    const channel = getLogChannel(newGuild, 'server');
    if (!channel) return;

    const changes = [];

    if (oldGuild.name !== newGuild.name) {
        changes.push(`> ${E.settings} **Name:** \`${oldGuild.name}\` → \`${newGuild.name}\``);
    }
    if (oldGuild.icon !== newGuild.icon) {
        const newIcon = newGuild.iconURL({ size: 256 });
        changes.push(`> ${E.palette} **Icon:** ${newIcon ? `[Updated](${newIcon})` : 'Removed'}`);
    }
    if (oldGuild.banner !== newGuild.banner) {
        changes.push(`> ${E.palette} **Banner:** ${newGuild.banner ? 'Updated' : 'Removed'}`);
    }
    if (oldGuild.splash !== newGuild.splash) {
        changes.push(`> ${E.shine} **Invite Splash:** ${newGuild.splash ? 'Updated' : 'Removed'}`);
    }
    if (oldGuild.description !== newGuild.description) {
        changes.push(`> ${E.read} **Description:** ${newGuild.description || '*Removed*'}`);
    }
    if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) {
        changes.push(`> ${E.link} **Vanity URL:** \`${oldGuild.vanityURLCode || 'None'}\` → \`${newGuild.vanityURLCode || 'None'}\``);
    }
    if (oldGuild.ownerId !== newGuild.ownerId) {
        changes.push(`> ${E.shield} **Owner:** <@${oldGuild.ownerId}> → <@${newGuild.ownerId}>`);
    }
    if (oldGuild.verificationLevel !== newGuild.verificationLevel) {
        const levels = ['None', 'Low', 'Medium', 'High', 'Very High'];
        changes.push(`> ${E.moderate} **Verification:** ${levels[oldGuild.verificationLevel] || '?'} → ${levels[newGuild.verificationLevel] || '?'}`);
    }
    if (oldGuild.explicitContentFilter !== newGuild.explicitContentFilter) {
        const filters = ['Disabled', 'Members without roles', 'All members'];
        changes.push(`> ${E.shield} **Content Filter:** ${filters[oldGuild.explicitContentFilter] || '?'} → ${filters[newGuild.explicitContentFilter] || '?'}`);
    }
    if (oldGuild.defaultMessageNotifications !== newGuild.defaultMessageNotifications) {
        changes.push(`> ${E.messages} **Notifications:** ${oldGuild.defaultMessageNotifications === 0 ? 'All Messages' : 'Only Mentions'} → ${newGuild.defaultMessageNotifications === 0 ? 'All Messages' : 'Only Mentions'}`);
    }
    if (oldGuild.systemChannelId !== newGuild.systemChannelId) {
        changes.push(`> ${E.pin} **System Channel:** ${newGuild.systemChannelId ? `<#${newGuild.systemChannelId}>` : '*None*'}`);
    }
    if (oldGuild.rulesChannelId !== newGuild.rulesChannelId) {
        changes.push(`> ${E.read} **Rules Channel:** ${newGuild.rulesChannelId ? `<#${newGuild.rulesChannelId}>` : '*None*'}`);
    }
    if (oldGuild.afkChannelId !== newGuild.afkChannelId) {
        changes.push(`> ${E.mute} **AFK Channel:** ${newGuild.afkChannelId ? `<#${newGuild.afkChannelId}>` : '*None*'}`);
    }
    if (oldGuild.afkTimeout !== newGuild.afkTimeout) {
        changes.push(`> ${E.moderate} **AFK Timeout:** ${oldGuild.afkTimeout / 60}min → ${newGuild.afkTimeout / 60}min`);
    }
    if (oldGuild.premiumTier !== newGuild.premiumTier) {
        changes.push(`> ${E.boost} **Boost Level:** Tier ${oldGuild.premiumTier} → Tier ${newGuild.premiumTier}`);
    }
    if (oldGuild.preferredLocale !== newGuild.preferredLocale) {
        changes.push(`> ${E.discord} **Locale:** ${oldGuild.preferredLocale} → ${newGuild.preferredLocale}`);
    }
    if (oldGuild.nsfwLevel !== newGuild.nsfwLevel) {
        changes.push(`> ${E.error} **NSFW Level:** ${oldGuild.nsfwLevel} → ${newGuild.nsfwLevel}`);
    }

    if (changes.length === 0) return;

    const c = buildLogContainer(Colors.server);
    c.addTextDisplayComponents(text(
        `# ${E.settings} Server Updated\n` +
        `${E.discord} **Server:** ${newGuild.name}`
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`### ${E.info} Changes\n${changes.join('\n')}`));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Guild ID: ${newGuild.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, newGuild, 'server');
}

/* ═══════════════════════════════════════════════════════
   <:banhammer:1521227777083314529> MODERATION LOGS
   ═══════════════════════════════════════════════════════ */

async function logBan(guild, user) {
    if (isFiltered(guild, 'moderation', { user })) return;
    const channel = getLogChannel(guild, 'moderation');
    if (!channel) return;

    const audit = await fetchExecutor(guild, AuditLogEvent.MemberBanAdd, user.id);
    const accountAge = user.createdTimestamp ? _formatDuration(Date.now() - user.createdTimestamp) : 'Unknown';

    const c = buildLogContainer(Colors.error);
    c.addSectionComponents(
        section(
            `# ${E.moderate} Member Banned\n` +
            `${_userLine(user, 'User')}\n` +
            `${E.clock} **Account Age:** ${accountAge}\n` +
            _byLine(audit?.executor, audit?.reason),
            user.displayAvatarURL({ size: 256 })
        )
    );
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} User ID: ${user.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, guild, 'moderation');
}

async function logUnban(guild, user) {
    if (isFiltered(guild, 'moderation', { user })) return;
    const channel = getLogChannel(guild, 'moderation');
    if (!channel) return;

    const audit = await fetchExecutor(guild, AuditLogEvent.MemberBanRemove, user.id);

    const c = buildLogContainer(Colors.success);
    c.addSectionComponents(
        section(
            `# ${E.success} Member Unbanned\n` +
            `${_userLine(user, 'User')}\n` +
            (audit?.executor
                ? `${E.shield} **Unbanned by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>) \`${audit.executor.id}\``
                : `${E.shield} **Unbanned by:** *Unknown*`) +
            (audit?.reason ? `\n${E.read} **Reason:** ${audit.reason}` : ''),
            user.displayAvatarURL({ size: 256 })
        )
    );
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} User ID: ${user.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, guild, 'moderation');
}

async function logMemberKick(member, executor, reason) {
    if (isFiltered(member.guild, 'moderation', { user: member.user, member })) return;
    const channel = getLogChannel(member.guild, 'moderation');
    if (!channel) return;

    const c = buildLogContainer(Colors.moderation);
    c.addSectionComponents(
        section(
            `# ${E.moderate} Member Kicked\n` +
            `${_userLine(member.user, 'User')}\n` +
            _byLine(executor, reason),
            member.user.displayAvatarURL({ size: 256 })
        )
    );
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} User ID: ${member.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, member.guild, 'moderation');
}

async function logTimeout(member, executor, duration, reason) {
    if (isFiltered(member.guild, 'moderation', { user: member.user, member })) return;
    const channel = getLogChannel(member.guild, 'moderation');
    if (!channel) return;

    const c = buildLogContainer(Colors.timeout);
    c.addSectionComponents(
        section(
            `# ${E.mute} Member Timed Out\n` +
            `${_userLine(member.user, 'User')}\n` +
            `${E.clock} **Duration:** ${duration || 'Unknown'}\n` +
            _byLine(executor, reason),
            member.user.displayAvatarURL({ size: 256 })
        )
    );
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} User ID: ${member.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, member.guild, 'moderation');
}

/* ═══════════════════════════════════════════════════════
   😄 EMOJI & STICKER LOGS
   ═══════════════════════════════════════════════════════ */

async function logEmojiCreate(emoji) {
    const channel = getLogChannel(emoji.guild, 'server');
    if (!channel) return;

    const audit = await fetchExecutor(emoji.guild, AuditLogEvent.EmojiCreate, emoji.id);
    const byLine = audit?.executor
        ? `\n${E.shield} **Added by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>)`
        : '';

    const c = buildLogContainer(Colors.success);
    c.addTextDisplayComponents(text(
        `# ${E.success} Emoji Added\n` +
        `${E.shine} **Emoji:** ${emoji} \`:${emoji.name}:\` (\`${emoji.id}\`)\n` +
        `${E.read} **Animated:** ${emoji.animated ? 'Yes' : 'No'}` +
        byLine
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Emoji ID: ${emoji.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, emoji.guild, 'server');
}

async function logEmojiDelete(emoji) {
    const channel = getLogChannel(emoji.guild, 'server');
    if (!channel) return;

    const audit = await fetchExecutor(emoji.guild, AuditLogEvent.EmojiDelete, emoji.id);
    const byLine = audit?.executor
        ? `\n${E.shield} **Removed by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>)`
        : '';

    const c = buildLogContainer(Colors.error);
    c.addTextDisplayComponents(text(
        `# ${E.error} Emoji Removed\n` +
        `${E.shine} **Name:** :${emoji.name}: (\`${emoji.id}\`)\n` +
        `${E.read} **Was Animated:** ${emoji.animated ? 'Yes' : 'No'}` +
        byLine
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Emoji ID: ${emoji.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, emoji.guild, 'server');
}

async function logEmojiUpdate(oldEmoji, newEmoji) {
    const channel = getLogChannel(newEmoji.guild, 'server');
    if (!channel) return;

    const changes = [];
    if (oldEmoji.name !== newEmoji.name) {
        changes.push(`> ${E.settings} **Name:** \`:${oldEmoji.name}:\` → \`:${newEmoji.name}:\``);
    }

    if (changes.length === 0) return;

    const c = buildLogContainer(Colors.update);
    c.addTextDisplayComponents(text(
        `# ${E.settings} Emoji Updated\n` +
        `${E.shine} **Emoji:** ${newEmoji}\n` +
        `${E.discord} **Emoji ID:** \`${newEmoji.id}\``
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`### ${E.info} Changes\n${changes.join('\n')}`));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Emoji ID: ${newEmoji.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, newEmoji.guild, 'server');
}

async function logStickerCreate(sticker) {
    if (!sticker.guild) return;
    const channel = getLogChannel(sticker.guild, 'server');
    if (!channel) return;

    const c = buildLogContainer(Colors.success);
    c.addTextDisplayComponents(text(
        `# ${E.success} Sticker Added\n` +
        `${E.shine} **Name:** ${sticker.name}\n` +
        `${E.read} **Description:** ${sticker.description || '*None*'}\n` +
        `${E.discord} **Sticker ID:** \`${sticker.id}\``
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Sticker ID: ${sticker.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, sticker.guild, 'server');
}

async function logStickerDelete(sticker) {
    if (!sticker.guild) return;
    const channel = getLogChannel(sticker.guild, 'server');
    if (!channel) return;

    const c = buildLogContainer(Colors.error);
    c.addTextDisplayComponents(text(
        `# ${E.error} Sticker Removed\n` +
        `${E.shine} **Name:** ${sticker.name}\n` +
        `${E.discord} **Sticker ID:** \`${sticker.id}\``
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Sticker ID: ${sticker.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, sticker.guild, 'server');
}

/* ═══════════════════════════════════════════════════════
   🧵 THREAD LOGS
   ═══════════════════════════════════════════════════════ */

async function logThreadCreate(thread) {
    if (!thread.guild) return;
    const channel = getLogChannel(thread.guild, 'server');
    if (!channel) return;

    const c = buildLogContainer(Colors.thread);
    c.addTextDisplayComponents(text(
        `# ${E.success} Thread Created\n` +
        `${E.pin} **Thread:** ${thread}\n` +
        `${E.read} **Type:** ${CHANNEL_TYPE_NAMES[thread.type] || 'Thread'}\n` +
        `${E.discord} **Thread ID:** \`${thread.id}\`\n` +
        `${E.folder} **Parent:** ${thread.parent || '*Unknown*'}\n` +
        `${E.shine} **Owner:** <@${thread.ownerId}>`
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Thread ID: ${thread.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, thread.guild, 'server');
}

async function logThreadDelete(thread) {
    if (!thread.guild) return;
    const channel = getLogChannel(thread.guild, 'server');
    if (!channel) return;

    const c = buildLogContainer(Colors.error);
    c.addTextDisplayComponents(text(
        `# ${E.error} Thread Deleted\n` +
        `${E.pin} **Thread:** #${thread.name}\n` +
        `${E.discord} **Thread ID:** \`${thread.id}\``
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Thread ID: ${thread.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, thread.guild, 'server');
}

/* ═══════════════════════════════════════════════════════
   <:Attach:1521228039135170722> INVITE LOGS
   ═══════════════════════════════════════════════════════ */

async function logInviteCreate(invite) {
    if (!invite.guild) return;
    const channel = getLogChannel(invite.guild, 'server');
    if (!channel) return;

    const c = buildLogContainer(Colors.invite);
    c.addTextDisplayComponents(text(
        `# ${E.link} Invite Created\n` +
        `${E.shine} **Code:** \`${invite.code}\`\n` +
        `${E.discord} **Creator:** ${invite.inviter || '*Unknown*'}\n` +
        `${E.pin} **Channel:** ${invite.channel || '*Unknown*'}\n` +
        `${E.moderate} **Max Uses:** ${invite.maxUses || 'Unlimited'}\n` +
        `${E.read} **Expires:** ${invite.expiresAt ? tsR(invite.expiresAt) : 'Never'}\n` +
        `${E.info} **Temporary:** ${invite.temporary ? 'Yes' : 'No'}`
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Invite Code: ${invite.code} • ${tsR(new Date())}`));

    await sendLog(channel, c, invite.guild, 'server');
}

async function logInviteDelete(invite) {
    if (!invite.guild) return;
    const channel = getLogChannel(invite.guild, 'server');
    if (!channel) return;

    const c = buildLogContainer(Colors.muted);
    c.addTextDisplayComponents(text(
        `# ${E.error} Invite Deleted\n` +
        `${E.shine} **Code:** \`${invite.code}\`\n` +
        `${E.pin} **Channel:** ${invite.channel || '*Unknown*'}\n` +
        `${E.stats} **Uses:** ${invite.uses ?? 'Unknown'}`
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Invite Code: ${invite.code} • ${tsR(new Date())}`));

    await sendLog(channel, c, invite.guild, 'server');
}

/* ═══════════════════════════════════════════════════════
   <:Bookopen:1521227911137595605> WEBHOOK LOGS
   ═══════════════════════════════════════════════════════ */

async function logWebhookUpdate(ch) {
    if (!ch.guild) return;
    const channel = getLogChannel(ch.guild, 'server');
    if (!channel) return;

    const c = buildLogContainer(Colors.update);
    c.addTextDisplayComponents(text(
        `# ${E.settings} Webhook Updated\n` +
        `${E.pin} **Channel:** ${ch}\n` +
        `${E.discord} **Channel ID:** \`${ch.id}\`\n` +
        `-# A webhook in this channel was created, updated, or deleted`
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Channel ID: ${ch.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, ch.guild, 'server');
}

/* ═══════════════════════════════════════════════════════
   <:Lightning:1521227915537285150> AUTOMOD ACTION LOGS
   ═══════════════════════════════════════════════════════ */

async function logAutomodAction(guild, data) {
    const channel = getLogChannel(guild, 'automod');
    if (!channel) return;

    const { user, action, reason, rule, channelId, content } = data;
    const actionLabels = { block: 'Message Blocked', timeout: 'User Timed Out', alert: 'Alert Sent', flag: 'Message Flagged' };

    const c = buildLogContainer(Colors.warning);
    c.addTextDisplayComponents(text(
        `# ${E.shield} AutoMod Action\n` +
        `${E.moderate} **Action:** ${actionLabels[action] || action}\n` +
        `${E.shine} **User:** ${user?.username || 'Unknown'} (\`${user?.id || '?'}\`)\n` +
        `${E.pin} **Channel:** ${channelId ? `<#${channelId}>` : 'Unknown'}\n` +
        `${E.read} **Rule:** ${rule || 'Custom Rule'}`
    ));
    if (content) {
        c.addSeparatorComponents(separator());
        c.addTextDisplayComponents(text(`### ${E.messages} Flagged Content\n>>> ${content.slice(0, 500)}`));
    }
    if (reason) {
        c.addSeparatorComponents(separator());
        c.addTextDisplayComponents(text(`### ${E.info} Reason\n> ${reason}`));
    }
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} ${tsR(new Date())}`));

    await sendLog(channel, c, guild, 'automod');
}

/* ═══════════════════════════════════════════════════════
   <:Sketch:1521228025365004471> BOOST LOGS
   ═══════════════════════════════════════════════════════ */

async function logBoostEvent(member, started) {
    const channel = getLogChannel(member.guild, 'boost');
    if (!channel) return;

    const c = buildLogContainer(Colors.boost);
    c.addSectionComponents(
        section(
            `# ${E.boost} Server ${started ? 'Boosted' : 'Unboost'}\n` +
            `${E.shine} **User:** ${member.user.username} (\`${member.user.id}\`)\n` +
            `${E.boost} **Boost Level:** ${member.guild.premiumTier}\n` +
            `${E.stats} **Total Boosts:** ${member.guild.premiumSubscriptionCount || 0}`,
            member.user.displayAvatarURL({ size: 256 })
        )
    );
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} ${started ? 'Started boosting' : 'Stopped boosting'} • ${tsR(new Date())}`));

    await sendLog(channel, c, member.guild, 'boost');
}

/* ═══════════════════════════════════════════════════════
   <:Gamepad:1521228035213230090> COMMAND USAGE LOGS
   ═══════════════════════════════════════════════════════ */

async function logCommandUsage(guild, user, commandName, channelId, type = 'slash') {
    const channel = getLogChannel(guild, 'commands');
    if (!channel) return;

    const c = buildLogContainer(Colors.info);
    c.addTextDisplayComponents(text(
        `${E.games} **${user.username}** used \`${type === 'slash' ? '/' : '-'}${commandName}\` in <#${channelId}>`
    ));

    await sendLog(channel, c, guild, 'commands');
}

/* ═══════════════════════════════════════════════════════
   <:Shield:1521227694677692467> SECURITY EVENT LOGS
   (Anti-Nuke triggers, Anti-Raid actions, Anti-Alt detections,
    Threat / Emergency mode, Vanity Guard, Whitelist edits, etc.)

   These all route through the `'security'` log channel category.
   `logging-setup.js` exposes a "Security Logs" toggle so guilds
   can pick which channel receives these events.
   ═══════════════════════════════════════════════════════ */

/**
 * Anti-Nuke trigger executed (a user hit the limit and was punished).
 *
 * @param {Guild} guild
 * @param {Object} payload
 *   - executor:    { id, username, tag? } the offender
 *   - action:      string action key ('ban'|'kick'|'channel'|...)
 *   - punishment:  string, e.g. 'remove_roles' / 'ban' / 'kick_bot'
 *   - limit:       number
 *   - timeWindow:  ms
 *   - violations:  number
 *   - target:      optional string identifier (channel name etc.)
 */
async function logAntinukeTrigger(guild, payload) {
    const channel = getLogChannel(guild, 'security');
    if (!channel) return;

    const accentMap = { ban: 0xFF0000, kick: 0xFF6600, kick_both: 0xFF0000, kick_bot: 0xFF6600, ban_bot: 0xFF0000, remove_roles: 0xFFA500, timeout: 0xFFCC00 };
    const accent = accentMap[payload.punishment] || 0xED4245;

    const c = buildLogContainer(accent);
    c.addTextDisplayComponents(text(
        `# ${E.shield} Anti-Nuke Triggered\n` +
        `${E.shine} **Threat:** \`${payload.action}\`\n` +
        `${E.user} **Offender:** ${payload.executor?.username || 'Unknown'} (<@${payload.executor?.id}>)\n` +
        `${E.bolt} **Violations:** \`${payload.violations}\` / \`${payload.limit}\` in \`${Math.round((payload.timeWindow || 0) / 1000)}s\`\n` +
        `${E.moderate} **Punishment:** \`${payload.punishment}\`` +
        (payload.target ? `\n${E.read} **Target:** \`${payload.target}\`` : '')
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} ${tsR(new Date())}`));

    await sendLog(channel, c, guild, 'security');
}

/**
 * Anti-Nuke could NOT enforce a punishment (detected the threat but the
 * action failed — usually missing permission, role hierarchy, or the
 * offender is the server owner). Surfaced to the same 'security' channel
 * so admins notice an unenforceable config instead of it failing silently.
 *
 * @param {Guild} guild
 * @param {Object} payload
 *   - executor:   the offending user ({ id, username })
 *   - action:     the protection key that tripped (e.g. 'channelDelete')
 *   - punishment: the configured action that failed (e.g. 'ban')
 *   - limit, timeWindow, violations: detection stats
 *   - reason?:    optional short cause hint
 */
async function logAntinukeFailure(guild, payload) {
    const channel = getLogChannel(guild, 'security');
    if (!channel) return;

    const c = buildLogContainer(0xFEE75C); // warning amber — action needed
    c.addTextDisplayComponents(text(
        `# ${E.warning || E.shield} Anti-Nuke Could Not Act\n` +
        `${E.shine} **Threat:** \`${payload.action}\`\n` +
        `${E.user} **Offender:** ${payload.executor?.username || 'Unknown'} (<@${payload.executor?.id}>)\n` +
        `${E.bolt} **Violations:** \`${payload.violations}\` / \`${payload.limit}\` in \`${Math.round((payload.timeWindow || 0) / 1000)}s\`\n` +
        `${E.moderate} **Attempted:** \`${payload.punishment}\`\n\n` +
        `-# I detected the threat but could not apply the punishment` +
        (payload.reason ? ` — ${payload.reason}` : '') + `.\n` +
        `-# Check that I have the required permission and that my highest role is **above** the offender's.`
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} ${tsR(new Date())}`));

    await sendLog(channel, c, guild, 'security');
}

/**
 * Anti-Raid action: a member was kicked/banned for joining during a raid burst,
 * or the guild was auto-locked / unlocked.
 *
 * @param {Guild} guild
 * @param {Object} payload
 *   - kind:         'kick' | 'ban' | 'lockdown_on' | 'lockdown_off'
 *   - user?:        affected user (for kick/ban)
 *   - reason:       string
 *   - joinRate?:    number (joins-per-window when triggered)
 */
async function logAntiraidAction(guild, payload) {
    const channel = getLogChannel(guild, 'security');
    if (!channel) return;

    const titleMap = {
        kick:           'Anti-Raid Kick',
        ban:            'Anti-Raid Ban',
        lockdown_on:    'Anti-Raid Lockdown Engaged',
        lockdown_off:   'Anti-Raid Lockdown Released',
    };
    const accentMap = {
        kick:           0xFF6600,
        ban:            0xFF0000,
        lockdown_on:    0xED4245,
        lockdown_off:   0x57F287,
    };

    const c = buildLogContainer(accentMap[payload.kind] || 0xED4245);
    let body =
        `# ${E.shield} ${titleMap[payload.kind] || 'Anti-Raid Action'}\n`;
    if (payload.user) {
        body += `${E.user} **User:** ${payload.user.username || payload.user.tag || 'Unknown'} (<@${payload.user.id}>)\n`;
    }
    if (payload.joinRate != null) {
        body += `${E.bolt} **Join rate:** \`${payload.joinRate}\` in window\n`;
    }
    body += `${E.read} **Reason:** ${payload.reason || 'Anti-raid trigger'}\n`;

    c.addTextDisplayComponents(text(body.trimEnd()));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} ${tsR(new Date())}`));

    await sendLog(channel, c, guild, 'security');
}

/**
 * Anti-Alt: an account younger than the configured min-age tried to join.
 *
 * @param {Guild} guild
 * @param {Object} payload
 *   - user:        the user
 *   - accountAge:  ms since account creation
 *   - minAge:      configured threshold, ms
 *   - action:      'kick' | 'ban' | 'flag'
 */
async function logAntialtDetection(guild, payload) {
    const channel = getLogChannel(guild, 'security');
    if (!channel) return;

    const days = Math.round((payload.accountAge || 0) / 86_400_000);
    const minDays = Math.round((payload.minAge || 0) / 86_400_000);

    const c = buildLogContainer(payload.action === 'ban' ? 0xFF0000 : 0xFF6600);
    c.addTextDisplayComponents(text(
        `# ${E.shield} Anti-Alt Detected\n` +
        `${E.user} **User:** ${payload.user?.username || 'Unknown'} (<@${payload.user?.id}>)\n` +
        `${E.clock} **Account age:** \`${days}d\` (minimum: \`${minDays}d\`)\n` +
        `${E.moderate} **Action:** \`${payload.action || 'flag'}\``
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} ${tsR(new Date())}`));

    await sendLog(channel, c, guild, 'security');
}

/**
 * Vanity Guard: vanity URL change attempt detected (and possibly reverted).
 *
 * @param {Guild} guild
 * @param {Object} payload
 *   - executor:    { id, username }
 *   - oldVanity:   string|null
 *   - newVanity:   string|null
 *   - reverted:    bool
 *   - punishment:  string|null  (e.g. 'kick'|'ban'|'none')
 */
async function logVanityGuard(guild, payload) {
    const channel = getLogChannel(guild, 'security');
    if (!channel) return;

    const c = buildLogContainer(payload.reverted ? 0xFEE75C : 0xED4245);
    c.addTextDisplayComponents(text(
        `# ${E.shield} Vanity Guard Triggered\n` +
        `${E.link} **Vanity:** \`${payload.oldVanity || 'none'}\` → \`${payload.newVanity || 'none'}\`\n` +
        (payload.executor
            ? `${E.user} **Executor:** ${payload.executor.username || 'Unknown'} (<@${payload.executor.id}>)\n`
            : `${E.user} **Executor:** *unknown* (no audit log entry)\n`) +
        `${E.moderate} **Result:** ${payload.reverted ? 'Reverted' : 'Could NOT revert (boost tier <3)'}` +
        (payload.punishment && payload.punishment !== 'none' ? `\n${E.shine} **Punishment:** \`${payload.punishment}\`` : '')
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} ${tsR(new Date())}`));

    await sendLog(channel, c, guild, 'security');
}

/**
 * Threat / Emergency / Super-threat mode toggled.
 *
 * @param {Guild} guild
 * @param {Object} payload
 *   - mode:        'threat' | 'super-threat' | 'emergency'
 *   - enabled:     boolean
 *   - actor:       { id, username }
 *   - extra?:      string (e.g. roles affected)
 */
async function logThreatMode(guild, payload) {
    const channel = getLogChannel(guild, 'security');
    if (!channel) return;

    const labelMap = {
        threat:         'Threat Mode',
        'super-threat': 'Super Threat Mode',
        emergency:      'Emergency Mode',
    };
    const label = labelMap[payload.mode] || 'Security Mode';

    const c = buildLogContainer(payload.enabled ? 0xED4245 : 0x57F287);
    c.addTextDisplayComponents(text(
        `# ${E.shield} ${label} ${payload.enabled ? 'Engaged' : 'Released'}\n` +
        (payload.actor
            ? `${E.user} **Actor:** ${payload.actor.username || 'Unknown'} (<@${payload.actor.id}>)\n`
            : '') +
        (payload.extra ? `${E.info} ${payload.extra}\n` : '') +
        `${E.clock} **At:** ${tsR(new Date())}`
    ));

    await sendLog(channel, c, guild, 'security');
}

/**
 * Whitelist add/remove for antinuke or automod.
 *
 * @param {Guild} guild
 * @param {Object} payload
 *   - kind:        'antinuke' | 'automod'
 *   - operation:   'add' | 'remove' | 'reset'
 *   - subjectType: 'user' | 'role'
 *   - subjectId:   string
 *   - actor:       { id, username }
 */
async function logWhitelistChange(guild, payload) {
    const channel = getLogChannel(guild, 'security');
    if (!channel) return;

    const verb = payload.operation === 'remove' ? 'Removed from'
              : payload.operation === 'reset'  ? 'Reset'
              :                                  'Added to';
    const target = payload.subjectType === 'role' ? `<@&${payload.subjectId}>` : `<@${payload.subjectId}>`;

    const c = buildLogContainer(Colors.update);
    c.addTextDisplayComponents(text(
        `# ${E.shield} ${payload.kind === 'automod' ? 'AutoMod' : 'Anti-Nuke'} Whitelist\n` +
        `${E.read} **Action:** ${verb} ${payload.kind} whitelist\n` +
        (payload.subjectId ? `${E.user} **Subject:** ${target} (\`${payload.subjectId}\`)\n` : '') +
        (payload.actor ? `${E.user} **By:** ${payload.actor.username || 'Unknown'} (<@${payload.actor.id}>)` : '')
    ));

    await sendLog(channel, c, guild, 'security');
}

/**
 * Catch-all for security configuration changes that don't fit elsewhere
 * (botblock toggle, blacklisted-word added, quicksetup applied, ...).
 *
 * @param {Guild} guild
 * @param {Object} payload
 *   - title:   short title, e.g. 'Bot-Block Channel'
 *   - body:    multi-line markdown body
 *   - actor?:  { id, username }
 *   - kind?:   'enable' | 'disable' | 'change'  (controls accent color)
 */
async function logSecurityConfigChange(guild, payload) {
    const channel = getLogChannel(guild, 'security');
    if (!channel) return;

    const accentMap = { enable: 0x57F287, disable: 0xED4245, change: 0xCAD7E6 };
    const c = buildLogContainer(accentMap[payload.kind] || 0xCAD7E6);
    c.addTextDisplayComponents(text(
        `# ${E.shield} ${payload.title || 'Security Config Update'}\n` +
        (payload.body || '') +
        (payload.actor ? `\n${E.user} **By:** ${payload.actor.username || 'Unknown'} (<@${payload.actor.id}>)` : '')
    ));

    await sendLog(channel, c, guild, 'security');
}

/* ═══════════════════════════════════════════════════════
   <:Hashtag:1521227771957870604> REACTION LOGS
   ═══════════════════════════════════════════════════════ */

async function logReactionAdd(reaction, user) {
    if (!reaction || !user || user.bot) return;
    const guild = reaction.message?.guild;
    if (!guild) return;
    if (isFiltered(guild, 'reactions', { user, channel: reaction.message?.channel })) return;
    const channel = getLogChannel(guild, 'reactions');
    if (!channel) return;

    // Try to surface the message author so we can show "X reacted to Y's message"
    let author = reaction.message?.author;
    try {
        if (!author && reaction.message.partial) await reaction.message.fetch();
        author = reaction.message?.author;
    } catch {}

    const emojiDisplay = reaction.emoji?.id
        ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>`
        : reaction.emoji?.toString() || '?';

    const c = buildLogContainer(Colors.success);
    c.addSectionComponents(
        section(
            `# ${E.success} Reaction Added\n` +
            `${_userLine(user, 'User')}\n` +
            `${E.shine} **Emoji:** ${emojiDisplay} \`:${reaction.emoji?.name || '?'}:\`\n` +
            `${_channelLine(reaction.message.channel)}` +
            (author ? `\n${E.user} **On message by:** ${author.tag || author.username} (<@${author.id}>)` : '') +
            `\n${E.link} **[Jump to Message](${reaction.message.url})**`,
            user.displayAvatarURL?.({ size: 128 }) || undefined
        )
    );
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Message ID: ${reaction.message.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, guild, 'reactions');
}

async function logReactionRemove(reaction, user) {
    if (!reaction || !user || user.bot) return;
    const guild = reaction.message?.guild;
    if (!guild) return;
    if (isFiltered(guild, 'reactions', { user, channel: reaction.message?.channel })) return;
    const channel = getLogChannel(guild, 'reactions');
    if (!channel) return;

    const emojiDisplay = reaction.emoji?.id
        ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>`
        : reaction.emoji?.toString() || '?';

    const c = buildLogContainer(Colors.muted);
    c.addSectionComponents(
        section(
            `# ${E.error} Reaction Removed\n` +
            `${_userLine(user, 'User')}\n` +
            `${E.shine} **Emoji:** ${emojiDisplay} \`:${reaction.emoji?.name || '?'}:\`\n` +
            `${_channelLine(reaction.message.channel)}` +
            `\n${E.link} **[Jump to Message](${reaction.message.url})**`,
            user.displayAvatarURL?.({ size: 128 }) || undefined
        )
    );
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Message ID: ${reaction.message.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, guild, 'reactions');
}

/* ═══════════════════════════════════════════════════════
   <:Pin:1521227932625014916> PIN / UNPIN LOGS
   ═══════════════════════════════════════════════════════ */

/**
 * Called from `messageUpdate` when only the `pinned` flag changed.
 * Discord doesn't fire a dedicated pin event, but the audit log
 * carries the executor for both pin and unpin.
 */
async function logMessagePinChange(message, pinned) {
    if (!message?.guild) return;
    if (isFiltered(message.guild, 'pins', { user: message.author, channel: message.channel })) return;
    const channel = getLogChannel(message.guild, 'pins');
    if (!channel) return;

    const auditType = pinned ? AuditLogEvent.MessagePin : AuditLogEvent.MessageUnpin;
    const audit = await fetchExecutor(message.guild, auditType);
    const byLine = audit?.executor
        ? `\n${E.shield} **${pinned ? 'Pinned' : 'Unpinned'} by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>) \`${audit.executor.id}\``
        : '';

    const preview = message.content
        ? (message.content.length > 200 ? message.content.substring(0, 197) + '...' : message.content)
        : '*No text content*';

    const c = buildLogContainer(pinned ? Colors.success : Colors.muted);
    c.addTextDisplayComponents(text(
        `# ${pinned ? E.pin : E.unlock} Message ${pinned ? 'Pinned' : 'Unpinned'}\n` +
        (message.author ? `${_userLine(message.author, 'Author')}\n` : '') +
        `${_channelLine(message.channel)}\n` +
        `${E.link} **[Jump to Message](${message.url})**` +
        byLine
    ));
    if (message.content) {
        c.addSeparatorComponents(separator());
        c.addTextDisplayComponents(text(`### ${E.read} Content\n>>> ${preview}`));
    }
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Message ID: ${message.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, message.guild, 'pins');
}

/* ═══════════════════════════════════════════════════════
   <:Sketch:1521228025365004471> STICKER UPDATE
   ═══════════════════════════════════════════════════════ */

async function logStickerUpdate(oldSticker, newSticker) {
    if (!newSticker.guild) return;
    const channel = getLogChannel(newSticker.guild, 'server');
    if (!channel) return;

    const changes = [];
    if (oldSticker.name !== newSticker.name) {
        changes.push(`> ${E.settings} **Name:** \`${oldSticker.name}\` → \`${newSticker.name}\``);
    }
    if (oldSticker.description !== newSticker.description) {
        changes.push(`> ${E.read} **Description:** \`${oldSticker.description || '*None*'}\` → \`${newSticker.description || '*None*'}\``);
    }
    if (oldSticker.tags !== newSticker.tags) {
        changes.push(`> ${E.shine} **Tags:** \`${oldSticker.tags || '*None*'}\` → \`${newSticker.tags || '*None*'}\``);
    }
    if (changes.length === 0) return;

    const audit = await fetchExecutor(newSticker.guild, AuditLogEvent.StickerUpdate, newSticker.id);
    const byLine = audit?.executor
        ? `\n${E.shield} **Updated by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>)`
        : '';

    const c = buildLogContainer(Colors.update);
    c.addTextDisplayComponents(text(
        `# ${E.settings} Sticker Updated\n` +
        `${E.shine} **Sticker:** ${newSticker.name} (\`${newSticker.id}\`)` + byLine
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`### ${E.info} Changes\n${changes.join('\n')}`));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Sticker ID: ${newSticker.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, newSticker.guild, 'server');
}

/* ═══════════════════════════════════════════════════════
   🧵 THREAD UPDATE
   ═══════════════════════════════════════════════════════ */

async function logThreadUpdate(oldThread, newThread) {
    if (!newThread.guild) return;
    const channel = getLogChannel(newThread.guild, 'server');
    if (!channel) return;

    const changes = [];
    if (oldThread.name !== newThread.name) {
        changes.push(`> ${E.settings} **Name:** \`${oldThread.name}\` → \`${newThread.name}\``);
    }
    if (oldThread.archived !== newThread.archived) {
        changes.push(`> ${newThread.archived ? E.lock : E.unlock} **Archived:** ${oldThread.archived ? 'Yes' : 'No'} → ${newThread.archived ? 'Yes' : 'No'}`);
    }
    if (oldThread.locked !== newThread.locked) {
        changes.push(`> ${newThread.locked ? E.lock : E.unlock} **Locked:** ${oldThread.locked ? 'Yes' : 'No'} → ${newThread.locked ? 'Yes' : 'No'}`);
    }
    if (oldThread.rateLimitPerUser !== newThread.rateLimitPerUser) {
        changes.push(`> ${E.moderate} **Slowmode:** ${oldThread.rateLimitPerUser || 0}s → ${newThread.rateLimitPerUser || 0}s`);
    }
    if (oldThread.autoArchiveDuration !== newThread.autoArchiveDuration) {
        changes.push(`> ${E.clock} **Auto-Archive:** ${oldThread.autoArchiveDuration || '?'}min → ${newThread.autoArchiveDuration || '?'}min`);
    }
    if (changes.length === 0) return;

    const audit = await fetchExecutor(newThread.guild, AuditLogEvent.ThreadUpdate, newThread.id);
    const byLine = audit?.executor
        ? `\n${E.shield} **Updated by:** ${audit.executor.tag || audit.executor.username} (<@${audit.executor.id}>)`
        : '';

    const c = buildLogContainer(Colors.thread);
    c.addTextDisplayComponents(text(
        `# ${E.settings} Thread Updated\n` +
        `${E.pin} **Thread:** ${newThread} (\`${newThread.id}\`)\n` +
        `${E.folder} **Parent:** ${newThread.parent || '*Unknown*'}` +
        byLine
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`### ${E.info} Changes\n${changes.join('\n')}`));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} Thread ID: ${newThread.id} • ${tsR(new Date())}`));

    await sendLog(channel, c, newThread.guild, 'server');
}

/* ═══════════════════════════════════════════════════════
   SOUNDBOARD LOGGING
   ═══════════════════════════════════════════════════════ */

async function logSoundboardUse(guild, member, soundName, channelId) {
    const channel = getLogChannel(guild, 'voice');
    if (!channel) return;

    const c = buildLogContainer(Colors.info);
    c.addTextDisplayComponents(text(
        `# ${E.voice} Soundboard Used\n` +
        `${E.user} **User:** ${member.user?.tag || member.username} (<@${member.id || member.user?.id}>)\n` +
        `${E.voice} **Sound:** \`${soundName}\`\n` +
        (channelId ? `${E.pin} **Channel:** <#${channelId}>` : '')
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} ${tsR(new Date())}`));

    await sendLog(channel, c, guild, 'voice');
}

async function logSoundboardCreate(guild, sound, executor) {
    const channel = getLogChannel(guild, 'server');
    if (!channel) return;

    const byLine = executor ? `\n${E.shield} **Added by:** ${executor.tag || executor.username} (<@${executor.id}>)` : '';

    const c = buildLogContainer(Colors.success);
    c.addTextDisplayComponents(text(
        `# ${E.success} Soundboard Sound Added\n` +
        `${E.voice} **Name:** \`${sound.name}\`\n` +
        `${E.read} **ID:** \`${sound.soundId || sound.id}\`\n` +
        `${E.shine} **Volume:** ${Math.round((sound.volume || 1) * 100)}%` +
        byLine
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} ${tsR(new Date())}`));

    await sendLog(channel, c, guild, 'server');
}

async function logSoundboardDelete(guild, sound, executor) {
    const channel = getLogChannel(guild, 'server');
    if (!channel) return;

    const byLine = executor ? `\n${E.shield} **Removed by:** ${executor.tag || executor.username} (<@${executor.id}>)` : '';

    const c = buildLogContainer(Colors.error);
    c.addTextDisplayComponents(text(
        `# ${E.error} Soundboard Sound Removed\n` +
        `${E.voice} **Name:** \`${sound.name}\`\n` +
        `${E.read} **ID:** \`${sound.soundId || sound.id}\`` +
        byLine
    ));
    c.addSeparatorComponents(separator());
    c.addTextDisplayComponents(text(`-# ${E.wdot} ${tsR(new Date())}`));

    await sendLog(channel, c, guild, 'server');
}

/* ═══════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════ */

module.exports = {
    // Message
    logMessageDelete,
    logMessageUpdate,
    logMessageBulkDelete,
    logMessagePinChange,
    // Reactions
    logReactionAdd,
    logReactionRemove,
    // Member
    logMemberJoin,
    logMemberLeave,
    logMemberUpdate,
    // User (avatar, username, display name, banner)
    logUserUpdate,
    // Voice
    logVoiceStateUpdate,
    // Channels
    logChannelCreate,
    logChannelDelete,
    logChannelUpdate,
    // Guild
    logGuildUpdate,
    // Roles
    logRoleCreate,
    logRoleDelete,
    logRoleUpdate,
    // Moderation
    logBan,
    logUnban,
    logMemberKick,
    logTimeout,
    // Emoji & Stickers
    logEmojiCreate,
    logEmojiDelete,
    logEmojiUpdate,
    logStickerCreate,
    logStickerDelete,
    logStickerUpdate,
    // Threads
    logThreadCreate,
    logThreadDelete,
    logThreadUpdate,
    // Invites
    logInviteCreate,
    logInviteDelete,
    // AutoMod
    logAutomodAction,
    // Boost
    logBoostEvent,
    // Commands
    logCommandUsage,
    // Security (anti-nuke, anti-raid, anti-alt, vanity guard, threat / emergency, whitelist)
    logAntinukeTrigger,
    logAntinukeFailure,
    logAntiraidAction,
    logAntialtDetection,
    logVanityGuard,
    logThreatMode,
    logWhitelistChange,
    logSecurityConfigChange,
    // Helpers
    invalidateCache,
    getLogChannel,
    sendLog,
    fetchExecutor,
    isFiltered,
    getFilters,
    // Webhooks
    logWebhookUpdate,
    // Soundboard
    logSoundboardUse,
    logSoundboardCreate,
    logSoundboardDelete,
    // Config helpers
    loadLogs,
    getLogMode,
    getLogWebhook,
};
