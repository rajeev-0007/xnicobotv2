'use strict';

/**
 * economystats — Comprehensive economy stats card.
 *
 * Aggregates everything the economy stack tracks for a user — wallet,
 * bank, lifetime earned/won/lost/gambled, action counters, gambling
 * win rate, "luck" percentage, inventory items, ore stockpile, stocks,
 * achievements — and renders it as a single Components V2 dossier.
 *
 * "Luck" is computed as a smoothed win rate: wins / (wins + losses).
 * For users with too few gambling rounds we fall back to a coin-flip
 * baseline (50%) so a single big loss doesn't show 0% luck.
 *
 * Both prefix and slash share `renderStats(target, guildId, reply)`
 * so the panel always shows the exact same numbers regardless of
 * entry point. Defaults to the caller's own user when no target is
 * supplied.
 */

const {
    SlashCommandBuilder, MessageFlags, ContainerBuilder,
    TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize
} = require('discord.js');
const economyManager = require('../../utils/economyManager');
const jsonStore = require('../../utils/jsonStore');
const { coinIcon, formatCoins } = require('../../utils/currencyHelper');
const { ITEMS } = require('../../utils/shopItems');
const { resolveUser } = require('../../utils/resolveUser');

/* ═══════════════════════════════════════════════════════════════
   CUSTOM EMOJI SET — match the rest of the economy command set
   ═══════════════════════════════════════════════════════════════ */
const E = {
    title:    '<:Sketch:1521228025365004471>',
    chart:    '<:transfer:1521228019824590948>',
    money:    '<:Money:1521228266957045900>',
    bank:     '<:Invoice:1521227903956811836>',
    fire:     '<:Fire:1521227907647668374>',
    award:    '<:Award:1521228119640375336>',
    star:     '<:Star:1521227981685526568>',
    box:      '<:Box:1521228152414666833>',
    info:     '<:Inforect:1521228008285929532>',
    success:  '<:Checkedbox:1521227734943269077>',
    warn:     '<:Infotriangle:1521227710381428926>',
    cancel:   '<:Cancel:1521227723916181644>',
    folder:   '<:Folder:1521228095225331765>',
    history:  '<:History:1521227863079256278>',
    crown:    '<:Crown:1521227739988889764>',
    lightning:'<:Lightning:1521227915537285150>',
    caret:    '<:Caretright:1521227704953864202>',
    shield:   '<:Shield:1521227694677692467>',
    gamepad:  '<:Gamepad:1521228035213230090>',
};

/** Pretty-print large numbers with thousands separators. */
const fmt = (n) => Number(n || 0).toLocaleString();

/**
 * Read the global shop inventory store (used by the canonical
 * `/buy`, `/use`, `/gift`, `/sell` commands). Returns an array of
 * `{ id, boughtAt }` for the user — matching what those commands
 * write back. Falls back to `userData.inventory` (legacy object map
 * used by older code paths) so we never miss an item.
 */
function readGlobalInventory(userId) {
    try {
        if (!jsonStore.has('inventory')) return [];
        const data = jsonStore.read('inventory');
        return Array.isArray(data?.[userId]) ? data[userId] : [];
    } catch {
        return [];
    }
}

/** Count items by id from both global + legacy stores. */
function aggregateInventory(userId, userData) {
    const counts = {};
    for (const entry of readGlobalInventory(userId)) {
        if (!entry || !entry.id) continue;
        counts[entry.id] = (counts[entry.id] || 0) + 1;
    }
    // Legacy inventory map: `{ itemId: qty }` or `{ itemId: { qty } }`
    const legacy = userData?.inventory;
    if (legacy && !Array.isArray(legacy) && typeof legacy === 'object') {
        for (const [id, val] of Object.entries(legacy)) {
            const qty = typeof val === 'number' ? val : (val?.qty || 0);
            if (qty > 0) counts[id] = (counts[id] || 0) + qty;
        }
    }
    return counts;
}

/**
 * Compute an honest "luck" percentage from the user's gambling
 * history. We treat `totalWon` (profit on wins) and `totalLost` (bet
 * lost on losses) as the win/loss buckets — they're the values every
 * gambling command in this bot already maintains.
 *
 * For a fair coin flip that's ~50% over time. Anything significantly
 * higher means the user is running hot; significantly lower means
 * the house is winning. Below 100 coins of total activity we just
 * show "—" because the sample is too small to be meaningful.
 */
function computeLuck(userData) {
    const won  = Number(userData.totalWon  || 0);
    const lost = Number(userData.totalLost || 0);
    const total = won + lost;
    if (total < 100) {
        return { value: null, label: '—', subtitle: 'Not enough gambling history' };
    }
    // Win rate as a percentage of total bet *outcome* coins, not
    // rounds — money-weighted so losing 1 huge bet hits luck the
    // same as losing many small ones combined.
    const pct = (won / total) * 100;

    let subtitle;
    if      (pct >= 65) subtitle = 'Running hot — house is sweating';
    else if (pct >= 55) subtitle = 'Comfortable above the curve';
    else if (pct >= 45) subtitle = 'Right at coin-flip baseline';
    else if (pct >= 35) subtitle = 'A little cold — vary your bets';
    else                subtitle = 'Cold streak — house is winning';

    return { value: pct, label: `${pct.toFixed(1)}%`, subtitle };
}

/**
 * Battle win rate as a normal percentage (rounds-based, not money).
 * Returns null when the user has zero recorded battles so the UI
 * can show a placeholder instead of "0.0%".
 */
function computeBattleWinRate(userData) {
    const w = Number(userData.battlesWon  || 0);
    const l = Number(userData.battlesLost || 0);
    if (w + l === 0) return null;
    return (w / (w + l)) * 100;
}

/**
 * Net P&L from gambling activity — positive means the user is up
 * lifetime, negative means down. This is the single most useful
 * "am I winning?" number a gambler can see, and Discord economy
 * commands universally lack it.
 */
function computeNetPnl(userData) {
    return Number(userData.totalWon || 0) - Number(userData.totalLost || 0);
}

/* ═══════════════════════════════════════════════════════════════
   PRESENTATION
   ═══════════════════════════════════════════════════════════════ */

function buildStatsContainer(target, userData, guildId) {
    const wallet  = Number(userData.coins) || 0;
    const bank    = Number(userData.bank)  || 0;
    const total   = wallet + bank;

    const totalEarned  = Number(userData.totalEarned  || 0);
    const totalGambled = Number(userData.totalGambled || 0);
    const totalWon     = Number(userData.totalWon     || 0);
    const totalLost    = Number(userData.totalLost    || 0);

    const luck = computeLuck(userData);
    const battleWinRate = computeBattleWinRate(userData);
    const netPnl = computeNetPnl(userData);

    // Pick an accent that matches how the user is doing — green if
    // up overall, red if down, neutral if not gambling.
    let accent;
    if (totalGambled === 0)      accent = 0x6b7280; // neutral
    else if (netPnl > 0)         accent = 0x22c55e; // green = winning
    else if (netPnl < 0)         accent = 0xef4245; // red = losing
    else                         accent = 0xfbbf24; // gold = breakeven
    if (userData.vip)            accent = 0xfbbf24; // gold for VIPs

    const container = new ContainerBuilder().setAccentColor(accent);

    /* ── Header ─────────────────────────────────────────────────── */
    const headerBits = [
        userData.vip ? `${E.crown} **VIP**` : null,
        userData.title ? `*${userData.title}*` : null,
    ].filter(Boolean).join(' · ');

    const headerLines = [
        `# ${E.title} ${target.username}'s Economy Stats`,
        headerBits ? `-# ${headerBits}` : null,
        `-# Comprehensive lifetime breakdown — wallet, gambling, action counters & inventory.`,
    ].filter(Boolean);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerLines.join('\n')));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    /* ── Wallet block ───────────────────────────────────────────── */
    const walletLines = [
        `### ${E.money} Wallet`,
        `> ${coinIcon(guildId)} **Cash:** ${formatCoins(wallet, guildId)}`,
        `> ${E.bank} **Bank:** ${formatCoins(bank, guildId)}`,
        `> ${E.chart} **Net Worth:** ${formatCoins(total, guildId)}`,
        `> ${E.fire} **Daily Streak:** ${userData.streak || userData.dailyStreak || 0} day${(userData.streak || userData.dailyStreak || 0) === 1 ? '' : 's'}`,
        `> ${E.lightning} **Level:** ${userData.level || 1} · ${fmt(userData.xp || 0)} XP`,
    ];
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(walletLines.join('\n')));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    /* ── Gambling block ─────────────────────────────────────────── */
    const pnlBadge = totalGambled === 0
        ? '`No bets yet`'
        : netPnl > 0  ? `${E.success} **+${fmt(netPnl)}**`
        : netPnl < 0  ? `${E.cancel} **${fmt(netPnl)}**`
                      : `${E.info} **breakeven**`;

    const gambleLines = [
        `### ${E.gamepad} Gambling`,
        `> ${E.chart} **Total Wagered:** ${formatCoins(totalGambled, guildId)}`,
        `> ${E.success} **Total Won:** ${formatCoins(totalWon, guildId)}`,
        `> ${E.cancel} **Total Lost:** ${formatCoins(totalLost, guildId)}`,
        `> ${E.history} **Net P&L:** ${pnlBadge}`,
        `> ${E.star} **Luck:** ${luck.label}  ·  -# ${luck.subtitle}`,
    ];
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(gambleLines.join('\n')));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    /* ── Earnings block ─────────────────────────────────────────── */
    const earnLines = [
        `### ${E.lightning} Lifetime Earnings`,
        `> ${coinIcon(guildId)} **Total Earned:** ${formatCoins(totalEarned, guildId)}`,
        `> 💼 **Shifts Worked:** ${fmt(userData.workCount       || 0)}`,
        `> 🦹 **Crimes Done:** ${fmt(userData.crimeCount        || 0)}`,
        `> ${E.bank} **Heists:** ${fmt(userData.heistCount      || 0)}`,
        `> 🎁 **Gifts Sent:** ${fmt(userData.giftsSent          || 0)}`,
    ];
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(earnLines.join('\n')));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    /* ── Action counters ────────────────────────────────────────── */
    const actionLines = [
        `### ${E.box} Action Counters`,
        `> ⚔️ **Battles:** ${fmt(userData.battlesWon || 0)}W / ${fmt(userData.battlesLost || 0)}L${
            battleWinRate !== null ? ` · ${battleWinRate.toFixed(1)}% win rate` : ''
        }`,
        `> 🎣 **Fish Caught:** ${fmt(userData.fishCaught || 0)}`,
        `> 🏹 **Hunts:** ${fmt(userData.huntCount || 0)}`,
        `> ⛏ **Mined:** ${fmt(userData.miningCount || 0)} times`,
        `> 🌾 **Crops Harvested:** ${fmt(userData.harvestCount || 0)}`,
        `> 🔨 **Items Crafted:** ${fmt(userData.craftCount || 0)}`,
        `> 🗺 **Adventures:** ${fmt(userData.adventuresCompleted || 0)}`,
    ];
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(actionLines.join('\n')));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    /* ── Inventory + ore + stocks ──────────────────────────────── */
    const invCounts = aggregateInventory(target.id, userData);
    const invEntries = Object.entries(invCounts).filter(([, q]) => q > 0);
    const totalItems = invEntries.reduce((acc, [, q]) => acc + q, 0);

    const oreEntries = Object.entries(userData.oreInventory || {})
        .filter(([, q]) => Number(q) > 0);
    const totalOre = oreEntries.reduce((acc, [, q]) => acc + Number(q), 0);

    const stockEntries = Object.entries(userData.stockPortfolio || {})
        .filter(([, q]) => Number(q) > 0);

    const invLines = [`### ${E.folder} Inventory & Holdings`];

    invLines.push(`> ${E.box} **Items:** ${fmt(totalItems)} across ${invEntries.length} type${invEntries.length === 1 ? '' : 's'}`);
    if (invEntries.length > 0) {
        // Top 6 items by quantity, named with the shop's display name
        // when we know it — falls back to the raw id otherwise so a
        // legacy item still shows up.
        const topItems = invEntries
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([id, qty]) => {
                const def = ITEMS[id];
                const name = def ? `${def.emoji || ''} ${def.name}`.trim() : id;
                return `\`${qty}×\` ${name}`;
            });
        invLines.push(`-# ${topItems.join('  ·  ')}${invEntries.length > 6 ? `  *+${invEntries.length - 6} more*` : ''}`);
    }

    invLines.push(`> ⛏ **Ore:** ${fmt(totalOre)} pieces across ${oreEntries.length} type${oreEntries.length === 1 ? '' : 's'}`);
    if (oreEntries.length > 0) {
        const topOre = oreEntries
            .sort((a, b) => Number(b[1]) - Number(a[1]))
            .slice(0, 6)
            .map(([id, qty]) => `\`${qty}×\` ${id}`);
        invLines.push(`-# ${topOre.join('  ·  ')}${oreEntries.length > 6 ? `  *+${oreEntries.length - 6} more*` : ''}`);
    }

    invLines.push(`> 📈 **Stocks:** ${stockEntries.length} ticker${stockEntries.length === 1 ? '' : 's'} held`);
    if (stockEntries.length > 0) {
        const topStocks = stockEntries
            .sort((a, b) => Number(b[1]) - Number(a[1]))
            .slice(0, 6)
            .map(([t, q]) => `\`${fmt(q)}\` **${t.toUpperCase()}**`);
        invLines.push(`-# ${topStocks.join('  ·  ')}${stockEntries.length > 6 ? `  *+${stockEntries.length - 6} more*` : ''}`);
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(invLines.join('\n')));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    /* ── Achievements ───────────────────────────────────────────── */
    const earnedAchievements = (Array.isArray(userData.achievements) ? userData.achievements : [])
        .map(id => ({ id, def: economyManager.ACHIEVEMENTS[id] }))
        .filter(a => a.def);
    const totalAchievements = Object.keys(economyManager.ACHIEVEMENTS || {}).length;

    const achLines = [
        `### ${E.award} Achievements (${earnedAchievements.length}/${totalAchievements})`,
    ];
    if (earnedAchievements.length > 0) {
        const display = earnedAchievements
            .slice(0, 12)
            .map(a => `${a.def.emoji} **${a.def.name}**`)
            .join('  ·  ');
        achLines.push(`-# ${display}${earnedAchievements.length > 12 ? `  *+${earnedAchievements.length - 12} more*` : ''}`);
    } else {
        achLines.push(`-# No achievements yet — keep grinding to unlock the first one.`);
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(achLines.join('\n')));

    return container;
}

/**
 * Single source of truth — both prefix and slash call this so the
 * card renders identically regardless of entry point.
 */
async function renderStats(target, guildId, reply) {
    const economy = economyManager.loadEconomy();
    const { userData, changed } = economyManager.getUser(economy, target.id);
    if (changed) economyManager.saveEconomy(economy);

    try {
        const container = buildStatsContainer(target, userData, guildId);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } catch (err) {
        console.error('[ECONOMYSTATS] render error:', err);
        const fallback = new ContainerBuilder().setAccentColor(0xed4245);
        fallback.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `${E.cancel} Could not render economy stats — please try again in a moment.`
        ));
        return reply({ components: [fallback], flags: MessageFlags.IsComponentsV2 });
    }
}

/* ═══════════════════════════════════════════════════════════════
   MODULE EXPORT
   ═══════════════════════════════════════════════════════════════ */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('economystats')
        .setDescription('See a comprehensive breakdown of your economy stats')
        .addUserOption(o => o
            .setName('user')
            .setDescription('User to inspect (defaults to yourself)')
            .setRequired(false)),

    prefix: 'economystats',
    aliases: ['estats', 'ecostats', 'economy-stats'],
    category: 'economy',
    description: 'See your full economy breakdown — wallet, gambling P&L, luck %, action counters, items, ore, stocks, achievements.',
    usage: 'economystats [user]',

    async execute(interaction) {
        const target = interaction.options?.getUser('user') || interaction.user;
        const guildId = interaction.guild?.id;
        return renderStats(target, guildId, (payload) => interaction.reply(payload));
    },

    async executePrefix(message, args) {
        const target = (await resolveUser(message, args)) || message.author;
        return renderStats(target, message.guild?.id, (payload) => message.reply(payload));
    },
};
