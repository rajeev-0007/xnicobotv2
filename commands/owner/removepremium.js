const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');
const badgeManager = require('../../utils/badgeManager');
const { resolveUser } = require('../../utils/resolveUser');

module.exports = {
    prefix: 'removepremium',
    name: 'removepremium',
    description: 'Remove premium from a user',
    usage: 'removepremium <@user|user_id>',
    category: 'owner',
    aliases: ['revokepremium', 'takepremium'],
    ownerOnly: true,
    
    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

      try {
        // Support both @mention and raw user ID
        let user = await resolveUser(message, args);
        if (!user && args[0]) {
            const userId = args[0].replace(/[<@!>]/g, '');
            if (/^\d{17,20}$/.test(userId)) {
                try {
                    user = await message.client.users.fetch(userId);
                } catch {
                    const container = buildErrorResponse('User Not Found', `Could not find a user with ID \`${userId}\`.`);
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
            }
        }

        if (!user) {
            let content = `# <:Commentblock:1521227898101432331> Remove Premium\n\n`;
            content += `**Usage:** \`removepremium <@user|user_id>\`\n\n`;
            content += `### Description\n`;
            content += `> Removes premium access from a user.\n`;
            content += `> Supports both @mentions and raw user IDs.\n\n`;
            content += `**Examples:**\n`;
            content += `\`removepremium @User\`\n`;
            content += `\`removepremium 123456789012345678\``;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const result = premiumManager.removePremium(user.id);

        if (!result.success) {
            const container = buildErrorResponse('Error', result.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildSuccessResponse(
            'Premium Removed',
            `Successfully removed premium from **${user.username}**.`,
            `**User ID:** ${user.id}`
        );

        // Revoke premium badge (best-effort, non-blocking)
        await badgeManager.removeBadgeFromUser(user.id, 'premium').catch(() => {});

        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      } catch (error) {
        console.error('[RemovePremium] Error:', error);
        const container = buildErrorResponse('Error', 'An error occurred while removing premium.');
        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }
    }
};
