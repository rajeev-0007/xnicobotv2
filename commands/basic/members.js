const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');

async function buildMembersContainer(guild) {
    const total = guild.memberCount || 0;
    const iconUrl = guild.iconURL({ size: 256 });

    const container = new ContainerBuilder()
        ;

    if (iconUrl) {
        const headerSection = new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# <:User:1521227714227343380> ${guild.name}`)
            )
            .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: iconUrl } }));
        container.addSectionComponents(headerSection);
    } else {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:User:1521227714227343380> ${guild.name}`)
        );
    }

    container
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### <:User:1521227714227343380> Member Count\n` +
                `# ${total.toLocaleString()}`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))

    return container;
}

module.exports = {
    prefix: 'members',
    description: 'Display server member statistics',
    usage: 'members',
    category: 'basic',
    aliases: ['membercount'],

    data: new SlashCommandBuilder()
        .setName('members')
        .setDescription('Display server member statistics'),

    async execute(interaction) {
        try {
            const container = await buildMembersContainer(interaction.guild);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const { buildErrorResponse } = require('../../utils/responseBuilder');
            const err = buildErrorResponse('Error', 'Failed to fetch member data.', error.message);
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            } else {
                await interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
        }
    },

    async executePrefix(message) {
        try {
            const container = await buildMembersContainer(message.guild);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const { buildErrorResponse } = require('../../utils/responseBuilder');
            const err = buildErrorResponse('Error', 'Failed to fetch member data.', error.message);
            await message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
