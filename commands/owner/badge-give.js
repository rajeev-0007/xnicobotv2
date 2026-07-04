const { isOwner } = require('../../utils/helpers');
const { resolveUser } = require('../../utils/resolveUser');
const { MessageFlags } = require('discord.js');
const badgeManager = require('../../utils/badgeManager');
const {
    BADGE_ICONS,
    buildSuccessContainer,
    buildErrorContainer,
    editV2Reply
} = require('../../utils/badgeUI');

function buildSuccessMessage(badge, user, totalBadges) {
    return buildSuccessContainer(
        'Badge Awarded',
        `Successfully gave the **${badge.emoji} ${badge.name}** badge to **${user.username}**!\n\n` +
        `**Badge Description:** ${badge.description || '*No description*'}\n` +
        `**Total Badges:** ${totalBadges}`,
        badge,
        // Prefer the badge image when available; otherwise fall back to user avatar.
        badge.imageUrl ? null : user,
        badge.color
    );
}

module.exports = {
    name: 'badge-give',
    prefix: 'badge-give',
    aliases: ['givebadge', 'badgegive'],
    description: 'Give a custom badge to a user (Owner Only)',
    usage: 'badge-give <@user> <badge-id>',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply(`${BADGE_ICONS.Cancel} This command is only available to the bot owner.`);
        }

        const prefix = message.prefix || '-';

        if (args.length < 2) {
            return message.reply({
                components: [buildErrorContainer(
                    'Invalid Usage',
                    `**Usage:** \`${prefix}badge-give <@user> <badge-id>\``
                )],
                flags: MessageFlags.IsComponentsV2
            });
        }

        const user = await resolveUser(message, args);
        if (!user) {
            return message.reply({
                components: [buildErrorContainer('User Not Found', 'Please mention a valid user.')],
                flags: MessageFlags.IsComponentsV2
            });
        }
        if (user.bot) {
            return message.reply({
                components: [buildErrorContainer('Cannot Award Badge', 'Badges cannot be awarded to bots.')],
                flags: MessageFlags.IsComponentsV2
            });
        }

        try {
            const badgeId = args[1].toLowerCase();
            const badges = await badgeManager.getAllBadges();
            const badge = badges.find(b => b.badgeId === badgeId);
            if (!badge) {
                const list = badges.map(b => `\`${b.badgeId}\``).join(', ') || '*none*';
                return message.reply({
                    components: [buildErrorContainer(
                        'Badge Not Found',
                        `Badge with ID \`${badgeId}\` does not exist.\n\n**Available badges:** ${list}`
                    )],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            const result = await badgeManager.addBadgeToUser(user.id, badgeId);
            if (!result.success) {
                return message.reply({
                    components: [buildErrorContainer('Could Not Award Badge', result.message || 'Unknown error.')],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            return message.reply({
                components: [buildSuccessMessage(result.badge, user, result.totalBadges)],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            console.error('Error giving badge:', error);
            return message.reply({
                components: [buildErrorContainer('Failed to Award Badge', error.message || 'Unknown error.')],
                flags: MessageFlags.IsComponentsV2
            });
        }
    }
};
