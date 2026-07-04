'use strict';

const {
    SnowflakeUtil, SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const { buildErrorResponse, buildInvalidUsage, COLORS } = require('../../utils/responseBuilder');

const SNOWFLAKE_REGEX = /^\d{17,19}$/;
const DISCORD_EPOCH = 1420070400000;

function classifySnowflake(client, snowflake, ts) {
    if (ts < DISCORD_EPOCH) return 'Pre-Discord epoch (likely invalid)';
    const guesses = [];
    if (client.guilds?.cache?.has(snowflake)) guesses.push('Guild');
    if (client.users?.cache?.has(snowflake)) guesses.push('User');
    if (client.channels?.cache?.has(snowflake)) guesses.push('Channel');
    return guesses.length > 0 ? guesses.join(' / ') : 'Generic Discord ID';
}

function buildSnowflake(client, snowflake) {
    const timestamp = SnowflakeUtil.timestampFrom(snowflake);
    const big = BigInt(snowflake);
    const workerId = (big >> 17n) & 0x1Fn;
    const processId = (big >> 12n) & 0x1Fn;
    const increment = big & 0xFFFn;
    const inferred = classifySnowflake(client, snowflake, timestamp);

    return new ContainerBuilder()
        .setAccentColor(COLORS.INFO)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Search:1521228231263387738> Snowflake Decoder`))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Invoice:1521227903956811836> Identification\n` +
            `<:Caretright:1521227704953864202> **ID:** \`${snowflake}\`\n` +
            `<:Caretright:1521227704953864202> **Likely type:** \`${inferred}\`\n` +
            `<:Caretright:1521227704953864202> **Created:** <t:${Math.floor(timestamp / 1000)}:F>\n` +
            `<:Caretright:1521227704953864202> **Relative:** <t:${Math.floor(timestamp / 1000)}:R>`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Settings:1521227767780343879> Technical Breakdown\n` +
            `<:Caretright:1521227704953864202> **Unix timestamp:** \`${timestamp}\`\n` +
            `<:Caretright:1521227704953864202> **Worker ID:** \`${workerId}\`\n` +
            `<:Caretright:1521227704953864202> **Process ID:** \`${processId}\`\n` +
            `<:Caretright:1521227704953864202> **Increment:** \`${increment}\``
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('snowflake')
        .setDescription('Decode a Discord snowflake ID')
        .addStringOption(opt => opt.setName('id').setDescription('Discord snowflake ID to decode').setRequired(true)),

    prefix: 'snowflake',
    description: 'Decode a Discord snowflake ID',
    usage: 'snowflake <id>',
    category: 'basic',
    aliases: ['sf', 'decode'],

    async execute(interaction) {
        const snowflake = interaction.options.getString('id').trim();
        if (!SNOWFLAKE_REGEX.test(snowflake)) {
            const container = buildErrorResponse(
                'Invalid Snowflake',
                'A valid Discord snowflake is **17-19 digits** of pure numbers.',
                'Tip: enable Developer Mode in Discord, then right-click anything to copy its ID.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        try {
            await interaction.reply({ components: [buildSnowflake(interaction.client, snowflake)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[SNOWFLAKE] Slash error:', error);
            const container = buildErrorResponse('Decode Failed', 'Could not decode the snowflake ID.', error.message);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        const snowflake = (args[0] || '').trim();
        if (!SNOWFLAKE_REGEX.test(snowflake)) {
            const container = buildInvalidUsage(
                'snowflake',
                '-snowflake <id>',
                ['-snowflake 123456789012345678', '-snowflake 987654321098765432']
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        try {
            await message.reply({ components: [buildSnowflake(message.client, snowflake)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[SNOWFLAKE] Prefix error:', error);
            const container = buildErrorResponse('Decode Failed', 'Could not decode the snowflake ID.', error.message);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    } };
