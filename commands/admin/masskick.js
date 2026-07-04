const { PermissionFlagsBits, SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildErrorResponse, buildInvalidUsage, buildLoadingResponse, buildExpiredPanel } = require('../../utils/responseBuilder');

function buildConfirmPrompt(count, reason) {
    return new ContainerBuilder()
        .setAccentColor(0xFEE75C)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('# <:Infotriangle:1521227710381428926> Confirmation Required')
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `You are about to **kick ${count}** user${count !== 1 ? 's' : ''} from this server.\n\n` +
                `> **Reason:** ${reason}\n` +
                `> Kicked users can rejoin with a new invite, but this action affects multiple members.\n\n` +
                `**Are you sure you want to proceed?**`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('masskick_confirm')
                    .setLabel('Confirm Mass Kick')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('<:Checkedbox:1521227734943269077>'),
                new ButtonBuilder()
                    .setCustomId('masskick_cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:Cancel:1521227723916181644>')
            )
        )
;
}

function buildResultContainer(kicked, failed, invalidIds, notInServer, reason, moderator) {
    return new ContainerBuilder()
        .setAccentColor(kicked > 0 ? 0x57F287 : 0xED4245)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('# <:Shield:1521227694677692467> Mass Kick Complete')
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### <:Document:1521227875016114266> Results\n` +
                `**<:Checkedbox:1521227734943269077> Kicked:** ${kicked}\n` +
                `**<:Cancel:1521227723916181644> Failed:** ${failed}\n` +
                `**<:Infotriangle:1521227710381428926> Invalid IDs:** ${invalidIds}\n` +
                `**<:User:1521227714227343380> Not in Server:** ${notInServer}\n` +
                `**<:Edit:1521227886634205298> Reason:** ${reason}\n` +
                `**<:User:1521227714227343380> Moderator:** ${moderator}`
            )
        )
;
}

async function performMassKick(guild, ids, reason, moderator) {
    let kicked = 0;
    let failed = 0;
    let invalidIds = 0;
    let notInServer = 0;

    for (const userId of ids) {
        if (!/^\d+$/.test(userId)) {
            invalidIds++;
            continue;
        }

        if (userId === guild.client.user.id || userId === guild.ownerId) {
            failed++;
            continue;
        }

        try {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                notInServer++;
                continue;
            }
            if (!member.kickable) {
                failed++;
                continue;
            }
            await member.kick(`${reason} (Masskick by ${moderator})`);
            kicked++;
        } catch {
            failed++;
        }
    }

    return { kicked, failed, invalidIds, notInServer };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('masskick')
        .setDescription('Kick multiple users from the server (Owner Only)')
        .addStringOption(option =>
            option.setName('ids')
                .setDescription('User IDs separated by spaces')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for mass kick')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    prefix: 'masskick',
    description: 'Kick multiple users from the server (Owner Only)',
    usage: 'masskick <userID1> [userID2] [userID3]...',
    category: 'admin',

    async execute(interaction) {
        if (interaction.user.id !== interaction.guild.ownerId) {
            const container = buildErrorResponse('Owner Only', 'Only the **server owner** can use the mass kick command.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
            const container = buildErrorResponse('Missing Bot Permission', 'I need the **Kick Members** permission to use this command.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const ids = interaction.options.getString('ids').split(/\s+/).filter(id => id.length > 0);
        const reason = interaction.options.getString('reason') || 'Mass kick';

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

            if (btn.customId === 'masskick_cancel') {
                const cancelContainer = buildErrorResponse('Cancelled', 'Mass kick has been cancelled. No users were kicked.');
                return btn.update({ components: [cancelContainer], flags: MessageFlags.IsComponentsV2 });
            }

            const loadingContainer = buildLoadingResponse('Mass Kicking', `Kicking ${ids.length} users...`);
            await btn.update({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

            const { kicked, failed, invalidIds, notInServer } = await performMassKick(interaction.guild, ids, reason, interaction.user.username);
            const resultContainer = buildResultContainer(kicked, failed, invalidIds, notInServer, reason, interaction.user.username);

            await interaction.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                await interaction.editReply({ components: [buildExpiredPanel('masskick', 'Confirmation timed out. No users were kicked.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            }
        });
    },

    async executePrefix(message, args) {
        if (message.author.id !== message.guild.ownerId) {
            const container = buildErrorResponse('Owner Only', 'Only the **server owner** can use the mass kick command.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
            const container = buildErrorResponse('Missing Bot Permission', 'I need the **Kick Members** permission to use this command.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (args.length === 0) {
            const container = buildInvalidUsage('masskick', '-masskick <userID1> [userID2]...', ['-masskick 123456789 987654321']);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const reason = 'Mass kick';
        const confirmContainer = buildConfirmPrompt(args.length, reason);
        const msg = await message.reply({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 });

        const collector = msg.createMessageComponentCollector({ time: 30000 });

        collector.on('collect', async (btn) => {
            if (btn.user.id !== message.author.id) {
                return btn.reply(require('../../utils/adminUI').errReply('Not For You', 'This confirmation is not for you.', { ephemeral: true }));
            }

            collector.stop();

            if (btn.customId === 'masskick_cancel') {
                const cancelContainer = buildErrorResponse('Cancelled', 'Mass kick has been cancelled. No users were kicked.');
                return btn.update({ components: [cancelContainer], flags: MessageFlags.IsComponentsV2 });
            }

            const loadingContainer = buildLoadingResponse('Mass Kicking', `Kicking ${args.length} users...`);
            await btn.update({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

            const { kicked, failed, invalidIds, notInServer } = await performMassKick(message.guild, args, reason, message.author.username);
            const resultContainer = buildResultContainer(kicked, failed, invalidIds, notInServer, reason, message.author.username);

            await msg.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
        });

        collector.on('end', async (collected, endReason) => {
            if (endReason === 'time') {
                await msg.edit({ components: [buildExpiredPanel('masskick', 'Confirmation timed out. No users were kicked.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            }
        });
    }
};
