const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('repeat')
        .setDescription('Repeat text multiple times')
        .addStringOption(option =>
            option.setName('text')
                .setDescription('Text to repeat')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('times')
                .setDescription('Number of times to repeat')
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(true)),

    async executePrefix(message, args) {
        if (args.length < 2) {
            return message.reply(require('../../utils/utilityUI').errReply('Invalid Usage', 'Usage: `repeat <times> <text>`', { hint: 'Example: `repeat 3 Hello`' }));
        }

        try {
            const times = parseInt(args[0]);

            if (isNaN(times) || times < 1 || times > 50) {
                return message.reply(require('../../utils/utilityUI').errReply('Invalid Number', 'Times must be a number between 1 and 50.'));
            }

            const text = args.slice(1).join(' ');
            const result = (text + '\n').repeat(times).trim();

            if (result.length > 2000) {
                return message.reply(require('../../utils/utilityUI').errReply('Too Long', 'Result is too long (max 2000 characters).'));
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Refresh:1521227946441052420> Repeated ${times} Times\n\n${result}`)
                );

            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            message.reply(require('../../utils/utilityUI').errReply('Error', error.message));
        }
    }
};