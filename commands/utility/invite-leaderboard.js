const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { getLeaderboard } = require('../../utils/inviteManager');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const { buildLoadingResponse, buildProgressResponse } = require('../../utils/responseBuilder');
const { getRankEmoji } = require('../../utils/rankEmojis');

async function buildLeaderboardLines(client, guildId, onProgress) {
    // Fetch full leaderboard (up to 100)
    const leaderboard = getLeaderboard(guildId, 100);
    const lines = [];

    if (typeof onProgress === 'function') {
        await onProgress({ current: 0, total: leaderboard.length, stage: 'Preparing leaderboard' });
    }

    for (let i = 0; i < leaderboard.length; i++) {
        const entry = leaderboard[i];
        const user = await client.users.fetch(entry.userId).catch(() => null);
        const username = user ? user.username : 'Unknown User';
        const rankBadge = getRankEmoji(i + 1);
        lines.push(`${rankBadge} **${username}** — ${entry.total} invites\n-# └ Regular: ${entry.regular} | Bonus: ${entry.bonus} | Left: ${entry.left}`);

        if (typeof onProgress === 'function') {
            await onProgress({ current: i + 1, total: leaderboard.length, stage: username });
        }
    }
    return lines;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite-leaderboard')
        .setDescription('View the top inviters in the server')
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Number of users to display (1-25)')
                .setMinValue(1)
                .setMaxValue(25)
                .setRequired(false)),
    
    async execute(interaction) {
        await interaction.deferReply();

        await interaction.editReply({
            components: [buildLoadingResponse('Invite Leaderboard', 'Collecting invite stats and user profiles...', 'This can take a few seconds on large servers.')],
            flags: MessageFlags.IsComponentsV2
        });

        const lines = await buildLeaderboardLines(interaction.client, interaction.guild.id, async ({ current, total, stage }) => {
            if (!total) return;
            await interaction.editReply({
                components: [buildProgressResponse('Invite Leaderboard', current, total, 'Collecting invite stats and user profiles...', stage)],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => null);
        });
        
        if (lines.length === 0) {
            return interaction.editReply(require('../../utils/utilityUI').errReply('No Data', 'No invite data available yet.'));
        }
        
        const result = paginate({
            header: `# <:Award:1521228119640375336> Invite Leaderboard\n-# ${lines.length} inviters in **${interaction.guild.name}**`,
            lines,
            perPage: 10,
            accentColor: 0xCAD7E6,
        });

        const reply = await interaction.editReply(result);
        setupPaginationCollector(reply, result._pageData, interaction.user.id);
    },

    async executePrefix(message, args) {
        const loading = await message.reply({
            components: [buildLoadingResponse('Invite Leaderboard', 'Collecting invite stats and user profiles...', 'This can take a few seconds on large servers.')],
            flags: MessageFlags.IsComponentsV2
        });

        const lines = await buildLeaderboardLines(message.client, message.guild.id, async ({ current, total, stage }) => {
            if (!total) return;
            await loading.edit({
                components: [buildProgressResponse('Invite Leaderboard', current, total, 'Collecting invite stats and user profiles...', stage)],
                flags: MessageFlags.IsComponentsV2
            }).catch(() => null);
        });
        
        if (lines.length === 0) {
            return loading.edit({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> No Data\n\nNo invite data available yet!'))], flags: MessageFlags.IsComponentsV2 });
        }
        
        const result = paginate({
            header: `# <:Award:1521228119640375336> Invite Leaderboard\n-# ${lines.length} inviters in **${message.guild.name}**`,
            lines,
            perPage: 10,
            accentColor: 0xCAD7E6,
        });

        const reply = await loading.edit(result);
        setupPaginationCollector(reply, result._pageData, message.author.id);
    }
};
