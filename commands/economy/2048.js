'use strict';

/**
 * 2048 — bet on reaching a high tile.
 *
 * Pay model: bet up-front, payout based on the highest tile reached
 * when the player either WINS (hits 2048), CASHES OUT, or LOSES
 * (board full, no moves possible).
 *
 *   tile 2048+ → 5×    (jackpot)
 *   tile 1024  → 3×
 *   tile 512   → 2×
 *   tile 256   → 1.5×
 *   tile 128   → 1.2×
 *   tile <128  → 0×    (lost the bet)
 *
 * The game adds a "Cash Out" button so the player can lock in
 * winnings whenever the highest tile reaches 128 or above. If the
 * board fills up before reaching 128, the bet is lost.
 *
 * No "play again" — that would leak the original bet for free.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { formatCoinsShort, formatCoins , coinIcon } = require('../../utils/currencyHelper');
const { deductBet, settle } = require('../../utils/betGameHelper');

const games = new Map();
setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, g] of games) if (g.createdAt < cutoff) games.delete(id);
}, 5 * 60 * 1000);

function spawnTile(grid) {
    const empty = grid.reduce((acc, v, i) => v === 0 ? [...acc, i] : acc, []);
    if (empty.length === 0) return;
    grid[empty[Math.floor(Math.random() * empty.length)]] = Math.random() < 0.9 ? 2 : 4;
}

function slideRow(row) {
    const filtered = row.filter(v => v !== 0);
    let points = 0;
    for (let i = 0; i < filtered.length - 1; i++) {
        if (filtered[i] !== 0 && filtered[i] === filtered[i + 1]) {
            filtered[i] *= 2;
            points += filtered[i];
            filtered[i + 1] = 0;
        }
    }
    const merged = filtered.filter(v => v !== 0);
    while (merged.length < 4) merged.push(0);
    return { row: merged, points };
}

function move(grid, dir) {
    const ng = [...grid];
    let totalPoints = 0, moved = false;
    const getRow = r => [0,1,2,3].map(c => ng[r * 4 + c]);
    const getCol = c => [0,1,2,3].map(r => ng[r * 4 + c]);
    const setRow = (r, row) => row.forEach((v, c) => { ng[r * 4 + c] = v; });
    const setCol = (c, col) => col.forEach((v, r) => { ng[r * 4 + c] = v; });

    if (dir === 'left') {
        for (let r = 0; r < 4; r++) {
            const orig = getRow(r);
            const { row, points } = slideRow([...orig]);
            if (orig.join() !== row.join()) moved = true;
            setRow(r, row); totalPoints += points;
        }
    } else if (dir === 'right') {
        for (let r = 0; r < 4; r++) {
            const orig = getRow(r);
            const { row, points } = slideRow([...orig].reverse());
            const result = row.reverse();
            if (orig.join() !== result.join()) moved = true;
            setRow(r, result); totalPoints += points;
        }
    } else if (dir === 'up') {
        for (let c = 0; c < 4; c++) {
            const orig = getCol(c);
            const { row, points } = slideRow([...orig]);
            if (orig.join() !== row.join()) moved = true;
            setCol(c, row); totalPoints += points;
        }
    } else if (dir === 'down') {
        for (let c = 0; c < 4; c++) {
            const orig = getCol(c);
            const { row, points } = slideRow([...orig].reverse());
            const result = row.reverse();
            if (orig.join() !== result.join()) moved = true;
            setCol(c, result); totalPoints += points;
        }
    }
    return { newGrid: ng, totalPoints, moved };
}

function isGameOver(grid) {
    if (grid.includes(0)) return false;
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            const v = grid[r * 4 + c];
            if (c < 3 && grid[r * 4 + c + 1] === v) return false;
            if (r < 3 && grid[(r + 1) * 4 + c] === v) return false;
        }
    }
    return true;
}

function highestTile(grid) {
    return Math.max(...grid);
}

function payoutMultiplier(highest) {
    if (highest >= 2048) return 5;
    if (highest >= 1024) return 3;
    if (highest >= 512)  return 2;
    if (highest >= 256)  return 1.5;
    if (highest >= 128)  return 1.2;
    return 0;
}

function buildContainer(game, payoutInfo = null) {
    const rows = [0,1,2,3].map(r => [0,1,2,3].map(c => game.grid[r * 4 + c]));
    const board = rows.map(row => row.map(v => v === 0 ? '   ·' : String(v).padStart(4, ' ')).join(' ')).join('\n');
    const top = highestTile(game.grid);
    const mult = payoutMultiplier(top);

    let header;
    if (game.status === 'won')      header = `### 🏆 You hit 2048!`;
    else if (game.status === 'lost') header = `### 💀 No more moves!`;
    else if (game.status === 'cashed') header = `### ${coinIcon(game.guildId)} Cashed out at tile ${top}!`;
    else                              header = `Slide tiles. Highest tile: **${top}**  ·  Current payout: **${mult}×**`;

    let content = `# <:Gamepad:1521228035213230090> 2048\n\n**Bet:** ${formatCoinsShort(game.bet, game.guildId)}  •  **Score:** ${game.score}\n\n${header}\n\`\`\`\n${board}\n\`\`\``;
    if (payoutInfo) content += `\n${payoutInfo}`;

    const accent = game.status === 'won' ? 0x57F287
        : game.status === 'lost' ? 0xED4245
        : game.status === 'cashed' ? 0xFEE75C
        : 0xCAD7E6;

    const c = new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    if (game.status === 'playing') {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`g2048_${game.id}_up`).setLabel('Up').setStyle(ButtonStyle.Primary).setEmoji('⬆️'),
            new ButtonBuilder().setCustomId(`g2048_${game.id}_down`).setLabel('Down').setStyle(ButtonStyle.Primary).setEmoji('⬇️'),
            new ButtonBuilder().setCustomId(`g2048_${game.id}_left`).setLabel('Left').setStyle(ButtonStyle.Secondary).setEmoji('⬅️'),
            new ButtonBuilder().setCustomId(`g2048_${game.id}_right`).setLabel('Right').setStyle(ButtonStyle.Secondary).setEmoji('➡️')
        ));
        // Cash-out only when there's actually a positive multiplier.
        if (mult > 0) {
            c.addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`g2048_${game.id}_cashout`)
                    .setLabel(`Cash Out (${mult}× = ${formatCoinsShort(Math.floor(game.bet * mult), game.guildId)})`)
                    .setStyle(ButtonStyle.Success)
            ));
        }
    }
    return c;
}

function startGame(userId, guildId, bet) {
    deductBet(userId, bet);
    const grid = Array(16).fill(0);
    spawnTile(grid); spawnTile(grid);
    const id = `${userId}-${Date.now()}`;
    const game = {
        id, playerId: userId, guildId, bet,
        grid, score: 0, status: 'playing',
        createdAt: Date.now()
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
                    `<:Infotriangle:1521227710381428926> Finish your active 2048 game first.`
                ));
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
    }
    return reply({ components: [startGame(userId, guildId, r.amount)], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('2048')
        .setDescription('2048 — bet, slide tiles, cash out at higher tiles for bigger payouts')
        .addStringOption(o => o.setName('bet').setDescription(`Amount to bet (max ${MAX_BET.toLocaleString()}) or "all"`).setRequired(true)),
    prefix: '2048',
    aliases: ['twentyfortyeight'],
    description: 'Bet, slide tiles, cash out at higher tiles for bigger payouts (max 5× at 2048).',
    usage: '2048 <bet>',
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
        if (!customId.startsWith('g2048_')) return false;

        const lastUnderscore = customId.lastIndexOf('_');
        const action = customId.slice(lastUnderscore + 1);
        const gameId = customId.slice('g2048_'.length, lastUnderscore);
        const game = games.get(gameId);

        if (!game || game.status !== 'playing') {
            await interaction.deferUpdate().catch(() => {});
            return true;
        }
        if (interaction.user.id !== game.playerId) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Not your game.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return true;
        }

        let info = null;

        if (action === 'cashout') {
            const top = highestTile(game.grid);
            const mult = payoutMultiplier(top);
            if (mult <= 0) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Reach tile 128 first to cash out.', flags: MessageFlags.Ephemeral }).catch(() => {});
                return true;
            }
            game.status = 'cashed';
            const payout = Math.floor(game.bet * mult);
            settle(game.playerId, game.bet, payout);
            info = `<:Checkedbox:1521227734943269077> Cashed out — +${formatCoinsShort(payout - game.bet, game.guildId)} profit (received ${formatCoinsShort(payout, game.guildId)})`;
            games.delete(gameId);
        } else {
            const { newGrid, totalPoints, moved } = move(game.grid, action);
            if (!moved) {
                await interaction.deferUpdate().catch(() => {});
                return true;
            }
            game.grid = newGrid;
            game.score += totalPoints;
            if (game.grid.includes(2048)) {
                game.status = 'won';
                const payout = Math.floor(game.bet * payoutMultiplier(2048));
                settle(game.playerId, game.bet, payout);
                info = `<:Checkedbox:1521227734943269077> Hit 2048 — +${formatCoinsShort(payout - game.bet, game.guildId)} profit`;
                games.delete(gameId);
            } else {
                spawnTile(game.grid);
                if (isGameOver(game.grid)) {
                    game.status = 'lost';
                    const top = highestTile(game.grid);
                    const mult = payoutMultiplier(top);
                    const payout = mult > 0 ? Math.floor(game.bet * mult) : 0;
                    settle(game.playerId, game.bet, payout);
                    info = mult > 0
                        ? `Game over but tile ${top} paid ${mult}× → ${formatCoinsShort(payout, game.guildId)} returned`
                        : `<:Cancel:1521227723916181644> Lost ${formatCoinsShort(game.bet, game.guildId)}`;
                    games.delete(gameId);
                }
            }
        }

        try {
            await interaction.update({ components: [buildContainer(game, info)], flags: MessageFlags.IsComponentsV2 });
        } catch (e) {
            if (e.code !== 10008 && e.code !== 40060) console.error('[2048] update error:', e);
        }
        return true;
    }
};
