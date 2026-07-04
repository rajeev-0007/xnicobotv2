const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const riddles = [
    { question: "What has keys but no locks, space but no room, and you can enter but can't go inside?", answer: "keyboard", accepts: ['keyboard', 'a keyboard'] },
    { question: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?", answer: "echo", accepts: ['echo', 'an echo'] },
    { question: "The more you take, the more you leave behind. What am I?", answer: "footsteps", accepts: ['footsteps', 'steps', 'footstep'] },
    { question: "What can travel around the world while staying in a corner?", answer: "stamp", accepts: ['stamp', 'a stamp', 'postage stamp'] },
    { question: "I'm tall when I'm young, and I'm short when I'm old. What am I?", answer: "candle", accepts: ['candle', 'a candle'] },
    { question: "What has hands but can't clap?", answer: "clock", accepts: ['clock', 'a clock', 'watch'] },
    { question: "What gets wetter the more it dries?", answer: "towel", accepts: ['towel', 'a towel'] },
    { question: "I have cities, but no houses. I have forests, but no trees. I have water, but no fish. What am I?", answer: "map", accepts: ['map', 'a map'] },
    { question: "What goes up but never comes down?", answer: "age", accepts: ['age', 'your age'] },
    { question: "I'm light as a feather, yet the strongest person can't hold me for much more than a minute. What am I?", answer: "breath", accepts: ['breath', 'your breath', 'air'] },
    { question: "What has a head and a tail but no body?", answer: "coin", accepts: ['coin', 'a coin'] },
    { question: "What runs all around a backyard, yet never moves?", answer: "fence", accepts: ['fence', 'a fence'] },
    { question: "What can you catch but never throw?", answer: "cold", accepts: ['cold', 'a cold'] },
    { question: "What has many teeth but can't bite?", answer: "comb", accepts: ['comb', 'a comb'] },
    { question: "What has one eye but can't see?", answer: "needle", accepts: ['needle', 'a needle'] }
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('riddle')
        .setDescription('Solve a random riddle - can you figure it out?'),

    prefix: 'riddle',
    description: 'Solve a random riddle - type your answer within 30 seconds!',
    usage: 'riddle',
    category: 'fun',
    aliases: ['puzzle', 'brainteaser'],

    async execute(interaction) {
        await showRiddle(interaction, true);
    },

    async executePrefix(message) {
        await showRiddle(message, false);
    }
};

async function showRiddle(context, isInteraction) {
    const channel = context.channel;
    const authorId = isInteraction ? context.user.id : context.author.id;
    const riddle = riddles[Math.floor(Math.random() * riddles.length)];
    
    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# 🤔 Riddle Time!\n\n` +
                `**${riddle.question}**\n\n` +
                `-# Type your answer within 30 seconds!`
            )
        );
    
    if (isInteraction) {
        await context.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } else {
        await context.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const filter = m => m.author.id === authorId;
    
    try {
        const collected = await channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] });
        const guess = collected.first().content.toLowerCase().trim();

        if (riddle.accepts.includes(guess)) {
            const winContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Correct!\n\n` +
                        `The answer was **${riddle.answer}**!\n\n` +
                        `<:Present:1521228115655917659> Brilliant thinking!`
                    )
                );
            await channel.send({ components: [winContainer], flags: MessageFlags.IsComponentsV2 });
        } else {
            const loseContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Not Quite!\n\n` +
                        `You guessed: **${guess}**\n` +
                        `The answer was: **${riddle.answer}**\n\n` +
                        `Better luck next time!`
                    )
                );
            await channel.send({ components: [loseContainer], flags: MessageFlags.IsComponentsV2 });
        }
    } catch {
        const timeoutContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Alarm:1521227869047750689> Time's Up!\n\n` +
                    `The answer was **${riddle.answer}**!\n\n` +
                    `*Try again with \`/riddle\`!*`
                )
            );
        await channel.send({ components: [timeoutContainer], flags: MessageFlags.IsComponentsV2 });
    }
}
