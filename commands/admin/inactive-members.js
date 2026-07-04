const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, PermissionFlagsBits } = require('discord.js');
const { buildErrorResponse, buildPermissionDenied, COLORS } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');

module.exports = {
    name: 'inactive-members',
    prefix: 'inactive-members',
    description: 'List members who haven\'t been active',
    category: 'admin',
    usage: 'inactive-members [days]',
    permissions: ['ManageGuild'],

    async executePrefix(message, args) {
        if (!message.guild) return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            const container = buildPermissionDenied('Manage Server');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const days = parseInt(args[0]) || 30;
            const cutoffDate = Date.now() - (days * 24 * 60 * 60 * 1000);

            const inactiveMembers = message.guild.members.cache.filter(member => {
                return !member.user.bot && member.joinedTimestamp < cutoffDate;
            });

            if (inactiveMembers.size === 0) {
                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.PRIMARY)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> No Inactive Members\n\nNo members found who joined more than **${days}** days ago.`
                    ))
;
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const allLines = inactiveMembers
                .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp)
                .map(m => `• **${m.user.username}** — Joined: ${new Date(m.joinedTimestamp).toLocaleDateString()}`);

            const result = paginate({
                header: `# <:Timer:1521227971590095070> Inactive Members (${inactiveMembers.size})\n-# Members who joined more than **${days}** days ago`,
                lines: allLines,
                perPage: 15,
                accentColor: COLORS.PRIMARY });

            const reply = await message.reply(result);
            setupPaginationCollector(reply, result._pageData, message.author.id);
        } catch (error) {
            console.error('[InactiveMembers] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
