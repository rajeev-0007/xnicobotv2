'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');

const CHARS_PER_PAGE = 15;

async function handleCharList(reply, guildId, page = 0, filterRarity = null, filterAnime = null) {
    let chars = [...animeManager.CHARACTERS];

    if (filterRarity) {
        chars = chars.filter(c => c.rarity === filterRarity);
    }
    if (filterAnime) {
        const lower = filterAnime.toLowerCase();
        chars = chars.filter(c => c.anime.toLowerCase().includes(lower));
    }

    if (chars.length === 0) {
        const container = createContainer(0xFEE75C);
        addTextDisplay(container, `## ⚠️ No Results\nNo characters found with that filter.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // Sort by rarity then name
    const rarityOrder = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];
    chars.sort((a, b) => {
        const ra = rarityOrder.indexOf(a.rarity);
        const rb = rarityOrder.indexOf(b.rarity);
        if (ra !== rb) return ra - rb;
        return a.name.localeCompare(b.name);
    });

    const totalPages = Math.ceil(chars.length / CHARS_PER_PAGE);
    page = Math.max(0, Math.min(page, totalPages - 1));
    const pageChars = chars.slice(page * CHARS_PER_PAGE, (page + 1) * CHARS_PER_PAGE);

    const lines = pageChars.map(char => {
        const rarity = animeManager.RARITIES[char.rarity];
        return `${rarity.emoji} **${char.name}** — *${char.anime}*`;
    });

    // Get anime list for info
    const uniqueAnime = [...new Set(animeManager.CHARACTERS.map(c => c.anime))].sort();

    const container = createContainer(0xCAD7E6);
    addTextDisplay(container, [
        `## 📖 Character Database`,
        '',
        `> **${animeManager.CHARACTERS.length}** total characters from **${uniqueAnime.length}** anime series`,
        '',
        lines.join('\n'),
        '',
        filterRarity ? `-# Filter: ${animeManager.RARITIES[filterRarity].emoji} ${animeManager.RARITIES[filterRarity].name}` : '',
        filterAnime ? `-# Filter: Anime = "${filterAnime}"` : '',
        `-# Page ${page + 1}/${totalPages} • \`acharlist --page <n>\` | \`acharlist --rarity <r>\` | \`acharlist --anime <name>\``,
    ].filter(Boolean).join('\n'));

    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('acharlist')
        .setDescription('Browse all available anime characters')
        .addIntegerOption(o => o.setName('page').setDescription('Page number').setRequired(false))
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
    usage: 'acharlist [--page <n>] [--rarity <r>] [--anime <name>]',
    aliases: ['acl', 'charlist', 'animelist'],
    category: 'anime',

    async executePrefix(message, args) {
        let page = 0;
        let rarity = null;
        let anime = null;

        for (let i = 0; i < args.length; i++) {
            if ((args[i] === '--page' || args[i] === '-p') && args[i + 1]) {
                page = parseInt(args[i + 1]) - 1;
                i++;
            } else if ((args[i] === '--rarity' || args[i] === '-r') && args[i + 1]) {
                rarity = args[i + 1].toLowerCase();
                i++;
            } else if ((args[i] === '--anime' || args[i] === '-a') && args[i + 1]) {
                anime = args.slice(i + 1).join(' ');
                break;
            }
        }

        return handleCharList(message.reply.bind(message), message.guild?.id, page, rarity, anime);
    },

    async execute(interaction) {
        const page = (interaction.options?.getInteger('page') || 1) - 1;
        const rarity = interaction.options?.getString('rarity') || null;
        const anime = interaction.options?.getString('anime') || null;
        return handleCharList(interaction.reply.bind(interaction), interaction.guild?.id, page, rarity, anime);
    },
};
