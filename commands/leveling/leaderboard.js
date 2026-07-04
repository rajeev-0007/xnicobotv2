'use strict';

/**
 * /leaderboard — Unified server/global rankings as a Components V2 panel.
 *
 * Professional rebuild of the leaderboard panel. Renders a polished
 * Components V2 container with:
 *   • Branded header with scope/type chips + live counters
 *   • A dedicated top-3 podium (gold / silver / bronze) with avatar thumbs,
 *     visual percent bar, and "you" highlight
 *   • Ranked list 4–10 in a clean, monospaced layout
 *   • Stat-type select menu (leveling / messages / voice / invites / economy)
 *   • Server ↔ Global toggle + paginated controls + refresh
 *   • Requester standing card with gap-to-rank-above
 *
 * No canvas, no PNG generation — just rich text and Components V2 builders
 * so the panel renders instantly and stays well under Discord's 40-component
 * cap on every page.
 */

const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    AttachmentBuilder,
    MessageFlags,
} = require('discord.js');

const { getLeaderboard, getGlobalLeaderboard } = require('../../utils/database');
const jsonStore = require('../../utils/jsonStore');
const economyManager = require('../../utils/economyManager');
const { formatCoins, coinIcon } = require('../../utils/currencyHelper');
const { generateLeaderboardCard } = require('../../utils/leaderboardCard');
const { generateStatsCard } = require('../../utils/statsCard');

/* ─────────────────────────── Constants ─────────────────────────── */

const PER_PAGE = 10;
const PREFIX = 'ulb';

// Scope policy: only the economy board aggregates across servers. Every
// other stat — XP, messages, daily messages, voice, invites, interactions
// and the personal My Stats view — is server-scoped. This keeps cross-server
// ranking meaningful only where it makes sense (a shared economy).
const GLOBAL_TYPES = new Set(['economy']);
const supportsGlobal = (type) => GLOBAL_TYPES.has(type);

// Custom emoji palette — single source of truth.  Keep this list aligned
// with the project's theme.js so the leaderboard stays visually
// consistent with the rest of the bot's panels.
const E = {
    // Stat type icons
    leveling:  '<:Award:1521228119640375336>',
    messages:  '<:Hashtag:1521227771957870604>',
    voice:     '<:Volumeup:1521228004502536272>',
    invites:   '<:Bullhorn:1521227936575914016>',
    economy:   '<:Money:1521228266957045900>',

    // Scope / branding
    server:    '<:Folderopen:1521227986966417642>',
    globe:     '<:Document:1521227875016114266>',
    bots:      '<:bots:1521227848101396610>',
    brand:     '<:xnico:1521228240440660180>',

    // Podium / status
    crown:     '<:Crown:1521227739988889764>',
    trophy:    '<:Award:1521228119640375336>',
    fire:      '<:Fire:1521227907647668374>',
    spark:     '<:Lightning:1521227915537285150>',
    diamond:   '<:Sketch:1521228025365004471>',
    star:      '<:Star:1521227981685526568>',
    medal1:    '🥇',
    medal2:    '🥈',
    medal3:    '🥉',

    // UI / controls
    pin:       '<:Pin:1521227932625014916>',
    you:       '<:User:1521227714227343380>',
    history:   '<:History:1521227863079256278>',
    skipNext:  '<:Caretright:1521227704953864202>',
    refresh:   '<:Refresh:1521227946441052420>',
    cancel:    '<:Cancel:1521227723916181644>',
    info:      '<:Inforect:1521228008285929532>',
    arrow:     '<:Caretright:1521227704953864202>',
};

// Each leaderboard "type" knows how to source its data, label itself,
// and format its values. Keeping the configs colocated lets us jump
// between them via a single select menu and keeps the dispatch logic
// dead simple (one switch on a string key).
const LB_TYPES = {
    leveling: {
        label: 'Leveling',
        emoji: E.leveling,
        accent: 0xFBBF24,
        menuDesc: 'XP and level rankings',
        format: (v) => `Lv ${Math.floor(0.1 * Math.sqrt(v || 0))}  ·  ${formatNumber(v)} XP`,
        unit: 'XP',
        unitLabel: 'XP earned',
        field: 'leveling.xp',
        globalField: 'xp',
    },
    messages: {
        label: 'Messages',
        emoji: E.messages,
        accent: 0x5865F2,
        menuDesc: 'Most active chatters',
        format: (v) => `${formatNumber(v)} messages`,
        unit: 'msgs',
        unitLabel: 'messages sent',
        field: 'analytics.totalMessages',
        globalField: 'totalMessages',
    },
    dailymessages: {
        label: 'Daily Messages',
        emoji: E.messages,
        accent: 0x60A5FA,
        menuDesc: 'Most messages sent today',
        format: (v) => `${formatNumber(v)} today`,
        unit: 'msgs',
        unitLabel: 'messages today',
        field: null,        // sourced from the leveling store's daily counter
        globalField: null,
    },
    voice: {
        label: 'Voice Time',
        emoji: E.voice,
        accent: 0xA78BFA,
        menuDesc: 'Longest voice sessions',
        format: (v) => formatVoiceTime(v),
        unit: 'time',
        unitLabel: 'voice time logged',
        field: 'analytics.voiceTime',
        globalField: 'voiceTime',
    },
    invites: {
        label: 'Invites',
        emoji: E.invites,
        accent: 0x34D399,
        menuDesc: 'Top server inviters',
        format: (v) => `${formatNumber(v)} invites`,
        unit: 'invites',
        unitLabel: 'invites tracked',
        field: 'invites.invites',
        globalField: 'invites',
    },
    interaction: {
        label: 'Interactions',
        emoji: E.spark,
        accent: 0x38BDF8,
        menuDesc: 'Most commands & bot interactions',
        format: (v) => `${formatNumber(v)} interactions`,
        unit: 'interactions',
        unitLabel: 'commands & interactions',
        field: 'leveling.commandsUsed',
        globalField: 'commandsUsed',
    },
    economy: {
        label: 'Economy',
        emoji: E.economy,
        accent: 0xF1C40F,
        menuDesc: 'Richest users by net worth',
        format: (v, guildId) => `${coinIcon(guildId)} ${formatCoins(v, guildId)}`,
        unit: 'coins',
        unitLabel: 'net worth',
        field: null,         // economy uses its own loader
        globalField: null,
    },
};

/* ─────────────────────────── Formatters ─────────────────────────── */

function formatNumber(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString();
}

function formatVoiceTime(seconds) {
    seconds = Math.max(0, Number(seconds) || 0);
    if (seconds < 60) return `${Math.floor(seconds)}s`;
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

/**
 * Render a 10-segment progress bar.  Used to visually show how a
 * podium entry compares to the leader's value.
 */
function progressBar(pct, length = 10) {
    const safe = Math.max(0, Math.min(1, Number(pct) || 0));
    const filled = Math.round(safe * length);
    return '▰'.repeat(filled) + '▱'.repeat(length - filled);
}

function rankBadge(rank) {
    if (rank === 1) return E.medal1;
    if (rank === 2) return E.medal2;
    if (rank === 3) return E.medal3;
    return `\`#${String(rank).padStart(2, '0')}\``;
}

function escapeMarkdown(text) {
    return String(text || '').replace(/[*_~`|>\\]/g, (m) => `\\${m}`);
}

/* ─────────────────────────── Data loaders ─────────────────────────── */

/**
 * Leveling XP lives in the dedicated `leveling` jsonStore
 * ({ [guildId]: { [userId]: { xp, level, messages } } }) — that's where
 * the message handler awards XP. The shared getLeaderboard() helper reads
 * `guild_members.leveling.xp`, which the XP handler never writes, so the
 * leveling board came back empty. Source it from the real store instead.
 */
function getLevelingEntries(guild, scope) {
    const store = jsonStore.read('leveling') || {};

    if (scope === 'global') {
        const agg = new Map();
        for (const users of Object.values(store)) {
            if (!users || typeof users !== 'object') continue;
            for (const [userId, d] of Object.entries(users)) {
                const xp = Number(d?.xp || 0);
                if (xp > 0) agg.set(userId, (agg.get(userId) || 0) + xp);
            }
        }
        return [...agg.entries()]
            .map(([userId, value]) => ({ userId, value }))
            .filter((e) => e.value > 0)
            .sort((a, b) => b.value - a.value);
    }

    const guildData = (guild && store[guild.id]) || {};
    return Object.entries(guildData)
        .map(([userId, d]) => ({ userId, value: Number(d?.xp || 0) }))
        .filter((e) => e.value > 0)
        .sort((a, b) => b.value - a.value);
}

/**
 * Invite counts live in the `invites` store
 * ({ [guildId]: { totals: { [userId]: { regular, bonus, ... } } } }).
 * Effective invites = regular + bonus (same as the dashboard). The shared
 * getLeaderboard() helper can't read this (invites.invites isn't a allowed
 * leaderboard field and guild_members isn't the source of truth), so source
 * it directly here.
 */
function getInvitesEntries(guild, scope) {
    const store = jsonStore.read('invites') || {};
    const fromGuild = (gid) => {
        const totals = store[gid]?.totals || {};
        return Object.entries(totals).map(([userId, t]) => ({
            userId,
            value: Math.max(0, Number(t?.regular || 0) + Number(t?.bonus || 0)),
        }));
    };

    let entries;
    if (scope === 'global') {
        const agg = new Map();
        for (const gid of Object.keys(store)) {
            for (const e of fromGuild(gid)) agg.set(e.userId, (agg.get(e.userId) || 0) + e.value);
        }
        entries = [...agg.entries()].map(([userId, value]) => ({ userId, value }));
    } else {
        entries = guild ? fromGuild(guild.id) : [];
    }
    return entries.filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
}

/**
 * Messages sent today, from the `leveling` store's per-user daily counter
 * ({ daily: { date: 'YYYY-MM-DD', count } }). Only counts entries whose
 * daily.date is today (the counter resets on date rollover).
 */
function getDailyMessagesEntries(guild, scope) {
    const store = jsonStore.read('leveling') || {};
    const today = new Date().toISOString().slice(0, 10);
    const fromGuild = (users) => Object.entries(users || {}).map(([userId, d]) => ({
        userId,
        value: d?.daily?.date === today ? Number(d.daily.count || 0) : 0,
    }));

    let rows;
    if (scope === 'global') {
        const agg = new Map();
        for (const users of Object.values(store)) {
            if (!users || typeof users !== 'object') continue;
            for (const e of fromGuild(users)) agg.set(e.userId, (agg.get(e.userId) || 0) + e.value);
        }
        rows = [...agg.entries()].map(([userId, value]) => ({ userId, value }));
    } else {
        rows = guild ? fromGuild(store[guild.id]) : [];
    }
    return rows.filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
}

/**
 * Interaction counts (slash/prefix commands + button/menu uses) live in
 * the `guild_members` store under stats.botInteractions / stats.commandsUsed
 * / leveling.commandsUsed. Read it directly so server + global both work.
 */
function getInteractionEntries(guild, scope) {
    const members = jsonStore.read('guild_members') || [];
    const arr = Array.isArray(members) ? members : Object.values(members || {});
    const valueOf = (m) => {
        const s = m.stats || {};
        const lv = m.leveling || {};
        return Math.max(
            Number(s.botInteractions || 0),
            Number(s.commandsUsed || 0),
            Number(lv.commandsUsed || 0)
        );
    };

    let rows;
    if (scope === 'global') {
        const agg = new Map();
        for (const m of arr) {
            const uid = m.user_id || m.userId;
            if (!uid) continue;
            agg.set(uid, (agg.get(uid) || 0) + valueOf(m));
        }
        rows = [...agg.entries()].map(([userId, value]) => ({ userId, value }));
    } else {
        const gid = guild?.id;
        rows = arr
            .filter((m) => (m.guild_id || m.guildId) === gid)
            .map((m) => ({ userId: m.user_id || m.userId, value: valueOf(m) }));
    }
    return rows.filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
}

function getEconomyEntries(guild, scope) {
    const economy = economyManager.loadEconomy();
    let entries = Object.entries(economy)
        .map(([userId, raw]) => {
            const coins = Number(raw.coins) || 0;
            const bank = Number(raw.bank) || 0;
            return { userId, value: coins + bank };
        })
        .filter((e) => e.value > 0);

    if (scope === 'server' && guild) {
        const memberIds = new Set(guild.members.cache.keys());
        entries = entries.filter((e) => memberIds.has(e.userId));
    }
    entries.sort((a, b) => b.value - a.value);
    return entries;
}

async function loadAllEntries(guild, type, scope) {
    const cfg = LB_TYPES[type];
    if (!cfg) return [];

    if (type === 'leveling') return getLevelingEntries(guild, scope);
    if (type === 'invites') return getInvitesEntries(guild, scope);
    if (type === 'dailymessages') return getDailyMessagesEntries(guild, scope);
    if (type === 'interaction') return getInteractionEntries(guild, scope);
    if (type === 'economy') return getEconomyEntries(guild, scope);

    if (scope === 'global') {
        const rows = getGlobalLeaderboard(cfg.globalField, 99999) || [];
        return rows.filter((e) => Number(e.value) > 0);
    }

    const rows = (await getLeaderboard(guild.id, cfg.field, 99999)) || [];
    const [table, subField] = cfg.field.split('.');
    return rows
        .map((entry) => ({ userId: entry.userId, value: Number(entry[table]?.[subField] || 0) }))
        .filter((e) => e.value > 0);
}

async function resolveUsers(client, entries) {
    return Promise.all(
        entries.map(async (entry) => {
            let username = 'Unknown User';
            let avatarURL = null;
            try {
                const user = await client.users.fetch(entry.userId);
                username = user.globalName || user.username;
                avatarURL = user.displayAvatarURL({ size: 128, extension: 'png' });
            } catch {}
            return { ...entry, username, avatarURL };
        })
    );
}

/* ─────────────────────────── Panel renderer ─────────────────────────── */

function buildPanel({
    client, guild, type, scope, page, totalPages, totalCount,
    pageEntries, requesterEntry, requesterRank, gapText, leaderValue,
}) {
    const cfg = LB_TYPES[type];
    const accent = cfg.accent;
    const guildId = guild?.id;

    const container = new ContainerBuilder().setAccentColor(accent);

    /* ────────────────────────── Header ────────────────────────── */
    const scopeLabel = scope === 'global' ? 'Global Network' : (guild?.name || 'This Server');
    const scopeIcon  = scope === 'global' ? E.globe : E.server;
    const iconUrl = scope === 'server'
        ? guild?.iconURL({ size: 256 })
        : client?.user?.displayAvatarURL?.({ size: 256 });

    // Build the main header. We keep it compact and information-dense:
    // title row, then a "chips" sub-line with three pieces of info.
    const headerLines = [
        `# ${cfg.emoji}  ${cfg.label} Leaderboard`,
        `### ${scopeIcon} ${escapeMarkdown(scopeLabel)}`,
        `-# ${totalCount.toLocaleString()} ranked  ·  Page ${page + 1}/${totalPages}`,
    ];
    const headerText = headerLines.join('\n');

    // SectionBuilder requires a thumbnail/button accessory — without an
    // icon URL we fall back to a plain TextDisplay so the panel still
    // renders for guilds with no icon and for global scope when the bot
    // avatar lookup fails.  Otherwise discord.js throws.
    if (iconUrl) {
        try {
            const headerSection = new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
                .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: iconUrl } }));
            container.addSectionComponents(headerSection);
        } catch {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
        }
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
    }
    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );

    /* ─────────────────────── Empty state ──────────────────────── */
    if (pageEntries.length === 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### ${E.info} No ranked users yet\n` +
            `> Earn ${cfg.unit} by chatting, joining voice, inviting friends, or playing the economy — your name will show up here once you're on the board.`
        ));
        container.addSeparatorComponents(
            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
        );
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# ${E.brand} xNico Leaderboard  ·  Live rankings`
        ));
        return container;
    }

    /* ─────────────────────── Top 3 podium ─────────────────────── */
    const podium = pageEntries.filter((e) => e.rank <= 3);
    const rest   = pageEntries.filter((e) => e.rank >= 4);

    if (podium.length > 0 && page === 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### ${E.crown} Top 3`
        ));

        for (const entry of podium) {
            const isYou = entry.userId === requesterEntry?.userId;
            const accentEmoji =
                entry.rank === 1 ? E.medal1 :
                entry.rank === 2 ? E.medal2 : E.medal3;
            const valueStr = cfg.format(entry.value, guildId);

            const youBadge = isYou ? `  ${E.you} *you*` : '';
            const lines = [
                `**${accentEmoji}  ${escapeMarkdown(entry.username)}**${youBadge}`,
                `> ${valueStr}`,
            ];

            if (entry.avatarURL) {
                try {
                    const sec = new SectionBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')))
                        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: entry.avatarURL } }));
                    container.addSectionComponents(sec);
                    continue;
                } catch {
                    /* fall through to text-only */
                }
            }
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
        }
    } else if (podium.length > 0) {
        // On pages > 0 we still might catch ranks 1-3 if PER_PAGE changes,
        // but in normal operation these are simple list entries.
        const lines = podium.map((entry) => {
            const isYou = entry.userId === requesterEntry?.userId;
            const valueStr = cfg.format(entry.value, guildId);
            const youTag = isYou ? `  ${E.you} *you*` : '';
            return `${rankBadge(entry.rank)}  **${escapeMarkdown(entry.username)}** — ${valueStr}${youTag}`;
        });
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    }

    /* ──────────────────── Ranks 4-10 (compact) ─────────────────── */
    if (rest.length > 0) {
        if (podium.length > 0) {
            container.addSeparatorComponents(
                new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
            );
        }
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### ${E.star} Rankings`
        ));

        const lines = rest.map((entry) => {
            const isYou = entry.userId === requesterEntry?.userId;
            const valueStr = cfg.format(entry.value, guildId);
            const youTag = isYou ? `  ${E.you} *you*` : '';
            return `${rankBadge(entry.rank)}  **${escapeMarkdown(entry.username)}**  —  ${valueStr}${youTag}`;
        });
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    }

    /* ───────────────────── Requester standing ──────────────────── */
    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    if (requesterRank) {
        const onPage = pageEntries.some((e) => e.userId === requesterEntry?.userId);
        const valueStr = cfg.format(requesterEntry.value, guildId);
        if (!onPage) {
            const standing = [
                `### ${E.pin}  Your Standing`,
                `> ${E.you} Rank \`#${requesterRank}\` of \`${totalCount.toLocaleString()}\``,
                `> ${E.spark} ${valueStr}`,
                gapText ? `> ${E.fire} ${gapText}` : null,
            ].filter(Boolean).join('\n');
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(standing));
        } else {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `-# ${E.pin} You're on this page  ·  Rank \`#${requesterRank}\`  ·  ${valueStr}`
            ));
        }
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### ${E.pin}  Not Ranked Yet\n` +
            `> Earn some ${cfg.unit} (${cfg.unitLabel}) to claim a spot on the board.`
        ));
    }

    /* ───────────────────────── Footer ─────────────────────────── */
    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# ${E.brand} xNico  ·  Live rankings`
    ));

    return container;
}

function buildControls(type, scope, page, totalPages) {
    const otherScope = scope === 'server' ? 'global' : 'server';

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`${PREFIX}_type_${scope}_${page}`)
        .setPlaceholder(`📊  Switch leaderboard category`)
        .setMinValues(1)
        .setMaxValues(1);

    for (const [key, meta] of Object.entries(LB_TYPES)) {
        selectMenu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(meta.label)
                .setValue(key)
                .setEmoji(meta.emoji)
                .setDescription(meta.menuDesc)
                .setDefault(key === type)
        );
    }

    // A separate, personal view: instead of the ranking board this renders
    // the requesting user's own stats card (XP/level, messages, voice,
    // invites, commands) for the current scope.
    selectMenu.addOptions(
        new StringSelectMenuOptionBuilder()
            .setLabel('My Stats')
            .setValue('mystats')
            .setEmoji(E.you)
            .setDescription('Your personal stats card')
            .setDefault(type === 'mystats')
    );

    // The Server/Global toggle only appears for boards that actually support
    // global scope (economy). For server-only boards we omit it entirely so
    // the controls stay clean and the scope is unambiguous.
    const buttons = [];
    if (supportsGlobal(type)) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`${PREFIX}_scope_${otherScope}_${type}_0`)
                .setLabel(scope === 'server' ? 'Global' : 'Server')
                .setEmoji(scope === 'server' ? E.globe : E.server)
                .setStyle(ButtonStyle.Primary)
        );
    }
    buttons.push(
        new ButtonBuilder()
            .setCustomId(`${PREFIX}_page_${scope}_${type}_${page - 1}`)
            .setEmoji(E.history)
            .setLabel('Prev')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`${PREFIX}_info`)
            .setLabel(`${page + 1} / ${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`${PREFIX}_page_${scope}_${type}_${page + 1}`)
            .setEmoji(E.skipNext)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1),
        new ButtonBuilder()
            .setCustomId(`${PREFIX}_page_${scope}_${type}_${page}`)
            .setEmoji(E.refresh)
            .setLabel('Refresh')
            .setStyle(ButtonStyle.Success)
    );

    const ctrlRow = new ActionRowBuilder().addComponents(...buttons);

    return [
        new ActionRowBuilder().addComponents(selectMenu),
        ctrlRow,
    ];
}

/* ─────────────────────────── Top-level builder ─────────────────────────── */

// Map a resolved leaderboard entry to the canvas card's row contract
// ({ rank, name, avatar, isRequester, primaryValue|valueText, primaryLabel,
// statLine }) with per-category labels so every board reads correctly.
function buildCardEntry(type, e, requesterId) {
    const base = {
        rank: e.rank,
        name: e.username,
        avatar: e.avatarURL,
        isRequester: e.userId === requesterId,
        primaryValue: Number(e.value) || 0,
    };
    switch (type) {
        case 'leveling':
            return { ...base, primaryLabel: 'XP', statLine: `Level ${Math.floor(0.1 * Math.sqrt(e.value || 0))}` };
        case 'messages':
            return { ...base, primaryLabel: 'messages', statLine: 'Total messages' };
        case 'dailymessages':
            return { ...base, primaryLabel: 'today', statLine: 'Messages today' };
        case 'voice':
            // Voice is seconds — pass a human-readable string so the card
            // doesn't render raw seconds via its numeric formatter.
            return { ...base, valueText: formatVoiceTime(e.value), primaryLabel: '', statLine: 'Voice time' };
        case 'invites':
            return { ...base, primaryLabel: 'invites', statLine: 'Invites' };
        case 'interaction':
            return { ...base, primaryLabel: 'uses', statLine: 'Interactions' };
        case 'economy':
            return { ...base, primaryLabel: 'coins', statLine: 'Net worth' };
        default:
            return { ...base, primaryLabel: '', statLine: '' };
    }
}

/**
 * Builds a personal stats card for the requesting user across every
 * tracked metric (XP/level, messages, voice, invites, commands) plus
 * their XP rank, for the current scope. Wired to the "My Stats" entry
 * in the leaderboard category dropdown.
 */
async function buildMyStatsReply(client, guild, scope, requesterId) {
    // My Stats aggregates non-economy metrics, so it's always server-scoped.
    const validScope = 'server';

    // Pull the requester's value (and XP rank) from each metric's board.
    const metrics = ['leveling', 'messages', 'voice', 'invites', 'interaction'];
    const lists = {};
    await Promise.all(metrics.map(async (m) => {
        try { lists[m] = await loadAllEntries(guild, m, validScope); }
        catch { lists[m] = []; }
    }));

    const valueOf = (m) => {
        const e = (lists[m] || []).find((x) => x.userId === requesterId);
        return e ? Number(e.value) || 0 : 0;
    };
    const rankOf = (m) => {
        const idx = (lists[m] || []).findIndex((x) => x.userId === requesterId);
        return idx >= 0 ? idx + 1 : null;
    };

    const xp = valueOf('leveling');
    const level = Math.floor(0.1 * Math.sqrt(xp || 0));

    // Resolve identity for the card header.
    let username = 'You';
    let avatarURL = null;
    try {
        const user = await client.users.fetch(requesterId);
        username = user.globalName || user.username;
        avatarURL = user.displayAvatarURL({ size: 128, extension: 'png' });
    } catch {}

    const buffer = await generateStatsCard({
        username,
        avatarURL,
        totalMessages: valueOf('messages'),
        voiceTime: valueOf('voice'),
        xp,
        level,
        invites: valueOf('invites'),
        commandsUsed: valueOf('interaction'),
        rank: rankOf('leveling') || 'N/A',
        scope: validScope,
        scopeLabel: validScope === 'global' ? 'Global Stats' : (guild?.name || 'Server Stats'),
    });

    return {
        content: '',
        files: [new AttachmentBuilder(buffer, { name: 'my-stats.png' })],
        components: buildControls('mystats', validScope, 0, 1),
    };
}

async function buildLeaderboardReply(client, guild, type, scope, page, requesterId) {
    // "My Stats" is a personal view, not a ranking board — render the
    // requesting user's own stats card instead of the leaderboard.
    if (type === 'mystats') {
        return buildMyStatsReply(client, guild, scope, requesterId);
    }

    const validType = LB_TYPES[type] ? type : 'leveling';
    // Only economy supports global; everything else is clamped to server
    // scope regardless of what the caller (button / slash option) requested.
    const validScope = (scope === 'global' && supportsGlobal(validType)) ? 'global' : 'server';
    const cfg = LB_TYPES[validType];

    const allEntries = await loadAllEntries(guild, validType, validScope);
    const totalCount = allEntries.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / PER_PAGE));
    const safePage = Math.max(0, Math.min(page, totalPages - 1));

    const slice = allEntries.slice(safePage * PER_PAGE, (safePage + 1) * PER_PAGE);
    const resolved = await resolveUsers(client, slice);
    const pageEntries = resolved.map((entry, i) => ({ ...entry, rank: safePage * PER_PAGE + i + 1 }));

    /* Requester position */
    const requesterIdx = requesterId
        ? allEntries.findIndex((e) => e.userId === requesterId)
        : -1;
    const requesterEntry = requesterIdx >= 0 ? allEntries[requesterIdx] : null;
    const requesterRank = requesterIdx >= 0 ? requesterIdx + 1 : null;

    let gapText = null;
    if (requesterEntry && requesterIdx > 0) {
        const above = allEntries[requesterIdx - 1];
        const gap = (above?.value || 0) - (requesterEntry.value || 0);
        if (gap > 0) {
            const formatted = validType === 'voice' ? formatVoiceTime(gap) : formatNumber(gap);
            gapText = `${formatted} behind rank #${requesterIdx}`;
        }
    }

    // Category select + scope/pagination controls travel as normal action
    // rows beneath the canvas image (no Components V2 needed for an image).
    const controlRows = buildControls(validType, validScope, safePage, totalPages);

    // Empty state — no canvas; show a prompt plus the category switcher so
    // the user can still flip to a populated board.
    if (pageEntries.length === 0) {
        return {
            content:
                `### ${cfg.emoji} ${cfg.label} Leaderboard\n` +
                `No ranked users yet — earn some ${cfg.unit} (${cfg.unitLabel}) to claim a spot.`,
            // Clear any image from a previously-rendered (populated) category
            // when switching to an empty one via the select menu / buttons.
            attachments: [],
            files: [],
            components: controlRows,
        };
    }

    const cardEntries = pageEntries.map((e) => buildCardEntry(validType, e, requesterId));

    const buffer = await generateLeaderboardCard(cardEntries, {
        accentInt:   cfg.accent,
        accentEmoji: cfg.emoji,
        titleLabel:  cfg.label,
        modeLabel:   validScope === 'global' ? 'Global' : 'Server',
        scopeLabel:  validScope === 'global' ? 'Global' : (guild?.name || 'Server'),
        scopeEmoji:  validScope === 'global' ? '🌍' : '🏠',
        totalCount,
        page: safePage,
        totalPages,
        requester: requesterEntry ? { rank: requesterRank, gapText } : null,
    });

    return {
        content: '',
        files: [new AttachmentBuilder(buffer, { name: 'leaderboard.png' })],
        components: controlRows,
    };
}

function buildErrorContainer(message) {
    return new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${E.cancel}  Leaderboard Failed\n\n` +
            `Couldn't generate the leaderboard right now.\n` +
            `> -# ${message || 'Unknown error'}`
        ));
}

/* ─────────────────────────── Command export ─────────────────────────── */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the unified leaderboard — leveling, messages, voice, invites, economy')
        .addStringOption(o =>
            o.setName('type')
                .setDescription('Leaderboard category')
                .setRequired(false)
                .addChoices(
                    { name: '🏆 Leveling',    value: 'leveling' },
                    { name: '💬 Messages',    value: 'messages' },
                    { name: '📅 Daily Messages', value: 'dailymessages' },
                    { name: '🔊 Voice Time',  value: 'voice'    },
                    { name: '📨 Invites',     value: 'invites'  },
                    { name: '⚡ Interactions', value: 'interaction' },
                    { name: '💰 Economy',     value: 'economy'  },
                    { name: '👤 My Stats',    value: 'mystats'  },
                )
        )
        .addStringOption(o =>
            o.setName('scope')
                .setDescription('Server or global rankings')
                .setRequired(false)
                .addChoices(
                    { name: '🏠 Server', value: 'server' },
                    { name: '🌍 Global', value: 'global' },
                )
        ),

    prefix: 'leaderboard',
    aliases: ['top', 'board', 'rankings', 'lb'],
    description: 'View the unified leaderboard with stat-type select and pagination',
    usage: 'leaderboard [leveling|messages|voice|invites|economy] [server|global]',
    category: 'leveling',

    async execute(interaction) {
        await interaction.deferReply();
        const type = interaction.options.getString('type') || 'leveling';
        const scope = interaction.options.getString('scope') || 'server';
        try {
            const reply = await buildLeaderboardReply(
                interaction.client, interaction.guild, type, scope, 0, interaction.user.id
            );
            await interaction.editReply(reply);
        } catch (err) {
            console.error('[leaderboard] slash error:', err);
            await interaction.editReply({
                components: [buildErrorContainer(err.message)],
                flags: MessageFlags.IsComponentsV2,
            });
        }
    },

    async executePrefix(message, args) {
        const validTypes = [...Object.keys(LB_TYPES), 'mystats'];
        const type = validTypes.includes(args[0]?.toLowerCase()) ? args[0].toLowerCase() : 'leveling';
        const scope = args[1]?.toLowerCase() === 'global' ? 'global' : 'server';
        try {
            const reply = await buildLeaderboardReply(
                message.client, message.guild, type, scope, 0, message.author.id
            );
            await message.reply(reply);
        } catch (err) {
            console.error('[leaderboard] prefix error:', err);
            await message.reply({
                components: [buildErrorContainer(err.message)],
                flags: MessageFlags.IsComponentsV2,
            });
        }
    },

    async handleButton(interaction) {
        // Refresh / page / scope all share the same shape: ulb_<action>_<scope>_<type>_<page>
        // The "info" button is disabled but Discord still emits an event,
        // so we no-op on it.
        if (interaction.customId === `${PREFIX}_info`) {
            await interaction.deferUpdate().catch(() => {});
            return true;
        }

        const match = interaction.customId.match(/^ulb_(?:scope|page)_(\w+)_(\w+)_(-?\d+)$/);
        if (!match) {
            await interaction.deferUpdate().catch(() => {});
            return true;
        }

        const [, scope, type, pageStr] = match;
        const page = Math.max(0, parseInt(pageStr, 10) || 0);

        try {
            await interaction.deferUpdate();
            const reply = await buildLeaderboardReply(
                interaction.client, interaction.guild, type, scope, page, interaction.user.id
            );
            await interaction.editReply(reply);
        } catch (err) {
            console.error('[leaderboard] button error:', err);
            try {
                await interaction.editReply({
                    content: '<:Cancel:1521227723916181644> Could not update the leaderboard. Please try again.',
                    attachments: [],
                    components: [],
                });
            } catch {}
        }
        return true;
    },

    async handleSelectMenu(interaction) {
        const match = interaction.customId.match(/^ulb_type_(\w+)_(\d+)$/);
        if (!match) return false;

        const [, scope] = match;
        const type = interaction.values[0];
        try {
            await interaction.deferUpdate();
            const reply = await buildLeaderboardReply(
                interaction.client, interaction.guild, type, scope, 0, interaction.user.id
            );
            await interaction.editReply(reply);
        } catch (err) {
            console.error('[leaderboard] select error:', err);
            try {
                await interaction.editReply({
                    content: '<:Cancel:1521227723916181644> Could not update the leaderboard. Please try again.',
                    attachments: [],
                    components: [],
                });
            } catch {}
        }
        return true;
    },

    // Re-exported so /statboard can share the implementation
    buildLeaderboardReply,
    loadAllEntries,
    LB_TYPES,
};
