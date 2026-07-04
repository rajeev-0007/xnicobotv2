const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const quotes = [
    { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
    { text: "Innovation distinguishes between a leader and a follower.", author: "Steve Jobs" },
    { text: "Life is what happens when you're busy making other plans.", author: "John Lennon" },
    { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
    { text: "It is during our darkest moments that we must focus to see the light.", author: "Aristotle" },
    { text: "The only impossible journey is the one you never begin.", author: "Tony Robbins" },
    { text: "In the end, we only regret the chances we didn't take.", author: "Lewis Carroll" },
    { text: "Success is not final, failure is not fatal: it is the courage to continue that counts.", author: "Winston Churchill" },
    { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
    { text: "The way to get started is to quit talking and begin doing.", author: "Walt Disney" },
    { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
    { text: "The future depends on what you do today.", author: "Mahatma Gandhi" },
    { text: "Everything you've ever wanted is on the other side of fear.", author: "George Addair" },
    { text: "Believe in yourself. You are braver than you think.", author: "Roy T. Bennett" },
    { text: "I never dreamed about success, I worked for it.", author: "Estée Lauder" },
    { text: "Do one thing every day that scares you.", author: "Eleanor Roosevelt" },
    { text: "It's not whether you get knocked down, it's whether you get up.", author: "Vince Lombardi" },
    { text: "Failure is the condiment that gives success its flavor.", author: "Truman Capote" },
    { text: "Hard times don't create heroes. It is during the hard times when the 'hero' within us is revealed.", author: "Bob Riley" },
    { text: "What lies behind us and what lies before us are tiny matters compared to what lies within us.", author: "Ralph Waldo Emerson" }
];

function getQuoteContainer() {
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# 📜 Inspirational Quote\n\n*"${randomQuote.text}"*\n\n— **${randomQuote.author}**`
            )
        );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quote')
        .setDescription('Get an inspirational quote'),

    async execute(interaction) {
        const container = getQuoteContainer();
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message) {
        const container = getQuoteContainer();
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
