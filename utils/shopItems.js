'use strict';

/**
 * shopItems.js — every purchasable / craftable / collectable item.
 *
 * Each item carries:
 *   name         display name
 *   emoji        prefers a Discord custom emoji where one exists, falls
 *                back to a curated Unicode glyph
 *   price        coins to buy from the shop (0 = not for sale)
 *   sellPrice    coins received when sold via /sell-item (0 = unsellable)
 *   description  short shop description (rendered in /shop and /inventory)
 *   category     groups for /shop pagination
 *   type         use | stat | timed | loot | passive | plant | material
 *   stackable    whether multiple instances stack in the inventory
 *   maxOwn       per-user inventory cap
 *   requiresPet  needs an active battle pet to use
 *
 * Cooldowns live in `utils/itemCooldowns.js` so they can be queried by
 * shop / inventory / use commands from one place.
 */

const CATEGORIES = {
    consumable: { label: 'Consumables', emoji: '<:Bookopen:1521227911137595605>', color: 0x22c55e },
    boost:      { label: 'Boosts',      emoji: '<:Lightning:1521227915537285150>', color: 0xfbbf24 },
    loot:       { label: 'Loot Boxes',  emoji: '<:Box:1521228152414666833>',       color: 0x8b5cf6 },
    special:    { label: 'Special',     emoji: '<:Star:1521227981685526568>',      color: 0xec4899 },
    seeds:      { label: 'Seeds',       emoji: '🌱',                                color: 0x16a34a },
    mining:     { label: 'Mining Gear', emoji: '<:Sketch:1521228025365004471>',    color: 0x78716c },
    fishing:    { label: 'Fishing Gear', emoji: '🎣',                                color: 0x06b6d4 },
    materials:  { label: 'Materials',   emoji: '<:Caretright:1521227704953864202>',color: 0x57534e },
};

const ITEMS = {

    /* ═══════════════ CONSUMABLES ═══════════════
     * type: 'use' — consumed on use, immediate effect
     * ═══════════════════════════════════════════ */

    ticket: {
        name: 'Lottery Ticket',
        emoji: '<:Document:1521227875016114266>',
        price: 500,
        sellPrice: 250,
        description: 'Enter the weekly lottery draw — more tickets = higher chance to win',
        category: 'consumable',
        type: 'use',
        stackable: true,
        maxOwn: 50,
    },
    gem: {
        name: 'Pet Gem',
        emoji: '<:Sketch:1521228025365004471>',
        price: 10000,
        sellPrice: 5000,
        description: 'Feeds your active pet +100 EXP instantly',
        category: 'consumable',
        type: 'use',
        stackable: true,
        maxOwn: 99,
        requiresPet: true,
    },
    xp_potion: {
        name: 'XP Potion',
        emoji: '<:Lightbulbalt:1521227880703463675>',
        price: 8000,
        sellPrice: 3000,
        description: 'Supercharges your active pet with +150 EXP immediately',
        category: 'consumable',
        type: 'use',
        stackable: true,
        maxOwn: 99,
        requiresPet: true,
    },
    coin_bag: {
        // Rebalanced: 5,000 cost vs 4,000–7,500 random payout. Average
        // ~5,750, so a single use is ~+750 expected value with a real
        // chance of net loss. Combined with a 15-minute cooldown this
        // is a fun gamble, not a money printer.
        name: 'Coin Bag',
        emoji: '<:Money:1521228266957045900>',
        price: 5000,
        sellPrice: 1500,
        description: 'Open it for 4,000–7,500 random coins · 15-minute cooldown after use',
        category: 'consumable',
        type: 'use',
        stackable: true,
        maxOwn: 50,
    },
    health_pack: {
        name: 'Health Pack',
        emoji: '<:Heart:1521228100652765247>',
        price: 5000,
        sellPrice: 2000,
        description: 'Fully restores your active pet\'s HP to its maximum',
        category: 'consumable',
        type: 'use',
        stackable: true,
        maxOwn: 20,
        requiresPet: true,
    },
    energy_drink: {
        name: 'Energy Drink',
        emoji: '<:Lightningalt:1521227851796447472>',
        price: 6000,
        sellPrice: 2500,
        description: 'Resets your work cooldown · usable once every 4 hours',
        category: 'consumable',
        type: 'use',
        stackable: true,
        maxOwn: 10,
    },
    skill_scroll: {
        // Teaches a random skill the active pet doesn't already know,
        // weighted toward the pet's tier. The catalog gates picks via
        // unlockTier (≤ pet.level) so a level-1 pet won't accidentally
        // be handed Meteor Strike.
        name: 'Skill Scroll',
        emoji: '<:Document:1521227875016114266>',
        price: 7500,
        sellPrice: 3000,
        description: 'Teaches your active pet a random new skill · 90s cooldown',
        category: 'consumable',
        type: 'use',
        stackable: true,
        maxOwn: 30,
        requiresPet: true,
    },

    /* ═══════════════ BOOSTS ═══════════════════
     * type: 'stat' — permanent stacking stat bonus (capped)
     * 'use'  — single-run boost (consumed by activity)
     * 'timed'— window of time-limited boost
     * ════════════════════════════════════════ */

    trophy: {
        name: 'Trophy',
        emoji: '<:Award:1521228119640375336>',
        price: 5000,
        sellPrice: 2500,
        description: 'Permanent +2% work & daily income (stacks up to 50%)',
        category: 'boost',
        type: 'stat',
        stackable: true,
        maxOwn: 25,
    },
    medal: {
        name: 'Medal',
        emoji: '<:Award:1521228119640375336>',
        price: 3000,
        sellPrice: 1500,
        description: 'Permanent +5% gamble bonus on all bets (stacks up to 25%)',
        category: 'boost',
        type: 'stat',
        stackable: true,
        maxOwn: 5,
    },
    crown: {
        name: 'Crown',
        emoji: '<:Crown:1521227739988889764>',
        price: 25000,
        sellPrice: 12500,
        description: 'Permanent +10% on all coin earnings (stacks up to 50%)',
        category: 'boost',
        type: 'stat',
        stackable: true,
        maxOwn: 5,
    },
    star_booster: {
        name: 'Star Booster',
        emoji: '<:Star:1521227981685526568>',
        price: 10000,
        sellPrice: 5000,
        description: 'Permanent +5% win-rate on slots & betflip (stacks up to 25%)',
        category: 'boost',
        type: 'stat',
        stackable: true,
        maxOwn: 5,
    },
    mining_boost: {
        name: 'Mining Boost',
        emoji: '<:Lightning:1521227915537285150>',
        price: 8000,
        sellPrice: 4000,
        description: '+25% rare-ore chance on your very next mine run',
        category: 'boost',
        type: 'use',
        stackable: true,
        maxOwn: 10,
    },
    farm_boost: {
        name: 'Farm Boost',
        emoji: '🌻',
        price: 6000,
        sellPrice: 3000,
        description: '+50% crop yield on your very next harvest',
        category: 'boost',
        type: 'use',
        stackable: true,
        maxOwn: 10,
    },
    xp_boost: {
        name: 'XP Boost',
        emoji: '<:Lightning:1521227915537285150>',
        price: 15000,
        sellPrice: 7000,
        description: '+50% XP from all activities for 2 hours',
        category: 'boost',
        type: 'timed',
        stackable: true,
        maxOwn: 3,
    },

    /* ═══════════════ LOOT BOXES ════════════════
     * type: 'loot' — opened for random rewards (cooldown-gated)
     * ════════════════════════════════════════════ */

    mystery_box: {
        name: 'Mystery Box',
        emoji: '<:Box:1521228152414666833>',
        price: 20000,
        sellPrice: 10000,
        description: 'Random reward: coins (50%) · Rare pet (30%) · Weapon Box (20%) · 1h cooldown',
        category: 'loot',
        type: 'loot',
        stackable: true,
        maxOwn: 99,
    },
    weapon_box: {
        name: 'Weapon Box',
        emoji: '<:Caretright:1521227704953864202>',
        price: 15000,
        sellPrice: 7500,
        description: 'Random weapon (common→legendary tilt) for your active pet · 60s cooldown',
        category: 'loot',
        type: 'loot',
        stackable: true,
        maxOwn: 99,
        requiresPet: true,
    },
    weapon_crate: {
        // Premium variant of weapon_box. Drops only uncommon+ weapons,
        // with a real chance at legendary/mythic. Higher cost, longer
        // cooldown so it doesn't trivialise the gear progression.
        name: 'Weapon Crate',
        emoji: '<:Box:1521228152414666833>',
        price: 60000,
        sellPrice: 25000,
        description: 'Premium box: rare→mythic weapon for your active pet · 30m cooldown',
        category: 'loot',
        type: 'loot',
        stackable: true,
        maxOwn: 25,
        requiresPet: true,
    },
    crystal_box: {
        name: 'Crystal Box',
        emoji: '<:Sketch:1521228025365004471>',
        price: 30000,
        sellPrice: 15000,
        description: 'Premium loot: coins (40%) · Pet Gem (35%) · Weapon Box (25%) · 1.5h cooldown',
        category: 'loot',
        type: 'loot',
        stackable: true,
        maxOwn: 20,
    },
    dragon_egg: {
        name: 'Dragon Egg',
        emoji: '<:Fire:1521227907647668374>',
        price: 50000,
        sellPrice: 25000,
        description: 'Hatches a Legendary Dragon pet · 12h cooldown between hatches',
        category: 'loot',
        type: 'loot',
        stackable: true,
        maxOwn: 5,
    },

    /* ═══════════════ SPECIAL ════════════════════
     * type: 'special' — unique timed or permanent effects
     * ════════════════════════════════════════════ */

    lucky_charm: {
        name: 'Lucky Charm',
        emoji: '<:Star:1521227981685526568>',
        price: 8000,
        sellPrice: 4000,
        description: '+15% loot quality on your next hunt or fish (1h or 1 use)',
        category: 'special',
        type: 'timed',
        stackable: true,
        maxOwn: 10,
    },
    shield: {
        name: 'Shield Token',
        emoji: '<:Shield:1521227694677692467>',
        price: 12000,
        sellPrice: 6000,
        description: 'Protects all your coins from robbery for 24 hours',
        category: 'special',
        type: 'timed',
        stackable: true,
        maxOwn: 5,
    },
    time_skip: {
        name: 'Time Skip',
        emoji: '<:Clock:1521228110408847623>',
        price: 12000,
        sellPrice: 5000,
        description: 'Resets BOTH work and daily cooldowns · usable once every 8 hours',
        category: 'special',
        type: 'use',
        stackable: true,
        maxOwn: 5,
    },
    vip_badge: {
        name: 'VIP Badge',
        emoji: '<:Crown:1521227739988889764>',
        price: 100000,
        sellPrice: 0,
        description: 'Permanent VIP status — displayed on your economy profile',
        category: 'special',
        type: 'use',
        stackable: false,
        maxOwn: 1,
    },

    /* ═══════════════ SEEDS ══════════════════════
     * type: 'plant' — planted via /farm, not used directly
     * ════════════════════════════════════════════ */

    wheat_seed: {
        name: 'Wheat Seed',
        emoji: '🌾',
        price: 200,
        sellPrice: 50,
        description: 'Plant via `farm plant wheat_seed` · grows in 10 min · 300–500 coins',
        category: 'seeds',
        type: 'plant',
        stackable: true,
        maxOwn: 50,
        growTime: 10 * 60 * 1000,
        yield: [300, 500],
    },
    carrot_seed: {
        name: 'Carrot Seed',
        emoji: '🥕',
        price: 500,
        sellPrice: 150,
        description: 'Plant via `farm plant carrot_seed` · grows in 20 min · 700–1,200 coins',
        category: 'seeds',
        type: 'plant',
        stackable: true,
        maxOwn: 30,
        growTime: 20 * 60 * 1000,
        yield: [700, 1200],
    },
    pumpkin_seed: {
        name: 'Pumpkin Seed',
        emoji: '🎃',
        price: 1500,
        sellPrice: 500,
        description: 'Plant via `farm plant pumpkin_seed` · grows in 60 min · 3,000–5,000 coins',
        category: 'seeds',
        type: 'plant',
        stackable: true,
        maxOwn: 10,
        growTime: 60 * 60 * 1000,
        yield: [3000, 5000],
    },

    /* ═══════════════ MINING GEAR ════════════════
     * type: 'passive' — equip once, works automatically while mining
     * ════════════════════════════════════════════ */

    iron_pickaxe: {
        name: 'Iron Pickaxe',
        emoji: '<:Caretright:1521227704953864202>',
        price: 5000,
        sellPrice: 2000,
        description: 'Passive: +10% rare-ore chance every mine run (no action needed)',
        category: 'mining',
        type: 'passive',
        stackable: false,
        maxOwn: 1,
        miningBonus: 0.10,
    },
    gold_pickaxe: {
        name: 'Gold Pickaxe',
        emoji: '<:Money:1521228266957045900>',
        price: 15000,
        sellPrice: 6000,
        description: 'Passive: +25% rare-ore chance every mine run (no action needed)',
        category: 'mining',
        type: 'passive',
        stackable: false,
        maxOwn: 1,
        miningBonus: 0.25,
    },
    diamond_pickaxe: {
        name: 'Diamond Pickaxe',
        emoji: '<:Sketch:1521228025365004471>',
        price: 50000,
        sellPrice: 20000,
        description: 'Passive: +50% rare-ore chance every mine run — the best pickaxe',
        category: 'mining',
        type: 'passive',
        stackable: false,
        maxOwn: 1,
        miningBonus: 0.50,
    },

    /* ═══════════════ FISHING GEAR ═══════════════
     * type: 'passive' — equip once, applies automatically while fishing.
     * Buying a higher-tier rod doesn't refund the lower tier; the
     * fish command picks the best rod the user currently owns.
     * ════════════════════════════════════════════ */

    iron_rod: {
        name: 'Iron Rod',
        emoji: '🎣',
        price: 4000,
        sellPrice: 1500,
        description: 'Passive: +15% catch value · slightly fewer junk pulls',
        category: 'fishing',
        type: 'passive',
        stackable: false,
        maxOwn: 1,
        rodLevel: 1,
    },
    gold_rod: {
        name: 'Gold Rod',
        emoji: '🎣',
        price: 12000,
        sellPrice: 5000,
        description: 'Passive: +30% catch value · better at hooking rare fish',
        category: 'fishing',
        type: 'passive',
        stackable: false,
        maxOwn: 1,
        rodLevel: 2,
    },
    diamond_rod: {
        name: 'Diamond Rod',
        emoji: '🎣',
        price: 35000,
        sellPrice: 14000,
        description: 'Passive: +50% catch value · noticeably more rare/epic catches',
        category: 'fishing',
        type: 'passive',
        stackable: false,
        maxOwn: 1,
        rodLevel: 3,
    },
    legendary_rod: {
        name: 'Legendary Rod',
        emoji: '🎣',
        price: 80000,
        sellPrice: 30000,
        description: 'Passive: +100% catch value · the only rod that pulls Mythic fish reliably',
        category: 'fishing',
        type: 'passive',
        stackable: false,
        maxOwn: 1,
        rodLevel: 4,
    },

    /* ═══════════════ MATERIALS ══════════════════
     * type: 'material' — crafting/sell items, cannot be used directly
     * ════════════════════════════════════════════ */

    stone: {
        name: 'Stone',
        emoji: '🪨',
        price: 50,
        sellPrice: 20,
        description: 'Common crafting material from mining · sell or craft with it',
        category: 'materials',
        type: 'material',
        stackable: true,
        maxOwn: 500,
    },
    wood: {
        name: 'Wood',
        emoji: '🪵',
        price: 80,
        sellPrice: 30,
        description: 'Basic crafting material · sell or use in crafting recipes',
        category: 'materials',
        type: 'material',
        stackable: true,
        maxOwn: 500,
    },
    iron_ore: {
        name: 'Iron Ore',
        emoji: '<:Caretright:1521227704953864202>',
        price: 200,
        sellPrice: 100,
        description: 'Uncommon ore from mining · key crafting ingredient',
        category: 'materials',
        type: 'material',
        stackable: true,
        maxOwn: 200,
    },
    gold_ore: {
        name: 'Gold Ore',
        emoji: '<:Money:1521228266957045900>',
        price: 800,
        sellPrice: 400,
        description: 'Rare ore from mining · high-value crafting material',
        category: 'materials',
        type: 'material',
        stackable: true,
        maxOwn: 100,
    },
    diamond_ore: {
        name: 'Diamond',
        emoji: '<:Sketch:1521228025365004471>',
        price: 5000,
        sellPrice: 3000,
        description: 'Extremely rare gem from mining · highly valuable',
        category: 'materials',
        type: 'material',
        stackable: true,
        maxOwn: 50,
    },
    emerald_ore: {
        name: 'Emerald',
        emoji: '<:Sketch:1521228025365004471>',
        price: 8000,
        sellPrice: 5000,
        description: 'Mythic-rarity gem · sells for a fortune',
        category: 'materials',
        type: 'material',
        stackable: true,
        maxOwn: 20,
    },
};

function getItem(id) {
    return ITEMS[id] ? { id, ...ITEMS[id] } : null;
}

function getItems(category = null) {
    return Object.entries(ITEMS)
        .filter(([, item]) => !category || item.category === category)
        .map(([id, item]) => ({ id, ...item }));
}

function itemDisplay(id) {
    const item = ITEMS[id];
    if (!item) return id;
    return `${item.emoji} ${item.name}`;
}

module.exports = { CATEGORIES, ITEMS, getItem, getItems, itemDisplay };
