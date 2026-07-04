const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

module.exports = {
    prefix: 'case-convert',
    description: 'Convert text to different cases',
    usage: 'case-convert <upper/lower/title/sentence> <text>',
    category: 'utility',
    aliases: ['case', 'textcase'],

    async executePrefix(message, args) {
        if (!args.length) {
            const container = buildErrorResponse(
                'No Arguments',
                'Please specify a case type and text.',
                '**Case Types:**\n> `upper` - UPPERCASE\n> `lower` - lowercase\n> `title` - Title Case\n> `sentence` - Sentence case\n\n**Example:** `case-convert upper hello world`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const caseType = args[0].toLowerCase();
        const text = args.slice(1).join(' ');

        if (!text) {
            const container = buildErrorResponse('No Text', 'Please provide text to convert.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        let result;
        let caseName;
        switch (caseType) {
            case 'upper':
                result = text.toUpperCase();
                caseName = 'UPPERCASE';
                break;
            case 'lower':
                result = text.toLowerCase();
                caseName = 'lowercase';
                break;
            case 'title':
                result = text.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
                caseName = 'Title Case';
                break;
            case 'sentence':
                result = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
                caseName = 'Sentence case';
                break;
            default:
                const container = buildErrorResponse(
                    'Invalid Case Type',
                    'Please use: `upper`, `lower`, `title`, or `sentence`'
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        let content = `# 🔡 Case Converter\n\n`;
        content += `**Type:** ${caseName}\n\n`;
        content += `### Original\n> ${text}\n\n`;
        content += `### Converted\n> ${result}`;

        const container = new ContainerBuilder()
            .setAccentColor(COLORS.INFO)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
