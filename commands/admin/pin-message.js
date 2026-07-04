const { ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'pin-message',
    prefix: 'pin-message',
    description: 'Pin a message by ID',
    category: 'admin',
    usage: 'pin-message <message_id>',
    permissions: ['ManageMessages'],

    async executePrefix(message, args) {
        if (!message.guild) return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply('You need Manage Messages permission to use this command.');
        }

        if (!args[0]) {
            return message.reply('Please provide a message ID.');
        }

        try {
            const targetMessage = await message.channel.messages.fetch(args[0]);
            await targetMessage.pin();

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent('<:Checkedbox:1521227734943269077> Message pinned successfully!')
                );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply(`<:Cancel:1521227723916181644> Failed to pin message: ${error.message}`);
        }
    }
};
