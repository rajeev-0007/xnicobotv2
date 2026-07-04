'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder,
    ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');

const YEAR = 1000 * 60 * 60 * 24 * 365;
function fmtAge(ms) {
    const years = Math.floor(ms / YEAR);
    const days = Math.floor((ms - years * YEAR) / (1000 * 60 * 60 * 24));
    return years > 0 ? `${years}y ${days}d` : `${days}d`;
}

async function loadHumans(guild) {
    await guild.members.fetch();
    return [...guild.members.cache.values()]
        .filter(m => !m.user.bot)
        .sort((a, b) => a.user.createdTimestamp - b.user.createdTimestamp);
}

function buildSpotlightContainer(oldest) {
    const createdAt = Math.floor(oldest.user.createdTimestamp / 1000);
    const joinedAt = Math.floor(oldest.joinedTimestamp / 1000);
    const accountAge = fmtAge(Date.now() - oldest.user.createdTimestamp);

    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <:Award:1521228119640375336> Oldest Account\n` +
                `**${oldest.user.username}** ${oldest.nickname ? `\`(${oldest.nickname})\`` : ''}\n` +
                `${oldest.user}`
            )
        )
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: oldest.user.displayAvatarURL({ size: 256 }) } }));

    const account =
        `### <:Bookopen:1521227911137595605> Account\n` +
        `<:Caretright:1521227704953864202> **Created:** <t:${createdAt}:F>\n` +
        `<:Caretright:1521227704953864202> **Account age:** \`${accountAge}\``;

    const server =
        `### <:Userplus:1521227719621218477> Server History\n` +
        `<:Caretright:1521227704953864202> **Joined:** <t:${joinedAt}:F>\n` +
        `<:Caretright:1521227704953864202> **Relative:** <t:${joinedAt}:R>`;

    return new ContainerBuilder()
        .setAccentColor(COLORS.PURPLE || 0x9B59B6)
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(account))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(server))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

function buildLeaderboard(members) {
    const lines = members.map((m, i) =>
        `\`${String(i + 1).padStart(2, '0')}.\` ${m.user} \`@${m.user.username}\` — created <t:${Math.floor(m.user.createdTimestamp / 1000)}:R>`
    );
    return paginate({
        header:
            `# <:Award:1521228119640375336> Oldest Accounts\n` +
            `-# **${members.length}** human members ordered by account age`,
        lines,
        perPage: 12,
        accentColor: COLORS.PURPLE || 0x9B59B6 });
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
    prefix: 'oldest-member',
    description: 'View the member with the oldest Discord account',
    usage: 'oldest-member [list]',
    category: 'basic',
    aliases: ['oldestmember', 'oldmember'],

    data: new SlashCommandBuilder()
        .setName('oldest-member')
        .setDescription('View the oldest account or browse the top 100 oldest members')
        .addBooleanOption(opt => opt.setName('list').setDescription('Show the top 100 oldest accounts instead').setRequired(false)),

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
