const { ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

module.exports = {
    name: 'category-rename',
    prefix: 'category-rename',
    description: 'Rename a category',
    category: 'admin',
    usage: 'category-rename <category_id> <new_name>',
    permissions: ['ManageChannels'],

    async executePrefix(message, args) {
        if (!message.guild) return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply('<:Infocircle:1521227700835057685> You need Manage Channels permission to use this command.');
        }

        if (!args[0] || !args[1]) {
            return message.reply('<:Infocircle:1521227700835057685> Usage: `category-rename <category_id> <new_name>`');
        }

        const categoryId = args[0];
        const newName = args.slice(1).join(' ');

        try {
            const category = message.guild.channels.cache.get(categoryId);
            
            if (!category || category.type !== 4) {
                return message.reply('<:Cancel:1521227723916181644> Invalid category ID.');
            }

            const oldName = category.name;
            await category.setName(newName);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`<:Checkedbox:1521227734943269077> Category renamed from **${oldName}** to **${newName}**`)
                );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply(`<:Cancel:1521227723916181644> Failed to rename category: ${error.message}`);
        }
    }
};
