'use strict';

/**
 * Rock Paper Scissors — bet vs the bot OR vs another user.
 *
 * Solo: instant resolve vs bot.
 *   Win pays 2×, tie refunds, loss keeps the deduction.
 *
 * PvP : challenge container with Accept/Decline. After accept, three
 *   pick buttons appear (Rock / Paper / Scissors). Each player clicks
 *   their pick (hidden until both pick). Winner takes 2× bet, tie
 *   refunds both.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const economyManager = require('../../utils/economyManager');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { formatCoins, formatCoinsShort } = require('../../utils/currencyHelper');
const { resolveUser } = require('../../utils/resolveUser');
const {
    validateOpponent, deductBoth, settlePvP, buildChallenge, pvpError
} = require('../../utils/pvpGameHelper');

const CHOICES = {
    rock: { emoji: '🪨', label: 'Rock', beats: 'scissors' },
    paper: { emoji: '📜', label: 'Paper', beats: 'rock' },
    scissors: { emoji: '✂️', label: 'Scissors', beats: 'paper' }
};
const CHOICE_LIST = Object.keys(CHOICES);

const COOLDOWN = 4_000;
const cooldowns = new Map();

const games = new Map();
const challenges = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [id, g] of games) if (g.expiresAt < now) games.delete(id);
    for (const [id, c] of challenges) if (c.expiresAt < now) challenges.delete(id);
}, 60_000);

function pickFromTokens(tokens) {
    let choice = null, betArg = null;
    for (const t of tokens) {
        const lower = String(t || '').toLowerCase();
        if (/^<@!?\d{17,20}>$/.test(lower) || /^\d{17,20}$/.test(lower)) continue;
        if (CHOICES[lower]) { choice = lower; continue; }
        if (lower === 'r') choice = 'rock';
        else if (lower === 'p') choice = 'paper';
        else if (lower === 's') choice = 'scissors';
        else if (!betArg) betArg = lower;
    }
    return { choice, betArg };
}

async function handleSolo(reply, userId, guildId, choice, betArg) {
    const now = Date.now();
    if ((cooldowns.get(userId) || 0) > now) {
        const left = Math.ceil((cooldowns.get(userId) - now) / 1000);
        const c = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `<:Sandwatch:1521228272426418367> Wait **${left}s** before playing again.`
            ));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const balance = getBalance(userId);
    const betResult = parseBet(betArg, balance);

    if (!betResult.valid) {
        if (!betArg) {
            const c = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent([
                    `# ✊ Rock Paper Scissors`,
                    ``,
                    `**Solo:** \`rps <rock|paper|scissors> <bet>\``,
                    `**PvP:**  \`rps <bet> @user\``,
                    `**Max Bet:** ${formatCoins(MAX_BET, guildId)}`,
                    ``,
                    `Win pays **2×**, ties refund the bet.`,
                ].join('\n')));
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
        return reply(betResult.error);
    }

    if (!choice || !CHOICES[choice]) {
        const c = new ContainerBuilder().setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `<:Cancel:1521227723916181644> Provide a valid choice: \`rock\`, \`paper\`, or \`scissors\`.`
            ));
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const bet = betResult.amount;
    cooldowns.set(userId, now + COOLDOWN);

    const botChoice = CHOICE_LIST[Math.floor(Math.random() * CHOICE_LIST.length)];
    const p = CHOICES[choice];
    const b = CHOICES[botChoice];

    let outcome, profit, payout;
    if (choice === botChoice) { outcome = 'tie'; profit = 0; payout = bet; }
    else if (p.beats === botChoice) { outcome = 'win'; profit = bet; payout = bet * 2; }
    else { outcome = 'lose'; profit = -bet; payout = 0; }

    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);
    userData.coins -= bet;
    userData.totalGambled = (userData.totalGambled || 0) + bet;
    if (payout > 0) {
        userData.coins += payout;
        if (outcome === 'win') userData.totalWon = (userData.totalWon || 0) + bet;
    }
    if (outcome === 'lose') userData.totalLost = (userData.totalLost || 0) + bet;
    economyManager.addXP(economy, userId, outcome === 'win' ? 6 : 2);
    economyManager.checkAllAchievements(economy, userId);
    economyManager.saveEconomy(economy);

    let resultText, color;
    if (outcome === 'win') { resultText = `<:Checkedbox:1521227734943269077> **You Win!** +${formatCoins(profit, guildId)}`; color = 0x57F287; }
    else if (outcome === 'lose') { resultText = `<:Cancel:1521227723916181644> **You Lose!** -${formatCoins(bet, guildId)}`; color = 0xED4245; }
    else { resultText = `🤝 **Tie!** Bet refunded.`; color = 0xFEE75C; }

    const content = [
        `# ✊ Rock Paper Scissors`,
        ``,
        `### Match`,
        `> **You:** ${p.emoji} ${p.label}`,
        `> **Bot:** ${b.emoji} ${b.label}`,
        ``,
        `### Result`,
        `> ${resultText}`,
        ``,
        `💼 **Balance:** ${formatCoins(userData.coins, guildId)}`
    ].join('\n');

    const c = new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

function buildPvpPickContainer(game, finalChoices = null) {
    const guildId = game.guildId;
    const aName = `<@${game.aId}>`;
    const bName = `<@${game.bId}>`;
    const aPicked = !!game.aPick;
    const bPicked = !!game.bPick;
    const indicator = (picked) => picked ? '<:Checkedbox:1521227734943269077> Picked' : '⏳ Choosing...';

    let body;
    let accent = 0xCAD7E6;
    if (finalChoices) {
        const { aChoice, bChoice, outcome, winnerId } = finalChoices;
        const ac = CHOICES[aChoice], bc = CHOICES[bChoice];
        body = [
            `${aName}: ${ac.emoji} **${ac.label}**`,
            `${bName}: ${bc.emoji} **${bc.label}**`,
            ``,
            outcome === 'tie'
                ? `### 🤝 Tie — both bets of ${formatCoins(game.bet, guildId)} refunded`
                : `### 🏆 <@${winnerId}> wins ${formatCoins(game.bet * 2, guildId)}!`
        ].join('\n');
        accent = outcome === 'tie' ? 0xFEE75C : 0x57F287;
    } else {
        body = [
            `${aName}: ${indicator(aPicked)}`,
            `${bName}: ${indicator(bPicked)}`,
            ``,
            `Both players — pick your move below.`
        ].join('\n');
    }

    const content = [
        `# ✊ RPS Match`,
        ``,
        `**Bet:** ${formatCoins(game.bet, guildId)} each • **Pot:** ${formatCoins(game.bet * 2, guildId)}`,
        ``,
        body
    ].join('\n');

    const c = new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    if (!finalChoices) {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`rps_${game.id}_rock`).setLabel('Rock').setEmoji('🪨').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`rps_${game.id}_paper`).setLabel('Paper').setEmoji('📜').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`rps_${game.id}_scissors`).setLabel('Scissors').setEmoji('✂️').setStyle(ButtonStyle.Secondary)
        ));
    }
    return c;
}

function startPvpGame(aId, bId, guildId, bet) {
    deductBoth(aId, bId, bet);
    const id = `${aId}-${bId}-${Date.now()}`;
    const game = {
        id, aId, bId, guildId, bet,
        aPick: null, bPick: null,
        expiresAt: Date.now() + 5 * 60 * 1000
    };
    games.set(id, game);
    return buildPvpPickContainer(game);
}

function hasActivePvp(userId) {
    for (const g of games.values()) {
        if (g.aId === userId || g.bId === userId) return true;
    }
    return false;
}

function hasActiveChallenge(userId) {
    for (const c of challenges.values()) {
        if (c.challengerId === userId || c.opponentId === userId) return true;
    }
    return false;
}

async function handleChallengeButton(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('rpsch_')) return false;
    const m = customId.match(/^rpsch_(accept|decline)_(.+)$/);
    if (!m) return false;
    const [, action, challengeId] = m;
    const ch = challenges.get(challengeId);

    if (!ch) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> Challenge expired.', flags: MessageFlags.Ephemeral }).catch(() => { });
        return true;
    }
    if (interaction.user.id !== ch.opponentId) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> Only the challenged user can respond.', flags: MessageFlags.Ephemeral }).catch(() => { });
        return true;
    }

    if (action === 'decline') {
        challenges.delete(challengeId);
        const c = new ContainerBuilder().setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# ✊ Challenge Declined\n\n<@${ch.opponentId}> declined the match.`
            ));
        await interaction.update({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
        return true;
    }

    const economy = economyManager.loadEconomy();
    const a = economyManager.getUser(economy, ch.challengerId).userData;
    const b = economyManager.getUser(economy, ch.opponentId).userData;
    if (a.coins < ch.bet || b.coins < ch.bet) {
        challenges.delete(challengeId);
        await interaction.update(pvpError(`One of the players no longer has enough coins for this match.`)).catch(() => { });
        return true;
    }

    challenges.delete(challengeId);
    const container = startPvpGame(ch.challengerId, ch.opponentId, ch.guildId, ch.bet);
    await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
    return true;
}

async function handlePickButton(interaction) {
    const customId = interaction.customId;
    if (!customId.startsWith('rps_')) return false;

    const m = customId.match(/^rps_(.+)_(rock|paper|scissors)$/);
    if (!m) return false;
    const [, gameId, pick] = m;
    const game = games.get(gameId);

    if (!game) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> Match expired.', flags: MessageFlags.Ephemeral }).catch(() => { });
        return true;
    }

    if (interaction.user.id !== game.aId && interaction.user.id !== game.bId) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> Not your match.', flags: MessageFlags.Ephemeral }).catch(() => { });
        return true;
    }

    const isA = interaction.user.id === game.aId;
    if (isA && game.aPick) {
        await interaction.reply({ content: `<:Sandwatch:1521228272426418367> You already picked **${CHOICES[game.aPick].label}**.`, flags: MessageFlags.Ephemeral }).catch(() => { });
        return true;
    }
    if (!isA && game.bPick) {
        await interaction.reply({ content: `<:Sandwatch:1521228272426418367> You already picked **${CHOICES[game.bPick].label}**.`, flags: MessageFlags.Ephemeral }).catch(() => { });
        return true;
    }

    if (isA) game.aPick = pick;
    else game.bPick = pick;

    if (game.aPick && game.bPick) {
        const a = CHOICES[game.aPick], b = CHOICES[game.bPick];
        let outcome, winnerId = null, loserId = null;
        if (game.aPick === game.bPick) outcome = 'tie';
        else if (a.beats === game.bPick) { outcome = 'win'; winnerId = game.aId; loserId = game.bId; }
        else { outcome = 'win'; winnerId = game.bId; loserId = game.aId; }

        settlePvP({
            winnerId, loserId,
            aId: game.aId, bId: game.bId,
            bet: game.bet,
            draw: outcome === 'tie'
        });
        games.delete(gameId);

        const container = buildPvpPickContainer(game, {
            aChoice: game.aPick, bChoice: game.bPick, outcome, winnerId
        });
        try {
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (e) { /* swallow */ }
        return true;
    }

    try {
        await interaction.update({ components: [buildPvpPickContainer(game)], flags: MessageFlags.IsComponentsV2 });
    } catch (e) { }
    await interaction.followUp({
        content: `<:Checkedbox:1521227734943269077> Locked in: ${CHOICES[pick].emoji} **${CHOICES[pick].label}**.`,
        flags: MessageFlags.Ephemeral
    }).catch(() => { });
    return true;
}

async function runStart(reply, userId, guildId, choice, betArg, opponent) {
    const balance = getBalance(userId);
    const validOpponent = opponent && !opponent.bot && opponent.id !== userId ? opponent : null;

    if (!validOpponent) return handleSolo(reply, userId, guildId, choice, betArg);

    const betResult = parseBet(betArg, balance);
    if (!betResult.valid) return reply(betResult.error);
    const bet = betResult.amount;

    if (hasActivePvp(userId) || hasActiveChallenge(userId)) {
        return reply(pvpError('Finish your active RPS match or pending challenge first.'));
    }
    if (hasActivePvp(validOpponent.id) || hasActiveChallenge(validOpponent.id)) {
        return reply(pvpError(`<@${validOpponent.id}> already has an active match or pending challenge.`));
    }

    const v = validateOpponent(userId, validOpponent, bet);
    if (!v.ok) return reply(v.message);

    const challengeId = `${userId}-${validOpponent.id}-${Date.now()}`;
    challenges.set(challengeId, {
        challengerId: userId, opponentId: validOpponent.id, guildId, bet,
        expiresAt: Date.now() + 60_000
    });

    return reply(buildChallenge({
        gameLabel: 'Rock Paper Scissors', gameEmoji: '✊',
        challengerId: userId, opponentId: validOpponent.id, bet, guildId,
        idPrefix: 'rpsch', challengeId
    }));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rps')
        .setDescription('Rock Paper Scissors — bet vs the bot or challenge another user')
        .addStringOption(o => o.setName('bet').setDescription(`Amount to bet (max ${MAX_BET.toLocaleString()}) or "all"`).setRequired(true))
        .addStringOption(o => o.setName('choice').setDescription('Your move (solo only — ignored for PvP)').setRequired(false)
            .addChoices(
                { name: '🪨 Rock', value: 'rock' },
                { name: '📜 Paper', value: 'paper' },
                { name: '✂️ Scissors', value: 'scissors' }
            ))
        .addUserOption(o => o.setName('opponent').setDescription('Challenge a player (optional, bot plays if empty)').setRequired(false)),

    prefix: 'rps',
    description: 'RPS — bet vs the bot or challenge another user. Win pays 2×, tie refunds.',
    usage: 'rps <bet> [@opponent]  •  Solo: rps <choice> <bet>',
    category: 'economy',
    aliases: ['rockpaperscissors', 'rpsbet'],

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        const bet = interaction.options.getString('bet');
        const choice = interaction.options.getString('choice');
        const opponent = interaction.options.getUser('opponent');
        return runStart(o => interaction.reply(o), interaction.user.id, interaction.guild?.id, choice, bet, opponent);
    },

    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        const opponent = await resolveUser(message, args);
        const { choice, betArg } = pickFromTokens(args);
        return runStart(o => message.reply(o), message.author.id, message.guild?.id, choice, betArg, opponent);
    },

    async handleButton(interaction) {
        if (interaction.customId.startsWith('rpsch_')) return handleChallengeButton(interaction);
        if (interaction.customId.startsWith('rps_')) return handlePickButton(interaction);
        return false;
    }
};
