const { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const storeSnapshot = require('../../utils/storeSnapshot');
const { } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('datasnapshot')
        .setDescription('[Owner] Manage database snapshots')
        .addSubcommand(sub => sub
            .setName('create')
            .setDescription('Create a manual database snapshot'))
        .addSubcommand(sub => sub
            .setName('list')
            .setDescription('List all available snapshots'))
        .addSubcommand(sub => sub
            .setName('cleanup')
            .setDescription('Remove snapshots older than 24 hours'))
        .addSubcommand(sub => sub
            .setName('inspect')
            .setDescription('View details of a specific snapshot')
            .addStringOption(opt => opt
                .setName('name')
                .setDescription('Snapshot filename')
                .setRequired(true)))
        .addSubcommand(sub => sub
            .setName('restore')
            .setDescription('Restore a snapshot (DANGEROUS)')
            .addStringOption(opt => opt
                .setName('name')
                .setDescription('Snapshot filename')
                .setRequired(true))
            .addStringOption(opt => opt
                .setName('stores')
                .setDescription('Comma-separated store names (leave empty for all)')
                .setRequired(false)))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    prefix: 'datasnapshot',
    description: '[Owner] Manage database snapshots',
    usage: 'datasnapshot <create|list|cleanup|inspect|restore> [options]',
    category: 'admin',
    aliases: ['snapshot', 'backup'],
    ownerOnly: true,

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'create') {
            await handleCreate(interaction, false);
        } else if (subcommand === 'list') {
            await handleList(interaction, false);
        } else if (subcommand === 'cleanup') {
            await handleCleanup(interaction, false);
        } else if (subcommand === 'inspect') {
            const name = interaction.options.getString('name');
            await handleInspect(interaction, name, false);
        } else if (subcommand === 'restore') {
            const name = interaction.options.getString('name');
            const stores = interaction.options.getString('stores');
            await handleRestore(interaction, name, stores, false);
        }
    },

    async executePrefix(message, args) {
        if (!args[0]) {
            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Cancel:1521227723916181644> Missing Action\n\n` +
                    `**Usage:** \`datasnapshot <action>\`\n\n` +
                    `**Actions:**\n` +
                    `\`create\` - Create a manual snapshot\n` +
                    `\`list\` - List all snapshots\n` +
                    `\`cleanup\` - Remove snapshots older than 24h\n` +
                    `\`inspect <name>\` - View snapshot details\n` +
                    `\`restore <name> [stores]\` - Restore snapshot`
                ))
;
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const action = args[0].toLowerCase();

        if (['create', 'new', 'backup'].includes(action)) {
            await handleCreate(message, true);
        } else if (['list', 'ls', 'show'].includes(action)) {
            await handleList(message, true);
        } else if (['cleanup', 'clean', 'prune'].includes(action)) {
            await handleCleanup(message, true);
        } else if (['inspect', 'view', 'info'].includes(action)) {
            if (!args[1]) {
                const container = new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Missing Snapshot Name\n\n` +
                        `**Usage:** \`datasnapshot inspect <name>\``
                    ));
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            await handleInspect(message, args[1], true);
        } else if (['restore', 'load'].includes(action)) {
            if (!args[1]) {
                const container = new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Missing Snapshot Name\n\n` +
                        `**Usage:** \`datasnapshot restore <name> [stores]\``
                    ));
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            await handleRestore(message, args[1], args.slice(2).join(','), true);
        } else {
            const container = new ContainerBuilder()
                .setAccentColor(0xED4245)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# <:Cancel:1521227723916181644> Invalid Action\n\n` +
                    `Unknown action: \`${action}\`\n\n` +
                    `Use \`datasnapshot\` with no args to see available actions.`
                ));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};

async function handleCreate(target, isPrefix) {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Lightning:1521227915537285150> Creating Snapshot\n\n` +
            `Please wait...`
        ));

    let response;
    if (isPrefix) {
        response = await target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } else {
        await target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const result = await storeSnapshot.createSnapshot('manual');

    if (result.success) {
        const resultContainer = new ContainerBuilder()
            .setAccentColor(0x57F287)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Checkedbox:1521227734943269077> Snapshot Created\n\n` +
                `Successfully created database snapshot!`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `**📁 Name:** \`${result.name}\`\n` +
                `**📊 Stores:** ${result.stores}\n` +
                `**💾 Size:** ${(result.bytes / 1024).toFixed(1)} KB\n` +
                `**📅 Retention:** 24 hours`
            ))
;

        if (isPrefix && response) {
            await response.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
        } else {
            await target.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
        }
    } else {
        const errorContainer = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Cancel:1521227723916181644> Snapshot Failed\n\n` +
                `\`\`\`${result.error}\`\`\``
            ));

        if (isPrefix && response) {
            await response.edit({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        } else {
            await target.editReply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
    }
}

async function handleList(target, isPrefix) {
    const snapshots = storeSnapshot.listSnapshots();

    if (snapshots.length === 0) {
        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Inforect:1521228008285929532> No Snapshots\n\n` +
                `No snapshots available. Use \`/datasnapshot create\` to create one.`
            ));

        if (isPrefix) {
            return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const now = Date.now();
    let listText = '';
    let totalSize = 0;

    for (const snap of snapshots.slice(0, 15)) {
        const age = now - snap.createdAt.getTime();
        const hoursAgo = Math.floor(age / (1000 * 60 * 60));
        const expired = age > storeSnapshot.MAX_SNAPSHOT_AGE_MS;
        const ageText = hoursAgo < 1 ? 'Less than 1h ago' : `${hoursAgo}h ago`;
        const expireIcon = expired ? '🔴' : '🟢';

        totalSize += snap.size;
        listText += `${expireIcon} \`${snap.name}\`\n`;
        listText += `> ${(snap.size / 1024).toFixed(1)} KB • ${ageText}${expired ? ' (will be deleted)' : ''}\n\n`;
    }

    if (snapshots.length > 15) {
        listText += `\n*...and ${snapshots.length - 15} more*\n`;
    }

    const container = new ContainerBuilder()
        .setAccentColor(0xBCF1E4)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# 📦 Database Snapshots (${snapshots.length})\n\n${listText}`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**Total Size:** ${(totalSize / 1024 / 1024).toFixed(2)} MB\n` +
            `**Retention:** 24 hours (auto-cleanup)\n` +
            `**Status:** 🟢 Active • 🔴 Will be deleted`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `-# Use \`datasnapshot inspect <name>\` to view details`
        ));

    if (isPrefix) {
        return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

async function handleCleanup(target, isPrefix) {
    const container = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# 🧹 Cleaning Up Snapshots\n\n` +
            `Removing snapshots older than 24 hours...`
        ));

    let response;
    if (isPrefix) {
        response = await target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } else {
        await target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const result = storeSnapshot.cleanupOld();

    if (result.success) {
        const resultContainer = new ContainerBuilder()
            .setAccentColor(result.deleted > 0 ? 0x57F287 : 0xCAD7E6)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                result.deleted > 0
                    ? `# <:Checkedbox:1521227734943269077> Cleanup Complete\n\n` +
                    `Removed ${result.deleted} old snapshot(s)!`
                    : `# <:Inforect:1521228008285929532> Nothing to Clean\n\n` +
                    `All snapshots are within 24 hours.`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `**🗑️ Deleted:** ${result.deleted} snapshot(s)\n` +
                `**<:Checkedbox:1521227734943269077> Kept:** ${result.kept} snapshot(s)\n` +
                `**💾 Freed:** ${result.freedMB} MB`
            ))
;

        if (isPrefix && response) {
            await response.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
        } else {
            await target.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
        }
    } else {
        const errorContainer = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Cancel:1521227723916181644> Cleanup Failed\n\n` +
                `\`\`\`${result.error}\`\`\``
            ));

        if (isPrefix && response) {
            await response.edit({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        } else {
            await target.editReply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
    }
}

async function handleInspect(target, name, isPrefix) {
    const result = storeSnapshot.inspectSnapshot(name);

    if (!result.success) {
        const container = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Cancel:1521227723916181644> Snapshot Not Found\n\n` +
                `\`${name}\` does not exist or is unreadable.`
            ));

        if (isPrefix) {
            return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const storeList = result.storeNames.slice(0, 30).join(', ');
    const container = new ContainerBuilder()
        .setAccentColor(0xBCF1E4)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# 📦 Snapshot Details\n\n` +
            `\`${name}\``
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `**📅 Created:** ${new Date(result.createdAt).toLocaleString()}\n` +
            `**📝 Reason:** ${result.reason}\n` +
            `**📊 Store Count:** ${result.storeCount}\n\n` +
            `**Stores:** ${storeList}${result.storeNames.length > 30 ? '...' : ''}`
        ))
;

    if (isPrefix) {
        return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    return target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

async function handleRestore(target, name, storesStr, isPrefix) {
    const container = new ContainerBuilder()
        .setAccentColor(0xFEE75C)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# ⚠️ Restoring Snapshot\n\n` +
            `This will overwrite current data. Please wait...`
        ));

    let response;
    if (isPrefix) {
        response = await target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } else {
        await target.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const opts = {};
    if (storesStr && storesStr.trim()) {
        opts.only = storesStr.split(',').map(s => s.trim()).filter(Boolean);
    }

    const result = await storeSnapshot.restoreSnapshot(name, opts);

    if (result.success) {
        const resultContainer = new ContainerBuilder()
            .setAccentColor(0x57F287)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Checkedbox:1521227734943269077> Restore Complete\n\n` +
                `Successfully restored ${result.restored.length} store(s) from snapshot!`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `**📦 Snapshot:** \`${name}\`\n` +
                `**<:Checkedbox:1521227734943269077> Restored:** ${result.restored.join(', ')}`
            ))
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `-# ⚠️ Restart the bot to ensure all caches are synced`
            ));

        if (isPrefix && response) {
            await response.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
        } else {
            await target.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
        }
    } else {
        const errorContainer = new ContainerBuilder()
            .setAccentColor(0xED4245)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `# <:Cancel:1521227723916181644> Restore Failed\n\n` +
                `\`\`\`${result.error}\`\`\``
            ));

        if (isPrefix && response) {
            await response.edit({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        } else {
            await target.editReply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
    }
}
