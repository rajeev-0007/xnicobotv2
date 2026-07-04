const { SlashCommandBuilder } = require('discord.js');
const ui = require('../../utils/gamesUI');

function titleCase(str) {
    return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const puzzles = [
    { emojis: '🎬🦁👑', answer: 'the lion king', accepts: ['the lion king', 'lion king'] },
    { emojis: '🧊❄️👸', answer: 'frozen', accepts: ['frozen'] },
    { emojis: '🕷️🧑🕸️', answer: 'spider-man', accepts: ['spiderman', 'spider-man', 'spider man'] },
    { emojis: '⭐🔫⚔️', answer: 'star wars', accepts: ['star wars', 'starwars'] },
    { emojis: '🧙‍♂️💍🌋', answer: 'lord of the rings', accepts: ['lord of the rings', 'lotr'] },
    { emojis: '🦇🌃🦸', answer: 'batman', accepts: ['batman', 'the batman'] },
    { emojis: '🧱🏠🐷', answer: 'three little pigs', accepts: ['three little pigs', '3 little pigs', 'the three little pigs'] },
    { emojis: '🐠🔍🌊', answer: 'finding nemo', accepts: ['finding nemo', 'nemo'] },
    { emojis: '👻🔫👨‍👨‍👦', answer: 'ghostbusters', accepts: ['ghostbusters', 'ghost busters'] },
    { emojis: '🏴‍☠️⚓🗺️', answer: 'pirates of the caribbean', accepts: ['pirates of the caribbean', 'pirates'] },
    { emojis: '🦖🏝️🔬', answer: 'jurassic park', accepts: ['jurassic park', 'jurassic world'] },
    { emojis: '🧪💀☠️', answer: 'breaking bad', accepts: ['breaking bad'] },
    { emojis: '🏠⬆️🎈', answer: 'up', accepts: ['up'] },
    { emojis: '🐀👨‍🍳🇫🇷', answer: 'ratatouille', accepts: ['ratatouille'] },
    { emojis: '🚀👨‍🚀🌙', answer: 'interstellar', accepts: ['interstellar'] },
    { emojis: '🤖<:Heart:1521228100652765247>🌱', answer: 'wall-e', accepts: ['wall-e', 'walle', 'wall e'] },
    { emojis: '🦈🌊😱', answer: 'jaws', accepts: ['jaws'] },
    { emojis: '👨‍🔬⚡🧟', answer: 'frankenstein', accepts: ['frankenstein'] },
    { emojis: '🧜‍♀️🌊🏰', answer: 'the little mermaid', accepts: ['the little mermaid', 'little mermaid'] },
    { emojis: '🐒🍌🏝️', answer: 'donkey kong', accepts: ['donkey kong'] }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('emojiguess')
        .setDescription('Guess the movie, show, or character from emoji clues!'),

    prefix: 'emojiguess',
    description: 'Guess the movie, show, or character from emoji clues!',
    usage: 'emojiguess',
    category: 'games',
    aliases: ['emojiquiz', 'emojigame', 'eg'],

    async execute(interaction) {
        await playEmojiGuess(interaction, true);
    },

    async executePrefix(message) {
        await playEmojiGuess(message, false);
    }
};

async function playEmojiGuess(context, isInteraction) {
    const channel = context.channel;
    const gid = context.guild?.id;
    const authorId = isInteraction ? context.user.id : context.author.id;
    const puzzle = puzzles[Math.floor(Math.random() * puzzles.length)];

    await context.reply(ui.payload(ui.panel(gid, {
        emoji: '🎯',
        title: 'Emoji Guess!',
        body: `What movie, show, or character do these emojis represent?\n\n# ${puzzle.emojis}`,
        note: 'Type your answer within 30 seconds!',
    })));

    const filter = m => m.author.id === authorId;

    try {
        const collected = await channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
        const guess = collected.first().content.toLowerCase().trim();

        if (puzzle.accepts.includes(guess)) {
            await channel.send(ui.payload(ui.ok(gid, 'Correct!', `${puzzle.emojis} = **${titleCase(puzzle.answer)}**!`, `${ui.E.gift} You nailed it!`)));
        } else {
            await channel.send(ui.payload(ui.err(gid, 'Not Quite!', `You guessed: **${guess}**\nThe answer was: **${titleCase(puzzle.answer)}** ${puzzle.emojis}`, 'Better luck next time!')));
        }
    } catch {
        await channel.send(ui.payload(ui.timeout(gid, "Time's Up!", `The answer was **${titleCase(puzzle.answer)}** ${puzzle.emojis}`)));
    }
}
