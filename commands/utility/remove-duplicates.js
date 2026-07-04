const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('remove-duplicates')
        .setDescription('Remove duplicate words from text'),

    async executePrefix(message, args) {
        if (!args.length) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Text', 'Please provide text to remove duplicates from.'));
        }

        const text = args.join(' ');
        const words = text.split(' ');
        const unique = [...new Set(words)];
        const removed = words.length - unique.length;

        message.reply(`**Original (${words.length} words):**\n${text}\n\n**Without Duplicates (${unique.length} words):**\n${unique.join(' ')}\n\n*Removed ${removed} duplicate word(s)*`);
    }
};
