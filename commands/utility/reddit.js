const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('reddit')
        .setDescription('Get a random post from a subreddit')
        .addStringOption(o => o.setName('subreddit').setDescription('Subreddit name (default: memes)')),

    async execute(interaction) {
        const subreddit = interaction.options.getString('subreddit') || 'memes';
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 📱 r/${subreddit}\n\n` +
                    `*Reddit feed feature coming soon!*\n\n` +
                    `Integrate with Reddit API for production.\n\n` +
                    `*Posts from the subreddit would appear here...*`
                )
            );

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const subreddit = args[0] || 'memes';

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# 📱 r/${subreddit}\n\n` +
                    `*Reddit feed feature coming soon!*\n\n` +
                    `Integrate with Reddit API for production.\n\n` +
                    `*Posts from the subreddit would appear here...*`
                )
            );

        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
