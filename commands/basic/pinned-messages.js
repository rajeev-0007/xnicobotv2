'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');

const SNIPPET_LIMIT = 80;

function snippet(content) {
    if (!content) return '*[no text content]*';
    const cleaned = content.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= SNIPPET_LIMIT) return cleaned;
    return `${cleaned.slice(0, SNIPPET_LIMIT)}…`;
}

async function buildPinnedMessages(channel) {
    const pins = await channel.messages.fetchPinned();
    if (pins.size === 0) return null;

    const sorted = [...pins.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);

    const lines = sorted.map((msg, i) => {
        const idx = `\`${String(i + 1).padStart(2, '0')}.\``;
        const author = msg.author ? `${msg.author}` : '`unknown`';
        const text = snippet(msg.content);
        const date = `<t:${Math.floor(msg.createdTimestamp / 1000)}:R>`;
        const link = `[Jump](${msg.url})`;
        return `${idx} ${author} • ${date} • ${link}\n> ${text}`;
    });

    return paginate({
        header:
            `# <:Pin:1521227932625014916> Pinned Messages\n` +
            `-# **${pins.size}**/50 pins in ${channel}`,
        lines,
        perPage: 6,
        accentColor: COLORS.INFO });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pinned-messages')
        .setDescription('Browse every pinned message in this channel'),

    prefix: 'pinned-messages',
    description: 'Browse every pinned message in this channel',
    usage: 'pinned-messages',
    category: 'basic',
    aliases: ['pins', 'pinned'],

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
        try {
            const result = await buildPinnedMessages(interaction.channel);
            if (!result) {
                const container = buildErrorResponse(
                    'No Pinned Messages',
                    `${interaction.channel} has no pinned messages.`,
                    'Pin a message by right-clicking it and choosing **Pin Message**, then run this again.'
                );
                return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            const reply = await interaction.editReply(result);
            setupPaginationCollector(reply, result._pageData, interaction.user.id);
        } catch (error) {
            console.error('[PINNED-MESSAGES] Slash error:', error);
            const container = buildErrorResponse('Failed to Fetch', 'Could not fetch pinned messages.', error.message);
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async executePrefix(message) {
        try {
            const result = await buildPinnedMessages(message.channel);
            if (!result) {
                const container = buildErrorResponse(
                    'No Pinned Messages',
                    `${message.channel} has no pinned messages.`,
                    'Pin a message by right-clicking it and choosing **Pin Message**, then run this again.'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            const reply = await message.reply(result);
            setupPaginationCollector(reply, result._pageData, message.author.id);
        } catch (error) {
            console.error('[PINNED-MESSAGES] Prefix error:', error);
            const container = buildErrorResponse('Failed to Fetch', 'Could not fetch pinned messages.', error.message);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    } };
