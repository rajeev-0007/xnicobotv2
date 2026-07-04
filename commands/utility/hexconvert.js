const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hexconvert')
        .setDescription('Convert text to/from hexadecimal')
        .addStringOption(o => o.setName('text').setDescription('Text to convert').setRequired(true))
        .addStringOption(o => o.setName('mode').setDescription('Conversion mode').addChoices({ name: 'Text to Hex', value: 'encode' }, { name: 'Hex to Text', value: 'decode' })),

    prefix: 'hexconvert',
    description: 'Convert text to/from hexadecimal',
    usage: 'hexconvert <text> [encode/decode]',
    category: 'utility',

    async execute(interaction) {
        const text = interaction.options.getString('text');
        const mode = interaction.options.getString('mode') || 'encode';
        await convertHex(interaction, text, mode, true);
    },

    async executePrefix(message, args) {
        if (args.length === 0) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Missing Text\n\nPlease provide text to convert!\n\n**Usage:** \`-hex <text> [encode/decode]\`\n**Example:** \`-hex Hello World\``
                    )
                );
            return message.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
        
        let mode = 'encode';
        let text = args.join(' ');
        
        const lastArg = args[args.length - 1].toLowerCase();
        if (['encode', 'decode'].includes(lastArg)) {
            mode = lastArg;
            text = args.slice(0, -1).join(' ');
        }
        
        if (!text) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Missing Text\n\nPlease provide text to convert!`
                    )
                );
            return message.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
        
        await convertHex(message, text, mode, false);
    }
};

async function convertHex(context, text, mode, isInteraction) {
    try {
        let result;
        
        if (mode === 'encode') {
            result = text.split('').map(char => char.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
        } else {
            const hexArray = text.replace(/[^0-9A-Fa-f\s]/g, '').split(/\s+/).filter(h => h);
            result = hexArray.map(hex => {
                const decimal = parseInt(hex, 16);
                return isNaN(decimal) ? '' : String.fromCharCode(decimal);
            }).join('');
            
            if (!result) {
                const errorContainer = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Cancel:1521227723916181644> Invalid Format\n\nInvalid hexadecimal format! Use space-separated hex codes.`
                        )
                    );
                if (isInteraction) {
                    return context.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
                } else {
                    return context.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
                }
            }
        }
        
        if (result.length > 3900) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Too Long\n\nResult is too long to display! (Max 3900 characters)`
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
                new TextDisplayBuilder().setContent(
                    `# 🔢 Hexadecimal ${mode === 'encode' ? 'Encoder' : 'Decoder'}\n\n` +
                    `**Input:**\n${text.length > 200 ? text.substring(0, 200) + '...' : text}\n\n` +
                    `**Output:**\n\`${result.length > 200 ? result.substring(0, 200) + '...' : result}\``
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
