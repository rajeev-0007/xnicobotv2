const { ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

module.exports = {
    prefix: 'dm-user',
    description: 'Dm User',
    usage: 'dm-user',
    category: 'admin',
    data: null,

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply(require('../../utils/adminUI').errReply('Missing Permission', 'You need the **Administrator** permission.'));
        }

        const target = message.mentions.users.first();
        if (!target) {
            return message.reply(require('../../utils/adminUI').errReply('Invalid Usage', 'Usage: `dm-user @user <message>`'));
        }

        const dmMessage = args.slice(1).join(' ');
        if (!dmMessage) {
            return message.reply(require('../../utils/adminUI').errReply('Missing Message', 'Please provide a message to send.'));
        }

        try {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# 📬 Message from ${message.guild.name}\n\n${dmMessage}\n\n*Sent by a server moderator*`)
                );

            await target.send({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });

            const confirmContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> DM Sent!\n\n**To:** ${target.username}\n**Message:** ${dmMessage.substring(0, 100)}${dmMessage.length > 100 ? '...' : ''}`)
                );

            await message.reply({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply(require('../../utils/adminUI').errReply('DM Failed', error.message, { hint: 'User may have DMs disabled.' }));
        }
    }
};
