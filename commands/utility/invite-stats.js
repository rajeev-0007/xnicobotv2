const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, SectionBuilder, ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getUserStats, fetchRealInviteStats } = require('../../utils/inviteManager');
const { buildExpiredPanel } = require('../../utils/responseBuilder');

function buildStatsContainer(user, stats, avatarUrl, codesPage = 0, prefix = 'invcode') {
    const container = new ContainerBuilder();

    const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Bookopen:1521227911137595605> Invite Stats`))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));
    container.addSectionComponents(section);

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    let content = `### <:Fire:1521227907647668374> ${user.username}'s Invites\n\n`;
    content += `<:Checkedbox:1521227734943269077> **Total Invites:** \`${stats.total}\`\n\n`;

    content += `### <:Bookopen:1521227911137595605> Breakdown\n`;
    content += `<:Caretright:1521227704953864202> **Real Invites:** \`${stats.realUses}\`\n`;
    content += `<:Caretright:1521227704953864202> **Bonus:** \`${stats.bonus}\`\n`;
    content += `<:Caretright:1521227704953864202> **Left Server:** \`${stats.left}\`\n`;

    const PER_PAGE = 8;

    if (stats.codeCount > 0) {
        const totalPages = Math.ceil(stats.codes.length / PER_PAGE);
        const page = Math.min(codesPage, totalPages - 1);
        const pageCodes = stats.codes.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

        content += `\n### <:Attach:1521228039135170722> Active Invite Codes`;
        if (totalPages > 1) content += ` (Page ${page + 1}/${totalPages})`;
        content += `\n`;

        for (const code of pageCodes) {
            content += `<:Caretright:1521227704953864202> \`${code.code}\` — **${code.uses}** uses${code.maxUses ? ` / ${code.maxUses}` : ''}\n`;
        }

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        if (totalPages > 1) {
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            container.addActionRowComponents(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`${prefix}_first`).setLabel('≪').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
                    new ButtonBuilder().setCustomId(`${prefix}_prev`).setLabel('◀').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
                    new ButtonBuilder().setCustomId(`${prefix}_ind`).setLabel(`${page + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                    new ButtonBuilder().setCustomId(`${prefix}_next`).setLabel('▶').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
                    new ButtonBuilder().setCustomId(`${prefix}_last`).setLabel('≫').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1)
                )
            );
        }
    } else {
        content += `\n-# No active invite codes found`;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    }

    if (stats.error) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`\n-# <:Infotriangle:1521227710381428926> Could not fetch live data — showing tracked stats only`));
    }

    return { container, totalCodePages: stats.codeCount > 0 ? Math.ceil(stats.codes.length / PER_PAGE) : 0 };
}

function setupInviteCodeCollector(reply, user, stats, avatarUrl, ownerId, prefix) {
    const totalPages = Math.ceil(stats.codes.length / 8);
    if (totalPages <= 1) return;
    let currentPage = 0;

    const collector = reply.createMessageComponentCollector({
        filter: i => i.customId.startsWith(prefix) && i.user.id === ownerId,
        time: 120_000
    });

    collector.on('collect', async (i) => {
        const action = i.customId.replace(`${prefix}_`, '');
        switch (action) {
            case 'first': currentPage = 0; break;
            case 'prev':  currentPage = Math.max(0, currentPage - 1); break;
            case 'next':  currentPage = Math.min(totalPages - 1, currentPage + 1); break;
            case 'last':  currentPage = totalPages - 1; break;
            default: return;
        }
        const { container } = buildStatsContainer(user, stats, avatarUrl, currentPage, prefix);
        await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });

    collector.on('end', async () => {
        try {
            await reply.edit({ components: [buildExpiredPanel('invite-stats')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        } catch {}
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite-stats')
        .setDescription('View invite statistics for a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to check invites for (leave empty for yourself)')
                .setRequired(false)),

    prefix: 'invite-stats',
    aliases: ['invites', 'invs'],
    description: 'View invite statistics for a user',
    usage: 'invite-stats [@user]',
    category: 'utility',

    async execute(interaction) {
        await interaction.deferReply();
        const user = interaction.options.getUser('user') || interaction.user;
        const stats = await fetchRealInviteStats(interaction.guild, user.id);
        const avatarUrl = user.displayAvatarURL({ dynamic: true, size: 256 });
        const btnPrefix = `invcode_${Date.now().toString(36)}`;
        const { container } = buildStatsContainer(user, stats, avatarUrl, 0, btnPrefix);
        const reply = await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        setupInviteCodeCollector(reply, user, stats, avatarUrl, interaction.user.id, btnPrefix);
    },

    async executePrefix(message, args) {
        const user = message.mentions.users.first() || message.author;
        const stats = await fetchRealInviteStats(message.guild, user.id);
        const avatarUrl = user.displayAvatarURL({ dynamic: true, size: 256 });
        const btnPrefix = `invcode_${Date.now().toString(36)}`;
        const { container } = buildStatsContainer(user, stats, avatarUrl, 0, btnPrefix);
        const reply = await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        setupInviteCodeCollector(reply, user, stats, avatarUrl, message.author.id, btnPrefix);
    }
};
