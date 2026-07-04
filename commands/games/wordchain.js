const { SlashCommandBuilder } = require('discord.js');
const ui = require('../../utils/gamesUI');

const activeGames = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wordchain')
        .setDescription('Start a word chain game - each word must start with the last letter of the previous word'),

    prefix: 'wordchain',
    description: 'Start a word chain game - each word must start with the last letter of the previous word',
    usage: 'wordchain',
    category: 'games',
    aliases: ['shiritori', 'chain'],

    async execute(interaction) {
        await playWordChain(interaction, true);
    },

    async executePrefix(message) {
        await playWordChain(message, false);
    }
};

async function playWordChain(context, isInteraction) {
    const channel = context.channel;
    const gid = context.guild?.id;
    const authorName = isInteraction ? context.user.username : context.author.username;

    if (activeGames.has(channel.id)) {
        return context.reply(ui.payload(ui.err(gid, 'Game In Progress', 'A word chain game is already active in this channel!')));
    }

    const startWords = ['apple', 'elephant', 'house', 'table', 'ocean', 'river', 'mountain', 'star', 'game', 'music'];
    const startWord = startWords[Math.floor(Math.random() * startWords.length)];
    const lastLetter = startWord.slice(-1).toLowerCase();

    activeGames.set(channel.id, {
        usedWords: new Set([startWord.toLowerCase()]),
        currentLetter: lastLetter,
        lastPlayer: null,
        score: 0,
        startTime: Date.now()
    });

    await context.reply(ui.payload(ui.panel(gid, {
        emoji: '<:Attach:1521228039135170722>',
        title: 'Word Chain Game!',
        body: `**Started by:** ${authorName}\n\n` +
            `**Rules:**\n${ui.rows([
                'Say a word that starts with the last letter of the previous word',
                'No repeated words',
                'English words only',
                'Type `stop` to end the game',
            ])}\n\n` +
            `**Starting word:** \`${startWord}\`\n\n` +
            `Next word must start with: **${lastLetter.toUpperCase()}**`,
        note: 'Game will end after 60 seconds of inactivity',
    })));

    const filter = m => !m.author.bot;
    const collector = channel.createMessageCollector({ filter, time: 60000, idle: 60000 });

    collector.on('collect', async (msg) => {
        const game = activeGames.get(channel.id);
        if (!game) return collector.stop();

        const word = msg.content.toLowerCase().trim();

        if (word === 'stop') {
            collector.stop('manual');
            return;
        }

        if (!/^[a-z]+$/.test(word)) return;

        if (word[0] !== game.currentLetter) {
            await msg.react('<:Cancel:1521227723916181644>');
            return;
        }

        if (game.usedWords.has(word)) {
            await msg.react('<:History:1521227863079256278>');
            await channel.send(ui.payload(ui.warn(gid, 'Already Used', `**${word}** was already used! Try another word starting with **${game.currentLetter.toUpperCase()}**.`)));
            return;
        }

        if (word.length < 2) return;

        game.usedWords.add(word);
        game.currentLetter = word.slice(-1);
        game.lastPlayer = msg.author.id;
        game.score++;

        await msg.react('<:Checkedbox:1521227734943269077>');

        collector.resetTimer();
    });

    collector.on('end', async (collected, reason) => {
        const game = activeGames.get(channel.id);
        activeGames.delete(channel.id);

        if (!game) return;

        const duration = Math.floor((Date.now() - game.startTime) / 1000);

        await channel.send(ui.payload(ui.panel(gid, {
            emoji: '🏁',
            title: 'Word Chain Ended!',
            body: ui.rows([
                `**Total Words:** ${game.score}`,
                `**Duration:** ${duration}s`,
                `**Last Word:** ${[...game.usedWords].pop()}`,
            ]),
            note: reason === 'manual' ? 'Game stopped by player!' : 'Time ran out!',
        })));
    });
}
