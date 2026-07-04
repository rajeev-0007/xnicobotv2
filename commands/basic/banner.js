const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { buildErrorResponse } = require('../../utils/responseBuilder');

async function buildUserBannerResponse(client, user) {
    const fetched = await client.users.fetch(user.id, { force: true });
    const bannerURL = fetched.bannerURL({ size: 4096 });

    if (!bannerURL) {
        return { error: true, components: [buildErrorResponse('No Banner', `**${fetched.username}** doesn't have a profile banner.`)] };
    }

    const isAnimated = fetched.banner && fetched.banner.startsWith('a_');
    const links = [
        `[PNG](${fetched.bannerURL({ extension: 'png', size: 4096 })})`,
        `[JPG](${fetched.bannerURL({ extension: 'jpg', size: 4096 })})`,
        `[WEBP](${fetched.bannerURL({ extension: 'webp', size: 4096 })})`
    ];
    if (isAnimated) {
        links.push(`[GIF](${fetched.bannerURL({ extension: 'gif', size: 4096 })})`);
    }

    const section = new SectionBuilder();
    section.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Picture:1521227954191995024> ${fetched.username}'s Banner\n\n${links.join(' | ')}`));
    section.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: fetched.displayAvatarURL({ size: 256 }) } }));

    const container = new ContainerBuilder()
        .setAccentColor(fetched.accentColor ?? 0xCAD7E6)
        .addSectionComponents(section)
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(bannerURL)
            )
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Open in Browser')
            .setURL(bannerURL)
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:Fire:1521227907647668374>')
    );

    return { container, row };
}

async function buildServerBannerResponse(guild) {
    const bannerURL = guild.bannerURL({ size: 4096 });

    if (!bannerURL) {
        return { error: true, components: [buildErrorResponse('No Banner', 'This server has no banner! Server needs to be boosted to level 2+')] };
    }

    const container = new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Picture:1521227954191995024> ${guild.name}'s Banner`)
        )
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(bannerURL)
            )
        );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Download Banner')
            .setURL(bannerURL)
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:Fire:1521227907647668374>')
    );

    return { container, row };
}

module.exports = {
    prefix: 'banner',
    description: 'Display a user\'s profile banner or the server banner',
    usage: 'banner [@user] [--server]',
    category: 'basic',
    aliases: ['server-banner-url', 'serverbanner', 'userbanner', 'ub'],
    data: new SlashCommandBuilder()
        .setName('banner')
        .setDescription('Display a user\'s profile banner or the server banner')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user whose banner to display')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('server')
                .setDescription('Show the server banner instead')
                .setRequired(false)),

    async execute(interaction) {
        const showServer = interaction.options.getBoolean('server');
        const targetUser = interaction.options.getUser('user');

        if (showServer) {
            const guild = await interaction.guild.fetch();
            const result = await buildServerBannerResponse(guild);
            if (result.error) {
                return interaction.reply({ components: result.components, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            return interaction.reply({ components: [result.container, result.row], flags: MessageFlags.IsComponentsV2 });
        }

        const user = targetUser || interaction.user;
        const result = await buildUserBannerResponse(interaction.client, user);
        if (result.error) {
            return interaction.reply({ components: result.components, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        await interaction.reply({ components: [result.container, result.row], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const invokedCmd = message.content.trim().split(/\s+/)[0].toLowerCase();
        const isServerAlias = invokedCmd.endsWith('serverbanner') || invokedCmd.endsWith('server-banner-url');
        const hasServerFlag = args.includes('--server') || args.includes('--sv');

        if (isServerAlias || hasServerFlag) {
            const guild = await message.guild.fetch();
            const result = await buildServerBannerResponse(guild);
            if (result.error) {
                return message.reply({ components: result.components, flags: MessageFlags.IsComponentsV2 });
            }
            return message.reply({ components: [result.container, result.row], flags: MessageFlags.IsComponentsV2 });
        }

        let user = message.author;
        if (message.mentions.users.size > 0) {
            user = message.mentions.users.first();
        } else {
            const cleanArgs = args.filter(a => !a.startsWith('--'));
            if (cleanArgs[0]) {
                try {
                    user = await message.client.users.fetch(cleanArgs[0]);
                } catch {}
            }
        }

        const result = await buildUserBannerResponse(message.client, user);
        if (result.error) {
            return message.reply({ components: result.components, flags: MessageFlags.IsComponentsV2 });
        }
        await message.reply({ components: [result.container, result.row], flags: MessageFlags.IsComponentsV2 });
    }
};