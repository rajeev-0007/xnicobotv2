const { ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');

module.exports = {
    prefix: 'reset-permissions',
    description: 'Reset Permissions',
    usage: 'reset-permissions',
    category: 'admin',
    data: null,

    async executePrefix(message, args) {
        if (!message.guild) return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Administrator** permission to use this command!');
        }

        try {
            const channel = message.mentions.channels.first() || message.channel;

            await channel.permissionOverwrites.set([]);

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# ♻️ Permissions Reset!\n\n**Channel:** ${channel}\n\n*All permission overrides have been removed. Channel now uses default server permissions.*`)
                );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply(`<:Cancel:1521227723916181644> Error: ${error.message}`);
        }
    }
};
