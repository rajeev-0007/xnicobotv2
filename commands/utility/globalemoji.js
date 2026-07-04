'use strict';

/**
 * globalemoji — interactive cross-server emoji browser & cloner.
 *
 * UI design notes
 * ───────────────
 * The previous version rendered each emoji as its own SectionBuilder
 * with a ThumbnailBuilder accessory. That worked but it looked busy
 * (one chunky preview tile per row, jagged spacing, 3-component cost
 * per entry against Discord's 40-component CV2 cap). The new layout
 * uses a single dense markdown table inside one TextDisplayBuilder
 * — every entry is a one-liner with type/state/server/ID and a live
 * inline emoji preview when usable. That keeps the panel readable
 * and roughly halves the component budget so we can fit 12 entries
 * per page without nearing the cap.
 *
 * Each row format:
 *   01. <:name:id>  `:name:`
 *   ` ` type · state · server · ID
 */

const {
    SlashCommandBuilder, PermissionFlagsBits, MessageFlags,
    ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const {
    buildErrorResponse, buildPermissionDenied, buildExpiredPanel,
    BRANDING, COLORS,
} = require('../../utils/responseBuilder');
const {
    flattenEmojis, fetchEmojiById, parseEmojiIdInput,
    explainEmojiError, sanitizeName,
    setScan, getScan, clearScan, TIMEOUT_MS,
    EMOJIS: E,
} = require('../../utils/globalAssetBrowser');

// Component budget: header(1) + filters(1) + sep(1) + table(1) + sep(1)
// + nav(1) + actions(1) + steal-select(1) + sep(1) + footer(1) = 10.
// Inside the container that's well under the 40-cap, so we can comfortably
// list more entries per page than the old per-section layout allowed.
const PAGE_SIZE = 12;
const ID_PREFIX = 'gemoji';
const STEAL_LIMIT = 10;

/* ───────────────────────── Helpers ───────────────────────── */

function escapeMd(text) {
    return String(text || '').replace(/[*_~`|>\\]/g, m => `\\${m}`);
}

function checkExpressionPerms(member) {
    return !!(
        member?.permissions?.has(PermissionFlagsBits.ManageGuildExpressions) ||
        member?.permissions?.has(PermissionFlagsBits.Administrator)
    );
}

/* ─────────────────────── Page rendering ─────────────────────── */

/**
 * Render a single emoji row as a one-liner. Uses the live `<:tag:id>`
 * when the bot can actually render it (usable + accessible) so users
 * see the real preview inline; falls back to a name-only line for
 * locked/unavailable emojis with a clear badge so the row still
 * communicates what they're looking at.
 */
function renderEmojiRow(e, indexLabel) {
    const typeBadge  = e.animated
        ? `${E.animated} \`GIF\``
        : `${E.static} \`PNG\``;
    const stateBadge = !e.available
        ? `${E.unavailable} \`unavailable\``
        : e.restricted
            ? `${E.locked} \`role-locked\``
            : `${E.usable} \`usable\``;

    // Inline preview only when the bot can resolve the emoji — otherwise
    // Discord renders a literal `<:name:id>` text on the user's client
    // and it looks broken.
    const preview = e.usable ? `${e.tag} ` : '';

    return [
        `\`${indexLabel}\` ${preview}**\`:${e.name}:\`**`,
        `> ${typeBadge} • ${stateBadge} • ${escapeMd(e.guildName)} • \`${e.id}\``,
    ].join('\n');
}

function buildBrowserPayload(state) {
    const { items, page, totalPages, opts, guildsScanned } = state;
    const start = page * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);

    const container = new ContainerBuilder().setAccentColor(COLORS.INFO);

    // ── Header
    const headerLines = [`# ${E.brand} Global Emoji Library`];
    if (items.length === 0) {
        headerLines.push(`-# Scanned **${guildsScanned}** server${guildsScanned === 1 ? '' : 's'} — nothing matched your filters.`);
    } else {
        const lockedCount = items.filter(e => !e.usable).length;
        const lockedTag = lockedCount > 0 ? ` · ${lockedCount} locked` : '';
        headerLines.push(
            `-# **${start + 1}–${start + slice.length}** of **${items.length}** ` +
            `across **${guildsScanned}** server${guildsScanned === 1 ? '' : 's'}${lockedTag} ` +
            `· Page **${page + 1}/${totalPages}**`
        );
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerLines.join('\n')));

    // ── Filter chips
    const filterChips = [];
    if (opts.search) filterChips.push(`\`search: ${opts.search}\``);
    if (opts.animatedOnly) filterChips.push('`animated only`');
    if (opts.staticOnly) filterChips.push('`static only`');
    if (opts.usableOnly) filterChips.push('`usable only`');
    if (opts.lockedOnly) filterChips.push('`locked only`');
    if (opts.guildFilter) filterChips.push(`\`guild: ${opts.guildFilter}\``);
    if (filterChips.length > 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Filters: ${filterChips.join(' • ')}`));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // ── Body — all rows merged into a single TextDisplay so the
    // component budget stays predictable regardless of PAGE_SIZE.
    if (slice.length === 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `*No emojis match the current filters.*`,
            ``,
            `Use **Search** to filter by name or server, or **Reset** to clear filters.`,
        ].join('\n')));
    } else {
        const rowText = slice.map((e, i) => {
            const idx = String(start + i + 1).padStart(2, '0');
            return renderEmojiRow(e, idx);
        }).join('\n\n');
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(rowText));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // ── Navigation row
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_first`).setLabel('First').setStyle(ButtonStyle.Secondary).setDisabled(page === 0 || items.length === 0),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_prev`).setLabel('Prev').setStyle(ButtonStyle.Primary).setEmoji(E.prev).setDisabled(page === 0 || items.length === 0),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_indicator`).setLabel(`${items.length === 0 ? 0 : page + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_next`).setLabel('Next').setStyle(ButtonStyle.Primary).setEmoji(E.next).setDisabled(page >= totalPages - 1 || items.length === 0),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_last`).setLabel('Last').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1 || items.length === 0),
    ));

    // ── Action row
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_search`).setLabel('Search').setStyle(ButtonStyle.Primary).setEmoji(E.search),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_byid`).setLabel('Steal by ID').setStyle(ButtonStyle.Success).setEmoji(E.byid),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_reset`).setLabel('Reset').setStyle(ButtonStyle.Secondary).setEmoji(E.reset).setDisabled(!hasFilters(opts)),
        new ButtonBuilder().setCustomId(`${ID_PREFIX}_help`).setLabel('Help').setStyle(ButtonStyle.Secondary).setEmoji(E.help),
    ));

    // ── Steal-from-page select
    if (slice.length > 0) {
        const select = new StringSelectMenuBuilder()
            .setCustomId(`${ID_PREFIX}_steal`)
            .setPlaceholder(`Pick up to ${Math.min(slice.length, STEAL_LIMIT)} emoji${slice.length === 1 ? '' : 's'} on this page to clone`)
            .setMinValues(1)
            .setMaxValues(Math.min(slice.length, STEAL_LIMIT))
            .addOptions(slice.map((e, i) => {
                // Discord validates the option's icon against the bot's
                // accessible emojis. Locked/unavailable entries are added
                // without an icon to avoid crashing the dropdown.
                const opt = {
                    label: `:${e.name}:`.slice(0, 100),
                    description: `${e.animated ? 'GIF' : 'PNG'} • ${e.guildName}`.slice(0, 100),
                    value: String(start + i),
                };
                if (e.usable) {
                    opt.emoji = { id: e.id, name: e.name, animated: e.animated };
                }
                return opt;
            }));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# ${E.bulb} Tap **Search** to filter, **Steal by ID** to grab any emoji you have an ID for • `
    ));

    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function hasFilters(opts) {
    return !!(opts.search || opts.animatedOnly || opts.staticOnly || opts.usableOnly || opts.lockedOnly || opts.guildFilter);
}

/* ─────────────────────── Help / instructions ─────────────────────── */

function buildHelpPayload(browserPage) {
    const container = new ContainerBuilder().setAccentColor(COLORS.INFO);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${E.brand} Global Emoji — How to Use`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### ${E.book} Browse\n` +
        `${E.bullet} Use the **Prev / Next** buttons to flip through pages\n` +
        `${E.bullet} Each entry shows the emoji preview, name, server, and ID\n\n` +
        `### ${E.search} Search\n` +
        `${E.bullet} Click **Search** to open a search box\n` +
        `${E.bullet} Match by **emoji name** (e.g. \`heart\`, \`fire\`, \`pepe\`)\n` +
        `${E.bullet} Or filter to a specific server by name or ID\n` +
        `${E.bullet} Filter by **type** (\`animated\` / \`static\`) or **state** (\`usable\` / \`locked\`)\n` +
        `${E.bullet} Click **Reset** to clear all filters\n\n` +
        `### ${E.locked} Locked / unavailable emojis\n` +
        `${E.bullet} ${E.locked} \`role-locked\` — only members with specific roles in the source server can use it\n` +
        `${E.bullet} ${E.unavailable} \`unavailable\` — the source server lost a boost slot, so it's frozen\n` +
        `${E.bullet} Both render preview-only inside Discord, but they're still **stealable** — once added to your server, role restrictions don't follow them\n\n` +
        `### ${E.success} Steal from this page\n` +
        `${E.bullet} Pick one or more emojis from the dropdown — they're added to **this server**\n` +
        `${E.bullet} Up to **${STEAL_LIMIT}** at a time\n\n` +
        `### ${E.byid} Steal by ID\n` +
        `${E.bullet} Click **Steal by ID** and paste one or more values:\n` +
        `> • Bare emoji IDs: \`123456789012345678\`\n` +
        `> • Emoji tags: \`<:name:123>\` or \`<a:name:123>\`\n` +
        `> • Mix and match, separated by **spaces, commas, or new lines**\n` +
        `${E.bullet} Works even for emojis from servers the bot isn't in (as long as the ID is valid)\n` +
        `${E.bullet} Optionally rename in the same modal using the format \`123456789012345678 newname\`\n\n` +
        `### ${E.settings} Slash equivalents\n` +
        `${E.bullet} \`/globalemoji browse search:<text> animated:true\` — search & filter\n` +
        `${E.bullet} \`/globalemoji steal-id ids:<id1 id2 …>\` — steal by ID\n\n` +
        `### ${E.bulb} Notes\n` +
        `${E.bullet} The bot's internal emoji servers are hidden — only public, real servers show up\n` +
        `${E.bullet} You need **Manage Expressions** to add emojis to this server\n` +
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
        for (const { emoji, source } of ok) {
            const provenance = source.guildName === 'Direct ID' ? 'via direct ID' : `from **${escapeMd(source.guildName)}**`;
            lines.push(`> ${emoji} \`:${emoji.name}:\` — ${provenance}`);
        }
    }
    if (fail.length > 0) {
        if (lines.length > 0) lines.push('');
        lines.push(`### ${E.error} Failed (${fail.length})`);
        for (const { source, reason } of fail) {
            lines.push(`> \`:${source.name || 'unknown'}:\` (\`${source.id}\`) — ${reason}`);
        }
    }

    const accent = ok.length > 0 ? 0x57F287 : (COLORS.ERROR || 0xED4245);
    const container = new ContainerBuilder().setAccentColor(accent);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# ${E.brand} Emoji Steal Results\n` +
        `-# ${ok.length} succeeded, ${fail.length} failed`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n') || '*No emojis were processed.*'));
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
        try {
            const created = await guild.emojis.create({
                // Use the canonical CDN URL — it bypasses role-locks and
                // boost-availability since Discord re-uploads the asset
                // server-side when creating the emoji.
                attachment: source.cdnUrl || source.url,
                name: sanitizeName(source.name, 'stolen_emoji'),
                reason: `Stolen via globalemoji by ${actor.username}`,
            });
            ok.push({ emoji: created, source });
        } catch (err) {
            fail.push({ source, reason: explainEmojiError(err) });
        }
    }
    return { ok, fail };
}

/**
 * Resolve every entry in `parsedIds` to a real emoji source object.
 * Looks up the in-cache emoji first (if the ID happens to belong to a
 * guild the bot can already see), otherwise probes the CDN.
 */
async function resolveByIds(client, parsedIds) {
    const resolved = [];
    const missing = [];
    for (const entry of parsedIds.slice(0, STEAL_LIMIT)) {
        // Try the in-memory cache first — preserves animated flag, real name, guild attribution.
        let cached = null;
        for (const guild of client.guilds.cache.values()) {
            const e = guild.emojis.cache.get(entry.id);
            if (e) { cached = { e, guild }; break; }
        }
        if (cached) {
            const cdnUrl = cached.e.imageURL({ size: 128 })
                || `https://cdn.discordapp.com/emojis/${cached.e.id}.${cached.e.animated ? 'gif' : 'png'}`;
            const roleIds = cached.e.roles?.cache
                ? [...cached.e.roles.cache.keys()]
                : (Array.isArray(cached.e.roles) ? cached.e.roles : []);
            const restricted = roleIds.length > 0;
            const available = cached.e.available !== false;
            resolved.push({
                id: cached.e.id,
                name: sanitizeName(entry.name || cached.e.name, 'stolen_emoji'),
                animated: !!cached.e.animated,
                guildId: cached.guild.id,
                guildName: cached.guild.name,
                url: cdnUrl,
                cdnUrl,
                tag: cached.e.toString(),
                restricted,
                available,
                usable: available && !restricted,
                roleIds,
            });
            continue;
        }
        const probed = await fetchEmojiById(entry.id, entry.name);
        if (probed) resolved.push(probed);
        else missing.push({ id: entry.id, name: entry.name || null });
    }
    return { resolved, missing };
}

/* ─────────────────────── Modal handlers ─────────────────────── */

function buildSearchModal(initial = {}) {
    const animatedDefault = initial.animatedOnly ? 'animated' : initial.staticOnly ? 'static' : '';
    const stateDefault = initial.usableOnly ? 'usable' : initial.lockedOnly ? 'locked' : '';
    return new ModalBuilder()
        .setCustomId(`${ID_PREFIX}_search_modal`)
        .setTitle('Search Global Emojis')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('q')
                    .setLabel('Emoji name (partial match)')
                    .setPlaceholder('e.g. heart, fire, pepe — leave blank to clear')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(100)
                    .setValue(initial.search || ''),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('guild')
                    .setLabel('Server name or ID (optional)')
                    .setPlaceholder('e.g. xnico, 123456789012345678')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(100)
                    .setValue(initial.guildFilter || ''),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('mode')
                    .setLabel('Type filter (optional)')
                    .setPlaceholder('animated / static / leave blank for all')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(20)
                    .setValue(animatedDefault),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('state')
                    .setLabel('State filter (optional)')
                    .setPlaceholder('usable / locked / leave blank for all')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(20)
                    .setValue(stateDefault),
            ),
        );
}

function buildIdModal() {
    return new ModalBuilder()
        .setCustomId(`${ID_PREFIX}_byid_modal`)
        .setTitle('Steal Emojis by ID')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('ids')
                    .setLabel(`Emoji IDs or tags (max ${STEAL_LIMIT})`)
                    .setPlaceholder('123…, <:name:123>, <a:name:123> — separated by space, comma, or newline')
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
            await i.update({ components: [buildExpiredPanel('globalemoji')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return;
        }

        // ── Pagination ──
        if (i.customId === `${ID_PREFIX}_first`) state.page = 0;
        else if (i.customId === `${ID_PREFIX}_prev`)  state.page = Math.max(0, state.page - 1);
        else if (i.customId === `${ID_PREFIX}_next`)  state.page = Math.min(state.totalPages - 1, state.page + 1);
        else if (i.customId === `${ID_PREFIX}_last`)  state.page = state.totalPages - 1;
        else if (i.customId.startsWith(`${ID_PREFIX}_back:`)) {
            state.page = parseInt(i.customId.split(':')[1] || '0', 10) || 0;
        }
        // ── Help / Reset ──
        else if (i.customId === `${ID_PREFIX}_help`) {
            await i.update(buildHelpPayload(state.page)).catch(() => {});
            return;
        }
        else if (i.customId === `${ID_PREFIX}_reset`) {
            state.opts.search = '';
            state.opts.animatedOnly = false;
            state.opts.staticOnly = false;
            state.opts.usableOnly = false;
            state.opts.lockedOnly = false;
            state.opts.guildFilter = '';
            applyFilters(i.client, state);
        }
        // ── Modals ──
        else if (i.customId === `${ID_PREFIX}_search`) {
            await i.showModal(buildSearchModal(state.opts)).catch(() => {});
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
        // ── Steal selection ──
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

    // ── Modal submissions piggyback on the same collector via a dedicated
    // listener. The handler is captured by reference so we can detach it
    // when the collector ends to prevent listener leaks.
    const modalHandler = async (modalInteraction) => {
        if (!modalInteraction.isModalSubmit()) return;
        if (modalInteraction.user.id !== ownerId) return;
        if (!modalInteraction.customId.startsWith(`${ID_PREFIX}_`)) return;
        const state = getScan(panelMessage.id);
        if (!state) return;

        if (modalInteraction.customId === `${ID_PREFIX}_search_modal`) {
            const q = modalInteraction.fields.getTextInputValue('q')?.trim() || '';
            const guildVal = modalInteraction.fields.getTextInputValue('guild')?.trim() || '';
            const modeVal = (modalInteraction.fields.getTextInputValue('mode')?.trim() || '').toLowerCase();
            const stateVal = (modalInteraction.fields.getTextInputValue('state')?.trim() || '').toLowerCase();
            state.opts.search = q;
            state.opts.guildFilter = guildVal;
            state.opts.animatedOnly = modeVal === 'animated' || modeVal === 'a';
            state.opts.staticOnly = modeVal === 'static' || modeVal === 's';
            state.opts.usableOnly = stateVal === 'usable' || stateVal === 'u';
            state.opts.lockedOnly = stateVal === 'locked' || stateVal === 'l';
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
            const parsed = parseEmojiIdInput(raw);
            if (parsed.length === 0) {
                await modalInteraction.reply({
                    components: [buildErrorResponse(
                        'No IDs Found',
                        'Provide one or more emoji IDs or tags.',
                        'Examples:\n`123456789012345678`\n`<:pepe:123>` `<a:dance:456>`'
                    )],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                }).catch(() => {});
                return;
            }
            await modalInteraction.deferUpdate().catch(() => {});
            const { resolved, missing } = await resolveByIds(modalInteraction.client, parsed);
            const { ok, fail } = await performSteal(modalInteraction.guild, modalInteraction.user, resolved);
            for (const m of missing) {
                fail.push({ source: { id: m.id, name: m.name || 'unknown' }, reason: 'No emoji found at that ID' });
            }
            await panelMessage.edit(buildStealResultPayload(ok, fail, state.page)).catch(() => {});
        }
    };
    panelMessage.client.on('interactionCreate', modalHandler);

    collector.on('end', async () => {
        panelMessage.client.removeListener('interactionCreate', modalHandler);
        clearScan(panelMessage.id);
        const expired = buildExpiredPanel('globalemoji');
        await panelMessage.edit({ components: [expired], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });
}

function applyFilters(client, state) {
    const { items, guildsScanned } = flattenEmojis(client, state.opts);
    state.items = items;
    state.guildsScanned = guildsScanned;
    state.totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    state.page = 0;
}

/* ─────────────────────── Entrypoint ─────────────────────── */

async function runBrowser(client, opts, replyHandle) {
    const { items, guildsScanned } = flattenEmojis(client, opts);
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const state = { items, page: 0, totalPages, opts, guildsScanned };
    const payload = buildBrowserPayload(state);

    const panelMessage = await replyHandle(payload);
    if (!panelMessage) return;
    setScan(panelMessage.id, state);
    attachCollector(panelMessage, opts.ownerId);
}

async function runStealById(client, guild, user, rawInput, replyHandle) {
    const parsed = parseEmojiIdInput(rawInput);
    if (parsed.length === 0) {
        const container = buildErrorResponse(
            'No IDs Found',
            'Provide one or more emoji IDs or tags.',
            'Examples:\n`123456789012345678`\n`<:pepe:123>` `<a:dance:456>`\nMix snowflakes & tags, separated by spaces, commas, or newlines.'
        );
        await replyHandle({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return;
    }
    const { resolved, missing } = await resolveByIds(client, parsed);
    const { ok, fail } = await performSteal(guild, user, resolved);
    for (const m of missing) {
        fail.push({ source: { id: m.id, name: m.name || 'unknown' }, reason: 'No emoji found at that ID' });
    }
    await replyHandle(buildStealResultPayload(ok, fail, 0));
}

/* ─────────────────────── Module exports ─────────────────────── */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('globalemoji')
        .setDescription('Browse every emoji across the bot’s servers and steal what you like')
        .addSubcommand(s => s
            .setName('browse')
            .setDescription('Open the interactive emoji browser with search & pagination')
            .addStringOption(o => o.setName('search').setDescription('Filter by emoji name'))
            .addBooleanOption(o => o.setName('animated').setDescription('Show only animated emojis'))
            .addBooleanOption(o => o.setName('static').setDescription('Show only static emojis'))
            .addStringOption(o => o.setName('state').setDescription('Filter by usability state').addChoices(
                { name: 'Usable only', value: 'usable' },
                { name: 'Locked / unavailable only', value: 'locked' },
            ))
            .addStringOption(o => o.setName('guild').setDescription('Filter by server name or ID')))
        .addSubcommand(s => s
            .setName('steal-id')
            .setDescription('Steal one or more emojis directly by their ID or tag')
            .addStringOption(o => o.setName('ids').setDescription('IDs or tags, separated by spaces/commas/newlines').setRequired(true)))
        .addSubcommand(s => s
            .setName('help')
            .setDescription('How to use globalemoji')),

    prefix: 'globalemoji',
    description: 'Browse every emoji across the bot’s servers and steal by name or ID',
    usage: 'globalemoji [search] [-a animated] [-s static] [-u usable] [-l locked] [-g <guild>]  •  globalemoji id <ids…>',
    category: 'utility',
    aliases: ['gemoji', 'emojibrowse', 'allemojis'],
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

        // browse
        const stateOpt = (interaction.options.getString('state') || '').toLowerCase();
        const opts = {
            search: interaction.options.getString('search') || '',
            animatedOnly: !!interaction.options.getBoolean('animated'),
            staticOnly: !!interaction.options.getBoolean('static'),
            usableOnly: stateOpt === 'usable',
            lockedOnly: stateOpt === 'locked',
            guildFilter: interaction.options.getString('guild') || '',
            ownerId: interaction.user.id,
        };
        if (opts.animatedOnly && opts.staticOnly) {
            const container = buildErrorResponse(
                'Conflicting Filters',
                'You cannot pick both **animated** and **static** at the same time.',
                'Choose one filter or leave both off to see everything.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        if (opts.usableOnly && opts.lockedOnly) {
            const container = buildErrorResponse(
                'Conflicting Filters',
                'You cannot pick both **usable** and **locked** at the same time.',
                'Choose one state filter or leave it blank to see everything.'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

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

        // -globalemoji help / -globalemoji id <ids…>
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
        if (opts.animatedOnly && opts.staticOnly) {
            const container = buildErrorResponse(
                'Conflicting Filters',
                'You cannot pick both `-a` (animated) and `-s` (static) at the same time.',
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        if (opts.usableOnly && opts.lockedOnly) {
            const container = buildErrorResponse(
                'Conflicting Filters',
                'You cannot pick both `-u` (usable) and `-l` (locked) at the same time.',
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        await runBrowser(message.client, opts, async (payload) => {
            return message.reply(payload);
        });
    },
};

function parsePrefixArgs(args) {
    const opts = { search: '', animatedOnly: false, staticOnly: false, usableOnly: false, lockedOnly: false, guildFilter: '' };
    const remaining = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '-a' || a === '--animated') opts.animatedOnly = true;
        else if (a === '-s' || a === '--static') opts.staticOnly = true;
        else if (a === '-u' || a === '--usable') opts.usableOnly = true;
        else if (a === '-l' || a === '--locked') opts.lockedOnly = true;
        else if (a === '-g' || a === '--guild') {
            opts.guildFilter = args[i + 1] || '';
            i++;
        } else {
            remaining.push(a);
        }
    }
    opts.search = remaining.join(' ').trim();
    return opts;
}
