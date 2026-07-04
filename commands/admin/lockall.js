'use strict';
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags, PermissionFlagsBits, ChannelType, SlashCommandBuilder } = require('discord.js');
const { buildPermissionDenied, buildInvalidUsage, COLORS } = require('../../utils/responseBuilder');
const { confirmAction } = require('../../utils/confirmAction');
const jsonStore = require('../../utils/jsonStore');

function loadLockdown() {
    try {
        if (!jsonStore.has('lockdown')) return {};
        const raw = JSON.stringify(jsonStore.read('lockdown'));
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveLockdown(data) {
    jsonStore.write('lockdown', data);
}

async function processLock(guild, user, targetRole) {
    const textChannels = guild.channels.cache.filter(ch => ch.type === ChannelType.GuildText && ch.manageable);
    const savedPerms = {};
    let processed = 0, failed = 0;

    for (const [channelId, channel] of textChannels) {
        try {
            const overwrite = channel.permissionOverwrites.cache.get(targetRole.id);
            savedPerms[channelId] = {
                sendMessages: overwrite?.allow.has(PermissionFlagsBits.SendMessages) ? true
                    : overwrite?.deny.has(PermissionFlagsBits.SendMessages) ? false : null,
                addReactions: overwrite?.allow.has(PermissionFlagsBits.AddReactions) ? true
                    : overwrite?.deny.has(PermissionFlagsBits.AddReactions) ? false : null
            };
            await channel.permissionOverwrites.edit(targetRole, {
                SendMessages: false,
                AddReactions: false
            }, { reason: `Lockall by ${user.username}` });
            processed++;
        } catch { failed++; }
    }

    const lockData = loadLockdown();
    lockData[guild.id] = { active: true, lockedAt: Date.now(), lockedBy: user.id, roleId: targetRole.id, savedPerms, channelCount: processed };
    saveLockdown(lockData);

    return { processed, failed, total: textChannels.size };
}

async function processUnlock(guild, user, targetRole) {
    const lockData  = loadLockdown();
    const guildLock = lockData[guild.id];
    let processed = 0, failed = 0;

    if (guildLock?.savedPerms) {
        for (const [channelId, perms] of Object.entries(guildLock.savedPerms)) {
            try {
                const channel = guild.channels.cache.get(channelId);
                if (!channel || !channel.manageable) { failed++; continue; }
                await channel.permissionOverwrites.edit(targetRole, {
                    SendMessages: perms.sendMessages,
                    AddReactions: perms.addReactions
                }, { reason: `Unlockall by ${user.username}` });
                processed++;
            } catch { failed++; }
        }
    } else {
        const textChannels = guild.channels.cache.filter(ch => ch.type === ChannelType.GuildText && ch.manageable);
        for (const [, channel] of textChannels) {
            try {
                await channel.permissionOverwrites.edit(targetRole, { SendMessages: null }, { reason: `Unlockall by ${user.username}` });
                processed++;
            } catch { failed++; }
        }
    }

    delete lockData[guild.id];
    saveLockdown(lockData);

    return { processed, failed };
}

function buildResultContent(lock, processed, failed, user, roleName) {
    const icon   = lock ? '<:Lock:1521227892770734120>' : '<:Unlock:1521228030842769610>';
    const action = lock ? 'Locked' : 'Unlocked';
    let content  = `# ${icon} All Channels ${action}\n\n`;
    content += `Successfully ${action.toLowerCase()} all text channels for ${roleName}.\n\n`;
    content += `### <:Invoice:1521227903956811836> Results\n`;
    content += `> **${action}:** ${processed} channels\n`;
    if (failed > 0) content += `> **Failed:** ${failed} channels\n`;
    content += `\n**${action} By:** ${user.username}\n**Role:** ${roleName}\n\n`;
    if (lock) {
        content += `> <:Lock:1521227892770734120> All text channels are now secured. ${roleName} cannot send messages.\n`;
        content += `> Use \`/lockall off\` or \`-unlockall\` to unlock all channels.`;
    } else {
        content += `> <:Unlock:1521228030842769610> All text channels are now open. ${roleName} can send messages again.`;
    }
    return content;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lockall')
        .setDescription('Lock or unlock all text channels for a role (defaults to @everyone)')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Lock or unlock all channels')
                .setRequired(false)
                .addChoices(
                    { name: 'Lock (on)',   value: 'on' },
                    { name: 'Unlock (off)', value: 'off' }
                ))
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('Role to lock/unlock channels for (defaults to @everyone)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    prefix: 'lockall',
    description: 'Lock or unlock all text channels for a role',
    usage: 'lockall [on/off] [@role]',
    category: 'admin',
    aliases: ['lockdown'],

    async execute(interaction) {
        try {
            if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.ERROR)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Bot Missing Permissions\n\nI need the **Manage Channels** permission.`
                    ));
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const action     = interaction.options.getString('action') || 'on';
            const lock       = action === 'on';
            const targetRole = interaction.options.getRole('role') || interaction.guild.roles.everyone;
            const roleName   = targetRole.id === interaction.guild.roles.everyone.id ? '@everyone' : `<@&${targetRole.id}>`;

            // Locking is a hard, server-wide action — confirm it. Unlocking is
            // the recovery path, so it runs immediately.
            if (lock) {
                const { confirmed, button } = await confirmAction(interaction, false, {
                    title: 'Confirm Server Lockdown',
                    description: `Lock **all text channels** for ${roleName}?\n\nMembers won't be able to send messages anywhere until you unlock.`,
                    confirmLabel: 'Lock All Channels',
                });
                if (!confirmed) return;
                const { processed, failed } = await processLock(interaction.guild, interaction.user, targetRole);
                const container = new ContainerBuilder()
                    .setAccentColor(COLORS.ERROR)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        buildResultContent(true, processed, failed, interaction.user, roleName)
                    ));
                return button.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            }

            await interaction.deferReply();
            const { processed, failed } = await processUnlock(interaction.guild, interaction.user, targetRole);

            const container = new ContainerBuilder()
                .setAccentColor(COLORS.SUCCESS)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    buildResultContent(false, processed, failed, interaction.user, roleName)
                ))
;

            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Lockall error:', error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred!', flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const container = buildPermissionDenied('Administrator');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const container = new ContainerBuilder()
                .setAccentColor(COLORS.ERROR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Cancel:1521227723916181644> Bot Missing Permissions\n\nI need the **Manage Channels** permission.`
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const invoked    = message.content.trim().split(/ +/)[0].toLowerCase();
        const targetRole = message.mentions.roles.first() || message.guild.roles.everyone;
        const roleName   = targetRole.id === message.guild.roles.everyone.id ? '@everyone' : `<@&${targetRole.id}>`;
        const plainArgs  = args.filter(a => !a.startsWith('<@&'));

        let lock;
        if (invoked.endsWith('unlockall')) {
            lock = false;
        } else if (plainArgs[0]?.toLowerCase() === 'off') {
            lock = false;
        } else if (plainArgs[0]?.toLowerCase() === 'on' || !plainArgs[0]) {
            lock = true;
        } else {
            const container = buildInvalidUsage('lockall', '-lockall [on/off] [@role]', ['-lockall', '-lockall on', '-lockall off @Members', '-unlockall', '-lockdown on']);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const textChannels = message.guild.channels.cache.filter(ch => ch.type === ChannelType.GuildText);

        if (lock) {
            const { confirmed, button } = await confirmAction(message, true, {
                title: 'Confirm Server Lockdown',
                description: `Lock **all ${textChannels.size} text channels** for ${roleName}?\n\nMembers won't be able to send messages anywhere until you unlock.`,
                confirmLabel: 'Lock All Channels',
            });
            if (!confirmed) return;
            const { processed, failed } = await processLock(message.guild, message.author, targetRole);
            const resultContainer = new ContainerBuilder()
                .setAccentColor(COLORS.ERROR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    buildResultContent(true, processed, failed, message.author, roleName)
                ));
            return button.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        const processingContainer = new ContainerBuilder()
            .setAccentColor(COLORS.WARNING)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Unlock:1521228030842769610> Unlocking All Channels\n\n` +
                `<:Lightning:1521227915537285150> Processing ${textChannels.size} channels for ${roleName}...\n\n-# This may take a moment for large servers`
            ));

        const processingMsg = await message.reply({ components: [processingContainer], flags: MessageFlags.IsComponentsV2 });

        const { processed, failed } = await processUnlock(message.guild, message.author, targetRole);

        const resultContainer = new ContainerBuilder()
            .setAccentColor(COLORS.SUCCESS)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                buildResultContent(false, processed, failed, message.author, roleName)
            ))
;

        processingMsg.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
};
