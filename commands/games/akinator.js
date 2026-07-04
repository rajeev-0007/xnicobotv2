const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const ui = require('../../utils/gamesUI');

const characters = [
    {
        name: 'Mario',
        traits: { real: false, human: true, male: true, game: true, movie: true, magic: false, villain: false, famous: true }
    },
    {
        name: 'Pikachu',
        traits: { real: false, human: false, male: false, game: true, movie: true, magic: true, villain: false, famous: true }
    },
    {
        name: 'Darth Vader',
        traits: { real: false, human: true, male: true, game: false, movie: true, magic: true, villain: true, famous: true }
    },
    {
        name: 'Sherlock Holmes',
        traits: { real: false, human: true, male: true, game: false, movie: true, magic: false, villain: false, famous: true }
    },
    {
        name: 'Elsa',
        traits: { real: false, human: true, male: false, game: false, movie: true, magic: true, villain: false, famous: true }
    },
    {
        name: 'Spider-Man',
        traits: { real: false, human: true, male: true, game: true, movie: true, magic: false, villain: false, famous: true }
    },
    {
        name: 'Goku',
        traits: { real: false, human: false, male: true, game: true, movie: true, magic: true, villain: false, famous: true }
    },
    {
        name: 'Batman',
        traits: { real: false, human: true, male: true, game: true, movie: true, magic: false, villain: false, famous: true }
    },
    {
        name: 'Joker',
        traits: { real: false, human: true, male: true, game: true, movie: true, magic: false, villain: true, famous: true }
    },
    {
        name: 'Harry Potter',
        traits: { real: false, human: true, male: true, game: true, movie: true, magic: true, villain: false, famous: true }
    },
    {
        name: 'Voldemort',
        traits: { real: false, human: true, male: true, game: true, movie: true, magic: true, villain: true, famous: true }
    },
    {
        name: 'Sonic',
        traits: { real: false, human: false, male: true, game: true, movie: true, magic: false, villain: false, famous: true }
    },
    {
        name: 'Link',
        traits: { real: false, human: true, male: true, game: true, movie: false, magic: true, villain: false, famous: true }
    },
    {
        name: 'Princess Peach',
        traits: { real: false, human: true, male: false, game: true, movie: true, magic: false, villain: false, famous: true }
    },
    {
        name: 'Thanos',
        traits: { real: false, human: false, male: true, game: true, movie: true, magic: true, villain: true, famous: true }
    }
];

const questionList = [
    { key: 'real', text: 'Is your character a real person?' },
    { key: 'human', text: 'Is your character human (or human-like)?' },
    { key: 'male', text: 'Is your character male?' },
    { key: 'game', text: 'Has your character appeared in a video game?' },
    { key: 'movie', text: 'Has your character appeared in a movie?' },
    { key: 'magic', text: 'Does your character have magical or supernatural powers?' },
    { key: 'villain', text: 'Is your character a villain?' }
];

const games = new Map();

setInterval(() => {
    const now = Date.now();
    for (const [id, game] of games) {
        if (now - game.createdAt > 10 * 60 * 1000) games.delete(id);
    }
}, 5 * 60 * 1000);

function buildQuestionContainer(game) {
    const q = questionList[game.questionIndex];
    let content = `# 🧞 Akinator\n\n`;
    content += `**Question ${game.questionIndex + 1}/${questionList.length}:**\n`;
    content += `${ui.E.bullet} ${q.text}\n\n`;
    content += `-# Answer yes or no! (${questionList.length - game.questionIndex} questions remaining)`;

    const container = new ContainerBuilder()
        .setAccentColor(0x6A0DAD)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`akinator_yes_${game.id}`).setLabel('Yes').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`akinator_no_${game.id}`).setLabel('No').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`akinator_idk_${game.id}`).setLabel("Don't Know").setStyle(ButtonStyle.Secondary)
            )
        );
    return ui.applyStyle(container, game.guildId);
}

function makeGuess(game) {
    let bestMatch = null;
    let bestScore = -1;

    for (const char of characters) {
        let score = 0;
        for (const [key, value] of Object.entries(game.answers)) {
            if (value === 'idk') continue;
            const charVal = char.traits[key];
            if ((value === 'yes' && charVal) || (value === 'no' && !charVal)) {
                score += 2;
            } else if (value !== 'idk') {
                score -= 1;
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = char;
        }
    }

    return bestMatch;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('akinator')
        .setDescription('Play Akinator - think of a character and I\'ll guess it!'),

    prefix: 'akinator',
    description: 'Play Akinator - think of a character and I\'ll try to guess it!',
    usage: 'akinator',
    category: 'games',
    aliases: ['aki', '20questions'],

    async execute(interaction) {
        await startAkinator(interaction, true);
    },

    async executePrefix(message) {
        await startAkinator(message, false);
    },

    async handleButton(interaction) {
        if (!interaction.isButton()) return false;
        const customId = interaction.customId;
        if (!customId.startsWith('akinator_')) return false;

        const parts = customId.split('_');
        const answer = parts[1];
        const gameId = parts.slice(2).join('_');
        const game = games.get(gameId);

        if (!game) {
            const container = ui.applyStyle(new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# 🧞 Akinator\n\n*This game has expired. Start a new one!*`)), interaction.guild?.id);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (interaction.user.id !== game.playerId) {
            await interaction.reply({ content: 'This is not your game!', flags: MessageFlags.Ephemeral });
            return true;
        }

        const q = questionList[game.questionIndex];
        game.answers[q.key] = answer;
        game.questionIndex++;

        if (game.questionIndex >= questionList.length) {
            const guess = makeGuess(game);
            games.delete(gameId);

            let content = `# 🧞 Akinator\n\n`;
            content += `After ${questionList.length} questions, I think your character is...\n\n`;
            content += `# 🎯 **${guess.name}**!\n\n`;
            content += `*Was I right? Play again to test me!*`;

            const container = ui.applyStyle(new ContainerBuilder()
                .setAccentColor(0x6A0DAD)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content)), game.guildId);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } else {
            const container = buildQuestionContainer(game);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        return true;
    }
};

async function startAkinator(context, isInteraction) {
    const authorId = isInteraction ? context.user.id : context.author.id;
    const gameId = `${authorId}_${Date.now()}`;

    const game = {
        id: gameId,
        playerId: authorId,
        guildId: context.guild?.id,
        questionIndex: 0,
        answers: {},
        createdAt: Date.now()
    };
    games.set(gameId, game);

    const container = buildQuestionContainer(game);

    await context.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}
