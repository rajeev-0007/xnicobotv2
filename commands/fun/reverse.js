const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

function buildReverse(text) {
    const reversed = text.split('').reverse().join('');
    let content = `# <:History:1521227863079256278> Reversed Text\n\n`;
    content += `**Original:** ${text}\n\n`;
    content += `**Reversed:** ${reversed}`;
    return new ContainerBuilder()
        .setAccentColor(COLORS.INFO)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reverse')
        .setDescription('Reverse text')
        .addStringOption(opt =>
            opt.setName('text')
                .setDescription('The text to reverse')
                .setRequired(true)),
    prefix: 'reverse',
    description: 'Reverse text',
    usage: 'reverse <text>',
    category: 'fun',
    aliases: ['rev', 'backwards'],

    async execute(interaction) {
        const text = interaction.options.getString('text');
        const container = buildReverse(text);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const text = args.join(' ');
        if (!text) {
            const container = buildErrorResponse(
                'No Text Provided',
                'Please provide text to reverse!',
                '**Example:** `reverse hello world`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildReverse(text);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
