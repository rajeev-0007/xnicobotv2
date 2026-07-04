/**
 * Ticket Transcript Utility
 *
 * Shared helpers for generating, formatting, and delivering ticket
 * transcripts. Used by both the manual "Save Transcript" button and
 * the automatic-on-close path so behavior stays identical.
 *
 * Exports
 *   - sanitizeChannelPart(str)        : safe Discord channel-name slice
 *   - buildTicketChannelName(...)     : `${category}-${user}-${n}` builder
 *   - fetchAllMessages(channel, opts) : paginates the channel history
 *   - buildMarkdownTranscript(...)    : .md transcript text
 *   - buildHtmlTranscript(...)        : standalone .html transcript
 *   - buildTranscriptAttachments(...) : returns AttachmentBuilder[]
 *   - postTranscriptToLogChannel(...) : posts transcript to configured log
 */

const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

/* ────────────────────────────── helpers ─────────────────────────────── */

/**
 * Sanitize a single segment for use inside a Discord channel name.
 * Discord requires lowercase letters, digits, dashes and underscores.
 */
function sanitizeChannelPart(str, fallback = 'user') {
    if (str === null || str === undefined) return fallback;
    const cleaned = String(str)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')      // strip accents
        .replace(/[^a-z0-9\-_]/g, '-')         // disallow everything else
        .replace(/-+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, 30);
    return cleaned || fallback;
}

/**
 * Build the final ticket channel name in the form
 * `<categoryId>-<username>-<number>` (e.g. `general-rajeev-1`).
 * Total length is capped at 95 chars to stay within Discord's 100-char limit.
 */
function buildTicketChannelName(categoryId, username, number) {
    const cat = sanitizeChannelPart(categoryId, 'ticket');
    const usr = sanitizeChannelPart(username, 'user');
    let name = `${cat}-${usr}-${number}`;
    if (name.length > 95) {
        const overflow = name.length - 95;
        const trimmedUsr = usr.slice(0, Math.max(3, usr.length - overflow));
        name = `${cat}-${trimmedUsr}-${number}`;
    }
    return name;
}

/**
 * Fetch up to `limit` messages from a channel (chronological order).
 * Uses cursor-based pagination so we are not capped at 100 messages.
 */
async function fetchAllMessages(channel, { limit = 2000 } = {}) {
    const collected = [];
    let lastId;
    while (collected.length < limit) {
        const opts = { limit: 100 };
        if (lastId) opts.before = lastId;
        const batch = await channel.messages.fetch(opts).catch(() => null);
        if (!batch || batch.size === 0) break;
        collected.push(...batch.values());
        lastId = batch.last().id;
        if (batch.size < 100) break;
    }
    return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

/* ──────────────────────── markdown transcript ──────────────────────── */

function buildMarkdownTranscript(messages, meta = {}) {
    // Build a quick mention-resolver map so `<@123>` becomes `@username`
    // in the markdown output. Embeds + attachments are already handled inline.
    const mentionMap = new Map();
    for (const msg of messages) {
        if (msg.mentions?.users) {
            for (const u of msg.mentions.users.values()) mentionMap.set(u.id, u.username || u.tag || u.id);
        }
        if (msg.author?.id) mentionMap.set(msg.author.id, msg.author.username || msg.author.tag);
    }
    const resolveMentions = (txt = '') => txt
        .replace(/<@!?(\d+)>/g, (_, id) => `@${mentionMap.get(id) || id}`)
        .replace(/<#(\d+)>/g,    (_, id) => `#${id}`)
        .replace(/<@&(\d+)>/g,   (_, id) => `@&${id}`);

    const lines = [];
    lines.push(`# Ticket Transcript`);
    if (meta.channelName)   lines.push(`**Channel:** ${meta.channelName}`);
    if (meta.guildName)     lines.push(`**Server:** ${meta.guildName}`);
    if (meta.openerTag)     lines.push(`**Opened By:** ${meta.openerTag} (${meta.openerId || ''})`);
    if (meta.categoryLabel) lines.push(`**Category:** ${meta.categoryLabel}`);
    if (meta.createdAt)     lines.push(`**Created:** ${new Date(meta.createdAt).toISOString()}`);
    if (meta.closedAt)      lines.push(`**Closed:** ${new Date(meta.closedAt).toISOString()}`);
    if (meta.closedBy)      lines.push(`**Closed By:** ${meta.closedBy}`);
    if (meta.claimedByTag)  lines.push(`**Claimed By:** ${meta.claimedByTag}`);
    if (meta.addedMembers?.length) {
        lines.push(`**Added Members:** ${meta.addedMembers.map(m => `${m.tag || m.id}`).join(', ')}`);
    }
    lines.push(`**Messages:** ${messages.length}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const msg of messages) {
        const ts = new Date(msg.createdTimestamp).toISOString();
        const author = msg.author?.tag || msg.author?.username || 'Unknown';
        const content = msg.content && msg.content.length
            ? resolveMentions(msg.content)
            : '*[no text]*';
        lines.push(`**[${ts}] ${author}${msg.author?.bot ? ' [BOT]' : ''}:**`);
        lines.push(content);

        if (msg.attachments?.size) {
            for (const att of msg.attachments.values()) {
                lines.push(`> 📎 Attachment: ${att.name} — ${att.url}`);
            }
        }
        if (msg.embeds?.length) {
            for (const e of msg.embeds) {
                if (e.title)       lines.push(`> 📋 Embed Title: ${e.title}`);
                if (e.description) lines.push(`> 📋 Embed Desc:  ${resolveMentions(e.description).slice(0, 200)}`);
            }
        }
        if (msg.stickers?.size) {
            for (const st of msg.stickers.values()) {
                lines.push(`> 🏷️ Sticker: ${st.name}`);
            }
        }
        if (msg.editedTimestamp) {
            lines.push(`> *(edited at ${new Date(msg.editedTimestamp).toISOString()})*`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

/* ───────────────────────── html transcript ─────────────────────────── */

function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildHtmlTranscript(messages, meta = {}) {
    const headerRow = (k, v) => v
        ? `<div class="meta-row"><span class="meta-key">${escapeHtml(k)}</span><span class="meta-val">${escapeHtml(v)}</span></div>`
        : '';

    const messagesHtml = messages.map(msg => {
        const author   = escapeHtml(msg.author?.tag || msg.author?.username || 'Unknown');
        const avatar   = msg.author?.displayAvatarURL?.({ size: 64 }) || '';
        const ts       = new Date(msg.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
        const isBot    = msg.author?.bot;
        const content  = escapeHtml(msg.content || '').replace(/\n/g, '<br>');

        const attachmentsHtml = msg.attachments?.size
            ? Array.from(msg.attachments.values()).map(a => {
                const isImg = /\.(png|jpg|jpeg|gif|webp)$/i.test(a.name || '');
                return isImg
                    ? `<a class="att" href="${escapeHtml(a.url)}" target="_blank"><img src="${escapeHtml(a.url)}" alt="${escapeHtml(a.name)}"></a>`
                    : `<a class="att att-file" href="${escapeHtml(a.url)}" target="_blank">📎 ${escapeHtml(a.name)}</a>`;
            }).join('')
            : '';

        const embedsHtml = msg.embeds?.length
            ? msg.embeds.map(e => {
                const title = e.title ? `<div class="embed-title">${escapeHtml(e.title)}</div>` : '';
                const desc  = e.description ? `<div class="embed-desc">${escapeHtml(e.description).replace(/\n/g, '<br>')}</div>` : '';
                const color = e.color ? `#${e.color.toString(16).padStart(6, '0')}` : '#5865f2';
                return `<div class="embed" style="border-left-color:${color}">${title}${desc}</div>`;
            }).join('')
            : '';

        return `
        <div class="msg">
            <img class="avatar" src="${escapeHtml(avatar)}" alt="">
            <div class="msg-body">
                <div class="msg-head">
                    <span class="author">${author}</span>
                    ${isBot ? '<span class="bot-tag">BOT</span>' : ''}
                    <span class="ts">${ts}</span>
                </div>
                ${content ? `<div class="content">${content}</div>` : ''}
                ${attachmentsHtml}
                ${embedsHtml}
            </div>
        </div>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Transcript — ${escapeHtml(meta.channelName || 'ticket')}</title>
<style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #0f1115; color: #e6e8eb; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.45; }
    .wrap { max-width: 940px; margin: 0 auto; padding: 24px; }
    .header { background: linear-gradient(135deg,#1f2230 0%,#262a3a 100%); border: 1px solid #2c3142; border-radius: 14px; padding: 24px 28px; margin-bottom: 24px; }
    .title { font-size: 22px; font-weight: 700; margin: 0 0 4px; }
    .subtitle { color: #8b93a7; font-size: 13px; margin: 0 0 16px; }
    .meta-row { display: flex; gap: 12px; padding: 6px 0; border-top: 1px solid #232838; font-size: 13px; }
    .meta-row:first-of-type { border-top: 0; }
    .meta-key { color: #8b93a7; min-width: 130px; }
    .meta-val { color: #e6e8eb; word-break: break-word; }
    .messages { background: #15171f; border: 1px solid #232838; border-radius: 14px; padding: 8px 0; }
    .msg { display: flex; gap: 14px; padding: 10px 20px; transition: background .15s; }
    .msg:hover { background: #191c25; }
    .avatar { width: 40px; height: 40px; border-radius: 50%; background: #2c3142; flex-shrink: 0; }
    .msg-body { min-width: 0; flex: 1; }
    .msg-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .author { font-weight: 600; color: #fff; }
    .bot-tag { background: #5865f2; color: #fff; font-size: 10px; font-weight: 700; padding: 2px 5px; border-radius: 3px; letter-spacing: .3px; }
    .ts { color: #6b7385; font-size: 11px; }
    .content { margin-top: 2px; color: #d8dbe2; white-space: pre-wrap; word-wrap: break-word; }
    .att { display: inline-block; margin-top: 6px; max-width: 380px; }
    .att img { max-width: 100%; max-height: 320px; border-radius: 6px; display: block; }
    .att-file { color: #7ea7ff; text-decoration: none; padding: 6px 10px; background: #1f2230; border-radius: 6px; font-size: 13px; }
    .att-file:hover { text-decoration: underline; }
    .embed { margin-top: 6px; padding: 10px 14px; background: #1c1f2a; border-left: 4px solid #5865f2; border-radius: 4px; max-width: 480px; }
    .embed-title { font-weight: 600; margin-bottom: 4px; }
    .embed-desc { color: #b9bdc8; font-size: 14px; }
    .footer { text-align: center; color: #6b7385; font-size: 12px; margin-top: 18px; }
</style>
</head>
<body>
<div class="wrap">
    <div class="header">
        <div class="title">🎫 Ticket Transcript</div>
        <div class="subtitle">${escapeHtml(meta.channelName || '')} ${meta.guildName ? '· ' + escapeHtml(meta.guildName) : ''}</div>
        ${headerRow('Opened By',   meta.openerTag)}
        ${headerRow('User ID',     meta.openerId)}
        ${headerRow('Category',    meta.categoryLabel)}
        ${headerRow('Created',     meta.createdAt ? new Date(meta.createdAt).toLocaleString() : '')}
        ${headerRow('Closed',      meta.closedAt ? new Date(meta.closedAt).toLocaleString() : '')}
        ${headerRow('Closed By',   meta.closedBy)}
        ${headerRow('Claimed By',  meta.claimedByTag)}
        ${headerRow('Messages',    String(messages.length))}
    </div>
    <div class="messages">
        ${messagesHtml || '<div style="padding:24px;text-align:center;color:#6b7385">No messages.</div>'}
    </div>
    <div class="footer">Generated by xNico · ${new Date().toISOString()}</div>
</div>
</body>
</html>`;
}

/* ──────────────────── attachment + delivery helpers ────────────────── */

/**
 * Returns AttachmentBuilder[] (markdown + html) ready to be sent.
 * Skips formats whose buffer would exceed the Discord 25 MB upload cap.
 */
function buildTranscriptAttachments(messages, meta = {}) {
    const safeName = sanitizeChannelPart(meta.channelName || 'ticket', 'ticket');
    const md   = buildMarkdownTranscript(messages, meta);
    const html = buildHtmlTranscript(messages, meta);

    const attachments = [];
    const mdBuf   = Buffer.from(md,   'utf8');
    const htmlBuf = Buffer.from(html, 'utf8');
    const MAX = 24 * 1024 * 1024;

    if (mdBuf.length   <= MAX) attachments.push(new AttachmentBuilder(mdBuf,   { name: `transcript-${safeName}.md`   }));
    if (htmlBuf.length <= MAX) attachments.push(new AttachmentBuilder(htmlBuf, { name: `transcript-${safeName}.html` }));
    return attachments;
}

/**
 * Posts a transcript to a guild's configured transcript-log channel.
 * Returns the posted Message or null on failure.
 */
async function postTranscriptToLogChannel(guild, logChannelId, attachments, meta = {}) {
    if (!logChannelId) return null;
    const logChannel = await guild.channels.fetch(logChannelId).catch(() => null);
    if (!logChannel || !logChannel.isTextBased?.()) return null;

    // Verify we can actually send + attach in the log channel
    const me = guild.members.me;
    if (me) {
        const perms = logChannel.permissionsFor(me);
        if (!perms?.has(['SendMessages', 'AttachFiles', 'EmbedLinks'])) return null;
    }

    // Compute duration if we have both timestamps
    let durationStr = 'N/A';
    if (meta.createdAt && meta.closedAt) {
        const ms = Math.max(0, meta.closedAt - meta.createdAt);
        const mins = Math.floor(ms / 60000);
        const hours = Math.floor(mins / 60);
        const days  = Math.floor(hours / 24);
        if (days > 0)        durationStr = `${days}d ${hours % 24}h`;
        else if (hours > 0)  durationStr = `${hours}h ${mins % 60}m`;
        else if (mins > 0)   durationStr = `${mins}m`;
        else                 durationStr = `${Math.floor(ms / 1000)}s`;
    }

    const embed = new EmbedBuilder()
        .setTitle('🎫 Ticket Transcript')
        .setColor(0x5865F2)
        .setDescription(`**${meta.channelName || 'unknown'}** has been closed and archived.`)
        .addFields(
            { name: 'Opened By', value: meta.openerId ? `<@${meta.openerId}>\n\`${meta.openerTag || meta.openerId}\`` : 'Unknown', inline: true },
            { name: 'Category', value: meta.categoryLabel || 'N/A', inline: true },
            { name: 'Closed By', value: meta.closedBy || 'N/A', inline: true },
            { name: 'Messages', value: String(meta.messageCount ?? attachments.length), inline: true },
            { name: 'Duration', value: durationStr, inline: true },
            { name: 'Closed',   value: `<t:${Math.floor((meta.closedAt || Date.now()) / 1000)}:R>`, inline: true }
        )
        .setFooter({ text: `Files: ${attachments.map(a => a.name).join(', ')}` })
        .setTimestamp();

    return logChannel.send({ embeds: [embed], files: attachments }).catch(err => {
        // Can happen if files exceed channel upload limit (boost tier dependent)
        // Fall back to embed-only so the close event is at least logged.
        return logChannel.send({ embeds: [embed.setFooter({ text: `⚠️ Upload failed: ${err.message}` })] }).catch(() => null);
    });
}

module.exports = {
    sanitizeChannelPart,
    buildTicketChannelName,
    fetchAllMessages,
    buildMarkdownTranscript,
    buildHtmlTranscript,
    buildTranscriptAttachments,
    postTranscriptToLogChannel,
};
