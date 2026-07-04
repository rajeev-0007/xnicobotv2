'use strict';

const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags, AttachmentBuilder,
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, ChannelSelectMenuBuilder, ChannelType
} = require('discord.js');
const { db, getLeaderboard } = require('../../utils/database');
const { createLeaderboardCard } = require('../../utils/leaderboardCard');
const ui = require('../../utils/statsUI');

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
    const periodLabel = config.period === 'weekly' ? 'Weekly' : config.period === 'monthly' ? 'Monthly' : config.period === 'alltime' ? 'All Time' : 'Daily';

    // Get leaderboard data
    const lb = await getLeaderboard(guild.id, 'analytics.totalMessages', 10);

    const entries = [];
    for (let i = 0; i < lb.length; i++) {
        const entry = lb[i];
        const count = entry.analytics?.totalMessages || 0;
        if (count === 0) continue;

        let username = entry.userId;
        let avatarURL = null;
        try {
            const member = await guild.members.fetch(entry.userId);
            username = member.user.username;
            avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 64 });
        } catch {
            try {
                const u = await client.users.fetch(entry.userId);
                username = u.username;
                avatarURL = u.displayAvatarURL({ extension: 'png', size: 64 });
            } catch {}
        }

        entries.push({
            rank: entries.length + 1,
            username,
            avatarURL,
            value: count,
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

        // ── Period select ──
        if (customId === 'llb_period') {
            config.period = interaction.values?.[0] || 'daily';
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
            config.period = config.period || 'daily';
            config.trackedChannels = config.trackedChannels || [];

            // Post initial leaderboard image
            const channel = guild.channels.cache.get(config.targetChannel);
            if (!channel) {
                await interaction.followUp({ content: '<:Cancel:1521227723916181644> Target channel not found.', flags: MessageFlags.Ephemeral });
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
