const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');

module.exports = {
    prefix: 'addserverpremium',
    name: 'addserverpremium',
    description: 'Directly add premium to a server',
    usage: 'addserverpremium <server_id> [duration_in_days]',
    category: 'owner',
    aliases: ['giveserverpremium', 'grantserverpremium'],
    ownerOnly: true,
    
    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

      try {
        const guildId = args[0];

        if (!guildId) {
            let content = `# <:Sketch:1521228025365004471> Add Server Premium\n\n`;
            content += `**Usage:** \`addserverpremium <server_id> [duration_in_days]\`\n\n`;
            content += `### Description\n`;
            content += `> Directly grants premium access to a server.\n`;
            content += `> If no duration is specified, grants permanent premium.\n`;
            content += `> All users in this server will have access to premium commands.\n\n`;
            content += `**Examples:**\n`;
            content += `\`addserverpremium 123456789012345678\` - Grant permanent premium\n`;
            content += `\`addserverpremium 123456789012345678 30\` - Grant 30-day premium\n`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        let duration = null;
        const durationArg = args[1];
        if (durationArg) {
            const parsedDuration = parseInt(durationArg, 10);
            if (isNaN(parsedDuration) || parsedDuration <= 0) {
                const container = buildErrorResponse('Invalid Duration', 'Duration must be a positive number of days.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            duration = parsedDuration;
        }

        // Add server premium directly
        const result = premiumManager.addServerPremiumDirect(guildId, duration, message.author.id);

        if (!result.success) {
            const container = buildErrorResponse('Error', result.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        let detailsText = `**Server ID:** ${guildId}\n`;
        if (duration) {
            detailsText += `**Duration:** ${duration} days\n`;
            detailsText += `**Expires:** <t:${Math.floor(new Date(result.expiresAt).getTime() / 1000)}:F>`;
        } else {
            detailsText += `**Duration:** Permanent`;
        }

        const container = buildSuccessResponse(
            'Server Premium Added',
            `Successfully granted server premium to **${guildId}**.`,
            detailsText
        );

        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      } catch (error) {
        console.error('[AddServerPremium] Error:', error);
        const container = buildErrorResponse('Error', 'An error occurred while adding server premium.');
        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }
    }
};
