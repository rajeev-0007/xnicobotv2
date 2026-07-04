'use strict';

/**
 * presence.js — Owner-only: change the bot's presence on the fly.
 * For the full UI version, see `botpanel`. This is a quick CLI variant.
 */

const { isOwner } = require('../../utils/helpers');
const { ActivityType, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

const STATUS_VALUES = ['online', 'idle', 'dnd', 'invisible'];

const TYPE_MAP = {
    playing:    ActivityType.Playing,
    streaming:  ActivityType.Streaming,
    listening:  ActivityType.Listening,
    watching:   ActivityType.Watching,
    competing:  ActivityType.Competing,
    custom:     ActivityType.Custom
};

module.exports = {
    name: 'presence',
    prefix: 'presence',
    aliases: ['setpresence', 'activity', 'setactivity'],
    description: 'Owner-only: change bot status and activity',
    usage: 'presence <status> <type> <text...>',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager, client) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!args.length) {
            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Settings:1521227767780343879> Presence\n\n` +
                    `**Usage:** \`presence <status> <type> <text>\`\n\n` +
                    `**Status:** ${STATUS_VALUES.join(', ')}\n` +
                    `**Type:** ${Object.keys(TYPE_MAP).join(', ')}\n\n` +
                    `**Examples:**\n` +
                    `\`presence online watching the dev console\`\n` +
                    `\`presence dnd custom <maintenance>\`\n` +
                    `\`presence idle playing with bugs\`\n\n` +
                    `Use \`presence clear\` to remove the activity.`
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (args[0].toLowerCase() === 'clear') {
            await client.user.setPresence({ activities: [], status: 'online' });
            return message.reply('<:Checkedbox:1521227734943269077> Activity cleared, status set to **online**.');
        }

        const status = args[0].toLowerCase();
        if (!STATUS_VALUES.includes(status)) {
            return message.reply(require('../../utils/ownerUI').errReply('Invalid Status', `Invalid status. Use one of: ${STATUS_VALUES.join(', ')}`));
        }

        const typeArg = (args[1] || '').toLowerCase();
        if (!TYPE_MAP[typeArg]) {
            return message.reply(require('../../utils/ownerUI').errReply('Invalid Type', `Invalid type. Use one of: ${Object.keys(TYPE_MAP).join(', ')}`));
        }

        const text = args.slice(2).join(' ').trim();
        if (!text) {
            return message.reply(require('../../utils/ownerUI').errReply('Missing Text', 'Provide activity text.'));
        }

        try {
            const activity = { name: text, type: TYPE_MAP[typeArg] };
            // Custom status uses `state` rather than `name` for display.
            if (TYPE_MAP[typeArg] === ActivityType.Custom) {
                activity.state = text;
            }
            await client.user.setPresence({ activities: [activity], status });
            return message.reply(`<:Checkedbox:1521227734943269077> Status: **${status}**, Activity: \`${typeArg}\` "${text}"`);
        } catch (e) {
            return message.reply(require('../../utils/ownerUI').errReply('Failed', `Failed to set presence: ${e.message}`));
        }
    }
};
