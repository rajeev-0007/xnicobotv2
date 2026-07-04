const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('split-text')
        .setDescription('Split text by a delimiter'),

    async executePrefix(message, args) {
        if (args.length < 2) {
            return message.reply(require('../../utils/utilityUI').errReply('Invalid Usage', 'Usage: `split-text <delimiter> <text>`', { hint: 'Example: `split-text , apple,banana,cherry`' }));
        }

        const delimiter = args[0];
        const text = args.slice(1).join(' ');

        const parts = text.split(delimiter);

        let result = `**Split by "${delimiter}" (${parts.length} parts):**\n\n`;
        parts.forEach((part, index) => {
            result += `${index + 1}. ${part.trim()}\n`;
        });

        message.reply(result);
    }
};
