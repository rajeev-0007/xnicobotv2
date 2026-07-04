const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wordcount')
        .setDescription('Analyze text statistics')
        .addStringOption(o => o.setName('text').setDescription('Text to analyze').setRequired(true)),

    prefix: 'wordcount',
    description: 'Analyze text statistics (words, characters, lines)',
    usage: 'wordcount <text>',
    category: 'utility',
    aliases: ['wc', 'textstat', 'charcount'],

    async execute(interaction) {
        const text = interaction.options.getString('text');
        await analyzeText(interaction, text, true);
    },

    async executePrefix(message, args) {
        if (args.length === 0) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Missing Text\n\nPlease provide text to analyze!\n\n**Usage:** \`-wordcount <text>\`\n**Example:** \`-wordcount Hello World\``
                    )
                );
            return message.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
        
        const text = args.join(' ');
        await analyzeText(message, text, false);
    }
};

async function analyzeText(context, text, isInteraction) {
    try {
        const wordCount = text.trim().split(/\s+/).filter(w => w).length;
        const charCount = text.length;
        const charNoSpaces = text.replace(/\s/g, '').length;
        const lineCount = text.split('\n').length;
        const sentenceCount = text.split(/[.!?]+/).filter(s => s.trim()).length;
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Invoice:1521227903956811836> Text Statistics\n\n` +
                    `**Words:** ${wordCount}\n` +
                    `**Characters:** ${charCount}\n` +
                    `**Characters (no spaces):** ${charNoSpaces}\n` +
                    `**Lines:** ${lineCount}\n` +
                    `**Sentences:** ${sentenceCount}`
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
