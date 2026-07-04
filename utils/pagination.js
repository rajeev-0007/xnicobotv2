/**
 * Reusable pagination helper for Discord Components V2.
 *
 * Usage:
 *   const { paginate } = require('../../utils/pagination');
 *   const reply = await message.reply(paginate({ ... }));
 *   setupPaginationCollector(reply, pages, userId, buildPage);
 */
const {
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags
} = require('discord.js');
const { buildExpiredPanel } = require('./responseBuilder');

const TIMEOUT = 120_000; // 2 minute interaction timeout

/**
 * Split an array into pages.
 * @param {any[]} items
 * @param {number} perPage
 * @returns {any[][]}
 */
function chunk(items, perPage) {
    const pages = [];
    for (let i = 0; i < items.length; i += perPage) {
        pages.push(items.slice(i, i + perPage));
    }
    return pages;
}

/**
 * Build pagination buttons row.
 * @param {string} prefix  Unique prefix for button custom IDs
 * @param {number} page    Current page index (0-based)
 * @param {number} total   Total number of pages
 * @returns {ActionRowBuilder}
 */
function paginationButtons(prefix, page, total) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${prefix}_first`)
            .setLabel('≪')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`${prefix}_prev`)
            .setLabel('◀')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId(`${prefix}_indicator`)
            .setLabel(`${page + 1} / ${total}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`${prefix}_next`)
            .setLabel('▶')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page >= total - 1),
        new ButtonBuilder()
            .setCustomId(`${prefix}_last`)
            .setLabel('≫')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= total - 1)
    );
}

/**
 * Build a paginated container.
 *
 * @param {object}   opts
 * @param {string}   opts.header        Title / header markdown (always shown)
 * @param {string[]} opts.lines         All formatted lines
 * @param {number}   [opts.perPage=10]  Lines per page
 * @param {number}   [opts.page=0]      Current page (0-based)
 * @param {number}   [opts.accentColor] Container accent color
 * @param {string}   [opts.footer]      Optional footer text
 * @param {string}   [opts.prefix]      Button ID prefix (auto-generated if omitted)
 * @returns {{ components: ContainerBuilder[], flags: number, _pageData: object }}
 */
function paginate(opts) {
    const {
        header,
        lines,
        perPage = 10,
        page = 0,
        accentColor = 0xCAD7E6,
        footer = null,
        prefix = `page_${Date.now().toString(36)}`
    } = opts;

    const pages = chunk(lines, perPage);
    const totalPages = Math.max(pages.length, 1);
    const currentPage = Math.min(page, totalPages - 1);
    const pageLines = pages[currentPage] || [];

    const container = new ContainerBuilder().setAccentColor(accentColor);

    // Header
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    // Page content
    if (pageLines.length > 0) {
        // Discord caps each TextDisplay at 4 000 characters. With a long
        // header, custom emojis (each ~25 chars) and many lines per page,
        // the join can exceed that and the API rejects the whole panel.
        // Trim conservatively (~3 800 chars) so the header & footer still fit.
        const PAGE_TEXT_BUDGET = 3800;
        const joined = pageLines.join('\n');
        const safeJoined = joined.length > PAGE_TEXT_BUDGET
            ? joined.slice(0, PAGE_TEXT_BUDGET - 60) +
              `\n-# *…line truncated to fit 4 000-char Discord limit*`
            : joined;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(safeJoined));
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*No entries*'));
    }

    // Pagination buttons (only if multiple pages)
    if (totalPages > 1) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addActionRowComponents(paginationButtons(prefix, currentPage, totalPages));
    }

    // Footer
    if (footer) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
    }

    return {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        _pageData: { prefix, lines, perPage, header, accentColor, footer, totalPages }
    };
}

/**
 * Attach a collector to a sent message to handle pagination button clicks.
 *
 * @param {Message}  sentMessage   The reply message returned by message.reply()
 * @param {object}   pageData      The _pageData from paginate()
 * @param {string}   userId        The user who can interact
 * @param {number}   [timeout]     Collector timeout in ms
 */
function setupPaginationCollector(sentMessage, pageData, userId, timeout = TIMEOUT) {
    const { prefix, lines, perPage, header, accentColor, footer, totalPages } = pageData;
    if (totalPages <= 1) return; // no need for collector

    let currentPage = 0;

    const collector = sentMessage.createMessageComponentCollector({
        filter: i => i.customId.startsWith(prefix) && i.user.id === userId,
        time: timeout
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

        const updated = paginate({ header, lines, perPage, page: currentPage, accentColor, footer, prefix });
        await i.update({ components: updated.components, flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });

    collector.on('end', async () => {
        try {
            const expired = buildExpiredPanel('the command', 'This panel timed out due to inactivity.');
            await sentMessage.edit({ components: [expired], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        } catch {}
    });

    return collector;
}

module.exports = { paginate, setupPaginationCollector, chunk, paginationButtons, TIMEOUT };
