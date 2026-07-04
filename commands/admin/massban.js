const { PermissionFlagsBits, SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildInvalidUsage, buildLoadingResponse, buildErrorResponse, buildExpiredPanel } = require('../../utils/responseBuilder');

function buildConfirmPrompt(count, reason) {
    return new ContainerBuilder()
        .setAccentColor(0xFEE75C)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('# <:Infotriangle:1521227710381428926> Confirmation Required')
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `You are about to **ban ${count}** user${count !== 1 ? 's' : ''} from this server.\n\n` +
                `> **Reason:** ${reason}\n` +
                `> This is a destructive action. Banned users will not be able to rejoin until unbanned.\n\n` +
                `**Are you sure you want to proceed?**`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('massban_confirm')
                    .setLabel('Confirm Mass Ban')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('<:Checkedbox:1521227734943269077>'),
                new ButtonBuilder()
                    .setCustomId('massban_cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:Cancel:1521227723916181644>')
            )
        )
;
}

function buildResultContainer(banned, failed, invalidIds, reason, moderator) {
    return new ContainerBuilder()
        .setAccentColor(banned > 0 ? 0x57F287 : 0xED4245)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('# <:Shield:1521227694677692467> Mass Ban Complete')
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### <:Document:1521227875016114266> Results\n` +
                `**<:Checkedbox:1521227734943269077> Banned:** ${banned}\n` +
                `**<:Cancel:1521227723916181644> Failed:** ${failed}\n` +
                `**<:Infotriangle:1521227710381428926> Invalid IDs:** ${invalidIds}\n` +
                `**<:Edit:1521227886634205298> Reason:** ${reason}\n` +
                `**<:User:1521227714227343380> Moderator:** ${moderator}`
            )
        )
;
}

async function performMassBan(guild, ids, reason, moderator) {
    let banned = 0;
    let failed = 0;
    let invalidIds = 0;

    for (const userId of ids) {
        if (!/^\d+$/.test(userId)) {
            invalidIds++;
            continue;
        }
        try {
            await guild.members.ban(userId, { reason: `${reason} (Massban by ${moderator})` });
            banned++;
        } catch {
            failed++;
        }
    }

    return { banned, failed, invalidIds };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('massban')
        .setDescription('Ban multiple users by their IDs (Owner Only)')
        .addStringOption(option =>
            option.setName('ids')
                .setDescription('User IDs separated by spaces')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for mass ban')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

    prefix: 'massban',
    description: 'Ban multiple users by their IDs (Owner Only)',
    usage: 'massban <userID1> [userID2] [userID3]...',
    category: 'admin',

    async execute(interaction) {
        if (interaction.user.id !== interaction.guild.ownerId) {
            const container = buildErrorResponse('Owner Only', 'Only the **server owner** can use the mass ban command.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
            const container = buildErrorResponse('Missing Bot Permission', 'I need the **Ban Members** permission to use this command.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const ids = interaction.options.getString('ids').split(/\s+/).filter(id => id.length > 0);
        const reason = interaction.options.getString('reason') || 'Mass ban';

        if (ids.length === 0) {
            const container = buildErrorResponse('No IDs Provided', 'Please provide at least one user ID.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const confirmContainer = buildConfirmPrompt(ids.length, reason);
        const reply = await interaction.reply({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, fetchReply: true });

        const collector = reply.createMessageComponentCollector({ time: 30000 });

        collector.on('collect', async (btn) => {
            if (btn.user.id !== interaction.user.id) {
                return btn.reply(require('../../utils/adminUI').errReply('Not For You', 'This confirmation is not for you.', { ephemeral: true }));
            }

            collector.stop();

            if (btn.customId === 'massban_cancel') {
                const cancelContainer = buildErrorResponse('Cancelled', 'Mass ban has been cancelled. No users were banned.');
                return btn.update({ components: [cancelContainer], flags: MessageFlags.IsComponentsV2 });
            }

            const loadingContainer = buildLoadingResponse('Mass Banning', `Banning ${ids.length} users...`);
            await btn.update({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

            const { banned, failed, invalidIds } = await performMassBan(interaction.guild, ids, reason, interaction.user.username);
            const resultContainer = buildResultContainer(banned, failed, invalidIds, reason, interaction.user.username);

            await interaction.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                await interaction.editReply({ components: [buildExpiredPanel('massban', 'Confirmation timed out. No users were banned.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            }
        });
    },

    async executePrefix(message, args) {
        if (message.author.id !== message.guild.ownerId) {
            const container = buildErrorResponse('Owner Only', 'Only the **server owner** can use the mass ban command.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
            const container = buildErrorResponse('Missing Bot Permission', 'I need the **Ban Members** permission to use this command.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (args.length === 0) {
            const container = buildInvalidUsage('massban', '-massban <userID1> [userID2]...', ['-massban 123456789 987654321']);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const reason = 'Mass ban';
        const confirmContainer = buildConfirmPrompt(args.length, reason);
        const msg = await message.reply({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 });

        const collector = msg.createMessageComponentCollector({ time: 30000 });

        collector.on('collect', async (btn) => {
            if (btn.user.id !== message.author.id) {
                return btn.reply(require('../../utils/adminUI').errReply('Not For You', 'This confirmation is not for you.', { ephemeral: true }));
            }

            collector.stop();

            if (btn.customId === 'massban_cancel') {
                const cancelContainer = buildErrorResponse('Cancelled', 'Mass ban has been cancelled. No users were banned.');
                return btn.update({ components: [cancelContainer], flags: MessageFlags.IsComponentsV2 });
            }

            const loadingContainer = buildLoadingResponse('Mass Banning', `Banning ${args.length} users...`);
            await btn.update({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

            const { banned, failed, invalidIds } = await performMassBan(message.guild, args, reason, message.author.username);
            const resultContainer = buildResultContainer(banned, failed, invalidIds, reason, message.author.username);

            await msg.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
        });

        collector.on('end', async (collected, endReason) => {
            if (endReason === 'time') {
                await msg.edit({ components: [buildExpiredPanel('massban', 'Confirmation timed out. No users were banned.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            }
        });
    }
};
