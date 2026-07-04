const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const ui = require('../../utils/gamesUI');

const wordList = [
    'apple', 'brave', 'charm', 'dance', 'eager', 'flame', 'grace', 'haven', 'image', 'juice',
    'kneel', 'lemon', 'magic', 'noble', 'ocean', 'peace', 'queen', 'raise', 'shine', 'track',
    'ultra', 'voice', 'wheat', 'yacht', 'zebra', 'angry', 'blend', 'chain', 'dream', 'earth',
    'focus', 'giant', 'heart', 'ivory', 'jolly', 'known', 'lunar', 'medal', 'nerve', 'olive',
    'pilot', 'query', 'rider', 'stone', 'tower', 'unity', 'vivid', 'whale', 'youth', 'world',
    'about', 'beach', 'cloud', 'drink', 'empty', 'fresh', 'green', 'happy', 'input', 'jumpy',
    'kayak', 'light', 'money', 'night', 'order', 'piano', 'quiet', 'river', 'sugar', 'tiger'
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wordle')
        .setDescription('Play Wordle - guess the 5-letter word in 6 tries!'),

    prefix: 'wordle',
    description: 'Play Wordle - guess the 5-letter word in 6 tries!',
    usage: 'wordle',
    category: 'games',
    aliases: ['wd'],

    async execute(interaction) {
        await playWordle(interaction, true);
    },

    async executePrefix(message) {
        await playWordle(message, false);
    }
};

async function playWordle(context, isInteraction) {
    const channel = context.channel;
    const gid = context.guild?.id;
    const authorId = isInteraction ? context.user.id : context.author.id;
    const word = wordList[Math.floor(Math.random() * wordList.length)];
    const maxAttempts = 6;
    const guesses = [];

    await context.reply(ui.payload(ui.panel(gid, {
        emoji: '🟩',
        title: 'Wordle',
        body: `Guess the **5-letter** word in **${maxAttempts}** tries!\n\n${ui.rows([
            '🟩 = Correct letter & position',
            '🟨 = Correct letter, wrong position',
            '⬛ = Letter not in word',
        ])}`,
        note: 'Type a 5-letter word to guess!',
    })));

    const filter = m => m.author.id === authorId && /^[a-zA-Z]{5}$/.test(m.content.trim());
    const collector = channel.createMessageCollector({ filter, time: 180000, max: maxAttempts });

    collector.on('collect', async (msg) => {
        const guess = msg.content.toLowerCase().trim();
        const result = evaluateGuess(guess, word);
        guesses.push({ guess, result });

        if (guess === word) {
            collector.stop('won');
            return;
        }

        if (guesses.length >= maxAttempts) {
            collector.stop('lost');
            return;
        }

        const board = buildBoard(guesses);
        const remaining = maxAttempts - guesses.length;
        await channel.send(ui.payload(ui.panel(gid, {
            emoji: '🟩',
            title: 'Wordle',
            body: `${board}\n\n**${remaining}** ${remaining === 1 ? 'try' : 'tries'} remaining`,
            note: 'Type another 5-letter word!',
        })));
    });

    collector.on('end', async (collected, reason) => {
        const board = buildBoard(guesses);

        if (reason === 'won') {
            const attempts = guesses.length;
            let rating;
            if (attempts === 1) rating = '🏆 **Incredible!** First try!';
            else if (attempts <= 3) rating = '<:Star:1521227981685526568> **Amazing!**';
            else if (attempts <= 5) rating = '<:Checkedbox:1521227734943269077> **Well done!**';
            else rating = '😅 **Close one!**';

            await channel.send(ui.payload(ui.ok(gid, 'Wordle — You Win!',
                `${board}\n\nThe word was **${word.toUpperCase()}**!\nSolved in **${attempts}/${maxAttempts}** ${attempts === 1 ? 'try' : 'tries'}!\n\n${rating}`)));
        } else if (reason === 'lost') {
            await channel.send(ui.payload(ui.err(gid, 'Wordle — Game Over!',
                `${board}\n\nThe word was **${word.toUpperCase()}**!`, 'Better luck next time!')));
        } else if (reason === 'time') {
            await channel.send(ui.payload(ui.timeout(gid, "Time's Up!",
                `${guesses.length > 0 ? board + '\n\n' : ''}The word was **${word.toUpperCase()}**!`)));
        }
    });
}

function evaluateGuess(guess, word) {
    const result = Array(5).fill('⬛');
    const wordChars = word.split('');
    const guessChars = guess.split('');
    const used = Array(5).fill(false);

    for (let i = 0; i < 5; i++) {
        if (guessChars[i] === wordChars[i]) {
            result[i] = '🟩';
            used[i] = true;
            guessChars[i] = null;
        }
    }

    for (let i = 0; i < 5; i++) {
        if (guessChars[i] === null) continue;
        for (let j = 0; j < 5; j++) {
            if (!used[j] && guessChars[i] === wordChars[j]) {
                result[i] = '🟨';
                used[j] = true;
                break;
            }
        }
    }

    return result;
}

function buildBoard(guesses) {
    return guesses.map(g => {
        const letters = g.guess.toUpperCase().split('').map(l => `**${l}**`).join(' ');
        const colors = g.result.join('');
        return `${colors}\n${letters}`;
    }).join('\n\n');
}
