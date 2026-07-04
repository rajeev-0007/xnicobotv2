
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require('discord.js');
const { db } = require('../../utils/database');
const fs = require('fs');
const path = require('path');
const jsonStore = require('../../utils/jsonStore');

module.exports = {
    data: null,

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('<:Cancel:1521227723916181644> You need Administrator permission to use this command!');
        }

        const action = args[0]?.toLowerCase();
        const backupName = args[1];
        const configType = args[2]?.toLowerCase();

        if (!action) {
            const helpContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Desktop:1521227927209902190> Config Backup System

**Available Commands:**

\`-config-backup save <name> <type>\` - Save a configuration
\`-config-backup load <name>\` - Restore a configuration
\`-config-backup list\` - List all your backups
\`-config-backup delete <name>\` - Delete a backup
\`-config-backup info <name>\` - View backup details

**Supported Types:**
• \`embed\` - Embed builder configurations
• \`welcomer\` - Welcomer settings
• \`sticky\` - Sticky message settings
• \`autoresponder\` - Auto-responder configurations
• \`autoreact\` - Auto-react configurations
• \`automod\` - Auto-moderation settings
• \`antinuke\` - Anti-nuke protection settings
• \`musicpanel\` - Music panel setup
• \`ticket\` - Ticket system configuration
• \`verification\` - Verification system settings
• \`levelroles\` - Level roles configuration
• \`logs\` - Logging configuration

**Examples:**
\`-config-backup save my-welcome welcomer\`
\`-config-backup save my-embed embed\`
\`-config-backup load my-welcome\`
\`-config-backup list\``)
                );

            return message.reply({ components: [helpContainer], flags: MessageFlags.IsComponentsV2 });
        }

        if (action === 'save') {
            if (!backupName || !configType) {
                return message.reply('<:Cancel:1521227723916181644> Usage: `-config-backup save <name> <type>`');
            }

            const validTypes = ['embed', 'welcomer', 'sticky', 'autoresponder', 'autoreact', 'automod', 'antinuke', 'musicpanel', 'ticket', 'verification', 'levelroles', 'logs'];
            if (!validTypes.includes(configType)) {
                return message.reply(`<:Cancel:1521227723916181644> Invalid type! Valid types: ${validTypes.join(', ')}`);
            }

            try {
                let configData = null;
                let configPath = '';

                // Get configuration based on type
                switch (configType) {
                    case 'embed':
                        // Embed data is stored in database
                        const embedKeys = await db.list(`${message.guild.id}_embed_`);
                        configData = {};
                        for (const key of embedKeys) {
                            configData[key] = await db.get(key);
                        }
                        break;

                    case 'welcomer':
                        {
                            const allConfig = jsonStore.read('welcomer');
                            configData = allConfig[message.guild.id];
                        }
                        break;

                    case 'sticky':
                        {
                            const allConfig = jsonStore.read('sticky');
                            configData = allConfig[message.guild.id];
                        }
                        break;

                    case 'autoresponder':
                        {
                            const allConfig = jsonStore.read('autoresponder');
                            configData = allConfig[message.guild.id];
                        }
                        break;

                    case 'autoreact':
                        {
                            const allConfig = jsonStore.read('autoreact');
                            configData = allConfig[message.guild.id];
                        }
                        break;

                    case 'automod':
                        {
                            const allConfig = jsonStore.read('automod');
                            configData = allConfig[message.guild.id];
                        }
                        break;

                    case 'antinuke':
                        {
                            const allConfig = jsonStore.read('antinuke');
                            configData = allConfig[message.guild.id];
                        }
                        break;

                    case 'musicpanel':
                        {
                            const allConfig = jsonStore.read('musicpanel');
                            configData = allConfig[message.guild.id];
                        }
                        break;

                    case 'ticket':
                        {
                            const allConfig = jsonStore.read('tickets');
                            configData = allConfig[message.guild.id];
                        }
                        break;

                    case 'verification':
                        {
                            const allConfig = jsonStore.read('verification');
                            configData = allConfig[message.guild.id];
                        }
                        break;

                    case 'levelroles':
                        {
                            const allConfig = jsonStore.read('levelroles');
                            configData = allConfig[message.guild.id];
                        }
                        break;

                    case 'logs':
                        {
                            const allConfig = jsonStore.read('logs');
                            configData = allConfig[message.guild.id];
                        }
                        break;
                }

                if (!configData || (typeof configData === 'object' && Object.keys(configData).length === 0)) {
                    return message.reply(`<:Cancel:1521227723916181644> No ${configType} configuration found for this server!`);
                }

                // Save backup to database
                const backupKey = `${message.guild.id}_backup_${backupName}`;
                const backupData = {
                    name: backupName,
                    type: configType,
                    data: configData,
                    createdBy: message.author.id,
                    createdAt: Date.now(),
                    guildId: message.guild.id,
                    guildName: message.guild.name
                };

                await db.set(backupKey, backupData);

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(`# <:Checkedbox:1521227734943269077> Configuration Saved!

**Backup Name:** ${backupName}
**Type:** ${configType}
**Created By:** ${message.author}
**Timestamp:** <t:${Math.floor(Date.now() / 1000)}:F>

Your configuration has been backed up successfully!
Use \`-config-backup load ${backupName}\` to restore it.`)
                    );

                await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

            } catch (error) {
                console.error('Config Backup Save Error:', error);
                return message.reply('<:Cancel:1521227723916181644> Failed to save configuration backup!');
            }
        }

        else if (action === 'load') {
            if (!backupName) {
                return message.reply('<:Cancel:1521227723916181644> Usage: `-config-backup load <name>`');
            }

            try {
                const backupKey = `${message.guild.id}_backup_${backupName}`;
                const backupData = await db.get(backupKey);

                if (!backupData) {
                    return message.reply(`<:Cancel:1521227723916181644> No backup found with name: **${backupName}**`);
                }

                // Restore configuration based on type
                const configType = backupData.type;
                let configPath = '';

                switch (configType) {
                    case 'embed':
                        // Restore embed data to database
                        for (const [key, value] of Object.entries(backupData.data)) {
                            await db.set(key, value);
                        }
                        break;

                    case 'welcomer':
                        {
                            let welcomerConfig = jsonStore.read('welcomer');
                            welcomerConfig[message.guild.id] = backupData.data;
                            jsonStore.write('welcomer', welcomerConfig);
                        }
                        break;

                    case 'sticky':
                        {
                            let stickyConfig = jsonStore.read('sticky');
                            stickyConfig[message.guild.id] = backupData.data;
                            jsonStore.write('sticky', stickyConfig);
                        }
                        break;

                    case 'autoresponder':
                        {
                            let autoresponderConfig = jsonStore.read('autoresponder');
                            autoresponderConfig[message.guild.id] = backupData.data;
                            jsonStore.write('autoresponder', autoresponderConfig);
                            if (global.updateAutoresponderCache) {
                                global.updateAutoresponderCache(message.guild.id, backupData.data);
                            }
                        }
                        break;

                    case 'autoreact':
                        {
                            let autoreactConfig = jsonStore.read('autoreact');
                            autoreactConfig[message.guild.id] = backupData.data;
                            jsonStore.write('autoreact', autoreactConfig);
                            if (global.updateAutoreactCache) {
                                global.updateAutoreactCache(message.guild.id, backupData.data);
                            }
                        }
                        break;

                    case 'automod':
                        {
                            let automodConfig = jsonStore.read('automod');
                            automodConfig[message.guild.id] = backupData.data;
                            jsonStore.write('automod', automodConfig);
                            if (global.updateAutomodCache) {
                                global.updateAutomodCache(message.guild.id, backupData.data);
                            }
                        }
                        break;

                    case 'antinuke':
                        {
                            let antinukeConfig = jsonStore.read('antinuke');
                            antinukeConfig[message.guild.id] = backupData.data;
                            jsonStore.write('antinuke', antinukeConfig);
                            if (global.updateAntinukeCache) {
                                global.updateAntinukeCache(message.guild.id, backupData.data);
                            }
                        }
                        break;

                    case 'musicpanel':
                    case 'ticket':
                    case 'verification':
                    case 'levelroles':
                    case 'logs':
                        {
                            const configStoreMap = {
                                'musicpanel': 'musicpanel',
                                'ticket': 'tickets',
                                'verification': 'verification',
                                'levelroles': 'levelroles',
                                'logs': 'logs'
                            };
                            const storeName = configStoreMap[configType];
                            let genericConfig = jsonStore.read(storeName);
                            genericConfig[message.guild.id] = backupData.data;
                            jsonStore.write(storeName, genericConfig);
                        }
                        break;
                }

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(`# <:Checkedbox:1521227734943269077> Configuration Restored!

**Backup Name:** ${backupName}
**Type:** ${configType}
**Originally Created:** <t:${Math.floor(backupData.createdAt / 1000)}:F>
**Created By:** <@${backupData.createdBy}>

Your configuration has been successfully restored!`)
                    );

                await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

            } catch (error) {
                console.error('Config Backup Load Error:', error);
                return message.reply('<:Cancel:1521227723916181644> Failed to restore configuration backup!');
            }
        }

        else if (action === 'list') {
            try {
                const backupKeys = await db.list(`${message.guild.id}_backup_`);

                if (backupKeys.length === 0) {
                    return message.reply('<:Cancel:1521227723916181644> No configuration backups found for this server!');
                }

                let backupList = '# <:Desktop:1521227927209902190> Configuration Backups\n\n';
                for (const key of backupKeys) {
                    const backup = await db.get(key);
                    if (backup) {
                        backupList += `**${backup.name}**\n`;
                        backupList += `└ Type: ${backup.type}\n`;
                        backupList += `└ Created: <t:${Math.floor(backup.createdAt / 1000)}:R> by <@${backup.createdBy}>\n\n`;
                    }
                }

                backupList += `\n**Total Backups:** ${backupKeys.length}\n\nUse \`-config-backup info <name>\` for details`;

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(backupList)
                    );

                await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

            } catch (error) {
                console.error('Config Backup List Error:', error);
                return message.reply('<:Cancel:1521227723916181644> Failed to list configuration backups!');
            }
        }

        else if (action === 'delete') {
            if (!backupName) {
                return message.reply('<:Cancel:1521227723916181644> Usage: `-config-backup delete <name>`');
            }

            try {
                const backupKey = `${message.guild.id}_backup_${backupName}`;
                const backupData = await db.get(backupKey);

                if (!backupData) {
                    return message.reply(`<:Cancel:1521227723916181644> No backup found with name: **${backupName}**`);
                }

                await db.delete(backupKey);

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(`# <:Checkedbox:1521227734943269077> Backup Deleted!

**Backup Name:** ${backupName}
**Type:** ${backupData.type}

The backup has been permanently deleted.`)
                    );

                await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

            } catch (error) {
                console.error('Config Backup Delete Error:', error);
                return message.reply('<:Cancel:1521227723916181644> Failed to delete configuration backup!');
            }
        }

        else if (action === 'info') {
            if (!backupName) {
                return message.reply('<:Cancel:1521227723916181644> Usage: `-config-backup info <name>`');
            }

            try {
                const backupKey = `${message.guild.id}_backup_${backupName}`;
                const backupData = await db.get(backupKey);

                if (!backupData) {
                    return message.reply(`<:Cancel:1521227723916181644> No backup found with name: **${backupName}**`);
                }

                const dataSize = JSON.stringify(backupData.data).length;
                const dataKeys = typeof backupData.data === 'object' ? Object.keys(backupData.data).length : 0;

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(`# <:Desktop:1521227927209902190> Backup Information

**Name:** ${backupData.name}
**Type:** ${backupData.type}
**Created By:** <@${backupData.createdBy}>
**Created At:** <t:${Math.floor(backupData.createdAt / 1000)}:F>
**Server:** ${backupData.guildName}

**Data Size:** ${(dataSize / 1024).toFixed(2)} KB
**Configuration Items:** ${dataKeys}

Use \`-config-backup load ${backupName}\` to restore this backup.`)
                    );

                await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

            } catch (error) {
                console.error('Config Backup Info Error:', error);
                return message.reply('<:Cancel:1521227723916181644> Failed to get backup information!');
            }
        }

        else {
            return message.reply('<:Cancel:1521227723916181644> Invalid action! Use: save, load, list, delete, or info');
        }
    }
};
