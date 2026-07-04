'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionFlagsBits, MessageFlags
} = require('discord.js');
const { createBackup } = require('../../utils/backupManager');
const { buildExpiredPanel } = require('../../utils/responseBuilder');

const TIMEOUT = 30_000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backup-create')
        .setDescription('Create a backup of all server configurations')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    prefix: 'backup-create',
    description: 'Create a backup of all server configurations',
    usage: 'backup-create',
    category: 'backup',
    aliases: ['bk-create', 'createbackup'],
    permissions: ['Administrator'],

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const result = createBackup(interaction.guild.id);
            if (result.success) {
                const ctr = new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Backup Created\n\n` +
                        `**<:Box:1521228152414666833> Name:** \`${result.backupName}\`\n` +
                        `**<:Folderopen:1521227986966417642> Configs:** ${result.configCount} files saved\n` +
                        `**<:Timer:1521227971590095070> Timestamp:** ${result.timestamp}\n\n` +
                        `> Use \`backup-list\` to manage your backups.`
                    ));
                return interaction.editReply({ components: [ctr], flags: MessageFlags.IsComponentsV2 });
            }
            return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Backup Failed\n\nFailed to create backup.'))], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            console.error('Error creating backup:', err);
            return interaction.editReply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Missing Permission\n\nYou need **Administrator** permission.'))], flags: MessageFlags.IsComponentsV2 });
        }

        const uid = message.author.id;
        const sid = `${uid}_${Date.now().toString(36)}`;

        const ctr = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Box:1521228152414666833> Create Config Backup\n\n` +
                `This will save all current server configurations (welcomer, tickets, automod, etc.) to a backup file.\n`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `-# Backups can be restored later with \`backup-load\`.`
            ));

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`bkcr:confirm:${sid}`).setLabel('Create Backup').setEmoji('<:Box:1521228152414666833>').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`bkcr:cancel:${sid}`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );
        ctr.addActionRowComponents(row);

        const sent = await message.reply({ components: [ctr], flags: MessageFlags.IsComponentsV2 });
        const collector = sent.createMessageComponentCollector({ time: TIMEOUT });

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) return i.reply({ content: '<:Cancel:1521227723916181644> Only the command invoker can use this.', flags: MessageFlags.Ephemeral });
            collector.stop('handled');

            if (i.customId.split(':')[1] === 'confirm') {
                try {
                    const result = createBackup(message.guild.id);
                    if (result.success) {
                        const ok = new ContainerBuilder()
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                                `# <:Checkedbox:1521227734943269077> Backup Created\n\n` +
                                `**<:Box:1521228152414666833> Name:** \`${result.backupName}\`\n` +
                                `**<:Folderopen:1521227986966417642> Configs:** ${result.configCount} files saved\n` +
                                `**<:Timer:1521227971590095070> Timestamp:** ${result.timestamp}`
                            ));
                        ok.addActionRowComponents(new ActionRowBuilder().addComponents(
                            new ButtonBuilder().setCustomId(`bkcr:done:${sid}`).setEmoji('<:Checkedbox:1521227734943269077>').setLabel('Done').setStyle(ButtonStyle.Secondary)
                        ));
                        return i.update({ components: [ok], flags: MessageFlags.IsComponentsV2 });
                    }
                    return i.update({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Backup Failed'))], flags: MessageFlags.IsComponentsV2 });
                } catch (err) {
                    console.error('Error creating backup:', err);
                    return i.update({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 });
                }
            }

            return i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Cancelled.'))], flags: MessageFlags.IsComponentsV2 });
        });

        collector.on('end', (_, reason) => {
            if (reason === 'handled') return;
            sent.edit({ components: [buildExpiredPanel('backup-create')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        });
    }
};
