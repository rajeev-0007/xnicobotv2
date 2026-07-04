'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const {
    buildSuccessResponse, buildErrorResponse, buildPermissionDenied,
    buildBotPermissionError, buildInvalidUsage,
} = require('../../utils/responseBuilder');
const {
    canManageExpressions, botCanManageExpressions, explainStickerError, SNOWFLAKE_RE,
} = require('../../utils/emojiSystem');

async function findSticker(guild, input) {
    if (!guild) return null;
    const stickers = await guild.stickers.fetch();
    if (SNOWFLAKE_RE.test(input)) {
        return stickers.get(input) || null;
    }
    return stickers.find(s => s.name.toLowerCase() === String(input).toLowerCase()) || null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sticker-delete')
        .setDescription('Delete a sticker from this server')
        .addStringOption(o => o
            .setName('sticker')
            .setDescription('Sticker name or ID to delete')
            .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions),

    prefix: 'sticker-delete',
    description: 'Delete a sticker from this server',
    usage: 'sticker-delete <name|id>',
    category: 'admin',
    aliases: ['deletesticker', 'stickerdelete', 'rmsticker'],
    permissions: ['ManageGuildExpressions'],

    async execute(interaction) {
        if (!interaction.guild) {
            const c = buildErrorResponse('Server Required', 'This command can only be used in a server.');
            return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        if (!canManageExpressions(interaction.member)) {
            return interaction.reply({ components: [buildPermissionDenied('Manage Expressions')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        if (!botCanManageExpressions(interaction.guild)) {
            return interaction.reply({ components: [buildBotPermissionError('Manage Expressions')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const input = interaction.options.getString('sticker');

        try {
            const sticker = await findSticker(interaction.guild, input);
            if (!sticker) {
                const c = buildErrorResponse(
                    'Sticker Not Found',
                    `No sticker named or with ID \`${input}\` was found.`,
                    'Use the sticker name or its ID.'
                );
                return interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const stickerName = sticker.name;
            await sticker.delete(`Deleted by ${interaction.user.username}`);

            const c = buildSuccessResponse(
                'Sticker Deleted',
                'Successfully deleted the sticker.',
                {
                    'Sticker':    stickerName,
                    'Deleted By': interaction.user.username,
                }
            );
            await interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const c = buildErrorResponse('Failed to Delete Sticker', explainStickerError(error));
            await interaction.reply({ components: [c], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.guild) {
            const c = buildErrorResponse('Server Required', 'This command can only be used in a server.');
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
        if (!canManageExpressions(message.member)) {
            return message.reply({ components: [buildPermissionDenied('Manage Expressions')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
        if (!botCanManageExpressions(message.guild)) {
            return message.reply({ components: [buildBotPermissionError('Manage Expressions')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
        if (!args.length) {
            const c = buildInvalidUsage(
                'sticker-delete',
                '-sticker-delete <sticker name or ID>',
                ['-sticker-delete MyStickerName', '-sticker-delete 123456789012345678'],
            );
            return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        const input = args.join(' ');
        try {
            let sticker = await findSticker(message.guild, input);

            // Fallback: if the user replied to or attached a sticker
            // message, also accept that.
            if (!sticker && message.stickers?.size) {
                const msgSticker = message.stickers.first();
                sticker = (await message.guild.stickers.fetch()).get(msgSticker.id) || null;
            }

            if (!sticker) {
                const c = buildErrorResponse(
                    'Sticker Not Found',
                    `No sticker named or with ID \`${input}\` was found.`,
                    'Use the sticker name or its ID.'
                );
                return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            }

            const stickerName = sticker.name;
            await sticker.delete(`Deleted by ${message.author.username}`);

            const c = buildSuccessResponse(
                'Sticker Deleted',
                'Successfully deleted the sticker.',
                {
                    'Sticker':    stickerName,
                    'Deleted By': message.author.username,
                }
            );
            await message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const c = buildErrorResponse('Failed to Delete Sticker', explainStickerError(error));
            await message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },
};
