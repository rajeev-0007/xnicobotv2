const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');
const badgeManager = require('../../utils/badgeManager');

module.exports = {
    prefix: 'syncpremium',
    name: 'syncpremium',
    description: 'Reload premium data from the database and sync badges',
    usage: 'syncpremium',
    category: 'owner',
    aliases: ['reloadpremium', 'premiumsync', 'refreshpremium'],
    ownerOnly: true,

    async executePrefix(message) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const workingContainer = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Timer:1521227971590095070> Syncing Premium Data\n\nReloading from database and syncing badges...`
                    )
                );
            const statusMsg = await message.reply({ components: [workingContainer], flags: MessageFlags.IsComponentsV2 });

            // Step 1: Reload premium data from the database into memory
            const refreshed = await premiumManager.reloadPremiumData();

            // Step 2: Get updated counts
            const activeUsers = premiumManager.getActivePremiumUsers();
            const activeServers = premiumManager.getActivePremiumServers();

            // Step 3: Sync premium badges
            const badgeResult = await premiumManager.syncPremiumBadges(badgeManager);

            // Step 4: Run cleanup
            const cleanupResult = premiumManager.runCleanup(badgeManager);

            let content = `# <:Checkedbox:1521227734943269077> Premium Data Synced\n\n`;
            content += `<:Bookopen:1521227911137595605> **Stores Reloaded:** ${refreshed}\n`;
            content += `<:User:1521227714227343380> **Active Premium Users:** ${activeUsers.length}\n`;
            content += `<:Home:1521228339736482056> **Active Premium Servers:** ${activeServers.length}\n\n`;

            content += `### <:Fire:1521227907647668374> Badge Sync\n`;
            content += `> <:Checkedbox:1521227734943269077> Synced: **${badgeResult.synced}**\n`;
            if (badgeResult.failed > 0) {
                content += `> <:Cancel:1521227723916181644> Failed: **${badgeResult.failed}**\n`;
            }
            content += `\n`;

            if (cleanupResult.expiredPremiums > 0 || cleanupResult.expiredKeys > 0 || cleanupResult.expiredServerPremiums > 0) {
                content += `### <:Alarm:1521227869047750689> Cleanup\n`;
                if (cleanupResult.expiredKeys > 0) content += `> Expired keys removed: **${cleanupResult.expiredKeys}**\n`;
                if (cleanupResult.expiredPremiums > 0) content += `> Expired user premiums removed: **${cleanupResult.expiredPremiums}**\n`;
                if (cleanupResult.expiredServerPremiums > 0) content += `> Expired server premiums removed: **${cleanupResult.expiredServerPremiums}**\n`;
                content += `\n`;
            }

            content += `-# Premium data has been reloaded from the database and all badges synced.`;

            const resultContainer = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            try {
                await statusMsg.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
            } catch {
                await message.channel.send({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
            }
        } catch (error) {
            console.error('[SyncPremium] Error:', error);
            const container = buildErrorResponse('Sync Failed', `An error occurred: ${error.message}`);
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    }
};
