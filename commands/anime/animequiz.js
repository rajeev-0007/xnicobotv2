'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');
const economyManager = require('../../utils/economyManager');
const cooldowns = require('../../utils/animeCooldowns');

const QUIZ_REWARD = 50;

const QUIZ_TYPES = [
    {
        type: 'guess_anime',
        generate: () => {
            const char = animeManager.CHARACTERS[Math.floor(Math.random() * animeManager.CHARACTERS.length)];
            const wrongAnime = [...new Set(animeManager.CHARACTERS.map(c => c.anime))]
                .filter(a => a !== char.anime)
                .sort(() => Math.random() - 0.5)
                .slice(0, 3);
            const options = [char.anime, ...wrongAnime].sort(() => Math.random() - 0.5);
            return {
                question: `Which anime is **${char.name}** from?`,
                answer: char.anime,
                options,
            };
        },
    },
    {
        type: 'guess_character',
        generate: () => {
            const anime = animeManager.CHARACTERS[Math.floor(Math.random() * animeManager.CHARACTERS.length)].anime;
            const correctChars = animeManager.CHARACTERS.filter(c => c.anime === anime);
            const correct = correctChars[Math.floor(Math.random() * correctChars.length)];
            const wrongChars = animeManager.CHARACTERS.filter(c => c.anime !== anime)
                .sort(() => Math.random() - 0.5)
                .slice(0, 3);
            const options = [correct.name, ...wrongChars.map(c => c.name)].sort(() => Math.random() - 0.5);
            return {
                question: `Which character is from **${anime}**?`,
                answer: correct.name,
                options,
            };
        },
    },
    {
        type: 'guess_rarity',
        generate: () => {
            const char = animeManager.CHARACTERS[Math.floor(Math.random() * animeManager.CHARACTERS.length)];
            const rarity = animeManager.RARITIES[char.rarity];
            const options = Object.values(animeManager.RARITIES).map(r => r.name).sort(() => Math.random() - 0.5);
            return {
                question: `What rarity is **${char.name}** (${char.anime})?`,
                answer: rarity.name,
                options: options.slice(0, 4),
            };
        },
    },
];

async function handleQuiz(reply, context, user, guildId, isInteraction) {
    // Anti-abuse cooldown (starting a quiz counts).
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);
    const cd = cooldowns.check(playerData, 'animequiz');
    if (!cd.ok) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `## ${AE.clock} Slow down!\n> Try \`animequiz\` again in **${cooldowns.fmt(cd.remaining)}**.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    cooldowns.set(playerData, 'animequiz');
    animeManager.saveAnimeData();

    const quizType = QUIZ_TYPES[Math.floor(Math.random() * QUIZ_TYPES.length)];
    const quiz = quizType.generate();

    // Ensure answer is in options
    if (!quiz.options.includes(quiz.answer)) {
        quiz.options[0] = quiz.answer;
        quiz.options.sort(() => Math.random() - 0.5);
    }

    const optionLines = quiz.options.map((opt, i) => `**${i + 1}.** ${opt}`);

    const container = createContainer(0x3498DB);
    addTextDisplay(container, [
        `## ${AE.book} Anime Quiz`,
        '',
        `**${quiz.question}**`,
        '',
        optionLines.join('\n'),
        '',
        `-# Type your answer (1-${quiz.options.length}) within 15 seconds! Reward: ${AE.money} ${QUIZ_REWARD} coins`,
    ].join('\n'));

    await reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

    const channel = context.channel;
    const authorId = isInteraction ? context.user.id : context.author.id;

    const validAnswers = quiz.options.map((_, i) => String(i + 1));
    const filter = m => m.author.id === authorId && validAnswers.includes(m.content.trim());

    try {
        const collected = await channel.awaitMessages({ filter, max: 1, time: 15000, errors: ['time'] });
        const idx = parseInt(collected.first().content.trim()) - 1;
        const selected = quiz.options[idx];

        if (selected === quiz.answer) {
            // Reward coins
            const economy = economyManager.loadEconomy();
            const { userData } = economyManager.getUser(economy, user.id);
            userData.coins += QUIZ_REWARD;
            economyManager.saveEconomy(economy);

            const successContainer = createContainer(0x57F287);
            addTextDisplay(successContainer, [
                `## ${AE.check} Correct!`,
                '',
                `The answer is **${quiz.answer}**!`,
                `> ${AE.money} +${QUIZ_REWARD} coins rewarded`,
                '',
                `-# Use your coins to roll for characters with \`aroll\``,
            ].join('\n'));
            return channel.send({ components: [successContainer], flags: MessageFlags.IsComponentsV2 });
        } else {
            const failContainer = createContainer(0xED4245);
            addTextDisplay(failContainer, [
                `## ${AE.cancel} Wrong!`,
                '',
                `You said **${selected}**, but the answer was **${quiz.answer}**.`,
                '',
                `-# Better luck next time!`,
            ].join('\n'));
            return channel.send({ components: [failContainer], flags: MessageFlags.IsComponentsV2 });
        }
    } catch {
        const timeoutContainer = createContainer(0xFEE75C);
        addTextDisplay(timeoutContainer, [
            `## ${AE.sandwatch} Time's Up!`,
            '',
            `The correct answer was **${quiz.answer}**.`,
            '',
            `-# You have 15 seconds to answer next time!`,
        ].join('\n'));
        return channel.send({ components: [timeoutContainer], flags: MessageFlags.IsComponentsV2 });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('animequiz')
        .setDescription('Test your anime knowledge and earn coins!'),
    prefix: 'animequiz',
    description: 'Test your anime knowledge with a quiz and earn coins!',
    usage: 'animequiz',
    aliases: ['aquiz', 'aq'],
    category: 'anime',

    async execute(interaction) {
        await handleQuiz(interaction.reply.bind(interaction), interaction, interaction.user, interaction.guild?.id, true);
    },

    async executePrefix(message) {
        await handleQuiz(message.reply.bind(message), message, message.author, message.guild?.id, false);
    },
};
