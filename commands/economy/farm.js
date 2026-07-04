'use strict';

/**
 * farm — Plant seeds, wait for them to grow, harvest for coins.
 *
 *   • Seeds are bought via /buy (stored in the global inventory
 *     jsonStore as `[{ id, boughtAt }, ...]`).
 *   • Crops are stored as a slot-keyed object on the economy user:
 *       userData.crops = {
 *         slot_<ts>_<rand>: { seedId, plantedAt, readyAt }
 *       }
 *   • A previous build defaulted `crops` to an empty array and the
 *     normalisation pass wiped the slots on every load — that bug
 *     is fixed in economyManager.js. This file assumes crops is an
 *     object and defends against a stale array shape just in case
 *     a snapshot from before the fix is loaded.
 *
 * The SEED_TABLE here MUST match the seed metadata advertised in
 * utils/shopItems.js (price, growTime, yield) — players read those
 * descriptions and complain when reality differs.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { formatCoins, formatCoinsShort, coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { EMOJIS } = require('../../utils/economyEmojis');
const { ITEMS } = require('../../utils/shopItems');
const jsonStore = require('../../utils/jsonStore');
const { applyIncomeTax, formatTaxFootnote } = require('../../utils/taxHelper');

const PLANT_COOLDOWN  = 60 * 1000;
const MAX_SLOTS       = 5;

/**
 * Single source of truth for seed metadata. Pulled from `shopItems`
 * so the shop description and the actual harvest payout cannot
 * drift apart. We re-export here as a flattened lookup so the
 * harvest path doesn't need to know about shop categories.
 */
const SEED_TABLE = (() => {
  const out = {};
  for (const [id, meta] of Object.entries(ITEMS)) {
    if (meta.category !== 'seeds') continue;
    out[id] = {
      name: meta.name.replace(/ Seed$/, ''),
      emoji: meta.emoji,
      yield: Array.isArray(meta.yield) && meta.yield.length === 2
        ? meta.yield
        : [50, 150], // last-resort fallback
      growTime: Number(meta.growTime) > 0
        ? Number(meta.growTime)
        : 5 * 60 * 1000,
    };
  }
  return out;
})();

const plantCooldowns = new Map();

/* ─────────────────────────────────────────────
   INVENTORY ADAPTERS
   ─────────────────────────────────────────────
 * Seeds are bought via /buy which stores items in the global
 * inventory jsonStore as `[{ id, boughtAt }, ...]`. The legacy
 * code read from `userData.inventory` (an object map) which never
 * matched, so seeds bought from the shop were invisible to /farm.
 * These helpers operate on the real store and silently fall back
 * to the legacy object-map representation if it's still around. */

function loadInventory() {
  if (!jsonStore.has('inventory')) return {};
  try { return jsonStore.read('inventory') || {}; } catch { return {}; }
}
function saveInventory(data) { jsonStore.write('inventory', data); }

function countSeed(userId, userData, seedId) {
  const inv = loadInventory();
  const slots = Array.isArray(inv[userId]) ? inv[userId] : [];
  const fromGlobal = slots.filter(it => it && it.id === seedId).length;
  const legacyMap  = userData.inventory;
  const fromLegacy = (legacyMap && typeof legacyMap === 'object' && !Array.isArray(legacyMap))
    ? Number(legacyMap[seedId] || 0) : 0;
  return fromGlobal + fromLegacy;
}

function consumeSeed(userId, userData, seedId) {
  // Prefer the global inventory (where /buy puts them).
  const inv = loadInventory();
  if (Array.isArray(inv[userId])) {
    const idx = inv[userId].findIndex(it => it && it.id === seedId);
    if (idx !== -1) {
      inv[userId].splice(idx, 1);
      saveInventory(inv);
      return true;
    }
  }
  // Fall back to the legacy object map on userData.
  const legacyMap = userData.inventory;
  if (legacyMap && typeof legacyMap === 'object' && !Array.isArray(legacyMap) && (legacyMap[seedId] || 0) > 0) {
    legacyMap[seedId]--;
    if (legacyMap[seedId] <= 0) delete legacyMap[seedId];
    return true;
  }
  return false;
}

async function handleFarm(reply, userId, subcommand, seedId, guildId) {
  const economy = economyManager.loadEconomy();
  const { userData } = economyManager.getUser(economy, userId);
  userData.boosts = userData.boosts || {};

  // Defensive: if the normaliser ever hands us an array shape (e.g.
  // a snapshot from before the schema fix landed), convert it to an
  // empty object. Anything saved as an array was definitely empty
  // (the old code never wrote slot keys to an array).
  if (Array.isArray(userData.crops) || typeof userData.crops !== 'object' || userData.crops === null) {
    userData.crops = {};
  }

  // Hydrate the in-memory plant cooldown from the persisted timestamp
  // so a bot restart doesn't grant infinite planting until the user
  // hits the cooldown again. We sync both directions: in-memory wins
  // when present (it's strictly more recent), persisted is the
  // fallback after a process restart.
  const persistedLast = Number(userData.lastPlant || 0);
  const memoryLast    = plantCooldowns.get(userId) || 0;
  if (persistedLast > memoryLast) plantCooldowns.set(userId, persistedLast);

  /* ── STATUS (default when no subcommand or `farm status`) ── */
  if (!subcommand || subcommand === 'status' || subcommand === 'view' || subcommand === 'list') {
    return showStatus(reply, userId, userData, guildId);
  }

  /* ── HARVEST ── */
  if (subcommand === 'harvest' || subcommand === 'h' || subcommand === 'collect') {
    return doHarvest(reply, userId, economy, userData, guildId);
  }

  /* ── PLANT ── */
  if (subcommand === 'plant' || subcommand === 'p' || subcommand === 'sow') {
    return doPlant(reply, userId, economy, userData, seedId, guildId);
  }

  // Unknown subcommand — show status so the user sees something useful.
  return showStatus(reply, userId, userData, guildId);
}

/**
 * Display crops as a numbered list (#1, #2, #3, …) instead of the
 * raw `slot_<ts>_<rand>` key — the keys are great for unique
 * identity but unreadable. The numbering follows insertion order.
 */
function slotLabels(cropEntries) {
    const labels = new Map();
    cropEntries.forEach(([slot], i) => labels.set(slot, `#${i + 1}`));
    return labels;
}

/**
 * Show the user's current farm: ready crops, pending crops with
 * countdowns, and a usage hint. Same rendering as the "no crops
 * ready" path of harvest, but doesn't error out.
 */
async function showStatus(reply, userId, userData, guildId) {
  const entries = Object.entries(userData.crops);

  if (entries.length === 0) {
    const c = createContainer(0xCAD7E6);
    const seedHints = Object.keys(SEED_TABLE).map(id => `\`${id}\``).join(', ');
    addTextDisplay(c, [
      `# 🌱 Your Farm`,
      '',
      `You have no crops planted.`,
      '',
      `Buy seeds with \`shop\` or \`buy <seed>\`, then plant them via \`farm plant <seed_id>\`.`,
      `-# Available seeds: ${seedHints}`,
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  const now = Date.now();
  const ready = entries.filter(([, c]) => now >= c.readyAt);
  const pending = entries.filter(([, c]) => now < c.readyAt);

  const lines = [
    `# 🌱 Your Farm`,
    `-# ${entries.length}/${MAX_SLOTS} slots used`,
  ];

  if (ready.length) {
    lines.push('', `**${EMOJIS.success || '<:Checkedbox:1521227734943269077>'} Ready to harvest (${ready.length})**`);
    const labels = slotLabels(entries);
    for (const [slot, crop] of ready) {
      const info = SEED_TABLE[crop.seedId] || { name: crop.seedId, emoji: '🌱' };
      lines.push(`> ${info.emoji} **${info.name}** · slot ${labels.get(slot)}`);
    }
  }
  if (pending.length) {
    lines.push('', `**${EMOJIS.sandwatch} Growing (${pending.length})**`);
    const labels = slotLabels(entries);
    for (const [slot, crop] of pending) {
      const info = SEED_TABLE[crop.seedId] || { name: crop.seedId, emoji: '🌱' };
      const ts = Math.floor(crop.readyAt / 1000);
      lines.push(`> ${info.emoji} **${info.name}** · slot ${labels.get(slot)} · ready <t:${ts}:R>`);
    }
  }

  lines.push('');
  if (ready.length) lines.push(`Use \`farm harvest\` to collect.`);
  else lines.push(`Come back when your crops are ready.`);

  const c = createContainer(0xCAD7E6);
  addTextDisplay(c, lines.join('\n'));
  return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

async function doHarvest(reply, userId, economy, userData, guildId) {
  const now = Date.now();
  const entries = Object.entries(userData.crops);
  const ready = entries.filter(([, crop]) => now >= crop.readyAt);

  if (ready.length === 0) {
    if (entries.length === 0) {
      const c = createContainer(0xCAD7E6);
      addTextDisplay(c, [
        `# 🌱 Farm`,
        '',
        `You have no crops planted! Buy seeds with \`shop\` and plant them with \`farm plant <seed_id>\`.`,
      ].join('\n'));
      return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    const earliest = Math.min(...entries.map(([, c]) => c.readyAt));
    const labels = slotLabels(entries);
    const c = createContainer(0xCAD7E6);
    addTextDisplay(c, [
      `# 🌱 Farm`,
      '',
      `${EMOJIS.sandwatch} No crops are ready yet! Earliest harvest **<t:${Math.floor(earliest / 1000)}:R>**.`,
      '',
      `**Planted crops:**`,
      ...entries.map(([slot, crop]) => {
        const info = SEED_TABLE[crop.seedId] || { name: crop.seedId, emoji: '🌱' };
        const ts = Math.floor(crop.readyAt / 1000);
        return `> ${info.emoji} **${info.name}** · slot ${labels.get(slot)} · ready <t:${ts}:R>`;
      }),
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // farm_boost — single-use +50% yield. Applied only if at least
  // one crop was harvested (so a no-op harvest doesn't burn it).
  const boostActive = !!userData.boosts.farmBoost;

  let totalEarned = 0;
  const harvestLines = [];

  for (const [slot, crop] of ready) {
    const info = SEED_TABLE[crop.seedId] || { name: crop.seedId, emoji: '🌾', yield: [50, 150] };
    let earned = Math.floor(Math.random() * (info.yield[1] - info.yield[0] + 1)) + info.yield[0];
    if (boostActive) earned = Math.floor(earned * 1.5);
    totalEarned += earned;
    harvestLines.push(`> ${info.emoji} **${info.name}** — +${formatCoins(earned, guildId)}`);
    delete userData.crops[slot];
  }

  if (boostActive) delete userData.boosts.farmBoost;

  // Wealth tax — applies once total wealth (wallet+bank) ≥ 100k.
  const taxResult = applyIncomeTax(totalEarned, userData);
  const netEarned = taxResult.net;

  userData.coins = (userData.coins || 0) + netEarned;
  userData.totalEarned = (userData.totalEarned || 0) + netEarned;
  userData.harvestCount = (userData.harvestCount || 0) + ready.length;
  userData.lastFarm = Date.now();

  economyManager.checkAllAchievements(economy, userId);
  economyManager.saveEconomy(economy);

  const remaining = Object.keys(userData.crops).length;
  const taxLine = formatTaxFootnote(taxResult);

  const c = createContainer(0xCAD7E6);
  addTextDisplay(c, [
    `# 🌾 Harvest Complete!`,
    '',
    ...harvestLines,
    '',
    boostActive ? `-# 🌻 **Farm Boost** consumed (+50% yield).` : null,
    `${EMOJIS.sketch} **Total Earned:** +${formatCoinsAmount(netEarned, guildId)}`,
    `${coinIcon(guildId)} **Wallet:** ${formatCoinsAmount(userData.coins, guildId)}`,
    taxLine || null,
    remaining > 0 ? `-# ${remaining} crop${remaining === 1 ? '' : 's'} still growing` : null,
  ].filter(Boolean).join('\n'));
  return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

async function doPlant(reply, userId, economy, userData, seedId, guildId) {
  const now = Date.now();
  const lastPlant = plantCooldowns.get(userId) || 0;
  const remaining = PLANT_COOLDOWN - (now - lastPlant);

  if (remaining > 0) {
    const secs = Math.ceil(remaining / 1000);
    const c = createContainer(0xED4245);
    addTextDisplay(c, `# ${EMOJIS.sandwatch} Planting Cooldown\n\n${EMOJIS.alarm} Wait **${secs}s** before planting again.`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  if (!seedId) {
    const lines = [
      `# 🌱 Farm — Plant a Seed`,
      '',
      `**Usage:** \`farm plant <seed_id>\``,
      '',
      `**Available seeds (buy from \`shop\`):**`,
    ];
    for (const [id, info] of Object.entries(SEED_TABLE)) {
      const mins = Math.round(info.growTime / 60000);
      lines.push(`> ${info.emoji} \`${id}\` — grows in **${mins} min** · payout **${formatCoins(info.yield[0], guildId)}–${formatCoins(info.yield[1], guildId)}**`);
    }
    const c = createContainer(0xCAD7E6);
    addTextDisplay(c, lines.join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  const seedInfo = SEED_TABLE[seedId];
  if (!seedInfo) {
    const valid = Object.keys(SEED_TABLE).map(id => `\`${id}\``).join(', ');
    const c = createContainer(0xED4245);
    addTextDisplay(c, `${EMOJIS.cancel} Unknown seed \`${seedId}\`. Try ${valid}.`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  if (countSeed(userId, userData, seedId) < 1) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `${EMOJIS.cancel} You don't have any **${seedInfo.name} Seeds**! Buy some with \`buy ${seedId}\`.`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  const slotCount = Object.keys(userData.crops).length;
  if (slotCount >= MAX_SLOTS) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `${EMOJIS.cancel} You have **${MAX_SLOTS} crops** planted — the max! Run \`farm harvest\` to clear ready slots first.`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  if (!consumeSeed(userId, userData, seedId)) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `${EMOJIS.cancel} Couldn't consume the seed — your inventory may be out of sync. Try again.`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // Stamp planting cooldown only after a successful seed consume so
  // a failed plant doesn't leave the user locked out for a minute.
  // We persist `userData.lastPlant` in addition to the in-memory map
  // so a bot restart can't reset the cooldown to 0.
  plantCooldowns.set(userId, now);
  userData.lastPlant = now;

  const slot = `slot_${Date.now()}_${Math.floor(Math.random() * 10_000)}`;
  userData.crops[slot] = { seedId, plantedAt: now, readyAt: now + seedInfo.growTime };

  economyManager.saveEconomy(economy);

  const slotIndex = Object.keys(userData.crops).indexOf(slot) + 1;
  const growMins = Math.round(seedInfo.growTime / 60000);
  const readyTs = Math.floor((now + seedInfo.growTime) / 1000);

  const c = createContainer(0xCAD7E6);
  addTextDisplay(c, [
    `# 🌱 Planted!`,
    '',
    `${seedInfo.emoji} **${seedInfo.name}** has been planted in slot **#${slotIndex}**.`,
    `> ⏳ Ready **<t:${readyTs}:R>** (~${growMins} min)`,
    `> ${coinIcon(guildId)} Expected payout: **${formatCoins(seedInfo.yield[0], guildId)}–${formatCoins(seedInfo.yield[1], guildId)}**`,
    '',
    `Use \`farm harvest\` to collect when it's ready.`,
    `-# Cooldown: 1 minute before next planting`,
  ].join('\n'));
  return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('farm')
    .setDescription('Plant seeds and harvest crops for coins')
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('View your planted crops and harvest readiness'))
    .addSubcommand(sub => sub
      .setName('plant')
      .setDescription('Plant a seed from your inventory')
      .addStringOption(o => o
        .setName('seed')
        .setDescription('Seed type to plant')
        .setRequired(true)
        .addChoices(
          ...Object.entries(SEED_TABLE).map(([id, info]) => ({
            name: `${info.emoji ? '' : ''}${info.name} (${Math.round(info.growTime / 60_000)}m)`,
            value: id,
          }))
        )))
    .addSubcommand(sub => sub
      .setName('harvest')
      .setDescription('Harvest your ready crops')),
  prefix: 'farm',
  aliases: ['farming', 'crops'],
  category: 'economy',
  description: 'Plant seeds, wait for them to grow, and harvest for coins',
  usage: 'farm <status|plant|harvest> [seed_id]',

  async executePrefix(message, args) {
    // Default to status when called without args. Avoid silently
    // assuming "harvest" — that surprised users who just typed
    // `farm` to peek at what they had planted.
    const sub = (args[0] || 'status').toLowerCase();
    const seedId = args[1]?.toLowerCase();
    return handleFarm(message.reply.bind(message), message.author.id, sub, seedId, message.guild?.id);
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const seed = sub === 'plant' ? interaction.options.getString('seed') : null;
    return handleFarm(
      (payload) => interaction.reply(payload),
      interaction.user.id,
      sub,
      seed,
      interaction.guild?.id,
    );
  },
};
