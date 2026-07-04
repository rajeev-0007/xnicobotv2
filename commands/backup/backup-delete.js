'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionFlagsBits, MessageFlags
} = require('discord.js');
const { deleteBackup, listBackups } = require('../../utils/backupManager');
const { confirmAction } = require('../../utils/confirmAction');

const TIMEOUT = 30_000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backup-delete')
        .setDescription('Delete a server backup')
        .addStringOption(o => o.setName('backup').setDescription('Backup name to delete').setRequired(true).setAutocomplete(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    prefix: 'backup-delete',
    description: 'Delete a server backup with confirmation',
    usage: 'backup-delete <backup-name>',
    category: 'backup',
    aliases: ['bk-delete', 'deletebackup'],
    permissions: ['Administrator'],

    async autocomplete(interaction) {
        const backups = listBackups(interaction.guild.id);
        await interaction.respond(backups.map(b => ({ name: `${b.name} (${new Date(b.date).toLocaleDateString()})`, value: b.name })).slice(0, 25));
    },

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const name = interaction.options.getString('backup');
        try {
            const result = deleteBackup(interaction.guild.id, name);
            if (result.success) {
                return interaction.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Backup Deleted\n\nDeleted **\`${result.backupName}\`**.`))], flags: MessageFlags.IsComponentsV2 });
            }
            return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Delete Failed\n\n${result.error}`))], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            console.error('Error deleting backup:', err);
            return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Missing Permission\n\nYou need **Administrator** permission.'))], flags: MessageFlags.IsComponentsV2 });
        }

        const name = args[0];
        if (!name) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Invalid Usage\n\n**Usage:** `backup-delete <name>`\n\n> Use `backup-list` to see all backups.'))], flags: MessageFlags.IsComponentsV2 });
        }

        // Check exists
        const backups = listBackups(message.guild.id);
        const bk = backups.find(b => b.name === name);
        if (!bk) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Not Found\n\nNo backup named \`${name}\`.\n\n> Use \`backup-list\` to see available backups.`))], flags: MessageFlags.IsComponentsV2 });
        }

        const { confirmed, button } = await confirmAction(message, true, {
            title: 'Confirm Deletion',
            description:
                `Permanently delete backup **\`${name}\`**?\n` +
                `> <:Folderopen:1521227986966417642> ${bk.configCount} configs • <:Bookopen:1521227911137595605> ${new Date(bk.date).toLocaleDateString()}\n\n` +
                `-# This cannot be undone.`,
            confirmLabel: 'Yes, Delete',
        });
        if (!confirmed) return;

        try {
            const result = deleteBackup(message.guild.id, name);
            if (result.success) {
                await button.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Backup Deleted\n\nDeleted **\`${name}\`** successfully.`))], flags: MessageFlags.IsComponentsV2 });
            } else {
                await button.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Failed\n\n${result.error}`))], flags: MessageFlags.IsComponentsV2 });
            }
        } catch (err) {
            console.error('Error deleting backup:', err);
            await button.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
