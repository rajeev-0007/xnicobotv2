const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { SUPPORT_SERVER_URL } = require('../../utils/errorResponse');

function buildSupportResponse(client) {
    const supportServer = SUPPORT_SERVER_URL;
    
    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Inforect:1521228008285929532> Support Server\n\nNeed help? Join our support server!`)
        )
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: client.user.displayAvatarURL({ size: 256 }) } }));

    const container = new ContainerBuilder()
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `<:Hashtag:1521227771957870604> **Get Help:** Ask questions and get support from our team\n` +
                `<:Bullhorn:1521227936575914016> **Updates:** Stay updated with bot announcements\n` +
                `<:Infotriangle:1521227710381428926> **Report Bugs:** Report bugs and suggest features`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Join Support Server')
            .setURL(supportServer)
            .setStyle(ButtonStyle.Link)
            .setEmoji('🆘')
    );

    return { container, row };
}

module.exports = {
    prefix: 'support',
    description: 'Get the support server invite link',
    usage: 'support',
    category: 'basic',
    data: new SlashCommandBuilder()
        .setName('support')
        .setDescription('Get the support server invite link'),
    
    async execute(interaction) {
        try {
            const { container, row } = buildSupportResponse(interaction.client);
            await interaction.reply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error(`[SUPPORT] Error:`, error);
            const content = '<:Cancel:1521227723916181644> An error occurred while running this command.';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content }).catch(() => {});
            } else {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    },

    async executePrefix(message) {
        try {
            const { container, row } = buildSupportResponse(message.client);
            await message.reply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error(`[SUPPORT] Error:`, error);
            await message.reply('<:Cancel:1521227723916181644> An error occurred while running this command.').catch(() => {});
        }
    }
};
