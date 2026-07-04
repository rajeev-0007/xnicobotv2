const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

function mockText(text) {
    return text
        .split('')
        .map((char, index) => {
            if (char === ' ') return char;
            return index % 2 === 0 ? char.toLowerCase() : char.toUpperCase();
        })
        .join('');
}

function buildMockContainer(text) {
    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# 🤡 Mocking Text\n\n${mockText(text)}`)
        );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('mock')
        .setDescription('Mock some text')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('The text to mock')
                .setRequired(true)),

    prefix: 'mock',
    description: 'Convert text to mocking spongebob case',
    usage: 'mock <text>',
    category: 'fun',
    aliases: ['spongebob', 'mocktext'],

    async execute(interaction) {
        const text = interaction.options.getString('text');
        const container = buildMockContainer(text);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const text = args.join(' ');

        if (!text) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Missing Text\n\nPlease provide text to mock!\n\n**Usage:** \`-mock <text>\`\n**Example:** \`-mock this is a test\``
                    )
                );
            return message.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildMockContainer(text);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
