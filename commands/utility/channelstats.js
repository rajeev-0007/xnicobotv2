const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');

async function getChannelStats(channel) {
    const messages = await channel.messages.fetch({ limit: 100 });
    const userMessages = {};

    messages.forEach(msg => {
        if (!msg.author.bot) {
            userMessages[msg.author.username] = (userMessages[msg.author.username] || 0) + 1;
        }
    });

    const topUsers = Object.entries(userMessages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map((entry, i) => `${i + 1}. **${entry[0]}** - ${entry[1]} messages`);

    return { messages, topUsers };
}

function buildChannelStatsContainer(channel, stats) {
    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Bookopen:1521227911137595605> Channel Statistics: ${channel.name}`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `**Total Messages (Last 100):** ${stats.messages.size}\n` +
                `**Channel Type:** ${channel.type}\n\n` +
                `**Top Users:**\n${stats.topUsers.join('\n') || 'No data'}`
            )
        );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('channelstats')
        .setDescription('View statistics for a channel')
        .addChannelOption(o => o.setName('channel').setDescription('Channel to view stats for')),

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        
        try {
            const stats = await getChannelStats(channel);
            const container = buildChannelStatsContainer(channel, stats);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await interaction.reply(require('../../utils/utilityUI').errReply('Failed', 'Failed to fetch channel statistics.', { ephemeral: true }));
        }
    },

    async executePrefix(message, args) {
        const channel = message.mentions.channels.first() || message.channel;

        try {
            const stats = await getChannelStats(channel);
            const container = buildChannelStatsContainer(channel, stats);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply(require('../../utils/utilityUI').errReply('Failed', 'Failed to fetch channel statistics.'));
        }
    }
};
