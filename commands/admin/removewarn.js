'use strict';

const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay, addSeparator } = require('../../utils/componentHelpers');
const { buildPermissionDenied, buildInvalidUsage, buildErrorResponse } = require('../../utils/responseBuilder');
const jsonStore = require('../../utils/jsonStore');


function load(storeName) {
  return jsonStore.read(storeName);
}
function save(storeName, d) { jsonStore.write(storeName, d); }

module.exports = {
  prefix: 'removewarn',
  description: 'Remove a specific warning from a user by number',
  usage: 'removewarn <@user> <warn_number>',
  category: 'admin',
  aliases: ['delwarn', 'unwarn', 'rmwarn'],

  async executePrefix(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      const container = buildPermissionDenied('Moderate Members');
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const user = message.mentions.users.first();
    const warnNum = parseInt(args[1]);

    if (!user || !warnNum) {
      const container = buildInvalidUsage(
        'removewarn',
        '-removewarn @user <number>',
        ['-removewarn @User 2', '-removewarn @Troll 1']
      );
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const warnings = load('warnings');
    const userWarns = warnings[message.guild.id]?.[user.id];

    if (!userWarns || userWarns.length === 0) {
      const container = buildErrorResponse('No Warnings', `${user.username} has no warnings to remove.`);
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (warnNum < 1 || warnNum > userWarns.length) {
      const container = buildErrorResponse('Invalid Number', `Warning number must be between **1** and **${userWarns.length}**.`);
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const removed = userWarns.splice(warnNum - 1, 1)[0];
    if (userWarns.length === 0) delete warnings[message.guild.id][user.id];
    save('warnings', warnings);

    const container = createContainer(0xCAD7E6);
    addTextDisplay(container, [
      `# <:Checkedbox:1521227734943269077> Warning Removed`,
      '',
      `**User:** ${user.username}`,
      `**Warning #${warnNum}:** ${removed.reason}`,
      `**Remaining:** ${userWarns.length || 0} warning${(userWarns.length || 0) !== 1 ? 's' : ''}`,
    ].join('\n'));
    addSeparator(container);

    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  } };
