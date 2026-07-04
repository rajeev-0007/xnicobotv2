const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');

const adviceList = [
    "Don't take life too seriously. You'll never get out of it alive.",
    "Always remember: You're unique, just like everyone else.",
    "The early bird gets the worm, but the second mouse gets the cheese.",
    "If at first you don't succeed, then skydiving definitely isn't for you.",
    "Be yourself; everyone else is already taken.",
    "A day without sunshine is like, you know, night.",
    "The best time to plant a tree was 20 years ago. The second best time is now.",
    "Don't worry about the world ending today. It's already tomorrow in Australia.",
    "Better to remain silent and be thought a fool than to speak and remove all doubt.",
    "Dance like nobody's watching, because they're not. They're checking their phones.",
    "When nothing goes right, go left.",
    "Always borrow money from a pessimist. They won't expect it back.",
    "Common sense is like deodorant. The people who need it most never use it.",
    "The road to success is always under construction.",
    "Don't let your ice cream melt while you're counting someone else's sprinkles.",
    "Life is short. Smile while you still have teeth.",
    "Never test the depth of the water with both feet.",
    "You can't make everyone happy. You're not pizza.",
    "If you can't be kind, at least be vague.",
    "Always dress like you're going to see your worst enemy."
];

function getAdviceContainer() {
    const randomAdvice = adviceList[Math.floor(Math.random() * adviceList.length)];
    
    let content = `# <:Lightbulbalt:1521227880703463675> Random Advice\n\n`;
    content += `> *"${randomAdvice}"*\n\n`;
    content += `-# Take this advice with a grain of salt!`;

    return new ContainerBuilder()
        .setAccentColor(COLORS.WARNING)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('advice')
        .setDescription('Get some random advice'),
    prefix: 'advice',
    description: 'Get random (sometimes questionable) advice',
    usage: 'advice',
    category: 'fun',
    aliases: ['wisdom', 'tip'],

    async execute(interaction) {
        const container = getAdviceContainer();
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message) {
        const container = getAdviceContainer();
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
