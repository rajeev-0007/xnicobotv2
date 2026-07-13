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
        `> Track the top message senders in selected channels and post a live leaderboard.\n` +
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
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Tracked Channels**`));
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId('llb_channels')
        .setPlaceholder('Select channels to track (multi-select)')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(0)
        .setMaxValues(10);
    container.addActionRowComponents(new ActionRowBuilder().addComponents(channelSelect));

    // Time Period
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Time Period**`));
    const periodSelect = new StringSelectMenuBuilder()
        .setCustomId('llb_period')
        .setPlaceholder('Daily')
        .addOptions(
            { label: 'Daily', value: 'daily', description: 'Reset every 24 hours', default: config?.period === 'daily' || !config?.period },
            { label: 'Weekly', value: 'weekly', description: 'Reset every 7 days', default: config?.period === 'weekly' },
            { label: 'Monthly', value: 'monthly', description: 'Reset every 30 days', default: config?.period === 'monthly' },
            { label: 'All Time', value: 'alltime', description: 'Never resets', default: config?.period === 'alltime' },
        );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(periodSelect));

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

async function buildLeaderboardImage(guild, config, client) {
    const period = config.period || 'daily';
    const periodLabel = period === 'weekly' ? 'Weekly' : period === 'monthly' ? 'Monthly' : period === 'alltime' ? 'All Time' : 'Daily';

    // Get period-scoped leaderboard data
    let ranked;
    if (period === 'alltime') {
        // All-time uses the persistent analytics.totalMessages store
        const lb = await getLeaderboard(guild.id, 'analytics.totalMessages', 10);
        ranked = lb
            .map(e => ({ userId: e.userId, value: e.analytics?.totalMessages || 0 }))
            .filter(e => e.value > 0);
    } else {
        // Daily / weekly / monthly use the time-windowed activity tracker
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
   ───────────────────────────────────────────────────────────── */

async function refreshLeaderboard(client, guildId) {
    try {
        const config = await db.get(dbKey(guildId));
        if (!config || !config.enabled || !config.targetChannel || !config.messageId) return;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;

        const channel = guild.channels.cache.get(config.targetChannel);
        if (!channel) return;

        const buffer = await buildLeaderboardImage(guild, config, client);
        const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });

        try {
            const msg = await channel.messages.fetch(config.messageId);
            await msg.edit({ content: null, files: [attachment], components: [], flags: 0 });
        } catch {
            // Message deleted — post new one
            const newMsg = await channel.send({ files: [attachment] });
            config.messageId = newMsg.id;
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
            if (config?.enabled && config?.messageId) {
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
            await interaction.reply({ content: '<:Cancel:1521227723916181644> You need **Manage Server** permission.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }

        const guildId = guild.id;

        // IMPORTANT: acknowledge the interaction BEFORE any awaited DB work.
        // `db.get` lazily loads the custom-data cache from PostgreSQL on a cold
        // start, which can exceed Discord's 3s ack window — that produced the
        // "This interaction failed" error when changing the time period (or any
        // select) repeatedly during setup. Ack first, persist after.

        // ── Selects (tracked channels / period / target channel) ──
        if (customId === 'llb_channels' || customId === 'llb_period' || customId === 'llb_target') {
            try { await interaction.deferUpdate(); } catch { /* already acknowledged */ }
            try {
                const config = (await db.get(dbKey(guildId))) || {};
                if (customId === 'llb_channels') {
                    config.trackedChannels = interaction.values || [];
                } else if (customId === 'llb_period') {
                    config.period = interaction.values?.[0] || 'daily';
                } else {
                    config.targetChannel = interaction.values?.[0] || null;
                }
                await db.set(dbKey(guildId), config);
            } catch (e) {
                // Interaction is already acknowledged; just log the persistence issue.
                try { require('../../utils/logger-styled').error(`[LiveLeaderboard] save failed: ${e.message}`); } catch {}
            }
            return true;
        }

        // ── Reset ── (interaction.update IS the acknowledgement → do it first)
        if (customId === 'llb_reset') {
            stopRefreshInterval(guildId);
            await interaction.update({
                components: [buildSetupPanel({})],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
            await db.delete(dbKey(guildId)).catch(() => {});
            return true;
        }

        // ── Confirm ──
        if (customId === 'llb_confirm') {
            try { await interaction.deferUpdate(); } catch { /* already acknowledged */ }

            const config = (await db.get(dbKey(guildId))) || {};

            if (!config.targetChannel) {
                await interaction.followUp({ content: '<:Cancel:1521227723916181644> Please select a leaderboard channel first.', flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }

            config.enabled = true;
            config.period = config.period || 'daily';
            config.trackedChannels = config.trackedChannels || [];

            const channel = guild.channels.cache.get(config.targetChannel);
            if (!channel) {
                await interaction.followUp({ content: '<:Cancel:1521227723916181644> Target channel not found.', flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }

            try {
                const buffer = await buildLeaderboardImage(guild, config, interaction.client);
                const attachment = new AttachmentBuilder(buffer, { name: 'leaderboard.png' });
                const lbMsg = await channel.send({ files: [attachment] });
                config.messageId = lbMsg.id;

                await db.set(dbKey(guildId), config);
                startRefreshInterval(interaction.client, guildId);

                const successContainer = new ContainerBuilder().setAccentColor(0x57F287);
                successContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Live Leaderboard Active\n\n` +
                    `> Posted in <#${config.targetChannel}>\n` +
                    `> Period: **${config.period}**\n` +
                    `> Tracked: ${config.trackedChannels.length > 0 ? config.trackedChannels.map(id => `<#${id}>`).join(', ') : 'All channels'}\n\n` +
                    `-# Canvas image refreshes every 60 seconds.`
                ));

                await interaction.editReply({ components: [successContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
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
