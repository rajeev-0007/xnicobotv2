const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const jsonStore = require('../../utils/jsonStore');

function getAfkResult(guild) {
    if (!jsonStore.has('afk')) return null;

    let afkData;
    try { afkData = jsonStore.read('afk'); } catch { return null; }

    const guildAfk = Object.entries(afkData).filter(([id]) => guild.members.cache.has(id));
    if (guildAfk.length === 0) return null;

    const allLines = guildAfk.map(([id, data]) => {
        const member = guild.members.cache.get(id);
        // Stored field is `message` (see commands/utility/afk.js). Some
        // legacy entries used `reason`, so we fall back gracefully.
        const reason = data.message || data.reason || 'AFK';
        const since = data.timestamp ? `<t:${Math.floor(data.timestamp / 1000)}:R>` : 'Unknown';
        return `> 💤 ${member} - ${reason} (${since})`;
    });

    return paginate({
        header: `# 💤 AFK Users\n-# **${guildAfk.length}** user${guildAfk.length !== 1 ? 's' : ''} currently AFK`,
        lines: allLines,
        perPage: 12,
        accentColor: COLORS.WARNING
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('afklist')
        .setDescription('View all AFK users in the server'),

    prefix: 'afklist',
    description: 'View all AFK users in the server',
    usage: 'afklist',
    category: 'basic',

    async execute(interaction) {
        const result = getAfkResult(interaction.guild);
        if (!result) {
            const container = buildErrorResponse('No AFK Users', 'There are no AFK users in this server.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        const reply = await interaction.reply({ ...result, fetchReply: true });
        setupPaginationCollector(reply, result._pageData, interaction.user.id);
    },

    async executePrefix(message, args) {
        const result = getAfkResult(message.guild);
        if (!result) {
            const container = buildErrorResponse('No AFK Users', 'There are no AFK users in this server.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        const reply = await message.reply(result);
        setupPaginationCollector(reply, result._pageData, message.author.id);
    }
};
