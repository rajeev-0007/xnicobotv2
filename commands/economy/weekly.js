'use strict';

const { MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { getEconomySettings, rollReward, formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { applyIncomeTax, formatTaxFootnote } = require('../../utils/taxHelper');

const COOLDOWN = 7 * 24 * 60 * 60 * 1000;

function buildCooldownBar(elapsed, total, length = 20) {
    const progress = Math.min(Math.floor((elapsed / total) * length), length);
    return '█'.repeat(progress) + '░'.repeat(length - progress);
}

async function handleWeekly(reply, userId, guildId) {
    const cfg = getEconomySettings(guildId);
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);
    userData.bonuses ||= { work: 0, daily: 0, gamble: 0, global: 0 };

    const now = Date.now();
    const elapsed = now - (userData.lastWeekly || 0);

    if (elapsed < COOLDOWN) {
      const left = COOLDOWN - elapsed;
      const pct = Math.round((elapsed / COOLDOWN) * 100);
      const daysLeft = Math.floor(left / 86_400_000);
      const hoursLeft = Math.floor((left % 86_400_000) / 3_600_000);
      const minutesLeft = Math.floor((left % 3_600_000) / 60_000);

      let timeStr = '';
      if (daysLeft > 0) timeStr += `${daysLeft}d `;
      if (hoursLeft > 0) timeStr += `${hoursLeft}h `;
      timeStr += `${minutesLeft}m`;

      const container = createContainer(0xCAD7E6);
      addTextDisplay(container, [
          `# <:Alarm:1521227869047750689> Weekly Cooldown`,
          '',
          `You've already claimed this week's reward.`,
          '',
          `> \`${buildCooldownBar(elapsed, COOLDOWN)}\` ${pct}%`,
          '',
          `<:Clock:1521228110408847623> **Available in:** ${timeStr.trim()}`,
          `-# Weekly rewards reset every 7 days`,
      ].join('\n'));
      return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const streak = userData.dailyStreak || userData.streak || 0;
    const weeklyClaimCount = (userData.weeklyClaimCount || 0) + 1;
    userData.weeklyClaimCount = weeklyClaimCount;

    // Pull range from dashboard config (falls back to legacy 3000..6000)
    const baseReward = rollReward(cfg.weeklyMin, cfg.weeklyMax);
    const streakBonus = Math.floor(baseReward * Math.min(streak * 0.05, 1.0));
    const globalBonus = Math.floor(baseReward * (Number(userData.bonuses?.global) || 0));
    const weeklyMultiplier = Math.min(Math.floor(weeklyClaimCount / 4), 5);
    const loyaltyBonus = Math.floor(baseReward * (weeklyMultiplier * 0.01));
    const grossReward = baseReward + streakBonus + globalBonus + loyaltyBonus;
    const taxResult = applyIncomeTax(grossReward, userData);
    const totalReward = taxResult.net;

    userData.coins += totalReward;
    // Track lifetime earnings so /profile and /economystats stay in
    // sync with the rest of the economy commands.
    userData.totalEarned = (userData.totalEarned || 0) + totalReward;
    userData.lastWeekly = now;
    economyManager.addXP(economy, userId, 25);
    economyManager.saveEconomy(economy);

    const container = createContainer(0xCAD7E6);

    let rewardText = `# 🎁 Weekly Reward Claimed!\n\n`;
    rewardText += `### ${coinIcon(guildId)} Reward Breakdown\n`;
    rewardText += `> ${coinIcon(guildId)} **Base Reward:** ${formatCoinsAmount(baseReward, guildId)}\n`;
    if (streakBonus > 0) rewardText += `> <:Fire:1521227907647668374> **Streak Bonus** (${streak} days): +${formatCoins(streakBonus, guildId)}\n`;
    if (globalBonus > 0) rewardText += `> <:Crown:1521227739988889764> **Global Bonus:** +${formatCoins(globalBonus, guildId)}\n`;
    if (loyaltyBonus > 0) rewardText += `> <:Star:1521227981685526568> **Loyalty Bonus** (Week ${weeklyClaimCount}): +${formatCoins(loyaltyBonus, guildId)}\n`;

    addTextDisplay(container, rewardText);
    addSeparator(container, SeparatorSpacingSize.Small);

    const summaryLines = [
        `### <:transfer:1521228019824590948> Summary`,
        `> ${coinIcon(guildId)} **Total Received:** ${formatCoinsAmount(totalReward, guildId)}`,
        `> ${coinIcon(guildId)} **New Balance:** ${formatCoinsAmount(userData.coins, guildId)}`,
        `> <:Bookopen:1521227911137595605> **Weeks Claimed:** ${weeklyClaimCount}`,
    ];
    const taxLine = formatTaxFootnote(taxResult);
    if (taxLine) summaryLines.push('', taxLine);
    summaryLines.push('', `-# Come back next week for another reward!`);

    addTextDisplay(container, summaryLines.join('\n'));

    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
  data: new (require('discord.js').SlashCommandBuilder)()
    .setName('weekly')
    .setDescription('Claim your weekly reward'),
  prefix: 'weekly',
  aliases: ['weeklyreward'],
  category: 'economy',
  description: 'Claim your weekly reward',

  async executePrefix(message) {
    return handleWeekly(message.reply.bind(message), message.author.id, message.guild?.id);
  },

  async execute(interaction) {
    return handleWeekly(interaction.reply.bind(interaction), interaction.user.id, interaction.guild?.id);
  }
};
