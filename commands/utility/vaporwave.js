const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vaporwave')
        .setDescription('Convert text to vaporwave aesthetic')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('Text to convert')
                .setRequired(true)),

    prefix: 'vaporwave',
    description: 'Convert text to vaporwave aesthetic (fullwidth)',
    usage: 'vaporwave <text>',
    category: 'utility',
    aliases: ['vapor', 'aesthetic'],

    async execute(interaction) {
        const text = interaction.options.getString('text');
        await convertVaporwave(interaction, text, true);
    },

    async executePrefix(message, args) {
        if (args.length === 0) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Missing Text\n\nPlease provide text to convert!\n\n**Usage:** \`-vaporwave <text>\`\n**Example:** \`-vaporwave Hello World\``
                    )
                );
            return message.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }

        const text = args.join(' ');
        await convertVaporwave(message, text, false);
    }
};

async function convertVaporwave(context, text, isInteraction) {
    try {
        const result = text.split('').map(char => {
            const code = char.charCodeAt(0);
            if (code >= 33 && code <= 126) {
                return String.fromCharCode(code + 65248);
            }
            return char === ' ' ? '　' : char;
        }).join('');

        if (result.length > 2000) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Too Long\n\nResult is too long! (Max 2000 characters)`
                    )
                );
            if (isInteraction) {
                return context.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
            } else {
                return context.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
            }
        }

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# 🌊 Ｖａｐｏｒｗａｖｅ\n\n${result}`)
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
