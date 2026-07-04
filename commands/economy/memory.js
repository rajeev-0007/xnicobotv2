'use strict';

/**
 * Memory — bet on finding all 8 emoji pairs in ≤ 24 flips.
 *
 * Pay model: bet up-front, payout scales with how many flips were
 * needed (fewer flips = bigger multiplier). 24 flips is the soft
 * cap; exceeding it caps the multiplier at 1.05× so a careless run
 * still recovers slightly more than the bet.
 *
 *   ≤16 flips → 3×    (perfect — every flip pair was a match)
 *   ≤18 flips → 2×
 *   ≤22 flips → 1.5×
 *   ≤26 flips → 1.2×
 *    >26 flips → 1.05×
 *
 * No "play again" — would leak the original bet for free; players
 * must run the command again with a fresh bet.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { formatCoinsShort, formatCoins } = require('../../utils/currencyHelper');
const { deductBet, settle } = require('../../utils/betGameHelper');

const EMOJIS = ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼'];

const games = new Map();
setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, g] of games) if (g.createdAt < cutoff) games.delete(id);
}, 5 * 60 * 1000);

function payoutMultiplier(flips) {
    if (flips <= 16) return 3;
    if (flips <= 18) return 2;
    if (flips <= 22) return 1.5;
    if (flips <= 26) return 1.2;
    return 1.05;
}

function buildContainer(game, payoutInfo = null) {
    let header;
    if (game.status === 'won') header = `### 🏆 All Pairs Found!`;
    else header = `Flip cards to find matching emoji pairs.`;

    let content = `# <:Gamepad:1521228035213230090> Memory\n\n**Bet:** ${formatCoinsShort(game.bet, game.guildId)}  •  **Pairs:** ${game.matched}/8  •  **Flips:** ${game.flips}\n\n${header}`;
    if (payoutInfo) content += `\n\n${payoutInfo}`;

    const accent = game.status === 'won' ? 0x57F287 : 0xCAD7E6;
    const c = new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    for (let r = 0; r < 4; r++) {
        const row = new ActionRowBuilder();
        for (let col = 0; col < 4; col++) {
            const idx = r * 4 + col;
            const tile = game.tiles[idx];
            const isFlipped = game.flipped.includes(idx) || game.pending.includes(idx);

            let label, style, disabled;
            if (tile.matched) { label = tile.emoji; style = ButtonStyle.Success; disabled = true; }
            else if (isFlipped) { label = tile.emoji; style = ButtonStyle.Primary; disabled = false; }
            else { label = '?'; style = ButtonStyle.Secondary; disabled = game.status !== 'playing'; }

            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`memory_${game.id}_${idx}`)
                    .setLabel(label)
                    .setStyle(style)
                    .setDisabled(disabled)
            );
        }
        c.addActionRowComponents(row);
    }
    return c;
}

function startGame(userId, guildId, bet) {
    deductBet(userId, bet);
    const pairs = [...EMOJIS, ...EMOJIS];
    for (let i = pairs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
    }
    const id = `${userId}-${Date.now()}`;
    const game = {
        id, playerId: userId, guildId, bet,
        tiles: pairs.map(emoji => ({ emoji, matched: false })),
        flipped: [], pending: [], matched: 0, flips: 0,
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
                    `<:Infotriangle:1521227710381428926> Finish your active memory game first.`
                ));
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
    }
    return reply({ components: [startGame(userId, guildId, r.amount)], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('memory')
        .setDescription('Match 8 emoji pairs — fewer flips = bigger payout')
        .addStringOption(o => o.setName('bet').setDescription(`Amount to bet (max ${MAX_BET.toLocaleString()}) or "all"`).setRequired(true)),
    prefix: 'memory',
    aliases: ['mem'],
    description: 'Bet on matching all 8 emoji pairs. Payout scales with flips used.',
    usage: 'memory <bet>',
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
        const customId = interaction.customId;
        if (!customId.startsWith('memory_')) return false;

        const lastUnderscore = customId.lastIndexOf('_');
        const idx = parseInt(customId.slice(lastUnderscore + 1), 10);
        const gameId = customId.slice('memory_'.length, lastUnderscore);
        const game = games.get(gameId);

        if (!game || game.status !== 'playing') {
            await interaction.deferUpdate().catch(() => {});
            return true;
        }
        if (interaction.user.id !== game.playerId) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Not your game.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }

        const tile = game.tiles[idx];
        if (game.pending.length === 2) game.pending = []; // clear stale non-match pair
        if (tile.matched || game.flipped.includes(idx) || game.pending.includes(idx)) {
            await interaction.deferUpdate().catch(() => {});
            return true;
        }

        game.flips++;
        if (game.flipped.length === 0) {
            game.flipped = [idx];
        } else {
            const firstIdx = game.flipped[0];
            if (game.tiles[firstIdx].emoji === tile.emoji) {
                game.tiles[firstIdx].matched = true;
                tile.matched = true;
                game.matched++;
                game.flipped = [];
                if (game.matched === 8) game.status = 'won';
            } else {
                game.pending = [firstIdx, idx];
                game.flipped = [];
            }
        }

        let info = null;
        if (game.status === 'won') {
            const mult = payoutMultiplier(game.flips);
            const payout = Math.floor(game.bet * mult);
            settle(game.playerId, game.bet, payout);
            info = `<:Checkedbox:1521227734943269077> ${mult}× payout → +${formatCoinsShort(payout - game.bet, game.guildId)} profit`;
            games.delete(gameId);
        }

        try {
            await interaction.update({ components: [buildContainer(game, info)], flags: MessageFlags.IsComponentsV2 });
        } catch (e) {
            if (e.code !== 10008 && e.code !== 40060) console.error('[Memory] update error:', e);
        }
        return true;
    }
};
