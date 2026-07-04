'use strict';

const { MessageFlags } = require('discord.js');
const { formatCoins, formatCoinsShort } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const ph = require('../../utils/petHelpers');
const { applyIncomeTax, formatTaxFootnote } = require('../../utils/taxHelper');

const COOLDOWN = 30_000;
const cooldowns = new Map();

const animals = [
  { name: 'Mouse', emoji: '🐭', rarity: 'common', baseHp: 20, baseAtk: 5, value: 10, rate: 90 },
  { name: 'Wolf', emoji: '🐺', rarity: 'uncommon', baseHp: 50, baseAtk: 15, value: 60, rate: 55 },
  { name: 'Tiger', emoji: '🐯', rarity: 'rare', baseHp: 100, baseAtk: 40, value: 200, rate: 25 },
  { name: 'Dragon', emoji: '🐉', rarity: 'legendary', baseHp: 300, baseAtk: 100, value: 1000, rate: 5 }
];

async function handleHunt(reply, userId, guildId) {
  const now = Date.now();

  if (cooldowns.has(userId) && cooldowns.get(userId) > now) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `<:Cancel:1521227723916181644> Hunt cooldown: **${economyManager.formatTime(cooldowns.get(userId) - now)}**`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }
  cooldowns.set(userId, now + COOLDOWN);

  const pets = ph.loadPets();
  const economy = economyManager.loadEconomy();

  ph.ensureUser(pets, userId);
  const { userData } = economyManager.getUser(economy, userId);
  userData.boosts = userData.boosts || {};

  // Lucky charm — buys +15% loot quality on the next hunt or fish.
  // Stored as an expiry timestamp on userData.boosts.luckyCharm.
  // Consumed (regardless of outcome) so the next session is fresh.
  const luckyCharmActive = Number(userData.boosts.luckyCharm || 0) > now;

  // Skew the encounter table when the charm is up: shift weight from
  // "common" toward the higher-rarity tiers so legendary catches are
  // meaningfully more likely without being guaranteed.
  const tableForRoll = luckyCharmActive
    ? animals.map(a => ({
        ...a,
        rate: a.rarity === 'common' ? Math.max(20, a.rate - 30)
            : a.rarity === 'uncommon' ? a.rate + 10
            : a.rarity === 'rare'     ? a.rate + 8
            :                            a.rate + 4,
      }))
    : animals;

  const roll = Math.random() * 100;
  let animal;
  let cumulative = 0;
  const shuffled = [...tableForRoll].sort((a, b) => a.rate - b.rate);
  for (const a of shuffled) {
    cumulative += a.rate;
    if (roll <= cumulative) { animal = a; break; }
  }
  if (!animal) animal = tableForRoll[0];

  const caught = Math.random() * 100 <= animal.rate;

  if (caught) {
    pets[userId].animals.push({
      id: ph.nextId(animal.rarity, animal.name, pets[userId].animals),
      name: animal.name,
      emoji: animal.emoji,
      rarity: animal.rarity,
      level: 1,
      exp: 0,
      baseHp: animal.baseHp,
      baseAtk: animal.baseAtk,
      hp: animal.baseHp,
      maxHp: animal.baseHp,
      atk: animal.baseAtk,
      weapon: null,
    });
    ph.savePets(pets);

    const xpResult = economyManager.addXP(economy, userId, 10);
    userData.huntCount = (userData.huntCount || 0) + 1;
    if (luckyCharmActive) delete userData.boosts.luckyCharm;
    economyManager.saveEconomy(economy);

    const charmTag = luckyCharmActive ? `\n-# 🍀 **Lucky Charm** consumed (+15% loot quality applied).` : '';
    const container = createContainer(ph.RARITY_COLOR[animal.rarity] || 0xCAD7E6);
    addTextDisplay(container, [
      `# <:Checkedbox:1521227734943269077> Hunt — Caught!`,
      '',
      `You encountered **${animal.emoji} ${animal.name}** and caught it!`,
      `> Rarity: **${animal.rarity}** | HP: **${animal.baseHp}** | ATK: **${animal.baseAtk}**`,
      `> <:Fire:1521227907647668374> +10 XP${xpResult.leveledUp ? ` — **Level Up! Lv.${xpResult.newLevel}**` : ''}`,
      charmTag,
      '',
      `-# Use \`pets\` to manage your collection`,
    ].filter(Boolean).join('\n'));
    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  } else {
    // The charm boosts loot value too — pay extra coins on the
    // consolation prize so the user feels the effect.
    const grossValue = luckyCharmActive ? Math.floor(animal.value * 1.15) : animal.value;
    // Wealth tax — applies once total wealth (wallet+bank) ≥ 100k.
    const taxResult = applyIncomeTax(grossValue, userData);
    const charmedValue = taxResult.net;
    userData.coins += charmedValue;
    userData.totalEarned = (userData.totalEarned || 0) + charmedValue;
    userData.huntCount = (userData.huntCount || 0) + 1;
    if (luckyCharmActive) delete userData.boosts.luckyCharm;
    economyManager.addXP(economy, userId, 5);
    economyManager.saveEconomy(economy);

    const charmTag = luckyCharmActive ? `\n-# 🍀 **Lucky Charm** consumed (+15% reward applied).` : '';
    const taxLine = formatTaxFootnote(taxResult);
    const taxTag = taxLine ? `\n${taxLine}` : '';
    const container = createContainer(0xED4245);
    addTextDisplay(container, [
      `# <:Cancel:1521227723916181644> Hunt — Escaped!`,
      '',
      `You encountered **${animal.emoji} ${animal.name}** but it got away.`,
      `> Earned **${formatCoins(charmedValue, guildId)}** as consolation.`,
      `> <:Fire:1521227907647668374> +5 XP`,
      charmTag,
      taxTag,
      '',
      `-# Try hunting again in 30 seconds`,
    ].filter(Boolean).join('\n'));
    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }
}

module.exports = {
  data: new (require('discord.js').SlashCommandBuilder)()
    .setName('hunt')
    .setDescription('Hunt for wild animals — catch them as pets or earn coins'),
  prefix: 'hunt',
  aliases: ['catch'],
  category: 'economy',
  description: 'Hunt for wild animals — catch them as pets or earn coins',

  async executePrefix(message) {
    return handleHunt(message.reply.bind(message), message.author.id, message.guild?.id);
  },

  async execute(interaction) {
    return handleHunt(interaction.reply.bind(interaction), interaction.user.id, interaction.guild?.id);
  }
};
