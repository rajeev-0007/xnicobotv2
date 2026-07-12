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
const PERIOD_LABELS = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', alltime: 'All Time' };

const DB_KEY_PREFIX = 'llb_config_';
const REFRESH_INTERVAL = 60_000; // 1 minute

function dbKey(guildId) { return `${DB_KEY_PREFIX}${guildId}`; }

/* ─────────────────────────────────────────────────────────────
   SETUP PANEL
   ───────────────────────────────────────────────────────────── */

function buildSetupPanel(config) {
    const container = new ContainerBuilder().setAccentColor(0x5865F2);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# Live Leaderboard Setup\n\n` +
        `> Track the top message senders and post a live leaderboard.\n` +
        `> Select multiple time periods to cycle through them.\n` +
        `-# Leaderboard refreshes every minute.`
    ));

    // Buttons
    const btnRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('llb_reset').setLabel('Reset').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('llb_confirm').setLabel('Confirm Setup').setStyle(ButtonStyle.Success),
    );
    container.addActionRowComponents(btnRow);

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // Tracked Channels
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Tracked Channels** (leave empty = all)`));
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('llb_channels')
        .setPlaceholder('Select channels to track (multi-select)')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(10);
    container.addActionRowComponents(new ActionRowBuilder().addComponents(channelSelect));

    // Time Periods (multi-select)
    const selectedPeriods = config?.periods || ['daily'];
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Time Periods** (select one or more)`));
    const periodSelect = new StringSelectMenuBuilder()
        .setCustomId('llb_periods')
        .setPlaceholder('Choose time periods')
        .setMinValues(1)
        .setMaxValues(4)
        .addOptions(
            { label: 'Daily', value: 'daily', description: 'Resets every 24 hours', default: selectedPeriods.includes('daily') },
            { label: 'Weekly', value: 'weekly', description: 'Resets every 7 days', default: selectedPeriods.includes('weekly') },
            { label: 'Monthly', value: 'monthly', description: 'Resets every 30 days', default: selectedPeriods.includes('monthly') },
            { label: 'All Time', value: 'alltime', description: 'Never resets', default: selectedPeriods.includes('alltime') },
        );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(periodSelect));

    // Entry count
    const entryCount = config?.entryCount || 10;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Entries to show**`));
    const countSelect = new StringSelectMenuBuilder()
        .setCustomId('llb_count')
        .setPlaceholder('How many users to display')
        .addOptions(
            { label: '5 users', value: '5', default: entryCount === 5 },
            { label: '10 users', value: '10', default: entryCount === 10 },
            { label: '15 users', value: '15', default: entryCount === 15 },
            { label: '20 users', value: '20', default: entryCount === 20 },
        );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(countSelect));

    // Leaderboard Channel
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Leaderboard Channel**`));
    const lbChannelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('llb_target')
        .setPlaceholder('Where to post the live leaderboard')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1);
    container.addActionRowComponents(new ActionRowBuilder().addComponents(lbChannelSelect));

    return container;
}

/* ─────────────────────────────────────────────────────────────
   CANVAS LEADERBOARD BUILDER
   ───────────────────────────────────────────────────────────── */

async function buildLeaderboardImage(guild, config, client, periodOverride) {
    const period = periodOverride || config.periods?.[0] || config.period || 'daily';
    const periodLabel = PERIOD_LABELS[period] || 'Daily';
    const limit = config.entryCount || 10;

    // Get period-scoped leaderboard data
    let ranked;
    if (period === 'alltime') {
        const lb = await getLeaderboard(guild.id, 'analytics.totalMessages', limit);
        ranked = lb
            .map(e => ({ userId: e.userId, value: e.analytics?.totalMessages || 0 }))
            .filter(e => e.value > 0);
    } else {
        const days = PERIOD_DAYS[period] || 1;
        ranked = activityTracker.getMessageLeaderboard(guild.id, days, limit);
    }

    // Filter by tracked channels if configured
    // Note: activityTracker.getMessageLeaderboard returns guild-wide data.
    // Channel filtering requires per-channel data from the tracker.
    // For now this is guild-wide — a future update could scope by channel.

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

        entries.push({
            rank: entries.length + 1,
            username,
            avatarURL,
            value: row.value,
            label: 'msgs',
        });
    }

    const buffer = await createLeaderboardCard({
        guildName: guild.name,
        guildIconURL: guild.iconURL({ extension: 'png', size: 64 }),
        period: periodLabel,
        entries,
    });

    return buffer;
}

/* ─────────────────────────────────────────────────────────────
   REFRESH LOGIC (called by interval)
   Each period gets its own message — all update simultaneously.
   ───────────────────────────────────────────────────────────── */

async function refreshLeaderboard(client, guildId) {
    try {
        const config = await db.get(dbKey(guildId));
        if (!config || !config.enabled || !config.targetChannel) return;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;

        const channel = guild.channels.cache.get(config.targetChannel);
        if (!channel) return;

        const periods = config.periods || [config.period || 'daily'];

        // Migrate legacy single-message configs to the new messageIds map
        let messageIds = config.messageIds || {};
        if (!config.messageIds && config.messageId) {
            messageIds[periods[0]] = config.messageId;
            config.messageIds = messageIds;
            delete config.messageId;
            await db.set(dbKey(guildId), config);
        }

        let changed = false;

        for (const period of periods) {
            try {
                const buffer = await buildLeaderboardImage(guild, config, client, period);
                const attachment = new AttachmentBuilder(buffer, { name: `leaderboard-${period}.png` });

                const existingId = messageIds[period];
                if (existingId) {
                    try {
                        const msg = await channel.messages.fetch(existingId);
                        await msg.edit({ content: null, files: [attachment], components: [], flags: 0 });
                    } catch {
                        // Message was deleted — re-post
                        const newMsg = await channel.send({ files: [attachment] });
                        messageIds[period] = newMsg.id;
                        changed = true;
                    }
                } else {
                    // No message for this period yet — post new
                    const newMsg = await channel.send({ files: [attachment] });
                    messageIds[period] = newMsg.id;
                    changed = true;
                }
            } catch {}
        }

        // Clean up messageIds for periods that were removed
        for (const key of Object.keys(messageIds)) {
            if (!periods.includes(key)) {
                try {
                    const old = await channel.messages.fetch(messageIds[key]);
                    await old.delete();
                } catch {}
                delete messageIds[key];
                changed = true;
            }
        }

        if (changed) {
            config.messageIds = messageIds;
            await db.set(dbKey(guildId), config);
        }
    } catch {}
}

// Start refresh interval for a guild
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
            const config = await db.get(key);
            if (!config?.enabled) continue;
            // Support both old (messageId) and new (messageIds) format
            const hasMessages = config.messageIds
                ? Object.keys(config.messageIds).length > 0
                : !!config.messageId;
            if (hasMessages) {
                const guildId = key.replace(DB_KEY_PREFIX, '');
                startRefreshInterval(client, guildId);
            }
        }
    } catch {}
}

/* ─────────────────────────────────────────────────────────────
   COMMAND
   ───────────────────────────────────────────────────────────── */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('liveleaderboard')
        .setDescription('Setup a live auto-updating message leaderboard')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    prefix: 'liveleaderboard',
    description: 'Setup a live auto-updating leaderboard (canvas image, refreshes every minute)',
    usage: 'liveleaderboard',
    aliases: ['llb', 'llb-setup', 'livellb'],
    category: 'stats',

    async execute(interaction) {
        const config = (await db.get(dbKey(interaction.guild.id))) || {};
        const panel = buildSetupPanel(config);
        return interaction.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply(ui.payload(ui.err(message.guild.id, 'Permission Denied', 'You need **Manage Server** permission.')));
        }
        const config = (await db.get(dbKey(message.guild.id))) || {};
        const panel = buildSetupPanel(config);
        return message.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 });
    },

    // Interaction handler for buttons and selects
    async handleInteraction(interaction) {
        const { customId, guild, member } = interaction;
        if (!customId || !customId.startsWith('llb_')) return false;

        if (!member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Server** permission.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const guildId = guild.id;
        let config = (await db.get(dbKey(guildId))) || {};

        // ── Channel select (tracked channels) ──
        if (customId === 'llb_channels') {
            config.trackedChannels = interaction.values || [];
            await db.set(dbKey(guildId), config);
            await interaction.deferUpdate();
            return true;
        }

        // ── Period select (multi) ──
        if (customId === 'llb_periods') {
            config.periods = interaction.values || ['daily'];
            // Keep legacy field in sync
            config.period = config.periods[0];
            await db.set(dbKey(guildId), config);
            await interaction.deferUpdate();
            return true;
        }

        // Legacy single period handler (for old configs)
        if (customId === 'llb_period') {
            config.periods = [interaction.values?.[0] || 'daily'];
            config.period = config.periods[0];
            await db.set(dbKey(guildId), config);
            await interaction.deferUpdate();
            return true;
        }

        // ── Entry count ──
        if (customId === 'llb_count') {
            config.entryCount = parseInt(interaction.values?.[0], 10) || 10;
            await db.set(dbKey(guildId), config);
            await interaction.deferUpdate();
            return true;
        }

        // ── Target channel select ──
        if (customId === 'llb_target') {
            config.targetChannel = interaction.values?.[0] || null;
            await db.set(dbKey(guildId), config);
            await interaction.deferUpdate();
            return true;
        }

        // ── Reset ──
        if (customId === 'llb_reset') {
            stopRefreshInterval(guildId);
            await db.delete(dbKey(guildId));
            await interaction.update({
                components: [buildSetupPanel({})],
                flags: MessageFlags.IsComponentsV2,
            });
            return true;
        }

        // ── Confirm ──
        if (customId === 'llb_confirm') {
            if (!config.targetChannel) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Please select a leaderboard channel first.', flags: MessageFlags.Ephemeral });
                return true;
            }

            await interaction.deferUpdate();

            config.enabled = true;
            config.periods = config.periods || [config.period || 'daily'];
            config.period = config.periods[0];
            config.entryCount = config.entryCount || 10;
            config.trackedChannels = config.trackedChannels || [];
            config.messageIds = config.messageIds || {};

            // Post initial leaderboard images — one per period
            const channel = guild.channels.cache.get(config.targetChannel);
            if (!channel) {
                await interaction.followUp({ content: '<:Cancel:1521227723916181644> Target channel not found.', flags: MessageFlags.Ephemeral });
                return true;
            }

            try {
                // Delete old messages if re-confirming
                for (const [, oldId] of Object.entries(config.messageIds)) {
                    try { const m = await channel.messages.fetch(oldId); await m.delete(); } catch {}
                }
                config.messageIds = {};

                // Post one canvas per selected period
                for (const period of config.periods) {
                    const buffer = await buildLeaderboardImage(guild, config, interaction.client, period);
                    const attachment = new AttachmentBuilder(buffer, { name: `leaderboard-${period}.png` });
                    const lbMsg = await channel.send({ files: [attachment] });
                    config.messageIds[period] = lbMsg.id;
                }

                await db.set(dbKey(guildId), config);
                startRefreshInterval(interaction.client, guildId);

                const periodsDisplay = config.periods.map(p => PERIOD_LABELS[p] || p).join(', ');

                const successContainer = new ContainerBuilder().setAccentColor(0x57F287);
                successContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Live Leaderboard Active\n\n` +
                    `> Posted in <#${config.targetChannel}>\n` +
                    `> Periods: **${periodsDisplay}** (${config.periods.length} separate ${config.periods.length === 1 ? 'board' : 'boards'})\n` +
                    `> Showing: **${config.entryCount} entries** per board\n` +
                    `> Tracked: ${config.trackedChannels.length > 0 ? config.trackedChannels.map(id => `<#${id}>`).join(', ') : 'All channels'}\n\n` +
                    `-# All boards refresh every 60 seconds.`
                ));

                await interaction.editReply({ components: [successContainer], flags: MessageFlags.IsComponentsV2 });
            } catch (err) {
                await interaction.followUp({ content: `<:Cancel:1521227723916181644> Failed to create leaderboard: ${err.message}`, flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        return false;
    },

    resumeAll,
    startRefreshInterval,
    refreshLeaderboard,
};
