'use strict';

/**
 * AFK system
 * ───────────────────────────────────────────────────────────────────
 * Sets a per-user AFK status that is rendered through Components V2.
 * The user gets a polished panel with action buttons:
 *   • End AFK Now   — drop status without sending a message
 *   • Toggle DMs    — flip mention-DM notifications on the live entry
 *   • View Stats    — total AFK count and total time so far
 *
 * Persistence (jsonStore):
 *   afk         { [userId]: { message, timestamp, guildId,
 *                             mentions, previousNickname,
 *                             dmNotifications } }
 *   afk-stats   { [userId]: { count, totalTime } }
 *
 * Counting model
 *   `count`     is incremented exactly ONCE per AFK session, when the
 *               user enters AFK. The companion handler in index.js
 *               only updates `totalTime` when the session ends —
 *               do NOT also bump `count` there or every session
 *               counts as two.
 */

const {
    SlashCommandBuilder, MessageFlags,
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');

/* ─────────────────────────── store helpers ─────────────────────── */

function loadAfkConfig() {
    if (!jsonStore.has('afk')) {
        jsonStore.write('afk', {});
        return {};
    }
    const data = jsonStore.read('afk');
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
}

function saveAfkConfig(config) {
    jsonStore.write('afk', config);
}

function loadAfkStats() {
    if (!jsonStore.has('afk-stats')) {
        jsonStore.write('afk-stats', {});
        return {};
    }
    const data = jsonStore.read('afk-stats');
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
}

function saveAfkStats(stats) {
    jsonStore.write('afk-stats', stats);
}

/* ─────────────────────────── formatting ────────────────────────── */

const ACCENT       = 0xCAD7E6;
const ACCENT_OK    = 0x57F287;
const ACCENT_OFF   = 0xED4245;
const NICK_PREFIX  = '[AFK] ';
const MAX_REASON   = 200;

function formatDuration(ms) {
    if (!ms || ms < 0) ms = 0;
    const s = Math.floor(ms / 1000) % 60;
    const m = Math.floor(ms / 60_000) % 60;
    const h = Math.floor(ms / 3_600_000) % 24;
    const d = Math.floor(ms / 86_400_000);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    if (!d && (s || !parts.length)) parts.push(`${s}s`);
    return parts.join(' ');
}

function pluralize(n, word) {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/* ─────────────────────────── parsing ───────────────────────────── */

/**
 * Parse the raw arg string from the prefix command. Supports:
 *   -afk going for lunch
 *   -afk going for lunch --dm
 *   -afk --dm meeting
 * Returns { reason, dmNotifications }.
 */
function parsePrefixArgs(args) {
    let dmNotifications = false;
    const filtered = [];
    for (const a of args) {
        const lower = a.toLowerCase();
        if (lower === '--dm' || lower === '--dm-notifications') dmNotifications = true;
        else filtered.push(a);
    }
    const reason = filtered.join(' ').trim().slice(0, MAX_REASON) || 'AFK';
    return { reason, dmNotifications };
}

/* ─────────────────────────── nickname ──────────────────────────── */

async function applyAfkNickname(member) {
    if (!member?.manageable) return;
    if (member.nickname?.startsWith(NICK_PREFIX)) return;
    const base = member.displayName.slice(0, 32 - NICK_PREFIX.length);
    await member.setNickname(`${NICK_PREFIX}${base}`).catch(() => {});
}

async function restoreNickname(member, previousNickname) {
    if (!member?.manageable) return;
    if (!member.nickname?.startsWith(NICK_PREFIX)) return;
    await member.setNickname(previousNickname ?? null).catch(() => {});
}

/* ─────────────────────────── UI builders ───────────────────────── */

function buildAfkPanel({
    title,
    accent       = ACCENT,
    reason,
    dmNotifications,
    sessionCount,
    totalTime,
    timestamp,
    showActions  = true,
    footnote } = {}) {
    const container = new ContainerBuilder().setAccentColor(accent);

    const lines = [];
    lines.push(`# 💤 ${title}`);
    if (reason) lines.push(`-# ${reason}`);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    const details = [];
    if (timestamp)               details.push(`<:Timer:1521227971590095070> **Since** <t:${Math.floor(timestamp / 1000)}:R>`);
    if (typeof sessionCount === 'number') details.push(`<:Bookopen:1521227911137595605> **AFK sessions** \`${sessionCount}\``);
    if (typeof totalTime === 'number' && totalTime > 0) {
        details.push(`<:Lightning:1521227915537285150> **Total time AFK** \`${formatDuration(totalTime)}\``);
    }
    if (typeof dmNotifications === 'boolean') {
        const tag = dmNotifications
            ? '<:Toggleon:1521227758011809964> **DM notifications** `Enabled`'
            : '<:Toggleoff:1521227763816595559> **DM notifications** `Disabled`';
        details.push(tag);
    }
    if (details.length) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(details.join('\n')));
    }

    if (footnote) {
        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
        );
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footnote}`));
    }

    if (showActions) {
        const dmStyle = dmNotifications ? ButtonStyle.Success : ButtonStyle.Secondary;
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('afk_end')
                .setLabel('End AFK')
                .setEmoji('<:Checkedbox:1521227734943269077>')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('afk_toggle_dm')
                .setLabel(dmNotifications ? 'Disable DMs' : 'Enable DMs')
                .setEmoji(dmNotifications
                    ? '<:Toggleon:1521227758011809964>'
                    : '<:Toggleoff:1521227763816595559>')
                .setStyle(dmStyle),
            new ButtonBuilder()
                .setCustomId('afk_stats')
                .setLabel('Stats')
                .setEmoji('<:Invoice:1521227903956811836>')
                .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId('afk_help')
                .setLabel('Help')
                .setEmoji('<:Lightbulbalt:1521227880703463675>')
                .setStyle(ButtonStyle.Secondary),
        );
        container.addActionRowComponents(row);
    }

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    return container;
}

function buildSimplePanel({ title, body, accent = ACCENT, ephemeralFootnote }) {
    const container = new ContainerBuilder().setAccentColor(accent);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${title}\n\n${body}`));
    if (ephemeralFootnote) {
        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${ephemeralFootnote}`));
    }
    return container;
}

/* ─────────────────────────── core actions ──────────────────────── */

/**
 * Set or refresh AFK status for `userId` in `guild`. Returns the
 * panel container ready to be replied with.
 */
async function startAfk({ userId, guild, member, reason, dmNotifications, prefixHint }) {
    const afkConfig = loadAfkConfig();
    const afkStats  = loadAfkStats();

    if (!afkStats[userId]) afkStats[userId] = { count: 0, totalTime: 0 };
    afkStats[userId].count += 1;
    saveAfkStats(afkStats);

    const timestamp = Date.now();
    afkConfig[userId] = {
        message:           reason,
        timestamp,
        guildId:           guild.id,
        mentions:          [],
        previousNickname:  member?.nickname ?? null,
        dmNotifications:   !!dmNotifications };
    saveAfkConfig(afkConfig);

    await applyAfkNickname(member);

    return buildAfkPanel({
        title:           'AFK Status Set',
        reason,
        dmNotifications,
        sessionCount:    afkStats[userId].count,
        totalTime:       afkStats[userId].totalTime,
        timestamp,
        showActions:     true,
        footnote:        `Send any message to clear your AFK automatically${prefixHint ? `, or use \`${prefixHint}\`/\`/afk\` again to update it` : ''}.` });
}

/**
 * End the current AFK session for `userId`. Returns:
 *   { ok: true, container }        — entry was removed
 *   { ok: false, reason }          — user wasn't AFK
 */
async function endAfk({ userId, member }) {
    const afkConfig = loadAfkConfig();
    const entry = afkConfig[userId];
    if (!entry) return { ok: false, reason: 'You are not currently AFK.' };

    const duration = Math.max(0, Date.now() - (entry.timestamp || Date.now()));
    const stats = loadAfkStats();
    if (!stats[userId]) stats[userId] = { count: 0, totalTime: 0 };
    stats[userId].totalTime += duration;
    // count is NOT incremented here — it was already counted on entry.
    saveAfkStats(stats);

    delete afkConfig[userId];
    saveAfkConfig(afkConfig);

    await restoreNickname(member, entry.previousNickname);

    const mentionCount = Array.isArray(entry.mentions) ? new Set(entry.mentions).size : 0;
    const mentionLine = mentionCount > 0
        ? `\n<:Hashtag:1521227771957870604> **You were mentioned by** ${pluralize(mentionCount, 'person')} while away.`
        : '';

    const container = new ContainerBuilder()
        .setAccentColor(ACCENT_OK)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Checkedbox:1521227734943269077> Welcome Back\n\n` +
            `Your AFK status has been cleared.\n\n` +
            `<:Timer:1521227971590095070> **You were AFK for** \`${formatDuration(duration)}\`\n` +
            `<:Lightning:1521227915537285150> **Total time AFK** \`${formatDuration(stats[userId].totalTime)}\`\n` +
            `<:Bookopen:1521227911137595605> **AFK sessions** \`${stats[userId].count}\`` +
            mentionLine
        ))
;

    return { ok: true, container };
}

/* ─────────────────────────── button handler ────────────────────── */

async function handleButton(interaction) {
    const id = interaction.customId;
    if (!id?.startsWith('afk_')) return false;

    const userId = interaction.user.id;
    const member = interaction.member;

    // Only the user who set the AFK status can use these buttons.
    // Without this check, anyone in the channel could end someone
    // else's AFK or flip their DM preference. The afk store is the
    // source of truth — fall back to "you have no AFK" messaging
    // when the entry has already been cleared.
    if (id === 'afk_end' || id === 'afk_toggle_dm') {
        const config = loadAfkConfig();
        const entry = config[userId];
        if (!entry) {
            return interaction.reply({
                components: [buildSimplePanel({
                    title:  '<:Cancel:1521227723916181644> Not AFK',
                    body:   id === 'afk_end'
                        ? 'You are not currently AFK, or this panel belongs to someone else.'
                        : 'You are not currently AFK. Set yourself AFK first to change DM preferences.',
                    accent: ACCENT_OFF })],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
        }
    }

    /* ── End AFK ──────────────────────────────────────────────── */
    if (id === 'afk_end') {
        const result = await endAfk({ userId, member });
        if (!result.ok) return false; // top-of-handler guard already replied
        // Replace the original panel in-place so the channel doesn't
        // accumulate multiple "I'm AFK" messages and acts as a clean
        // close-out for the session.
        return interaction.update({
            components: [result.container],
            flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }

    /* ── Toggle DM notifications ──────────────────────────────── */
    if (id === 'afk_toggle_dm') {
        const config = loadAfkConfig();
        const entry = config[userId];
        // Top-of-handler guard already handled the missing-entry case,
        // but the entry could have been removed between checks.
        if (!entry) return false;
        entry.dmNotifications = !entry.dmNotifications;
        saveAfkConfig(config);

        const stats = loadAfkStats()[userId] || { count: 0, totalTime: 0 };
        const panel = buildAfkPanel({
            title:           'AFK Status Updated',
            reason:          entry.message,
            dmNotifications: entry.dmNotifications,
            sessionCount:    stats.count,
            totalTime:       stats.totalTime,
            timestamp:       entry.timestamp,
            showActions:     true,
            footnote:        `DM notifications are now **${entry.dmNotifications ? 'enabled' : 'disabled'}**.` });
        return interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }

    /* ── Stats ────────────────────────────────────────────────── */
    if (id === 'afk_stats') {
        const stats = loadAfkStats()[userId] || { count: 0, totalTime: 0 };
        const config = loadAfkConfig()[userId] || null;
        const lines = [
            `<:Bookopen:1521227911137595605> **Total sessions** \`${stats.count}\``,
            `<:Lightning:1521227915537285150> **Total time AFK** \`${formatDuration(stats.totalTime)}\``,
        ];
        if (config) {
            lines.push(`<:Timer:1521227971590095070> **Currently AFK since** <t:${Math.floor(config.timestamp / 1000)}:R>`);
        } else {
            lines.push(`<:Cancel:1521227723916181644> **Currently AFK** \`No\``);
        }
        const container = new ContainerBuilder()
            .setAccentColor(ACCENT)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Invoice:1521227903956811836> Your AFK Stats\n\n${lines.join('\n')}`))
;
        return interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
    }

    /* ── Help ─────────────────────────────────────────────────── */
    if (id === 'afk_help') {
        const help = new ContainerBuilder()
            .setAccentColor(ACCENT)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Lightbulbalt:1521227880703463675> AFK · Help\n\n` +
                `**Set AFK** \`/afk <reason>\` or \`-afk <reason>\`\n` +
                `**End AFK** Send any message in the server, or press the **End AFK** button.\n` +
                `**DM Notifications** When enabled, you receive a DM each time someone mentions you while you're AFK. Toggle with the button above.\n\n` +
                `### <:Document:1521227875016114266> Tips\n` +
                `> The bot adds **[AFK]** to your nickname (when permitted) and restores it on return.\n` +
                `> Mentions are deduplicated, so spammers only count once.\n` +
                `> Use \`/afklist\` to see everyone currently AFK in the server.`
            ))
;
        return interaction.reply({
            components: [help],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
    }

    return false;
}

/* ─────────────────────────── exports ───────────────────────────── */

module.exports = {
    name:        'afk',
    prefix:      'afk',
    description: 'Set your AFK status with an optional reason',
    usage:       'afk [reason] [--dm]',
    category:    'utility',
    aliases:     ['brb', 'away'],

    data: new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Set your AFK status with an optional message')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The reason for being AFK (max 200 chars)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('dm-notifications')
                .setDescription('Receive a DM when someone mentions you while AFK')
                .setRequired(false)),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply(require('../../utils/utilityUI').errReply('Not In A Server', 'AFK can only be used in a server.', { ephemeral: true }));
        }

        const reason = (interaction.options.getString('message') || 'AFK').trim().slice(0, MAX_REASON) || 'AFK';
        const dmNotifications = interaction.options.getBoolean('dm-notifications') ?? false;

        const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id).catch(() => null);

        const panel = await startAfk({
            userId:           interaction.user.id,
            guild:            interaction.guild,
            member,
            reason,
            dmNotifications });

        await interaction.reply({
            components: [panel],
            flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    },

    async executePrefix(message, args) {
        if (!message.guild) {
            return message.reply(require('../../utils/utilityUI').errReply('Not In A Server', 'AFK can only be used in a server.')).catch(() => {});
        }

        const { reason, dmNotifications } = parsePrefixArgs(args || []);

        const panel = await startAfk({
            userId:           message.author.id,
            guild:            message.guild,
            member:           message.member,
            reason,
            dmNotifications });

        await message.reply({
            components: [panel],
            flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    },

    handleButton,

    // Internal helpers exposed for the messageCreate handler in index.js
    // (already calls jsonStore directly; these are kept for future use).
    _internal: { startAfk, endAfk, formatDuration } };
