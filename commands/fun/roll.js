const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('roll')
        .setDescription('Roll a dice')
        .addIntegerOption(opt =>
            opt.setName('sides')
                .setDescription('Number of sides (default: 6)')
                .setMinValue(2)
                .setMaxValue(100)
                .setRequired(false))
        .addIntegerOption(opt =>
            opt.setName('count')
                .setDescription('Number of dice to roll (default: 1)')
                .setMinValue(1)
                .setMaxValue(10)
                .setRequired(false)),

    prefix: 'roll',
    description: 'Roll a dice - customize sides and number of dice',
    usage: 'roll [sides] [count]',
    category: 'fun',
    aliases: ['rolldice', 'd'],

    async execute(interaction) {
        const sides = interaction.options.getInteger('sides') || 6;
        const count = interaction.options.getInteger('count') || 1;
        
        const rolls = [];
        for (let i = 0; i < count; i++) {
            rolls.push(Math.floor(Math.random() * sides) + 1);
        }
        
        const total = rolls.reduce((a, b) => a + b, 0);
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 🎲 Dice Roll\n\n` +
                    `**${count > 1 ? 'Results' : 'Result'}:** ${rolls.join(', ')}\n` +
                    `${count > 1 ? `**Total:** ${total}\n` : ''}` +
                    `**Range:** 1-${sides} ${count > 1 ? `(${count} dice)` : ''}`
                )
            );
        
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const sides = parseInt(args[0]) || 6;
        const count = parseInt(args[1]) || 1;
        
        if (sides < 2 || sides > 100) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Invalid Sides\n\nPlease provide a number between 2 and 100!`
                    )
                );
            return message.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
        
        const rolls = [];
        for (let i = 0; i < Math.min(count, 10); i++) {
            rolls.push(Math.floor(Math.random() * sides) + 1);
        }
        
        const total = rolls.reduce((a, b) => a + b, 0);
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 🎲 Dice Roll\n\n` +
                    `**${rolls.length > 1 ? 'Results' : 'Result'}:** ${rolls.join(', ')}\n` +
                    `${rolls.length > 1 ? `**Total:** ${total}\n` : ''}` +
                    `**Range:** 1-${sides} ${rolls.length > 1 ? `(${rolls.length} dice)` : ''}`
                )
            );
        
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
