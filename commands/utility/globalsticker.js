'use strict';

const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
    ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
    SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, StringSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const {
    buildErrorResponse, buildPermissionDenied, buildExpiredPanel,
    BRANDING, COLORS,
} = require('../../utils/responseBuilder');
const {
    flattenStickers, fetchStickerById, parseStickerIdInput,
    explainStickerError, pickStickerTag, sanitizeStickerName,
    setScan, getScan, clearScan, TIMEOUT_MS,
    EMOJIS: E,
} = require('../../utils/globalAssetBrowser');

// Discord caps a Components V2 message at 40 total components (containers,
// sections, separators, action rows, buttons, etc. all counted). The browser
// chrome (header, separators, 3 action rows + buttons, footer) burns ~19
// slots, and each sticker entry costs 3 (section + text display + thumbnail).
// PAGE_SIZE = 5 keeps us at ~34/40 once the inter-item separators are
// removed (see render loop below) — comfortable headroom under the cap.
const PAGE_SIZE = 5;
const ID_PREFIX = 'gstick';
const STEAL_LIMIT = 5;

function escapeMd(text) {
    return String(text || '').replace(/[*_~`|>\\]/g, m => `\\${m}`);
}

function checkExpressionPerms(member) {
    return !!(
        member?.permissions?.has(PermissionFlagsBits.ManageGuildExpressions) ||
        member?.permissions?.has(PermissionFlagsBits.Administrator)
    );
}

function hasFilters(opts) {
    return !!(opts.search || opts.guildFilter);
}

/* ─────────────────────── Page rendering ─────────────────────── */

function buildBrowserPayload(state) {
    const { items, page, totalPages, opts, guildsScanned } = state;
    const start = page * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);

    const container = new ContainerBuilder().setAccentColor(COLORS.PURPLE || 0x9B59B6);

    let header = `# ${E.sticker} Global Sticker Library\n`;
    if (items.length === 0) {
        header += `-# No stickers matched your filters across **${guildsScanned}** server${guildsScanned === 1 ? '' : 's'}.`;
    } else {
        header += `-# Showing **${start + 1}-${start + slice.length}** of **${items.length}** stickers across **${guildsScanned}** server${guildsScanned === 1 ? '' : 's'}`;
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));

    const filterChips = [];
    if (opts.search) filterChips.push(`\`search: ${opts.search}\``);
    if (opts.guildFilter) filterChips.push(`\`guild: ${opts.guildFilter}\``);
    if (filterChips.length > 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Filters: ${filterChips.join(' • ')}`));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    if (slice.length === 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `*Nothing matches the current filters.*\n\n` +
            `Try **Search** with different terms, or **Reset** to clear filters.`
        ));
    } else {
        for (let i = 0; i < slice.length; i++) {
            const s = slice[i];
            const idx = String(start + i + 1).padStart(3, '0');
            const tagPreview = s.tags ? `\`${s.tags.slice(0, 60)}\`` : '*none*';
            const desc = s.description ? `\n> *${escapeMd(s.description.slice(0, 120))}*` : '';

            const section = new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `\`${idx}.\` **${escapeMd(s.name)}**\n` +
                    `> Format: \`${s.formatLabel}\` • Tags: ${tagPreview}\n` +
                    `> Server: **${escapeMd(s.guildName)}** • ID: \`${s.id}\`` +
                    desc
                ))
                .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: s.url } }));
            container.addSectionComponents(section);
            // Note: previously a spacing-only separator was inserted between
            // entries. Removed to stay under Discord's 40-component CV2 cap —
            // sections render with their own padding.
        }
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_first`).setLabel('First').setStyle(ButtonStyle.Secondary).setDisabled(page === 0 || items.length === 0),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_prev`).setLabel('Prev').setStyle(ButtonStyle.Primary).setEmoji(E.prev).setDisabled(page === 0 || items.length === 0),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_indicator`).setLabel(`${items.length === 0 ? 0 : page + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_next`).setLabel('Next').setStyle(ButtonStyle.Primary).setEmoji(E.next).setDisabled(page >= totalPages - 1 || items.length === 0),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_last`).setLabel('Last').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1 || items.length === 0),
    ));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_search`).setLabel('Search').setStyle(ButtonStyle.Primary).setEmoji(E.search),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_byid`).setLabel('Steal by ID').setStyle(ButtonStyle.Success).setEmoji(E.byid),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_reset`).setLabel('Reset').setStyle(ButtonStyle.Secondary).setEmoji(E.reset).setDisabled(!hasFilters(opts)),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_help`).setLabel('Help').setStyle(ButtonStyle.Secondary).setEmoji(E.help),
    ));

    if (slice.length > 0) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(`${ID_PREFIX}_steal`)
            .setPlaceholder('Pick one or more stickers on this page to steal')
            .setMinValues(1)
            .setMaxValues(Math.min(slice.length, STEAL_LIMIT))
            .addOptions(slice.map((s, i) => ({
                label: s.name.slice(0, 100),
                description: `${s.formatLabel} • ${s.guildName}`.slice(0, 100),
                value: String(start + i),
            })));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# ${E.bulb} Server boost level limits sticker slots • `
    ));

    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/* ─────────────────────── Help ─────────────────────── */

function buildHelpPayload(browserPage) {
    const container = new ContainerBuilder().setAccentColor(COLORS.PURPLE || 0x9B59B6);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${E.sticker} Global Sticker — How to Use`));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### ${E.book} Browse\n` +
        `${E.bullet} Use **Prev / Next** to flip through pages\n` +
        `${E.bullet} Each entry shows a thumbnail, name, format, server, and ID\n\n` +
        `### ${E.search} Search\n` +
        `${E.bullet} Click **Search** to filter by name, tag, or description\n` +
        `${E.bullet} Or filter to a specific server with the second field\n` +
        `${E.bullet} Click **Reset** to clear all filters\n\n` +
        `### ${E.success} Steal from this page\n` +
        `${E.bullet} Pick one or more stickers from the dropdown — they're added to **this server**\n` +
        `${E.bullet} Up to **${STEAL_LIMIT}** at a time\n` +
        `${E.bullet} Lottie stickers are skipped automatically (Discord doesn't allow cloning them)\n\n` +
        `### ${E.byid} Steal by ID\n` +
        `${E.bullet} Click **Steal by ID** and paste one or more values:\n` +
        `> • Bare sticker IDs: \`123456789012345678\`\n` +
        `> • Sticker URLs: \`cdn.discordapp.com/stickers/123…\`\n` +
        `> • Mix and match, separated by **spaces, commas, or new lines**\n` +
        `${E.bullet} Works for stickers from **any** server — even ones the bot isn't in\n\n` +
        `### ${E.settings} Slash equivalents\n` +
        `${E.bullet} \`/globalsticker browse search:<text>\` — search & filter\n` +
        `${E.bullet} \`/globalsticker steal-id ids:<id1 id2 …>\` — steal by ID\n\n` +
        `### ${E.bulb} Notes\n` +
        `${E.bullet} The bot's internal sticker servers are hidden\n` +
        `${E.bullet} Free servers can hold 5 stickers, Tier 1 has 15, Tier 2 has 30, Tier 3 has 60\n` +
        `${E.bullet} You need **Manage Expressions** permission\n` +
        `${E.bullet} Sessions expire after **5 minutes** of inactivity`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_back:${browserPage}`).setLabel('Back to browser').setStyle(ButtonStyle.Secondary).setEmoji(E.back),
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/* ─────────────────────── Steal results ─────────────────────── */

function buildStealResultPayload(ok, fail, browserPage) {
    const lines = [];
    if (ok.length > 0) {
        lines.push(`### ${E.success} Added (${ok.length})`);
        for (const { sticker, source } of ok) {
            const provenance = source.guildName === 'Direct ID' ? 'via direct ID' : `from **${escapeMd(source.guildName)}**`;
            lines.push(`> **${escapeMd(sticker.name)}** \`(${source.formatLabel})\` — ${provenance}`);
        }
    }
    if (fail.length > 0) {
        if (lines.length > 0) lines.push('');
        lines.push(`### ${E.error} Failed (${fail.length})`);
        for (const { source, reason } of fail) {
            lines.push(`> **${escapeMd(source.name || 'unknown')}** (\`${source.id}\`) — ${reason}`);
        }
    }

    const accent = ok.length > 0 ? 0x57F287 : (COLORS.ERROR || 0xED4245);
    const container = new ContainerBuilder().setAccentColor(accent);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${E.sticker} Sticker Steal Results\n` +
        `-# ${ok.length} succeeded, ${fail.length} failed`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n') || '*No stickers were processed.*'));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_back:${browserPage}`).setLabel('Back to browser').setStyle(ButtonStyle.Secondary).setEmoji(E.back),
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/* ─────────────────────── Steal logic ─────────────────────── */

async function performSteal(guild, actor, picks) {
    const ok = [];
    const fail = [];
    for (const source of picks) {
        if (source.format === 3) {
            fail.push({ source, reason: 'Lottie stickers cannot be cloned' });
            continue;
        }
        try {
            const created = await guild.stickers.create({
                file: source.cdnUrl,
                name: sanitizeStickerName(source.name, 'sticker'),
                tags: pickStickerTag(source),
                description: (source.description || '').slice(0, 100) || undefined,
                reason: `Stolen via globalsticker by ${actor.username}`,
            });
            ok.push({ sticker: created, source });
        } catch (err) {
            fail.push({ source, reason: explainStickerError(err) });
        }
    }
    return { ok, fail };
}

async function resolveByIds(client, parsedIds) {
    const resolved = [];
    const missing = [];
    for (const entry of parsedIds.slice(0, STEAL_LIMIT)) {
        // Cache lookup first.
        let cached = null;
        for (const guild of client.guilds.cache.values()) {
            const s = guild.stickers.cache.get(entry.id);
            if (s) { cached = { s, guild }; break; }
        }
        if (cached) {
            const ext = cached.s.format === 4 ? 'gif' : 'png';
            resolved.push({
                id: cached.s.id,
                name: cached.s.name,
                tags: cached.s.tags || '',
                description: cached.s.description || '',
                format: cached.s.format,
                formatLabel: cached.s.format === 4 ? 'GIF' : cached.s.format === 2 ? 'APNG' : 'PNG',
                guildId: cached.guild.id,
                guildName: cached.guild.name,
                url: `https://media.discordapp.net/stickers/${cached.s.id}.${ext}?size=320`,
                cdnUrl: `https://cdn.discordapp.com/stickers/${cached.s.id}.${ext}`,
            });
            continue;
        }
        const probed = await fetchStickerById(client, entry.id);
        if (probed) resolved.push(probed);
        else missing.push({ id: entry.id });
    }
    return { resolved, missing };
}

/* ─────────────────────── Modals ─────────────────────── */

function buildSearchModal() {
    return new ModalBuilder()
        .setCustomId(`${ID_PREFIX}_search_modal`)
        .setTitle('Search Global Stickers')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('q')
                    .setLabel('Sticker name, tag, or description')
                    .setPlaceholder('e.g. happy, anime, cat — leave blank to clear')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(100),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('guild')
                    .setLabel('Server name or ID (optional)')
                    .setPlaceholder('e.g. xnico, 123456789012345678')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(100),
            ),
        );
}

function buildIdModal() {
    return new ModalBuilder()
        .setCustomId(`${ID_PREFIX}_byid_modal`)
        .setTitle('Steal Stickers by ID')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('ids')
                    .setLabel(`Sticker IDs or URLs (max ${STEAL_LIMIT})`)
                    .setPlaceholder('123…  •  cdn.discordapp.com/stickers/123…  • separated by space, comma, newline')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(2000),
            ),
        );
}

/* ─────────────────────── Collector ─────────────────────── */

function attachCollector(panelMessage, ownerId) {
    const collector = panelMessage.createMessageComponentCollector({
        filter: (i) => i.user.id === ownerId && i.customId.startsWith(`${ID_PREFIX}_`),
        time: TIMEOUT_MS,
    });

    collector.on('collect', async (i) => {
        const state = getScan(panelMessage.id);
        if (!state) {
            await i.update({ components: [buildExpiredPanel('globalsticker')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return;
        }

        if (i.customId === `${ID_PREFIX}_first`) state.page = 0;
        else if (i.customId === `${ID_PREFIX}_prev`)  state.page = Math.max(0, state.page - 1);
        else if (i.customId === `${ID_PREFIX}_next`)  state.page = Math.min(state.totalPages - 1, state.page + 1);
        else if (i.customId === `${ID_PREFIX}_last`)  state.page = state.totalPages - 1;
        else if (i.customId.startsWith(`${ID_PREFIX}_back:`)) {
            state.page = parseInt(i.customId.split(':')[1] || '0', 10) || 0;
        }
        else if (i.customId === `${ID_PREFIX}_help`) {
            await i.update(buildHelpPayload(state.page)).catch(() => {});
            return;
        }
        else if (i.customId === `${ID_PREFIX}_reset`) {
            state.opts.search = '';
            state.opts.guildFilter = '';
            applyFilters(i.client, state);
        }
        else if (i.customId === `${ID_PREFIX}_search`) {
            await i.showModal(buildSearchModal()).catch(() => {});
            return;
        }
        else if (i.customId === `${ID_PREFIX}_byid`) {
            if (!checkExpressionPerms(i.member)) {
                await i.reply({ components: [buildPermissionDenied('Manage Expressions')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
                return;
            }
            await i.showModal(buildIdModal()).catch(() => {});
            return;
        }
        else if (i.customId === `${ID_PREFIX}_steal`) {
            if (!checkExpressionPerms(i.member)) {
                await i.reply({ components: [buildPermissionDenied('Manage Expressions')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
                return;
            }
            const indices = i.values.map(v => parseInt(v, 10)).filter(n => !isNaN(n));
            const picks = indices.map(idx => state.items[idx]).filter(Boolean);
            if (picks.length === 0) {
                await i.deferUpdate().catch(() => {});
                return;
            }
            await i.deferUpdate().catch(() => {});
            const { ok, fail } = await performSteal(i.guild, i.user, picks);
            await panelMessage.edit(buildStealResultPayload(ok, fail, state.page)).catch(() => {});
            return;
        }
        else {
            await i.deferUpdate().catch(() => {});
            return;
        }

        await i.update(buildBrowserPayload(state)).catch(() => {});
    });

    const modalHandler = async (modalInteraction) => {
        if (!modalInteraction.isModalSubmit()) return;
        if (modalInteraction.user.id !== ownerId) return;
        if (!modalInteraction.customId.startsWith(`${ID_PREFIX}_`)) return;
        const state = getScan(panelMessage.id);
        if (!state) return;

        if (modalInteraction.customId === `${ID_PREFIX}_search_modal`) {
            const q = modalInteraction.fields.getTextInputValue('q')?.trim() || '';
            const guildVal = modalInteraction.fields.getTextInputValue('guild')?.trim() || '';
            state.opts.search = q;
            state.opts.guildFilter = guildVal;
            applyFilters(modalInteraction.client, state);
            await modalInteraction.update(buildBrowserPayload(state)).catch(() => {});
            return;
        }

        if (modalInteraction.customId === `${ID_PREFIX}_byid_modal`) {
            if (!checkExpressionPerms(modalInteraction.member)) {
                await modalInteraction.reply({ components: [buildPermissionDenied('Manage Expressions')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
                return;
            }
            const raw = modalInteraction.fields.getTextInputValue('ids') || '';
            const parsed = parseStickerIdInput(raw);
            if (parsed.length === 0) {
                await modalInteraction.reply({
                    components: [buildErrorResponse(
                        'No IDs Found',
                        'Provide one or more sticker IDs or URLs.',
                        'Examples:\n`123456789012345678`\n`cdn.discordapp.com/stickers/123456789012345678.png`'
                    )],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                }).catch(() => {});
                return;
            }
            await modalInteraction.deferUpdate().catch(() => {});
            const { resolved, missing } = await resolveByIds(modalInteraction.client, parsed);
            const { ok, fail } = await performSteal(modalInteraction.guild, modalInteraction.user, resolved);
            for (const m of missing) {
                fail.push({ source: { id: m.id, name: 'unknown' }, reason: 'No sticker found at that ID' });
            }
            await panelMessage.edit(buildStealResultPayload(ok, fail, state.page)).catch(() => {});
        }
    };
    panelMessage.client.on('interactionCreate', modalHandler);

    collector.on('end', async () => {
        panelMessage.client.removeListener('interactionCreate', modalHandler);
        clearScan(panelMessage.id);
        const expired = buildExpiredPanel('globalsticker');
        await panelMessage.edit({ components: [expired], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });
}

function applyFilters(client, state) {
    const { items, guildsScanned } = flattenStickers(client, state.opts);
    state.items = items;
    state.guildsScanned = guildsScanned;
    state.totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    state.page = 0;
}

/* ─────────────────────── Entrypoints ─────────────────────── */

async function runBrowser(client, opts, replyHandle) {
    const { items, guildsScanned } = flattenStickers(client, opts);
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const state = { items, page: 0, totalPages, opts, guildsScanned };
    const payload = buildBrowserPayload(state);

    const panelMessage = await replyHandle(payload);
    if (!panelMessage) return;
    setScan(panelMessage.id, state);
    attachCollector(panelMessage, opts.ownerId);
}

async function runStealById(client, guild, user, rawInput, replyHandle) {
    const parsed = parseStickerIdInput(rawInput);
    if (parsed.length === 0) {
        const container = buildErrorResponse(
            'No IDs Found',
            'Provide one or more sticker IDs or URLs.',
            'Examples:\n`123456789012345678`\n`cdn.discordapp.com/stickers/123456789012345678.png`\nMix snowflakes & URLs, separated by spaces, commas, or newlines.'
        );
        await replyHandle({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return;
    }
    const { resolved, missing } = await resolveByIds(client, parsed);
    const { ok, fail } = await performSteal(guild, user, resolved);
    for (const m of missing) {
        fail.push({ source: { id: m.id, name: 'unknown' }, reason: 'No sticker found at that ID' });
    }
    await replyHandle(buildStealResultPayload(ok, fail, 0));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('globalsticker')
        .setDescription('Browse every sticker across the bot’s servers and steal what you like')
        .addSubcommand(s => s
            .setName('browse')
            .setDescription('Open the interactive sticker browser with search & pagination')
            .addStringOption(o => o.setName('search').setDescription('Filter by sticker name, tag, or description'))
            .addStringOption(o => o.setName('guild').setDescription('Filter by server name or ID')))
        .addSubcommand(s => s
            .setName('steal-id')
            .setDescription('Steal one or more stickers directly by their ID or URL')
            .addStringOption(o => o.setName('ids').setDescription('IDs or URLs, separated by spaces/commas/newlines').setRequired(true)))
        .addSubcommand(s => s
            .setName('help')
            .setDescription('How to use globalsticker')),

    prefix: 'globalsticker',
    description: 'Browse every sticker across the bot’s servers and steal by name or ID',
    usage: 'globalsticker [search] [-g <guild>]  •  globalsticker id <ids…>',
    category: 'utility',
    aliases: ['gsticker', 'stickerbrowse', 'allstickers'],
    permissions: ['ManageGuildExpressions'],

    async execute(interaction) {
        if (!checkExpressionPerms(interaction.member)) {
            return interaction.reply({
                components: [buildPermissionDenied('Manage Expressions')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        const sub = interaction.options.getSubcommand();
        if (sub === 'help') {
            return interaction.reply({ ...buildHelpPayload(0), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        if (sub === 'steal-id') {
            const raw = interaction.options.getString('ids');
            await interaction.deferReply();
            await runStealById(interaction.client, interaction.guild, interaction.user, raw, async (payload) => {
                return interaction.editReply(payload);
            });
            return;
        }

        const opts = {
            search: interaction.options.getString('search') || '',
            guildFilter: interaction.options.getString('guild') || '',
            ownerId: interaction.user.id,
        };
        await interaction.deferReply();
        await runBrowser(interaction.client, opts, async (payload) => {
            return interaction.editReply(payload);
        });
    },

    async executePrefix(message, args) {
        if (!message.guild) {
            return message.reply(`${E.error} This command can only be used in a server.`).catch(() => {});
        }
        if (!checkExpressionPerms(message.member)) {
            return message.reply({ components: [buildPermissionDenied('Manage Expressions')], flags: MessageFlags.IsComponentsV2 });
        }

        const sub = (args[0] || '').toLowerCase();
        if (sub === 'help' || sub === '--help' || sub === '-h') {
            return message.reply({ ...buildHelpPayload(0), flags: MessageFlags.IsComponentsV2 });
        }
        if (sub === 'id' || sub === 'ids' || sub === 'steal-id') {
            const raw = args.slice(1).join(' ');
            return runStealById(message.client, message.guild, message.author, raw, async (payload) => {
                return message.reply(payload);
            });
        }

        const opts = parsePrefixArgs(args);
        opts.ownerId = message.author.id;
        await runBrowser(message.client, opts, async (payload) => {
            return message.reply(payload);
        });
    },
};

function parsePrefixArgs(args) {
    const opts = { search: '', guildFilter: '' };
    const remaining = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-g' || a === '--guild') { opts.guildFilter = args[i + 1] || ''; i++; }
        else remaining.push(a);
    }
    opts.search = remaining.join(' ').trim();
    return opts;
}
