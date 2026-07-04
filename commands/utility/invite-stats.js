const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, SectionBuilder, ThumbnailBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { fetchRealInviteStats } = require('../../utils/inviteManager');
const { buildExpiredPanel } = require('../../utils/responseBuilder');

const PER_PAGE = 8;

/**
 * Build the invite panel.
 * @param view 'overview' (totals only, default) | 'codes' (invite code list)
 */
function buildPanel(user, stats, avatarUrl, view, codesPage, prefix) {
    const container = new ContainerBuilder();

    const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Bookopen:1521227911137595605> Invite Stats`))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl));
    container.addSectionComponents(section);
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    const totalPages = stats.codeCount > 0 ? Math.ceil(stats.codes.length / PER_PAGE) : 0;

    if (view === 'codes' && totalPages > 0) {
        // ── Invite codes view ──
        const page = Math.max(0, Math.min(codesPage, totalPages - 1));
        const pageCodes = stats.codes.slice(page * PER_PAGE, (page + 1) * PER_PAGE);

        let content = `### <:Attach:1521228039135170722> ${user.username}'s Invite Codes`;
        if (totalPages > 1) content += ` (Page ${page + 1}/${totalPages})`;
        content += `\n\n`;
        for (const code of pageCodes) {
            content += `<:Caretright:1521227704953864202> \`${code.code}\` — **${code.uses}** uses${code.maxUses ? ` / ${code.maxUses}` : ''}\n`;
        }
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

        // Pagination + back — all inside the container
        const navRow = new ActionRowBuilder();
        if (totalPages > 1) {
            navRow.addComponents(
                new ButtonBuilder().setCustomId(`${prefix}_prev`).setLabel('Prev').setEmoji('<:Caretleft:1521227977495543838>').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
                new ButtonBuilder().setCustomId(`${prefix}_ind`).setLabel(`${page + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
                new ButtonBuilder().setCustomId(`${prefix}_next`).setLabel('Next').setEmoji('<:Caretright:1521227704953864202>').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
            );
        }
        navRow.addComponents(
            new ButtonBuilder().setCustomId(`${prefix}_overview`).setLabel('Back').setStyle(ButtonStyle.Secondary)
        );
        container.addActionRowComponents(navRow);
        return { container, totalPages };
    }

    // ── Overview view (default) — totals only, no codes ──
    let content = `### <:Fire:1521227907647668374> ${user.username}'s Invites\n\n`;
    content += `<:Checkedbox:1521227734943269077> **Total Invites:** \`${stats.total}\`\n\n`;
    content += `### <:Bookopen:1521227911137595605> Breakdown\n`;
    content += `<:Caretright:1521227704953864202> **Real Invites:** \`${stats.realUses}\`\n`;
    content += `<:Caretright:1521227704953864202> **Bonus:** \`${stats.bonus}\`\n`;
    content += `<:Caretright:1521227704953864202> **Left Server:** \`${stats.left}\`\n`;
    if (stats.error) content += `\n-# <:Infotriangle:1521227710381428926> Live data unavailable — showing tracked stats`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    // Button to reveal invite codes (inside container)
    if (stats.codeCount > 0) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${prefix}_codes`).setLabel(`Show Invite Codes (${stats.codeCount})`).setEmoji('<:Attach:1521228039135170722>').setStyle(ButtonStyle.Primary)
        ));
    }
    return { container, totalPages };
}

function setupCollector(reply, user, stats, avatarUrl, ownerId, prefix) {
    let view = 'overview';
    let page = 0;

    const collector = reply.createMessageComponentCollector({
        filter: i => i.customId.startsWith(prefix) && i.user.id === ownerId,
        time: 180_000,
    });

    collector.on('collect', async (i) => {
        const action = i.customId.replace(`${prefix}_`, '');
        if (action === 'codes') { view = 'codes'; page = 0; }
        else if (action === 'overview') { view = 'overview'; }
        else if (action === 'prev') page = Math.max(0, page - 1);
        else if (action === 'next') page = page + 1;
        else return;

        const { container } = buildPanel(user, stats, avatarUrl, view, page, prefix);
        await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });

    collector.on('end', async () => {
        try { await reply.edit({ components: [buildExpiredPanel('invite-stats')], flags: MessageFlags.IsComponentsV2 }).catch(() => {}); } catch {}
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
        const { container } = buildPanel(user, stats, avatarUrl, 'overview', 0, btnPrefix);
        const reply = await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        setupCollector(reply, user, stats, avatarUrl, interaction.user.id, btnPrefix);
    },

    async executePrefix(message, args) {
        const user = message.mentions.users.first() || message.author;
        const stats = await fetchRealInviteStats(message.guild, user.id);
        const avatarUrl = user.displayAvatarURL({ dynamic: true, size: 256 });
        const btnPrefix = `invcode_${Date.now().toString(36)}`;
        const { container } = buildPanel(user, stats, avatarUrl, 'overview', 0, btnPrefix);
        const reply = await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        setupCollector(reply, user, stats, avatarUrl, message.author.id, btnPrefix);
    }
};
