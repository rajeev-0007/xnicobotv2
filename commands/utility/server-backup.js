const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const jsonStore = require('../../utils/jsonStore');

const BACKUP_MODULES = ['welcomer', 'automod', 'tickets', 'verification', 'autoreact', 'autoresponder', 'reactionroles', 'economy-settings', 'levelroles', 'button-commands', 'select-menus', 'logging', 'starboard', 'suggestions', 'join2create', 'media-only', 'sticky', 'bot-customize'];

module.exports = {
    data: null, // Custom handler

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('<:Cancel:1521227723916181644> You need Administrator permission to use this command!');
        }

        const action = args[0]?.toLowerCase();

        if (!action) {
            return message.reply({
                content: `**Server Backup System**\n\n\`-server-backup list\` - List all backups\n\`-server-backup create <name>\` - Create a new backup\n\`-server-backup restore\` - Interactive restoration menu\n\`-server-backup delete <id>\` - Delete a backup`
            });
        }

        const guildId = message.guild.id;

        if (action === 'create') {
            const name = args.slice(1).join(' ') || `Backup ${new Date().toLocaleDateString()}`;
            const backupData = {};
            
            for (const mod of BACKUP_MODULES) {
                const storeData = jsonStore.read(mod);
                if (storeData && storeData[guildId]) {
                    backupData[mod] = storeData[guildId];
                }
            }

            const payload = JSON.stringify(backupData);
            const sizeKb = Math.max(1, Math.round(payload.length / 1024));

            const backupObj = {
                id: Math.random().toString(36).substring(2, 10),
                guildId,
                name,
                createdAt: Date.now(),
                size: `${sizeKb} KB`,
                modules: Object.keys(backupData),
                data: backupData
            };

            let allBackups = jsonStore.read('server_backups') || [];
            if (!Array.isArray(allBackups)) allBackups = [];
            allBackups.unshift(backupObj);
            
            const guildBackups = allBackups.filter(b => b.guildId === guildId || b.guild_id === guildId);
            if (guildBackups.length > 10) {
                const toKeep = new Set(guildBackups.slice(0, 10).map(b => b.id || b.backup_id));
                allBackups = allBackups.filter(b => (b.guildId !== guildId && b.guild_id !== guildId) || toKeep.has(b.id || b.backup_id));
            }

            jsonStore.write('server_backups', allBackups);
            return message.reply(`<:Check:1521227732418043916> Backup **${name}** created successfully! ID: \`${backupObj.id}\``);
        }

        if (action === 'list') {
            const data = jsonStore.read('server_backups') || [];
            const guildBackups = (Array.isArray(data) ? data : [])
                .filter(b => b.guildId === guildId || b.guild_id === guildId)
                .slice(0, 10);
            
            if (!guildBackups.length) {
                return message.reply('No backups found for this server.');
            }

            let msg = '**Server Backups**\n\n';
            guildBackups.forEach((b, i) => {
                const date = new Date(b.createdAt || b.created_at || Date.now()).toLocaleDateString();
                msg += `**${i+1}.** ${b.name || b.guild_name} (ID: \`${b.id || b.backup_id}\`)\n└ Size: ${b.size || '—'} | Date: ${date} | Modules: ${b.modules?.length || 0}\n\n`;
            });

            return message.reply({ content: msg });
        }

        if (action === 'delete') {
            const id = args[1];
            if (!id) return message.reply('Please provide a backup ID to delete.');

            let allBackups = jsonStore.read('server_backups') || [];
            const initialLength = allBackups.length;
            allBackups = allBackups.filter(b => b.id !== id && b.backup_id !== id);

            if (allBackups.length === initialLength) {
                return message.reply('<:Cancel:1521227723916181644> Backup not found!');
            }

            jsonStore.write('server_backups', allBackups);
            return message.reply('<:Check:1521227732418043916> Backup deleted successfully!');
        }

        if (action === 'restore') {
            const data = jsonStore.read('server_backups') || [];
            const guildBackups = (Array.isArray(data) ? data : [])
                .filter(b => b.guildId === guildId || b.guild_id === guildId)
                .slice(0, 10);
            
            if (!guildBackups.length) {
                return message.reply('No backups found for this server. Use `-server-backup create` to make one or upload one via the dashboard!');
            }

            const row = new ActionRowBuilder()
                .addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId('restore_backup_select')
                        .setPlaceholder('Select a backup to restore')
                        .addOptions(
                            guildBackups.map(b => {
                                const date = new Date(b.createdAt || b.created_at || Date.now()).toLocaleDateString();
                                return new StringSelectMenuOptionBuilder()
                                    .setLabel(b.name ? b.name.substring(0, 50) : 'Imported Backup')
                                    .setDescription(`ID: ${b.id || b.backup_id} - ${b.size || '—'} - ${date}`)
                                    .setValue(b.id || b.backup_id);
                            })
                        )
                );

            const msg = await message.reply({ 
                content: 'Please select a backup from the dropdown below to restore:', 
                components: [row] 
            });

            const filter = i => i.customId === 'restore_backup_select' && i.user.id === message.author.id;
            try {
                const selection = await msg.awaitMessageComponent({ filter, time: 60000 });
                const selectedBackupId = selection.values[0];
                const selectedBackup = guildBackups.find(b => (b.id || b.backup_id) === selectedBackupId);

                const moduleKeys = Object.keys(selectedBackup.data || {}).filter(k => BACKUP_MODULES.includes(k));
                
                if (moduleKeys.length === 0) {
                    return selection.update({ content: 'This backup contains no valid modules to restore.', components: [] });
                }

                const modRow = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('restore_module_select')
                            .setPlaceholder('Select modules to restore')
                            .setMinValues(1)
                            .setMaxValues(Math.min(moduleKeys.length, 25))
                            .addOptions(
                                moduleKeys.slice(0, 25).map(k => new StringSelectMenuOptionBuilder().setLabel(k).setValue(k))
                            )
                    );

                await selection.update({ 
                    content: `**Backup Selected**: ${selectedBackup.name || selectedBackupId}\n\nPlease select the specific modules you wish to restore from this backup.\n*Note: If this backup is from a different server, you may need to re-select channels and roles on the dashboard afterwards.*`,
                    components: [modRow]
                });

                const modFilter = i => i.customId === 'restore_module_select' && i.user.id === message.author.id;
                const modSelection = await msg.awaitMessageComponent({ filter: modFilter, time: 60000 });
                
                const selectedModules = modSelection.values;
                
                for (const mod of selectedModules) {
                    const currentStore = jsonStore.read(mod) || {};
                    currentStore[guildId] = selectedBackup.data[mod];
                    jsonStore.write(mod, currentStore);
                }

                await modSelection.update({ content: `<:Check:1521227732418043916> Successfully restored **${selectedModules.length}** modules from backup \`${selectedBackupId}\`!`, components: [] });

            } catch (err) {
                if (msg.editable) {
                    await msg.edit({ content: 'Backup restoration timed out or cancelled.', components: [] });
                }
            }
        }
    }
};
