'use strict';

/**
 * dmuser.js — prefix-only.
 * Owner-only DM relay; sends a Components V2 message to a user by ID.
 */

const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');

module.exports = {
    name: 'dmuser',
    prefix: 'dmuser',
    aliases: ['dm', 'dmsend'],
    description: 'Send a DM to a user as the bot',
    usage: 'dmuser <userId> <message>',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const userId = args[0]?.replace(/[<@!>]/g, '');
        const dmMessage = args.slice(1).join(' ');

        if (!userId || !/^\d{17,20}$/.test(userId) || !dmMessage) {
            return message.reply(require('../../utils/ownerUI').errReply('Invalid Usage', 'Usage: `dmuser <userId> <message>`'));
        }

        try {
            const user = await message.client.users.fetch(userId);

            const dmContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Hashtag:1521227771957870604> Message from Bot Owner\n\n${dmMessage}`
                ));
            await user.send({ components: [dmContainer], flags: MessageFlags.IsComponentsV2 });

            const successContainer = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> DM Sent\n\n**To:** ${user.username} (\`${user.id}\`)\n**Message:** ${dmMessage}`
                ));
            return message.reply({ components: [successContainer], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            return message.reply(require('../../utils/ownerUI').errReply('DM Failed', `Failed to send DM: ${error.message}`));
        }
    }
};
