const { ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

module.exports = {
    prefix: 'setbotname',
    description: 'Setbotname',
    usage: 'setbotname',
    category: 'admin',
    data: null,

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('<:Cancel:1521227723916181644> You need Manage Server permission to use this command!');
        }

        const newName = args.join(' ');

        if (!newName) {
            const currentName = message.guild.members.me.nickname || message.client.user.username;
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Edit:1521227886634205298> Set Bot Server Name\n\n**Usage:** \`setbotname <name>\`\n\n**Current Server Name:** ${currentName}\n**Global Name:** ${message.client.user.username}\n\n**Options:**\n<:Refresh:1521227946441052420> Use \`reset\` to use global name\n\n**Examples:**\n\`setbotname Music Bot\`\n\`setbotname [VIP] Assistant\`\n\`setbotname reset\`\n\n**Note:** This sets the bot's name only for this server!`)
                );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            if (args[0]?.toLowerCase() === 'reset') {
                await message.guild.members.me.setNickname(null);
                
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(`# <:Edit:1521227886634205298> Server Name Reset\n\n<:Checkedbox:1521227734943269077> Bot name has been reset to global name for this server!\n\n**Global Name:** ${message.client.user.username}`)
                    );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            await message.guild.members.me.setNickname(newName);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Edit:1521227886634205298> Server Name Updated\n\n<:Checkedbox:1521227734943269077> Bot name has been changed for **${message.guild.name}**!\n\n**New Server Name:** ${newName}\n**Global Name:** ${message.client.user.username}\n\n**Note:** This only affects this server. Other servers will see the global name.`)
                );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply(`<:Cancel:1521227723916181644> Failed to update server name: ${error.message}\n\n*Note: Make sure the bot has permission to change its nickname!*`);
        }
    }
};
