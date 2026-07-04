'use strict';

/**
 * Hangman — bet on guessing the word in ≤6 wrong guesses.
 *
 * Pay model: bet up-front, win pays 2×, loss keeps the bet.
 *
 * No "play again" button — that would leak the bet for free. Players
 * must run the command again with a new bet to play another round.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags
} = require('discord.js');
const economyManager = require('../../utils/economyManager');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const { gamblingGuard } = require('../../utils/economyGuards');
const { formatCoinsShort, formatCoins } = require('../../utils/currencyHelper');

const WORDS = [
    'APPLE', 'BRAVE', 'CLOUD', 'DANCE', 'EAGLE', 'FLAME', 'GRACE', 'HEART', 'IVORY',
    'JEWEL', 'KNIFE', 'LEMON', 'MANGO', 'NOBLE', 'OCEAN', 'PIANO', 'RIVER', 'STORM',
    'TIGER', 'ULTRA', 'VAPOR', 'WITCH', 'AMBER', 'BLAZE', 'CORAL', 'DRIFT', 'EMBER',
    'FROST', 'GLADE', 'HAVEN', 'JOKER', 'KARMA', 'LUNAR', 'MAPLE', 'NEXUS', 'ORBIT',
    'PRISM', 'RADAR', 'SOLAR', 'TEMPO', 'UNION', 'WORLD', 'PIXEL', 'REBEL', 'SHADE',
    'TOWER', 'VALOR', 'ARENA', 'BRUSH', 'CRANE', 'DELTA', 'EQUIP', 'FLAIR', 'GLOBE'
];

const STAGES = [
    '```\n  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========```',
    '```\n  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========```',
    '```\n  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========```',
    '```\n  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========```',
    '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========```',
    '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========```',
    '```\n  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n=========```'
];

const games = new Map();
setInterval(() => {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, g] of games) if (g.createdAt < cutoff) games.delete(id);
}, 5 * 60 * 1000);

function settle(userId, bet, payout) {
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);
    if (payout > 0) {
        userData.coins += payout;
        if (payout > bet) userData.totalWon = (userData.totalWon || 0) + (payout - bet);
    }
    if (payout < bet) {
        userData.totalLost = (userData.totalLost || 0) + (bet - payout);
    }
    economyManager.addXP(economy, userId, payout > bet ? 8 : 2);
    economyManager.checkAllAchievements(economy, userId);
    economyManager.saveEconomy(economy);
    return userData;
}

function buildContainer(game, payoutInfo = null) {
    const display = game.word.split('').map(l => game.guessed.includes(l) ? `**${l}**` : '\\_').join('  ');
    const wrongLetters = game.guessed.filter(l => !game.word.includes(l));

    let body;
    if (game.status === 'won') body = `### 🎉 You won!\nThe word was **${game.word}**`;
    else if (game.status === 'lost') body = `### 💀 Game Over\nThe word was **${game.word}**`;
    else {
        body = [
            display,
            ``,
            `<:Cancel:1521227723916181644> Wrong (${game.wrong}/6): ${wrongLetters.length > 0 ? wrongLetters.join('  ') : 'None'}`,
            `-# All guessed: ${game.guessed.length > 0 ? game.guessed.join('  ') : 'None'}`,
        ].join('\n');
    }

    let content = `# 🔤 Hangman\n\n**Bet:** ${formatCoinsShort(game.bet, game.guildId)}\n${STAGES[game.wrong]}\n${body}`;
    if (payoutInfo) content += `\n\n${payoutInfo}`;

    const accent = game.status === 'won' ? 0x57F287 : game.status === 'lost' ? 0xED4245 : 0xCAD7E6;
    const c = new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    if (game.status === 'playing') {
        c.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`hangman_${game.id}`)
                .setLabel('Guess a Letter')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('🔤')
        ));
    }
    return c;
}

function startGame(userId, guildId, bet) {
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, userId);
    userData.coins -= bet;
    userData.totalGambled = (userData.totalGambled || 0) + bet;
    economyManager.saveEconomy(economy);

    const id = `${userId}-${Date.now()}`;
    const game = {
        id, playerId: userId, guildId, bet,
        word: WORDS[Math.floor(Math.random() * WORDS.length)],
        guessed: [], wrong: 0, status: 'playing',
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
                    `<:Infotriangle:1521227710381428926> Finish your active hangman game first.`
                ));
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
    }

    return reply({ components: [startGame(userId, guildId, r.amount)], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hangman')
        .setDescription('Hangman — guess the word in 6 wrong tries to win 2× your bet')
        .addStringOption(o => o.setName('bet').setDescription(`Amount to bet (max ${MAX_BET.toLocaleString()}) or "all"`).setRequired(true)),
    prefix: 'hangman',
    aliases: ['hm'],
    description: 'Bet on guessing the word in ≤6 wrong guesses — win pays 2×.',
    usage: 'hangman <bet>',
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
        if (!customId.startsWith('hangman_')) return false;

        const gameId = customId.slice('hangman_'.length);
        const game = games.get(gameId);
        if (!game || game.status !== 'playing') {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Game expired.', flags: MessageFlags.Ephemeral }).catch(() => { });
            return true;
        }
        if (interaction.user.id !== game.playerId) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Not your game.', flags: MessageFlags.Ephemeral }).catch(() => { });
            return true;
        }

        return interaction.showModal(
            new ModalBuilder()
                .setCustomId(`hangmanmodal_${gameId}`)
                .setTitle('Guess a letter')
                .addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('letter')
                        .setLabel('A single letter (A–Z)')
                        .setStyle(TextInputStyle.Short)
                        .setMinLength(1).setMaxLength(1)
                        .setRequired(true)
                ))
        );
    },

    async handleModal(interaction) {
        const customId = interaction.customId;
        if (!customId.startsWith('hangmanmodal_')) return false;

        const gameId = customId.slice('hangmanmodal_'.length);
        const game = games.get(gameId);
        if (!game || game.status !== 'playing') {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Game expired.', flags: MessageFlags.Ephemeral });
        }

        const letter = interaction.fields.getTextInputValue('letter').trim().toUpperCase();
        if (!/^[A-Z]$/.test(letter)) {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> Enter a single letter A–Z.', flags: MessageFlags.Ephemeral });
        }
        if (game.guessed.includes(letter)) {
            return interaction.reply({ content: `<:Cancel:1521227723916181644> Already guessed **${letter}**.`, flags: MessageFlags.Ephemeral });
        }

        game.guessed.push(letter);
        if (!game.word.includes(letter)) {
            game.wrong++;
            if (game.wrong >= 6) game.status = 'lost';
        } else if (game.word.split('').every(l => game.guessed.includes(l))) {
            game.status = 'won';
        }

        let info = null;
        if (game.status === 'won') {
            settle(game.playerId, game.bet, game.bet * 2);
            info = `<:Checkedbox:1521227734943269077> +${formatCoinsShort(game.bet, game.guildId)} profit`;
            games.delete(gameId);
        } else if (game.status === 'lost') {
            settle(game.playerId, game.bet, 0);
            info = `<:Cancel:1521227723916181644> Lost ${formatCoinsShort(game.bet, game.guildId)}`;
            games.delete(gameId);
        }

        const container = buildContainer(game, info);
        // Edit the original message; deferUpdate the modal.
        await interaction.deferUpdate().catch(() => { });
        await interaction.message?.edit({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
        return true;
    }
};
