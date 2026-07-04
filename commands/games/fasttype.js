'use strict';

/**
 * fasttype.js — prefix-only.
 * 30-second typing speed challenge.
 */

const ui = require('../../utils/gamesUI');

const PHRASES = [
    'The quick brown fox jumps over the lazy dog',
    'Pack my box with five dozen liquor jugs',
    'How vexingly quick daft zebras jump',
    'Sphinx of black quartz judge my vow',
    'Two driven jocks help fax my big quiz',
    'The five boxing wizards jump quickly',
    'Jackdaws love my big sphinx of quartz',
    'Discord is the best chat platform',
    'I love playing games with friends',
    'Programming is a creative art',
    'Never gonna give you up',
    'May the force be with you',
    'Winter is coming soon',
    'To be or not to be',
    'All your base are belong to us',
    'Keep calm and carry on',
    'Just do it right now',
    'Live long and prosper'
];

const WORDS = [
    'algorithm', 'butterfly', 'chocolate', 'developer', 'elephant',
    'fantastic', 'gorgeous', 'hamburger', 'incredible', 'javascript',
    'keyboard', 'lightning', 'microphone', 'notebook', 'orchestra',
    'pineapple', 'quantum', 'raspberry', 'strawberry', 'telescope',
    'umbrella', 'volleyball', 'watermelon', 'xylophone', 'yesterday'
];

function pickPhrase(difficulty) {
    if (difficulty === 'easy') return WORDS[Math.floor(Math.random() * WORDS.length)];
    if (difficulty === 'hard') {
        const a = PHRASES[Math.floor(Math.random() * PHRASES.length)];
        const b = PHRASES[Math.floor(Math.random() * PHRASES.length)].split(' ').slice(0, 3).join(' ');
        return `${a} ${b}`;
    }
    return PHRASES[Math.floor(Math.random() * PHRASES.length)];
}

async function playFastType(message, difficulty) {
    const channel  = message.channel;
    const gid      = message.guild?.id;
    const authorId = message.author.id;
    const text     = pickPhrase(difficulty);

    await message.reply(ui.payload(ui.panel(gid, {
        emoji: '⌨️',
        title: 'Fast Type Challenge!',
        body: `**Difficulty:** ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}\n\n` +
            `Type this as fast as you can:\n\n\`\`\`${text}\`\`\``,
        note: 'You have 30 seconds!',
    })));

    const startTime = Date.now();

    try {
        const collected = await channel.awaitMessages({
            filter: m => m.author.id === authorId,
            max: 1,
            time: 30_000,
            errors: ['time']
        });
        const response   = collected.first().content;
        const timeTaken  = (Date.now() - startTime) / 1000;
        const correctChars = [...response].filter((c, i) => c === text[i]).length;
        const accuracy   = Math.round((correctChars / text.length) * 100);
        const wpm        = Math.round((text.split(' ').length / timeTaken) * 60);
        const cpm        = Math.round((text.length / timeTaken) * 60);

        let rating, color;
        if (response.toLowerCase() === text.toLowerCase() && accuracy >= 95) {
            if (wpm >= 80)      { rating = '<:Award:1521228119640375336> LEGENDARY!';     color = 0xFFD700; }
            else if (wpm >= 60) { rating = '<:Star:1521227981685526568> Excellent!';      color = 0x00FF00; }
            else if (wpm >= 40) { rating = '<:Checkedbox:1521227734943269077> Good job!'; color = 0x00FF00; }
            else                { rating = '👍 Nice try!';                                color = 0x00FF00; }
        } else {
            rating = accuracy >= 80 ? '<:Edit:1521227886634205298> Almost there!' : '<:Cancel:1521227723916181644> Try again!';
            color  = accuracy >= 80 ? 0xFFA500 : 0xFF0000;
        }

        const body =
            `${ui.rows([
                `**Time:** ${timeTaken.toFixed(2)}s`,
                `**Accuracy:** ${accuracy}%`,
                `**WPM:** ${wpm}`,
                `**CPM:** ${cpm}`,
            ])}\n\n` +
            (accuracy < 100
                ? `**Your text:**\n\`${response.substring(0, 100)}${response.length > 100 ? '...' : ''}\``
                : `**Perfect match!** ${ui.E.gift}`);

        await channel.send(ui.payload(ui.panel(gid, { emoji: null, title: rating, body, color })));
    } catch {
        await channel.send(ui.payload(ui.timeout(gid, "Time's Up!", "You didn't finish in time. Try again!")));
    }
}

module.exports = {
    name: 'fasttype',
    prefix: 'fasttype',
    aliases: ['type', 'typingtest', 'typerace', 'typinggame'],
    description: 'Test your typing speed - type the phrase as fast as you can!',
    usage: 'fasttype [easy|medium|hard]',
    category: 'games',

    async executePrefix(message, args) {
        const difficulty = ['easy', 'medium', 'hard'].includes(args[0]?.toLowerCase()) ? args[0].toLowerCase() : 'medium';
        await playFastType(message, difficulty);
    }
};
