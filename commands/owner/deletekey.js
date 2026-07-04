const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');

module.exports = {
    prefix: 'deletekey',
    name: 'deletekey',
    description: 'Delete a premium key',
    usage: 'deletekey <key>',
    category: 'owner',
    aliases: ['delkey', 'removekey', 'revokekey'],
    ownerOnly: true,
    
    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

      try {
        if (!args[0]) {
            let content = `# <:Commentblock:1521227898101432331> Delete Premium Key\n\n`;
            content += `**Usage:** \`deletekey <key>\`\n\n`;
            content += `### Description\n`;
            content += `> Permanently deletes a premium key from the system.\n`;
            content += `> Works on unredeemed, redeemed, and expired keys.\n\n`;
            content += `**Example:**\n`;
            content += `\`deletekey ABCD-1234-EFGH-5678\`\n\n`;
            content += `> Use \`listkeys\` to see all existing keys first.`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const keyCode = args[0].toUpperCase();
        const result = premiumManager.deleteKey(keyCode);

        if (!result.success) {
            const container = buildErrorResponse('Key Not Found', `No key matching \`${keyCode}\` was found.`);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildSuccessResponse(
            'Key Deleted',
            `Successfully deleted key \`${keyCode}\`.`,
            'The key can no longer be redeemed or referenced.'
        );

        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      } catch (error) {
        console.error('[DeleteKey] Error:', error);
        const container = buildErrorResponse('Error', 'An error occurred while deleting the key.');
        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }
    }
};
