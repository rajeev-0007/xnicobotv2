const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildInvalidUsage, COLORS } = require('../../utils/responseBuilder');

const PURGE_FILTERS = {
    bots: { label: 'Bot Messages', filter: m => m.author.bot },
    embeds: { label: 'Embeds', filter: m => m.embeds.length > 0 },
    images: { label: 'Images/Attachments', filter: m => m.attachments.size > 0 },
    invites: { label: 'Discord Invites', filter: m => /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\/[a-zA-Z0-9]+/i.test(m.content) },
    links: { label: 'Links', filter: m => /https?:\/\/[^\s]+/i.test(m.content) },
    mentions: { label: 'Mentions', filter: m => m.mentions.users.size > 0 || m.mentions.roles.size > 0 } };

function buildFilterDescription() {
    return Object.keys(PURGE_FILTERS).map(k => `\`${k}\``).join(', ');
}

/* ─── Deleted Message History ─── */
// Map<guildId, Array<{ channelId, channelName, moderator, moderatorId, count, filter, target, timestamp, messages: Array<{author, content, id}> }>>
const deleteHistory = new Map();
const MAX_HISTORY_PER_GUILD = 25;
const MAX_MSGS_PER_ENTRY = 50; // Store up to 50 message previews per clear action

function recordDeletion(guildId, entry) {
    if (!deleteHistory.has(guildId)) deleteHistory.set(guildId, []);
    const history = deleteHistory.get(guildId);
    history.unshift(entry);
    if (history.length > MAX_HISTORY_PER_GUILD) history.length = MAX_HISTORY_PER_GUILD;
}

function getHistory(guildId) {
    return deleteHistory.get(guildId) || [];
}

/* ─── Batch delete: up to 1000 messages, resilient to stale/old messages ─── */
// Discord's bulk-delete endpoint rejects the ENTIRE batch if any single
// message is older than 14 days or already gone (stale ID). That is the
// classic "failed to clear" intermittent bug. So we (a) pre-filter out
// pinned + >14-day-old messages, and (b) fall back to per-message deletes
// if a bulk batch throws, so the operation still succeeds for the rest.
const MAX_BULK_AGE_MS = 14 * 24 * 60 * 60 * 1000 - 60_000; // ~14d, 1min safety margin

async function batchDelete(channel, amount, filterFn, statusCb) {
    let totalDeleted = 0;
    let remaining = amount;
    let lastMessageId;
    let batchNum = 0;
    const collectedMessages = [];
    const maxBatches = Math.ceil(amount / 100) + 3; // safety cap

    while (remaining > 0 && batchNum < maxBatches) {
        batchNum++;
        const fetchLimit = Math.min(100, remaining + 20); // over-fetch for filtered-out msgs
        const fetchOptions = { limit: fetchLimit };
        if (lastMessageId) fetchOptions.before = lastMessageId;

        let fetched;
        try {
            fetched = await channel.messages.fetch(fetchOptions);
        } catch { break; }

        if (fetched.size === 0) break;
        lastMessageId = fetched.last().id;

        // Apply user filter, then drop pinned + too-old messages (those can't
        // be bulk-deleted and would otherwise poison the whole batch).
        const now = Date.now();
        const candidates = filterFn ? fetched.filter(filterFn) : fetched;
        let toDelete = [...candidates.values()]
            .filter(m => !m.pinned && (now - m.createdTimestamp) < MAX_BULK_AGE_MS)
            .slice(0, remaining);

        if (toDelete.length === 0) {
            // If this batch already contains messages too old to delete, every
            // older page will be too old as well — stop. Otherwise keep paging
            // (the filter just didn't match anything here).
            const hitOld = [...candidates.values()].some(m => (now - m.createdTimestamp) >= MAX_BULK_AGE_MS);
            if (hitOld || fetched.size < fetchLimit) break;
            continue;
        }

        // Save previews before deletion (for -clearhistory).
        for (const m of toDelete) {
            if (collectedMessages.length < MAX_MSGS_PER_ENTRY) {
                collectedMessages.push({
                    author: m.author?.username || 'Unknown',
                    authorId: m.author?.id || '0',
                    content: (m.content || '').slice(0, 200) || (m.embeds.length ? '[Embed]' : m.attachments.size ? '[Attachment]' : '[No content]'),
                    id: m.id,
                    timestamp: m.createdTimestamp
                });
            }
        }

        let deletedThisBatch = 0;
        try {
            if (toDelete.length === 1) {
                await toDelete[0].delete();
                deletedThisBatch = 1;
            } else {
                const deleted = await channel.bulkDelete(toDelete, true);
                deletedThisBatch = deleted.size;
            }
        } catch (e) {
            // Bulk endpoint rejected the batch (usually one stale/old ID).
            // Fall back to deleting each message individually so the rest
            // still get removed instead of the whole command failing.
            for (const m of toDelete) {
                try { await m.delete(); deletedThisBatch++; }
                catch { /* already gone, too old, or no perms — skip */ }
            }
            if (deletedThisBatch === 0) {
                console.error('Clear batch error:', e.message);
                break;
            }
        }

        totalDeleted += deletedThisBatch;
        remaining -= deletedThisBatch;

        if (statusCb) {
            await statusCb(totalDeleted, Math.max(0, remaining), batchNum).catch(() => {});
        }

        // Short cooldown between batches to respect rate limits.
        if (remaining > 0) {
            await new Promise(r => setTimeout(r, 1200));
        }
    }

    return { totalDeleted, messages: collectedMessages };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Clear messages from the channel (up to 1000)')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of messages to delete (1-1000)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(1000))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Only delete messages from this user')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('filter')
                .setDescription('Filter type: bots, embeds, images, invites, links, mentions')
                .setRequired(false)
                .addChoices(
                    { name: 'Bot messages', value: 'bots' },
                    { name: 'Embeds', value: 'embeds' },
                    { name: 'Images/Attachments', value: 'images' },
                    { name: 'Discord Invites', value: 'invites' },
                    { name: 'Links/URLs', value: 'links' },
                    { name: 'Mentions', value: 'mentions' }
                ))
        .addStringOption(option =>
            option.setName('contains')
                .setDescription('Only delete messages containing this text')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    
    prefix: 'clear',
    description: 'Clear messages with optional filters (up to 1000, bots, embeds, images, invites, links, mentions, contains, @user)',
    usage: 'clear <amount> [filter|@user|contains:<text>]',
    category: 'admin',
    aliases: ['purge', 'prune', 'c', 'cl', 'purge-bots', 'purge-embeds', 'purge-images', 'purge-invites', 'purge-links', 'purge-mentions', 'purge-contains', 'purge-user', 'clearhistory', 'deletedmsgs'],
    
    // Expose history for external use
    getDeleteHistory: getHistory,

    async execute(interaction) {
        const amount = interaction.options.getInteger('amount');
        const targetUser = interaction.options.getUser('user');
        const filterType = interaction.options.getString('filter');
        const containsText = interaction.options.getString('contains');

        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            // Build combined filter function
            let filterFn = null;
            const filters = [];
            if (targetUser) filters.push(m => m.author.id === targetUser.id);
            if (filterType && PURGE_FILTERS[filterType]) filters.push(PURGE_FILTERS[filterType].filter);
            if (containsText) filters.push(m => m.content.toLowerCase().includes(containsText.toLowerCase()));
            if (filters.length > 0) filterFn = m => filters.every(f => f(m));

            const isBigPurge = amount > 100;

            // Status callback for large purges
            const statusCb = isBigPurge ? async (deleted, left, batch) => {
                await interaction.editReply({
                    components: [new ContainerBuilder().addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# <a:Loading:1521227993995940032> Clearing Messages\n\n**Deleted:** ${deleted} so far\n**Remaining:** ~${left}\n**Batch:** ${batch}\n\n-# A short cooldown runs between batches to respect rate limits.`)
                    )],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            } : null;

            const { totalDeleted, messages } = await batchDelete(interaction.channel, amount, filterFn, statusCb);

            // Record to history (best-effort — never let this surface as a
            // "failed to clear" error after messages were already removed).
            try {
                recordDeletion(interaction.guild.id, {
                    channelId: interaction.channel.id,
                    channelName: interaction.channel.name,
                    moderator: interaction.user.username,
                    moderatorId: interaction.user.id,
                    count: totalDeleted,
                    filter: filterType || null,
                    target: targetUser?.username || null,
                    contains: containsText || null,
                    timestamp: Date.now(),
                    messages
                });
            } catch { /* history is non-critical */ }

            // Nothing deletable — explain why instead of showing success/failure.
            if (totalDeleted === 0) {
                const note = new ContainerBuilder()
                    .setAccentColor(COLORS.WARNING ?? COLORS.ERROR)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Inforect:1521228008285929532> No Messages Deleted\n\n` +
                        `No messages matched your request. This usually means:\n` +
                        `<:Caretright:1521227704953864202> they're older than **14 days** (Discord can't bulk-delete those), or\n` +
                        `<:Caretright:1521227704953864202> no messages matched the filter/user you specified.`
                    ));
                return interaction.editReply({ components: [note], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            let content = `# <:Trash:1521227750420254820> Messages Cleared\n\n`;
            content += `<:Caretright:1521227704953864202> **Deleted:** ${totalDeleted} message${totalDeleted !== 1 ? 's' : ''}\n`;
            content += `<:Caretright:1521227704953864202> **Channel:** ${interaction.channel}\n`;
            content += `<:Caretright:1521227704953864202> **Moderator:** ${interaction.user.username}\n`;
            if (targetUser) content += `<:Caretright:1521227704953864202> **Target User:** ${targetUser.username}\n`;
            if (filterType) content += `<:Caretright:1521227704953864202> **Filter:** ${PURGE_FILTERS[filterType].label}\n`;
            if (containsText) content += `<:Caretright:1521227704953864202> **Contains:** "${containsText}"\n`;
            if (isBigPurge) content += `\n-# Large purge completed in batches with a short cooldown.`;
            content += `\n-# Use \`-clearhistory\` to view deleted message history.`;
            
            const container = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;
            
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        } catch (error) {
            console.error('Clear Error:', error);
            const container = buildErrorResponse(
                'Failed to Clear Messages',
                'An error occurred while deleting messages.',
                (error?.message || '').includes('14 days')
                    ? 'Discord only allows bulk deletion of messages less than 14 days old.'
                    : `Error: ${error?.message || 'Unknown error'}`
            );
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {
                interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
            });
        }
    },

    async executePrefix(message, args) {
        if (!message.guild || !message.member) return;
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            const container = buildPermissionDenied('Manage Messages');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Check if called via clearhistory/deletedmsgs alias
        const invoked = message.content.trim().split(/ +/)[0].toLowerCase().replace(/^[^\w]*/, '');
        if (invoked === 'clearhistory' || invoked === 'deletedmsgs') {
            return this._handleHistory(message, args);
        }

        // Detect if called via a purge-* alias
        let filterType = null;
        let containsText = null;
        let targetUser = message.mentions.users.first();

        // Map purge-* aliases to filter types
        const aliasMap = {
            'purge-bots': 'bots', 'purge-embeds': 'embeds', 'purge-images': 'images',
            'purge-invites': 'invites', 'purge-links': 'links', 'purge-mentions': 'mentions' };

        if (invoked.endsWith('purge-user')) {
            if (!targetUser) {
                const container = buildErrorResponse('Missing User', 'Please mention a user.', 'Usage: `purge-user @user [amount]`');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            const amount = parseInt(args[1]) || 50;
            args[0] = String(amount);
        } else if (invoked.endsWith('purge-contains')) {
            containsText = args.join(' ');
            if (!containsText) {
                const container = buildErrorResponse('Missing Text', 'Please provide text to search for.', 'Usage: `purge-contains <text>`');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            args = ['50'];
        } else if (aliasMap[invoked] || Object.values(aliasMap).some(v => invoked.endsWith(v.replace('purge-', '')))) {
            for (const [alias, type] of Object.entries(aliasMap)) {
                if (invoked.endsWith(alias)) { filterType = type; break; }
            }
        }

        // Parse amount and optional filter for direct clear usage
        let amountArg = args[0];
        const amount = parseInt(amountArg);

        if (isNaN(amount) || amount < 1 || amount > 1000) {
            const container = buildInvalidUsage(
                'clear',
                '-clear <amount> [@user] [filter]',
                [
                    '-clear 10',
                    '-clear 500 @User',
                    '-clear 30 bots',
                    '-clear 20 links',
                    '-clear 50 contains:hello',
                    '-clear 1000 — max 1000 msgs with auto-batching',
                    '-clearhistory — view deleted message log',
                    `-clear 40 — filters: ${buildFilterDescription()}`
                ]
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Parse filter from second arg if not already set by alias
        if (!filterType && !containsText && !targetUser) {
            const filterArg = args[1]?.toLowerCase();
            if (filterArg) {
                if (PURGE_FILTERS[filterArg]) {
                    filterType = filterArg;
                } else if (filterArg.startsWith('contains:')) {
                    containsText = args.slice(1).join(' ').replace(/^contains:/i, '');
                }
            }
        }

        try {
            await message.delete().catch(() => {});

            // Build combined filter function 
            let filterFn = null;
            const filters = [];
            if (targetUser) filters.push(m => m.author.id === targetUser.id);
            if (filterType && PURGE_FILTERS[filterType]) filters.push(PURGE_FILTERS[filterType].filter);
            if (containsText) filters.push(m => m.content.toLowerCase().includes(containsText.toLowerCase()));
            if (filters.length > 0) filterFn = m => filters.every(f => f(m));

            const isBigPurge = amount > 100;
            let statusMsg = null;

            if (isBigPurge) {
                statusMsg = await message.channel.send({
                    components: [new ContainerBuilder().addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# <a:Loading:1521227993995940032> Clearing Messages\n\n**Target:** ${amount} messages\n**Status:** Starting...\n\n-# A short cooldown runs between batches.`)
                    )],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            const statusCb = isBigPurge && statusMsg ? async (deleted, left, batch) => {
                await statusMsg.edit({
                    components: [new ContainerBuilder().addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(`# <a:Loading:1521227993995940032> Clearing Messages\n\n**Deleted:** ${deleted} so far\n**Remaining:** ~${left}\n**Batch:** ${batch}\n\n-# A short cooldown runs between batches.`)
                    )],
                    flags: MessageFlags.IsComponentsV2
                });
            } : null;

            const { totalDeleted, messages } = await batchDelete(message.channel, amount, filterFn, statusCb);

            // Record to history (best-effort).
            try {
                recordDeletion(message.guild.id, {
                    channelId: message.channel.id,
                    channelName: message.channel.name,
                    moderator: message.author.username,
                    moderatorId: message.author.id,
                    count: totalDeleted,
                    filter: filterType || null,
                    target: targetUser?.username || null,
                    contains: containsText || null,
                    timestamp: Date.now(),
                    messages
                });
            } catch { /* history is non-critical */ }

            // Nothing deletable — explain why instead of a scary failure.
            if (totalDeleted === 0) {
                const note = new ContainerBuilder()
                    .setAccentColor(COLORS.WARNING ?? COLORS.ERROR)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Inforect:1521228008285929532> No Messages Deleted\n\n` +
                        `No messages matched your request. They may be older than **14 days** ` +
                        `(Discord can't bulk-delete those) or none matched your filter/user.`
                    ));
                if (statusMsg) {
                    await statusMsg.edit({ components: [note], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                    setTimeout(() => statusMsg.delete().catch(() => {}), 8000);
                } else {
                    const r = await message.channel.send({ components: [note], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
                    if (r) setTimeout(() => r.delete().catch(() => {}), 8000);
                }
                return;
            }

            let content = `# <:Trash:1521227750420254820> Messages Cleared\n\n`;
            content += `<:Caretright:1521227704953864202> **Deleted:** ${totalDeleted} message${totalDeleted !== 1 ? 's' : ''}\n`;
            content += `<:Caretright:1521227704953864202> **Moderator:** ${message.author.username}\n`;
            if (targetUser) content += `<:Caretright:1521227704953864202> **Target User:** ${targetUser.username}\n`;
            if (filterType) content += `<:Caretright:1521227704953864202> **Filter:** ${PURGE_FILTERS[filterType].label}\n`;
            if (containsText) content += `<:Caretright:1521227704953864202> **Contains:** "${containsText}"\n`;
            if (isBigPurge) content += `\n-# Large purge completed in batches with a short cooldown.`;
            content += `\n-# Use \`-clearhistory\` to view deleted message history.`;
            content += `\n-# This message will be deleted in 8 seconds.`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;

            if (statusMsg) {
                await statusMsg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
                setTimeout(() => statusMsg.delete().catch(() => {}), 8000);
            } else {
                const reply = await message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
                setTimeout(() => reply.delete().catch(() => {}), 8000);
            }
        } catch (error) {
            console.error('Clear Error:', error);
            const container = buildErrorResponse(
                'Failed to Clear Messages',
                'An error occurred while deleting messages.',
                (error?.message || '').includes('14 days')
                    ? 'Discord only allows bulk deletion of messages less than 14 days old.'
                    : `Error: ${error?.message || 'Unknown error'}`
            );
            message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    /* ─── Pagination Constants ─── */
    ENTRIES_PER_PAGE: 10,
    MSGS_PER_PAGE: 10,

    /* ─── Build History List Page ─── */
    _buildHistoryListPage(history, page) {
        const perPage = this.ENTRIES_PER_PAGE;
        const totalPages = Math.max(1, Math.ceil(history.length / perPage));
        page = Math.max(0, Math.min(page, totalPages - 1));
        const start = page * perPage;
        const slice = history.slice(start, start + perPage);

        const lines = slice.map((h, i) => {
            const num = start + i + 1;
            const time = `<t:${Math.floor(h.timestamp / 1000)}:R>`;
            const filterInfo = h.filter ? ` (${h.filter})` : h.target ? ` (@${h.target})` : h.contains ? ` (contains: ${h.contains.slice(0, 20)})` : '';
            return `\`${num}.\` **${h.count}** msgs in <#${h.channelId}> by <@${h.moderatorId}> ${time}${filterInfo}`;
        }).join('\n');

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Document:1521227875016114266> Deleted Message History\n\n` +
            `${lines}\n\n` +
            `-# Use \`-clearhistory <number>\` to view deleted messages from a specific entry.\n` +
            `-# Page ${page + 1}/${totalPages} — ${history.length} entries (max ${MAX_HISTORY_PER_GUILD} per server)`
        ));

        if (totalPages > 1) {
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            const row = new ActionRowBuilder();
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`clrhist_list_${page - 1}`)
                    .setEmoji('<:History:1521227863079256278>')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId(`clrhist_listpg_${page}`)
                    .setLabel(`${page + 1} / ${totalPages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`clrhist_list_${page + 1}`)
                    .setEmoji('<:Caretright:1521227704953864202>')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page >= totalPages - 1)
            );
            container.addActionRowComponents(row);
        }

        return container;
    },

    /* ─── Build History Detail Page ─── */
    _buildHistoryDetailPage(entry, entryIdx, page) {
        const perPage = this.MSGS_PER_PAGE;
        const msgs = entry.messages || [];
        const totalPages = Math.max(1, Math.ceil(msgs.length / perPage) || 1);
        page = Math.max(0, Math.min(page, totalPages - 1));
        const start = page * perPage;
        const slice = msgs.slice(start, start + perPage);

        const time = `<t:${Math.floor(entry.timestamp / 1000)}:F>`;
        let content = `# <:Document:1521227875016114266> Clear Entry #${entryIdx}\n\n`;
        content += `<:Caretright:1521227704953864202> **Channel:** <#${entry.channelId}> (${entry.channelName})\n`;
        content += `<:Caretright:1521227704953864202> **Moderator:** <@${entry.moderatorId}> (${entry.moderator})\n`;
        content += `<:Caretright:1521227704953864202> **Deleted:** ${entry.count} messages\n`;
        content += `<:Caretright:1521227704953864202> **Time:** ${time}\n`;
        if (entry.filter) content += `<:Caretright:1521227704953864202> **Filter:** ${entry.filter}\n`;
        if (entry.target) content += `<:Caretright:1521227704953864202> **Target:** @${entry.target}\n`;
        if (entry.contains) content += `<:Caretright:1521227704953864202> **Contains:** "${entry.contains}"\n`;

        content += '\n### Deleted Messages Preview\n';

        if (msgs.length === 0) {
            content += '> No message content was recorded.\n';
        } else {
            const msgLines = slice.map((m, i) => {
                const num = start + i + 1;
                const msgContent = m.content.replace(/\n/g, ' ').slice(0, 100);
                const msgTime = m.timestamp ? `<t:${Math.floor(m.timestamp / 1000)}:t>` : '';
                return `> \`${num}.\` **${m.author}** ${msgTime}\n> ${msgContent}`;
            });
            content += msgLines.join('\n');
            content += `\n\n-# Page ${page + 1}/${totalPages} — ${msgs.length} recorded messages`;
        }

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        // Always show navigation row (back + pagination)
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        const row = new ActionRowBuilder();
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('clrhist_list_0')
                .setEmoji('<:History:1521227863079256278>')
                .setLabel('Back to List')
                .setStyle(ButtonStyle.Primary)
        );
        if (totalPages > 1) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`clrhist_detail_${entryIdx}_${page - 1}`)
                    .setEmoji('<:History:1521227863079256278>')
                    .setLabel('Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId(`clrhist_detailpg_${entryIdx}_${page}`)
                    .setLabel(`${page + 1} / ${totalPages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`clrhist_detail_${entryIdx}_${page + 1}`)
                    .setEmoji('<:Caretright:1521227704953864202>')
                    .setLabel('Next')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page >= totalPages - 1)
            );
        }
        container.addActionRowComponents(row);

        return container;
    },

    /* ─── Deleted Message History Viewer ─── */
    async _handleHistory(ctx, args) {
        const guildId = ctx.guild?.id;
        if (!guildId) return;

        const history = getHistory(guildId);
        if (history.length === 0) {
            const c = new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent('# <:Document:1521227875016114266> Deleted Message History\n\nNo recent clear operations recorded.\n\n-# History is stored in memory and resets when the bot restarts.')
            );
            return ctx.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        // If a number is provided, show details for that entry (page 0)
        const entryIdx = parseInt(args[0]);
        if (!isNaN(entryIdx) && entryIdx >= 1 && entryIdx <= history.length) {
            const container = this._buildHistoryDetailPage(history[entryIdx - 1], entryIdx, 0);
            return ctx.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Show overview page 0
        const container = this._buildHistoryListPage(history, 0);
        return ctx.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    /* ─── Button Handler for Pagination ─── */
    async handleButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('clrhist_')) return false;

        const guildId = interaction.guild?.id;
        if (!guildId) return false;

        // Check permissions
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            await interaction.reply(require('../../utils/adminUI').errReply('Missing Permission', 'You need the **Manage Messages** permission.', { ephemeral: true })).catch(() => {});
            return true;
        }

        const history = getHistory(guildId);

        // clrhist_list_{page} — navigate list pages
        if (customId.startsWith('clrhist_list_')) {
            const page = parseInt(customId.split('_')[2]) || 0;
            if (history.length === 0) {
                const c = new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('# <:Document:1521227875016114266> Deleted Message History\n\nNo recent clear operations recorded.')
                );
                await interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                return true;
            }
            const container = this._buildHistoryListPage(history, page);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }

        // clrhist_detail_{entryIdx}_{page} — navigate detail pages
        if (customId.startsWith('clrhist_detail_')) {
            const parts = customId.split('_');
            const entryIdx = parseInt(parts[2]);
            const page = parseInt(parts[3]) || 0;
            const entry = history[entryIdx - 1];
            if (!entry) {
                await interaction.reply(require('../../utils/adminUI').errReply('Not Found', 'That history entry no longer exists.', { ephemeral: true })).catch(() => {});
                return true;
            }
            const container = this._buildHistoryDetailPage(entry, entryIdx, page);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }

        return false;
    },

    // Slash command handler for clearhistory (same menu)
    async handleClearHistory(interaction) {
        const guildId = interaction.guild?.id;
        if (!guildId) return;

        const history = getHistory(guildId);
        if (history.length === 0) {
            const c = new ContainerBuilder().addTextDisplayComponents(
                new TextDisplayBuilder().setContent('# <:Document:1521227875016114266> Deleted Message History\n\nNo recent clear operations recorded.')
            );
            return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const container = this._buildHistoryListPage(history, 0);
        return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }
};
