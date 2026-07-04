const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

const ANILIST_URL = 'https://graphql.anilist.co';

const SEARCH_QUERY = `
query ($search: String) {
  Media(search: $search, type: ANIME) {
    id title { romaji english native }
    description(asHtml: false) status episodes duration
    averageScore genres seasonYear season
    coverImage { large } siteUrl
    studios(isMain: true) { nodes { name } }
    nextAiringEpisode { episode airingAt }
  }
}`;

function cleanDescription(desc) {
    if (!desc) return '*No description available*';
    return desc
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .substring(0, 300) + (desc.length > 300 ? '...' : '');
}

function buildAnimeContainer(anime) {
    const title = anime.title.english || anime.title.romaji || anime.title.native;
    const studio = anime.studios?.nodes?.[0]?.name || 'Unknown';
    const genres = anime.genres?.slice(0, 5).join(', ') || 'N/A';
    const statusMap = {
        FINISHED: '<:Checkedbox:1521227734943269077> Finished',
        RELEASING: '<:Bullhorn:1521227936575914016> Airing',
        NOT_YET_RELEASED: '<:Alarm:1521227869047750689> Upcoming',
        CANCELLED: '<:Cancel:1521227723916181644> Cancelled',
        HIATUS: '<:Timer:1521227971590095070> Hiatus',
    };

    const container = new ContainerBuilder().setAccentColor(0xED4245);

    const headerSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# 📺 ${title}`)
        );
    if (anime.coverImage?.large) {
        headerSection.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: anime.coverImage.large } }));
    }
    container.addSectionComponents(headerSection);

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    let info = '';
    if (anime.title.romaji && anime.title.romaji !== title) info += `**Japanese:** ${anime.title.romaji}\n`;
    info += `**Status:** ${statusMap[anime.status] || anime.status}\n`;
    info += `**Episodes:** ${anime.episodes || '?'}`;
    if (anime.duration) info += ` (${anime.duration} min/ep)`;
    info += '\n';
    info += `**Score:** ${anime.averageScore ? `<:Star:1521227981685526568> ${anime.averageScore}/100` : 'N/A'}\n`;
    info += `**Season:** ${anime.season ? `${anime.season} ${anime.seasonYear}` : 'N/A'}\n`;
    info += `**Studio:** ${studio}\n`;
    info += `**Genres:** ${genres}\n`;
    if (anime.nextAiringEpisode) {
        info += `**Next Episode:** Ep ${anime.nextAiringEpisode.episode} — <t:${anime.nextAiringEpisode.airingAt}:R>\n`;
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(info));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**Synopsis:**\n> ${cleanDescription(anime.description).replace(/\n/g, '\n> ')}`)
    );

    if (anime.siteUrl) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`[View on AniList](${anime.siteUrl})`));
    }

    return container;
}

async function searchAnime(query) {
    const res = await fetch(ANILIST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: SEARCH_QUERY, variables: { search: query } }),
    });
    if (!res.ok) throw new Error(`AniList API returned ${res.status}`);
    const data = await res.json();
    if (data.errors) throw new Error(data.errors[0]?.message || 'AniList API error');
    return data.data?.Media;
}

module.exports = {
    prefix: 'anime',
    description: 'Search for anime information on AniList',
    usage: 'anime <name>',
    category: 'basic',
    aliases: ['ani', 'animesearch'],

    data: new SlashCommandBuilder()
        .setName('anime')
        .setDescription('Search for anime information')
        .addStringOption(opt => opt.setName('query').setDescription('The anime to search for').setRequired(true)),

    async execute(interaction) {
        const query = interaction.options.getString('query');
        await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
        try {
            const anime = await searchAnime(query);
            if (!anime) {
                const err = buildErrorResponse('Not Found', `No anime found for **${query}**.`);
                return interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
            const container = buildAnimeContainer(anime);
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const err = buildErrorResponse('Error', 'Failed to search anime.', error.message);
            await interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        if (!args.length) {
            const err = buildErrorResponse('Missing Argument', 'Please provide an anime name.\n**Usage:** `anime <name>`');
            return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
        const query = args.join(' ');
        try {
            const anime = await searchAnime(query);
            if (!anime) {
                const err = buildErrorResponse('Not Found', `No anime found for **${query}**.`);
                return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
            const container = buildAnimeContainer(anime);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const err = buildErrorResponse('Error', 'Failed to search anime.', error.message);
            await message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
