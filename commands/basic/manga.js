'use strict';

/**
 * manga.js — prefix-only.
 * Searches AniList for a manga and renders a Components V2 card.
 */

const { ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { buildErrorResponse } = require('../../utils/responseBuilder');

const ANILIST_URL = 'https://graphql.anilist.co';

const SEARCH_QUERY = `
query ($search: String) {
  Media(search: $search, type: MANGA) {
    id title { romaji english native }
    description(asHtml: false) status chapters volumes
    averageScore genres startDate { year month }
    coverImage { large } siteUrl
    staff(sort: RELEVANCE, perPage: 1) { nodes { name { full } } }
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

function buildMangaContainer(manga) {
    const title = manga.title.english || manga.title.romaji || manga.title.native;
    const author = manga.staff?.nodes?.[0]?.name?.full || 'Unknown';
    const genres = manga.genres?.slice(0, 5).join(', ') || 'N/A';
    const statusMap = {
        FINISHED:         '<:Checkedbox:1521227734943269077> Completed',
        RELEASING:        '<:Bullhorn:1521227936575914016> Publishing',
        NOT_YET_RELEASED: '<:Alarm:1521227869047750689> Upcoming',
        CANCELLED:        '<:Cancel:1521227723916181644> Cancelled',
        HIATUS:           '<:Timer:1521227971590095070> Hiatus',
    };

    const container = new ContainerBuilder();

    const headerSection = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Bookopen:1521227911137595605> ${title}`));
    if (manga.coverImage?.large) {
        headerSection.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: manga.coverImage.large } }));
    }
    container.addSectionComponents(headerSection);
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    let info = '';
    if (manga.title.romaji && manga.title.romaji !== title) info += `<:Caretright:1521227704953864202> **Japanese:** ${manga.title.romaji}\n`;
    info += `<:Caretright:1521227704953864202> **Status:** ${statusMap[manga.status] || manga.status}\n`;
    info += `<:Caretright:1521227704953864202> **Chapters:** ${manga.chapters || '?'}`;
    if (manga.volumes) info += ` (${manga.volumes} vol)`;
    info += '\n';
    info += `<:Caretright:1521227704953864202> **Score:** ${manga.averageScore ? `<:Star:1521227981685526568> ${manga.averageScore}/100` : 'N/A'}\n`;
    info += `<:Caretright:1521227704953864202> **Author:** ${author}\n`;
    info += `<:Caretright:1521227704953864202> **Genres:** ${genres}\n`;
    if (manga.startDate?.year) info += `<:Caretright:1521227704953864202> **Started:** ${manga.startDate.year}\n`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(info));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**Synopsis:**\n> ${cleanDescription(manga.description).replace(/\n/g, '\n> ')}`)
    );

    if (manga.siteUrl) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`[View on AniList](${manga.siteUrl})`));
    }
    return container;
}

async function searchManga(query) {
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
    name: 'manga',
    prefix: 'manga',
    aliases: ['mangasearch'],
    description: 'Search for manga information on AniList',
    usage: 'manga <name>',
    category: 'basic',

    async executePrefix(message, args) {
        if (!args.length) {
            const err = buildErrorResponse('Missing Argument', 'Please provide a manga name.\n**Usage:** `manga <name>`');
            return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
        const query = args.join(' ');
        try {
            const manga = await searchManga(query);
            if (!manga) {
                const err = buildErrorResponse('Not Found', `No manga found for **${query}**.`);
                return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
            const container = buildMangaContainer(manga);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const err = buildErrorResponse('Error', 'Failed to search manga.', error.message);
            await message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
