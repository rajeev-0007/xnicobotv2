const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('randomcase')
        .setDescription('Randomize the case of text')
        .addStringOption(o => o.setName('text').setDescription('Text to randomize').setRequired(true)),

    prefix: 'randomcase',
    description: 'Randomize text case (LiKe ThIs)',
    usage: 'randomcase <text>',
    category: 'utility',
    aliases: ['randcase'],

    async execute(interaction) {
        const text = interaction.options.getString('text');
        await randomizeCase(interaction, text, true);
    },

    async executePrefix(message, args) {
        if (args.length === 0) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Missing Text\n\nPlease provide text to randomize!\n\n**Usage:** \`-randomcase <text>\`\n**Example:** \`-randomcase Hello World\``
                    )
                );
            return message.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }

        const text = args.join(' ');
        await randomizeCase(message, text, false);
    }
};

async function randomizeCase(context, text, isInteraction) {
    try {
        const result = text.split('').map(char => {
            return Math.random() > 0.5 ? char.toUpperCase() : char.toLowerCase();
        }).join('');

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 🎲 Random Case\n\n` +
                    `**Original:**\n${text}\n\n` +
                    `**Random:**\n${result}`
                )
            );

        if (isInteraction) {
            await context.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } else {
            await context.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    } catch (error) {
        const errorContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${error.message}`)
            );
        if (isInteraction) {
            await context.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        } else {
            await context.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
    }
}
