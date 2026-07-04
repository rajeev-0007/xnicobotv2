const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');

module.exports = {
    prefix: 'premiumstats',
    name: 'premiumstats',
    description: 'View premium system statistics',
    usage: 'premiumstats',
    category: 'owner',
    aliases: ['pstats', 'premstats', 'premiumdashboard'],
    ownerOnly: true,
    
    async executePrefix(message) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const stats = premiumManager.getStats();

            let content = `# <:Sketch:1521228025365004471> Premium System Dashboard\n\n`;

            // Keys section
            content += `### <:Key:1521228000467878111> Keys\n`;
            content += `<:online:1521228065752088576> **Active:** ${stats.keys.active}\n`;
            content += `<:Cloudcheck:1521228125437165678> **Redeemed:** ${stats.keys.redeemed}\n`;
            content += `<:Alarm:1521227869047750689> **Expired:** ${stats.keys.expired}\n`;
            content += `<:Invoice:1521227903956811836> **Total Created:** ${stats.keys.total}\n\n`;

            // User premium section
            content += `### <:User:1521227714227343380> User Premium\n`;
            content += `<:Checkedbox:1521227734943269077> **Active Subscribers:** ${stats.users.active}\n`;
            content += `  ♾️ Permanent: ${stats.users.permanent} · <:Timer:1521227971590095070> Timed: ${stats.users.timed}\n`;
            if (stats.users.expired > 0) {
                content += `<:Cancel:1521227723916181644> **Expired:** ${stats.users.expired}\n`;
            }
            if (stats.users.soonestExpiry) {
                const ts = Math.floor(new Date(stats.users.soonestExpiry.expiresAt).getTime() / 1000);
                content += `<:Alarm:1521227869047750689> **Next Expiry:** <@${stats.users.soonestExpiry.userId}> — <t:${ts}:R>\n`;
            }
            content += `\n`;

            // Server premium section
            content += `### <:Home:1521228339736482056> Server Premium\n`;
            content += `<:Checkedbox:1521227734943269077> **Active Servers:** ${stats.servers.active}\n`;
            if (stats.servers.expired > 0) {
                content += `<:Cancel:1521227723916181644> **Expired:** ${stats.servers.expired}\n`;
            }
            if (stats.servers.soonestExpiry) {
                const ts = Math.floor(new Date(stats.servers.soonestExpiry.expiresAt).getTime() / 1000);
                content += `<:Alarm:1521227869047750689> **Next Expiry:** \`${stats.servers.soonestExpiry.guildId}\` — <t:${ts}:R>\n`;
            }
            content += `\n`;

            // Quick actions
            content += `### <:Caretright:1521227704953864202> Quick Actions\n`;
            content += `> \`createkey [days]\` — Create user key\n`;
            content += `> \`listkeys [filter]\` — Browse all keys\n`;
            content += `> \`deletekey <key>\` — Delete a key\n`;
            content += `> \`addpremium <@user|id> [days]\` — Direct grant\n`;
            content += `> \`transferpremium <@from> <@to>\` — Transfer`;

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[PremiumStats] Error:', error);
            const container = buildErrorResponse('Error', 'Failed to load premium statistics.');
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
