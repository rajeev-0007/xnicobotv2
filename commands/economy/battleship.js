'use strict';

/**
 * Battleship — bet on sinking the hidden fleet in fewer shots.
 *
 * Pay model: bet up-front, payout scales by accuracy (shots used).
 * The 5×5 grid hides one ship of length 3 and two ships of length 2,
 * so 7 cells are ships. The player can fire up to 18 shots before
 * the game forces a loss.
 *
 *   ≤9 shots  → 4×    (ace — almost no misses)
 *   ≤12 shots → 2.5×
 *   ≤15 shots → 1.5×
 *   ≤18 shots → 1.1×
 *    >18      → 0×    (lost the bet)
 *
 * No cash-out — winning means sinking every ship; you can't bail.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { formatCoinsShort, formatCoins } = require('../../utils/currencyHelper');
const { deductBet, settle } = require('../../utils/betGameHelper');

const games = new Map();
setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, g] of games) if (g.createdAt < cutoff) games.delete(id);
}, 5 * 60 * 1000);

const MAX_SHOTS = 18;

function placeShips(grid) {
    for (const len of [3, 2, 2]) {
        let placed = false, tries = 0;
        while (!placed && tries++ < 200) {
            const horiz = Math.random() < 0.5;
            const r = Math.floor(Math.random() * (horiz ? 5 : 6 - len));
            const c = Math.floor(Math.random() * (horiz ? 6 - len : 5));
            const cells = Array.from({ length: len }, (_, i) => [horiz ? r : r + i, horiz ? c + i : c]);
            if (cells.every(([nr, nc]) => !grid[nr][nc].ship)) {
                cells.forEach(([nr, nc]) => { grid[nr][nc].ship = true; });
                placed = true;
            }
        }
    }
}

function payoutMultiplier(shots) {
    if (shots <= 9) return 4;
    if (shots <= 12) return 2.5;
    if (shots <= 15) return 1.5;
    if (shots <= 18) return 1.1;
    return 0;
}

function buildContainer(game, payoutInfo = null) {
    const accuracy = game.shots > 0 ? Math.round(((game.totalShipCells - game.hitsLeft) / game.shots) * 100) : 0;

    let header;
    if (game.status === 'won')      header = `### 🏆 All ships sunk in ${game.shots} shots!`;
    else if (game.status === 'lost') header = `### 💀 Out of shots — fleet survived.`;
    else header = `Sink the hidden fleet. Shots left: **${MAX_SHOTS - game.shots}**`;

    let content = `# 🚢 Battleship\n\n**Bet:** ${formatCoinsShort(game.bet, game.guildId)}  •  **Accuracy:** ${accuracy}%  •  **Hits:** ${game.totalShipCells - game.hitsLeft}/${game.totalShipCells}\n\n${header}`;
    if (payoutInfo) content += `\n\n${payoutInfo}`;

    const accent = game.status === 'won' ? 0x57F287 : game.status === 'lost' ? 0xED4245 : 0xCAD7E6;
    const c = new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    for (let r = 0; r < 5; r++) {
        const row = new ActionRowBuilder();
        for (let col = 0; col < 5; col++) {
            const cell = game.grid[r][col];
            let label, style, disabled;
            // After a loss reveal all ships so the player sees what they missed.
            if (game.status === 'lost' && cell.ship && !cell.shot) {
                label = '🚢'; style = ButtonStyle.Secondary; disabled = true;
            } else if (cell.shot) {
                label = cell.ship ? '💥' : '🌊';
                style = cell.ship ? ButtonStyle.Danger : ButtonStyle.Secondary;
                disabled = true;
            } else {
                label = '·';
                style = ButtonStyle.Primary;
                disabled = game.status !== 'playing';
            }
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`battleship_${game.id}_${r}_${col}`)
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
    const grid = Array.from({ length: 5 }, () =>
        Array.from({ length: 5 }, () => ({ ship: false, shot: false }))
    );
    placeShips(grid);
    const totalShipCells = grid.flat().filter(c => c.ship).length;
    const id = `${userId}-${Date.now()}`;
    const game = {
        id, playerId: userId, guildId, bet,
        grid, totalShipCells, hitsLeft: totalShipCells,
        shots: 0, status: 'playing', createdAt: Date.now()
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
                    `<:Infotriangle:1521227710381428926> Finish your active battleship game first.`
                ));
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
    }
    return reply({ components: [startGame(userId, guildId, r.amount)], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battleship')
        .setDescription('Sink the fleet in 18 shots — fewer shots = bigger payout (max 4×)')
        .addStringOption(o => o.setName('bet').setDescription(`Amount to bet (max ${MAX_BET.toLocaleString()}) or "all"`).setRequired(true)),
    prefix: 'battleship',
    aliases: ['bship'],
    description: 'Bet on sinking the fleet in 18 shots. Payout scales with accuracy.',
    usage: 'battleship <bet>',
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
        if (!customId.startsWith('battleship_')) return false;

        const parts = customId.split('_');
        const col = parseInt(parts.pop(), 10);
        const r   = parseInt(parts.pop(), 10);
        const gameId = parts.slice(1).join('_');
        const game = games.get(gameId);

        if (!game || game.status !== 'playing') {
            await interaction.deferUpdate().catch(() => {});
            return true;
        }
        if (interaction.user.id !== game.playerId) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Not your game.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }

        const cell = game.grid[r][col];
        if (cell.shot) {
            await interaction.deferUpdate().catch(() => {});
            return true;
        }

        cell.shot = true;
        game.shots++;
        if (cell.ship) {
            game.hitsLeft--;
            if (game.hitsLeft === 0) game.status = 'won';
        }
        if (game.status === 'playing' && game.shots >= MAX_SHOTS) game.status = 'lost';

        let info = null;
        if (game.status === 'won') {
            const mult = payoutMultiplier(game.shots);
            const payout = Math.floor(game.bet * mult);
            settle(game.playerId, game.bet, payout);
            info = `<:Checkedbox:1521227734943269077> ${mult}× → +${formatCoinsShort(payout - game.bet, game.guildId)} profit`;
            games.delete(gameId);
        } else if (game.status === 'lost') {
            settle(game.playerId, game.bet, 0);
            info = `<:Cancel:1521227723916181644> Lost ${formatCoinsShort(game.bet, game.guildId)}`;
            games.delete(gameId);
        }

        try {
            await interaction.update({ components: [buildContainer(game, info)], flags: MessageFlags.IsComponentsV2 });
        } catch (e) {
            if (e.code !== 10008 && e.code !== 40060) console.error('[Battleship] update error:', e);
        }
        return true;
    }
};
