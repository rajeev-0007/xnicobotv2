'use strict';

/**
 * Webhook UI Toolkit
 * ──────────────────────────────────────────────────────────────────────────
 * Shared, minimal Components V2 building blocks for the `webhook` command
 * category. Centralizes:
 *
 *   • Guild styling — every panel is synced with `/bot-customize` (accent
 *     color + footer) via `applyStyle()`. Unlike the global prefix patcher
 *     in index.js, this ALSO runs on interaction `update()` / `reply()`
 *     surfaces (button clicks, modal submits), so follow-up panels match
 *     the guild's chosen theme everywhere.
 *   • Reusable panels (error / success / info) and views (list / detail /
 *     confirm-delete) shared by webhook-list and webhook-info.
 *   • Shared modals (send / rename) and permission helpers.
 *
 * Keeping this logic in one place lets each command stay small and keeps the
 * visual language identical across the whole category.
 */

const {
    ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
    SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder,
    TextInputStyle, MessageFlags, PermissionFlagsBits
} = require('discord.js');
const botCustomize = require('./botCustomize');

/* ── Constants ──────────────────────────────────────────────────────────── */

const E = {
    ok:      '<:Checkedbox:1521227734943269077>',
    no:      '<:Cancel:1521227723916181644>',
    warn:    '<:Infotriangle:1521227710381428926>',
    hook:    '<:Attach:1521228039135170722>',
    id:      '<:Fileuser:1521228225466859792>',
    edit:    '<:Editalt:1521227921673556019>',
    pencil:  '<:Edit:1521227886634205298>',
    trash:   '<:Trash:1521227750420254820>',
    pic:     '<:Picture:1521227954191995024>',
    date:    '<:Bookopen:1521227911137595605>',
    user:    '<:User:1521227714227343380>',
    gear:    '<:Settings:1521227767780343879>',
    refresh: '<:History:1521227863079256278>',
    next:    '<:Caretright:1521227704953864202>',
    prev:    '<:Caretleft:1521227977495543838>',
    bolt:    '<:Lightning:1521227915537285150>',
    send:    '<:Editalt:1521227921673556019>',
    channel: '<:Hashtag:1521227771957870604>',
    // Text pointer used to prefix field rows (Discord-native bullet look)
    bullet:  '<:Caretright:1521227704953864202>',
};

/** Join field rows into a caretright-bulleted block. */
function rows(...lines) {
    return lines.filter(Boolean).map(l => `${E.bullet} ${l}`).join('\n');
}

const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';
const PER_PAGE = 5;
const PORTAL_URL = 'https://thenico.vercel.app/webhook';
const FOOTER_SENTINEL = '__xnicoFooterApplied';

const TIMEOUTS = {
    CONFIRM: 30_000,
    PANEL:   120_000,
    FOLLOW:  60_000,
};

/* ── Guild styling (bot-customize sync) ─────────────────────────────────── */

/**
 * Apply the guild's `/bot-customize` accent color + footer to a container.
 * Mirrors the global CV2 patcher in index.js so interaction updates and
 * modal replies (which the global patcher never touches) stay in sync.
 *
 * @param {ContainerBuilder} container
 * @param {string|null} guildId
 * @param {{footer?: boolean}} [opts]
 * @returns {ContainerBuilder}
 */
function applyStyle(container, guildId, { footer = true } = {}) {
    if (!container || !container.data) return container;

    const color = guildId ? botCustomize.getEmbedColor(guildId) : 0xCAD7E6;
    if (color === null) {
        delete container.data.accent_color; // colorless mode
    } else if (Number.isFinite(color)) {
        container.data.accent_color = color;
    }

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
        const alreadyFooter = lastText && lastText.trimStart().startsWith('-#');
        if (!alreadyFooter) {
            try {
                container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${String(footerText).slice(0, 100)}`));
            } catch { /* container shape didn't allow appending — skip footer */ }
        }
        // Mark so the global prefix patcher won't append a second footer.
        container[FOOTER_SENTINEL] = true;
    }
    return container;
}

/** Convenience: build the standard V2 reply payload for a container. */
function payload(container) {
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/* ── Panels ─────────────────────────────────────────────────────────────── */

function errorPanel(guildId, title, body, hint) {
    let content = `# ${E.no} ${title}`;
    if (body) content += `\n\n${body}`;
    if (hint) content += `\n\n-# ${hint}`;
    const ctr = new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return applyStyle(ctr, guildId);
}

function successPanel(guildId, title, body, actionRows = []) {
    let content = `# ${E.ok} ${title}`;
    if (body) content += `\n\n${body}`;
    const ctr = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    if (actionRows.length) {
        ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        for (const row of actionRows) if (row) ctr.addActionRowComponents(row);
    }
    return applyStyle(ctr, guildId);
}

function infoPanel(guildId, title, body, actionRows = []) {
    const ctr = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}\n\n${body}`));
    if (actionRows.length) {
        ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        for (const row of actionRows) if (row) ctr.addActionRowComponents(row);
    }
    return applyStyle(ctr, guildId);
}

/* ── Views (shared by webhook-list & webhook-info) ──────────────────────── */

function typeLabel(type) {
    return type === 1 ? 'Incoming' : type === 2 ? 'Channel Follower' : 'Application';
}

/**
 * Detail view for a single webhook with quick-action buttons.
 * @param {object} p
 * @param {import('discord.js').Webhook} p.webhook
 * @param {import('discord.js').Guild} p.guild
 * @param {string} p.uid   invoker id
 * @param {string} p.ns    customId namespace (e.g. 'wh' or 'whi')
 * @param {boolean} [p.showBack]  show a "Back to List" button
 */
function detailView({ webhook, guild, uid, ns, showBack = false }) {
    const ch = guild.channels.cache.get(webhook.channelId);
    const avatar = webhook.avatarURL({ size: 256 }) || guild.iconURL({ dynamic: true }) || DEFAULT_AVATAR;

    const header = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${E.hook} ${webhook.name}\n-# Webhook management`
        ))
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: avatar } }));

    const created = Math.floor(webhook.createdTimestamp / 1000);
    const info =
        `### ${E.gear} Overview\n` +
        rows(
            `**ID:** \`${webhook.id}\``,
            `**Channel:** ${ch ? `<#${ch.id}>` : '*Unknown*'}`,
            `**Type:** ${typeLabel(webhook.type)}`,
            `**Owner:** ${webhook.owner ? `<@${webhook.owner.id}>` : '*Unknown*'}`,
            `**Avatar:** ${webhook.avatar ? 'Custom' : 'Default'}`,
            `**Created:** <t:${created}:f> · <t:${created}:R>`
        ) +
        `\n\n### ${E.hook} Token URL\n${E.bullet} ||${webhook.url}||`;

    const ctr = new ContainerBuilder()
        .addSectionComponents(header)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(info))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    const actions = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ns}:send:${uid}:${webhook.id}`).setEmoji(E.send).setLabel('Send').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${ns}:rename:${uid}:${webhook.id}`).setEmoji(E.edit).setLabel('Rename').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`${ns}:del:${uid}:${webhook.id}`).setEmoji(E.trash).setLabel('Delete').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${ns}:${showBack ? 'back' : 'refresh'}:${uid}:${webhook.id}`).setEmoji(showBack ? E.prev : E.refresh).setLabel(showBack ? 'Back' : 'Refresh').setStyle(ButtonStyle.Secondary)
    );
    ctr.addActionRowComponents(actions);
    ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setURL(PORTAL_URL).setLabel('Web Portal').setEmoji(E.hook).setStyle(ButtonStyle.Link)
    ));

    return applyStyle(ctr, guild.id);
}

/**
 * Paginated list view.
 * @returns {{ container: ContainerBuilder, page: number, totalPages: number }}
 */
function listView({ webhooks, guild, page, uid, ns }) {
    const arr = [...webhooks.values()];
    const totalPages = Math.max(1, Math.ceil(arr.length / PER_PAGE));
    const pg = Math.max(0, Math.min(page, totalPages - 1));
    const slice = arr.slice(pg * PER_PAGE, (pg + 1) * PER_PAGE);

    const header = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${E.hook} Server Webhooks\n-# ${arr.length} webhook${arr.length !== 1 ? 's' : ''} total`
        ))
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: guild.iconURL({ dynamic: true }) || DEFAULT_AVATAR } }));

    const lines = slice.map((wh, i) => {
        const idx = pg * PER_PAGE + i + 1;
        const ch = guild.channels.cache.get(wh.channelId);
        return [
            `**${idx}. ${wh.name}**`,
            `${E.bullet} **ID:** \`${wh.id}\``,
            `${E.bullet} **Channel:** ${ch ? `<#${ch.id}>` : '*Unknown*'} · <t:${Math.floor(wh.createdTimestamp / 1000)}:R>`,
        ].join('\n');
    }).join('\n\n');

    const ctr = new ContainerBuilder()
        .addSectionComponents(header)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines || '*No webhooks on this page.*'))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# Page ${pg + 1}/${totalPages} · Select a webhook below to manage it`
        ));

    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ns}:prev:${uid}`).setEmoji(E.prev).setLabel('Prev').setStyle(ButtonStyle.Secondary).setDisabled(pg === 0),
        new ButtonBuilder().setCustomId(`${ns}:next:${uid}`).setEmoji(E.next).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(pg >= totalPages - 1),
        new ButtonBuilder().setCustomId(`${ns}:refresh:${uid}`).setEmoji(E.refresh).setLabel('Refresh').setStyle(ButtonStyle.Primary)
    );
    ctr.addActionRowComponents(nav);

    if (slice.length > 0) {
        ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`${ns}:select:${uid}`)
                .setPlaceholder('Select a webhook to manage')
                .addOptions(slice.map(wh => ({
                    label: wh.name.slice(0, 100),
                    value: wh.id,
                    description: `ID: ${wh.id}`.slice(0, 100),
                    emoji: E.hook,
                })))
        ));
    }

    return { container: applyStyle(ctr, guild.id), page: pg, totalPages };
}

function confirmDeleteView({ webhook, guild, uid, ns }) {
    const ch = guild.channels.cache.get(webhook.channelId);
    const ctr = new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${E.warn} Confirm Deletion\n\nThis action **cannot be undone**.`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(rows(
            `**Name:** ${webhook.name}`,
            `**ID:** \`${webhook.id}\``,
            `**Channel:** ${ch ? `<#${ch.id}>` : '*Unknown*'}`
        )))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ns}:confirmDel:${uid}:${webhook.id}`).setEmoji(E.trash).setLabel('Yes, Delete').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${ns}:cancelDel:${uid}:${webhook.id}`).setEmoji(E.no).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    ));
    return applyStyle(ctr, guild.id);
}

/* ── Modals ─────────────────────────────────────────────────────────────── */

function sendModal(uid, whId, title = 'Send Webhook Message') {
    return new ModalBuilder()
        .setCustomId(`wh_modal_send:${uid}:${whId}`)
        .setTitle(title.slice(0, 45))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('content').setLabel('Message Content')
                    .setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter the message...').setMaxLength(2000).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('username').setLabel('Custom Username (optional)')
                    .setStyle(TextInputStyle.Short).setPlaceholder('Leave blank for webhook default').setMaxLength(80).setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('avatar_url').setLabel('Custom Avatar URL (optional)')
                    .setStyle(TextInputStyle.Short).setPlaceholder('https://example.com/avatar.png').setRequired(false)
            )
        );
}

function renameModal(uid, whId) {
    return new ModalBuilder()
        .setCustomId(`wh_modal_rename:${uid}:${whId}`)
        .setTitle('Rename Webhook')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('new_name').setLabel('New Webhook Name')
                    .setStyle(TextInputStyle.Short).setPlaceholder('Enter new name (1-80 characters)')
                    .setMinLength(1).setMaxLength(80).setRequired(true)
            )
        );
}

/* ── Guards & fetch helpers ─────────────────────────────────────────────── */

/** Ensure the invoker has ManageWebhooks. Returns an error container or null. */
function requireManageWebhooks(member, guildId) {
    if (member?.permissions?.has(PermissionFlagsBits.ManageWebhooks)) return null;
    return errorPanel(guildId, 'Missing Permission', 'You need the **Manage Webhooks** permission.');
}

/** Fetch guild webhooks; returns { webhooks } or { error }. */
async function fetchWebhooks(guild) {
    try {
        return { webhooks: await guild.fetchWebhooks() };
    } catch {
        return { error: errorPanel(guild.id, 'Error', 'Failed to fetch webhooks. Please try again.') };
    }
}

module.exports = {
    E, DEFAULT_AVATAR, PER_PAGE, PORTAL_URL, TIMEOUTS,
    applyStyle, payload, rows,
    errorPanel, successPanel, infoPanel,
    detailView, listView, confirmDeleteView,
    sendModal, renameModal,
    requireManageWebhooks, fetchWebhooks,
};
