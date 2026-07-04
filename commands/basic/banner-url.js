const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

function buildBannerResponse(user, bannerURL) {
    const container = new ContainerBuilder()
        .setAccentColor(COLORS.INFO)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Picture:1521227954191995024> ${user.username}'s Banner`)
        )
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(bannerURL)
            )
        )

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Open in Browser')
            .setStyle(ButtonStyle.Link)
            .setURL(bannerURL)
    );

    return { container, row };
}

module.exports = {
    prefix: 'banner-url',
    description: 'Get the banner URL of a user',
    usage: 'banner-url [@user]',
    category: 'basic',
    aliases: ['bannerurl'],

    data: new SlashCommandBuilder()
        .setName('banner-url')
        .setDescription('Get the banner URL of a user')
        .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(false)),

    async execute(interaction) {
        try {
            const user = interaction.options.getUser('user') || interaction.user;
            const fetched = await user.fetch(true);
            const bannerURL = fetched.bannerURL({ size: 4096 });
            if (!bannerURL) {
                const err = buildErrorResponse('No Banner', `**${fetched.username}** doesn't have a banner.`);
                return interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
            const { container, row } = buildBannerResponse(fetched, bannerURL);
            await interaction.reply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const err = buildErrorResponse('Error', 'Failed to fetch banner.', error.message);
            await interaction.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        try {
            let user = message.mentions.users.first() || message.author;
            if (!message.mentions.users.size && args[0]) {
                user = await message.client.users.fetch(args[0]).catch(() => null);
                if (!user) {
                    const err = buildErrorResponse('User Not Found', `Could not find user with ID \`${args[0]}\`.`);
                    return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
                }
            }
            const fetched = await user.fetch(true);
            const bannerURL = fetched.bannerURL({ size: 4096 });
            if (!bannerURL) {
                const err = buildErrorResponse('No Banner', `**${fetched.username}** doesn't have a banner.`);
                return message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
            }
            const { container, row } = buildBannerResponse(fetched, bannerURL);
            await message.reply({ components: [container.addActionRowComponents(row)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            const err = buildErrorResponse('Error', 'Failed to fetch banner.', error.message);
            await message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
