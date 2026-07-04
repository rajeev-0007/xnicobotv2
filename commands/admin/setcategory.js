const { PermissionFlagsBits, ChannelType } = require('discord.js');

module.exports = {
    usage: 'setcategory',
    category: 'admin',
    name: 'setcategory',
    prefix: 'setcategory',
    description: 'Move a channel to a different category',
    async executePrefix(message, args) {
        if (!message.guild) return message.reply(require('../../utils/adminUI').errReply('Not In A Server', 'This command can only be used in a server.')).catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply(require('../../utils/adminUI').errReply('Missing Permission', 'You need the **Manage Channels** permission.'));
        }

        const channel = message.mentions.channels.first() || message.channel;
        const categoryId = args.find(arg => /^\d+$/.test(arg));

        if (!categoryId) {
            return message.reply(require('../../utils/adminUI').errReply('Missing Category', 'Please provide a category ID.', { hint: 'Usage: `-setcategory #channel <categoryID>`' }));
        }

        const category = message.guild.channels.cache.get(categoryId);
        if (!category || category.type !== ChannelType.GuildCategory) {
            return message.reply(require('../../utils/adminUI').errReply('Invalid Category', 'Invalid category ID.'));
        }

        try {
            await channel.setParent(category);
            await message.reply(`<:Checkedbox:1521227734943269077> Moved **${channel.name}** to **${category.name}**`);
        } catch (error) {
            await message.reply(require('../../utils/adminUI').errReply('Failed', 'Failed to move channel.'));
        }
    }
};
