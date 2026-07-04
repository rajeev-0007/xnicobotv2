'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay, addSeparator, formatDuration, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const { buildPermissionDenied, buildInvalidUsage, buildErrorResponse, buildModerationResponse } = require('../../utils/responseBuilder');
const jsonStore = require('../../utils/jsonStore');

/* ═══════════════════ DATA HELPERS ═══════════════════ */

function load(storeName) {
  return jsonStore.read(storeName);
}
function save(storeName, d) { jsonStore.write(storeName, d); }

/* ═══════════════════ DEFAULT THRESHOLDS ═══════════════════ */

const DEFAULT_THRESHOLDS = [
  { warns: 1, action: 'none',    duration: null, label: 'Warning only'          },
  { warns: 3, action: 'timeout', duration: 300,  label: 'Timeout 5 minutes'     },
  { warns: 4, action: 'timeout', duration: 3600, label: 'Timeout 1 hour'        },
  { warns: 5, action: 'kick',    duration: null, label: 'Kick from server'      },
  { warns: 7, action: 'ban',     duration: null, label: 'Permanent ban'         },
];

function getConfig(guildId) {
  const cfg = load('warn-config');
  return cfg[guildId]?.thresholds || DEFAULT_THRESHOLDS;
}

function getThreshold(thresholds, warnCount) {
  let matched = null;
  for (const t of thresholds) {
    if (warnCount >= t.warns) matched = t;
  }
  return matched;
}

/* ═══════════════════ ADD MODLOG ═══════════════════ */

function addModlog(guildId, userId, action, moderator, reason) {
  const modlogs = load('modlogs');
  modlogs[guildId] ||= {};
  modlogs[guildId][userId] ||= [];
  modlogs[guildId][userId].push({
    action,
    userId,
    moderator,
    reason,
    timestamp: Date.now() });
  save('modlogs', modlogs);
}

/* ═══════════════════ EXECUTE PUNISHMENT ═══════════════════ */

async function executePunishment(member, threshold, guild, moderator, reason) {
  if (!threshold || threshold.action === 'none') return null;

  try {
    switch (threshold.action) {
      case 'timeout': {
        const ms = (threshold.duration || 300) * 1000;
        await member.timeout(ms, `${reason} | Auto-punishment at ${threshold.warns} warns by ${moderator.username}`);
        return `<:Alarm:1521227869047750689> **Timed out** for **${formatDuration(ms)}**`;
      }
      case 'kick': {
        await member.send(`You have been kicked from **${guild.name}** — ${reason} (${threshold.warns} warnings reached).`).catch(() => {});
        await member.kick(`${reason} | Auto-punishment at ${threshold.warns} warns by ${moderator.username}`);
        addModlog(guild.id, member.id, 'Auto-Kick (Warn)', moderator.username, `${reason} — reached ${threshold.warns} warnings`);
        return `<:Userblock:1521227822641975366> **Kicked** from the server`;
      }
      case 'ban': {
        await member.send(`You have been banned from **${guild.name}** — ${reason} (${threshold.warns} warnings reached).`).catch(() => {});
        await member.ban({ reason: `${reason} | Auto-punishment at ${threshold.warns} warns by ${moderator.username}`, deleteMessageSeconds: 0 });
        addModlog(guild.id, member.id, 'Auto-Ban (Warn)', moderator.username, `${reason} — reached ${threshold.warns} warnings`);
        return `<:banhammer:1521227777083314529> **Banned** from the server`;
      }
      default:
        return null;
    }
  } catch (err) {
    return `<:Infotriangle:1521227710381428926> Auto-punishment failed: ${err.message}`;
  }
}

/* ═══════════════════ BUILD WARN RESPONSE ═══════════════════ */

function buildWarnContainer(memberUser, memberId, moderator, reason, warnCount, punishmentResult, thresholds) {
  const container = createContainer(0xCAD7E6);

  let mainText = [
    `# <:Infotriangle:1521227710381428926> Member Warned`,
    '',
    `**Target:** ${memberUser.username} (${memberId})`,
    `**Moderator:** ${moderator}`,
    `**Reason:** ${reason}`,
    `**Warning Count:** ${warnCount}`,
  ].join('\n');

  if (punishmentResult) {
    mainText += `\n\n### <:Lightningalt:1521227851796447472> Auto-Punishment\n${punishmentResult}`;
  }

  addTextDisplay(container, mainText);
  addSeparator(container, SeparatorSpacingSize.Small);

  const ladderLines = thresholds.map(t => {
    const active = warnCount >= t.warns;
    const current = warnCount === t.warns;
    const marker = current ? ' <:Caretright:1521227704953864202>' : '';
    const icon = active ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>';
    return `${icon} **${t.warns}** warn${t.warns > 1 ? 's' : ''} → ${t.label}${marker}`;
  });
  addTextDisplay(container, `### <:Document:1521227875016114266> Punishment Ladder\n${ladderLines.join('\n')}`);
  addSeparator(container, SeparatorSpacingSize.Small);

  return container;
}

/* ═══════════════════ COMMAND ═══════════════════ */

module.exports = {
  data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a member — progressive punishments apply automatically')
      .addUserOption(option =>
          option.setName('user')
              .setDescription('The user to warn')
              .setRequired(true))
      .addStringOption(option =>
          option.setName('reason')
              .setDescription('Reason for the warning')
              .setRequired(false))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  prefix: 'warn',
  description: 'Warn a member — progressive punishments apply automatically',
  usage: 'warn <@user> [reason]',
  category: 'admin',
  aliases: ['warning'],

  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';

    let member;
    try {
      member = await interaction.guild.members.fetch(user.id);
    } catch (e) {
      const container = buildErrorResponse('User Not Found', 'Could not find that user in this server.');
      return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    if (user.id === interaction.user.id) {
      const container = buildErrorResponse('Cannot Warn Yourself', 'You cannot warn yourself.');
      return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }
    if (user.id === interaction.guild.ownerId) {
      const container = buildErrorResponse('Cannot Warn Owner', 'You cannot warn the server owner.');
      return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }
    if (user.id === interaction.client.user.id) {
      const container = buildErrorResponse('Cannot Warn Me', 'You cannot warn me.');
      return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }

    try {
      const warnings = load('warnings');
      warnings[interaction.guild.id] ||= {};
      warnings[interaction.guild.id][member.id] ||= [];
      warnings[interaction.guild.id][member.id].push({
        moderator: interaction.user.id,
        reason,
        timestamp: Date.now() });
      save('warnings', warnings);

      const warnCount = warnings[interaction.guild.id][member.id].length;

      addModlog(interaction.guild.id, member.id, 'Warn', interaction.user.username, reason);

      const thresholds = getConfig(interaction.guild.id);
      const threshold = getThreshold(thresholds, warnCount);

      let punishmentResult = null;
      if (threshold && threshold.action !== 'none') {
        punishmentResult = await executePunishment(member, threshold, interaction.guild, interaction.user, reason);
      }

      const dmLines = [
        `<:Infotriangle:1521227710381428926> You have been warned in **${interaction.guild.name}**`,
        `**Reason:** ${reason}`,
        `**Warnings:** ${warnCount}`,
      ];
      if (punishmentResult) dmLines.push(`**Action:** ${punishmentResult.replace(/\*\*/g, '')}`);
      member.send(dmLines.join('\n')).catch(() => {});

      const container = buildWarnContainer(member.user, member.id, interaction.user, reason, warnCount, punishmentResult, thresholds);

      return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
      console.error('Warn Error:', error);
      const container = buildErrorResponse(
        'Warn Failed',
        'Failed to warn the user.',
        `Error: ${error.message}`
      );
      return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }
  },

  async executePrefix(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      const container = buildPermissionDenied('Moderate Members');
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const member = message.mentions.members.first();
    if (!member) {
      const container = buildInvalidUsage(
        'warn',
        '-warn @user [reason]',
        ['-warn @User Spamming', '-warn @Troll Breaking rules']
      );
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (member.id === message.author.id) {
      const container = buildErrorResponse('Cannot Warn Yourself', 'You cannot warn yourself.');
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    if (member.id === message.guild.ownerId) {
      const container = buildErrorResponse('Cannot Warn Owner', 'You cannot warn the server owner.');
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    if (member.id === message.client.user.id) {
      const container = buildErrorResponse('Cannot Warn Me', 'You cannot warn the bot.');
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const reason = args.slice(1).join(' ') || 'No reason provided';

    try {
      const warnings = load('warnings');
      warnings[message.guild.id] ||= {};
      warnings[message.guild.id][member.id] ||= [];
      warnings[message.guild.id][member.id].push({
        moderator: message.author.id,
        reason,
        timestamp: Date.now() });
      save('warnings', warnings);

      const warnCount = warnings[message.guild.id][member.id].length;

      addModlog(message.guild.id, member.id, 'Warn', message.author.username, reason);

      const thresholds = getConfig(message.guild.id);
      const threshold = getThreshold(thresholds, warnCount);

      let punishmentResult = null;
      if (threshold && threshold.action !== 'none') {
        punishmentResult = await executePunishment(member, threshold, message.guild, message.author, reason);
      }

      const dmLines = [
        `<:Infotriangle:1521227710381428926> You have been warned in **${message.guild.name}**`,
        `**Reason:** ${reason}`,
        `**Warnings:** ${warnCount}`,
      ];
      if (punishmentResult) dmLines.push(`**Action:** ${punishmentResult.replace(/\*\*/g, '')}`);
      member.send(dmLines.join('\n')).catch(() => {});

      const container = buildWarnContainer(member.user, member.id, message.author, reason, warnCount, punishmentResult, thresholds);

      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } catch (error) {
      console.error('Warn Error:', error);
      const container = buildErrorResponse(
        'Warn Failed',
        'Failed to warn the user.',
        `Error: ${error.message}`
      );
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
  } };
