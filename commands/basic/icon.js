const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');

function buildIconResponse(guild) {
    const iconURL = guild.iconURL({ size: 4096 });

    if (!iconURL) {
        return { error: '<:Cancel:1521227723916181644> This server has no icon!' };
    }

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Picture:1521227954191995024> ${guild.name}'s Icon`)
        )
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(iconURL)
            )
        )

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Download Icon')
            .setURL(iconURL)
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:Download:1521228191899975810>')
    );

    return { container, row };
}

module.exports = {
    prefix: 'icon',
    description: 'Display the server icon',
    usage: 'icon',
    category: 'basic',
    aliases: ['server-icon-url', 'servericon'],
    data: new SlashCommandBuilder()
        .setName('icon')
        .setDescription('Display the server icon'),

    async execute(interaction) {
        try {
            const result = buildIconResponse(interaction.guild);
            if (result.error) {
                return interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
            }
            await interaction.reply({ components: [result.container, result.row], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error(`[ICON] Error:`, error);
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
            const result = buildIconResponse(message.guild);
            if (result.error) {
                return message.reply(result.error);
            }
            await message.reply({ components: [result.container, result.row], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error(`[ICON] Error:`, error);
            await message.reply('<:Cancel:1521227723916181644> An error occurred while running this command.').catch(() => {});
        }
    }
};
