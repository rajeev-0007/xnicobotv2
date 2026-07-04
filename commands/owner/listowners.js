const { isOwner } = require('../../utils/helpers');
const fs = require('fs');
const path = require('path');
const jsonStore = require('../../utils/jsonStore');
const { MessageFlags } = require('discord.js');
const { buildErrorResponse } = require('../../utils/responseBuilder');

module.exports = {
    name: 'listowners',
    prefix: 'listowners',
    aliases: ['owners', 'coowners'],
    description: 'List the bot owner and co-owners',
    usage: 'listowners',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager, client) {
        if (!isOwner(message.author.id)) {
            return message.reply({ components: [buildErrorResponse('Owner Only', 'This command is only available to the bot owner.')], flags: MessageFlags.IsComponentsV2 });
        }

        const ownersPath = path.join(__dirname, '..', '..', 'datas', 'owners.json');
        let owners = [];
        
        if (jsonStore.has('owners')) {
            owners = jsonStore.read('owners');
        }

        const mainOwner = await client.users.fetch(process.env.OWNER_ID);
        let ownerList = `<:Crown:1521227739988889764> **Main Owner:** ${mainOwner.username}\n\n`;

        if (owners.length > 0) {
            ownerList += `**Co-Owners:**\n`;
            for (const id of owners) {
                try {
                    const user = await client.users.fetch(id);
                    ownerList += `• ${user.username} (${id})\n`;
                } catch (err) {
                    ownerList += `• Unknown User (${id})\n`;
                }
            }
        } else {
            ownerList += `*No co-owners*`;
        }

        message.reply(ownerList);
    }
};
