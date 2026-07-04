const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

function buildBase64Container(action, input, output) {
    let content = `# <:Key:1521228000467878111> Base64 ${action.charAt(0).toUpperCase() + action.slice(1)}\n\n`;
    content += `### Input\n`;
    content += `\`\`\`${input.substring(0, 500)}${input.length > 500 ? '...' : ''}\`\`\`\n`;
    content += `### Output\n`;
    content += `\`\`\`${output.substring(0, 500)}${output.length > 500 ? '...' : ''}\`\`\``;

    return new ContainerBuilder()
        .setAccentColor(COLORS.INFO)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('base64')
        .setDescription('Encode or decode Base64 text')
        .addStringOption(o => o.setName('action').setDescription('Encode or decode').setRequired(true).addChoices({ name: 'Encode', value: 'encode' }, { name: 'Decode', value: 'decode' }))
        .addStringOption(o => o.setName('text').setDescription('Text to process').setRequired(true)),
    prefix: 'base64',
    description: 'Encode or decode Base64 text',
    usage: 'base64 <encode/decode> <text>',
    category: 'utility',
    aliases: ['b64'],

    async execute(interaction) {
        const action = interaction.options.getString('action');
        const text = interaction.options.getString('text');

        try {
            let result;
            if (action === 'encode') {
                result = Buffer.from(text).toString('base64');
            } else {
                result = Buffer.from(text, 'base64').toString('utf-8');
            }

            const container = buildBase64Container(action, text, result);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse('Invalid Input', 'Invalid Base64 input for decoding.');
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        const action = args[0]?.toLowerCase();
        const text = args.slice(1).join(' ');

        if (!action || !['encode', 'decode'].includes(action)) {
            const container = buildErrorResponse(
                'Invalid Action',
                'Please specify `encode` or `decode`.',
                '**Example:** `base64 encode Hello World`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!text) {
            const container = buildErrorResponse('No Text', `Please provide text to ${action}.`);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            let result;
            if (action === 'encode') {
                result = Buffer.from(text).toString('base64');
            } else {
                result = Buffer.from(text, 'base64').toString('utf-8');
            }

            const container = buildBase64Container(action, text, result);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse('Invalid Input', 'Invalid Base64 input for decoding.');
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
