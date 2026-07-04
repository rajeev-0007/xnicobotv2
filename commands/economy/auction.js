'use strict';

/**
 * /auction — Marketplace for inventory items and pets.
 *
 * Flow
 * ────
 *   /auction list                 Browse active listings (paginated)
 *   /auction sell-item <id> <price> [qty]    Put items up for instant-buy
 *   /auction sell-pet <petId> <price>         Put a pet up for instant-buy
 *   /auction buy <listingId>      Snap up a listing (atomic)
 *   /auction my                   View YOUR listings
 *   /auction cancel <listingId>   Pull your own listing
 *
 * Storage
 * ───────
 *   jsonStore key `auctions` = { listings: { [id]: Listing }, nextId: number }
 *
 *   Listing shape:
 *     { id, sellerId, sellerName, type: 'item'|'pet',
 *       itemId? (for items), petId? + petSnapshot? (for pets),
 *       qty, price, createdAt, expiresAt }
 *
 * Notes
 * ─────
 *   • Listings expire after 7 days. The list view drops expired
 *     entries and refunds nothing (the seller can re-list).
 *   • A 5% house fee comes off the sale price on buy — keeps mass
 *     market wash-trading from being a money loop and feeds the
 *     same economy sink as gambling.
 *   • Both sides use atomic mutex guards — two parallel `buy` from
 *     the same listing can't double-credit the seller or steal items.
 *   • Pet listings snapshot the pet's stats at list time so a buyer
 *     gets exactly what they saw, even if the seller levels it up
 *     afterward.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize, MessageFlags,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const economyManager = require('../../utils/economyManager');
const ph = require('../../utils/petHelpers');
const jsonStore = require('../../utils/jsonStore');
const { ITEMS, getItem } = require('../../utils/shopItems');
const { coinIcon, formatCoins, formatCoinsAmount } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber } = require('../../utils/componentHelpers');
const { resolveUser } = require('../../utils/resolveUser');

/* ═══════════════════════════════════════════════════════════════
   STORAGE
   ═══════════════════════════════════════════════════════════════ */

const STORE_KEY      = 'auctions';
const LISTING_TTL    = 7 * 24 * 60 * 60 * 1000; // 7 days
const HOUSE_FEE      = 0.05;                    // 5% off sales
const MIN_PRICE      = 100;
const MAX_PRICE      = 10_000_000;
const MAX_LISTINGS   = 10;                       // per user

function loadAuctions() {
    if (!jsonStore.has(STORE_KEY)) {
        const fresh = { listings: {}, nextId: 1 };
        jsonStore.write(STORE_KEY, fresh);
        return fresh;
    }
    const data = jsonStore.read(STORE_KEY) || {};
    if (!data.listings) data.listings = {};
    if (typeof data.nextId !== 'number') data.nextId = 1;
    return data;
}
function saveAuctions(data) { jsonStore.write(STORE_KEY, data); }

/** Drop expired listings in-place. Returns the count purged. */
function purgeExpired(state) {
    const now = Date.now();
    let removed = 0;
    for (const [id, l] of Object.entries(state.listings)) {
        if ((l.expiresAt || 0) < now) {
            delete state.listings[id];
            removed++;
        }
    }
    return removed;
}

function loadInv() { return jsonStore.has('inventory') ? (jsonStore.read('inventory') || {}) : {}; }
function saveInv(d) { jsonStore.write('inventory', d); }

/* Per-user re-entry locks for the mutating paths. Without these,
   double-fire (slash + prefix) can race the inventory mutation. */
const inFlight = new Set();

/* ═══════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════ */

function ownedItemQty(inv, userId, itemId) {
    const slots = Array.isArray(inv?.[userId]) ? inv[userId] : [];
    return slots.filter(s => s && s.id === itemId).length;
}

function consumeItems(inv, userId, itemId, qty) {
    inv[userId] ||= [];
    let removed = 0;
    inv[userId] = inv[userId].filter(slot => {
        if (slot && slot.id === itemId && removed < qty) {
            removed++;
            return false;
        }
        return true;
    });
    return removed;
}

function appendItems(inv, userId, itemId, qty) {
    inv[userId] ||= [];
    const now = Date.now();
    for (let i = 0; i < qty; i++) {
        inv[userId].push({ id: itemId, boughtAt: now, fromAuction: true });
    }
}

function listingDisplay(l, guildId) {
    const expIn = Math.max(0, l.expiresAt - Date.now());
    const days = Math.floor(expIn / 86_400_000);
    const hours = Math.floor((expIn % 86_400_000) / 3_600_000);
    const expiry = days >= 1 ? `${days}d ${hours}h` : `${hours}h`;

    if (l.type === 'item') {
        const meta = ITEMS[l.itemId];
        const name = meta ? meta.name : l.itemId;
        const emoji = meta?.emoji || '📦';
        return `> \`#${l.id}\` ${emoji} **${name}** ×${l.qty}  ·  ${formatCoins(l.price, guildId)}  ·  -# by ${l.sellerName} · expires in ${expiry}`;
    }
    if (l.type === 'pet') {
        const snap = l.petSnapshot || {};
        return `> \`#${l.id}\` ${snap.emoji || '🐾'} **${snap.name || 'Pet'}** *(Lv.${snap.level || 1} ${snap.rarity || 'common'})*  ·  ${formatCoins(l.price, guildId)}  ·  -# by ${l.sellerName} · expires in ${expiry}`;
    }
    return `> \`#${l.id}\`  ·  ${formatCoins(l.price, guildId)}`;
}

/* ═══════════════════════════════════════════════════════════════
   SUBCOMMANDS
   ═══════════════════════════════════════════════════════════════ */

async function listAll(reply, guildId) {
    const state = loadAuctions();
    purgeExpired(state);
    saveAuctions(state);

    const all = Object.values(state.listings)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 25); // first 25 newest

    const c = createContainer(0xCAD7E6);
    if (all.length === 0) {
        addTextDisplay(c, [
            `# 🛍️ Auction House`,
            '',
            `> The market is empty right now. Be the first seller!`,
            '',
            `**Sell items:** \`/auction sell-item <id> <price> [qty]\``,
            `**Sell pets:**  \`/auction sell-pet <petId> <price>\``,
        ].join('\n'));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const lines = all.map(l => listingDisplay(l, guildId));
    addTextDisplay(c, [
        `# 🛍️ Auction House`,
        `-# ${all.length} active listing${all.length === 1 ? '' : 's'}  ·  ${(HOUSE_FEE * 100).toFixed(0)}% house fee`,
        '',
        ...lines,
        '',
        `**Buy:** \`/auction buy <listingId>\`  ·  **My listings:** \`/auction my\``,
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

async function listMine(reply, userId, guildId) {
    const state = loadAuctions();
    purgeExpired(state);
    saveAuctions(state);

    const mine = Object.values(state.listings).filter(l => l.sellerId === userId);
    const c = createContainer(0xCAD7E6);
    if (mine.length === 0) {
        addTextDisplay(c, [
            `# 🛍️ Your Listings`,
            '',
            `> You have no active listings.`,
            '',
            `**Sell items:** \`/auction sell-item <id> <price> [qty]\``,
            `**Sell pets:**  \`/auction sell-pet <petId> <price>\``,
        ].join('\n'));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    addTextDisplay(c, [
        `# 🛍️ Your Listings`,
        `-# ${mine.length}/${MAX_LISTINGS} slot${mine.length === 1 ? '' : 's'} used`,
        '',
        ...mine.map(l => listingDisplay(l, guildId)),
        '',
        `Cancel a listing: \`/auction cancel <listingId>\``,
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

async function sellItem(reply, sellerId, sellerName, itemId, price, qty, guildId) {
    if (inFlight.has(sellerId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, '<:Infotriangle:1521227710381428926> A previous listing is still completing — try again in a moment.');
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    if (!itemId) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, '<:Cancel:1521227723916181644> Specify an item id. Use `inventory` to see your items.');
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    const meta = getItem(itemId);
    if (!meta) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `<:Cancel:1521227723916181644> Unknown item \`${itemId}\`.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    if (!Number.isFinite(price) || price < MIN_PRICE || price > MAX_PRICE) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `<:Cancel:1521227723916181644> Price must be between **${formatNumber(MIN_PRICE)}** and **${formatNumber(MAX_PRICE)}**.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    qty = Math.max(1, Math.min(qty || 1, 100));

    inFlight.add(sellerId);
    try {
        const inv = loadInv();
        const owned = ownedItemQty(inv, sellerId, itemId);
        if (owned < qty) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, `<:Cancel:1521227723916181644> You only have **${owned}× ${meta.name}** but tried to list **${qty}**.`);
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        const state = loadAuctions();
        purgeExpired(state);
        const userListings = Object.values(state.listings).filter(l => l.sellerId === sellerId).length;
        if (userListings >= MAX_LISTINGS) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, `<:Cancel:1521227723916181644> You already have **${MAX_LISTINGS}** active listings — cancel one first.`);
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        // Escrow the items off the seller's inventory immediately so
        // they can't gift/sell/use them while listed.
        const removed = consumeItems(inv, sellerId, itemId, qty);
        if (removed !== qty) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, `<:Cancel:1521227723916181644> Could not escrow ${qty}× ${meta.name} — please try again.`);
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
        saveInv(inv);

        const id = state.nextId++;
        const now = Date.now();
        state.listings[id] = {
            id, sellerId, sellerName,
            type: 'item',
            itemId, qty,
            price,
            createdAt: now,
            expiresAt: now + LISTING_TTL,
        };
        saveAuctions(state);

        const c = createContainer(0x57F287);
        addTextDisplay(c, [
            `# 🛍️ Listing Created`,
            '',
            `> ${meta.emoji} **${meta.name}** ×${qty}  ·  ${formatCoins(price, guildId)}`,
            `> Listing ID: \`#${id}\`  ·  expires in 7 days`,
            '',
            `-# Items are held in escrow. Cancel anytime with \`/auction cancel ${id}\`.`,
        ].join('\n'));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    } finally {
        inFlight.delete(sellerId);
    }
}

async function sellPet(reply, sellerId, sellerName, petId, price, guildId) {
    if (inFlight.has(sellerId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, '<:Infotriangle:1521227710381428926> A previous listing is still completing — try again.');
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    if (!petId) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, '<:Cancel:1521227723916181644> Specify a pet id. Use `pets` to see yours.');
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    if (!Number.isFinite(price) || price < MIN_PRICE || price > MAX_PRICE) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `<:Cancel:1521227723916181644> Price must be between **${formatNumber(MIN_PRICE)}** and **${formatNumber(MAX_PRICE)}**.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    inFlight.add(sellerId);
    try {
        const pets = ph.loadPets();
        ph.ensureUser(pets, sellerId);
        const animals = pets[sellerId].animals || [];
        const idx = animals.findIndex(p => p.id === petId);
        if (idx === -1) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, `<:Cancel:1521227723916181644> Pet \`${petId}\` not found in your collection.`);
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
        const pet = animals[idx];
        // Don't let the user list their last pet (the bot's economy
        // assumes a user always has at least one pet to use as an
        // active battle pet, sell, etc.).
        if (animals.length <= 1) {
            const c = createContainer(0xFEE75C);
            addTextDisplay(c, '<:Infotriangle:1521227710381428926> You need to keep at least one pet — catch another before listing this one.');
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        const state = loadAuctions();
        purgeExpired(state);
        const userListings = Object.values(state.listings).filter(l => l.sellerId === sellerId).length;
        if (userListings >= MAX_LISTINGS) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, `<:Cancel:1521227723916181644> You already have **${MAX_LISTINGS}** active listings — cancel one first.`);
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        // Snapshot the pet so a buyer always gets what they saw at
        // listing time. Strip mutable runtime fields like exp/hp.
        const snapshot = {
            id: pet.id, name: pet.name, emoji: pet.emoji, rarity: pet.rarity,
            level: pet.level || 1,
            baseHp: pet.baseHp, baseAtk: pet.baseAtk,
            atk: pet.atk, def: pet.def, spd: pet.spd, hp: pet.hp,
            weapon: pet.weapon ? { ...pet.weapon } : null,
            learnedSkills: Array.isArray(pet.learnedSkills) ? [...pet.learnedSkills] : [],
        };

        // Escrow the pet — remove from seller's collection.
        animals.splice(idx, 1);
        if (pets[sellerId].activeBattlePet === pet.id) {
            pets[sellerId].activeBattlePet = animals[0]?.id || null;
        }
        ph.savePets(pets);

        const id = state.nextId++;
        const now = Date.now();
        state.listings[id] = {
            id, sellerId, sellerName,
            type: 'pet',
            petId: pet.id,
            petSnapshot: snapshot,
            qty: 1,
            price,
            createdAt: now,
            expiresAt: now + LISTING_TTL,
        };
        saveAuctions(state);

        const c = createContainer(0x57F287);
        addTextDisplay(c, [
            `# 🛍️ Pet Listed`,
            '',
            `> ${snapshot.emoji} **${snapshot.name}** *(Lv.${snapshot.level} ${snapshot.rarity})*  ·  ${formatCoins(price, guildId)}`,
            `> Listing ID: \`#${id}\`  ·  expires in 7 days`,
            '',
            `-# Pet is held in escrow. Cancel anytime with \`/auction cancel ${id}\`.`,
        ].join('\n'));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    } finally {
        inFlight.delete(sellerId);
    }
}

async function buy(reply, buyerId, buyerName, listingId, guildId) {
    if (inFlight.has(buyerId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, '<:Infotriangle:1521227710381428926> A previous purchase is still completing — try again.');
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    inFlight.add(buyerId);
    try {
        const state = loadAuctions();
        purgeExpired(state);
        const listing = state.listings[listingId];
        if (!listing) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, `<:Cancel:1521227723916181644> Listing \`#${listingId}\` not found, expired, or already sold.`);
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
        if (listing.sellerId === buyerId) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, `<:Cancel:1521227723916181644> You can't buy your own listing.`);
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        const economy = economyManager.loadEconomy();
        const { userData: buyer } = economyManager.getUser(economy, buyerId);
        if ((buyer.coins || 0) < listing.price) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, `<:Cancel:1521227723916181644> Not enough coins. Need **${formatCoins(listing.price, guildId)}**, have **${formatCoins(buyer.coins, guildId)}**.`);
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        const fee = Math.floor(listing.price * HOUSE_FEE);
        const sellerNet = listing.price - fee;

        // Transfer money first so a delivery failure doesn't leave
        // the buyer paying for nothing.
        buyer.coins -= listing.price;
        const { userData: seller } = economyManager.getUser(economy, listing.sellerId);
        seller.coins += sellerNet;
        seller.totalEarned = (seller.totalEarned || 0) + sellerNet;

        // Deliver the goods to the buyer.
        let deliveryNote;
        if (listing.type === 'item') {
            const inv = loadInv();
            appendItems(inv, buyerId, listing.itemId, listing.qty || 1);
            saveInv(inv);
            const meta = ITEMS[listing.itemId];
            deliveryNote = `${meta?.emoji || '📦'} **${meta?.name || listing.itemId}** ×${listing.qty}`;
        } else if (listing.type === 'pet') {
            const pets = ph.loadPets();
            ph.ensureUser(pets, buyerId);
            const snap = listing.petSnapshot || {};
            // Re-issue a fresh pet id namespaced to the new owner so
            // it can't collide with the buyer's existing collection.
            const newId = ph.nextId(snap.rarity || 'common', snap.name || 'Pet', pets[buyerId].animals);
            pets[buyerId].animals.push({
                id: newId,
                name: snap.name, emoji: snap.emoji, rarity: snap.rarity,
                level: snap.level || 1,
                baseHp: snap.baseHp, baseAtk: snap.baseAtk,
                atk: snap.atk, def: snap.def, spd: snap.spd, hp: snap.hp || snap.baseHp,
                weapon: snap.weapon ? { ...snap.weapon } : null,
                learnedSkills: Array.isArray(snap.learnedSkills) ? [...snap.learnedSkills] : [],
                exp: 0,
            });
            ph.savePets(pets);
            deliveryNote = `${snap.emoji || '🐾'} **${snap.name}** *(Lv.${snap.level} ${snap.rarity})*`;
        }

        // Burn the listing — atomic: only one parallel buy can succeed
        // because both will try to delete the same listing key.
        delete state.listings[listingId];
        saveAuctions(state);
        economyManager.saveEconomy(economy);

        const c = createContainer(0x57F287);
        addTextDisplay(c, [
            `# 🛍️ Purchase Successful`,
            '',
            `> Bought ${deliveryNote} from **${listing.sellerName}**`,
            `> ${coinIcon(guildId)} Paid: ${formatCoinsAmount(listing.price, guildId)}  ·  -# ${(HOUSE_FEE * 100).toFixed(0)}% fee = ${formatCoins(fee, guildId)}`,
            '',
            `${coinIcon(guildId)} **Wallet:** ${formatCoinsAmount(buyer.coins, guildId)}`,
        ].join('\n'));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    } finally {
        inFlight.delete(buyerId);
    }
}

async function cancel(reply, sellerId, listingId, guildId) {
    if (inFlight.has(sellerId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, '<:Infotriangle:1521227710381428926> A previous action is still completing — try again.');
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    inFlight.add(sellerId);
    try {
        const state = loadAuctions();
        const listing = state.listings[listingId];
        if (!listing) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, `<:Cancel:1521227723916181644> Listing \`#${listingId}\` not found.`);
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
        if (listing.sellerId !== sellerId) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, `<:Cancel:1521227723916181644> That listing isn't yours.`);
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        // Return escrowed goods to the seller.
        if (listing.type === 'item') {
            const inv = loadInv();
            appendItems(inv, sellerId, listing.itemId, listing.qty || 1);
            saveInv(inv);
        } else if (listing.type === 'pet') {
            const pets = ph.loadPets();
            ph.ensureUser(pets, sellerId);
            const snap = listing.petSnapshot || {};
            const newId = ph.nextId(snap.rarity || 'common', snap.name || 'Pet', pets[sellerId].animals);
            pets[sellerId].animals.push({
                id: newId,
                name: snap.name, emoji: snap.emoji, rarity: snap.rarity,
                level: snap.level || 1,
                baseHp: snap.baseHp, baseAtk: snap.baseAtk,
                atk: snap.atk, def: snap.def, spd: snap.spd, hp: snap.hp || snap.baseHp,
                weapon: snap.weapon ? { ...snap.weapon } : null,
                learnedSkills: Array.isArray(snap.learnedSkills) ? [...snap.learnedSkills] : [],
                exp: 0,
            });
            ph.savePets(pets);
        }

        delete state.listings[listingId];
        saveAuctions(state);

        const c = createContainer(0xCAD7E6);
        addTextDisplay(c, [
            `# 🛍️ Listing Cancelled`,
            '',
            `> Listing \`#${listingId}\` removed from the market.`,
            `> Items returned to your inventory.`,
        ].join('\n'));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    } finally {
        inFlight.delete(sellerId);
    }
}

/* ═══════════════════════════════════════════════════════════════
   COMMAND DISPATCH
   ═══════════════════════════════════════════════════════════════ */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('auction')
        .setDescription('Marketplace for items and pets')
        .addSubcommand(s => s.setName('list').setDescription('Browse active listings'))
        .addSubcommand(s => s.setName('my').setDescription('View your active listings'))
        .addSubcommand(s => s.setName('sell-item')
            .setDescription('List an item for sale')
            .addStringOption(o => o.setName('item').setDescription('Item id (use /inventory)').setRequired(true))
            .addIntegerOption(o => o.setName('price').setDescription('Sale price in coins').setRequired(true).setMinValue(MIN_PRICE).setMaxValue(MAX_PRICE))
            .addIntegerOption(o => o.setName('quantity').setDescription('Quantity to sell (default 1)').setRequired(false).setMinValue(1).setMaxValue(100)))
        .addSubcommand(s => s.setName('sell-pet')
            .setDescription('List a pet for sale')
            .addStringOption(o => o.setName('pet').setDescription('Pet id (use /pets)').setRequired(true))
            .addIntegerOption(o => o.setName('price').setDescription('Sale price in coins').setRequired(true).setMinValue(MIN_PRICE).setMaxValue(MAX_PRICE)))
        .addSubcommand(s => s.setName('buy')
            .setDescription('Buy a listing by id')
            .addIntegerOption(o => o.setName('id').setDescription('Listing ID').setRequired(true)))
        .addSubcommand(s => s.setName('cancel')
            .setDescription('Cancel one of your listings')
            .addIntegerOption(o => o.setName('id').setDescription('Listing ID').setRequired(true))),

    prefix: 'auction',
    aliases: ['ah', 'market'],
    category: 'economy',
    description: 'List, browse, and buy items and pets in the auction house.',
    usage: 'auction <list|my|sell-item|sell-pet|buy|cancel> [args]',

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guild?.id;
        const reply = (p) => interaction.reply(p);

        if (sub === 'list') return listAll(reply, guildId);
        if (sub === 'my')   return listMine(reply, interaction.user.id, guildId);
        if (sub === 'sell-item') {
            return sellItem(
                reply,
                interaction.user.id, interaction.user.username,
                interaction.options.getString('item').toLowerCase(),
                interaction.options.getInteger('price'),
                interaction.options.getInteger('quantity') || 1,
                guildId,
            );
        }
        if (sub === 'sell-pet') {
            return sellPet(
                reply,
                interaction.user.id, interaction.user.username,
                interaction.options.getString('pet'),
                interaction.options.getInteger('price'),
                guildId,
            );
        }
        if (sub === 'buy') {
            return buy(
                reply,
                interaction.user.id, interaction.user.username,
                interaction.options.getInteger('id'),
                guildId,
            );
        }
        if (sub === 'cancel') {
            return cancel(reply, interaction.user.id, interaction.options.getInteger('id'), guildId);
        }
    },

    async executePrefix(message, args) {
        const sub = (args[0] || 'list').toLowerCase();
        const guildId = message.guild?.id;
        const reply = (p) => message.reply(p);

        if (sub === 'list') return listAll(reply, guildId);
        if (sub === 'my')   return listMine(reply, message.author.id, guildId);
        if (sub === 'sell-item' || sub === 'sellitem') {
            const itemId = (args[1] || '').toLowerCase();
            const price  = parseInt(args[2], 10);
            const qty    = parseInt(args[3], 10) || 1;
            return sellItem(reply, message.author.id, message.author.username, itemId, price, qty, guildId);
        }
        if (sub === 'sell-pet' || sub === 'sellpet') {
            const petId = args[1] || '';
            const price = parseInt(args[2], 10);
            return sellPet(reply, message.author.id, message.author.username, petId, price, guildId);
        }
        if (sub === 'buy') {
            const id = parseInt(args[1], 10);
            return buy(reply, message.author.id, message.author.username, id, guildId);
        }
        if (sub === 'cancel') {
            const id = parseInt(args[1], 10);
            return cancel(reply, message.author.id, id, guildId);
        }

        const c = createContainer(0xED4245);
        addTextDisplay(c, '<:Cancel:1521227723916181644> Unknown subcommand. Try `list`, `my`, `sell-item`, `sell-pet`, `buy`, `cancel`.');
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    },
};
