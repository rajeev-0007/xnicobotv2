const { SlashCommandBuilder } = require('discord.js');
const ui = require('../../utils/gamesUI');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mathgame')
        .setDescription('Solve math problems as fast as you can!')
        .addStringOption(opt =>
            opt.setName('difficulty')
                .setDescription('Choose difficulty')
                .setRequired(false)
                .addChoices(
                    { name: 'Easy (Addition/Subtraction)', value: 'easy' },
                    { name: 'Medium (Multiplication)', value: 'medium' },
                    { name: 'Hard (Mixed Operations)', value: 'hard' }
                )),

    prefix: 'mathgame',
    description: 'Solve math problems as fast as you can!',
    usage: 'mathgame [easy/medium/hard]',
    category: 'games',
    aliases: ['quickmath', 'mathquiz'],

    async execute(interaction) {
        const difficulty = interaction.options.getString('difficulty') || 'medium';
        await playMath(interaction, true, difficulty);
    },

    async executePrefix(message, args) {
        const difficulty = ['easy', 'medium', 'hard'].includes(args[0]?.toLowerCase()) ? args[0].toLowerCase() : 'medium';
        await playMath(message, false, difficulty);
    }
};

function generateProblem(difficulty) {
    let a, b, op, answer;

    if (difficulty === 'easy') {
        a = Math.floor(Math.random() * 50) + 1;
        b = Math.floor(Math.random() * 50) + 1;
        op = Math.random() > 0.5 ? '+' : '-';
        if (op === '-' && b > a) [a, b] = [b, a];
        answer = op === '+' ? a + b : a - b;
    } else if (difficulty === 'medium') {
        a = Math.floor(Math.random() * 12) + 1;
        b = Math.floor(Math.random() * 12) + 1;
        op = '×';
        answer = a * b;
    } else {
        const ops = ['+', '-', '×', '÷'];
        op = ops[Math.floor(Math.random() * ops.length)];

        if (op === '÷') {
            b = Math.floor(Math.random() * 10) + 1;
            answer = Math.floor(Math.random() * 10) + 1;
            a = b * answer;
        } else if (op === '×') {
            a = Math.floor(Math.random() * 15) + 1;
            b = Math.floor(Math.random() * 15) + 1;
            answer = a * b;
        } else if (op === '-') {
            a = Math.floor(Math.random() * 100) + 1;
            b = Math.floor(Math.random() * a) + 1;
            answer = a - b;
        } else {
            a = Math.floor(Math.random() * 100) + 1;
            b = Math.floor(Math.random() * 100) + 1;
            answer = a + b;
        }
    }

    return { problem: `${a} ${op} ${b}`, answer };
}

async function playMath(context, isInteraction, difficulty) {
    const channel = context.channel;
    const gid = context.guild?.id;
    const authorId = isInteraction ? context.user.id : context.author.id;

    const rounds = 5;
    let score = 0;
    let totalTime = 0;

    await context.reply(ui.payload(ui.panel(gid, {
        emoji: '🧮',
        title: 'Math Challenge!',
        body: `**Difficulty:** ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}\n**Rounds:** ${rounds}\n\nSolve each problem within 10 seconds!`,
        note: 'Get ready...',
    })));

    await new Promise(resolve => setTimeout(resolve, 2000));

    for (let i = 0; i < rounds; i++) {
        const { problem, answer } = generateProblem(difficulty);
        const startTime = Date.now();

        await channel.send(ui.payload(ui.panel(gid, {
            emoji: '🧮',
            title: `Round ${i + 1}/${rounds}`,
            body: `**Solve:**\n\n\`\`\`${problem} = ?\`\`\``,
            note: '10 seconds!',
        })));

        const filter = m => m.author.id === authorId && !isNaN(parseInt(m.content));

        try {
            const collected = await channel.awaitMessages({ filter, max: 1, time: 10000, errors: ['time'] });
            const userAnswer = parseInt(collected.first().content);
            const timeTaken = (Date.now() - startTime) / 1000;

            if (userAnswer === answer) {
                score++;
                totalTime += timeTaken;
                await collected.first().react('<:Checkedbox:1521227734943269077>');
            } else {
                await collected.first().react('<:Cancel:1521227723916181644>');
                await channel.send(ui.payload(ui.err(gid, 'Wrong!', `The answer was **${answer}**.`)));
            }
        } catch {
            await channel.send(ui.payload(ui.timeout(gid, 'Too Slow!', `The answer was **${answer}**.`)));
        }

        if (i < rounds - 1) {
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }

    const avgTime = score > 0 ? (totalTime / score).toFixed(2) : 0;
    const percentage = Math.round((score / rounds) * 100);

    let rating, color;
    if (percentage === 100) { rating = '<:Award:1521228119640375336> PERFECT!'; color = 0xFFD700; }
    else if (percentage >= 80) { rating = '<:Star:1521227981685526568> Excellent!'; color = 0x00FF00; }
    else if (percentage >= 60) { rating = '<:Checkedbox:1521227734943269077> Good job!'; color = 0x00FF00; }
    else if (percentage >= 40) { rating = '<:Edit:1521227886634205298> Keep practicing!'; color = 0xFFA500; }
    else { rating = '<:Cancel:1521227723916181644> Try again!'; color = 0xFF0000; }

    await channel.send(ui.payload(ui.panel(gid, {
        emoji: null,
        title: rating,
        body: ui.rows([
            `**Score:** ${score}/${rounds} (${percentage}%)`,
            `**Avg Time:** ${avgTime}s per correct answer`,
            `**Difficulty:** ${difficulty.charAt(0).toUpperCase() + difficulty.slice(1)}`,
        ]),
        color,
    })));
}
