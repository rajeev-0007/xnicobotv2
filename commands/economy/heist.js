'use strict';

const { SlashCommandBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } = require('discord.js');
const { formatCoins, formatCoinsShort, coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { EMOJIS } = require('../../utils/economyEmojis');
const { applyIncomeTax, formatTaxFootnote } = require('../../utils/taxHelper');

const COOLDOWN = 5 * 60 * 1000;
const JOIN_WINDOW = 30 * 1000;
const cooldowns = new Map();
const activeHeists = new Map();

const TARGETS = [
  { id: 'bank', name: 'Bank Job', emoji: '<:Bank:1521228286813012169>', baseSuccessRate: 0.55, rewardBase: [1000, 5000], riskFine: 0.10 },
  { id: 'museum', name: 'Museum Heist', emoji: '🏛', baseSuccessRate: 0.45, rewardBase: [3000, 8000], riskFine: 0.12 },
  { id: 'casino', name: 'Casino Robbery', emoji: '🎰', baseSuccessRate: 0.35, rewardBase: [5000, 15000], riskFine: 0.15 },
  { id: 'vault', name: 'Royal Vault', emoji: '👑', baseSuccessRate: 0.25, rewardBase: [10000, 30000], riskFine: 0.20 },
];

const SUCCESS_LINES = [
  'Your crew pulls it off flawlessly!',
  'In and out — not a single alarm triggered.',
  'A perfect score. The getaway was clean.',
  'They\'ll be talking about this one for years.',
];
const FAIL_LINES = [
  'A silent alarm gives you away.',
  'Your lookout spots the police too late.',
  'The vault door is thicker than expected.',
  'Security was upgraded last night.',
];

function buildLobbyEmbed(target, leader, members, secondsLeft) {
  // Leader is always part of the heist; surface that in the crew list
  // so the count matches what `runHeist` actually uses.
  const totalCrew = members.length + 1;
  const memberList = [
    `> 🧑 ${leader.username} *(leader)*`,
    ...members.map(m => `> 🧑 ${m.username}`),
  ].join('\n');
  const c = createContainer(0xCAD7E6);
  addTextDisplay(c, [
    `# ${target.emoji} Heist Planning — ${target.name}`,
    '',
    `${EMOJIS.user} **Leader:** ${leader.username}`,
    `👥 **Crew (${totalCrew}):**`,
    memberList,
    '',
    `${EMOJIS.sandwatch} Heist launches in **${Math.max(0, secondsLeft)}s** — click below to join!`,
    `-# Success rate improves with more crew members.`,
  ].join('\n'));
  return c;
}

async function runHeist(msg, target, leader, members, interaction) {
  const guildId = interaction?.guild?.id;
  // Deduplicate by user id — defensive guard against any caller that
  // accidentally passes the leader inside `members` as well as the
  // `leader` arg (would otherwise cause double-payouts and double
  // heistCount on a single user).
  const seen = new Set();
  const allParticipants = [leader, ...members].filter(p => {
    if (!p?.id || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
  const crewBonus = Math.min((allParticipants.length - 1) * 0.08, 0.32);
  const successRate = Math.min(target.baseSuccessRate + crewBonus, 0.90);
  const success = Math.random() < successRate;

  const economy = economyManager.loadEconomy();

  if (success) {
    const totalReward = Math.floor(Math.random() * (target.rewardBase[1] - target.rewardBase[0] + 1)) + target.rewardBase[0];
    const share = Math.floor(totalReward / allParticipants.length);
    const shareLines = [];

    for (const p of allParticipants) {
      const { userData } = economyManager.getUser(economy, p.id);
      // Wealth tax is applied per-participant since each has their
      // own balance — keeps the math fair (a rich player's share is
      // taxed even when teamed with a poor one).
      const taxResult = applyIncomeTax(share, userData);
      const netShare = taxResult.net;
      userData.coins = (userData.coins || 0) + netShare;
      userData.totalEarned = (userData.totalEarned || 0) + netShare;
      userData.heistCount = (userData.heistCount || 0) + 1;
      economyManager.checkAllAchievements(economy, p.id);
      const taxNote = taxResult.taxed ? `  *(${Math.round(taxResult.rate * 100)}% tax)*` : '';
      shareLines.push(`> ${p.username} → **+${formatCoins(netShare, guildId)}**${taxNote}`);
    }

    economyManager.saveEconomy(economy);

    const flavor = SUCCESS_LINES[Math.floor(Math.random() * SUCCESS_LINES.length)];
    const c = createContainer(0xCAD7E6);
    addTextDisplay(c, [
      `# ${target.emoji} Heist Success!`,
      `## ${target.name}`,
      '',
      `<:Checkedbox:1521227734943269077> *${flavor}*`,
      '',
      `${coinIcon(guildId)} **Total stolen:** ${formatCoinsAmount(totalReward, guildId)}`,
      `👥 **Split between ${allParticipants.length} crew member(s):**`,
      ...shareLines,
      '',
      `-# Cooldown: 5 minutes`,
    ].join('\n'));

    if (msg.edit) return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
    return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });

  } else {
    const fineLines = [];
    for (const p of allParticipants) {
      const { userData } = economyManager.getUser(economy, p.id);
      const before = Math.max(0, userData.coins || 0);
      const fine = Math.max(0, Math.floor(before * target.riskFine));
      userData.coins = Math.max(0, before - fine);
      fineLines.push(
        fine > 0
          ? `> ${p.username} → **-${formatCoins(fine, guildId)}**`
          : `> ${p.username} → *(no coins to lose)*`
      );
    }
    economyManager.saveEconomy(economy);

    const flavor = FAIL_LINES[Math.floor(Math.random() * FAIL_LINES.length)];
    const c = createContainer(0xED4245);
    addTextDisplay(c, [
      `# ${target.emoji} Heist Failed!`,
      `## ${target.name}`,
      '',
      `<:Cancel:1521227723916181644> *${flavor}*`,
      '',
      `${coinIcon(guildId)} **Fines paid:**`,
      ...fineLines,
      '',
      `-# Cooldown: 5 minutes`,
    ].join('\n'));

    if (msg.edit) return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
    return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }
}

async function startHeist(interaction, targetId) {
  const leaderId = interaction.user.id;

  const now = Date.now();
  const lastUsed = cooldowns.get(leaderId) || 0;
  if (now - lastUsed < COOLDOWN) {
    const secs = Math.ceil((COOLDOWN - (now - lastUsed)) / 1000);
    const mins = Math.floor(secs / 60);
    const c = createContainer(0xED4245);
    addTextDisplay(c, `# ${EMOJIS.sandwatch} Heist Cooldown\n\n${EMOJIS.alarm} Lay low for **${mins}m ${secs % 60}s** before your next heist.`);
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  if (activeHeists.has(leaderId)) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `${EMOJIS.cancel} You already have an active heist in progress!`);
    return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  const idx = targetId !== null ? targetId : Math.floor(Math.random() * TARGETS.length);
  const target = TARGETS[Math.min(Math.max(idx, 0), TARGETS.length - 1)];

  const members = [];

  let msg;
  try {
    await interaction.deferReply();
  } catch (err) {
    // Interaction expired or failed — don't burn the user's cooldown.
    return;
  }

  // Commit cooldown + active-heist registration only after the lobby
  // message is on its way. This avoids burning a 5-minute cooldown
  // when Discord rejects the deferReply (token expired, etc.).
  cooldowns.set(leaderId, now);
  activeHeists.set(leaderId, { target, members, leaderId });

  const joinBtn = new ButtonBuilder()
    .setCustomId(`heist_join_${leaderId}`)
    .setLabel('Join Heist')
    .setEmoji('🦹')
    .setStyle(ButtonStyle.Success);
  const startBtn = new ButtonBuilder()
    .setCustomId(`heist_start_${leaderId}`)
    .setLabel('Launch Now')
    .setEmoji('🚀')
    .setStyle(ButtonStyle.Danger);
  const row = new ActionRowBuilder().addComponents(joinBtn, startBtn);

  try {
    msg = await interaction.editReply({
      components: [buildLobbyEmbed(target, interaction.user, members, 30), row],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (err) {
    // Couldn't post the lobby — release the cooldown/state we just set.
    cooldowns.delete(leaderId);
    activeHeists.delete(leaderId);
    return;
  }

  let secondsLeft = 30;
  let finished = false;
  const collector = msg.createMessageComponentCollector({ time: JOIN_WINDOW });

  const ticker = setInterval(async () => {
    secondsLeft -= 5;
    if (secondsLeft <= 0) {
      if (finished) return;
      finished = true;
      clearInterval(ticker);
      try { collector.stop('timer_expired'); } catch { }
      const current = activeHeists.get(leaderId);
      const finalMembers = current ? current.members : members;
      activeHeists.delete(leaderId);
      return runHeist(msg, target, interaction.user, finalMembers, interaction);
    }
    const current = activeHeists.get(leaderId);
    const currentMembers = current ? current.members : members;
    await msg.edit({
      components: [buildLobbyEmbed(target, interaction.user, currentMembers, secondsLeft), row],
      flags: MessageFlags.IsComponentsV2,
    }).catch(() => { });
  }, 5000);

  collector.on('collect', async btn => {
    if (finished) return btn.deferUpdate().catch(() => { });

    if (btn.customId === `heist_join_${leaderId}`) {
      const joiner = btn.user;
      const heist = activeHeists.get(leaderId);
      if (!heist) return btn.deferUpdate().catch(() => { });

      if (joiner.id === leaderId || heist.members.find(m => m.id === joiner.id)) {
        return btn.reply({ content: 'You are already in this heist!', flags: MessageFlags.Ephemeral }).catch(() => { });
      }
      heist.members.push(joiner);
      await btn.update({
        components: [buildLobbyEmbed(target, interaction.user, heist.members, secondsLeft), row],
        flags: MessageFlags.IsComponentsV2,
      }).catch(() => { });

    } else if (btn.customId === `heist_start_${leaderId}`) {
      if (btn.user.id !== leaderId) {
        return btn.reply({ content: 'Only the leader can launch early!', flags: MessageFlags.Ephemeral }).catch(() => { });
      }
      if (finished) return btn.deferUpdate().catch(() => { });
      finished = true;
      clearInterval(ticker);
      collector.stop('early_launch');
      const heist = activeHeists.get(leaderId);
      activeHeists.delete(leaderId);
      await btn.deferUpdate().catch(() => { });
      return runHeist(msg, target, interaction.user, heist ? heist.members : members, interaction);
    }
  });

  collector.on('end', () => {
    clearInterval(ticker);
    activeHeists.delete(leaderId);
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('heist')
    .setDescription('Plan a group heist — others can join within 30 seconds before it launches')
    .addIntegerOption(o => o.setName('target').setDescription('1=Bank, 2=Museum, 3=Casino, 4=Royal Vault (random if omitted)').setRequired(false).setMinValue(1).setMaxValue(4)),
  prefix: 'heist',
  aliases: ['robbery'],
  category: 'economy',
  description: 'Plan a group heist with a 30-second join window',
  usage: 'heist [1-4]',

  async executePrefix(message, args) {
    const idx = args[0] ? parseInt(args[0]) - 1 : null;
    const fakeInteraction = {
      user: message.author,
      guild: message.guild,
      reply: message.reply.bind(message),
      deferReply: async () => { },
      editReply: message.reply.bind(message),
    };
    return startHeist(fakeInteraction, isNaN(idx) ? null : idx);
  },

  async execute(interaction) {
    const target = interaction.options.getInteger('target');
    return startHeist(interaction, target !== null ? target - 1 : null);
  },
};
