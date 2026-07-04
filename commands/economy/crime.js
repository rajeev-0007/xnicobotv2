'use strict';

const { MessageFlags } = require('discord.js');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { applyIncomeTax, formatTaxFootnote } = require('../../utils/taxHelper');

const CRIMES = [
  { name: 'Pickpocketing', emoji: '🤏', successRate: 0.55, minReward: 200, maxReward: 800, minFine: 100, maxFine: 400 },
  { name: 'Car Theft', emoji: '🚗', successRate: 0.40, minReward: 500, maxReward: 2000, minFine: 300, maxFine: 1000 },
  { name: 'Bank Heist', emoji: '<:Bank:1521228286813012169>', successRate: 0.25, minReward: 2000, maxReward: 8000, minFine: 1000, maxFine: 3000 },
  { name: 'Jewelry Robbery', emoji: '💍', successRate: 0.35, minReward: 1000, maxReward: 5000, minFine: 500, maxFine: 2000 },
  { name: 'Hacking', emoji: '💻', successRate: 0.45, minReward: 400, maxReward: 1500, minFine: 200, maxFine: 800 },
  { name: 'Art Forgery', emoji: '<:Palette:1521227950601539755>', successRate: 0.50, minReward: 300, maxReward: 1200, minFine: 150, maxFine: 600 },
  { name: 'Drug Deal', emoji: '💊', successRate: 0.30, minReward: 1500, maxReward: 6000, minFine: 800, maxFine: 2500 },
  { name: 'Counterfeiting', emoji: '<:Money:1521228266957045900>', successRate: 0.42, minReward: 600, maxReward: 2500, minFine: 300, maxFine: 1200 },
];

const SUCCESS_MESSAGES = [
  'You pulled it off flawlessly!',
  'Nobody saw a thing. Clean getaway!',
  'You blended right in. Masterful.',
  'The perfect crime. Well done.',
  'Security never stood a chance.',
];

const FAIL_MESSAGES = [
  'The cops caught you red-handed!',
  'An alarm went off. Busted!',
  'A witness ratted you out.',
  'You tripped and got caught.',
  'Security cameras everywhere...',
];

const COOLDOWN = 2 * 60 * 1000;
const cooldowns = new Map();

async function handleCrime(reply, userId, guildId) {
  const now = Date.now();

  if (cooldowns.get(userId) > now) {
    const left = Math.ceil((cooldowns.get(userId) - now) / 1000);
    const c = createContainer(0xCAD7E6);
    addTextDisplay(c, `<:Clock:1521228110408847623> Laying low... try again in **${left}s**`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }
  cooldowns.set(userId, now + COOLDOWN);

  const economy = economyManager.loadEconomy();
  const { userData } = economyManager.getUser(economy, userId);

  const crime = CRIMES[Math.floor(Math.random() * CRIMES.length)];
  const success = Math.random() < crime.successRate;

  let resultText;

  if (success) {
    const grossReward = Math.floor(Math.random() * (crime.maxReward - crime.minReward + 1)) + crime.minReward;
    // Wealth tax — applies once total wealth (wallet+bank) ≥ 100k.
    const taxResult = applyIncomeTax(grossReward, userData);
    const reward = taxResult.net;

    userData.coins += reward;
    // Lifetime earnings tracking — was missing here so /economystats
    // under-reported total earned for users who grind crimes.
    userData.totalEarned = (userData.totalEarned || 0) + reward;
    userData.crimeCount = (userData.crimeCount || 0) + 1;

    const msg = SUCCESS_MESSAGES[Math.floor(Math.random() * SUCCESS_MESSAGES.length)];

    const successLines = [
      `# ${crime.emoji} ${crime.name}`,
      '',
      `<:Checkedbox:1521227734943269077> **SUCCESS!**`,
      `> ${msg}`,
      '',
      `${coinIcon(guildId)} **Reward:** +${formatCoinsAmount(reward, guildId)}`,
      `💼 **Balance:** ${formatCoins(userData.coins, guildId)}`,
      `<:Invoice:1521227903956811836> **Crimes Committed:** ${userData.crimeCount}`,
    ];
    const taxLine = formatTaxFootnote(taxResult);
    if (taxLine) successLines.push('', taxLine);
    successLines.push('', `-# Cooldown: 2 minutes`);

    resultText = successLines.join('\n');
  } else {
    const fine = Math.floor(Math.random() * (crime.maxFine - crime.minFine + 1)) + crime.minFine;
    userData.coins = Math.max(0, userData.coins - fine);

    const msg = FAIL_MESSAGES[Math.floor(Math.random() * FAIL_MESSAGES.length)];

    resultText = [
      `# ${crime.emoji} ${crime.name}`,
      '',
      `<:Cancel:1521227723916181644> **BUSTED!**`,
      `> ${msg}`,
      '',
      `${coinIcon(guildId)} **Fine:** -${formatCoinsAmount(fine, guildId)}`,
      `💼 **Balance:** ${formatCoins(userData.coins, guildId)}`,
      '',
      `-# Cooldown: 2 minutes`,
    ].join('\n');
  }

  if ((userData.crimeCount || 0) >= 50) economyManager.checkAchievement(economy, userId, 'criminal');
  economyManager.addXP(economy, userId, success ? 8 : 2);
  economyManager.saveEconomy(economy);

  const container = createContainer(success ? 0xCAD7E6 : 0xED4245);
  addTextDisplay(container, resultText);
  return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
  data: new (require('discord.js').SlashCommandBuilder)()
    .setName('crime')
    .setDescription('Commit a crime for coins (risky!)'),
  prefix: 'crime',
  aliases: [],
  category: 'economy',
  description: 'Commit a crime for coins (risky)',

  async executePrefix(message) {
    return handleCrime(message.reply.bind(message), message.author.id, message.guild?.id);
  },

  async execute(interaction) {
    return handleCrime(interaction.reply.bind(interaction), interaction.user.id, interaction.guild?.id);
  }
};
