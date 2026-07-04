const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');

async function getBotLines(guild) {
    const members = await guild.members.fetch();
    const bots = members.filter(m => m.user.bot);
    if (bots.size === 0) return null;
    return [...bots.sort((a, b) => b.joinedTimestamp - a.joinedTimestamp).values()]
        .map((b, i) => `> \`${i + 1}.\` <:bots:1521227848101396610> ${b.user} — \`${b.user.id}\``);
}

module.exports = {
    prefix: 'bots',
    description: 'List all bots in the server',
    usage: 'bots',
    category: 'basic',
    aliases: ['botlist'],

    data: new SlashCommandBuilder()
        .setName('bots')
        .setDescription('List all bots in the server'),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
        try {
            const lines = await getBotLines(interaction.guild);
            if (!lines) {
                const err = buildErrorResponse('No Bots Found', 'There are no bots in this server.');
                return interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
            const result = paginate({ header: `# <:bots:1521227848101396610> Server Bots\n-# **${lines.length}** bots in this server`, lines, perPage: 15, accentColor: COLORS.INFO });
            const reply = await interaction.editReply(result);
            setupPaginationCollector(reply, result._pageData, interaction.user.id);
        } catch (error) {
            const err = buildErrorResponse('Error', 'Failed to fetch bot list.', error.message);
            await interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message) {
        try {
            const lines = await getBotLines(message.guild);
            if (!lines) {
                const err = buildErrorResponse('No Bots Found', 'There are no bots in this server.');
                return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
            const result = paginate({ header: `# <:bots:1521227848101396610> Server Bots\n-# **${lines.length}** bots in this server`, lines, perPage: 15, accentColor: COLORS.INFO });
            const reply = await message.reply(result);
            setupPaginationCollector(reply, result._pageData, message.author.id);
        } catch (error) {
            const err = buildErrorResponse('Error', 'Failed to fetch bot list.', error.message);
            await message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
