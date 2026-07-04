const { SlashCommandBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { generateUserStatsCard } = require('../../utils/userStatsCard');
const { getUserStats } = require('../../utils/activityTracker');

/** Build the {files, components} payload for a user's stats card. */
async function buildPayload(guild, user, member) {
    const stats = getUserStats(guild.id, user.id);

    const topMsgCh = stats.topMsgChannel ? guild.channels.cache.get(stats.topMsgChannel.id) : null;
    const topVcCh = stats.topVcChannel ? guild.channels.cache.get(stats.topVcChannel.id) : null;

    const buffer = await generateUserStatsCard({
        username: member?.displayName || user.username,
        handle: user.username,
        avatarURL: user.displayAvatarURL({ extension: 'png', size: 256 }),
        serverName: guild.name,
        createdTs: user.createdTimestamp,
        joinedTs: member?.joinedTimestamp || 0,
        msgRank: stats.msgRank,
        vcRank: stats.vcRank,
        msgTotalRanked: stats.msgTotalRanked,
        vcTotalRanked: stats.vcTotalRanked,
        msg1d: stats.msg1d, msg7d: stats.msg7d, msg14d: stats.msg14d,
        vc1d: stats.vc1d, vc7d: stats.vc7d, vc14d: stats.vc14d,
        topMsgChannelName: topMsgCh ? `#${topMsgCh.name}` : (stats.topMsgChannel ? 'Deleted channel' : null),
        topMsgChannelValue: stats.topMsgChannel?.value || 0,
        topVcChannelName: topVcCh ? topVcCh.name : (stats.topVcChannel ? 'Deleted channel' : null),
        topVcChannelValue: stats.topVcChannel?.value || 0,
        series: stats.series,
    });

    const attachment = new AttachmentBuilder(buffer, { name: 'userstats.png' });
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`userstats_refresh_${user.id}`)
            .setLabel('Refresh')
            .setEmoji('🔄')
            .setStyle(ButtonStyle.Secondary)
    );
    return { files: [attachment], components: [row] };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('userstats')
        .setDescription('View a member\'s server activity stats (Statbot-style card)')
        .addUserOption(o => o.setName('user').setDescription('Member to view stats for')),

    prefix: 'userstats',
    description: 'View a member\'s server activity stats',
    usage: 'userstats [@user]',
    category: 'utility',
    aliases: ['us'],

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply(require('../../utils/utilityUI').errReply('Not In A Server', 'This command can only be used in a server.', { ephemeral: true }));
        }
        await interaction.deferReply();
        const user = interaction.options.getUser('user') || interaction.user;
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        try {
            const payload = await buildPayload(interaction.guild, user, member);
            await interaction.editReply(payload);
        } catch (error) {
            console.error('userstats error:', error);
            await interaction.editReply(require('../../utils/utilityUI').errReply('Render Failed', 'Failed to render the stats card.'));
        }
    },

    async executePrefix(message, args) {
        const user = message.mentions.users.first() || message.author;
        const member = await message.guild.members.fetch(user.id).catch(() => null);
        try {
            const payload = await buildPayload(message.guild, user, member);
            await message.reply(payload);
        } catch (error) {
            console.error('userstats error:', error);
            await message.reply(require('../../utils/utilityUI').errReply('Render Failed', 'Failed to render the stats card.'));
        }
    },

    /** Refresh button handler (routed from index.js for `userstats_refresh_*`). */
    async handleInteraction(interaction) {
        if (!interaction.isButton() || !interaction.customId.startsWith('userstats_refresh_')) return false;
        const targetId = interaction.customId.replace('userstats_refresh_', '');
        try {
            await interaction.deferUpdate();
            const user = await interaction.client.users.fetch(targetId).catch(() => interaction.user);
            const member = await interaction.guild.members.fetch(targetId).catch(() => null);
            const payload = await buildPayload(interaction.guild, user, member);
            await interaction.editReply(payload);
        } catch (error) {
            console.error('userstats refresh error:', error);
        }
        return true;
    },
};
