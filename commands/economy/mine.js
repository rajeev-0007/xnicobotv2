'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { EMOJIS } = require('../../utils/economyEmojis');
const jsonStore = require('../../utils/jsonStore');
const { applyIncomeTax, formatTaxFootnote } = require('../../utils/taxHelper');

const COOLDOWN = 30 * 60 * 1000;
const cooldowns = new Map();

const ORE_TABLE = [
  { id: 'stone',       name: 'Stone',       emoji: '🪨', weight: 40, value: 5   },
  { id: 'iron_ore',    name: 'Iron Ore',    emoji: '⚙', weight: 30, value: 25  },
  { id: 'gold_ore',    name: 'Gold Ore',    emoji: '🟡', weight: 15, value: 75  },
  { id: 'diamond_ore', name: 'Diamond Ore', emoji: '<:Sketch:1521228025365004471>', weight: 10, value: 200 },
  { id: 'emerald_ore', name: 'Emerald Ore', emoji: '💚', weight: 5,  value: 500 },
];

function pickOre(boost = false) {
  let table = ORE_TABLE.map(o => ({ ...o }));
  if (boost) {
    table = table.map(o => ({ ...o, weight: o.id === 'stone' ? Math.max(5, o.weight - 10) : o.weight + 3 }));
  }
  const total = table.reduce((s, o) => s + o.weight, 0);
  let roll = Math.random() * total;
  for (const ore of table) {
    roll -= ore.weight;
    if (roll <= 0) return ore;
  }
  return table[0];
}

/**
 * Pickaxes are bought via /buy and live in the global inventory
 * jsonStore as `[{ id, boughtAt }, ...]` — NOT as the stat object on
 * userData.inventory like crafting materials. The previous version
 * read from userData.inventory and never matched anything, so paid
 * pickaxes did nothing. Falls back to userData.inventory for legacy
 * users who somehow still have them recorded there.
 */
function getPickaxeBonus(userId, userData) {
  const owns = (id) => {
    try {
      const inv = jsonStore.has('inventory') ? jsonStore.read('inventory') : {};
      const slots = Array.isArray(inv?.[userId]) ? inv[userId] : [];
      if (slots.some(it => it && it.id === id)) return true;
    } catch { /* fall through */ }
    const legacy = userData.inventory;
    return !!(legacy && typeof legacy === 'object' && !Array.isArray(legacy) && (legacy[id] || 0) > 0);
  };

  if (owns('diamond_pickaxe')) return { name: 'Diamond Pickaxe', bonus: 3, emoji: '<:Sketch:1521228025365004471>' };
  if (owns('gold_pickaxe'))    return { name: 'Gold Pickaxe',    bonus: 2, emoji: '<:Money:1521228266957045900>' };
  if (owns('iron_pickaxe'))    return { name: 'Iron Pickaxe',    bonus: 1, emoji: '⛏' };
  return null;
}

async function handleMine(reply, userId, guildId) {
  const now = Date.now();
  const lastUsed = cooldowns.get(userId) || 0;
  const remaining = COOLDOWN - (now - lastUsed);

  if (remaining > 0) {
    const secs = Math.ceil(remaining / 1000);
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    const timeStr = mins > 0 ? `${mins}m ${remSecs}s` : `${secs}s`;
    const c = createContainer(0xED4245);
    addTextDisplay(c, [
      `# ${EMOJIS.sandwatch} Mining Cooldown`,
      '',
      `${EMOJIS.alarm} You need to rest! Come back in **${timeStr}**.`,
      `-# Mining cooldown: 30 minutes`,
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  cooldowns.set(userId, now);

  const economy = economyManager.loadEconomy();
  const { userData } = economyManager.getUser(economy, userId);
  userData.boosts = userData.boosts || {};

  const pickaxe = getPickaxeBonus(userId, userData);
  // `use mining_boost` sets userData.boosts.miningBoost = true; we
  // consume it on the very next mine run for a single bonus ore +
  // a temporarily favoured ore distribution. This is the contract
  // documented in shopItems.js / use.js.
  const hasMiningBoost = !!userData.boosts.miningBoost;

  const count = 1 + (pickaxe?.bonus || 0) + (hasMiningBoost ? 1 : 0);
  const ores = [];
  let totalValue = 0;

  for (let i = 0; i < count; i++) {
    const ore = pickOre(hasMiningBoost);
    ores.push(ore);
    userData.oreInventory = userData.oreInventory || {};
    userData.oreInventory[ore.id] = (userData.oreInventory[ore.id] || 0) + 1;
    totalValue += ore.value;
  }

  // Single-use boost — clear after this run.
  if (hasMiningBoost) delete userData.boosts.miningBoost;

  userData.miningCount = (userData.miningCount || 0) + 1;
  // Wealth tax — applies once total wealth (wallet+bank) ≥ 100k.
  const taxResult = applyIncomeTax(totalValue, userData);
  const netValue = taxResult.net;
  userData.coins = (userData.coins || 0) + netValue;
  userData.totalEarned = (userData.totalEarned || 0) + netValue;

  economyManager.checkAllAchievements(economy, userId);
  economyManager.saveEconomy(economy);

  const oreLines = ores.map(o => `> ${o.emoji} **${o.name}** (+${formatCoins(o.value, guildId)})`).join('\n');
  const pickaxeLine = pickaxe ? `\n-# ${pickaxe.emoji} Using **${pickaxe.name}** — +${pickaxe.bonus} extra ore(s)` : '';
  const boostLine = hasMiningBoost ? `\n-# 🚀 **Mining Boost** consumed — bonus ore + better odds applied` : '';
  const taxLine = formatTaxFootnote(taxResult);
  const taxBlock = taxLine ? `\n${taxLine}` : '';

  const c = createContainer(0xCAD7E6);
  addTextDisplay(c, [
    `# ⛏️ Mining Result`,
    '',
    oreLines,
    '',
    `${EMOJIS.sketch} **Earned:** +${formatCoinsAmount(netValue, guildId)}`,
    `💼 **Total mines:** ${formatNumber(userData.miningCount)}`,
    `${coinIcon(guildId)} **Wallet:** ${formatCoinsAmount(userData.coins, guildId)}`,
    `${pickaxeLine}${boostLine}${taxBlock}`,
    `-# Cooldown: 30 minutes`,
  ].join('\n'));

  return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mine')
    .setDescription('Mine for ores and earn coins — upgrade pickaxes for better yields'),
  prefix: 'mine',
  aliases: ['dig'],
  category: 'economy',
  description: 'Mine for ores and earn coins',
  usage: 'mine',

  async executePrefix(message) {
    return handleMine(message.reply.bind(message), message.author.id, message.guild?.id);
  },

  async execute(interaction) {
    await interaction.deferReply();
    return handleMine(interaction.editReply.bind(interaction), interaction.user.id, interaction.guild?.id);
  },
};
