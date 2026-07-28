const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');

module.exports = {
    prefix: 'removeserverpremium',
    name: 'removeserverpremium',
    description: 'Remove premium from a server',
    usage: 'removeserverpremium <server_id>',
    category: 'owner',
    aliases: ['delserverpremium'],
    ownerOnly: true,
    
    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

      try {
        const guildId = args[0];

        if (!guildId) {
            let content = `# <:Sketch:1521228025365004471> Remove Server Premium\n\n`;
            content += `**Usage:** \`removeserverpremium <server_id>\`\n\n`;
            content += `### Description\n`;
            content += `> Removes premium access from a server.\n\n`;
            content += `**Examples:**\n`;
            content += `\`removeserverpremium 123456789012345678\` - Remove server premium\n`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const result = premiumManager.removeServerPremium(guildId);

        if (!result.success) {
            const container = buildErrorResponse('Error', result.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildSuccessResponse(
            'Server Premium Removed',
            `Successfully removed server premium from **${guildId}**.`,
            `**Server ID:** ${guildId}`
        );

        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      } catch (error) {
        console.error('[RemoveServerPremium] Error:', error);
        const container = buildErrorResponse('Error', 'An error occurred while removing server premium.');
        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }
    }
};
