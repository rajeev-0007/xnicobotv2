'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    PermissionFlagsBits, MessageFlags, ChannelType, OverwriteType
} = require('discord.js');
const { loadServerBackup, listServerBackups } = require('../../utils/serverBackupManager');
const { buildExpiredPanel } = require('../../utils/responseBuilder');

const TIMEOUT = 30_000;
const CONTROL_TIMEOUT = 30 * 60 * 1000;

function makeProgressBar(percent, width = 20) {
    const clamped = Math.max(0, Math.min(100, Math.round(percent || 0)));
    const filled = Math.round((clamped / 100) * width);
    return `[${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}] ${clamped}%`;
}

function buildRestoreSuccessCard(r) {
    const ok = new ContainerBuilder();
    ok.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Checkedbox:1521227734943269077> Server Restored\n\n` +
        `**<:Box:1521228152414666833> Backup:** \`${r.backupId}\`\n**<:Bookopen:1521227911137595605> From:** ${r.originalServerName}\n`
    ));
    ok.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    ok.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `**<:Trash:1521227750420254820> Deleted:**\n> <:User:1521227714227343380> ${r.stats.rolesDeleted} roles · <:Folderopen:1521227986966417642> ${r.stats.categoriesDeleted} cats · <:Edit:1521227886634205298> ${r.stats.channelsDeleted} ch\n\n` +
        `**<:Checkedbox:1521227734943269077> Created:**\n> <:User:1521227714227343380> ${r.stats.rolesCreated} roles · <:Folderopen:1521227986966417642> ${r.stats.categoriesCreated} cats · <:Edit:1521227886634205298> ${r.stats.channelsCreated} ch\n\n` +
        `**<:Hashtag:1521227771957870604> Messages:** ${r.includesMessages ? `${r.stats.messagesRestored} restored` : 'Not in backup'}` +
        (r.stats.configsRestored > 0 ? `\n**<:bots:1521227848101396610> Bot Configs:** ${r.stats.configsRestored} restored` : '')
    ));
    return ok;
}

function buildRestoreRunningCard(backupId, sid, job) {
    const stateText = job.stopped ? 'Stopping…' : (job.paused ? 'Paused' : 'Running');
    const ctr = new ContainerBuilder();
    ctr.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Lightning:1521227915537285150> Restoring Server…\n\n` +
        `**Backup:** \`${backupId}\`\n` +
        `**Status:** ${stateText}\n` +
        `**Stage:** ${job.stage}\n` +
        `${job.details ? `**Details:** ${job.details}\n` : ''}` +
        `**Progress:** ${makeProgressBar(job.percent)}\n` +
        `-# ${job.current}/${job.total} steps`
    ));
    ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`sbkrun:toggle:${sid}`)
            .setLabel(job.paused ? 'Resume' : 'Pause')
            .setStyle(job.paused ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setDisabled(job.stopped || job.done),
        new ButtonBuilder()
            .setCustomId(`sbkrun:status:${sid}`)
            .setLabel('Status')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(job.done),
        new ButtonBuilder()
            .setCustomId(`sbkrun:stop:${sid}`)
            .setLabel(job.stopped ? 'Stopping…' : 'Stop')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(job.stopped || job.done)
    ));
    return ctr;
}

function buildRestoreStoppedCard(backupId, stats) {
    return new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Infotriangle:1521227710381428926> Restore Stopped\n\n` +
        `Backup \`${backupId}\` was stopped before completion.\n\n` +
        `**Partial progress:**\n` +
        `> Deleted: ${stats.rolesDeleted} roles · ${stats.categoriesDeleted} cats · ${stats.channelsDeleted} ch\n` +
        `> Created: ${stats.rolesCreated} roles · ${stats.categoriesCreated} cats · ${stats.channelsCreated} ch\n` +
        `> Messages restored: ${stats.messagesRestored}`
    ));
}

async function runRestoreWithControls(sent, guild, backupId, secureToken, uid) {
    const sid = `${uid}_${Date.now().toString(36)}_run`;
    const job = {
        stage: 'Preparing',
        details: 'Creating status channel',
        current: 0,
        total: 1,
        percent: 0,
        paused: false,
        stopped: false,
        done: false
    };

    // ── Create a dedicated status channel that survives the restore ──
    let statusChannel;
    try {
        statusChannel = await guild.channels.create({
            name: '━restore-status',
            type: ChannelType.GuildText,
            topic: `<:Box:1521228152414666833> Backup restore in progress • Backup: ${backupId} • Started by: <@${uid}>`,
            permissionOverwrites: [
                {
                    id: guild.id, // @everyone
                    type: OverwriteType.Role,
                    deny: ['SendMessages', 'CreatePublicThreads'],
                    allow: ['ViewChannel', 'ReadMessageHistory']
                },
                {
                    id: guild.members.me.id, // Bot
                    type: OverwriteType.Member,
                    allow: ['SendMessages', 'ViewChannel', 'ManageMessages', 'EmbedLinks']
                },
                {
                    id: uid, // Command invoker
                    type: OverwriteType.Member,
                    allow: ['ViewChannel', 'ReadMessageHistory']
                }
            ],
            reason: `Server backup restore – status channel for backup ${backupId}`
        });
    } catch (err) {
        // If we can't create the status channel, abort
        return sent.edit({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Cannot Start Restore\n\nFailed to create status channel: ${err.message}`))], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
    }

    // Notify the original message that progress moved to the status channel
    const redirectCard = new ContainerBuilder();
    redirectCard.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Lightning:1521227915537285150> Restore Started\n\n` +
        `A dedicated status channel has been created for live progress updates.\n\n` +
        `**➡️ Go to:** <#${statusChannel.id}>\n\n` +
        `-# This channel will be deleted during restore. Track progress in the status channel.`
    ));
    await sent.edit({ components: [redirectCard], flags: MessageFlags.IsComponentsV2 }).catch(() => { });

    // Post the initial progress card in the status channel
    const headerCard = new ContainerBuilder();
    headerCard.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Lightning:1521227915537285150> Server Restore — Live Status\n\n` +
        `**<:Box:1521228152414666833> Backup:** \`${backupId}\`\n` +
        `**👤 Requested by:** <@${uid}>\n` +
        `**⏰ Started:** <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
        `-# This channel was auto-created for restore tracking. It will be renamed when complete.`
    ));
    headerCard.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    await statusChannel.send({ components: [headerCard], flags: MessageFlags.IsComponentsV2 }).catch(() => { });

    // Send the live-updating progress message
    let statusMsg;
    try {
        statusMsg = await statusChannel.send({ components: [buildRestoreRunningCard(backupId, sid, job)], flags: MessageFlags.IsComponentsV2 });
    } catch (err) {
        return;
    }

    let lastRenderAt = 0;
    const renderRunning = async (force = false) => {
        if (job.done && !force) return;
        const now = Date.now();
        if (!force && now - lastRenderAt < 1500) return;
        lastRenderAt = now;
        await statusMsg.edit({ components: [buildRestoreRunningCard(backupId, sid, job)], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
    };

    // Collector on the status channel message for Pause/Stop/Status buttons
    const collector = statusMsg.createMessageComponentCollector({ time: CONTROL_TIMEOUT });
    collector.on('collect', async (i) => {
        if (i.user.id !== uid) {
            return i.reply({ content: '<:Cancel:1521227723916181644> Only the command invoker can use this.', flags: MessageFlags.Ephemeral });
        }

        const action = i.customId.split(':')[1];
        if (action === 'toggle') {
            if (!job.stopped && !job.done) {
                job.paused = !job.paused;
                job.details = job.paused ? 'Restore paused by user' : 'Restore resumed';
            }
            return i.update({ components: [buildRestoreRunningCard(backupId, sid, job)], flags: MessageFlags.IsComponentsV2 });
        }

        if (action === 'stop') {
            if (!job.done) {
                job.stopped = true;
                job.details = 'Stop requested. Waiting for current operation to finish...';
            }
            return i.update({ components: [buildRestoreRunningCard(backupId, sid, job)], flags: MessageFlags.IsComponentsV2 });
        }

        if (action === 'status') {
            return i.reply({
                content:
                    `Status: **${job.stopped ? 'Stopping' : (job.paused ? 'Paused' : 'Running')}**\n` +
                    `Stage: **${job.stage}**\n` +
                    `Progress: **${job.current}/${job.total} (${Math.round(job.percent)}%)**`,
                flags: MessageFlags.Ephemeral
            });
        }

        return i.deferUpdate().catch(() => { });
    });

    collector.on('end', async (_, reason) => {
        if (job.done || reason === 'done') return;
        if (reason === 'time') {
            job.stopped = true;
            job.details = 'Control session expired (30 min). Stopping restore...';
            await statusMsg.edit({ components: [buildRestoreRunningCard(backupId, sid, job)], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
        }
    });

    // ── Run the actual restore (passing the status channel ID so it's excluded from deletion) ──
    let restoreResult;
    try {
        restoreResult = await loadServerBackup(guild, backupId, secureToken, uid, {
            onProgress: (progress) => {
                job.stage = progress.stage || job.stage;
                job.details = progress.details || '';
                job.current = Number(progress.current || 0);
                job.total = Number(progress.total || 1);
                job.percent = Number(progress.percent || 0);
                void renderRunning(false);
            },
            isPaused: () => job.paused,
            isStopped: () => job.stopped,
            excludeChannelIds: [statusChannel.id]
        });
    } catch (err) {
        restoreResult = { success: false, error: err.message };
    }

    job.done = true;
    collector.stop('done');

    // ── Post final result to the status channel ──
    if (restoreResult?.success) {
        await statusMsg.edit({ components: [buildRestoreSuccessCard(restoreResult)], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
        // Rename the channel to indicate completion
        await statusChannel.setName('✅restore-complete').catch(() => { });
        await statusChannel.setTopic(`<:Checkedbox:1521227734943269077> Backup \`${backupId}\` restored successfully • <t:${Math.floor(Date.now() / 1000)}:f>`).catch(() => { });
        return;
    }

    if (restoreResult?.stopped || job.stopped) {
        const stats = restoreResult?.stats || {
            rolesDeleted: 0, categoriesDeleted: 0, channelsDeleted: 0,
            rolesCreated: 0, categoriesCreated: 0, channelsCreated: 0,
            messagesRestored: 0
        };
        await statusMsg.edit({ components: [buildRestoreStoppedCard(backupId, stats)], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
        await statusChannel.setName('⚠️restore-stopped').catch(() => { });
        return;
    }

    const errCard = new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Restore Failed\n\n${restoreResult?.error || 'Unknown restore error.'}`));
    await statusMsg.edit({ components: [errCard], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
    await statusChannel.setName('❌restore-failed').catch(() => { });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('server-backup-load')
        .setDescription('Restore Discord server from a backup (WARNING: destructive!)')
        .addStringOption(o => o.setName('backup-id').setDescription('Backup ID to restore').setRequired(true).setAutocomplete(true))
        .addStringOption(o => o.setName('token').setDescription('Secure token (for cross-server restores)').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    prefix: 'server-backup-load',
    description: 'Restore Discord server from a backup (destructive)',
    usage: 'server-backup-load <backup-id> [token]',
    category: 'backup',
    aliases: ['sbk-load', 'sbackup-load', 'server-backup-restore'],
    permissions: ['Administrator'],

    async autocomplete(interaction) {
        const all = await listServerBackups(interaction.user.id);
        await interaction.respond(all.map(b => ({
            name: `${b.id} - ${b.serverName} (${new Date(b.createdAt).toLocaleDateString()})${b.includesMessages ? ' [+MSG]' : ''}`,
            value: b.id
        })).slice(0, 25));
    },

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const backupId = interaction.options.getString('backup-id');
        const secureToken = interaction.options.getString('token') || '';

        // Show warning + confirmation  
        const uid = interaction.user.id;
        const sid = `${uid}_${Date.now().toString(36)}`;

        const warn = new ContainerBuilder().setAccentColor(0xED4245);
        warn.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Infotriangle:1521227710381428926> Server Restore — Confirm\n\n` +
            `**Backup ID:** \`${backupId}\`\n\n` +
            `This will **permanently**:\n` +
            `> <:Trash:1521227750420254820> Delete **all** current roles\n> <:Trash:1521227750420254820> Delete **all** channels & categories\n> <:Download:1521228191899975810> Recreate everything from the backup\n\n` +
            `> <:Infotriangle:1521227710381428926> **This action cannot be undone.**\n> Create a server backup first if you want to save the current state.`
        ));
        warn.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`sbkr:confirm:${sid}`).setEmoji('<:Infotriangle:1521227710381428926>').setLabel('Yes, Restore Server').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`sbkr:cancel:${sid}`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        ));
        const sent = await interaction.editReply({ components: [warn], flags: MessageFlags.IsComponentsV2 });

        const collector = sent.createMessageComponentCollector({ time: TIMEOUT });
        collector.on('collect', async (i) => {
            if (i.user.id !== uid) return i.reply({ content: '<:Cancel:1521227723916181644> Only the command invoker can use this.', flags: MessageFlags.Ephemeral });
            collector.stop('handled');

            if (i.customId.split(':')[1] !== 'confirm') {
                return i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Cancelled. No changes were made.'))], flags: MessageFlags.IsComponentsV2 });
            }

            await i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Lightning:1521227915537285150> Starting Restore…\n\nLoading backup \`${backupId}\` and preparing controls.`))], flags: MessageFlags.IsComponentsV2 });

            try {
                await runRestoreWithControls(sent, interaction.guild, backupId, secureToken, uid);
            } catch (err) {
                console.error('Error loading server backup:', err);
                return sent.edit({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
            }
        });

        collector.on('end', (_, reason) => {
            if (reason === 'handled') return;
            sent.edit({ components: [buildExpiredPanel('server-backup-load', 'No changes were made.')], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
        });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Missing Permission\n\nYou need **Administrator** permission.'))], flags: MessageFlags.IsComponentsV2 });
        }

        const backupId = args[0];
        const secureToken = args[1] || '';
        if (!backupId) {
            return message.reply({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> Invalid Usage\n\n**Usage:** `server-backup-load <backup-id> [token]`'))], flags: MessageFlags.IsComponentsV2 });
        }

        const uid = message.author.id;
        const sid = `${uid}_${Date.now().toString(36)}`;

        // Lookup backup details
        let bk = null;
        try { const all = await listServerBackups(uid); bk = all.find(b => b.id === backupId); } catch { }
        const info = bk ? `**<:Box:1521228152414666833>** \`${bk.id}\`\n**<:Bookopen:1521227911137595605>** ${bk.serverName}\n**<:Clock:1521228110408847623>** <t:${Math.floor(bk.createdAt / 1000)}:f>` : `**<:Box:1521228152414666833>** \`${backupId}\``;

        const warn = new ContainerBuilder().setAccentColor(0xED4245);
        warn.addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Infotriangle:1521227710381428926> Server Restore — Confirm\n\n${info}\n\n` +
            `This will **permanently**:\n` +
            `> <:Trash:1521227750420254820> Delete **all** current roles\n> <:Trash:1521227750420254820> Delete **all** channels & categories\n> <:Download:1521228191899975810> Recreate everything from the backup\n\n` +
            `> <:Infotriangle:1521227710381428926> **This action cannot be undone.**`
        ));
        warn.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`sbkr:confirm:${sid}`).setEmoji('<:Infotriangle:1521227710381428926>').setLabel('Yes, Restore Server').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`sbkr:cancel:${sid}`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        ));

        const sent = await message.reply({ components: [warn], flags: MessageFlags.IsComponentsV2 });
        const collector = sent.createMessageComponentCollector({ time: TIMEOUT });

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) return i.reply({ content: '<:Cancel:1521227723916181644> Only the command invoker can use this.', flags: MessageFlags.Ephemeral });
            collector.stop('handled');

            if (i.customId.split(':')[1] !== 'confirm') {
                return i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Cancelled. No changes were made.'))], flags: MessageFlags.IsComponentsV2 });
            }

            await i.update({ components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Lightning:1521227915537285150> Starting Restore…\n\nLoading backup \`${backupId}\` and preparing controls.`))], flags: MessageFlags.IsComponentsV2 });

            try {
                await runRestoreWithControls(sent, message.guild, backupId, secureToken, uid);
            } catch (err) {
                console.error('Error loading server backup:', err);
                return sent.edit({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\n${err.message}`))], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
            }
        });

        collector.on('end', (_, reason) => {
            if (reason === 'handled') return;
            sent.edit({ components: [buildExpiredPanel('server-backup-load', 'No changes were made.')], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
        });
    }
};
