'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionFlagsBits, MessageFlags
} = require('discord.js');
const { deleteServerBackup, listServerBackups } = require('../../utils/serverBackupManager');
const { confirmAction } = require('../../utils/confirmAction');

const TIMEOUT = 30_000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('server-backup-delete')
        .setDescription('Delete a server backup')
        .addStringOption(o => o.setName('backup').setDescription('Backup ID to delete').setRequired(true).setAutocomplete(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    prefix: 'server-backup-delete',
    description: 'Delete a server backup',
    usage: 'server-backup-delete <backup-id>',
    category: 'backup',
    aliases: ['sbk-delete', 'sbackup-delete'],
    permissions: ['Administrator'],

    async autocomplete(interaction) {
        const backups = await listServerBackups(interaction.user.id);
        await interaction.respond(backups.map(b => ({
            name: `${b.id} - ${b.serverName} (${new Date(b.createdAt).toLocaleDateString()})`,
            value: b.id
        })).slice(0, 25));
    },

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const backupId = interaction.options.getString('backup');
        try {
            const result = await deleteServerBackup(interaction.user.id, backupId);
            if (result.success) {
                return interaction.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Server Backup Deleted\n\n**<:Box:1521228152414666833>** \`${result.backupId}\` has been permanently removed.`))], flags: MessageFlags.IsComponentsV2 });
            }
            return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Delete Failed\n\n${result.error}`))], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            console.error('Error deleting server backup:', err);
            return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Missing Permission\n\nYou need **Administrator** permission.'))], flags: MessageFlags.IsComponentsV2 });
        }

        const backupId = args[0];
        if (!backupId) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Invalid Usage\n\n**Usage:** `server-backup-delete <backup-id>`'))], flags: MessageFlags.IsComponentsV2 });
        }

        // Look up backup details
        const uid = message.author.id;
        let backups;
        try { backups = await listServerBackups(uid); } catch { backups = []; }
        const bk = backups.find(b => b.id === backupId);

        const { confirmed, button } = await confirmAction(message, true, {
            title: 'Confirm Delete',
            description: `${info}\n\n> This is permanent and cannot be undone.`,
            confirmLabel: 'Yes, Delete',
        });
        if (!confirmed) return;

        try {
            const result = await deleteServerBackup(uid, backupId);
            if (result.success) {
                await button.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Server Backup Deleted\n\n**<:Box:1521228152414666833>** \`${result.backupId}\` removed.`))], flags: MessageFlags.IsComponentsV2 });
            } else {
                await button.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Failed\n\n${result.error}`))], flags: MessageFlags.IsComponentsV2 });
            }
        } catch (err) {
            console.error('Error deleting server backup:', err);
            await button.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
