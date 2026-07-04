const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildSuccessResponse, buildErrorResponse, buildPermissionDenied, buildExpiredPanel } = require('../../utils/responseBuilder');

function buildConfirmPrompt(banCount) {
    const container = new ContainerBuilder()
        .setAccentColor(0xFEE75C)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent('# <:Infotriangle:1521227710381428926> Confirmation Required')
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `You are about to unban **${banCount}** user${banCount !== 1 ? 's' : ''} from this server.\n\n` +
                `> This action cannot be undone. All banned users will be able to rejoin the server.\n\n` +
                `**Are you sure you want to proceed?**`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('unbanall_confirm')
                    .setLabel('Confirm Unban All')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('<:Checkedbox:1521227734943269077>'),
                new ButtonBuilder()
                    .setCustomId('unbanall_cancel')
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('<:Cancel:1521227723916181644>')
            )
        )
;
    return container;
}

async function performMassUnban(guild, username) {
    const bans = await guild.bans.fetch();
    let unbanned = 0;
    let failed = 0;

    for (const [userId] of bans) {
        try {
            await guild.members.unban(userId, `Mass unban by ${username}`);
            unbanned++;
        } catch {
            failed++;
        }
    }

    return { unbanned, failed, total: bans.size };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unbanall')
        .setDescription('Unban all users from the server')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    
    prefix: 'unbanall',
    description: 'Unban all users from the server',
    usage: 'unbanall',
    category: 'admin',
    aliases: ['massunban'],
    
    async execute(interaction) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const container = buildPermissionDenied('Administrator');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        try {
            const bans = await interaction.guild.bans.fetch();
            
            if (bans.size === 0) {
                const container = buildErrorResponse('No Bans Found', 'There are no banned users in this server.');
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const confirmContainer = buildConfirmPrompt(bans.size);
            const reply = await interaction.reply({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, fetchReply: true });

            const collector = reply.createMessageComponentCollector({ time: 30000 });

            collector.on('collect', async (btn) => {
                if (btn.user.id !== interaction.user.id) {
                    return btn.reply(require('../../utils/adminUI').errReply('Not For You', 'This confirmation is not for you.', { ephemeral: true }));
                }

                collector.stop();

                if (btn.customId === 'unbanall_cancel') {
                    const cancelContainer = buildErrorResponse('Cancelled', 'Mass unban has been cancelled.');
                    return btn.update({ components: [cancelContainer], flags: MessageFlags.IsComponentsV2 });
                }

                const loadingContainer = buildSuccessResponse('Mass Unban In Progress', `Unbanning ${bans.size} users... This may take a moment.`);
                await btn.update({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

                const { unbanned, failed, total } = await performMassUnban(interaction.guild, interaction.user.username);

                const resultContainer = new ContainerBuilder()
                    .setAccentColor(unbanned > 0 ? 0x57F287 : 0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Shield:1521227694677692467> Mass Unban Complete'))
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `### <:Document:1521227875016114266> Results\n` +
                            `**<:Checkedbox:1521227734943269077> Unbanned:** ${unbanned}\n` +
                            `**<:Cancel:1521227723916181644> Failed:** ${failed}\n` +
                            `**<:User:1521227714227343380> Total Bans:** ${total}\n` +
                            `**<:User:1521227714227343380> Unbanned By:** ${interaction.user.username}`
                        )
                    )
;

                await interaction.editReply({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await interaction.editReply({ components: [buildExpiredPanel('unbanall', 'Confirmation timed out. No users were unbanned.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                }
            });
        } catch (error) {
            console.error('Unbanall Error:', error);
            const container = buildErrorResponse('Unban All Failed', 'An error occurred.', `Error: ${error.message}`);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            } else {
                await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            const container = buildPermissionDenied('Administrator');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const bans = await message.guild.bans.fetch();
            
            if (bans.size === 0) {
                const container = buildErrorResponse('No Bans Found', 'There are no banned users in this server.');
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            const confirmContainer = buildConfirmPrompt(bans.size);
            const msg = await message.reply({ components: [confirmContainer], flags: MessageFlags.IsComponentsV2 });

            const collector = msg.createMessageComponentCollector({ time: 30000 });

            collector.on('collect', async (btn) => {
                if (btn.user.id !== message.author.id) {
                    return btn.reply(require('../../utils/adminUI').errReply('Not For You', 'This confirmation is not for you.', { ephemeral: true }));
                }

                collector.stop();

                if (btn.customId === 'unbanall_cancel') {
                    const cancelContainer = buildErrorResponse('Cancelled', 'Mass unban has been cancelled.');
                    return btn.update({ components: [cancelContainer], flags: MessageFlags.IsComponentsV2 });
                }

                const loadingContainer = buildSuccessResponse('Mass Unban In Progress', `Unbanning ${bans.size} users... This may take a moment.`);
                await btn.update({ components: [loadingContainer], flags: MessageFlags.IsComponentsV2 });

                const { unbanned, failed, total } = await performMassUnban(message.guild, message.author.username);

                const resultContainer = new ContainerBuilder()
                    .setAccentColor(unbanned > 0 ? 0x57F287 : 0xED4245)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Shield:1521227694677692467> Mass Unban Complete'))
                    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `### <:Document:1521227875016114266> Results\n` +
                            `**<:Checkedbox:1521227734943269077> Unbanned:** ${unbanned}\n` +
                            `**<:Cancel:1521227723916181644> Failed:** ${failed}\n` +
                            `**<:User:1521227714227343380> Total Bans:** ${total}\n` +
                            `**<:User:1521227714227343380> Unbanned By:** ${message.author.username}`
                        )
                    )
;

                await msg.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 });
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time') {
                    await msg.edit({ components: [buildExpiredPanel('unbanall', 'Confirmation timed out. No users were unbanned.')], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
                }
            });
        } catch (error) {
            console.error('Unbanall Error:', error);
            const container = buildErrorResponse('Unban All Failed', 'An error occurred.', `Error: ${error.message}`);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
