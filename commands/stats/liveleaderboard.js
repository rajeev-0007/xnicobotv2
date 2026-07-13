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
const VALID_PERIODS = ['daily', 'weekly', 'monthly', 'alltime'];
const VALID_COUNTS = [5, 10, 15, 20];

const DB_KEY_PREFIX = 'llb_config_';
const REFRESH_INTERVAL = 60_000; // 1 minute

function dbKey(guildId) { return `${DB_KEY_PREFIX}${guildId}`; }

/** Coerce a stored config into a safe, normalized shape. */
function normalize(config) {
    const c = (config && typeof config === 'object') ? { ...config } : {};
    let periods = Array.isArray(c.periods) ? c.periods.filter(p => VALID_PERIODS.includes(p)) : [];
    if (periods.length === 0) periods = [VALID_PERIODS.includes(c.period) ? c.period : 'daily'];
    // de-dupe while keeping order
    c.periods = [...new Set(periods)];
    c.period = c.periods[0];
    c.entryCount = VALID_COUNTS.includes(c.entryCount) ? c.entryCount : 10;
    c.trackedChannels = Array.isArray(c.trackedChannels) ? c.trackedChannels : [];
    if (!c.messageIds || typeof c.messageIds !== 'object') c.messageIds = {};
    // migrate legacy single message
    if (c.messageId) { if (!c.messageIds[c.periods[0]]) c.messageIds[c.periods[0]] = c.messageId; delete c.messageId; }
    return c;
}

/* ─────────────────────────────────────────────────────────────
   SETUP PANEL
   ───────────────────────────────────────────────────────────── */

function buildSetupPanel(rawConfig) {
    const config = normalize(rawConfig);
    const container = new ContainerBuilder().setAccentColor(0x5865F2);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# Live Leaderboard Setup\n\n` +
        `> Post live, auto-updating message leaderboards.\n` +
        `> Pick **one or more time periods** — each becomes its own board.\n` +
        `-# Every board refreshes once a minute.`
    ));

    // Buttons
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('llb_reset').setLabel('Reset').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('llb_confirm').setLabel('Confirm Setup').setStyle(ButtonStyle.Success),
    ));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // Time periods (multi-select) — this is the "multiple boards" control.
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**1. Time periods** — select one or more (a board is deployed for each)'));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('llb_periods')
            .setPlaceholder('Choose time periods')
            .setMinValues(1).setMaxValues(4)
            .addOptions(
                { label: 'Daily', value: 'daily', description: 'Resets every 24 hours', default: config.periods.includes('daily') },
                { label: 'Weekly', value: 'weekly', description: 'Resets every 7 days', default: config.periods.includes('weekly') },
                { label: 'Monthly', value: 'monthly', description: 'Resets every 30 days', default: config.periods.includes('monthly') },
                { label: 'All Time', value: 'alltime', description: 'Never resets', default: config.periods.includes('alltime') },
            )
    ));

    // Entry count
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**2. Entries to show**'));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('llb_count')
            .setPlaceholder('How many users to display')
            .addOptions(VALID_COUNTS.map(n => ({ label: `${n} users`, value: String(n), default: config.entryCount === n })))
    ));

    // Leaderboard channel
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('**3. Leaderboard channel** — where the boards post'));
    const targetSelect = new ChannelSelectMenuBuilder()
        .setCustomId('llb_target')
        .setPlaceholder('Select a channel')
        .setChannelTypes(ChannelType.GuildText)
        .setMinValues(1).setMaxValues(1);
    if (config.targetChannel) { try { targetSelect.setDefaultChannels(config.targetChannel); } catch {} }
    container.addActionRowComponents(new ActionRowBuilder().addComponents(targetSelect));

    return container;
}

/* ─────────────────────────────────────────────────────────────
   CANVAS LEADERBOARD BUILDER
   ───────────────────────────────────────────────────────────── */

async function buildLeaderboardImage(guild, config, client, periodOverride) {
    const period = VALID_PERIODS.includes(periodOverride) ? periodOverride
        : (config.periods?.[0] || config.period || 'daily');
    const periodLabel = PERIOD_LABELS[period] || 'Daily';
    const limit = VALID_COUNTS.includes(config.entryCount) ? config.entryCount : 10;

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
   REFRESH LOGIC — one message per period, all update together
   ───────────────────────────────────────────────────────────── */

async function refreshLeaderboard(client, guildId) {
    try {
        const config = normalize(await db.get(dbKey(guildId)));
        if (!config.enabled || !config.targetChannel) { stopRefreshInterval(guildId); return; }

        const guild = client.guilds.cache.get(guildId);
        if (!guild) return;
        const channel = guild.channels.cache.get(config.targetChannel);
        if (!channel) return;

        const messageIds = config.messageIds || {};
        let changed = false;

        // Update / (re)create a board for each selected period.
        for (const period of config.periods) {
            try {
                const buffer = await buildLeaderboardImage(guild, config, client, period);
                const attachment = new AttachmentBuilder(buffer, { name: `leaderboard-${period}.png` });
                const existingId = messageIds[period];
                if (existingId) {
                    try {
                        const msg = await channel.messages.fetch(existingId);
                        await msg.edit({ content: null, files: [attachment], components: [] });
                    } catch {
                        const newMsg = await channel.send({ files: [attachment] });
                        messageIds[period] = newMsg.id; changed = true;
                    }
                } else {
                    const newMsg = await channel.send({ files: [attachment] });
                    messageIds[period] = newMsg.id; changed = true;
                }
            } catch { /* skip this board this cycle */ }
        }

        // Remove boards for periods that are no longer selected.
        for (const key of Object.keys(messageIds)) {
            if (!config.periods.includes(key)) {
                try { const old = await channel.messages.fetch(messageIds[key]); await old.delete(); } catch {}
                delete messageIds[key]; changed = true;
            }
        }

        if (changed) { config.messageIds = messageIds; await db.set(dbKey(guildId), config); }
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
            const config = normalize(await db.get(key));
            if (config.enabled && Object.keys(config.messageIds).length > 0) {
                startRefreshInterval(client, key.replace(DB_KEY_PREFIX, ''));
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

        // IMPORTANT: acknowledge the interaction BEFORE any awaited DB work.
        // db.get lazily loads the Postgres-backed cache on a cold start, which
        // can exceed Discord's 3s window — that produced "This interaction
        // failed" when changing time periods (or any select) during setup.

        // ── Selects that only persist config (no heavy work) ──
        if (customId === 'llb_channels' || customId === 'llb_periods' || customId === 'llb_period' || customId === 'llb_count' || customId === 'llb_target') {
            try { await interaction.deferUpdate(); } catch {}
            try {
                const config = (await db.get(dbKey(guildId))) || {};
                if (customId === 'llb_channels') {
                    config.trackedChannels = interaction.values || [];
                } else if (customId === 'llb_periods') {
                    const vals = (interaction.values || []).filter(v => VALID_PERIODS.includes(v));
                    config.periods = vals.length ? [...new Set(vals)] : ['daily'];
                    config.period = config.periods[0];
                } else if (customId === 'llb_period') {
                    config.periods = [VALID_PERIODS.includes(interaction.values?.[0]) ? interaction.values[0] : 'daily'];
                    config.period = config.periods[0];
                } else if (customId === 'llb_count') {
                    const n = parseInt(interaction.values?.[0], 10);
                    config.entryCount = VALID_COUNTS.includes(n) ? n : 10;
                } else { // llb_target
                    config.targetChannel = interaction.values?.[0] || null;
                }
                await db.set(dbKey(guildId), config);
            } catch (e) {
                try { require('../../utils/logger-styled').error(`[LiveLeaderboard] save failed: ${e.message}`); } catch {}
            }
            return true;
        }

        // ── Reset ── (interaction.update IS the acknowledgement → do it first)
        if (customId === 'llb_reset') {
            stopRefreshInterval(guildId);
            await interaction.update({ components: [buildSetupPanel({})], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            try {
                const config = normalize(await db.get(dbKey(guildId)));
                const channel = config.targetChannel ? guild.channels.cache.get(config.targetChannel) : null;
                if (channel) {
                    for (const id of Object.values(config.messageIds)) {
                        try { const m = await channel.messages.fetch(id); await m.delete(); } catch {}
                    }
                }
            } catch {}
            await db.delete(dbKey(guildId)).catch(() => {});
            return true;
        }

        // ── Confirm — deploy one board per selected period ──
        if (customId === 'llb_confirm') {
            try { await interaction.deferUpdate(); } catch {}

            const config = normalize(await db.get(dbKey(guildId)));

            if (!config.targetChannel) {
                await interaction.followUp({ content: '<:Cancel:1521227723916181644> Pick a **leaderboard channel** first, then Confirm Setup.', flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
            const channel = guild.channels.cache.get(config.targetChannel);
            if (!channel) {
                await interaction.followUp({ content: '<:Cancel:1521227723916181644> That channel no longer exists.', flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }

            try {
                // Delete any previously posted board messages before reposting.
                for (const oldId of Object.values(config.messageIds)) {
                    try { const m = await channel.messages.fetch(oldId); await m.delete(); } catch {}
                }
                config.messageIds = {};

                // Post one canvas per selected period.
                for (const period of config.periods) {
                    const buffer = await buildLeaderboardImage(guild, config, client, period);
                    const attachment = new AttachmentBuilder(buffer, { name: `leaderboard-${period}.png` });
                    const lbMsg = await channel.send({ files: [attachment] });
                    config.messageIds[period] = lbMsg.id;
                }

                config.enabled = true;
                await db.set(dbKey(guildId), config);
                startRefreshInterval(client, guildId);

                const periodsDisplay = config.periods.map(p => PERIOD_LABELS[p] || p).join(', ');
                const successContainer = new ContainerBuilder().setAccentColor(0x57F287);
                successContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Live Leaderboard Active\n\n` +
                    `> Posted in <#${config.targetChannel}>\n` +
                    `> Periods: **${periodsDisplay}** (${config.periods.length} separate ${config.periods.length === 1 ? 'board' : 'boards'})\n` +
                    `> Showing: **${config.entryCount} entries** per board\n\n` +
                    `-# All boards refresh every 60 seconds.`
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
