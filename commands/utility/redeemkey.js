const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');
const badgeManager = require('../../utils/badgeManager');

module.exports = {
    prefix: 'redeemkey',
    name: 'redeemkey',
    description: 'Redeem a premium key',
    usage: 'redeemkey <key>',
    category: 'utility',
    aliases: ['redeem', 'activatekey'],
    
    async executePrefix(message, args) {
      try {
        // Delete the user's message immediately to prevent key exposure in chat
        if (args[0] && message.deletable) message.delete().catch(() => {});

        if (!args[0]) {
            let content = `# <:Key:1521228000467878111> Redeem Premium Key\n\n`;
            content += `**Usage:** \`redeemkey <key>\`\n\n`;
            content += `### Description\n`;
            content += `> Redeem a premium key to activate premium features.\n\n`;
            content += `**Example:**\n`;
            content += `\`redeemkey ABCD-1234-EFGH-5678\`\n\n`;
            content += `> Keys are provided by the bot owner and can grant temporary or permanent premium access.`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const keyCode = args[0].toUpperCase();
        
        // Force a sync with the database so dashboard-generated keys are visible immediately
        const jsonStore = require('../../utils/jsonStore');
        if (typeof jsonStore.smartRefresh === 'function') await jsonStore.smartRefresh();
        else if (typeof jsonStore.refresh === 'function') await jsonStore.refresh();

        const result = premiumManager.redeemKey(message.author.id, keyCode);

        if (!result.success) {
            const container = buildErrorResponse('Redemption Failed', result.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        let content = `# <:Present:1521228115655917659> Premium Activated!\n\n`;
        content += `<:Checkedbox:1521227734943269077> Successfully redeemed key: \`${keyCode}\`\n`;
        content += `<:User:1521227714227343380> **User:** ${message.author.username}\n`;
        
        if (result.expiresAt) {
            content += `<:Timer:1521227971590095070> **Duration:** ${result.duration} days\n`;
            content += `<:Bookopen:1521227911137595605> **Expires:** <t:${Math.floor(new Date(result.expiresAt).getTime() / 1000)}:F>\n`;
        } else {
            content += `<:Timer:1521227971590095070> **Duration:** Permanent\n`;
        }
        
        content += `\n> Thank you for using premium features! 🌟`;

        const container = new ContainerBuilder()
            .setAccentColor(COLORS.SUCCESS)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        // Grant premium badge (best-effort, non-blocking)
        await badgeManager.addBadgeToUser(message.author.id, 'premium').catch(() => {});

        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      } catch (error) {
        console.error('[RedeemKey] Error:', error);
        message.reply(require('../../utils/utilityUI').errReply('Error', 'An error occurred while redeeming the key. Please try again.')).catch(() => {});
      }
    }
};
