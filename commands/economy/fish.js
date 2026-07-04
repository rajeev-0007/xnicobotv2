'use strict';

/**
 * fish — Cast a line, pull a fish, get coins.
 *
 * Economy ties
 * ────────────
 *   • Coins: every catch credits the user wallet, tracks
 *     `userData.totalEarned` and `userData.fishCaught`.
 *   • Rods: bought from the shop's "Fishing Gear" category. Higher
 *     tier rods boost catch value AND tilt the rarity table toward
 *     rarer fish. The fish command picks the best rod the user
 *     currently owns; the legacy "auto-rod by catch count" tier is
 *     still applied as a free baseline so brand-new players still
 *     feel progression.
 *   • Streak: consecutive catches inside a 5-minute window grow a
 *     `userData.fishStreak` counter — every multiple of 5 catches
 *     gives a small XP+coin bonus and a celebratory tag in the
 *     output.
 *   • Lucky Charm (`use lucky_charm`): +15% catch value AND a single
 *     junk-reroll on the next cast.
 *   • XP Boost: applied transparently inside `economyManager.addXP`.
 *   • Achievements: `fisher` (50 fish) is checked here.
 *
 * Cooldown: 30s.
 */

const { createContainer, addTextDisplay, addSeparator, MessageFlags, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const { formatCoins, coinIcon } = require('../../utils/currencyHelper');
const economyManager = require('../../utils/economyManager');
const { ITEMS } = require('../../utils/shopItems');
const jsonStore = require('../../utils/jsonStore');
const { applyIncomeTax, formatTaxFootnote } = require('../../utils/taxHelper');

/* ─────────── Catch tables ─────────── */

const FISH = [
    { name: 'Sardine',         emoji: '🐟', rarity: 'common',    value: 15,    rate: 50  },
    { name: 'Trout',           emoji: '🐠', rarity: 'common',    value: 25,    rate: 45  },
    { name: 'Catfish',         emoji: '🐡', rarity: 'common',    value: 30,    rate: 40  },
    { name: 'Bass',            emoji: '🐟', rarity: 'uncommon',  value: 60,    rate: 30  },
    { name: 'Salmon',          emoji: '🐠', rarity: 'uncommon',  value: 80,    rate: 25  },
    { name: 'Tuna',            emoji: '🐟', rarity: 'uncommon',  value: 100,   rate: 20  },
    { name: 'Swordfish',       emoji: '🗡', rarity: 'rare',      value: 250,   rate: 10  },
    { name: 'Pufferfish',      emoji: '🐡', rarity: 'rare',      value: 300,   rate: 8   },
    { name: 'Anglerfish',      emoji: '🔦', rarity: 'rare',      value: 400,   rate: 6   },
    { name: 'Marlin',          emoji: '🏹', rarity: 'epic',      value: 800,   rate: 3   },
    { name: 'Manta Ray',       emoji: '🦈', rarity: 'epic',      value: 1000,  rate: 2.5 },
    { name: 'Golden Koi',      emoji: '<:Star:1521227981685526568>', rarity: 'legendary', value: 2500, rate: 1   },
    { name: 'Kraken Baby',     emoji: '🐙', rarity: 'legendary',  value: 5000,  rate: 0.5 },
    { name: 'Leviathan Scale', emoji: '🌊', rarity: 'mythic',     value: 10000, rate: 0.1 },
];

const JUNK = [
    { name: 'Old Boot', emoji: '🥾', value: 5 },
    { name: 'Seaweed',  emoji: '🌿', value: 3 },
    { name: 'Tin Can',  emoji: '🥫', value: 2 },
    { name: 'Bottle',   emoji: '🍾', value: 8 },
];

const ROD_TIERS = [
    { id: null,            level: 0, name: 'Bare Hands',    valueMult: 0.7, junkBias: 1.4, rareBoost: 0.0  },
    { id: 'iron_rod',      level: 1, name: 'Iron Rod',      valueMult: 1.0, junkBias: 1.0, rareBoost: 0.0  },
    { id: 'gold_rod',      level: 2, name: 'Gold Rod',      valueMult: 1.3, junkBias: 0.85, rareBoost: 0.10 },
    { id: 'diamond_rod',   level: 3, name: 'Diamond Rod',   valueMult: 1.5, junkBias: 0.7,  rareBoost: 0.20 },
    { id: 'legendary_rod', level: 4, name: 'Legendary Rod', valueMult: 2.0, junkBias: 0.5,  rareBoost: 0.35 },
];

const RARITY_EMOJI = {
    common: '⬜', uncommon: '🟩', rare: '🟦', epic: '🟪', legendary: '🟨', mythic: '🟥',
};
const RARITY_ACCENT = {
    common: 0xCAD7E6, uncommon: 0x57F287, rare: 0x5865F2,
    epic: 0xA855F7, legendary: 0xFEE75C, mythic: 0xED4245,
};

const COOLDOWN     = 30_000;
const STREAK_WINDOW = 5 * 60 * 1000; // 5 minutes — keep going to chain bonuses
const cooldowns    = new Map();

/* ─────────── Inventory adapter for shop-bought rods ─────────── */

function loadInventory() {
    if (!jsonStore.has('inventory')) return {};
    try { return jsonStore.read('inventory') || {}; } catch { return {}; }
}

/**
 * Pick the best rod tier the user currently owns. Reads the global
 * inventory store (where /buy lands rods) and falls back to the
 * legacy `userData.inventory` object map for old data.
 */
function bestRodFor(userId, userData) {
    const inv = loadInventory();
    const slots = Array.isArray(inv[userId]) ? inv[userId] : [];
    const ownedIds = new Set(slots.map(it => it && it.id).filter(Boolean));
    const legacy = userData.inventory;
    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
        for (const [id, qty] of Object.entries(legacy)) {
            if (Number(qty) > 0) ownedIds.add(id);
        }
    }
    let best = ROD_TIERS[0];
    for (const tier of ROD_TIERS) {
        if (tier.id && ownedIds.has(tier.id) && tier.level > best.level) best = tier;
    }
    return best;
}

/**
 * Free baseline rod tier the user gets from progression — caps at
 * tier 2 (Gold-Rod-equivalent) so high-end rods still need to be
 * bought from the shop.
 */
function freeBaselineRod(fishCount) {
    if (fishCount >= 100) return ROD_TIERS[2]; // gold-equivalent
    if (fishCount >= 50)  return ROD_TIERS[1]; // iron-equivalent
    if (fishCount >= 20)  return { ...ROD_TIERS[0], valueMult: 0.85, name: 'Practice Rod' };
    return ROD_TIERS[0];
}

/** Combine the free baseline tier with the best-owned rod. */
function effectiveRod(userId, userData) {
    const baseline = freeBaselineRod(userData.fishCaught || 0);
    const owned = bestRodFor(userId, userData);
    return owned.level >= baseline.level ? owned : baseline;
}

/* ─────────── Catch logic ─────────── */

function rollFish(rod, charmActive) {
    // Junk gate: scaled down by rod quality, scaled up if bare-handed.
    const junkChance = 0.15 * rod.junkBias;
    if (Math.random() < junkChance) {
        return { type: 'junk', item: JUNK[Math.floor(Math.random() * JUNK.length)] };
    }

    // Rare-boost reshapes the rate distribution: rares get +rareBoost
    // weight, commons get less. Stays additive so all fish remain in
    // the pool — the legendary/mythic tail stays small but reachable.
    const tilted = FISH.map(f => {
        let weight = f.rate;
        if (f.rarity === 'common')                       weight *= (1 - rod.rareBoost * 0.5);
        if (f.rarity === 'rare' || f.rarity === 'epic')  weight *= (1 + rod.rareBoost);
        if (f.rarity === 'legendary')                    weight *= (1 + rod.rareBoost * 1.5);
        if (f.rarity === 'mythic')                       weight *= (1 + rod.rareBoost * 2);
        if (charmActive && f.rarity !== 'common')        weight *= 1.15;
        return { ...f, _w: Math.max(0.01, weight) };
    });

    const total = tilted.reduce((s, f) => s + f._w, 0);
    let roll = Math.random() * total;
    for (const f of tilted) {
        roll -= f._w;
        if (roll <= 0) return { type: 'fish', item: f };
    }
    return { type: 'fish', item: tilted[0] };
}

/* ─────────── Command flow ─────────── */

async function handleFish(reply, userId, guildId) {
    const now = Date.now();

    // Cooldown: prefer the persisted `userData.lastFish` so a bot
    // restart can't let the user fish twice in 30s. Fall back to the
    // in-memory map for the brief window between fish complete and
    // the economy save (lastFish is written at the bottom of this fn).
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);
    const persistedLast = Number(userData.lastFish || 0);
    const memLast       = Number(cooldowns.get(userId) || 0) - COOLDOWN;
    const lastUsed      = Math.max(persistedLast, memLast);
    const remaining     = COOLDOWN - (now - lastUsed);

    if (remaining > 0) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `<:Cancel:1521227723916181644> Fishing cooldown: **${economyManager.formatTime(remaining)}**`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    cooldowns.set(userId, now + COOLDOWN);

    userData.boosts = userData.boosts || {};

    const charmActive = Number(userData.boosts.luckyCharm || 0) > now;
    const rod = effectiveRod(userId, userData);

    // First roll. If junk on a charmed cast, re-roll once before
    // accepting — junk on a charmed cast feels punishing.
    let { type, item } = rollFish(rod, charmActive);
    if (charmActive && type === 'junk') {
        ({ type, item } = rollFish(rod, charmActive));
    }

    /* ── Streak ── */
    const lastFish = Number(userData.lastFish || 0);
    const inWindow = now - lastFish < STREAK_WINDOW && lastFish > 0;
    const newStreak = inWindow ? (userData.fishStreak || 0) + 1 : 1;
    userData.fishStreak = newStreak;

    /* ── Value calc ── */
    let value = Math.floor(item.value * rod.valueMult);
    if (charmActive) value = Math.floor(value * 1.15);

    // Streak bonus: +5% per multiple of 5, max +25%.
    const streakBonusPct = Math.min(0.25, Math.floor(newStreak / 5) * 0.05);
    let streakBonus = 0;
    if (streakBonusPct > 0) {
        streakBonus = Math.floor(value * streakBonusPct);
        value += streakBonus;
    }

    /* ── Persist ── */
    // Wealth tax — applies once total wealth (wallet+bank) ≥ 100k.
    const taxResult = applyIncomeTax(value, userData);
    const netValue = taxResult.net;

    userData.coins        = (userData.coins        || 0) + netValue;
    userData.totalEarned  = (userData.totalEarned  || 0) + netValue;
    userData.fishCaught   = (userData.fishCaught   || 0) + 1;
    userData.lastFish     = now;
    if (charmActive) delete userData.boosts.luckyCharm;

    if (userData.fishCaught >= 50) economyManager.checkAchievement(economy, userId, 'fisher');

    const xpGain =
        type === 'junk'           ? 2  :
        item.rarity === 'mythic'  ? 50 :
        item.rarity === 'legendary' ? 25 :
        item.rarity === 'epic'    ? 15 :
        item.rarity === 'rare'    ? 10 : 5;
    const xpResult = economyManager.addXP(economy, userId, xpGain);
    economyManager.saveEconomy(economy);

    /* ── Render ── */
    const accent = type === 'junk'
        ? 0x6b7280
        : (RARITY_ACCENT[item.rarity] || 0xCAD7E6);

    const rarityTag = type === 'junk' ? 'Junk' : item.rarity.toUpperCase();
    const rarityIcon = type === 'junk' ? '🗑️' : (RARITY_EMOJI[item.rarity] || '⬜');
    const headline = type === 'junk'
        ? `# 🎣 You Pulled Up Junk`
        : item.rarity === 'mythic'    ? `# 🎣 MYTHIC CATCH`
        : item.rarity === 'legendary' ? `# 🎣 Legendary Catch!`
        : `# 🎣 Fishing Result`;

    const container = createContainer(accent);
    addTextDisplay(container, [
        headline,
        '',
        `You caught **${item.emoji} ${item.name}**`,
        `> ${rarityIcon} Rarity: **${rarityTag}**`,
    ].join('\n'));

    addSeparator(container, SeparatorSpacingSize.Small);

    const lines = [
        `> ${coinIcon(guildId)} **+${formatCoins(netValue, guildId)}**`,
        `> <:transfer:1521228019824590948> **+${xpGain}** XP${xpResult.boosted ? ' (xp_boost +50%)' : ''}${xpResult.leveledUp ? ` · **Level Up → Lv.${xpResult.newLevel}**` : ''}`,
        `> 🎣 Rod: **${rod.name}**${rod.id ? '' : ' *(buy a rod from the shop)*'}`,
        `> <:Invoice:1521227903956811836> Total fish: **${userData.fishCaught}**`,
    ];
    if (newStreak >= 2) {
        lines.push(`> <:Fire:1521227907647668374> **Streak:** ${newStreak}× in a row${streakBonusPct > 0 ? ` · +${Math.round(streakBonusPct * 100)}% (+${formatCoins(streakBonus, guildId)})` : ''}`);
    }
    if (charmActive) {
        lines.push(`> 🍀 **Lucky Charm** consumed (+15% value, junk re-roll active)`);
    }
    const taxLine = formatTaxFootnote(taxResult);
    if (taxLine) lines.push(taxLine);

    // Progression hint: show what the next rod tier would do.
    if (rod.level < ROD_TIERS.length - 1) {
        const next = ROD_TIERS[rod.level + 1];
        if (next.id) {
            const meta = ITEMS[next.id];
            if (meta) {
                lines.push('', `-# Next tier: **${next.name}** · \`buy ${next.id}\` (${formatCoins(meta.price, guildId)})`);
            }
        }
    } else {
        lines.push('', `-# You\'re using the best rod available. Keep fishing!`);
    }

    addTextDisplay(container, lines.join('\n'));
    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new (require('discord.js').SlashCommandBuilder)()
        .setName('fish')
        .setDescription('Go fishing — catch fish for coins, chase the legendary tier'),
    prefix: 'fish',
    aliases: ['fishing', 'cast'],
    category: 'economy',
    description: 'Go fishing — catch fish for coins, chase the legendary tier',

    async executePrefix(message) {
        return handleFish(message.reply.bind(message), message.author.id, message.guild?.id);
    },

    async execute(interaction) {
        return handleFish(interaction.reply.bind(interaction), interaction.user.id, interaction.guild?.id);
    },
};
