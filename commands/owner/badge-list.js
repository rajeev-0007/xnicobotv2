const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags
} = require('discord.js');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const { COLORS } = require('../../utils/responseBuilder');
const badgeManager = require('../../utils/badgeManager');
const { BADGE_ICONS, withV2 } = require('../../utils/badgeUI');
const { resolveUser } = require('../../utils/resolveUser');

const ACCENT = COLORS.INFO || 0xCAD7E6;

function buildEmptyContainer(title) {
    return new ContainerBuilder()
        .setAccentColor(ACCENT)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ${BADGE_ICONS.Award} ${title}\n\n*No badges to show.*`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

function userBadgeLine(b) {
    return `> ${b.emoji} **${b.name}**\n> └ ${b.description || '*No description*'}`;
}

function allBadgeLine(b) {
    return `> ${b.emoji} **${b.name}** (\`${b.badgeId}\`)\n> └ ${b.description || '*No description*'}`;
}

async function buildUserBadgesPayload(user) {
    const badges = await badgeManager.getUserBadges(user.id);
    if (!badges || badges.length === 0) {
        return {
            payload: { components: [buildEmptyContainer(`${user.username}'s Badges`)] },
            pageData: null
        };
    }
    const lines = badges.map(userBadgeLine);
    const result = paginate({
        header: `# ${BADGE_ICONS.Award} ${user.username}'s Badges\n-# **${badges.length}** badge(s)`,
        lines,
        perPage: 8,
        accentColor: ACCENT,
    });
    return { payload: { components: result.components, flags: result.flags }, pageData: result._pageData };
}

async function buildAllBadgesPayload() {
    const all = await badgeManager.getAllBadges();
    if (!all || all.length === 0) {
        return {
            payload: { components: [buildEmptyContainer('Badge Catalog')] },
            pageData: null
        };
    }

    // Catalog is now hardcoded and already sorted by `position`. We
    // render in catalog order instead of splitting by default/custom
    // because there are no custom badges anymore.
    const lines = all.map(allBadgeLine);

    const result = paginate({
        header: `# ${BADGE_ICONS.Award} Badge Catalog\n-# **${all.length}** badge(s) — sorted by display order`,
        lines,
        perPage: 10,
        accentColor: ACCENT,
    });
    return { payload: { components: result.components, flags: result.flags }, pageData: result._pageData };
}

module.exports = {
    name: 'badge-list',
    prefix: 'badge-list',
    aliases: ['badgelist'],
    description: 'List all badges or badges for a specific user',
    usage: 'badge-list [@user]',
    category: 'owner',

    async executePrefix(message, args) {
        try {
            const user = await resolveUser(message, args);
            const built = user
                ? await buildUserBadgesPayload(user)
                : await buildAllBadgesPayload();

            const sent = await message.reply(withV2(built.payload));
            if (built.pageData) {
                setupPaginationCollector(sent, built.pageData, message.author.id);
            }
        } catch (error) {
            console.error('Error listing badges (prefix):', error);
            await message.reply({
                components: [buildEmptyContainer('Badge List Failed')],
                flags: MessageFlags.IsComponentsV2
            });
        }
    }
};
