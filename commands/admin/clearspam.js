'use strict';

/**
 * serverpurge.js — server-wide purge of a single user's recent messages
 * across EVERY channel at once (instead of one channel like /clear).
 *
 * Built for raid / crypto-spam cleanup: one command removes a spammer's
 * messages everywhere. Scans the last N messages per channel, applies
 * optional filters (links, invites, images, contains, time window), and
 * bulk-deletes the matches. Discord can only bulk-delete messages < 14 days
 * old, so older ones are skipped (reported in the summary).
 *
 * Safety: it only ever targets ONE user's messages, requires Manage Messages,
 * and asks for confirmation before running because the blast radius is the
 * whole server.
 */

const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
    ContainerBuilder, TextDisplayBuilder,
} = require('discord.js');
const { buildErrorResponse, buildPermissionDenied, COLORS } = require('../../utils/responseBuilder');
const { confirmAction } = require('../../utils/confirmAction');

const MAX_BULK_AGE_MS = 14 * 24 * 60 * 60 * 1000 - 60_000; // ~14d with 1min margin
const DEFAULT_SCAN = 100;   // messages scanned per channel
const MAX_SCAN = 500;       // hard cap per channel

const FILTERS = {
    text:     { label: 'Plain Text',       fn: m => (m.content || '').trim().length > 0 },
    links:    { label: 'Links',           fn: m => /https?:\/\/[^\s]+/i.test(m.content) },
    invites:  { label: 'Discord Invites',  fn: m => /(discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i.test(m.content) },
    images:   { label: 'Images/Attachments', fn: m => m.attachments.size > 0 },
    embeds:   { label: 'Embeds',           fn: m => m.embeds.length > 0 },
    mentions: { label: 'Mentions',         fn: m => m.mentions.users.size > 0 || m.mentions.roles.size > 0 || m.mentions.everyone },
};

const E = {
    trash: '<:Trash:1521227750420254820>',
    arrow: '<:Caretright:1521227704953864202>',
    load:  '<a:Loading:1521227993995940032>',
    info:  '<:Inforect:1521228008285929532>',
    shield:'<:Shield:1521227694677692467>',
};

function buildCombinedFilter(userId, filterType, containsText, sinceMs) {
    const checks = [m => m.author?.id === userId];
    if (filterType && FILTERS[filterType]) checks.push(FILTERS[filterType].fn);
    if (containsText) {
        const needle = containsText.toLowerCase();
        checks.push(m => (m.content || '').toLowerCase().includes(needle));
    }
    if (sinceMs) checks.push(m => m.createdTimestamp >= sinceMs);
    return m => checks.every(fn => fn(m));
}

/**
 * Purge a user's matching messages from one channel.
 * @returns {Promise<number>} messages deleted
 */
async function purgeChannel(channel, scanLimit, filterFn) {
    let deleted = 0;
    let before;
    let fetchedTotal = 0;
    const collected = [];
    const now = Date.now();

    while (fetchedTotal < scanLimit) {
        const limit = Math.min(100, scanLimit - fetchedTotal);
        let batch;
        try {
            batch = await channel.messages.fetch(before ? { limit, before } : { limit });
        } catch { break; }
        if (batch.size === 0) break;
        fetchedTotal += batch.size;
        before = batch.last().id;

        for (const m of batch.values()) {
            if (m.pinned) continue;
            if ((now - m.createdTimestamp) >= MAX_BULK_AGE_MS) continue;
            if (filterFn(m)) collected.push(m);
        }
        if (batch.size < limit) break;
    }

    // Delete in bulk batches of up to 100; fall back to single deletes.
    for (let i = 0; i < collected.length; i += 100) {
        const slice = collected.slice(i, i + 100);
        try {
            if (slice.length === 1) { await slice[0].delete(); deleted += 1; }
            else { const res = await channel.bulkDelete(slice, true); deleted += res.size; }
        } catch {
            for (const m of slice) { try { await m.delete(); deleted++; } catch {} }
        }
    }
    return deleted;
}

/**
 * Run the server-wide purge. Returns a summary { totalDeleted, channelsHit, channelsScanned }.
 */
async function runServerPurge(guild, userId, { scanLimit, filterFn, onProgress }) {
    const me = guild.members.me;
    const targets = [];

    // Text-based guild channels the bot can read + manage.
    for (const ch of guild.channels.cache.values()) {
        if (!ch.isTextBased?.()) continue;
        const perms = ch.permissionsFor(me);
        if (!perms?.has(PermissionFlagsBits.ViewChannel)) continue;
        if (!perms.has(PermissionFlagsBits.ReadMessageHistory)) continue;
        if (!perms.has(PermissionFlagsBits.ManageMessages)) continue;
        targets.push(ch);
    }
    // Include active threads (forum posts / discussion threads).
    try {
        const active = await guild.channels.fetchActiveThreads();
        for (const th of active.threads.values()) {
            const perms = th.permissionsFor(me);
            if (perms?.has(PermissionFlagsBits.ManageMessages) && perms.has(PermissionFlagsBits.ReadMessageHistory)) {
                targets.push(th);
            }
        }
    } catch {}

    let totalDeleted = 0, channelsHit = 0, done = 0;
    for (const ch of targets) {
        const n = await purgeChannel(ch, scanLimit, filterFn);
        if (n > 0) { totalDeleted += n; channelsHit++; }
        done++;
        if (onProgress && (done % 5 === 0 || done === targets.length)) {
            await onProgress(done, targets.length, totalDeleted).catch(() => {});
        }
        // Light pacing to respect rate limits across many channels.
        await new Promise(r => setTimeout(r, 350));
    }
    return { totalDeleted, channelsHit, channelsScanned: targets.length };
}

function summaryContainer({ target, totalDeleted, channelsHit, channelsScanned, scanLimit, filterType, containsText, hours }) {
    let content = `# ${E.trash} Spam Cleanup Complete\n\n`;
    content += `${E.arrow} **Target:** ${target}\n`;
    content += `${E.arrow} **Deleted:** ${totalDeleted} message${totalDeleted !== 1 ? 's' : ''}\n`;
    content += `${E.arrow} **Channels cleaned:** ${channelsHit} of ${channelsScanned} scanned\n`;
    content += `${E.arrow} **Scan depth:** last ${scanLimit} msgs/channel\n`;
    if (filterType) content += `${E.arrow} **Filter:** ${FILTERS[filterType].label}\n`;
    if (containsText) content += `${E.arrow} **Contains:** "${containsText}"\n`;
    if (hours) content += `${E.arrow} **Window:** last ${hours}h\n`;
    content += `\n-# Only messages newer than 14 days can be removed (Discord limit).`;
    return new ContainerBuilder().setAccentColor(COLORS.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

function progressContainer(done, total, deleted, targetName) {
    return new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${E.load} Cleaning ${targetName}'s messages...\n\n**Channels:** ${done}/${total}\n**Deleted so far:** ${deleted}`
    ));
}

function confirmDescription({ target, scanLimit, filterType, containsText, hours }) {
    let d = `Delete **${target}**'s recent messages across **all channels** the bot can manage.\n\n`;
    d += `${E.arrow} **Scan depth:** last ${scanLimit} msgs per channel\n`;
    if (filterType) d += `${E.arrow} **Filter:** ${FILTERS[filterType].label}\n`;
    if (containsText) d += `${E.arrow} **Contains:** "${containsText}"\n`;
    if (hours) d += `${E.arrow} **Window:** last ${hours}h\n`;
    d += `\n-# Only this user's messages are affected. **This cannot be undone.**`;
    return d;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('clearspam')
        .setDescription("Delete a user's recent messages across ALL channels at once")
        .addUserOption(o => o.setName('user').setDescription('User whose messages to clear').setRequired(true))
        .addIntegerOption(o => o.setName('scan').setDescription(`Messages to scan per channel (default ${DEFAULT_SCAN}, max ${MAX_SCAN})`).setMinValue(10).setMaxValue(MAX_SCAN))
        .addIntegerOption(o => o.setName('hours').setDescription('Only delete messages from the last X hours').setMinValue(1).setMaxValue(336))
        .addStringOption(o => o.setName('filter').setDescription('Only delete messages matching a type')
            .addChoices(
                { name: 'Plain Text', value: 'text' },
                { name: 'Links/URLs', value: 'links' },
                { name: 'Discord Invites', value: 'invites' },
                { name: 'Images/Attachments', value: 'images' },
                { name: 'Embeds', value: 'embeds' },
                { name: 'Mentions', value: 'mentions' },
            ))
        .addStringOption(o => o.setName('contains').setDescription('Only delete messages containing this text'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    prefix: 'clearspam',
    description: "Delete a user's recent messages across ALL channels (text/links/invites/images/contains/time filters)",
    usage: 'clearspam @user [scan] [filter|contains:<text>]',
    category: 'admin',
    aliases: ['spampurge', 'prunespam', 'purgeall', 'cleanuser', 'serverpurge'],

    async execute(interaction) {
        const target = interaction.options.getUser('user');
        const scanLimit = Math.min(interaction.options.getInteger('scan') || DEFAULT_SCAN, MAX_SCAN);
        const hours = interaction.options.getInteger('hours');
        const filterType = interaction.options.getString('filter');
        const containsText = interaction.options.getString('contains');

        if (!interaction.guild) return;
        if (target.id === interaction.client.user.id) {
            return interaction.reply({ components: [buildErrorResponse('Invalid Target', "I can't clear my own messages this way.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const { confirmed, button } = await confirmAction(interaction, false, {
            title: 'Confirm Spam Cleanup',
            description: confirmDescription({ target: target.username, scanLimit, filterType, containsText, hours }),
            confirmLabel: 'Clear Everywhere',
        });
        if (!confirmed) return;

        const sinceMs = hours ? Date.now() - hours * 3600_000 : null;
        const filterFn = buildCombinedFilter(target.id, filterType, containsText, sinceMs);
        const onProgress = async (done, total, deleted) => {
            await button.editReply({ components: [progressContainer(done, total, deleted, target.username)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        };

        try {
            const res = await runServerPurge(interaction.guild, target.id, { scanLimit, filterFn, onProgress });
            await button.editReply({ components: [summaryContainer({ target: target.username, ...res, scanLimit, filterType, containsText, hours })], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('ClearSpam Error:', error);
            await button.editReply({ components: [buildErrorResponse('Cleanup Failed', 'An error occurred during the spam cleanup.', `Error: ${error?.message || 'Unknown'}`)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        if (!message.guild || !message.member) return;
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply({ components: [buildPermissionDenied('Manage Messages')], flags: MessageFlags.IsComponentsV2 });
        }

        const target = message.mentions.users.first();
        if (!target) {
            return message.reply({ components: [buildErrorResponse('Missing User', 'Mention the user whose messages to clear.', 'Usage: `clearspam @user [scan] [filter|contains:<text>]`\nFilters: `text`, `links`, `invites`, `images`, `embeds`, `mentions`')], flags: MessageFlags.IsComponentsV2 });
        }
        if (target.id === message.client.user.id) {
            return message.reply({ components: [buildErrorResponse('Invalid Target', "I can't clear my own messages this way.")], flags: MessageFlags.IsComponentsV2 });
        }

        // Parse args after the mention: optional scan number, filter, or contains:<text>
        const rest = args.filter(a => !/^<@!?\d+>$/.test(a));
        let scanLimit = DEFAULT_SCAN, filterType = null, containsText = null;
        for (const a of rest) {
            const low = a.toLowerCase();
            if (/^\d+$/.test(a)) scanLimit = Math.min(Math.max(parseInt(a, 10), 10), MAX_SCAN);
            else if (FILTERS[low]) filterType = low;
            else if (low.startsWith('contains:')) containsText = rest.join(' ').replace(/^.*contains:/i, '').trim();
        }

        const { confirmed, button } = await confirmAction(message, true, {
            title: 'Confirm Spam Cleanup',
            description: confirmDescription({ target: target.username, scanLimit, filterType, containsText, hours: null }),
            confirmLabel: 'Clear Everywhere',
        });
        if (!confirmed) return;

        const filterFn = buildCombinedFilter(target.id, filterType, containsText, null);
        const onProgress = async (done, total, deleted) => {
            await button.editReply({ components: [progressContainer(done, total, deleted, target.username)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        };

        try {
            const res = await runServerPurge(message.guild, target.id, { scanLimit, filterFn, onProgress });
            await button.editReply({ components: [summaryContainer({ target: target.username, ...res, scanLimit, filterType, containsText, hours: null })], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('ClearSpam Error:', error);
            await button.editReply({ components: [buildErrorResponse('Cleanup Failed', 'An error occurred during the spam cleanup.', `Error: ${error?.message || 'Unknown'}`)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },
};
