const { ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    prefix: 'backup-channel',
    description: 'Backup Channel',
    usage: 'backup-channel',
    category: 'admin',
    data: null,

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Administrator** permission to use this command!');
        }

        try {
            const channel = message.mentions.channels.first() || message.channel;
            // Parse limit from the correct arg position (skip channel mention if present)
            const limitArg = message.mentions.channels.size > 0 ? args[1] : args[0];
            const limit = Math.min(parseInt(limitArg) || 100, 100);

            if (limit < 1) {
                return message.reply('<:Cancel:1521227723916181644> Limit must be between 1 and 100!');
            }

            const messages = await channel.messages.fetch({ limit });
            
            const backup = {
                channelName: channel.name,
                channelId: channel.id,
                guildName: message.guild.name,
                guildId: message.guild.id,
                backupDate: new Date().toISOString(),
                messageCount: messages.size,
                messages: messages.map(msg => ({
                    id: msg.id,
                    author: {
                        tag: msg.author.username,
                        id: msg.author.id
                    },
                    content: msg.content,
                    timestamp: msg.createdAt.toISOString(),
                    embeds: msg.embeds.length,
                    attachments: msg.attachments.map(a => a.url)
                }))
            };

            const backupDir = path.join(__dirname, '../../backups/channels');
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }

            const filename = `${channel.name}-${Date.now()}.json`;
            const filepath = path.join(backupDir, filename);
            
            fs.writeFileSync(filepath, JSON.stringify(backup, null, 2));

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Desktop:1521227927209902190> Channel Backup Created!\n\n**Channel:** ${channel}\n**Messages:** ${messages.size}\n**File:** ${filename}\n\n*Backup saved to server files*`)
                );

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            await message.reply(`<:Cancel:1521227723916181644> Error: ${error.message}`).catch(() => {});
        }
    }
};
