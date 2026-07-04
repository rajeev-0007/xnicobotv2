const { ContainerBuilder, TextDisplayBuilder, MessageFlags, ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = {
    usage: 'slowmode-all',
    category: 'admin',
    name: 'slowmode-all',
    prefix: 'slowmode-all',
    description: 'Set slowmode in all text channels',

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply(require('../../utils/adminUI').errReply('Missing Permission', 'You need the **Manage Channels** permission.'));
        }

        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply(require('../../utils/adminUI').errReply('Missing Bot Permission', 'I need the **Manage Channels** permission to execute this command.'));
        }

        const seconds = parseInt(args[0]);
        if (isNaN(seconds) || seconds < 0 || seconds > 21600) {
            return message.reply(require('../../utils/adminUI').errReply('Invalid Number', 'Please provide a valid number between 0 and 21600 seconds.'));
        }

        const textChannels = message.guild.channels.cache.filter(c => c.type === ChannelType.GuildText);
        let updated = 0;
        let failed = 0;

        for (const [id, channel] of textChannels) {
            try {
                await channel.setRateLimitPerUser(seconds, `Slowmode-all by ${message.author.username}`);
                updated++;
            } catch (error) {
                failed++;
            }
        }

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`# <:Timer:1521227971590095070> Slowmode-all Complete\n\n<:Checkedbox:1521227734943269077> **Updated:** ${updated} channels\n<:Cancel:1521227723916181644> **Failed:** ${failed} channels\n**Slowmode:** ${seconds}s\n**Moderator:** ${message.author.username}`)
            );

        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
