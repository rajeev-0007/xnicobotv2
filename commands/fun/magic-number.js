const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('magicnumber')
        .setDescription('Get a random magic number')
        .addIntegerOption(opt =>
            opt.setName('max')
                .setDescription('Maximum number (default: 100)')
                .setMinValue(1)
                .setMaxValue(10000)
                .setRequired(false))
        .addUserOption(opt =>
            opt.setName('user')
                .setDescription('User to get magic number for')
                .setRequired(false)),

    prefix: 'magic-number',
    description: 'Get a random magic number - your lucky number for today!',
    usage: 'magic-number [max] [@user]',
    category: 'fun',
    aliases: ['magicnum', 'luckynumber', 'random-number', 'randomnumber', 'rng'],

    async execute(interaction) {
        const max = interaction.options.getInteger('max') || 100;
        const target = interaction.options.getUser('user') || interaction.user;
        
        const magicNumber = Math.floor(Math.random() * max) + 1;
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 🔮 Magic Number\n\n` +
                    `**${target.username}**'s magic number between 1 and ${max}:\n\n` +
                    `# <:Star:1521227981685526568> ${magicNumber} <:Star:1521227981685526568>\n\n` +
                    `*This is your lucky number for today!*`
                )
            );
        
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const target = message.mentions.users.first() || message.author;
        const max = parseInt(args.find(a => !a.startsWith('<'))) || 100;
        
        if (max < 1 || max > 10000) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Invalid Range\n\nPlease provide a number between 1 and 10000!`
                    )
                );
            return message.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
        
        const magicNumber = Math.floor(Math.random() * max) + 1;
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 🔮 Magic Number\n\n` +
                    `**${target.username}**'s magic number between 1 and ${max}:\n\n` +
                    `# <:Star:1521227981685526568> ${magicNumber} <:Star:1521227981685526568>\n\n` +
                    `*This is your lucky number for today!*`
                )
            );
        
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
