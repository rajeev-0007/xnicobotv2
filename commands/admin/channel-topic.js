const { ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'channel-topic',
    prefix: 'channel-topic',
    description: 'Set channel topic',
    category: 'admin',
    usage: 'channel-topic [#channel] <topic>',
    permissions: ['ManageChannels'],

    async executePrefix(message, args) {
        if (!message.guild) return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('<:Infocircle:1521227700835057685> You need Manage Channels permission to use this command.');
        }

        const channel = message.mentions.channels.first() || message.channel;
        const topic = args.slice(message.mentions.channels.first() ? 1 : 0).join(' ');

        if (!topic) {
            return message.reply('<:Infocircle:1521227700835057685> Usage: `channel-topic [#channel] <topic>`');
        }

        try {
            await channel.setTopic(topic);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`<:Checkedbox:1521227734943269077> Channel topic set for ${channel}:\n\n"${topic}"`)
                );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply(`<:Cancel:1521227723916181644> Failed to set topic: ${error.message}`);
        }
    }
};
