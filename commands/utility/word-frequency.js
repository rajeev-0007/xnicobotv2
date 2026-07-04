const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('word-frequency')
        .setDescription('Count word frequency in text'),

    async executePrefix(message, args) {
        if (!args.length) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Text', 'Please provide text to analyze.'));
        }

        const text = args.join(' ').toLowerCase();
        const words = text.split(/\s+/);
        const frequency = {};

        words.forEach(word => {
            const cleaned = word.replace(/[.,!?;:]/g, '');
            if (cleaned.length > 0) {
                frequency[cleaned] = (frequency[cleaned] || 0) + 1;
            }
        });

        const sorted = Object.entries(frequency)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        let result = '**<:Invoice:1521227903956811836> Top 10 Most Frequent Words:**\n\n';
        sorted.forEach(([word, count], index) => {
            result += `${index + 1}. **${word}**: ${count}x\n`;
        });

        message.reply(result);
    }
};
