'use strict';

const {
    SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, SeparatorBuilder, SeparatorSpacingSize,
} = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');
const { resolveUser } = require('../../utils/resolveUser');

const CARDS_PER_PAGE = 10;
const RARITY_ORDER = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];

/** Minimal unicode progress bar. */
function progressBar(pct, len = 12) {
    const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * len);
    return '▰'.repeat(filled) + '▱'.repeat(len - filled);
}

function getEntries(playerData, filterRarity) {
    const charMap = new Map();
    for (const entry of playerData.collection) {
        const existing = charMap.get(entry.charId);
        if (!existing) charMap.set(entry.charId, { charId: entry.charId, count: 1 });
        else existing.count++;
    }
    let entries = [...charMap.values()];
    if (filterRarity) {
        entries = entries.filter(e => {
            const char = animeManager.CHARACTERS.find(c => c.id === e.charId);
            return char && char.rarity === filterRarity;
        });
    }
    entries.sort((a, b) => {
        const charA = animeManager.CHARACTERS.find(c => c.id === a.charId);
        const charB = animeManager.CHARACTERS.find(c => c.id === b.charId);
        const rarA = RARITY_ORDER.indexOf(charA?.rarity || 'common');
        const rarB = RARITY_ORDER.indexOf(charB?.rarity || 'common');
        if (rarA !== rarB) return rarA - rarB;
        return (charA?.name || '').localeCompare(charB?.name || '');
    });
    return entries;
}

function buildPage(targetUser, playerData, entries, page, filterRarity) {
    const totalPages = Math.max(1, Math.ceil(entries.length / CARDS_PER_PAGE));
    page = Math.max(0, Math.min(page, totalPages - 1));
    const pageEntries = entries.slice(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE);

    const lines = pageEntries.map((entry, i) => {
        const char = animeManager.CHARACTERS.find(c => c.id === entry.charId);
        if (!char) return null;
        const rarity = animeManager.RARITIES[char.rarity];
        const idx = String(page * CARDS_PER_PAGE + i + 1).padStart(2, '0');
        const countStr = entry.count > 1 ? `  \`×${entry.count}\`` : '';
        return `\`${idx}\` ${rarity.emoji} **${char.name}**${countStr}\n-# └ ${char.anime}`;
    }).filter(Boolean);

    const stats = animeManager.getCollectionStats(playerData);

    // Compact rarity distribution (only tiers the player owns)
    const distr = RARITY_ORDER
        .filter(r => (stats.byRarity[r] || 0) > 0)
        .map(r => `${animeManager.RARITIES[r].emoji} ${stats.byRarity[r]}`)
        .join('   ');

    const container = createContainer(filterRarity ? animeManager.RARITIES[filterRarity].color : 0x9B59B6);
    const header = [
        `## ${AE.card} ${targetUser.username}'s Collection`,
        `> \`${progressBar(stats.percentage)}\` **${stats.percentage}%**`,
        `> ${AE.stats} **${stats.unique}/${stats.maxUnique}** unique · ${AE.cards} **${stats.total}** total`,
    ];
    if (distr) header.push(`> ${distr}`);
    if (filterRarity) header.push(`> ${AE.search} Filtered to **${animeManager.RARITIES[filterRarity].name}**`);
    addTextDisplay(container, header.join('\n'));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    addTextDisplay(container, (lines.join('\n') || '*No cards in this filter.*') + `\n\n-# Page ${page + 1}/${totalPages}`);

    // Rarity filter select menu
    const filterMenu = new StringSelectMenuBuilder()
        .setCustomId('acol_filter')
        .setPlaceholder('Filter by rarity')
        .addOptions(
            new StringSelectMenuOptionBuilder().setLabel('All Rarities').setValue('all').setDefault(!filterRarity),
            ...RARITY_ORDER.map(r => new StringSelectMenuOptionBuilder()
                .setLabel(animeManager.RARITIES[r].name)
                .setValue(r)
                .setDefault(filterRarity === r)),
        );
    container.addActionRowComponents(new ActionRowBuilder().addComponents(filterMenu));

    if (totalPages > 1) {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('acol_first').setLabel('« First').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId('acol_prev').setLabel('‹ Prev').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId('acol_ind').setLabel(`${page + 1}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId('acol_next').setLabel('Next ›').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
            new ButtonBuilder().setCustomId('acol_last').setLabel('Last »').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
        ));
    }

    return { container, page, totalPages };
}

async function handleCollection(sendReply, targetUser, viewerId, page = 0, filterRarity = null) {
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, targetUser.id);
    const isSelf = targetUser.id === viewerId;

    if (playerData.collection.length === 0) {
        const container = createContainer(0xCAD7E6);
        addTextDisplay(container, [
            `## ${AE.card} Anime Collection`,
            '',
            isSelf ? `> You haven't collected any characters yet!` : `> ${targetUser.username} hasn't collected any characters yet!`,
            '',
            `-# Use \`aroll\` to start collecting anime characters`,
        ].join('\n'));
        return { message: await sendReply({ components: [container], flags: MessageFlags.IsComponentsV2 }), paginated: false };
    }

    let activeFilter = filterRarity;
    let entries = getEntries(playerData, activeFilter);
    let state = buildPage(targetUser, playerData, entries, page, activeFilter);
    const message = await sendReply({ components: [state.container], flags: MessageFlags.IsComponentsV2 });

    // Always attach a collector — the rarity filter menu is present even on a
    // single page.
    const collector = message.createMessageComponentCollector({
        filter: (i) => i.user.id === viewerId && i.customId.startsWith('acol_'),
        time: 120_000,
    });

    collector.on('collect', async (i) => {
        // Rarity filter change → rebuild the entry set from page 0.
        if (i.customId === 'acol_filter') {
            const val = i.values?.[0] || 'all';
            activeFilter = val === 'all' ? null : val;
            entries = getEntries(playerData, activeFilter);
            state = buildPage(targetUser, playerData, entries, 0, activeFilter);
            return i.update({ components: [state.container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        let p = state.page;
        if (i.customId === 'acol_first') p = 0;
        else if (i.customId === 'acol_prev') p = state.page - 1;
        else if (i.customId === 'acol_next') p = state.page + 1;
        else if (i.customId === 'acol_last') p = state.totalPages - 1;
        state = buildPage(targetUser, playerData, entries, p, activeFilter);
        await i.update({ components: [state.container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });

    collector.on('end', async () => {
        try {
            const final = buildPage(targetUser, playerData, entries, state.page, filterRarity);
            // Rebuild without buttons on expire
            const c = createContainer(0x9B59B6);
            const stats = animeManager.getCollectionStats(playerData);
            addTextDisplay(c, [`## ${AE.card} ${targetUser.username}'s Collection`, '', `> ${AE.stats} **${stats.unique}/${stats.maxUnique}** unique • ${AE.cards} **${stats.total}** cards`, '', `-# Session expired — run \`acollection\` again`].join('\n'));
            await message.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        } catch {}
    });

    return { message, paginated: true };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('acollection')
        .setDescription('View your anime character collection')
        .addUserOption(o => o.setName('user').setDescription('User to view').setRequired(false))
        .addStringOption(o => o.setName('rarity').setDescription('Filter by rarity')
            .addChoices(
                { name: 'Common', value: 'common' },
                { name: 'Uncommon', value: 'uncommon' },
                { name: 'Rare', value: 'rare' },
                { name: 'Epic', value: 'epic' },
                { name: 'Legendary', value: 'legendary' },
                { name: 'Mythic', value: 'mythic' },
            ).setRequired(false)),
    prefix: 'acollection',
    description: 'View your or another user\'s anime character collection',
    usage: 'acollection [@user] [rarity]',
    aliases: ['ac', 'cards', 'mycards', 'animecards'],
    category: 'anime',

    async executePrefix(message, args) {
        const target = (await resolveUser(message, args)) || message.author;
        let rarity = null;
        for (const a of args) {
            if (RARITY_ORDER.includes(a.toLowerCase())) { rarity = a.toLowerCase(); break; }
        }
        return handleCollection(message.reply.bind(message), target, message.author.id, 0, rarity);
    },

    async execute(interaction) {
        const target = interaction.options?.getUser('user') || interaction.user;
        const rarity = interaction.options?.getString('rarity') || null;
        await interaction.deferReply();
        return handleCollection(
            (payload) => interaction.editReply(payload),
            target, interaction.user.id, 0, rarity
        );
    },
};
