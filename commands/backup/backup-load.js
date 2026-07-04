'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionFlagsBits, MessageFlags
} = require('discord.js');
const { loadBackup, listBackups } = require('../../utils/backupManager');
const { buildExpiredPanel } = require('../../utils/responseBuilder');

const TIMEOUT = 30_000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backup-load')
        .setDescription('Restore server configuration from a backup')
        .addStringOption(o => o.setName('backup').setDescription('Backup name to restore').setRequired(true).setAutocomplete(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    prefix: 'backup-load',
    description: 'Restore server configuration from a backup',
    usage: 'backup-load <backup-name>',
    category: 'backup',
    aliases: ['bk-load', 'loadbackup', 'backup-restore'],
    permissions: ['Administrator'],

    async autocomplete(interaction) {
        const backups = listBackups(interaction.guild.id);
        await interaction.respond(backups.map(b => ({ name: `${b.name} (${new Date(b.date).toLocaleDateString()})`, value: b.name })).slice(0, 25));
    },

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const name = interaction.options.getString('backup');
        try {
            const result = loadBackup(interaction.guild.id, name);
            if (result.success) {
                return interaction.editReply({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Backup Restored\n\n**<:Box:1521228152414666833>** \`${result.backupName}\`\n**<:Folderopen:1521227986966417642>** ${result.restoredCount} configs restored`))], flags: MessageFlags.IsComponentsV2 });
            }
            return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Restore Failed\n\n${result.error}`))], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            console.error('Error loading backup:', err);
            return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Missing Permission\n\nYou need **Administrator** permission.'))], flags: MessageFlags.IsComponentsV2 });
        }

        const name = args[0];
        if (!name) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Invalid Usage\n\n**Usage:** `backup-load <name>`\n\n> Use `backup-list` to see all backups.'))], flags: MessageFlags.IsComponentsV2 });
        }

        const backups = listBackups(message.guild.id);
        const bk = backups.find(b => b.name === name);
        if (!bk) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Not Found\n\nNo backup named \`${name}\`.`))], flags: MessageFlags.IsComponentsV2 });
        }

        const uid = message.author.id;
        const sid = `${uid}_${Date.now().toString(36)}`;

        const ctr = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Infotriangle:1521227710381428926> Confirm Restore\n\n` +
                `Restore config from backup **\`${name}\`**?\n`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `**<:Folderopen:1521227986966417642> Configs:** ${bk.configCount} files\n` +
                `**<:Bookopen:1521227911137595605> Date:** ${new Date(bk.date).toLocaleDateString()}\n\n` +
                `> <:Infotriangle:1521227710381428926> This will **overwrite** current configurations with backup data.\n> Create a new backup first if you want to keep current settings.`
            ));

        ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bkld:confirm:${sid}`).setEmoji('<:Download:1521228191899975810>').setLabel('Yes, Restore').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`bkld:cancel:${sid}`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        ));

        const sent = await message.reply({ components: [ctr], flags: MessageFlags.IsComponentsV2 });
        const collector = sent.createMessageComponentCollector({ time: TIMEOUT });

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) return i.reply({ content: '<:Cancel:1521227723916181644> Only the command invoker can use this.', flags: MessageFlags.Ephemeral });
            collector.stop('handled');

            if (i.customId.split(':')[1] === 'confirm') {
                try {
                    const result = loadBackup(message.guild.id, name);
                    if (result.success) {
                        return i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> Backup Restored\n\n**<:Box:1521228152414666833>** \`${result.backupName}\`\n**<:Folderopen:1521227986966417642>** ${result.restoredCount} configs updated\n\n> All systems have been refreshed with backup data.`))], flags: MessageFlags.IsComponentsV2 });
                    }
                    return i.update({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Restore Failed\n\n${result.error}`))], flags: MessageFlags.IsComponentsV2 });
                } catch (err) {
                    console.error('Error loading backup:', err);
                    return i.update({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 });
                }
            }
            return i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Cancelled. No changes were made.'))], flags: MessageFlags.IsComponentsV2 });
        });

        collector.on('end', (_, reason) => {
            if (reason === 'handled') return;
            sent.edit({ components: [buildExpiredPanel('backup-load', 'No changes were made.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        });
    }
};
