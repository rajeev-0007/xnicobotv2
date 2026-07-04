'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder,
    ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const fmtDays = (ms) => `${Math.floor(ms / MS_PER_DAY)} day${Math.floor(ms / MS_PER_DAY) === 1 ? '' : 's'}`;

async function loadHumans(guild) {
    await guild.members.fetch();
    return [...guild.members.cache.values()]
        .filter(m => !m.user.bot)
        .sort((a, b) => b.joinedTimestamp - a.joinedTimestamp);
}

function buildSpotlightContainer(newest) {
    const joinedAt = Math.floor(newest.joinedTimestamp / 1000);
    const createdAt = Math.floor(newest.user.createdTimestamp / 1000);
    const accountAge = fmtDays(Date.now() - newest.user.createdTimestamp);

    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <:Userplus:1521227719621218477> Newest Member\n` +
                `**${newest.user.username}** ${newest.nickname ? `\`(${newest.nickname})\`` : ''}\n` +
                `${newest.user}`
            )
        )
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: newest.user.displayAvatarURL({ size: 256 }) } }));

    const join =
        `### <:Clock:1521228110408847623> Joined Server\n` +
        `<:Caretright:1521227704953864202> **Date:** <t:${joinedAt}:F>\n` +
        `<:Caretright:1521227704953864202> **Relative:** <t:${joinedAt}:R>`;

    const account =
        `### <:Bookopen:1521227911137595605> Account\n` +
        `<:Caretright:1521227704953864202> **Created:** <t:${createdAt}:F>\n` +
        `<:Caretright:1521227704953864202> **Account age:** \`${accountAge}\``;

    return new ContainerBuilder()
        .setAccentColor(COLORS.SUCCESS || 0x57F287)
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(join))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(account))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

function buildLeaderboard(members) {
    const lines = members.map((m, i) =>
        `\`${String(i + 1).padStart(2, '0')}.\` ${m.user} \`@${m.user.username}\` — joined <t:${Math.floor(m.joinedTimestamp / 1000)}:R>`
    );
    return paginate({
        header:
            `# <:Userplus:1521227719621218477> Newest Members\n` +
            `-# **${members.length}** human members ordered by join date`,
        lines,
        perPage: 12,
        accentColor: COLORS.SUCCESS || 0x57F287 });
}

async function send(replyFn, guild, userId, args) {
    const all = await loadHumans(guild);
    if (all.length === 0) {
        const container = buildErrorResponse('No Members Found', 'Could not find any human members in this server.');
        return replyFn({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const wantList = (args || []).some(a => /^(list|all|top)$/i.test(a));
    if (wantList) {
        const top = all.slice(0, 100);
        const result = buildLeaderboard(top);
        const reply = await replyFn({ ...result, fetchReply: true });
        setupPaginationCollector(reply, result._pageData, userId);
        return;
    }

    const container = buildSpotlightContainer(all[0]);
    return replyFn({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    prefix: 'newest-member',
    description: 'View the newest member, or pass `list` to browse the most recent joins',
    usage: 'newest-member [list]',
    category: 'basic',
    aliases: ['newestmember', 'newmember'],

    data: new SlashCommandBuilder()
        .setName('newest-member')
        .setDescription('View the newest member or browse a list of recent joins')
        .addBooleanOption(opt => opt.setName('list').setDescription('Show the top 100 most recent joins instead').setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
        try {
            const list = interaction.options.getBoolean('list');
            await send(
                (payload) => interaction.editReply(payload),
                interaction.guild,
                interaction.user.id,
                list ? ['list'] : []
            );
        } catch (error) {
            const err = buildErrorResponse('Lookup Failed', 'Could not load members.', error.message);
            await interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        try {
            await send(
                (payload) => message.reply(payload),
                message.guild,
                message.author.id,
                args
            );
        } catch (error) {
            const err = buildErrorResponse('Lookup Failed', 'Could not load members.', error.message);
            await message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    } };
