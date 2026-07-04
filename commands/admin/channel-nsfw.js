const { ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'channel-nsfw',
    prefix: 'channel-nsfw',
    description: 'Toggle NSFW mode for a channel',
    category: 'admin',
    usage: 'channel-nsfw [#channel] <on/off>',
    permissions: ['ManageChannels'],

    async executePrefix(message, args) {
        if (!message.guild) return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('You need Manage Channels permission to use this command.');
        }

        const channel = message.mentions.channels.first() || message.channel;
        const toggle = args[message.mentions.channels.first() ? 1 : 0];

        if (!toggle || (toggle !== 'on' && toggle !== 'off')) {
            return message.reply('Usage: `channel-nsfw [#channel] <on/off>`');
        }

        const nsfw = toggle === 'on';

        try {
            await channel.setNSFW(nsfw);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`<:Checkedbox:1521227734943269077> NSFW mode ${nsfw ? 'enabled' : 'disabled'} for ${channel}`)
                );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply(`<:Cancel:1521227723916181644> Failed to update channel: ${error.message}`);
        }
    }
};
