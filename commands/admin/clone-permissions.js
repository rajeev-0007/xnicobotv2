const { ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

module.exports = {
    prefix: 'clone-permissions',
    description: 'Clone Permissions',
    usage: 'clone-permissions',
    category: 'admin',
    data: null,

    async executePrefix(message, args) {
        if (!message.guild) return message.reply(require('../../utils/adminUI').errReply('Not In A Server', 'This command can only be used in a server.')).catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply(require('../../utils/adminUI').errReply('Missing Permission', 'You need the **Manage Channels** permission.'));
        }

        if (args.length < 2) {
            return message.reply(require('../../utils/adminUI').errReply('Invalid Usage', 'Usage: `clone-permissions <#source-channel> <#target-channel>`'));
        }

        try {
            const sourceChannel = message.mentions.channels.first();
            const targetChannel = [...message.mentions.channels.values()][1];

            if (!sourceChannel || !targetChannel) {
                return message.reply(require('../../utils/adminUI').errReply('Missing Channels', 'Please mention both source and target channels.'));
            }

            await targetChannel.permissionOverwrites.set(sourceChannel.permissionOverwrites.cache);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Checkedbox:1521227734943269077> Permissions Cloned!\n\n**From:** ${sourceChannel}\n**To:** ${targetChannel}\n\n*All permission overrides copied successfully*`)
                );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply(require('../../utils/adminUI').errReply('Error', error.message));
        }
    }
};
