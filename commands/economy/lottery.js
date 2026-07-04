'use strict';

/**
 * /lottery — Server-wide lottery with an AI participant.
 *
 * Architecture
 *   • Draw scheduler lives in utils/lotteryScheduler.js (started at
 *     boot from index.js). It runs draws automatically when the
 *     timer expires, regardless of whether a UI panel is open.
 *   • This command is a *thin* UI on top of that state — it loads
 *     the current lottery, lets the user buy a ticket, and re-renders
 *     the panel on a short interval.
 *   • Single AI participant ("xNico AI") competes alongside humans
 *     using utils/lotteryAI.js. It buys tickets at metered intervals,
 *     never exceeds 35% of the pool, and is eligible to win exactly
 *     like any human player.
 *
 * UI is a Components V2 container with header, jackpot block, draw
 * timer, your-ticket panel, and a clean entries table including the
 * AI participant when it has bought in. Buttons: Buy Ticket / Refresh.
 *
 * © Rajeev (Rexzy) — xNico
 */

const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');
const { formatCoins, coinIcon } = require('../../utils/currencyHelper');
const { formatNumber, getErrorContainer } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { gamblingGuard } = require('../../utils/economyGuards');

const lotteryAI = require('../../utils/lotteryAI');
const scheduler = require('../../utils/lotteryScheduler');

/* ─────────────────────────── Constants ─────────────────────────── */

const REFRESH_RATE = 15_000; // re-render the panel this often
const COLLECTOR_TIMEOUT = 30 * 60 * 1000; // panel stays interactive for 30 minutes

// Per-user re-entry guard for the buy-ticket button. Without this,
// rapid clicks on the same panel can both pass the funds check and
// double-charge the user (or, since each click reads the live cache,
// potentially register two tickets for the price of one). The Set
// is cleared in a finally block on every code path.
const buyInFlight = new Set();

const {
    LOTTERY_DURATION,
    GST_RATE,
    BASE_TICKET_PRICE,
    PRICE_STEP,
    MAX_TICKETS,
} = scheduler;

/* ─────────────────────────── Helpers ─────────────────────────── */

function formatTimer(ms) {
    const safe = Math.max(0, ms | 0);
    const m = Math.floor(safe / 60000);
    const s = Math.floor((safe % 60000) / 1000);
    return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function totalTickets(entries) {
    return Object.values(entries || {}).reduce((a, b) => a + Number(b || 0), 0);
}

function userTicketsOf(entries, id) {
    return Number((entries || {})[id] || 0);
}

function nextPriceFor(owned) {
    if (owned >= MAX_TICKETS) return null;
    return BASE_TICKET_PRICE + owned * PRICE_STEP;
}

/* ─────────────────────────── Entry table ─────────────────────────── */

/**
 * Build a compact, ranked table of the top participants (capped to
 * a sensible number so the panel stays under CV2 text-length limits).
 * Each row shows the ticket count, the player's % of the pool, and
 * a small badge if the AI is in the row.
 */
function renderEntriesTable(lottery) {
    const entries = lottery.entries || {};
    const pairs = Object.entries(entries)
        .filter(([, count]) => Number(count) > 0)
        .sort((a, b) => b[1] - a[1]);

    if (pairs.length === 0) {
        return `> *No tickets sold yet — be the first to buy in.*`;
    }

    const total = totalTickets(entries);
    const TOP = 10;
    const lines = [];
    pairs.slice(0, TOP).forEach(([id, count], i) => {
        const pct = total === 0 ? 0 : (count / total) * 100;
        const isAI = lotteryAI.isAIEntry(id);
        const tag  = isAI ? `${lotteryAI.AI_BADGE} **${lotteryAI.AI_USERNAME}**` : `<@${id}>`;
        const rank = `\`${String(i + 1).padStart(2, '0')}.\``;
        lines.push(`${rank} ${tag} — \`${count}\` ticket${count === 1 ? '' : 's'} · **${pct.toFixed(1)}%**`);
    });
    if (pairs.length > TOP) {
        lines.push(`-# +${pairs.length - TOP} more participant${pairs.length - TOP === 1 ? '' : 's'} not shown`);
    }
    return lines.join('\n');
}

/* ─────────────────────────── Panel renderer ─────────────────────────── */

function buildPanel(lottery, viewerId, guildId) {
    const total = totalTickets(lottery.entries);
    const owned = userTicketsOf(lottery.entries, viewerId);
    const chance = total === 0 ? 0 : (owned / total) * 100;
    const next = nextPriceFor(owned);

    const isActive = !!lottery.active && lottery.endsAt > Date.now();
    const timeLeft = isActive ? lottery.endsAt - Date.now() : 0;

    const gst    = Math.floor(lottery.jackpot * GST_RATE);
    const payout = lottery.jackpot - gst;

    // Three split tiers
    const winnerSplit = [
        Math.floor(payout * 0.60),
        Math.floor(payout * 0.25),
        payout - Math.floor(payout * 0.60) - Math.floor(payout * 0.25),
    ];

    const accent = isActive ? 0xF1C40F : 0x6B7280;

    const aiOwned = userTicketsOf(lottery.entries, lotteryAI.AI_USER_ID);
    const aiActive = aiOwned > 0;

    const c = new ContainerBuilder().setAccentColor(accent);

    // ── Header ──
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# 🎟️ Server Lottery\n` +
        `-# Fair · Server-wide · One AI participant joins the pool` +
        (aiActive ? ` · ${lotteryAI.AI_BADGE} **${lotteryAI.AI_USERNAME}** is in this round` : '')
    ));
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // ── Jackpot block ──
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### ${coinIcon(guildId)} Jackpot\n` +
        `> **${formatCoins(lottery.jackpot, guildId)}**\n` +
        `> -# Tax (${Math.round(GST_RATE * 100)}%): ${formatNumber(gst)} · Winner pool: **${formatNumber(payout)}**`
    ));

    // ── Draw timer + status ──
    const timerLine = isActive
        ? `> ⏳ **${formatTimer(timeLeft)}** remaining`
        : `> ⚪ **No active draw** — buy a ticket to start the next one`;
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### <:Clock:1521228110408847623> Draw Status\n` +
        timerLine + `\n` +
        `> Total tickets sold: **${total}**`
    ));

    // ── Prize split ──
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### <:Present:1521228115655917659> Prize Split\n` +
        `> 🥇 1st (60%) — **${formatNumber(winnerSplit[0])}**\n` +
        `> 🥈 2nd (25%) — **${formatNumber(winnerSplit[1])}**\n` +
        `> 🥉 3rd (15%) — **${formatNumber(Math.max(0, winnerSplit[2]))}**`
    ));

    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // ── Your entry ──
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### <:User:1521227714227343380> Your Entry\n` +
        `> Tickets: **${owned} / ${MAX_TICKETS}**\n` +
        `> Win chance: **${chance.toFixed(2)}%**\n` +
        `> Next ticket: ` + (next === null
            ? `**MAX reached**`
            : `${coinIcon(guildId)} **${formatNumber(next)} coins**`)
    ));

    // ── Participants table ──
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### <:Document:1521227875016114266> Participants (${Object.keys(lottery.entries || {}).length})\n` +
        renderEntriesTable(lottery)
    ));

    // ── Recent draw history (small footer) ──
    const hist = lottery.history;
    if (hist && hist.endedAt && Array.isArray(hist.winners) && hist.winners.length > 0) {
        const ts = Math.floor(new Date(hist.endedAt).getTime() / 1000);
        const medals = ['🥇', '🥈', '🥉'];
        const histLines = hist.winners.map((w, i) => {
            const isAI = lotteryAI.isAIEntry(w.id);
            const tag = isAI ? `${lotteryAI.AI_BADGE} ${lotteryAI.AI_USERNAME}` : `<@${w.id}>`;
            return `> ${medals[i] || '•'} ${tag} — **${formatNumber(w.reward || 0)}**`;
        });
        c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### 🏆 Last Draw — <t:${ts}:R>\n` + histLines.join('\n')
        ));
    }

    return c;
}

function buildButtons(viewerId, lottery) {
    const owned = userTicketsOf(lottery.entries, viewerId);
    const next = nextPriceFor(owned);
    const buyDisabled = next === null;

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`lottery_join_${viewerId}`)
            .setLabel(buyDisabled ? 'Max Tickets Reached' : 'Buy Ticket')
            .setEmoji('🎫')
            .setStyle(buyDisabled ? ButtonStyle.Secondary : ButtonStyle.Success)
            .setDisabled(buyDisabled),
        new ButtonBuilder()
            .setCustomId(`lottery_refresh_${viewerId}`)
            .setLabel('Refresh')
            .setEmoji('<:History:1521227863079256278>')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`lottery_info_${viewerId}`)
            .setLabel('How it Works')
            .setEmoji('<:Lightbulbalt:1521227880703463675>')
            .setStyle(ButtonStyle.Secondary),
    );
}

function buildInfoPanel(guildId) {
    const c = new ContainerBuilder().setAccentColor(0xF1C40F);
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# 🎟️ How the Lottery Works\n` +
        `-# Quick rundown of the rules so there are no surprises.`
    ));
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### <:Document:1521227875016114266> Rules\n` +
        `> • Each draw runs for **1 hour** once it starts.\n` +
        `> • Tickets cost **${BASE_TICKET_PRICE}** + **${PRICE_STEP}** per ticket already owned.\n` +
        `> • You can hold up to **${MAX_TICKETS}** tickets per draw.\n` +
        `> • Winners are picked weighted by tickets — more tickets = better odds.\n` +
        `> • Tax of **${Math.round(GST_RATE * 100)}%** is removed before payout.\n` +
        `> • Winner split: 🥇 60% · 🥈 25% · 🥉 15%.\n\n` +

        `### ${lotteryAI.AI_BADGE} The AI Participant\n` +
        `> • A single bot — **${lotteryAI.AI_USERNAME}** — competes against you.\n` +
        `> • It buys tickets at metered intervals, never spam-buys, and never owns more than **${Math.round(lotteryAI._config.MAX_SHARE * 100)}%** of the pool.\n` +
        `> • If it wins, the prize is recycled into the next jackpot — you never lose coins to it.\n` +
        `> • Its tickets are eligible like any other entry; the draw never favours it.`
    ));
    c.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
    c.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# Currency: ${coinIcon(guildId)} · Powered by xNico`
    ));
    return c;
}

/* ─────────────────────────── Run flow ─────────────────────────── */

async function runLottery(target, replyHandle) {
    const isInteraction = typeof target.isRepliable === 'function';
    const userId  = isInteraction ? target.user.id : target.author.id;
    const guildId = target.guild?.id;
    const client  = target.client;

    // Ensure scheduler is running. Calling .start() multiple times
    // is a no-op (it self-guards), so cheap.
    scheduler.start();

    // The user pressing /lottery should also pre-trigger an overdue
    // draw if the scheduler hasn't ticked yet for any reason.
    await scheduler.runDrawIfDue();

    let lottery = scheduler.loadLottery();

    const panel   = buildPanel(lottery, userId, guildId);
    const buttons = buildButtons(userId, lottery);

    const msg = await replyHandle({
        components: [panel, buttons],
        flags: MessageFlags.IsComponentsV2,
    });
    if (!msg) return;

    // ── Periodic re-render (so the timer & jackpot stay fresh) ──
    const interval = setInterval(async () => {
        const lot = scheduler.loadLottery();
        try {
            await msg.edit({
                components: [buildPanel(lot, userId, guildId), buildButtons(userId, lot)],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch {
            clearInterval(interval);
        }
    }, REFRESH_RATE);

    if (typeof interval.unref === 'function') interval.unref();

    // ── Button collector ──
    const collector = msg.createMessageComponentCollector({
        time: COLLECTOR_TIMEOUT,
        filter: i => i.customId && i.customId.startsWith('lottery_'),
    });

    collector.on('collect', async (i) => {
        const cid = i.customId;
        try {
            // Permission scoping — only the original requester can drive
            // the panel buttons. Others get a tiny ephemeral hint.
            if (!cid.endsWith(`_${i.user.id}`)) {
                await i.reply({
                    components: [getErrorContainer('Run `/lottery` yourself to open your own panel.')],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                }).catch(() => {});
                return;
            }

            // Help panel — ephemeral.
            if (cid.startsWith('lottery_info_')) {
                await i.reply({
                    components: [buildInfoPanel(guildId)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                }).catch(() => {});
                return;
            }

            await i.deferUpdate().catch(() => {});

            // Refresh — just re-render with the latest state.
            if (cid.startsWith('lottery_refresh_')) {
                const lot = scheduler.loadLottery();
                await msg.edit({
                    components: [buildPanel(lot, userId, guildId), buildButtons(userId, lot)],
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => {});
                return;
            }

            // Buy — gated on funds + per-user cap, then mutates state.
            if (cid.startsWith('lottery_join_')) {
                if (buyInFlight.has(userId)) {
                    await i.followUp({
                        content: '<:Infotriangle:1521227710381428926> Your previous ticket purchase is still completing — try again in a moment.',
                        flags: MessageFlags.Ephemeral,
                    }).catch(() => {});
                    return;
                }
                buyInFlight.add(userId);
                try {
                    const economy = economyManager.loadEconomy();
                    let lot = scheduler.loadLottery();

                    // Lazy-start the draw if it isn't already running.
                    // Reset entries/jackpot too — keeping the previous
                    // round's leftovers would let a player who held
                    // tickets in a drawn-but-not-cleared round appear to
                    // start the new round with those tickets credited.
                    if (!lot.active || lot.endsAt < Date.now()) {
                        lot.active = true;
                        lot.endsAt = Date.now() + LOTTERY_DURATION;
                        lot.entries = {};
                        lot.jackpot = 0;
                        lotteryAI.resetAI(lot);
                    }

                    const owned = userTicketsOf(lot.entries, userId);
                    if (owned >= MAX_TICKETS) {
                        // Re-render so the button shows the disabled state.
                        await msg.edit({
                            components: [buildPanel(lot, userId, guildId), buildButtons(userId, lot)],
                            flags: MessageFlags.IsComponentsV2,
                        }).catch(() => {});
                        return;
                    }

                    const price = BASE_TICKET_PRICE + owned * PRICE_STEP;
                    const { userData } = economyManager.getUser(economy, userId);
                    if ((userData.coins || 0) < price) {
                        await i.followUp({
                            content: `<:Cancel:1521227723916181644> You need **${formatNumber(price)}** coins for the next ticket — your wallet has ${formatNumber(userData.coins || 0)}.`,
                            flags: MessageFlags.Ephemeral,
                        }).catch(() => {});
                        return;
                    }

                    userData.coins -= price;
                    lot.entries[userId] = owned + 1;
                    lot.jackpot += price;

                    economyManager.saveEconomy(economy);
                    scheduler.saveLottery(lot);

                    await msg.edit({
                        components: [buildPanel(lot, userId, guildId), buildButtons(userId, lot)],
                        flags: MessageFlags.IsComponentsV2,
                    }).catch(() => {});
                    return;
                } finally {
                    buyInFlight.delete(userId);
                }
            }
        } catch (err) {
            console.error('[lottery] collector error:', err);
        }
    });

    collector.on('end', () => clearInterval(interval));
}

/* ─────────────────────────── Command export ─────────────────────────── */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lottery')
        .setDescription('Join the server lottery and win big prizes'),
    prefix: 'lottery',
    aliases: ['ticket', 'tickets'],
    category: 'economy',
    description: 'Join the server lottery and win big prizes',
    usage: 'lottery',

    async executePrefix(message) {
        if (await gamblingGuard(message)) return;
        return runLottery(message, async (payload) => message.reply(payload));
    },

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        await interaction.deferReply();
        return runLottery(interaction, async (payload) => interaction.editReply(payload));
    },
};
