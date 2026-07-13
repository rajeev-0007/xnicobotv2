'use strict';

const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags, AttachmentBuilder,
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType
} = require('discord.js');
const { db, getLeaderboard } = require('../../utils/database');
const { createLeaderboardCard } = require('../../utils/liveLeaderboardCard');
const activityTracker = require('../../utils/activityTracker');
const ui = require('../../utils/statsUI');

const PERIOD_DAYS = { daily: 1, weekly: 7, monthly: 30 };
const PERIOD_LABEL = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', alltime: 'All Time' };
const PERIODS = ['daily', 'weekly', 'monthly', 'alltime'];

const DB_KEY_PREFIX = 'llb_config_';
const REFRESH_INTERVAL = 60_000; // 1 minute

function dbKey(guildId) { return `${DB_KEY_PREFIX}${guildId}`; }

/**
 * Normalize a stored config to the multi-board shape:
 *   { boards: { [period]: { period, targetChannel, messageId } }, draft: {...} }
 * Migrates the legacy single-board shape (top-level messageId/targetChannel/period).
 */
function normalizeConfig(config) {
    const c = config && typeof config === 'object' ? { ...config } : {};
    if (!c.boards || typeof c.boards !== 'object') {
        c.boards = {};
        // Legacy single-board migration
        if (c.messageId && c.targetChannel) {
            const p = PERIODS.includes(c.period) ? c.period : 'daily';
            c.boards[p] = { period: p, targetChannel: c.targetChannel, messageId: c.messageId };
        }
    }
    if (!c.draft || typeof c.draft !== 'object') {
        c.draft = {
            period: PERIODS.includes(c.period) ? c.period : 'daily',
            targetChannel: c.targetChannel || null,
        };
    }
    // Drop legacy top-level fields so they can't resurrect stale boards.
    delete c.messageId; delete c.targetChannel; delete c.period; delete c.trackedChannels; delete c.enabled;
    return c;
}

function activePeriods(config) {
    return PERIODS.filter(p => config.boards?.[p]?.messageId);
}

/* ─────────────────────────────────────────────────────────────
   SETUP PANEL
   ───────────────────────────────────────────────────────────── */

function buildSetupPanel(rawConfig) {
    const config = normalizeConfig(rawConfig);
    const draft = config.draft;
    const active = activePeriods(config);

    const container = new ContainerBuilder().setAccentColor(0x5865F2);

    let header =
        `# Live Leaderboard Setup\n\n` +
        `> Deploy auto-updating message leaderboards. You can run **one board per time period** ` +
        `(Daily · Weekly · Monthly · All Time) at the same time, each in its own channel.\n` +
        `-# Every board refreshes once a minute.`;
    if (active.length) {
        header += `\n\n**Active boards (${active.length}):**\n` +
            active.map(p => `> ${PERIOD_LABEL[p]} → <#${config.boards[p].targetChannel}>`).join('\n');
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));

    // Buttons
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('llb_reset').setLabel('Reset All').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('llb_confirm').setLabel('Deploy Board').setStyle(ButtonStyle.Success),
    ));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // Time period
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**1. Time period** — which board to deploy'));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('llb_period')
            .setPlaceholder('Select a time period')
            .addOptions(PERIODS.map(p => ({
                label: `${PERIOD_LABEL[p]}${active.includes(p) ? ' (active)' : ''}`,
                value: p,
                description: p === 'daily' ? 'Last 24 hours'
                    : p === 'weekly' ? 'Last 7 days'
                        : p === 'monthly' ? 'Last 30 days' : 'Never resets',
                default: draft.period === p,
            })))
    ));

    // Target channel
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**2. Leaderboard channel** — where this board posts'));
    const targetSelect = new ChannelSelectMenuBuilder()
        .setCustomId('llb_target')
        .setPlaceholder('Select a channel')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1).setMaxValues(1);
    if (draft.targetChannel) { try { targetSelect.setDefaultChannels(draft.targetChannel); } catch {} }
    container.addActionRowComponents(new ActionRowBuilder().addComponents(targetSelect));

    // Remove a board (only when boards exist)
    if (active.length) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**Remove a board**'));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('llb_remove')
                .setPlaceholder('Select a board to stop & remove')
                .setMinValues(1).setMaxValues(1)
                .addOptions(active.map(p => ({
                    label: `${PERIOD_LABEL[p]} board`,
                    value: p,
                    description: `Stop and delete the ${PERIOD_LABEL[p].toLowerCase()} board`,
                })))
        ));
    }

    return container;
}

/* ─────────────────────────────────────────────────────────────
   CANVAS LEADERBOARD BUILDER
   ───────────────────────────────────────────────────────────── */

async function buildLeaderboardImage(guild, board, client) {
    const period = PERIODS.includes(board.period) ? board.period : 'daily';
    const periodLabel = PERIOD_LABEL[period];

    let ranked;
    if (period === 'alltime') {
        const lb = await getLeaderboard(guild.id, 'analytics.totalMessages', 10);
        ranked = lb
            .map(e => ({ userId: e.userId, value: e.analytics?.totalMessages || 0 }))
            .filter(e => e.value > 0);
    } else {
        const days = PERIOD_DAYS[period] || 1;
        ranked = activityTracker.getMessageLeaderboard(guild.id, days, 10);
    }

    const entries = [];
    for (const row of ranked) {
        let username = row.userId;
        let avatarURL = null;
        try {
            const member = await guild.members.fetch(row.userId);
            username = member.user.username;
            avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 64 });
        } catch {
            try {
                const u = await client.users.fetch(row.userId);
                username = u.username;
                avatarURL = u.displayAvatarURL({ extension: 'png', size: 64 });
            } catch {}
        }
        entries.push({ rank: entries.length + 1, username, avatarURL, value: row.value, label: 'msgs' });
    }

    return createLeaderboardCard({
        guildName: guild.name,
        guildIconURL: guild.iconURL({ extension: 'png', size: 64 }),
        period: periodLabel,
        entries,
    });
}

/* ─────────────────────────────────────────────────────────────
   REFRESH LOGIC — refreshes EVERY active board for the guild
   ───────────────────────────────────────────────────────────── */

async function refreshLeaderboard(client, guildId) {
    try {
        const config = normalizeConfig(await db.get(dbKey(guildId)));
        const active = activePeriods(config);
        if (active.length === 0) { stopRefreshInterval(guildId); return; }

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;

        let changed = false;
        for (const period of active) {
            const board = config.boards[period];
            const channel = guild.channels.cache.get(board.targetChannel);
            if (!channel) continue;
            try {
                const buffer = await buildLeaderboardImage(guild, board, client);
                const attachment = new AttachmentBuilder(buffer, { name: `leaderboard-${period}.png` });
                try {
                    const msg = await channel.messages.fetch(board.messageId);
                    await msg.edit({ content: null, files: [attachment], components: [] });
                } catch {
                    // Original message deleted — repost and remember the new id.
                    const newMsg = await channel.send({ files: [attachment] });
                    board.messageId = newMsg.id;
                    changed = true;
                }
            } catch { /* skip this board this cycle */ }
        }
        if (changed) await db.set(dbKey(guildId), config);
    } catch { /* never throw from the interval */ }
}

function startRefreshInterval(client, guildId) {
    if (!global._llbIntervals) global._llbIntervals = new Map();
    if (global._llbIntervals.has(guildId)) return;
    const interval = setInterval(() => refreshLeaderboard(client, guildId), REFRESH_INTERVAL);
    if (interval.unref) interval.unref();
    global._llbIntervals.set(guildId, interval);
}

function stopRefreshInterval(guildId) {
    if (!global._llbIntervals) return;
    const interval = global._llbIntervals.get(guildId);
    if (interval) { clearInterval(interval); global._llbIntervals.delete(guildId); }
}

/* ─────────────────────────────────────────────────────────────
   BOOT: resume all active leaderboards
   ───────────────────────────────────────────────────────────── */

async function resumeAll(client) {
    try {
        const keys = await db.list(DB_KEY_PREFIX);
        for (const key of keys) {
            const config = normalizeConfig(await db.get(key));
            if (activePeriods(config).length > 0) {
                startRefreshInterval(client, key.replace(DB_KEY_PREFIX, ''));
            }
        }
    } catch {}
}

/* ─────────────────────────────────────────────────────────────
   COMMAND
   ───────────────────────────────────────────────────────────── */

async function deleteBoardMessage(guild, board) {
    if (!board?.messageId || !board?.targetChannel) return;
    try {
        const ch = guild.channels.cache.get(board.targetChannel);
        const msg = await ch?.messages.fetch(board.messageId);
        await msg?.delete();
    } catch { /* already gone */ }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('liveleaderboard')
        .setDescription('Setup live auto-updating message leaderboards (one per time period)')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    prefix: 'liveleaderboard',
    description: 'Setup live auto-updating leaderboards (canvas image, refreshes every minute)',
    usage: 'liveleaderboard',
    aliases: ['llb', 'llb-setup', 'livellb'],
    category: 'stats',

    async execute(interaction) {
        const config = await db.get(dbKey(interaction.guild.id));
        return interaction.reply({ components: [buildSetupPanel(config)], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply(ui.payload(ui.err(message.guild.id, 'Permission Denied', 'You need **Manage Server** permission.')));
        }
        const config = await db.get(dbKey(message.guild.id));
        return message.reply({ components: [buildSetupPanel(config)], flags: MessageFlags.IsComponentsV2 });
    },

    async handleInteraction(interaction) {
        const { customId, guild, member } = interaction;
        if (!customId || !customId.startsWith('llb_')) return false;

        if (!member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Server** permission.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }

        const guildId = guild.id;
        const client = interaction.client;

        // Acknowledge BEFORE any awaited DB work (db.get can lazily load the
        // Postgres cache and blow past Discord's 3s window → "interaction failed").

        // ── Selects that only update the draft ──
        if (customId === 'llb_period' || customId === 'llb_target') {
            try { await interaction.deferUpdate(); } catch {}
            try {
                const config = normalizeConfig(await db.get(dbKey(guildId)));
                config.draft = config.draft || {};
                if (customId === 'llb_period') config.draft.period = interaction.values?.[0] || 'daily';
                else config.draft.targetChannel = interaction.values?.[0] || null;
                await db.set(dbKey(guildId), config);
                await interaction.editReply({ components: [buildSetupPanel(config)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            } catch (e) {
                try { require('../../utils/logger-styled').error(`[LiveLeaderboard] draft save failed: ${e.message}`); } catch {}
            }
            return true;
        }

        // ── Remove a board ──
        if (customId === 'llb_remove') {
            try { await interaction.deferUpdate(); } catch {}
            try {
                const config = normalizeConfig(await db.get(dbKey(guildId)));
                const period = interaction.values?.[0];
                if (config.boards?.[period]) {
                    await deleteBoardMessage(guild, config.boards[period]);
                    delete config.boards[period];
                }
                if (activePeriods(config).length === 0) stopRefreshInterval(guildId);
                await db.set(dbKey(guildId), config);
                await interaction.editReply({ components: [buildSetupPanel(config)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            } catch (e) {
                try { require('../../utils/logger-styled').error(`[LiveLeaderboard] remove failed: ${e.message}`); } catch {}
            }
            return true;
        }

        // ── Reset all ── (interaction.update IS the acknowledgement → do it first)
        if (customId === 'llb_reset') {
            stopRefreshInterval(guildId);
            await interaction.update({ components: [buildSetupPanel({})], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            try {
                const config = normalizeConfig(await db.get(dbKey(guildId)));
                for (const p of activePeriods(config)) await deleteBoardMessage(guild, config.boards[p]);
            } catch {}
            await db.delete(dbKey(guildId)).catch(() => {});
            return true;
        }

        // ── Deploy the drafted board ──
        if (customId === 'llb_confirm') {
            try { await interaction.deferUpdate(); } catch {}

            const config = normalizeConfig(await db.get(dbKey(guildId)));
            const draft = config.draft || {};
            const period = PERIODS.includes(draft.period) ? draft.period : 'daily';

            if (!draft.targetChannel) {
                await interaction.followUp({ content: '<:Cancel:1521227723916181644> Pick a **leaderboard channel** first, then Deploy Board.', flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
            const channel = guild.channels.cache.get(draft.targetChannel);
            if (!channel) {
                await interaction.followUp({ content: '<:Cancel:1521227723916181644> That channel no longer exists.', flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }

            try {
                const board = { period, targetChannel: draft.targetChannel };
                const buffer = await buildLeaderboardImage(guild, board, client);
                const attachment = new AttachmentBuilder(buffer, { name: `leaderboard-${period}.png` });
                const lbMsg = await channel.send({ files: [attachment] });

                // Replacing this period's board? Remove the old posted message.
                const prev = config.boards[period];
                if (prev && !(prev.targetChannel === draft.targetChannel && prev.messageId === lbMsg.id)) {
                    await deleteBoardMessage(guild, prev);
                }

                board.messageId = lbMsg.id;
                config.boards[period] = board;
                await db.set(dbKey(guildId), config);
                startRefreshInterval(client, guildId);

                await interaction.editReply({ components: [buildSetupPanel(config)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                await interaction.followUp({
                    content: `<:Checkedbox:1521227734943269077> **${PERIOD_LABEL[period]}** leaderboard deployed in <#${draft.targetChannel}> — refreshing every minute. Pick another period + channel to add more.`,
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
            } catch (err) {
                await interaction.followUp({ content: `<:Cancel:1521227723916181644> Failed to create leaderboard: ${err.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
            return true;
        }

        return false;
    },

    resumeAll,
    startRefreshInterval,
    refreshLeaderboard,
};
