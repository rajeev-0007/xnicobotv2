'use strict';

const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, PermissionFlagsBits } = require('discord.js');
const {
    COLORS, BRANDING, EMOJIS: PALETTE,
    buildPermissionDenied, buildBotPermissionError,
} = require('../../utils/responseBuilder');
const {
    parseEmojiInput, sanitizeEmojiName, VALID_EMOJI_NAME_RE,
    canManageExpressions, botCanManageExpressions, explainEmojiError,
} = require('../../utils/emojiSystem');

function findEmoji(guild, input) {
    if (!guild || !input) return null;
    const parsed = parseEmojiInput(input);
    if (parsed?.id) {
        const cached = guild.emojis.cache.get(parsed.id);
        if (cached) return cached;
    }
    const name = String(input).replace(/^:|:$/g, '').trim();
    if (!name) return null;
    return guild.emojis.cache.find(e => e.name.toLowerCase() === name.toLowerCase()) || null;
}

function buildSuccess(oldName, newName, emojiStr, moderator) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${PALETTE.EDIT} Emoji Renamed\n\n` +
            `${emojiStr} \`:${oldName}:\` → \`:${newName}:\`\n` +
            `**Moderator:** ${moderator}`
        ))
;
}

function buildError(desc) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.ERROR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${PALETTE.ERROR} Rename Emoji\n\n${desc}`));
}

function validateNewName(rawName) {
    if (!rawName) return { ok: false, reason: 'Provide a new name.' };
    const trimmed = String(rawName).trim();
    if (trimmed.length < 2) return { ok: false, reason: 'Name must be at least 2 characters.' };
    if (trimmed.length > 32) return { ok: false, reason: 'Name must be at most 32 characters.' };
    if (!VALID_EMOJI_NAME_RE.test(trimmed)) {
        return {
            ok: false,
            reason: 'Name can only contain letters, numbers, and underscores.',
            sanitized: sanitizeEmojiName(trimmed, ''),
        };
    }
    return { ok: true, name: trimmed };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('renameemoji')
        .setDescription('Rename a custom emoji in this server')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
        .addStringOption(o => o
            .setName('emoji')
            .setDescription('The emoji tag, name, or ID')
            .setRequired(true))
        .addStringOption(o => o
            .setName('name')
            .setDescription('New name (2-32 chars, letters/numbers/underscore)')
            .setRequired(true)),

    prefix: 'renameemoji',
    description: 'Rename a custom emoji in this server',
    usage: 'renameemoji <emoji|name|id> <new_name>',
    category: 'admin',
    aliases: ['emojirename'],
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

        const validation = validateNewName(interaction.options.getString('name'));
        if (!validation.ok) {
            return interaction.reply({
                components: [buildError(
                    `${validation.reason}` +
                    (validation.sanitized
                        ? `\n\n${PALETTE.BULB} **Suggestion:** \`${validation.sanitized}\``
                        : ''))],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        try {
            const oldName = emoji.name;
            await emoji.setName(validation.name, `Renamed by ${interaction.user.username}`);
            await interaction.reply({ components: [buildSuccess(oldName, validation.name, `${emoji}`, interaction.user.username)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await interaction.reply({
                components: [buildError(`Failed to rename emoji: ${explainEmojiError(error)}`)],
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
        if (args.length < 2) {
            return message.reply({
                components: [buildError(
                    'Provide an emoji and a new name.\n\n' +
                    '**Usage:** `renameemoji <emoji|name|id> <new_name>`\n' +
                    '**Example:** `renameemoji <:oldname:123…> newname`'
                )],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }

        const emoji = findEmoji(message.guild, args[0]);
        if (!emoji) {
            return message.reply({
                components: [buildError(`Could not find an emoji matching \`${args[0]}\` in this server.`)],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }

        const validation = validateNewName(args[1]);
        if (!validation.ok) {
            return message.reply({
                components: [buildError(
                    validation.reason +
                    (validation.sanitized ? `\n\n${PALETTE.BULB} **Suggestion:** \`${validation.sanitized}\`` : '')
                )],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }

        try {
            const oldName = emoji.name;
            await emoji.setName(validation.name, `Renamed by ${message.author.username}`);
            await message.reply({ components: [buildSuccess(oldName, validation.name, `${emoji}`, message.author.username)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply({
                components: [buildError(`Failed to rename emoji: ${explainEmojiError(error)}`)],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }
    },
};
