'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder,
    ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');

const TIER_PERKS = {
    0: ['50 MB upload limit', '128 Kbps audio quality'],
    1: ['100 MB upload limit', '128 Kbps audio quality', 'Custom server invite background', 'Animated server icon', '+15 emoji slots'],
    2: ['150 MB upload limit', '256 Kbps audio quality', 'Server banner', '+30 emoji slots', '1080p Go Live streaming'],
    3: ['200 MB upload limit', '384 Kbps audio quality', 'Vanity URL', '+50 emoji slots', 'Animated server banner'] };

const BOOSTS_REQUIRED = { 1: 2, 2: 7, 3: 14 };

function buildProgressBar(current, total) {
    const safeTotal = Math.max(total, 1);
    const ratio = Math.min(current / safeTotal, 1);
    const filled = Math.round(ratio * 14);
    return `${'▰'.repeat(filled)}${'▱'.repeat(14 - filled)}`;
}

function buildOverviewContainer(guild) {
    const tier = guild.premiumTier;
    const boostCount = guild.premiumSubscriptionCount || 0;
    const boosters = guild.members.cache.filter(m => m.premiumSince).size;

    const iconUrl = guild.iconURL({ size: 256 });
    const headerSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <:nitroboost:1521228197843173717> Server Boost Info\n` +
                `**${guild.name}**`
            )
        );
    if (iconUrl) headerSection.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: iconUrl } }));

    const overview =
        `### <:Invoice:1521227903956811836> Overview\n` +
        `<:Caretright:1521227704953864202> **Boost Tier:** \`Level ${tier}\`\n` +
        `<:Caretright:1521227704953864202> **Total Boosts:** \`${boostCount}\`\n` +
        `<:Caretright:1521227704953864202> **Active Boosters:** \`${boosters}\``;

    const perks =
        `### <:Star:1521227981685526568> Current Perks (Tier ${tier})\n` +
        (TIER_PERKS[tier] || []).map(p => `> <:Checkedbox:1521227734943269077> ${p}`).join('\n');

    let progress;
    if (tier < 3) {
        const nextTier = tier + 1;
        const required = BOOSTS_REQUIRED[nextTier];
        const remaining = Math.max(0, required - boostCount);
        const bar = buildProgressBar(boostCount, required);
        progress =
            `### <:Lightning:1521227915537285150> Next Tier (Level ${nextTier})\n` +
            `${bar}  \`${boostCount}/${required}\`\n` +
            `-# ${remaining === 0 ? 'Tier reached — Discord will upgrade soon!' : `${remaining} more boost${remaining === 1 ? '' : 's'} needed`}`;
    } else {
        progress = `### <:Star:1521227981685526568> Maximum Tier\n*This server has unlocked every boost perk.*`;
    }

    return new ContainerBuilder()
        .setAccentColor(COLORS.PINK || 0xE91E63)
        .addSectionComponents(headerSection)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(overview))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(perks))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(progress))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# Run \`server-boost-info boosters\` to browse the boosters list`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

function buildBoostersList(guild) {
    const boosters = [...guild.members.cache.values()]
        .filter(m => m.premiumSince)
        .sort((a, b) => a.premiumSinceTimestamp - b.premiumSinceTimestamp);

    if (boosters.length === 0) return null;

    const lines = boosters.map((m, i) => {
        const since = Math.floor(m.premiumSinceTimestamp / 1000);
        return `\`${String(i + 1).padStart(2, '0')}.\` ${m.user} \`@${m.user.username}\` — boosting since <t:${since}:R>`;
    });

    return paginate({
        header:
            `# <:nitroboost:1521228197843173717> Server Boosters — ${guild.name}\n` +
            `-# **${boosters.length}** active booster${boosters.length === 1 ? '' : 's'}`,
        lines,
        perPage: 12,
        accentColor: COLORS.PINK || 0xE91E63 });
}

module.exports = {
    prefix: 'server-boost-info',
    description: 'View server boost tier, perks, progress, and boosters',
    usage: 'server-boost-info [boosters]',
    category: 'basic',
    aliases: ['boostinfo', 'boost-info', 'boosttier'],

    data: new SlashCommandBuilder()
        .setName('server-boost-info')
        .setDescription('View server boost tier, perks, and progress')
        .addBooleanOption(opt => opt.setName('boosters').setDescription('Browse the list of active boosters instead').setRequired(false)),

    async execute(interaction) {
        try {
            const wantList = interaction.options.getBoolean('boosters');
            if (wantList) {
                const result = buildBoostersList(interaction.guild);
                if (!result) {
                    const container = buildErrorResponse('No Boosters', 'This server has no active boosters yet.');
                    return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                const reply = await interaction.reply({ ...result, fetchReply: true });
                setupPaginationCollector(reply, result._pageData, interaction.user.id);
                return;
            }
            const container = buildOverviewContainer(interaction.guild);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[SERVER-BOOST-INFO] Slash error:', error);
            const container = buildErrorResponse('Failed', 'Could not load boost info.', error.message);
            const fn = interaction.replied || interaction.deferred ? interaction.editReply : interaction.reply;
            await fn.call(interaction, { components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        try {
            const wantList = (args || []).some(a => /^(boosters|list)$/i.test(a));
            if (wantList) {
                const result = buildBoostersList(message.guild);
                if (!result) {
                    const container = buildErrorResponse('No Boosters', 'This server has no active boosters yet.');
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                const reply = await message.reply(result);
                setupPaginationCollector(reply, result._pageData, message.author.id);
                return;
            }
            const container = buildOverviewContainer(message.guild);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[SERVER-BOOST-INFO] Prefix error:', error);
            const container = buildErrorResponse('Failed', 'Could not load boost info.', error.message);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    } };
