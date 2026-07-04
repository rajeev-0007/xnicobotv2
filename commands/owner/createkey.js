const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');

module.exports = {
    prefix: 'createkey',
    name: 'createkey',
    description: 'Create a premium key',
    usage: 'createkey [duration_in_days]',
    category: 'owner',
    aliases: ['genkey', 'generatekey'],
    ownerOnly: true,
    
    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

      try {
        // Parse duration argument (optional)
        let duration = null;
        if (args[0]) {
            const parsedDuration = parseInt(args[0], 10);
            if (isNaN(parsedDuration) || parsedDuration <= 0) {
                let content = `# <:Key:1521228000467878111> Create Premium Key\n\n`;
                content += `**Usage:** \`createkey [duration_in_days]\`\n\n`;
                content += `### Description\n`;
                content += `> Creates a premium key that users can redeem.\n`;
                content += `> If no duration is specified, the key grants permanent premium.\n\n`;
                content += `**Examples:**\n`;
                content += `\`createkey\` - Create permanent premium key\n`;
                content += `\`createkey 30\` - Create 30-day premium key\n`;
                content += `\`createkey 365\` - Create 1-year premium key`;

                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.INFO)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            duration = parsedDuration;
        }

        // Create the key
        const keyData = premiumManager.createKey(duration);
        
        const createdTs = Math.floor(new Date(keyData.createdAt).getTime() / 1000);
        const expiresTs = Math.floor(new Date(keyData.expiresAt).getTime() / 1000);

        let content = `# <:Checkedbox:1521227734943269077> Premium Key Created\n\n`;
        content += `<:Key:1521228000467878111> **Key:** \`${keyData.key}\`\n`;
        content += `<:Bookopen:1521227911137595605> **Created:** <t:${createdTs}:R>\n`;
        content += `<:Alarm:1521227869047750689> **Key Expires:** <t:${expiresTs}:R> (must be redeemed within 24h)\n`;
        content += `<:Timer:1521227971590095070> **Premium Duration:** ${duration ? `${duration} days` : 'Permanent'}\n`;
        content += `<:Invoice:1521227903956811836> **Status:** Unused\n\n`;
        content += `> Users can redeem this key using the \`redeemkey\` command.`;

        const container = new ContainerBuilder()
            .setAccentColor(COLORS.SUCCESS)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      } catch (error) {
        console.error('[CreateKey] Error:', error);
        const container = buildErrorResponse('Error', 'An error occurred while creating the key.');
        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }
    }
};
