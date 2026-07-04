const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

module.exports = {
    prefix: 'binary',
    description: 'Encode or decode binary text',
    usage: 'binary <text> [encode/decode]',
    category: 'utility',
    aliases: ['bin'],

    async executePrefix(message, args) {
        if (args.length === 0) {
            const container = buildErrorResponse(
                'No Input Provided',
                'Please provide text to convert.',
                '**Examples:**\n> `binary Hello` - Encode to binary\n> `binary 01001000 01101001 decode` - Decode from binary'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        let mode = 'encode';
        let text = args.join(' ');

        const lastArg = args[args.length - 1].toLowerCase();
        if (['encode', 'decode'].includes(lastArg)) {
            mode = lastArg;
            text = args.slice(0, -1).join(' ');
        }

        if (!text) {
            const container = buildErrorResponse('No Text', 'Please provide text to convert.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            let result;

            if (mode === 'encode') {
                result = text.split('').map(char => char.charCodeAt(0).toString(2).padStart(8, '0')).join(' ');
            } else {
                const binaryArray = text.split(' ').filter(b => b);
                result = binaryArray.map(binary => {
                    const decimal = parseInt(binary, 2);
                    return isNaN(decimal) ? '' : String.fromCharCode(decimal);
                }).join('');

                if (!result) {
                    const container = buildErrorResponse(
                        'Invalid Binary',
                        'Invalid binary format! Use space-separated 8-bit binary codes.',
                        '**Example:** `01001000 01100101 01101100 01101100 01101111`'
                    );
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
            }

            if (result.length > 3900) {
                const container = buildErrorResponse('Too Long', 'Result is too long to display (max 3900 characters).');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            let content = `# 💻 Binary ${mode === 'encode' ? 'Encoder' : 'Decoder'}\n\n`;
            content += `### Input\n`;
            content += `\`\`\`${text.length > 200 ? text.substring(0, 200) + '...' : text}\`\`\`\n`;
            content += `### Output\n`;
            content += `\`\`\`${result.length > 200 ? result.substring(0, 200) + '...' : result}\`\`\``;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const container = buildErrorResponse('Error', 'Failed to convert.', error.message);
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
