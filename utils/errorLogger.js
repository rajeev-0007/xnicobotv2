const { EmbedBuilder, MessageFlags } = require('discord.js');
const log = require('./logger-styled');

const ERROR_LOG_CHANNEL_ID = '1216966256171810869';

async function logError(client, error, context = {}) {
    try {
        const channel = await client.channels.fetch(ERROR_LOG_CHANNEL_ID).catch(() => null);
        if (!channel) {
            log.error('Error log channel not found!');
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('<:Cancel:1521227723916181644> Error Occurred')
            .setTimestamp();

        if (context.type) {
            embed.addFields({ name: 'Error Type', value: context.type, inline: true });
        }

        if (context.user) {
            embed.addFields({ 
                name: 'User', 
                value: `${context.user.username} (${context.user.id})`, 
                inline: true 
            });
        }

        if (context.guild) {
            embed.addFields({ 
                name: 'Server', 
                value: `${context.guild.name} (${context.guild.id})`, 
                inline: true 
            });
        }

        if (context.command) {
            embed.addFields({ name: 'Command', value: context.command, inline: true });
        }

        if (context.channel) {
            embed.addFields({ 
                name: 'Channel', 
                value: `#${context.channel.name} (${context.channel.id})`, 
                inline: true 
            });
        }

        const errorMessage = error.message || error.toString();
        const errorStack = error.stack || 'No stack trace available';

        embed.addFields({ 
            name: 'Error Message', 
            value: `\`\`\`${errorMessage.substring(0, 1000)}\`\`\`` 
        });

        if (errorStack.length > 0) {
            const stackPreview = errorStack.substring(0, 1000);
            embed.addFields({ 
                name: 'Stack Trace', 
                value: `\`\`\`${stackPreview}\`\`\`` 
            });
        }

        if (context.additionalInfo) {
            embed.addFields({ 
                name: 'Additional Info', 
                value: context.additionalInfo.substring(0, 1000) 
            });
        }

        await channel.send({ embeds: [embed], flags: MessageFlags.SuppressNotifications });
    } catch (logError) {
        log.error('Failed to send error log:', logError);
    }
}

module.exports = { logError };
