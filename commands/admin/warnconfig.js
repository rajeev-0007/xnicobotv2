'use strict';

const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay, addSeparator, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const { buildPermissionDenied, buildInvalidUsage, buildErrorResponse } = require('../../utils/responseBuilder');
const jsonStore = require('../../utils/jsonStore');


const VALID_ACTIONS = ['none', 'timeout', 'kick', 'ban'];
const ACTION_LABELS = {
  none:    '<:Checkedbox:1521227734943269077> Warning only',
  timeout: '<:Alarm:1521227869047750689> Timeout',
  kick:    '<:Userblock:1521227822641975366> Kick',
  ban:     '<:banhammer:1521227777083314529> Ban' };

const DEFAULT_THRESHOLDS = [
  { warns: 1, action: 'none',    duration: null, label: 'Warning only'      },
  { warns: 2, action: 'timeout', duration: 300,  label: 'Timeout 5 minutes' },
  { warns: 3, action: 'timeout', duration: 3600, label: 'Timeout 1 hour'    },
  { warns: 4, action: 'kick',    duration: null, label: 'Kick from server'  },
  { warns: 5, action: 'ban',     duration: null, label: 'Permanent ban'     },
];

function load(storeName) {
  return jsonStore.read(storeName);
}
function save(storeName, d) { jsonStore.write(storeName, d); }

function formatDurationShort(seconds) {
  if (!seconds) return '';
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function parseDurationToSeconds(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)s?$/i);
  if (!match) return null;
  const val = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith('s')) return val;
  if (unit.startsWith('m')) return val * 60;
  if (unit.startsWith('h')) return val * 3600;
  if (unit.startsWith('d')) return val * 86400;
  return null;
}

function buildLabelFromAction(action, duration) {
  if (action === 'none') return 'Warning only';
  if (action === 'kick') return 'Kick from server';
  if (action === 'ban') return 'Permanent ban';
  if (action === 'timeout') return `Timeout ${formatDurationShort(duration || 300)}`;
  return action;
}

module.exports = {
  prefix: 'warnconfig',
  description: 'Configure warning punishment thresholds for this server',
  usage: 'warnconfig [set <warns> <action> [duration]] | [reset] | [view]',
  category: 'admin',
  aliases: ['warnsetup', 'warn-config', 'warn-setup'],

  async executePrefix(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      const container = buildPermissionDenied('Manage Server');
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const sub = args[0]?.toLowerCase();

    /* ═══════════════════ VIEW ═══════════════════ */
    if (!sub || sub === 'view' || sub === 'list' || sub === 'show') {
      const cfg = load('warn-config');
      const thresholds = cfg[message.guild.id]?.thresholds || DEFAULT_THRESHOLDS;

      const container = createContainer(0xCAD7E6);
      addTextDisplay(container, `# <:Settings:1521227767780343879> Warning Configuration`);
      addSeparator(container, SeparatorSpacingSize.Small);

      const lines = thresholds.map(t => {
        const actionLabel = ACTION_LABELS[t.action] || t.action;
        const dur = t.action === 'timeout' && t.duration ? ` (${formatDurationShort(t.duration)})` : '';
        return `**${t.warns}** warn${t.warns > 1 ? 's' : ''} → ${actionLabel}${dur}`;
      });

      addTextDisplay(container, lines.join('\n'));
      addSeparator(container, SeparatorSpacingSize.Small);
      addTextDisplay(container, [
        `-# **Commands:**`,
        `-# \`warnconfig set <warns> <action> [duration]\` — Set a threshold`,
        `-# \`warnconfig remove <warns>\` — Remove a threshold`,
        `-# \`warnconfig reset\` — Reset to defaults`,
        `-# **Actions:** \`none\`, \`timeout\`, \`kick\`, \`ban\``,
        `-# **Duration (timeout only):** \`5m\`, \`1h\`, \`1d\``,
      ].join('\n'));
      addSeparator(container);

      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    /* ═══════════════════ RESET ═══════════════════ */
    if (sub === 'reset' || sub === 'default') {
      const cfg = load('warn-config');
      delete cfg[message.guild.id];
      save('warn-config', cfg);

      const container = createContainer(0xCAD7E6);
      addTextDisplay(container, `# <:Checkedbox:1521227734943269077> Config Reset\n\nWarning thresholds have been reset to defaults.`);
      addSeparator(container);
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    /* ═══════════════════ REMOVE ═══════════════════ */
    if (sub === 'remove' || sub === 'delete' || sub === 'del') {
      const warnNum = parseInt(args[1]);
      if (!warnNum || warnNum < 1) {
        const container = buildErrorResponse('Invalid Number', 'Provide the warn count threshold to remove.\n**Example:** `warnconfig remove 3`');
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      }

      const cfg = load('warn-config');
      cfg[message.guild.id] ||= { thresholds: [...DEFAULT_THRESHOLDS] };
      const before = cfg[message.guild.id].thresholds.length;
      cfg[message.guild.id].thresholds = cfg[message.guild.id].thresholds.filter(t => t.warns !== warnNum);

      if (cfg[message.guild.id].thresholds.length === before) {
        const container = buildErrorResponse('Not Found', `No threshold found for **${warnNum}** warns.`);
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      }

      save('warn-config', cfg);

      const container = createContainer(0xCAD7E6);
      addTextDisplay(container, `# <:Checkedbox:1521227734943269077> Threshold Removed\n\nRemoved punishment for **${warnNum}** warns.`);
      addSeparator(container);
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    /* ═══════════════════ SET ═══════════════════ */
    if (sub === 'set' || sub === 'add') {
      const warnNum = parseInt(args[1]);
      const action  = args[2]?.toLowerCase();
      const durArg  = args[3]?.toLowerCase();

      if (!warnNum || warnNum < 1 || warnNum > 20) {
        const container = buildErrorResponse('Invalid Warns', 'Warn count must be between **1** and **20**.\n**Usage:** `warnconfig set <warns> <action> [duration]`');
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      }

      if (!action || !VALID_ACTIONS.includes(action)) {
        const container = buildErrorResponse('Invalid Action', `Valid actions: ${VALID_ACTIONS.map(a => `\`${a}\``).join(', ')}\n**Usage:** \`warnconfig set ${warnNum} <action> [duration]\``);
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      }

      let duration = null;
      if (action === 'timeout') {
        duration = durArg ? parseDurationToSeconds(durArg) : 300;
        if (!duration || duration < 60 || duration > 2419200) {
          const container = buildErrorResponse('Invalid Duration', 'Timeout duration must be between **1m** and **28d**.\n**Example:** `warnconfig set 2 timeout 1h`');
          return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
      }

      const label = buildLabelFromAction(action, duration);

      const cfg = load('warn-config');
      cfg[message.guild.id] ||= { thresholds: [...DEFAULT_THRESHOLDS] };

      // Replace or add
      const existing = cfg[message.guild.id].thresholds.findIndex(t => t.warns === warnNum);
      const entry = { warns: warnNum, action, duration, label };

      if (existing >= 0) {
        cfg[message.guild.id].thresholds[existing] = entry;
      } else {
        cfg[message.guild.id].thresholds.push(entry);
      }

      // Sort by warns
      cfg[message.guild.id].thresholds.sort((a, b) => a.warns - b.warns);
      save('warn-config', cfg);

      const container = createContainer(0xCAD7E6);
      const durText = action === 'timeout' ? ` (${formatDurationShort(duration)})` : '';
      addTextDisplay(container, [
        `# <:Checkedbox:1521227734943269077> Threshold Updated`,
        '',
        `**${warnNum}** warn${warnNum > 1 ? 's' : ''} → ${ACTION_LABELS[action]}${durText}`,
        '',
        `-# Use \`warnconfig view\` to see all thresholds.`,
      ].join('\n'));
      addSeparator(container);

      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    /* ═══════════════════ UNKNOWN ═══════════════════ */
    const container = buildInvalidUsage(
      'warnconfig',
      '-warnconfig [view|set|remove|reset]',
      [
        '-warnconfig view',
        '-warnconfig set 2 timeout 10m',
        '-warnconfig set 3 kick',
        '-warnconfig remove 4',
        '-warnconfig reset',
      ]
    );
    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  } };
