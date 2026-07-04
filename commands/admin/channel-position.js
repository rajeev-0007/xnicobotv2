const { ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'channel-position',
    prefix: 'channel-position',
    description: 'Change the position of a channel',
    category: 'admin',
    usage: 'channel-position <#channel> <position>',
    permissions: ['ManageChannels'],

    async executePrefix(message, args) {
        if (!message.guild) return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('<:Infocircle:1521227700835057685> You need Manage Channels permission to use this command.');
        }

        const channel = message.mentions.channels.first();
        if (!channel) {
            return message.reply('<:Infocircle:1521227700835057685> Please mention a channel.');
        }

        const position = parseInt(args[1]);
        if (isNaN(position) || position < 0) {
            return message.reply('<:Infocircle:1521227700835057685> Please provide a valid position number.');
        }

        try {
            await channel.setPosition(position);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`<:Checkedbox:1521227734943269077> ${channel} position set to **${position}**.`)
                );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply(`<:Cancel:1521227723916181644> Failed to set channel position: ${error.message}`);
        }
    }
};
