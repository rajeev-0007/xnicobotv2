const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

const leetMap = {
    'a': '4', 'e': '3', 'i': '1', 'o': '0', 's': '5', 't': '7', 'l': '1',
    'A': '4', 'E': '3', 'I': '1', 'O': '0', 'S': '5', 'T': '7', 'L': '1'
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leetspeak')
        .setDescription('Convert text to leetspeak (1337)')
        .addStringOption(o => o.setName('text').setDescription('Text to convert').setRequired(true)),

    prefix: 'leetspeak',
    description: 'Convert text to leetspeak (1337)',
    usage: 'leetspeak <text>',
    category: 'utility',
    aliases: ['leet', '1337'],

    async execute(interaction) {
        const text = interaction.options.getString('text');
        const result = text.split('').map(char => leetMap[char] || char).join('');

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 🎮 Leetspeak Converter\n\n` +
                    `**Original:**\n${text}\n\n` +
                    `**1337:**\n${result}`
                )
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        if (args.length === 0) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Missing Text\n\nPlease provide text to convert!\n\n**Usage:** \`-leetspeak <text>\`\n**Example:** \`-leetspeak Hello World\``
                    )
                );
            return message.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }

        const text = args.join(' ');
        const result = text.split('').map(char => leetMap[char] || char).join('');

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 🎮 Leetspeak Converter\n\n` +
                    `**Original:**\n${text}\n\n` +
                    `**1337:**\n${result}`
                )
            );

        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
