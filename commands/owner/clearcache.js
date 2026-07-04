const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse, COLORS } = require('../../utils/responseBuilder');

module.exports = {
    prefix: 'clearcache',
    description: 'Clear bot cache to free up memory',
    usage: 'clearcache [safe|commands|gc|all]',
    category: 'owner',
    aliases: ['cc', 'sweepcache'],
    ownerOnly: true,
    
    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const cacheType = args[0]?.toLowerCase() || 'safe';

        if (!['safe', 'commands', 'gc', 'all'].includes(cacheType)) {
            let content = `# 🧹 Clear Cache\n\n`;
            content += `**Usage:** \`clearcache [type]\`\n\n`;
            content += `### Cache Types\n`;
            content += `> **safe** - Sweep messages, presences, inactive users (recommended)\n`;
            content += `> **commands** - Clear command module cache (for reload)\n`;
            content += `> **gc** - Run garbage collection\n`;
            content += `> **all** - Run all safe operations\n\n`;
            content += `**Note:** Critical caches are never cleared for stability.`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.INFO)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            let swept = [];
            let memBefore = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

            if (cacheType === 'safe' || cacheType === 'all') {
                let messageCount = 0;
                message.client.guilds.cache.forEach(guild => {
                    guild.channels.cache.forEach(channel => {
                        if (channel.messages) {
                            const before = channel.messages.cache.size;
                            channel.messages.cache.sweep(msg => msg.id !== message.id);
                            messageCount += before - channel.messages.cache.size;
                        }
                    });
                });
                if (messageCount > 0) swept.push(`Messages: ${messageCount} swept`);

                const usersSweep = message.client.users.cache.sweep(user => 
                    user.id !== message.client.user.id && 
                    user.id !== message.author.id &&
                    !message.client.guilds.cache.some(g => g.members.cache.has(user.id))
                );
                if (usersSweep > 0) swept.push(`Inactive users: ${usersSweep} swept`);
            }

            if (cacheType === 'commands') {
                const commandCount = message.client.commands.size;
                const commandFolders = ['music', 'voice', 'basic', 'fun', 'admin', 'automation', 'utility', 'owner', 'economy', 'leveling', 'image', 'social', 'backup', 'webhook', 'dm'];
                const path = require('path');
                const fs = require('fs');
                
                for (const folder of commandFolders) {
                    const commandsPath = path.join(__dirname, '..', '..', 'commands', folder);
                    if (fs.existsSync(commandsPath)) {
                        const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
                        for (const file of commandFiles) {
                            const filePath = path.join(commandsPath, file);
                            delete require.cache[require.resolve(filePath)];
                        }
                    }
                }
                
                swept.push(`Command cache: ${commandCount} modules cleared`);
            }

            if (cacheType === 'gc' || cacheType === 'all') {
                if (global.gc) {
                    global.gc();
                    swept.push('Garbage collection: executed');
                } else {
                    swept.push('Garbage collection: not available (use --expose-gc flag)');
                }
            }

            const memAfter = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
            const memFreed = (memBefore - memAfter).toFixed(2);

            let content = `# 🧹 Cache Sweep Complete\n\n`;
            content += `### Operations\n`;
            content += swept.map(s => `> ${s}`).join('\n');
            content += `\n\n### Memory\n`;
            content += `> **Before:** ${memBefore}MB\n`;
            content += `> **After:** ${memAfter}MB\n`;
            if (memFreed > 0) content += `> **Freed:** ${memFreed}MB`;

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } catch (error) {
            const container = buildErrorResponse('Error', 'Failed to sweep cache.', error.message);
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
