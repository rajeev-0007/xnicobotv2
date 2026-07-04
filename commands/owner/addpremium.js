const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');
const badgeManager = require('../../utils/badgeManager');
const { resolveUser } = require('../../utils/resolveUser');

module.exports = {
    prefix: 'addpremium',
    name: 'addpremium',
    description: 'Directly add premium to a user without a key',
    usage: 'addpremium <@user|user_id> [duration_in_days]',
    category: 'owner',
    aliases: ['givepremium', 'grantpremium'],
    ownerOnly: true,
    
    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

      try {
        // Support both @mention and raw user ID
        let user = await resolveUser(message, args);
        let durationArgIndex = 1;

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
            let content = `# <:Sketch:1521228025365004471> Add Premium\n\n`;
            content += `**Usage:** \`addpremium <@user|user_id> [duration_in_days]\`\n\n`;
            content += `### Description\n`;
            content += `> Directly grants premium access to a user without requiring a key.\n`;
            content += `> If no duration is specified, grants permanent premium.\n`;
            content += `> Supports both @mentions and raw user IDs.\n\n`;
            content += `**Examples:**\n`;
            content += `\`addpremium @User\` - Grant permanent premium\n`;
            content += `\`addpremium @User 30\` - Grant 30-day premium\n`;
            content += `\`addpremium 123456789012345678 365\` - Grant 1-year premium by ID`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Parse duration — check args[1] first, but if a raw ID was used, duration is also args[1]
        let duration = null;
        const durationArg = args[durationArgIndex];
        if (durationArg) {
            const parsedDuration = parseInt(durationArg, 10);
            if (isNaN(parsedDuration) || parsedDuration <= 0) {
                const container = buildErrorResponse('Invalid Duration', 'Duration must be a positive number of days.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            duration = parsedDuration;
        }

        // Add premium directly
        const result = premiumManager.addPremiumDirect(user.id, duration);

        if (!result.success) {
            const container = buildErrorResponse('Error', result.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        let detailsText = `**User ID:** ${user.id}\n`;
        if (duration) {
            detailsText += `**Duration:** ${duration} days\n`;
            detailsText += `**Expires:** <t:${Math.floor(new Date(result.expiresAt).getTime() / 1000)}:F>`;
        } else {
            detailsText += `**Duration:** Permanent`;
        }

        const container = buildSuccessResponse(
            'Premium Added',
            `Successfully granted premium to **${user.username}**.`,
            detailsText
        );

        // Grant premium badge (best-effort, non-blocking)
        await badgeManager.addBadgeToUser(user.id, 'premium').catch(() => {});

        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        // --- Notify user via DM ---
        try {
            const botName = message.client.user.username;
            const durationText = duration ? `**${duration} days**` : '**Permanent**';
            const expiryText = duration && result.expiresAt
                ? `\n<:Bookopen:1521227911137595605> **Expires:** <t:${Math.floor(new Date(result.expiresAt).getTime() / 1000)}:F>`
                : '';

            const dmContainer = new ContainerBuilder()
                ;
            
            let dmContent = `# <:Sketch:1521228025365004471> Premium Activated!\n\n`;
            dmContent += `Congratulations! You've been granted **Premium** access for **${botName}**.\n\n`;
            dmContent += `### <:Fire:1521227907647668374> Premium Details\n`;
            dmContent += `<:Caretright:1521227704953864202> **Duration:** ${durationText}${expiryText}\n`;
            dmContent += `<:Caretright:1521227704953864202> **Activated By:** Bot Owner\n\n`;
            dmContent += `### <:Checkedbox:1521227734943269077> Premium Benefits\n`;
            dmContent += `<:Caretright:1521227704953864202> Access to all premium commands\n`;
            dmContent += `<:Caretright:1521227704953864202> Priority support\n`;
            dmContent += `<:Caretright:1521227704953864202> Exclusive premium badge\n`;
            dmContent += `<:Caretright:1521227704953864202> No cooldown restrictions\n\n`;
            dmContent += `-# Thank you for being a premium user! <:Sketch:1521228025365004471>`;

            dmContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(dmContent));

            await user.send({ components: [dmContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {
                // User may have DMs disabled - that's fine
                console.log(`Could not DM premium notification to ${user.username}`);
            });
        } catch (e) {
            // Non-critical - don't fail the command
        }
      } catch (error) {
        console.error('[AddPremium] Error:', error);
        const container = buildErrorResponse('Error', 'An error occurred while adding premium.');
        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }
    }
};
