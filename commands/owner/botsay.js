'use strict';

/**
 * say.js — Owner-only: send a message as the bot.
 * Supports same-channel send, target-channel by ID/mention, and
 * cross-guild send via `say <channelId> <text>`.
 */

const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags, ChannelType } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

module.exports = {
    name: 'botsay',
    prefix: 'botsay',
    aliases: ['echo', 'asbot', 'announce-as'],
    description: 'Owner-only: send a message as the bot in any channel',
    usage: 'botsay [#channel|channelId] <text>',
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
                    `# 🗣️ Bot Say\n\n` +
                    `**Usage:** \`botsay [#channel|channelId] <text>\`\n\n` +
                    `**Examples:**\n` +
                    `\`botsay Hello world\`\n` +
                    `\`botsay #general Welcome!\`\n` +
                    `\`botsay 1234567890 Cross-guild message\``
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Resolve target channel (mention, ID, or default to current channel).
        let targetChannel = message.mentions.channels.first();
        let textArgs = args;

        if (!targetChannel && /^\d{17,20}$/.test(args[0])) {
            const ch = client.channels.cache.get(args[0]);
            if (ch && ch.isTextBased?.() && !ch.isDMBased?.()) {
                targetChannel = ch;
                textArgs = args.slice(1);
            }
        } else if (targetChannel) {
            textArgs = args.slice(1);
        }

        targetChannel = targetChannel || message.channel;

        const text = textArgs.join(' ').trim();
        if (!text) {
            return message.reply(require('../../utils/ownerUI').errReply('Missing Text', 'Provide some text to say.'));
        }

        if (!targetChannel.permissionsFor?.(targetChannel.guild?.members.me)?.has('SendMessages')) {
            return message.reply(require('../../utils/ownerUI').errReply('Missing Permission', `I lack permission to send messages in <#${targetChannel.id}>.`));
        }

        // Try to delete the trigger so the channel stays clean (best-effort).
        if (targetChannel.id === message.channel.id) {
            message.delete().catch(() => {});
        }

        try {
            await targetChannel.send({ content: text, allowedMentions: { parse: [] } });
            if (targetChannel.id !== message.channel.id) {
                await message.reply(`<:Checkedbox:1521227734943269077> Sent in <#${targetChannel.id}>.`).catch(() => {});
            }
        } catch (e) {
            return message.channel.send(`<:Cancel:1521227723916181644> Failed to send: ${e.message}`).catch(() => {});
        }
    }
};
