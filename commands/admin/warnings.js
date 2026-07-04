'use strict';

const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay, addSeparator, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const { buildPermissionDenied, buildInvalidUsage } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const jsonStore = require('../../utils/jsonStore');


function load(storeName) {
  return jsonStore.read(storeName);
}

module.exports = {
  prefix: 'warnings',
  description: 'View warnings for a user',
  usage: 'warnings <@user>',
  category: 'admin',
  aliases: ['warns', 'infractions', 'warnlist'],

  async executePrefix(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      const container = buildPermissionDenied('Moderate Members');
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const user = message.mentions.users.first();
    if (!user) {
      const container = buildInvalidUsage(
        'warnings',
        '-warnings @user',
        ['-warnings @User']
      );
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const warnings = load('warnings');
    const userWarns = warnings[message.guild.id]?.[user.id] || [];

    if (userWarns.length === 0) {
      const container = createContainer(0xCAD7E6);
      addTextDisplay(container, `# <:Checkedbox:1521227734943269077> Clean Record\n\n**${user.username}** has no warnings in this server.`);
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // Build all warning lines (newest first)
    const allLines = [...userWarns].reverse().map((w, idx) => {
      const num = userWarns.length - idx;
      const ts = Math.floor(w.timestamp / 1000);
      return `**#${num}** — ${w.reason}\n-# By <@${w.moderator}> · <t:${ts}:R>`;
    });

    const result = paginate({
      header: `# <:Infotriangle:1521227710381428926> Warnings — ${user.username}\n-# ${userWarns.length} total warning${userWarns.length !== 1 ? 's' : ''}`,
      lines: allLines,
      perPage: 8,
      accentColor: 0xCAD7E6,
      footer: `-# <:Lightbulbalt:1521227880703463675> \`clearwarnings @user\` to clear all  ·  \`removewarn @user <number>\` to remove one`
    });

    const reply = await message.reply(result);
    setupPaginationCollector(reply, result._pageData, message.author.id);
  },
};
