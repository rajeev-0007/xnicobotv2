'use strict';

const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, PermissionFlagsBits } = require('discord.js');
const {
    COLORS, BRANDING, EMOJIS: PALETTE,
    buildPermissionDenied, buildBotPermissionError,
} = require('../../utils/responseBuilder');
const {
    parseEmojiInput, canManageExpressions, botCanManageExpressions,
    explainEmojiError,
} = require('../../utils/emojiSystem');

function findEmoji(guild, input) {
    if (!guild || !input) return null;
    // 1. Custom emoji tag or bare snowflake
    const parsed = parseEmojiInput(input);
    if (parsed?.id) {
        const cached = guild.emojis.cache.get(parsed.id);
        if (cached) return cached;
    }
    // 2. Name lookup (with optional `:wrapping:`)
    const name = String(input).replace(/^:|:$/g, '').trim();
    if (!name) return null;
    return guild.emojis.cache.find(e => e.name.toLowerCase() === name.toLowerCase()) || null;
}

function buildSuccess(emojiName, moderator) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${PALETTE.DELETE} Emoji Deleted\n\n` +
            `**Name:** \`:${emojiName}:\`\n` +
            `**Moderator:** ${moderator}`
        ))
;
}

function buildError(desc) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.ERROR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${PALETTE.ERROR} Delete Emoji\n\n${desc}`));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('deleteemoji')
        .setDescription('Delete a custom emoji from this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
        .addStringOption(o => o
            .setName('emoji')
            .setDescription('The emoji tag, name, or ID')
            .setRequired(true)),

    prefix: 'deleteemoji',
    description: 'Delete a custom emoji from this server',
    usage: 'deleteemoji <emoji|name|id>',
    category: 'admin',
    aliases: ['delemoji', 'removeemoji'],
    permissions: ['ManageGuildExpressions'],

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({ components: [buildError('This command can only be used in a server.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        if (!canManageExpressions(interaction.member)) {
            return interaction.reply({ components: [buildPermissionDenied('Manage Expressions')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        if (!botCanManageExpressions(interaction.guild)) {
            return interaction.reply({ components: [buildBotPermissionError('Manage Expressions')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const input = interaction.options.getString('emoji');
        const emoji = findEmoji(interaction.guild, input);
        if (!emoji) {
            return interaction.reply({
                components: [buildError(`Could not find an emoji matching \`${input}\` in this server.`)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        try {
            const emojiName = emoji.name;
            await emoji.delete(`Deleted by ${interaction.user.username}`);
            await interaction.reply({ components: [buildSuccess(emojiName, interaction.user.username)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await interaction.reply({
                components: [buildError(`Failed to delete emoji: ${explainEmojiError(error)}`)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }
    },

    async executePrefix(message, args) {
        if (!message.guild) {
            return message.reply({ components: [buildError('This command can only be used in a server.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
        if (!canManageExpressions(message.member)) {
            return message.reply({ components: [buildPermissionDenied('Manage Expressions')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
        if (!botCanManageExpressions(message.guild)) {
            return message.reply({ components: [buildBotPermissionError('Manage Expressions')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
        if (!args.length) {
            return message.reply({
                components: [buildError(
                    'Provide an emoji tag, name, or ID.\n\n' +
                    `**Usage:** \`deleteemoji <emoji>\`\n` +
                    `**Examples:**\n` +
                    `${PALETTE.BULLET} \`deleteemoji <:name:123456789012345678>\`\n` +
                    `${PALETTE.BULLET} \`deleteemoji name\`\n` +
                    `${PALETTE.BULLET} \`deleteemoji 123456789012345678\``
                )],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }

        const emoji = findEmoji(message.guild, args.join(' '));
        if (!emoji) {
            return message.reply({
                components: [buildError(`Could not find an emoji matching \`${args.join(' ')}\` in this server.`)],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }

        try {
            const emojiName = emoji.name;
            await emoji.delete(`Deleted by ${message.author.username}`);
            await message.reply({ components: [buildSuccess(emojiName, message.author.username)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply({
                components: [buildError(`Failed to delete emoji: ${explainEmojiError(error)}`)],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }
    },
};
