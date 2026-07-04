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
        'Badge Removed',
        `Successfully removed the **${badge.emoji} ${badge.name}** badge from **${user.username}**.\n\n` +
        `**Remaining Badges:** ${totalBadges}`,
        badge,
        user,
        '#ED4245'
    );
}

function buildOrphanRemovedMessage(badgeId, user, totalBadges) {
    // The user had this badge but the catalog entry no longer exists
    // (deleted out of band). Render a distinct message rather than
    // feeding an undefined badge into the standard success container,
    // which would print "Successfully removed the **`<empty>` <id>**".
    return buildSuccessContainer(
        'Orphaned Badge Removed',
        `Removed orphaned badge \`${badgeId}\` from **${user.username}**.\n\n` +
        `The badge was on the user but its catalog entry was missing.\n\n` +
        `**Remaining Badges:** ${totalBadges}`,
        null,
        user,
        '#ED4245'
    );
}

module.exports = {
    name: 'badge-remove',
    prefix: 'badge-remove',
    aliases: ['removebadge', 'badgeremove'],
    description: 'Remove a custom badge from a user (Owner Only)',
    usage: 'badge-remove <@user> <badge-id>',
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
                    `**Usage:** \`${prefix}badge-remove <@user> <badge-id>\``
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
                components: [buildErrorContainer('Cannot Remove Badge', 'Bots do not own badges.')],
                flags: MessageFlags.IsComponentsV2
            });
        }

        try {
            const badgeId = args[1].toLowerCase();
            const result = await badgeManager.removeBadgeFromUser(user.id, badgeId);
            if (!result.success) {
                return message.reply({
                    components: [buildErrorContainer('Could Not Remove Badge', result.message || 'Unknown error.')],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            return message.reply({
                components: [
                    result.badge
                        ? buildSuccessMessage(result.badge, user, result.totalBadges)
                        : buildOrphanRemovedMessage(badgeId, user, result.totalBadges)
                ],
                flags: MessageFlags.IsComponentsV2
            });
        } catch (error) {
            console.error('Error removing badge:', error);
            return message.reply({
                components: [buildErrorContainer('Failed to Remove Badge', error.message || 'Unknown error.')],
                flags: MessageFlags.IsComponentsV2
            });
        }
    }
};
