'use strict';

/**
 * dmstats.js — Owner-only: show statistics for DM commands (count
 * recent DM authors and channel cache occupancy).
 */

const { isOwner } = require('../../utils/helpers');
const { ChannelType, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    name: 'dmstats',
    prefix: 'dmstats',
    aliases: ['dms', 'dminfo'],
    description: 'Owner-only: show DM channel & user cache statistics',
    usage: 'dmstats',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager, client) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const dmChannels = client.channels.cache.filter(c => c.type === ChannelType.DM);
        const groupDms   = client.channels.cache.filter(c => c.type === ChannelType.GroupDM);
        const userCache  = client.users.cache.size;
        const memberCache = client.guilds.cache.reduce((acc, g) => acc + g.members.cache.size, 0);

        const content =
            `# <:Hashtag:1521227771957870604> DM Statistics\n\n` +
            `> **Open DM channels:** ${dmChannels.size}\n` +
            `> **Group DMs:** ${groupDms.size}\n` +
            `> **User cache:** ${userCache}\n` +
            `> **Cached guild members:** ${memberCache}\n\n` +
            `Use \`dmuser <userId> <message>\` to send a DM, or \`broadcast <text>\` to message every guild.`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
