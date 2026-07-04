const { SlashCommandBuilder } = require('discord.js');
const ui = require('../../utils/gamesUI');

const responses = [
    { text: 'Yes, definitely!', type: 'positive' },
    { text: 'It is certain.', type: 'positive' },
    { text: 'Without a doubt.', type: 'positive' },
    { text: 'Yes - definitely.', type: 'positive' },
    { text: 'You may rely on it.', type: 'positive' },
    { text: 'As I see it, yes.', type: 'positive' },
    { text: 'Most likely.', type: 'positive' },
    { text: 'Outlook good.', type: 'positive' },
    { text: 'Signs point to yes.', type: 'positive' },
    { text: 'Reply hazy, try again.', type: 'neutral' },
    { text: 'Ask again later.', type: 'neutral' },
    { text: 'Better not tell you now.', type: 'neutral' },
    { text: 'Cannot predict now.', type: 'neutral' },
    { text: 'Concentrate and ask again.', type: 'neutral' },
    { text: "Don't count on it.", type: 'negative' },
    { text: 'My reply is no.', type: 'negative' },
    { text: 'My sources say no.', type: 'negative' },
    { text: 'Outlook not so good.', type: 'negative' },
    { text: 'Very doubtful.', type: 'negative' },
    { text: 'Absolutely not!', type: 'negative' }
];

const typeColors = { positive: 0x57F287, neutral: 0xFEE75C, negative: 0xED4245 };

function build(guildId, question, response) {
    return ui.panel(guildId, {
        emoji: '🎱',
        title: 'Magic 8-Ball',
        body: `**Question:** ${question}\n\n### 🔮 Answer\n${ui.E.bullet} ${response.text}`,
        color: typeColors[response.type],
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('8ball')
        .setDescription('Ask the magic 8-ball a question')
        .addStringOption(option =>
            option.setName('question')
                .setDescription('Your question for the 8-ball')
                .setRequired(true)),

    prefix: '8ball',
    description: 'Ask the magic 8-ball a question',
    usage: '8ball <question>',
    category: 'games',
    aliases: ['8b', 'ball', 'magic', 'ask'],

    async execute(interaction) {
        const question = interaction.options.getString('question');
        const response = responses[Math.floor(Math.random() * responses.length)];
        await interaction.reply(ui.payload(build(interaction.guild?.id, question, response)));
    },

    async executePrefix(message, args) {
        if (!args.length) {
            return message.reply(ui.payload(ui.err(message.guild?.id, 'Missing Question', 'Ask the 8-ball a question.', 'Example: `8ball Will I be lucky today?`')));
        }
        const question = args.join(' ');
        const response = responses[Math.floor(Math.random() * responses.length)];
        await message.reply(ui.payload(build(message.guild?.id, question, response)));
    }
};
