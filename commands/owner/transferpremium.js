const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');
const premiumManager = require('../../utils/premiumManager');
const badgeManager = require('../../utils/badgeManager');

module.exports = {
    prefix: 'transferpremium',
    name: 'transferpremium',
    description: 'Transfer premium from one user to another',
    usage: 'transferpremium <@from|from_id> <@to|to_id>',
    category: 'owner',
    aliases: ['movepremium', 'premiummove'],
    ownerOnly: true,
    
    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

      try {
        // Resolve two users from args (mentions or raw IDs)
        async function resolveUser(arg) {
            if (!arg) return null;
            const id = arg.replace(/[<@!>]/g, '');
            if (!/^\d{17,20}$/.test(id)) return null;
            try {
                return await message.client.users.fetch(id);
            } catch {
                return null;
            }
        }

        const mentioned = [...message.mentions.users.values()];
        let fromUser, toUser;

        if (mentioned.length >= 2) {
            fromUser = mentioned[0];
            toUser = mentioned[1];
        } else if (mentioned.length === 1) {
            // One mention — determine which arg it is
            fromUser = mentioned[0];
            // The other arg should be a raw ID
            const otherArg = args.find(a => !a.includes(mentioned[0].id));
            toUser = await resolveUser(otherArg);
        } else {
            fromUser = await resolveUser(args[0]);
            toUser = await resolveUser(args[1]);
        }

        if (!fromUser || !toUser) {
            let content = `# <:Refresh:1521227946441052420> Transfer Premium\n\n`;
            content += `**Usage:** \`transferpremium <@from|from_id> <@to|to_id>\`\n\n`;
            content += `### Description\n`;
            content += `> Transfers the remaining premium subscription from one user to another.\n`;
            content += `> The source user loses their premium and it's granted to the target.\n`;
            content += `> If the target already has premium, the remaining time is added.\n\n`;
            content += `**Examples:**\n`;
            content += `\`transferpremium @OldUser @NewUser\`\n`;
            content += `\`transferpremium 123456789 987654321\``;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (fromUser.id === toUser.id) {
            const container = buildErrorResponse('Invalid Transfer', 'Cannot transfer premium to the same user.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const result = premiumManager.transferPremium(fromUser.id, toUser.id);

        if (!result.success) {
            const container = buildErrorResponse('Transfer Failed', result.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        let content = `# <:Checkedbox:1521227734943269077> Premium Transferred\n\n`;
        content += `<:User:1521227714227343380> **From:** ${fromUser.username} (\`${fromUser.id}\`)\n`;
        content += `<:User:1521227714227343380> **To:** ${toUser.username} (\`${toUser.id}\`)\n`;
        
        if (result.duration) {
            content += `<:Timer:1521227971590095070> **Remaining:** ${result.duration} day${result.duration === 1 ? '' : 's'}\n`;
            content += `<:Bookopen:1521227911137595605> **New Expiry:** <t:${Math.floor(new Date(result.expiresAt).getTime() / 1000)}:F>\n`;
        } else {
            content += `<:Timer:1521227971590095070> **Type:** Permanent ♾️\n`;
        }

        const container = new ContainerBuilder()
            .setAccentColor(COLORS.SUCCESS)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        // Update badges (best-effort)
        await badgeManager.removeBadgeFromUser(fromUser.id, 'premium').catch(() => {});
        await badgeManager.addBadgeToUser(toUser.id, 'premium').catch(() => {});

        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      } catch (error) {
        console.error('[TransferPremium] Error:', error);
        const container = buildErrorResponse('Error', 'An error occurred while transferring premium.');
        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }
    }
};
