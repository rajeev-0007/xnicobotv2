'use strict';

/**
 * emojis — list every custom emoji in the current server.
 *
 * Why pagination?
 * ───────────────
 * Discord caps each Components V2 text display at 4000 chars, and the
 * total payload across components at ~6000. A server with 200+ custom
 * emojis (and many bots have far more) easily exceeds this when you
 * render every `<:name:id>` tag inline. The previous implementation
 * truncated to a 60-emoji "page 1" and just hid the rest, which is
 * useless on large servers.
 *
 * The new flow:
 *   • Combine every emoji into a single sorted list.
 *   • Split it into pages of `EMOJIS_PER_PAGE` (30) entries.
 *   • Render the requested page with prev/next/jump buttons.
 *   • If the requested page would still overflow Discord's 4000-char
 *     text display limit (e.g. a server full of long emoji names),
 *     fall back to a denser code-block layout with names instead of
 *     inline tags so the response still goes through.
 *
 * Buttons are owner-locked: only the user who ran the command can
 * page through; anyone else gets a polite ephemeral nudge to run
 * the command themselves.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize, MessageFlags,
    ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { COLORS, EMOJIS: PALETTE } = require('../../utils/responseBuilder');
const { emojiUsability } = require('../../utils/emojiSystem');

const EMOJIS_PER_PAGE = 30;
const MAX_TEXT_DISPLAY = 3800; // leave headroom under the 4000-char hard cap

/**
 * Build a sorted entry list. Each entry knows whether the emoji is
 * usable inline so the renderer can pick the right format per emoji.
 */
function collectEntries(guild) {
    const entries = [];
    for (const e of guild.emojis.cache.values()) {
        const { usable } = emojiUsability(e);
        entries.push({
            id: e.id,
            name: e.name || 'unnamed',
            animated: e.animated,
            usable,
            inline: usable ? e.toString() : `\`:${e.name}:\`` });
    }
    // Static first, then animated; alphabetical inside each bucket.
    entries.sort((a, b) => {
        if (a.animated !== b.animated) return a.animated ? 1 : -1;
        return a.name.localeCompare(b.name);
    });
    return entries;
}

/**
 * Render one page. Falls back to code-block name list if the inline
 * layout would exceed the text display limit (very long names + many
 * unusable emojis).
 */
function renderPage(entries, page, pageCount, guild) {
    const start = page * EMOJIS_PER_PAGE;
    const slice = entries.slice(start, start + EMOJIS_PER_PAGE);
    const inlineBody = slice.map(e => e.inline).join(' ');

    let body;
    if (inlineBody.length > MAX_TEXT_DISPLAY) {
        // Compact fallback — show names in a code block instead.
        body = '```\n' + slice.map(e => `${e.animated ? 'a:' : ' :'}${e.name}`).join('\n') + '\n```';
    } else {
        body = inlineBody;
    }

    const totalStatic = entries.filter(e => !e.animated).length;
    const totalAnim   = entries.filter(e => e.animated).length;

    const container = new ContainerBuilder()
        .setAccentColor(COLORS.INFO)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${PALETTE.STAR} ${guild.name} Emojis\n` +
            `-# **Total:** ${entries.length}  •  **Static:** ${totalStatic}  •  **Animated:** ${totalAnim}  •  **Page** ${page + 1}/${pageCount}`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body || '*(no emojis on this page)*'))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))

    return container;
}

function buildButtons(ownerId, page, pageCount) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`emojis:${ownerId}:first`)
            .setLabel('« First')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 0),
        new ButtonBuilder()
            .setCustomId(`emojis:${ownerId}:prev`)
            .setLabel('‹ Prev')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page <= 0),
        new ButtonBuilder()
            .setCustomId(`emojis:${ownerId}:next`)
            .setLabel('Next ›')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page >= pageCount - 1),
        new ButtonBuilder()
            .setCustomId(`emojis:${ownerId}:last`)
            .setLabel('Last »')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= pageCount - 1),
    );
    return row;
}

/* ═══════════════════════════════════════════════════════════════
   IN-MEMORY SESSION (small + bounded)
   We snapshot the entry list per message so re-pagination on a click
   doesn't have to re-walk the guild.emojis cache and re-sort. Sessions
   self-evict after 10 minutes.
   ═══════════════════════════════════════════════════════════════ */

const sessions = new Map();
const SESSION_TTL = 10 * 60 * 1000;

function setSession(messageId, payload) {
    sessions.set(messageId, { ...payload, ts: Date.now() });
    setTimeout(() => sessions.delete(messageId), SESSION_TTL).unref?.();
}
function getSession(messageId) {
    const s = sessions.get(messageId);
    if (!s) return null;
    if (Date.now() - s.ts > SESSION_TTL) { sessions.delete(messageId); return null; }
    return s;
}

/* ═══════════════════════════════════════════════════════════════
   COMMAND DISPATCH
   ═══════════════════════════════════════════════════════════════ */

async function send(reply, guild, ownerId) {
    if (!guild) {
        return reply({ content: `${PALETTE.ERROR} This command can only be used in a server.`, flags: MessageFlags.Ephemeral });
    }
    const entries = collectEntries(guild);
    if (entries.length === 0) {
        return reply({ content: `${PALETTE.ERROR} This server has no custom emojis.`, flags: MessageFlags.Ephemeral });
    }
    const pageCount = Math.max(1, Math.ceil(entries.length / EMOJIS_PER_PAGE));
    const page = 0;
    const container = renderPage(entries, page, pageCount, guild);
    const components = [container];
    if (pageCount > 1) {
        components.push(buildButtons(ownerId, page, pageCount));
    }
    const sent = await reply({ components, flags: MessageFlags.IsComponentsV2 });
    if (sent && sent.id) {
        setSession(sent.id, { ownerId, guildId: guild.id, entries, pageCount, page });
    }
    return sent;
}

module.exports = {
    prefix: 'emojis',
    description: 'List all custom emojis in the server',
    usage: 'emojis',
    category: 'basic',
    data: new SlashCommandBuilder()
        .setName('emojis')
        .setDescription('List all custom emojis in the server'),

    async execute(interaction) {
        try {
            // Fetching guild emojis can be slow on huge servers — defer
            // first so we don't trip Discord's 3-second interaction window.
            await interaction.deferReply().catch(() => {});
            const replyFn = async (payload) => {
                const sent = await interaction.editReply(payload);
                return sent;
            };
            await send(replyFn, interaction.guild, interaction.user.id);
        } catch (error) {
            console.error('[EMOJIS]', error);
            const content = `${PALETTE.ERROR} An error occurred while running this command.`;
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content }).catch(() => {});
            } else {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    },

    async executePrefix(message) {
        try {
            await send((p) => message.reply(p), message.guild, message.author.id);
        } catch (error) {
            console.error('[EMOJIS]', error);
            await message.reply(`${PALETTE.ERROR} An error occurred while running this command.`).catch(() => {});
        }
    },

    /**
     * Hooked from index.js — the customId convention is
     *   emojis:<ownerId>:<first|prev|next|last>
     * Returns true when the interaction was handled.
     */
    async handleInteraction(interaction) {
        if (!interaction.isButton()) return false;
        if (!interaction.customId.startsWith('emojis:')) return false;
        const [, ownerId, action] = interaction.customId.split(':');
        if (interaction.user.id !== ownerId) {
            await interaction.reply({
                content: `${PALETTE.ERROR} Run \`/emojis\` yourself to navigate.`,
                flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }
        const session = getSession(interaction.message?.id);
        if (!session) {
            await interaction.reply({
                content: `${PALETTE.ERROR} This emoji panel has expired — run \`/emojis\` again.`,
                flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }
        let { page } = session;
        if (action === 'first') page = 0;
        else if (action === 'prev') page = Math.max(0, page - 1);
        else if (action === 'next') page = Math.min(session.pageCount - 1, page + 1);
        else if (action === 'last') page = session.pageCount - 1;
        session.page = page;
        session.ts = Date.now();

        const guild = interaction.guild;
        const container = renderPage(session.entries, page, session.pageCount, guild);
        await interaction.update({
            components: [container, buildButtons(ownerId, page, session.pageCount)],
            flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return true;
    } };
