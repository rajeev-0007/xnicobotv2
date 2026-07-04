'use strict';

/**
 * leaveguild.js — prefix-only.
 * Owner-only: have the bot leave a specific guild by ID.
 */

const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');

module.exports = {
    name: 'leaveguild',
    prefix: 'leaveguild',
    aliases: ['leaveserver', 'lg'],
    description: 'Owner-only: make the bot leave a server by ID',
    usage: 'leaveguild <serverId>',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const guildId = args[0];
        if (!guildId || !/^\d{17,20}$/.test(guildId)) {
            return message.reply(require('../../utils/ownerUI').errReply('Invalid Server ID', 'Please provide a valid server ID.'));
        }

        const guild = message.client.guilds.cache.get(guildId);
        if (!guild) {
            return message.reply(require('../../utils/ownerUI').errReply('Server Not Found', `Could not find server with ID: \`${guildId}\``));
        }

        const guildName = guild.name;

        try {
            await guild.leave();
            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Checkedbox:1521227734943269077> Left Server\n\n**Server:** ${guildName}\n**ID:** \`${guildId}\``
                ));
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply(require('../../utils/ownerUI').errReply('Error', `Error leaving server: ${error.message}`));
        }
    }
};
