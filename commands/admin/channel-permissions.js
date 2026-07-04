const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

module.exports = {
    name: 'channel-permissions',
    prefix: 'channel-permissions',
    description: 'View channel permission overrides',
    category: 'admin',
    usage: 'channel-permissions [#channel]',
    aliases: ['chperms', 'channelperms'],
    permissions: ['ManageChannels'],

    async executePrefix(message, args) {
        if (!message.guild) return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('<:Infocircle:1521227700835057685> You need Manage Channels permission to use this command.');
        }

        try {
            const channel = message.mentions.channels.first() || message.channel;
            const overwrites = channel.permissionOverwrites.cache;

            if (overwrites.size === 0) {
                const container = buildErrorResponse(
                    '<:Key:1521228000467878111> No Overrides',
                    `${channel} has no permission overrides.`
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const allLines = overwrites.map(overwrite => {
                const target = overwrite.type === 0 ? message.guild.roles.cache.get(overwrite.id) : message.guild.members.cache.get(overwrite.id);
                const name = target ? (overwrite.type === 0 ? `@${target.name}` : target.user.username) : 'Unknown';
                const icon = overwrite.type === 0 ? '<:Userplus:1521227719621218477>' : '<:User:1521227714227343380>';
                const allow = overwrite.allow.toArray().slice(0, 8).map(p => `\`${p}\``).join(', ') || 'None';
                const deny = overwrite.deny.toArray().slice(0, 8).map(p => `\`${p}\``).join(', ') || 'None';
                const allowMore = overwrite.allow.toArray().length > 8 ? ` +${overwrite.allow.toArray().length - 8}` : '';
                const denyMore = overwrite.deny.toArray().length > 8 ? ` +${overwrite.deny.toArray().length - 8}` : '';
                return `> ${icon} **${name}**\n> <:Checkedbox:1521227734943269077> ${allow}${allowMore}\n> <:Cancel:1521227723916181644> ${deny}${denyMore}`;
            });

            const result = paginate({
                header: `# <:Key:1521228000467878111> Permission Overrides\n-# ${channel} • **${overwrites.size}** override(s)`,
                lines: [...allLines],
                perPage: 5,
                accentColor: COLORS.INFO,
            });

            const reply = await message.reply(result);
            if (result._pageData) setupPaginationCollector(reply, result._pageData, message.author.id);
        } catch (error) {
            console.error('[ChannelPermissions] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
