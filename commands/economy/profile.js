'use strict';

/**
 * profile — Render an economy profile card.
 *
 * Pulls fields directly off the economy user record so VIP, balances,
 * lifetime stats and achievements all show up regardless of which
 * sub-command last touched the user. Falls back to a Components V2
 * text card if the canvas pipeline throws (font load, network blip,
 * old data shape, etc.).
 *
 * Slash variant defers without the Components V2 flag — the canvas
 * response is an image attachment, so forcing CV2 on the deferred
 * token just made Discord reject the eventual `editReply` payload
 * silently and the user saw "this interaction failed".
 */

const { AttachmentBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const economyManager = require('../../utils/economyManager');
const { createEconomyProfileCard } = require('../../utils/economyCanvas');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const { getUserData: getMainUserData } = require('../../utils/dataManager');
const { coinIcon, formatCoins } = require('../../utils/currencyHelper');
const ph = require('../../utils/petHelpers');
const { resolveUser } = require('../../utils/resolveUser');

function loadPets() { return ph.loadPets(); }

/**
 * Compute the user's leaderboard rank by total wealth (wallet + bank).
 * The `jsonStore` cache key for the economy is shared across all users,
 * so we walk the live object once. Skip the synthetic `jackpot` key.
 */
function computeRank(economy, userId) {
  const ranks = Object.entries(economy)
    .filter(([k]) => k !== 'jackpot')
    .map(([id, d]) => ({
      id,
      total: (Number(d?.coins) || 0) + (Number(d?.bank) || 0),
    }))
    .sort((a, b) => b.total - a.total);
  const idx = ranks.findIndex(u => u.id === userId);
  return idx >= 0 ? idx + 1 : null;
}

/**
 * Map achievement IDs into the shape the canvas wants:
 *   { emoji, name, desc }
 * Unknown IDs fall back to a generic medal so the slot still renders.
 */
function mapAchievements(userData) {
  const list = Array.isArray(userData.achievements) ? userData.achievements : [];
  return list.map(id => {
    const ach = economyManager.ACHIEVEMENTS[id];
    return ach
      ? { id, emoji: ach.emoji, name: ach.name, desc: ach.desc || '' }
      : { id, emoji: '🏅', name: id, desc: '' };
  });
}

/**
 * Build the canvas-card payload from raw user/pets data. Kept as a
 * pure-data helper so both the slash and prefix paths share one code
 * path (and the fallback text card stays in sync with the canvas).
 */
async function buildProfileCardArgs(target, userData, economy) {
  const wallet = Number(userData.coins) || 0;
  const bank   = Number(userData.bank)  || 0;
  const total  = wallet + bank;
  const level  = userData.level || 1;
  const xp     = userData.xp    || 0;
  const xpNeeded = level * 150;

  const rank = computeRank(economy, target.id);

  const petsData = loadPets();
  const userPets = petsData[target.id]?.animals || [];

  // Build a friendly title line: VIP badge first, then any custom
  // title the user has set. The canvas shows this under the username
  // — keeping it concise so it fits the header without truncation.
  const titleParts = [];
  if (userData.vip) titleParts.push('VIP Member');
  if (userData.title) titleParts.push(userData.title);
  const titleLine = titleParts.join(' · ');

  // Try to honour the user's preferred font for profile/rank cards.
  let fontFamily = 'Inter';
  try {
    const main = await getMainUserData(target.id);
    fontFamily = main?.profile?.rankCard?.fontFamily
              || main?.profile?.profileCard?.fontFamily
              || 'Inter';
  } catch { /* fall back silently */ }

  return {
    username: target.username,
    avatarURL: target.displayAvatarURL({ extension: 'png', size: 256 }),
    tag: target.username,

    wallet, bank, total,
    level, xp, xpNeeded,
    streak: userData.streak || userData.dailyStreak || 0,
    rank,

    battlesWon: userData.battlesWon || 0,
    battlesLost: userData.battlesLost || 0,
    fishCaught: userData.fishCaught || 0,
    huntCount: userData.huntCount || 0,

    achievements: mapAchievements(userData),
    title: titleLine,
    vip: !!userData.vip,
    totalEarned: Number(userData.totalEarned) || 0,
    totalGambled: Number(userData.totalGambled) || 0,
    totalWon: Number(userData.totalWon) || 0,

    pets: userPets.slice(0, 10),
    fontFamily,
  };
}

/**
 * Fallback text card — renders when the canvas pipeline throws (font
 * registration failure, image load timeout, etc.). Mirrors what the
 * canvas would have shown so users never see an empty error.
 */
function buildFallbackCard(target, args, guildId) {
  const c = createContainer(args.vip ? 0xfbbf24 : 0x7c3aed);

  const headerLine = args.vip
    ? `# <:Crown:1521227739988889764> ${target.username}'s Economy Profile  \`VIP\``
    : `# <:Sketch:1521228025365004471> ${target.username}'s Economy Profile`;

  const lines = [headerLine];
  if (args.title) lines.push(`-# ${args.title}`);
  lines.push(
    '',
    `> ${coinIcon(guildId)} **Wallet:** ${formatCoins(args.wallet, guildId)}`,
    `> <:Invoice:1521227903956811836> **Bank:** ${formatCoins(args.bank, guildId)}`,
    `> <:Sketch:1521228025365004471> **Net Worth:** ${formatCoins(args.total, guildId)}`,
    '',
    `> <:Lightning:1521227915537285150> **Level:** ${args.level}  ·  ${args.xp.toLocaleString()}/${args.xpNeeded.toLocaleString()} XP`,
    `> <:Fire:1521227907647668374> **Streak:** ${args.streak} day${args.streak === 1 ? '' : 's'}`,
    `> <:Award:1521228119640375336> **Rank:** ${args.rank ? `#${args.rank}` : '—'}`,
    '',
    `> ⚔️ **Battles:** ${args.battlesWon}W / ${args.battlesLost}L`,
    `> 🎣 **Fish:** ${args.fishCaught.toLocaleString()}  ·  🏹 **Hunts:** ${args.huntCount.toLocaleString()}`,
  );
  if (args.achievements?.length) {
    lines.push(
      '',
      `**Achievements (${args.achievements.length}):** ` +
      args.achievements.slice(0, 8).map(a => `${a.emoji} ${a.name}`).join(' · ') +
      (args.achievements.length > 8 ? ` *+${args.achievements.length - 8} more*` : '')
    );
  }
  if (args.pets?.length) {
    lines.push(
      '',
      `**Pets (${args.pets.length}):** ` +
      args.pets.slice(0, 6).map(p => `${p.emoji || '🐾'} ${p.name} Lv.${p.level || 1}`).join(' · ') +
      (args.pets.length > 6 ? ` *+${args.pets.length - 6} more*` : '')
    );
  }

  addTextDisplay(c, lines.join('\n'));
  return c;
}

/**
 * Single source of truth for both prefix and slash. `reply` is a
 * function that accepts a Discord message payload and returns the
 * sent message — both paths build it slightly differently.
 */
async function renderProfile(target, guildId, reply) {
  const economy = economyManager.loadEconomy();
  const { userData, changed } = economyManager.getUser(economy, target.id);
  if (changed) economyManager.saveEconomy(economy);

  const args = await buildProfileCardArgs(target, userData, economy);

  try {
    const buffer = await createEconomyProfileCard(args);
    const attachment = new AttachmentBuilder(buffer, { name: 'profile.png' });
    return reply({ files: [attachment] });
  } catch (err) {
    console.error('[PROFILE] Canvas error:', err);
    const container = buildFallbackCard(target, args, guildId);
    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your economy profile card')
    .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(false)),
  prefix: 'profile',
  aliases: ['eprofile', 'ep', 'card', 'economyprofile'],
  category: 'economy',
  description: 'View your economy profile card',

  async executePrefix(message, args) {
    const target = (await resolveUser(message, args)) || message.author;
    return renderProfile(target, message.guild?.id, (payload) => message.reply(payload));
  },

  async execute(interaction) {
    // Defer WITHOUT IsComponentsV2 — the canvas response is an image
    // attachment, not a components-v2 payload. Forcing the flag here
    // made `editReply({ files })` get rejected by Discord with a
    // misleading "interaction failed" notice.
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply().catch(() => {});
    }
    const target = interaction.options?.getUser('user') || interaction.user;
    return renderProfile(target, interaction.guild?.id, (payload) => interaction.editReply(payload));
  },
};
