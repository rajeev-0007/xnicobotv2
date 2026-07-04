'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
    PermissionFlagsBits, MessageFlags
} = require('discord.js');
const { listBackups, loadBackup, deleteBackup } = require('../../utils/backupManager');
const { buildExpiredPanel } = require('../../utils/responseBuilder');

const PER_PAGE = 5;
const TIMEOUT = 120_000;

/* ─── helpers ─── */
function errCtr(txt) {
    return new ContainerBuilder().setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> ${txt}`));
}
function okCtr(txt) {
    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Checkedbox:1521227734943269077> ${txt}`));
}
function fmtDate(d) {
    return new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ─── view: list page ─── */
function buildList(backups, guild, page, uid) {
    const total = Math.max(1, Math.ceil(backups.length / PER_PAGE));
    const pg = Math.max(0, Math.min(page, total - 1));
    const slice = backups.slice(pg * PER_PAGE, (pg + 1) * PER_PAGE);

    const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Box:1521228152414666833> Config Backups (${backups.length})`))
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: guild.iconURL({ dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png' } }));

    const lines = slice.map((b, i) => {
        const idx = pg * PER_PAGE + i + 1;
        return `**${idx}. \`${b.name}\`**\n> <:Bookopen:1521227911137595605> ${fmtDate(b.date)}\n> <:Folderopen:1521227986966417642> **${b.configCount}** config files`;
    }).join('\n\n');

    const ctr = new ContainerBuilder()
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines || 'No backups on this page.'));

    if (total > 1) {
        ctr.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Page ${pg + 1}/${total}`));
    }

    const nav = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bkp:prev:${uid}`).setEmoji('<:History:1521227863079256278>').setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(pg === 0),
        new ButtonBuilder().setCustomId(`bkp:next:${uid}`).setEmoji('<:Caretright:1521227704953864202>').setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(pg >= total - 1),
        new ButtonBuilder().setCustomId(`bkp:new:${uid}`).setEmoji('<:Add:1521227828199293152>').setLabel('Create Backup').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`bkp:refresh:${uid}`).setEmoji('<:History:1521227863079256278>').setStyle(ButtonStyle.Primary)
    );
    ctr.addActionRowComponents(nav);

    if (slice.length) {
        const opts = slice.map(b => ({ label: b.name.slice(0, 100), value: b.name, description: `<:Bookopen:1521227911137595605> ${fmtDate(b.date)} • ${b.configCount} files`, emoji: '<:Box:1521228152414666833>' }));
        ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder().setCustomId(`bkp:sel:${uid}`).setPlaceholder('Select a backup for details').addOptions(opts.slice(0, 25))
        ));
    }

    return { ctr, pg };
}

/* ─── view: detail ─── */
function buildDetail(backup, guild, uid) {
    const ctr = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Box:1521228152414666833> Backup Details\n\n` +
            `**<:Edit:1521227886634205298> Name:** \`${backup.name}\`\n` +
            `**<:Bookopen:1521227911137595605> Date:** ${fmtDate(backup.date)}\n` +
            `**<:Folderopen:1521227986966417642> Configs:** ${backup.configCount} files\n` +
            `**<:Timer:1521227971590095070> Timestamp:** \`${backup.timestamp}\``
        ));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bkp:load:${uid}:${backup.name}`).setEmoji('<:Download:1521228191899975810>').setLabel('Restore').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bkp:del:${uid}:${backup.name}`).setEmoji('<:Trash:1521227750420254820>').setLabel('Delete').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`bkp:back:${uid}`).setEmoji('<:History:1521227863079256278>').setLabel('Back to List').setStyle(ButtonStyle.Secondary)
    );
    ctr.addActionRowComponents(row);
    return ctr;
}

/* ─── view: confirm delete ─── */
function buildConfirmDel(name, uid) {
    const ctr = new ContainerBuilder().setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Infotriangle:1521227710381428926> Confirm Deletion\n\nPermanently delete backup **\`${name}\`**?\n\n-# This cannot be undone.`
        ));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bkp:cfDel:${uid}:${name}`).setEmoji('<:Trash:1521227750420254820>').setLabel('Yes, Delete').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`bkp:back:${uid}`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
    ctr.addActionRowComponents(row);
    return ctr;
}

/* ─── view: confirm load ─── */
function buildConfirmLoad(name, uid) {
    const ctr = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Infotriangle:1521227710381428926> Confirm Restore\n\n` +
            `Restore server config from backup **\`${name}\`**?\n\n` +
            `> This will **overwrite** current configurations with the backup data.\n\n` +
            `-# Make sure you have a current backup before proceeding.`
        ));
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bkp:cfLoad:${uid}:${name}`).setEmoji('<:Download:1521228191899975810>').setLabel('Yes, Restore').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`bkp:back:${uid}`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
    ctr.addActionRowComponents(row);
    return ctr;
}

/* ═══════════════════════════════════════════ */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('backup-list')
        .setDescription('List and manage server configuration backups')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    prefix: 'backup-list',
    description: 'List and manage server configuration backups',
    usage: 'backup-list',
    category: 'backup',
    aliases: ['bk-list', 'backups'],
    permissions: ['Administrator'],

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const backups = listBackups(interaction.guild.id);
        if (!backups.length) return interaction.editReply({ components: [errCtr('No Backups\n\nNo config backups found.\n\n> Use `backup-create` to create one!')], flags: MessageFlags.IsComponentsV2 });
        const uid = interaction.user.id;
        let page = 0;
        const { ctr } = buildList(backups, interaction.guild, page, uid);
        const msg = await interaction.editReply({ components: [ctr], flags: MessageFlags.IsComponentsV2 });
        this._collect(msg, interaction.guild, uid, page);
    },

    async executePrefix(message) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ components: [errCtr('Missing Permission\n\nYou need **Administrator** permission.')], flags: MessageFlags.IsComponentsV2 });
        }
        const backups = listBackups(message.guild.id);
        if (!backups.length) return message.reply({ components: [errCtr('No Backups\n\nNo config backups found.\n\n> Use `backup-create` to create one!')], flags: MessageFlags.IsComponentsV2 });
        const uid = message.author.id;
        let page = 0;
        const { ctr } = buildList(backups, message.guild, page, uid);
        const sent = await message.reply({ components: [ctr], flags: MessageFlags.IsComponentsV2 });
        this._collect(sent, message.guild, uid, page);
    },

    _collect(sent, guild, uid, startPage) {
        let page = startPage;
        const collector = sent.createMessageComponentCollector({ time: TIMEOUT });

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) return i.reply({ content: '<:Cancel:1521227723916181644> Only the command invoker can use these controls.', flags: MessageFlags.Ephemeral });

            const parts = i.customId.split(':');
            const action = parts[1];
            const extra = parts.slice(3).join(':');

            try {
                if (action === 'prev') { page = Math.max(0, page - 1); const b = listBackups(guild.id); const { ctr: c } = buildList(b, guild, page, uid); return i.update({ components: [c], flags: MessageFlags.IsComponentsV2 }); }
                if (action === 'next') { page++; const b = listBackups(guild.id); const r = buildList(b, guild, page, uid); page = r.pg; return i.update({ components: [r.ctr], flags: MessageFlags.IsComponentsV2 }); }
                if (action === 'refresh') { const b = listBackups(guild.id); if (!b.length) return i.update({ components: [errCtr('No Backups\n\nAll backups have been deleted.')], flags: MessageFlags.IsComponentsV2 }); const { ctr: c } = buildList(b, guild, page, uid); return i.update({ components: [c], flags: MessageFlags.IsComponentsV2 }); }
                if (action === 'back') { const b = listBackups(guild.id); if (!b.length) return i.update({ components: [errCtr('No Backups\n\nAll backups have been deleted.')], flags: MessageFlags.IsComponentsV2 }); const { ctr: c } = buildList(b, guild, page, uid); return i.update({ components: [c], flags: MessageFlags.IsComponentsV2 }); }

                if (action === 'sel' && i.isStringSelectMenu()) {
                    const name = i.values[0];
                    const b = listBackups(guild.id);
                    const bk = b.find(x => x.name === name);
                    if (!bk) return i.update({ components: [errCtr('Backup no longer exists.')], flags: MessageFlags.IsComponentsV2 });
                    return i.update({ components: [buildDetail(bk, guild, uid)], flags: MessageFlags.IsComponentsV2 });
                }

                if (action === 'del') return i.update({ components: [buildConfirmDel(extra, uid)], flags: MessageFlags.IsComponentsV2 });
                if (action === 'load') return i.update({ components: [buildConfirmLoad(extra, uid)], flags: MessageFlags.IsComponentsV2 });

                if (action === 'cfDel') {
                    const result = deleteBackup(guild.id, extra);
                    if (result.success) {
                        const c = okCtr(`Backup Deleted\n\nDeleted **\`${extra}\`** successfully.`);
                        c.addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`bkp:back:${uid}`).setEmoji('<:History:1521227863079256278>').setLabel('Back to List').setStyle(ButtonStyle.Secondary)));
                        return i.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
                    }
                    return i.update({ components: [errCtr(`Delete Failed\n\n${result.error}`)], flags: MessageFlags.IsComponentsV2 });
                }

                if (action === 'cfLoad') {
                    const result = loadBackup(guild.id, extra);
                    if (result.success) {
                        const c = okCtr(`Backup Restored\n\nRestored **\`${result.backupName}\`** — **${result.restoredCount}** configs updated.`);
                        c.addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`bkp:back:${uid}`).setEmoji('<:History:1521227863079256278>').setLabel('Back to List').setStyle(ButtonStyle.Secondary)));
                        return i.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
                    }
                    return i.update({ components: [errCtr(`Restore Failed\n\n${result.error}`)], flags: MessageFlags.IsComponentsV2 });
                }

                /* ── CREATE from list ── */
                if (action === 'new') {
                    const { createBackup } = require('../../utils/backupManager');
                    const result = createBackup(guild.id);
                    if (result.success) {
                        const c = okCtr(`Backup Created\n\n**<:Box:1521228152414666833>** \`${result.backupName}\`\n**<:Folderopen:1521227986966417642>** ${result.configCount} configs saved`);
                        c.addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`bkp:back:${uid}`).setEmoji('<:History:1521227863079256278>').setLabel('Back to List').setStyle(ButtonStyle.Secondary)));
                        return i.update({ components: [c], flags: MessageFlags.IsComponentsV2 });
                    }
                    return i.update({ components: [errCtr('Backup Failed\n\nFailed to create backup.')], flags: MessageFlags.IsComponentsV2 });
                }

            } catch (err) {
                console.error('Backup list interaction error:', err);
                if (!i.replied && !i.deferred) await i.reply({ content: '<:Cancel:1521227723916181644> An error occurred.', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        });

        collector.on('end', () => {
            sent.edit({ components: [buildExpiredPanel('backup-list')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        });
    }
};
