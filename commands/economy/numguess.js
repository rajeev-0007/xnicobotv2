'use strict';

/**
 * Number Guess — guess a number between 1 and 100 in 7 tries.
 *
 * Pay model: bet up-front, win pays a fewer-tries-better tiered payout,
 * loss keeps the bet entirely.
 *
 *   1 try   → 7×
 *   2 tries → 5×
 *   3 tries → 3×
 *   4 tries → 2×
 *   5 tries → 1.5×
 *   6 tries → 1.2×
 *   7 tries → 1.05× (just barely beat the deduction)
 *
 * The expected value sits below 1× so it's a real bet — the player
 * has to hit the early tiers to show a profit on average.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags
} = require('discord.js');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { formatCoinsShort, formatCoins } = require('../../utils/currencyHelper');
const { deductBet, settle } = require('../../utils/betGameHelper');

const PAYOUTS = [0, 7, 5, 3, 2, 1.5, 1.2, 1.05];

const games = new Map();
setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, g] of games) if (g.createdAt < cutoff) games.delete(id);
}, 5 * 60 * 1000);

function buildContainer(game, payoutInfo = null) {
    const hint = game.lastHint === 'higher' ? '📈 Go **higher**!'
        : game.lastHint === 'lower' ? '📉 Go **lower**!'
        : '';

    let body;
    if (game.status === 'won')      body = `### 🎉 Got it!\nThe number was **${game.target}** — solved in ${game.attempts} attempt${game.attempts !== 1 ? 's' : ''}.`;
    else if (game.status === 'lost') body = `### 💀 Out of guesses!\nThe number was **${game.target}**.`;
    else {
        body = [
            `Guess a whole number from 1 to 100.`,
            hint,
            `-# Attempt **${game.attempts}/7**  •  Previous: ${game.guesses.length > 0 ? game.guesses.join(', ') : 'none'}`,
        ].filter(Boolean).join('\n');
    }

    let content = `# 🔢 Number Guess\n\n**Bet:** ${formatCoinsShort(game.bet, game.guildId)}\n\n${body}`;
    if (payoutInfo) content += `\n\n${payoutInfo}`;

    const accent = game.status === 'won' ? 0x57F287 : game.status === 'lost' ? 0xED4245 : 0xCAD7E6;
    const c = new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    if (game.status === 'playing') {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`numguess_${game.id}`)
                .setLabel('Make a Guess')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🎯')
        ));
    }
    return c;
}

function startGame(userId, guildId, bet) {
    deductBet(userId, bet);
    const id = `${userId}-${Date.now()}`;
    const game = {
        id, playerId: userId, guildId, bet,
        target: Math.floor(Math.random() * 100) + 1,
        attempts: 0, guesses: [], lastHint: null,
        status: 'playing', createdAt: Date.now()
    };
    games.set(id, game);
    return buildContainer(game);
}

async function runStart(reply, userId, guildId, args) {
    const balance = getBalance(userId);
    const r = parseBet(args[0], balance);
    if (!r.valid) return reply(r.error);

    for (const g of games.values()) {
        if (g.playerId === userId && g.status === 'playing') {
            const c = new ContainerBuilder().setAccentColor(0xFEE75C)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `<:Infotriangle:1521227710381428926> Finish your active number-guess game first.`
                ));
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
    }
    return reply({ components: [startGame(userId, guildId, r.amount)], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('numguess')
        .setDescription('Guess a number 1–100 in 7 tries — fewer tries = bigger payout')
        .addStringOption(o => o.setName('bet').setDescription(`Amount to bet (max ${MAX_BET.toLocaleString()}) or "all"`).setRequired(true)),
    prefix: 'numguess',
    aliases: ['ng', 'numbergame'],
    description: 'Bet on guessing a number 1–100 in 7 tries. Payout scales with fewer tries.',
    usage: 'numguess <bet>',
    category: 'economy',

    async execute(interaction) {
        if (await gamblingGuard(interaction)) return;
        return runStart(o => interaction.reply(o), interaction.user.id, interaction.guild?.id, [interaction.options.getString('bet')]);
    },
    async executePrefix(message, args) {
        if (await gamblingGuard(message)) return;
        return runStart(o => message.reply(o), message.author.id, message.guild?.id, args);
    },

    async handleButton(interaction) {
        if (!interaction.customId.startsWith('numguess_')) return false;
        const gameId = interaction.customId.slice('numguess_'.length);
        const game = games.get(gameId);
        if (!game || game.status !== 'playing') {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Game expired.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }
        if (interaction.user.id !== game.playerId) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Not your game.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }

        return interaction.showModal(
            new ModalBuilder()
                .setCustomId(`numguessmodal_${gameId}`)
                .setTitle('Make a guess')
                .addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('number')
                        .setLabel('A whole number 1–100')
                        .setStyle(TextInputStyle.Short)
                        .setMinLength(1).setMaxLength(3)
                        .setRequired(true)
                ))
        );
    },

    async handleModal(interaction) {
        if (!interaction.customId.startsWith('numguessmodal_')) return false;
        const gameId = interaction.customId.slice('numguessmodal_'.length);
        const game = games.get(gameId);
        if (!game || game.status !== 'playing') {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Game expired.', flags: MessageFlags.Ephemeral });
        }

        const guess = parseInt(interaction.fields.getTextInputValue('number').trim(), 10);
        if (isNaN(guess) || guess < 1 || guess > 100) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Enter a whole number 1–100.', flags: MessageFlags.Ephemeral });
        }

        game.attempts++;
        game.guesses.push(guess);

        let info = null;
        if (guess === game.target) {
            game.status = 'won';
            const mult = PAYOUTS[game.attempts] || 1.05;
            const payout = Math.floor(game.bet * mult);
            settle(game.playerId, game.bet, payout);
            info = `<:Checkedbox:1521227734943269077> Hit ${mult}× → +${formatCoinsShort(payout - game.bet, game.guildId)} profit (received ${formatCoinsShort(payout, game.guildId)})`;
            games.delete(gameId);
        } else if (game.attempts >= 7) {
            game.status = 'lost';
            settle(game.playerId, game.bet, 0);
            info = `<:Cancel:1521227723916181644> Lost ${formatCoinsShort(game.bet, game.guildId)}`;
            games.delete(gameId);
        } else {
            game.lastHint = guess < game.target ? 'higher' : 'lower';
        }

        await interaction.deferUpdate().catch(() => {});
        await interaction.message?.edit({ components: [buildContainer(game, info)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return true;
    }
};
