const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { getInviteAnalytics } = require('../../utils/inviteManager');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('invite-analytics')
        .setDescription('View detailed invite analytics for the server'),
    
    async execute(interaction) {
        const analytics = getInviteAnalytics(interaction.guild.id);
        
        let analyticsText = '# <:Lightning:1521227915537285150> Invite Analytics\n\n';
        analyticsText += `**Overall Statistics:**\n`;
        analyticsText += `• Total Invites: ${analytics.totalInvites}\n`;
        analyticsText += `• Members Left: ${analytics.totalLeft}\n`;
        analyticsText += `• Active Members: ${analytics.totalMembers}\n\n`;
        
        if (analytics.topInviters.length > 0) {
            analyticsText += `**Top 5 Inviters:**\n`;
            for (let i = 0; i < Math.min(5, analytics.topInviters.length); i++) {
                const inviter = analytics.topInviters[i];
                const user = await interaction.client.users.fetch(inviter.userId).catch(() => null);
                const username = user ? user.username : 'Unknown User';
                analyticsText += `${i + 1}. ${username} - ${inviter.total} invites\n`;
            }
            analyticsText += '\n';
        }
        
        if (analytics.topCodes.length > 0) {
            analyticsText += `**Most Used Invite Codes:**\n`;
            for (let i = 0; i < Math.min(5, analytics.topCodes.length); i++) {
                const [code, uses] = analytics.topCodes[i];
                analyticsText += `${i + 1}. \`${code}\` - ${uses} uses\n`;
            }
        }
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(analyticsText)
            );
        
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message) {
        const analytics = getInviteAnalytics(message.guild.id);
        
        let analyticsText = '# <:Lightning:1521227915537285150> Invite Analytics\n\n';
        analyticsText += `**Overall Statistics:**\n`;
        analyticsText += `• Total Invites: ${analytics.totalInvites}\n`;
        analyticsText += `• Members Left: ${analytics.totalLeft}\n`;
        analyticsText += `• Active Members: ${analytics.totalMembers}\n\n`;
        
        if (analytics.topInviters.length > 0) {
            analyticsText += `**Top 5 Inviters:**\n`;
            for (let i = 0; i < Math.min(5, analytics.topInviters.length); i++) {
                const inviter = analytics.topInviters[i];
                const user = await message.client.users.fetch(inviter.userId).catch(() => null);
                const username = user ? user.username : 'Unknown User';
                analyticsText += `${i + 1}. ${username} - ${inviter.total} invites\n`;
            }
            analyticsText += '\n';
        }
        
        if (analytics.topCodes.length > 0) {
            analyticsText += `**Most Used Invite Codes:**\n`;
            for (let i = 0; i < Math.min(5, analytics.topCodes.length); i++) {
                const [code, uses] = analytics.topCodes[i];
                analyticsText += `${i + 1}. \`${code}\` - ${uses} uses\n`;
            }
        }
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(analyticsText)
            );
        
        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
