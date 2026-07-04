const badgeManager = require('../../utils/badgeManager');
const { resolveUser } = require('../../utils/resolveUser');
const ui = require('../../utils/socialUI');

module.exports = {
    prefix: 'badges',
    name: 'badges',
    description: 'View badges for yourself or another user',
    usage: 'badges [@user]',
    category: 'social',
    aliases: ['badge', 'mybadges'],

    async executePrefix(message, args) {
        const gid = message.guild?.id;
        const user = (await resolveUser(message, args)) || message.author;

        try {
            const badges = await badgeManager.getUserBadges(user.id);

            if (badges.length === 0) {
                return message.reply(ui.payload(ui.card({
                    guildId: gid,
                    title: `${ui.E.badge} ${user.username}'s Badges`,
                    thumbnail: user.displayAvatarURL({ size: 256 }),
                    blocks: ['*No badges yet! Badges can be earned or awarded.*'],
                })));
            }

            const badgeList = badges.map(b => `${b.emoji} **${b.name}**\n${ui.E.bullet} ${b.description}`).join('\n\n');

            return message.reply(ui.payload(ui.card({
                guildId: gid,
                title: `${ui.E.badge} ${user.username}'s Badges`,
                thumbnail: user.displayAvatarURL({ size: 256 }),
                blocks: [badgeList],
                note: `Total: ${badges.length} badge${badges.length !== 1 ? 's' : ''}`,
            })));
        } catch (error) {
            console.error('Error viewing badges:', error);
            await message.reply(ui.payload(ui.err(gid, 'Badge Error', 'An error occurred while fetching badges.', 'Please try again later.')));
        }
    }
};
