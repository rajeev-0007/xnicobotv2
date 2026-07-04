const { SlashCommandBuilder } = require('discord.js');
const ui = require('../../utils/gamesUI');

const words = [
    'discord', 'computer', 'javascript', 'programming', 'developer', 'keyboard', 'monitor',
    'algorithm', 'database', 'framework', 'software', 'hardware', 'network', 'internet',
    'technology', 'application', 'interface', 'graphics', 'processor', 'memory',
    'chocolate', 'adventure', 'butterfly', 'discovery', 'fantastic', 'wonderful'
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('scramble')
        .setDescription('Unscramble the word to win!'),

    prefix: 'scramble',
    description: 'Unscramble the word to win - solve the word puzzle!',
    usage: 'scramble',
    category: 'games',
    aliases: ['unscramble', 'wordscramble'],

    async execute(interaction) {
        await playScramble(interaction, true);
    },

    async executePrefix(message) {
        await playScramble(message, false);
    }
};

async function playScramble(context, isInteraction) {
    const channel = context.channel;
    const gid = context.guild?.id;
    const authorId = isInteraction ? context.user.id : context.author.id;

    const word = words[Math.floor(Math.random() * words.length)];
    let scrambled = word.split('').sort(() => Math.random() - 0.5).join('');
    while (scrambled === word) {
        scrambled = word.split('').sort(() => Math.random() - 0.5).join('');
    }

    await context.reply(ui.payload(ui.panel(gid, {
        emoji: '🔤',
        title: 'Word Scramble!',
        body: `Unscramble this word:\n\n# \`${scrambled.toUpperCase()}\``,
        note: 'Type your answer within 30 seconds!',
    })));

    const filter = m => m.author.id === authorId;

    try {
        const collected = await channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
        const guess = collected.first().content.toLowerCase().trim();

        if (guess === word) {
            await channel.send(ui.payload(ui.ok(gid, 'Correct!', `The word was **${word.toUpperCase()}**!`, `${ui.E.gift} Great job solving it!`)));
        } else {
            await channel.send(ui.payload(ui.err(gid, 'Wrong!', `You guessed: **${guess.toUpperCase()}**\nThe word was: **${word.toUpperCase()}**`, 'Better luck next time!')));
        }
    } catch {
        await channel.send(ui.payload(ui.timeout(gid, "Time's Up!", `The word was **${word.toUpperCase()}**!`)));
    }
}
