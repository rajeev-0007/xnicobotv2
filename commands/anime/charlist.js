'use strict';

const { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');

const CHARS_PER_PAGE = 15;
const RARITY_ORDER = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];

function getChars(filterRarity, filterAnime) {
    let chars = [...animeManager.CHARACTERS];
    if (filterRarity) chars = chars.filter(c => c.rarity === filterRarity);
    if (filterAnime) {
        const lower = filterAnime.toLowerCase();
        chars = chars.filter(c => c.anime.toLowerCase().includes(lower));
    }
    chars.sort((a, b) => {
        const ra = RARITY_ORDER.indexOf(a.rarity);
        const rb = RARITY_ORDER.indexOf(b.rarity);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
    });
    return chars;
}

function buildPage(chars, page, filterRarity, filterAnime) {
    const totalPages = Math.max(1, Math.ceil(chars.length / CHARS_PER_PAGE));
    page = Math.max(0, Math.min(page, totalPages - 1));
    const pageChars = chars.slice(page * CHARS_PER_PAGE, (page + 1) * CHARS_PER_PAGE);

    const lines = pageChars.map(char => {
        const rarity = animeManager.RARITIES[char.rarity];
        return `${rarity.emoji} **${char.name}** — *${char.anime}*`;
    });

    const uniqueAnime = [...new Set(animeManager.CHARACTERS.map(c => c.anime))].length;

    const container = createContainer(0xCAD7E6);
    addTextDisplay(container, [
        `## ${AE.book} Character Database`,
        '',
        `> **${animeManager.CHARACTERS.length}** characters from **${uniqueAnime}** anime`,
        '',
        lines.join('\n') || '*No characters match the filter.*',
        '',
        filterRarity ? `-# Filter: ${animeManager.RARITIES[filterRarity].emoji} ${animeManager.RARITIES[filterRarity].name}` : '',
        filterAnime ? `-# Filter: "${filterAnime}"` : '',
        `-# Page ${page + 1}/${totalPages}`,
    ].filter(Boolean).join('\n'));

    if (totalPages > 1) {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('acl_first').setEmoji('<:Caretleft:1521227977495543838>').setLabel('First').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId('acl_prev').setLabel('Prev').setStyle(ButtonStyle.Primary).setDisabled(page === 0),
            new ButtonBuilder().setCustomId('acl_ind').setLabel(`${page + 1}/${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId('acl_next').setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(page >= totalPages - 1),
            new ButtonBuilder().setCustomId('acl_last').setEmoji('<:Caretright:1521227704953864202>').setLabel('Last').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
        ));
    }

    return { container, page, totalPages };
}

async function handleCharList(sendReply, viewerId, page = 0, filterRarity = null, filterAnime = null) {
    const chars = getChars(filterRarity, filterAnime);
    let state = buildPage(chars, page, filterRarity, filterAnime);
    const message = await sendReply({ components: [state.container], flags: MessageFlags.IsComponentsV2 });

    if (state.totalPages <= 1) return;

    const collector = message.createMessageComponentCollector({
        filter: (i) => i.user.id === viewerId && i.customId.startsWith('acl_'),
        time: 120_000,
    });

    collector.on('collect', async (i) => {
        let p = state.page;
        if (i.customId === 'acl_first') p = 0;
        else if (i.customId === 'acl_prev') p = state.page - 1;
        else if (i.customId === 'acl_next') p = state.page + 1;
        else if (i.customId === 'acl_last') p = state.totalPages - 1;
        state = buildPage(chars, p, filterRarity, filterAnime);
        await i.update({ components: [state.container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('acharlist')
        .setDescription('Browse all available anime characters')
        .addStringOption(o => o.setName('rarity').setDescription('Filter by rarity')
            .addChoices(
                { name: 'Common', value: 'common' },
                { name: 'Uncommon', value: 'uncommon' },
                { name: 'Rare', value: 'rare' },
                { name: 'Epic', value: 'epic' },
                { name: 'Legendary', value: 'legendary' },
                { name: 'Mythic', value: 'mythic' },
            ).setRequired(false))
        .addStringOption(o => o.setName('anime').setDescription('Filter by anime name').setRequired(false)),
    prefix: 'acharlist',
    description: 'Browse all available anime characters in the gacha pool',
    usage: 'acharlist [rarity] [anime]',
    aliases: ['acl', 'charlist', 'animelist'],
    category: 'anime',

    async executePrefix(message, args) {
        let rarity = null;
        let anime = null;
        for (let i = 0; i < args.length; i++) {
            if (RARITY_ORDER.includes(args[i].toLowerCase())) rarity = args[i].toLowerCase();
            else if (args[i] === '--anime' || args[i] === '-a') { anime = args.slice(i + 1).join(' '); break; }
        }
        if (!rarity && !anime && args.length > 0) anime = args.join(' ');
        return handleCharList(message.reply.bind(message), message.author.id, 0, rarity, anime);
    },

    async execute(interaction) {
        const rarity = interaction.options?.getString('rarity') || null;
        const anime = interaction.options?.getString('anime') || null;
        await interaction.deferReply();
        return handleCharList(
            (payload) => interaction.editReply(payload),
            interaction.user.id, 0, rarity, anime
        );
    },
};
