'use strict';

/**
 * Roulette — proper casino-style with bet types and payouts.
 *
 * The legacy `commands/fun/roulette.js` was Russian roulette joke
 * (1 in 6 die-and-laugh). This file replaces it with real roulette:
 *
 *   ── Bets & payouts ─────────────────────────────────────────────
 *      red / black            even-money     1×    (49% house, 51% bot)
 *      even / odd             even-money     1×
 *      low (1–18) / high (19–36)             1×
 *      dozen 1 / dozen 2 / dozen 3           2×
 *      straight number 0–36                  35×
 *
 *   ── Wheel ───────────────────────────────────────────────────────
 *   We use a single-zero European wheel (37 pockets, 0 is green).
 *   "0" is the house edge — it loses on red/black/even/odd/low/high
 *   but pays 35× on a straight bet.
 *
 *   ── Bet pickers ─────────────────────────────────────────────────
 *   The slash command exposes `pick` as a string choice; the prefix
 *   form parses the same vocabulary loosely so:
 *      -roulette 100 red
 *      -roulette 100 17
 *      -roulette 500 dozen 2
 *      -roulette 500 d2
 *      -roulette all even
 *   all work.
 *
 * Bets are validated before the wheel spin so an invalid pick
 * doesn't burn the user's balance.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const economyManager = require('../../utils/economyManager');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { formatCoinsShort, formatCoins , coinIcon } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator } = require('../../utils/componentHelpers');

// European single-zero roulette wheel.
const RED_NUMBERS = new Set([
    1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
]);
function isRed(n)   { return RED_NUMBERS.has(n); }
function isBlack(n) { return n !== 0 && !RED_NUMBERS.has(n); }

const COOLDOWN = 5_000;
const cooldowns = new Map();

/**
 * Resolve a bet pick string to a normalized form + payout.
 * Returns { kind, label, payout, predicate } or null if invalid.
 *
 *   payout is the multiplier applied to the bet on a win — i.e.
 *   if you bet 100 on red and win, you get bet × (1 + payout) back
 *   (200 total: original 100 + 100 profit).
 */
function parsePick(input) {
    if (!input) return null;
    const raw = String(input).trim().toLowerCase();

    if (raw === 'red'  || raw === 'r') return { kind: 'red',  label: '🔴 Red',   payout: 1, predicate: isRed };
    if (raw === 'black'|| raw === 'b') return { kind: 'black',label: '⚫ Black', payout: 1, predicate: isBlack };
    if (raw === 'even' || raw === 'e') return { kind: 'even', label: '🔢 Even',  payout: 1, predicate: n => n !== 0 && n % 2 === 0 };
    if (raw === 'odd'  || raw === 'o') return { kind: 'odd',  label: '🎲 Odd',   payout: 1, predicate: n => n % 2 === 1 };
    if (raw === 'low'  || raw === '1-18') return { kind: 'low',  label: '⬇️ 1–18',  payout: 1, predicate: n => n >= 1 && n <= 18 };
    if (raw === 'high' || raw === '19-36') return { kind: 'high', label: '⬆️ 19–36', payout: 1, predicate: n => n >= 19 && n <= 36 };

    // Dozens
    if (raw === 'd1' || raw === 'dozen1' || raw === 'dozen 1' || raw === '1-12')
        return { kind: 'dozen1', label: '1️⃣ Dozen 1 (1–12)', payout: 2, predicate: n => n >= 1 && n <= 12 };
    if (raw === 'd2' || raw === 'dozen2' || raw === 'dozen 2' || raw === '13-24')
        return { kind: 'dozen2', label: '2️⃣ Dozen 2 (13–24)', payout: 2, predicate: n => n >= 13 && n <= 24 };
    if (raw === 'd3' || raw === 'dozen3' || raw === 'dozen 3' || raw === '25-36')
        return { kind: 'dozen3', label: '3️⃣ Dozen 3 (25–36)', payout: 2, predicate: n => n >= 25 && n <= 36 };

    // Straight number bet (0..36)
    if (/^\d{1,2}$/.test(raw)) {
        const n = parseInt(raw, 10);
        if (n >= 0 && n <= 36) {
            return { kind: 'straight', label: `🎯 Number ${n}`, payout: 35, predicate: x => x === n };
        }
    }

    return null;
}

function colorEmoji(n) {
    if (n === 0) return '🟢';
    return isRed(n) ? '🔴' : '⚫';
}

async function handleRoulette(reply, userId, guildId, args) {
    const now = Date.now();
    if ((cooldowns.get(userId) || 0) > now) {
        const left = Math.ceil((cooldowns.get(userId) - now) / 1000);
        const c = createContainer(0xCAD7E6);
        addTextDisplay(c, `<:Sandwatch:1521228272426418367> Wait **${left}s** before spinning again.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    // Two-arg parse: bet first, pick after (rest).
    const balance = getBalance(userId);
    const betResult = parseBet(args[0], balance);

    // No bet provided → show help.
    if (!args[0] || (!betResult.valid && !args[1])) {
        const c = createContainer(0xCAD7E6);
        addTextDisplay(c, [
            `# 🎡 Roulette`,
            '',
            `**Usage:** \`roulette <bet> <pick>\``,
            `**Max Bet:** ${formatCoinsShort(MAX_BET, guildId)}`,
            '',
            `### Picks & Payouts`,
            `> 🔴 \`red\` / ⚫ \`black\` — **1×**`,
            `> 🔢 \`even\` / 🎲 \`odd\` — **1×**`,
            `> ⬇️ \`low\` (1–18) / ⬆️ \`high\` (19–36) — **1×**`,
            `> 1️⃣2️⃣3️⃣ \`d1\` / \`d2\` / \`d3\` (dozens) — **2×**`,
            `> 🎯 a single number 0–36 — **35×**`,
            '',
            `**Examples:**`,
            `\`roulette 100 red\``,
            `\`roulette 500 d2\``,
            `\`roulette 1000 17\``,
            `\`roulette all even\``,
        ].join('\n'));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (!betResult.valid) {
        return reply(betResult.error);
    }

    // Pick can be 1 or 2 tokens (e.g. "dozen 2"), so join everything after the bet.
    const pickRaw = args.slice(1).join(' ').trim();
    const pick = parsePick(pickRaw);

    if (!pick) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, [
            `<:Cancel:1521227723916181644> **Invalid pick.**`,
            ``,
            `Valid: \`red\`, \`black\`, \`even\`, \`odd\`, \`low\`, \`high\`, \`d1\`, \`d2\`, \`d3\`, or a number 0–36.`
        ].join('\n'));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const bet = betResult.amount;
    cooldowns.set(userId, now + COOLDOWN);

    /* ═══ Pre-roll the result so animation can never desync ═══ */
    const result = Math.floor(Math.random() * 37); // 0..36
    const won = pick.predicate(result);

    /* ═══ Spinning animation — 3 frames before the reveal ═══
       Each frame shows a teaser number and a "spinning" status to
       sell the motion. Total ~1.5s before reveal. */
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    function buildSpinFrame(displayN, status) {
        const c = createContainer(0xCAD7E6);
        addTextDisplay(c, [
            `# 🎡 Roulette`,
            '',
            `> Pick: ${pick.label} *(${pick.payout}×)*`,
            `> Bet: ${formatCoinsShort(bet, guildId)}`,
            '',
            `## ${colorEmoji(displayN)}  **${displayN}**`,
            '',
            status,
        ].join('\n'));
        return c;
    }

    // Frame 0 — initial reply
    let messageHandle = await reply({
        components: [buildSpinFrame(Math.floor(Math.random() * 37), `<:Sandwatch:1521228272426418367> *Wheel spinning…*`)],
        flags: MessageFlags.IsComponentsV2,
    });
    // If reply returned an interaction-style edit handle, normalise.
    const editFn = messageHandle && typeof messageHandle.edit === 'function'
        ? (payload) => messageHandle.edit(payload)
        : null;

    if (editFn) {
        try {
            await sleep(500);
            await editFn({
                components: [buildSpinFrame(Math.floor(Math.random() * 37), `<:Sandwatch:1521228272426418367> *Wheel slowing…*`)],
                flags: MessageFlags.IsComponentsV2,
            });
            await sleep(500);
            await editFn({
                components: [buildSpinFrame(Math.floor(Math.random() * 37), `<:Sandwatch:1521228272426418367> *Almost stopped…*`)],
                flags: MessageFlags.IsComponentsV2,
            });
            await sleep(550);
        } catch (err) {
            console.warn('[ROULETTE] animation frame failed, jumping to result:', err?.message || err);
        }
    }

    /* ═══ Settle the bet AFTER the animation so the on-screen
           result and the economy stay locked together. ═══ */
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);
    userData.coins -= bet;
    userData.totalGambled = (userData.totalGambled || 0) + bet;

    let payoutGross = 0;
    let bonusDelta = 0;
    if (won) {
        const baseGross = bet + bet * pick.payout;
        // Apply the Medal `bonuses.gamble` bonus to the profit portion
        // so a Medal owner gets the same boost they get on every
        // other gambling command. Without this, roulette wins ignored
        // the Medal entirely.
        const gambleBonus = Number(userData.bonuses?.gamble || 0);
        const profit = baseGross - bet;
        const bonusExtra = gambleBonus > 0 ? Math.floor(profit * gambleBonus) : 0;
        payoutGross = baseGross + bonusExtra;
        bonusDelta = bonusExtra;
        userData.coins += payoutGross;
        userData.totalWon = (userData.totalWon || 0) + (payoutGross - bet);
    } else {
        userData.totalLost = (userData.totalLost || 0) + bet;
    }
    economyManager.addXP(economy, userId, won ? 8 : 2);
    economyManager.checkAllAchievements(economy, userId);
    economyManager.saveEconomy(economy);

    /* ═══ Final reveal ═══ */
    const c = createContainer(won ? 0x57F287 : 0xED4245);
    addTextDisplay(c, [
        `# 🎡 Roulette`,
        '',
        `### Spin Result: ${colorEmoji(result)} **${result}**`,
        `> Your pick: ${pick.label} (${pick.payout}×)`,
        `> Bet: ${formatCoinsShort(bet, guildId)}`,
    ].join('\n'));

    addSeparator(c, SeparatorSpacingSize.Small);

    if (won) {
        const winLines = [
            `<:Checkedbox:1521227734943269077> **You won ${formatCoinsShort(payoutGross - bet, guildId)} profit!**`,
            ``,
            `${coinIcon(guildId)} **Payout:** ${formatCoinsShort(payoutGross, guildId)}`,
            `💼 **Balance:** ${formatCoinsShort(userData.coins, guildId)}`,
        ];
        if (bonusDelta > 0) {
            winLines.push(`-# 🥇 Medal bonus added **+${formatCoinsShort(bonusDelta, guildId)}** to your win.`);
        }
        addTextDisplay(c, winLines.join('\n'));
    } else {
        addTextDisplay(c, [
            `<:Cancel:1521227723916181644> **Lost ${formatCoinsShort(bet, guildId)}**`,
            ``,
            `💼 **Balance:** ${formatCoinsShort(userData.coins, guildId)}`,
        ].join('\n'));
    }

    if (editFn) {
        try {
            return await editFn({ components: [c], flags: MessageFlags.IsComponentsV2 });
        } catch {
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
    }
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roulette')
        .setDescription('Casino roulette — bet on color, parity, range, dozen, or a number')
        .addStringOption(o => o.setName('bet').setDescription(`Amount to bet (max ${MAX_BET.toLocaleString()}) or "all"`).setRequired(true))
        .addStringOption(o => o.setName('pick').setDescription('What to bet on').setRequired(true)
            .addChoices(
                { name: '🔴 Red (1×)',     value: 'red'   },
                { name: '⚫ Black (1×)',   value: 'black' },
                { name: '🔢 Even (1×)',    value: 'even'  },
                { name: '🎲 Odd (1×)',     value: 'odd'   },
                { name: '⬇️ Low 1–18 (1×)',  value: 'low'   },
                { name: '⬆️ High 19–36 (1×)', value: 'high' },
                { name: '1️⃣ Dozen 1 (2×)',  value: 'd1'    },
                { name: '2️⃣ Dozen 2 (2×)',  value: 'd2'    },
                { name: '3️⃣ Dozen 3 (2×)',  value: 'd3'    },
            ))
        .addIntegerOption(o => o.setName('number').setDescription('Or pick a single number 0–36 (35×)').setMinValue(0).setMaxValue(36).setRequired(false)),

    prefix: 'roulette',
    description: 'Bet on roulette — colors/parity/range pay 1×, dozens 2×, single number 35×.',
    usage: 'roulette <bet> <red|black|even|odd|low|high|d1|d2|d3|0-36>',
    category: 'economy',
    aliases: [],

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const bet = interaction.options.getString('bet');
        const pickStr = interaction.options.getString('pick');
        const number = interaction.options.getInteger('number');
        const pick = number !== null && number !== undefined ? String(number) : pickStr;
        // Defer so animation frames can edit the same response.
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferReply().catch(() => {});
        }
        // editReply returns the resolved Message object (via REST), which
        // exposes a usable `.edit()` handle for subsequent frames.
        const replyFn = async (payload) => {
            const sent = await interaction.editReply(payload);
            return sent;
        };
        return handleRoulette(replyFn, interaction.user.id, interaction.guild?.id, [bet, pick]);
    },

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        // message.reply() resolves to the sent Message which has .edit().
        const replyFn = (payload) => message.reply(payload);
        return handleRoulette(replyFn, message.author.id, message.guild?.id, args);
    }
};
