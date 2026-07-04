'use strict';

/**
 * Blackjack — proper bet-based casino blackjack.
 *
 * ── Mechanics ───────────────────────────────────────────────────────────
 *   - Bet is deducted up-front when the game starts (so the user can't
 *     cash-out by walking away mid-game).
 *   - Win  : payout = bet × 2  (profit = bet)
 *   - Push : refund bet        (profit = 0)
 *   - Loss : already paid      (profit = -bet)
 *   - Natural blackjack pays 2.5x (profit = 1.5×bet) — same rules as
 *     a real table.
 *
 * ── Rules ───────────────────────────────────────────────────────────────
 *   - Dealer hits on 16, stands on 17+.
 *   - Aces count as 1 or 11 automatically (best hand wins).
 *   - Player auto-stands on 21 (no infinite-loop hit-bug).
 *   - Game state is per-user, not per-message: a user cannot have
 *     two games running at once. Stale games auto-expire after 5 min.
 *
 * The interaction handler (`handleButton`) is wired by `index.js`'s
 * existing `bj_` button router. Custom ids encode the message gameId
 * so refreshes / multiple cards still resolve correctly.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const economyManager = require('../../utils/economyManager');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { formatCoinsShort, formatCoins , coinIcon } = require('../../utils/currencyHelper');

const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Active games keyed by gameId (`<userId>-<timestamp>`).
const games = new Map();

// Sweep abandoned games every 5 min to avoid memory leaks.
setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, g] of games) if (g.createdAt < cutoff) games.delete(id);
}, 5 * 60 * 1000);

function drawCard() {
    const suit = SUITS[Math.floor(Math.random() * SUITS.length)];
    const rank = RANKS[Math.floor(Math.random() * RANKS.length)];
    return { suit, rank, display: `${rank}${suit}` };
}

function calculateHand(cards) {
    let total = 0;
    let aces = 0;
    for (const card of cards) {
        if (card.rank === 'A') { total += 11; aces++; }
        else if (['K', 'Q', 'J'].includes(card.rank)) total += 10;
        else total += parseInt(card.rank, 10);
    }
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
}

function formatCards(cards) {
    return cards.map(c => `\`${c.display}\``).join(' ');
}

function buildContainer(game, hideDealer = true, resultText = null, payout = 0) {
    const playerTotal = calculateHand(game.playerCards);
    const dealerTotal = hideDealer
        ? calculateHand([game.dealerCards[0]])
        : calculateHand(game.dealerCards);
    const dealerDisplay = hideDealer
        ? `${formatCards([game.dealerCards[0]])} \`??\``
        : formatCards(game.dealerCards);
    const dealerTotalDisplay = hideDealer ? '?' : dealerTotal;

    let content = `# <:Gamepad:1521228035213230090> Blackjack\n\n`;
    content += `**Bet:** ${formatCoinsShort(game.bet, game.guildId)}\n\n`;
    content += `**Dealer's Hand** (${dealerTotalDisplay})\n`;
    content += `> ${dealerDisplay}\n\n`;
    content += `**Your Hand** (${playerTotal})\n`;
    content += `> ${formatCards(game.playerCards)}`;

    let accent = 0xCAD7E6;
    if (resultText) {
        content += `\n\n${resultText}`;
        if (payout > game.bet) {
            content += `\n\n${coinIcon(game.guildId)} **Payout:** +${formatCoinsShort(payout - game.bet, game.guildId)} profit (received ${formatCoinsShort(payout, game.guildId)})`;
        } else if (payout === game.bet) {
            content += `\n\n🤝 **Refund:** ${formatCoinsShort(game.bet, game.guildId)} returned`;
        } else {
            content += `\n\n${coinIcon(game.guildId)} **Lost:** ${formatCoinsShort(game.bet, game.guildId)}`;
        }
        if (payout > game.bet) accent = 0x57F287;       // win
        else if (payout === game.bet) accent = 0xFEE75C;// push
        else accent = 0xED4245;                         // loss
    }

    return new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

function buildActionRow(gameId, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`bj_${gameId}_hit`)
            .setLabel('Hit').setEmoji('🃏')
            .setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder()
            .setCustomId(`bj_${gameId}_stand`)
            .setLabel('Stand').setEmoji('✋')
            .setStyle(ButtonStyle.Secondary).setDisabled(disabled)
    );
}

/**
 * Credit a payout to the user's coin balance and update lifetime
 * stats. `payout` is the gross amount returned to the player (not
 * profit) — for a 2× win it's 2 × bet; for a push it's the bet.
 *
 * Already-deducted bet is reflected in totals as totalGambled.
 *
 * Delegates to the shared `betGameHelper.settle` so the Medal
 * `bonuses.gamble` boost applies here too — without it the user
 * would pay for a Medal that never fires on blackjack wins. Returns
 * the post-settlement userData (callers depend on `userData.coins`
 * for the balance display).
 */
function settle(userId, bet, payout) {
    const { settle: sharedSettle } = require('../../utils/betGameHelper');
    const { userData, payout: actualPayout } = sharedSettle(userId, bet, payout);
    // Stash the bonus delta on the returned object so the buildContainer
    // caller can surface it in the result line (the shared helper
    // returns `payout` already net of any bonus).
    userData._lastPayout = actualPayout;
    return userData;
}

function startGame(userId, guildId, bet) {
    // Deduct bet up-front so abandoning the game doesn't refund.
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);
    userData.coins -= bet;
    userData.totalGambled = (userData.totalGambled || 0) + bet;
    economyManager.saveEconomy(economy);

    const gameId = `${userId}-${Date.now()}`;
    const game = {
        playerId: userId,
        guildId,
        bet,
        playerCards: [drawCard(), drawCard()],
        dealerCards: [drawCard(), drawCard()],
        finished: false,
        createdAt: Date.now()
    };
    games.set(gameId, game);

    const playerTotal = calculateHand(game.playerCards);
    const dealerTotal = calculateHand(game.dealerCards);

    // Both 21 — push, refund the bet.
    if (playerTotal === 21 && dealerTotal === 21) {
        game.finished = true;
        settle(userId, bet, bet);
        const c = buildContainer(game, false, '🤝 **Push!** Both have Blackjack — bet refunded.', bet);
        c.addActionRowComponents(buildActionRow(gameId, true));
        games.delete(gameId);
        return c;
    }

    // Natural blackjack (player only) — pays 2.5x.
    if (playerTotal === 21) {
        game.finished = true;
        const payout = Math.floor(bet * 2.5);
        settle(userId, bet, payout);
        const c = buildContainer(game, false, '🎉 **Blackjack!** Natural 21 — pays 2.5×!', payout);
        c.addActionRowComponents(buildActionRow(gameId, true));
        games.delete(gameId);
        return c;
    }

    const c = buildContainer(game, true);
    c.addActionRowComponents(buildActionRow(gameId));
    return c;
}

function dealerPlay(game) {
    while (calculateHand(game.dealerCards) < 17) {
        game.dealerCards.push(drawCard());
    }
}

function resolveGame(game, gameId) {
    dealerPlay(game);
    game.finished = true;

    const playerTotal = calculateHand(game.playerCards);
    const dealerTotal = calculateHand(game.dealerCards);
    let resultText, payout;

    if (dealerTotal > 21) {
        resultText = `<:Award:1521228119640375336> **You Win!** Dealer busted with ${dealerTotal}.`;
        payout = game.bet * 2;
    } else if (playerTotal > dealerTotal) {
        resultText = `<:Award:1521228119640375336> **You Win!** ${playerTotal} vs ${dealerTotal}.`;
        payout = game.bet * 2;
    } else if (dealerTotal > playerTotal) {
        resultText = `<:Cancel:1521227723916181644> **Dealer Wins!** ${dealerTotal} vs ${playerTotal}.`;
        payout = 0;
    } else {
        resultText = `🤝 **Push!** Both have ${playerTotal} — bet refunded.`;
        payout = game.bet;
    }

    settle(game.playerId, game.bet, payout);
    const c = buildContainer(game, false, resultText, payout);
    c.addActionRowComponents(buildActionRow(gameId, true));
    games.delete(gameId);
    return c;
}

async function runStart(reply, userId, guildId, args) {
    const balance = getBalance(userId);
    const betResult = parseBet(args[0], balance);
    if (!betResult.valid) {
        return reply(betResult.error);
    }

    // Block multiple concurrent games per user to avoid double-bet bugs.
    for (const g of games.values()) {
        if (g.playerId === userId && !g.finished) {
            const c = new ContainerBuilder()
                .setAccentColor(0xFEE75C)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Infotriangle:1521227710381428926> Active Game\n\nYou already have a blackjack game in progress. Finish it first.`
                ));
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
    }

    const container = startGame(userId, guildId, betResult.amount);
    return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('blackjack')
        .setDescription('Play Blackjack vs the dealer for coins')
        .addStringOption(o => o.setName('bet').setDescription(`Amount to bet (max ${MAX_BET.toLocaleString()}) or "all"`).setRequired(true)),
    prefix: 'blackjack',
    aliases: ['bj', '21'],
    description: `Bet vs the dealer — natural pays 2.5×, win pays 2×, push refunds (max ${MAX_BET.toLocaleString()}).`,
    usage: 'blackjack <bet>',
    category: 'economy',

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const bet = interaction.options.getString('bet');
        return runStart(
            (opts) => interaction.reply(opts),
            interaction.user.id,
            interaction.guild?.id,
            [bet]
        );
    },

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        return runStart(
            (opts) => message.reply(opts),
            message.author.id,
            message.guild?.id,
            args
        );
    },

    async handleButton(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('bj_')) return false;

        const lastUnderscore = customId.lastIndexOf('_');
        const action = customId.slice(lastUnderscore + 1);
        const gameId = customId.slice(3, lastUnderscore);
        const game = games.get(gameId);

        if (!game) {
            await interaction.reply({
                components: [new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Game Expired\n\nThis blackjack game has expired. Start a new one.')
                )],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            }).catch(() => { });
            return true;
        }

        if (interaction.user.id !== game.playerId) {
            await interaction.reply({
                components: [new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Not Your Game\n\nStart your own with `-blackjack <bet>`')
                )],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            }).catch(() => { });
            return true;
        }

        if (game.finished) {
            await interaction.deferUpdate().catch(() => { });
            return true;
        }

        try {
            if (action === 'hit') {
                game.playerCards.push(drawCard());
                const total = calculateHand(game.playerCards);
                if (total > 21) {
                    // Bust — already deducted, no payout.
                    game.finished = true;
                    settle(game.playerId, game.bet, 0);
                    const c = buildContainer(game, false, `<:Cancel:1521227723916181644> **Bust!** You went over with ${total}.`, 0);
                    c.addActionRowComponents(buildActionRow(gameId, true));
                    games.delete(gameId);
                    await interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
                } else if (total === 21) {
                    // Auto-stand on 21
                    const c = resolveGame(game, gameId);
                    await interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
                } else {
                    const c = buildContainer(game, true);
                    c.addActionRowComponents(buildActionRow(gameId));
                    await interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
                }
            } else if (action === 'stand') {
                const c = resolveGame(game, gameId);
                await interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
            }
        } catch (e) {
            // Ignore Discord's "unknown interaction" errors
            if (e.code !== 10008 && e.code !== 40060) console.error('[Blackjack] update error:', e);
        }
        return true;
    }
};
