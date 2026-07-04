const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const premiumManager = require('../../utils/premiumManager');
const badgeManager = require('../../utils/badgeManager');

module.exports = {
    name: 'userlookup',
    prefix: 'userlookup',
    aliases: ['ulookup', 'finduser', 'whois-owner'],
    description: 'Detailed user lookup across all servers',
    usage: 'userlookup <userID>',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) return;
        const userId = args[0]?.replace(/[<@!>]/g, '');
        if (!userId) return message.reply(require('../../utils/ownerUI').errReply('Missing Argument', 'Provide a user ID.', { hint: 'Usage: `userlookup <userID>`' }));
        await this.lookupUser(message, message.client, userId);
    },

    async lookupUser(context, client, userId) {
        let user;
        try { user = await client.users.fetch(userId, { force: true }); } catch {
            const msg = `<:Cancel:1521227723916181644> Could not find user with ID: \`${userId}\``;
            return context.editReply ? context.editReply({ content: msg }) : context.reply(msg);
        }

        const flags = user.flags?.toArray() || [];
        const isPremium = premiumManager.isPremium(userId);
        let badges = [];
        try { badges = await badgeManager.getUserBadges(userId); } catch {}

        // Find mutual servers
        const mutualGuilds = client.guilds.cache.filter(g => g.members.cache.has(userId));
        const guildLines = mutualGuilds.first(10).map(g => `> \`${g.id}\` — **${g.name}** (${g.memberCount} members)`);
        if (mutualGuilds.size > 10) guildLines.push(`> ... and ${mutualGuilds.size - 10} more`);

        const flagNames = {
            Staff: 'Discord Staff', Partner: 'Partner', Hypesquad: 'HypeSquad Events',
            BugHunterLevel1: 'Bug Hunter', BugHunterLevel2: 'Bug Hunter Gold',
            HypeSquadOnlineHouse1: 'Bravery', HypeSquadOnlineHouse2: 'Brilliance',
            HypeSquadOnlineHouse3: 'Balance', PremiumEarlySupporter: 'Early Supporter',
            VerifiedDeveloper: 'Verified Bot Dev', ActiveDeveloper: 'Active Developer',
            VerifiedBot: 'Verified Bot', CertifiedModerator: 'Certified Mod'
        };
        const flagDisplay = flags.map(f => flagNames[f] || f).join(', ') || 'None';

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### <:Search:1521228231263387738> User Lookup\n` +
                    `**User:** ${user.username}${user.globalName ? ` (${user.globalName})` : ''}\n` +
                    `**ID:** \`${user.id}\`\n` +
                    `**Bot:** ${user.bot ? 'Yes' : 'No'}\n` +
                    `**Created:** <t:${Math.floor(user.createdTimestamp / 1000)}:F> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)\n` +
                    `**Flags:** ${flagDisplay}\n` +
                    `**Premium:** ${isPremium ? '<:Toggleon:1521227758011809964> Yes' : '<:Toggleoff:1521227763816595559> No'}\n` +
                    `**Badges:** ${badges.length > 0 ? badges.map(b => `${b.emoji || '🏅'} ${b.name}`).join(', ') : 'None'}`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### <:Bookopen:1521227911137595605> Mutual Servers (${mutualGuilds.size})\n` +
                    (guildLines.length > 0 ? guildLines.join('\n') : '> None found in cache')
                )
            );

        const opts = { components: [container], flags: MessageFlags.IsComponentsV2 };
        return context.editReply ? context.editReply(opts) : context.reply(opts);
    }
};
