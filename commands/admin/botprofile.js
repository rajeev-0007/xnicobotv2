const { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SeparatorBuilder, MediaGalleryBuilder, SectionBuilder, ThumbnailBuilder } = require('discord.js');
const { buildErrorResponse } = require('../../utils/responseBuilder');
const botCustomize = require('../../utils/botCustomize');

module.exports = {
    data: null,
    prefix: 'botprofile',
    aliases: ['bp-info', 'bot-profile'],
    description: 'View the bot\'s per-server profile (nick, avatar, banner, about)',
    usage: 'botprofile',
    category: 'admin',

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply('<:Cancel:1521227723916181644> You need Manage Server permission to use this command!');
        }

        try {
            const botMember = message.guild.members.me;
            const guildId = message.guild.id;
            const guildCustom = botCustomize.getConfig(guildId);
            const accentColor = botCustomize.getEmbedColor(guildId);

            const hasCustomNickname = botMember.nickname !== null;
            const hasCustomAvatar = !!guildCustom.avatarUrl;
            const hasCustomBanner = !!guildCustom.bannerUrl;
            const hasAbout = !!guildCustom.aboutText;

            const globalAvatar = message.client.user.displayAvatarURL({ size: 256 });
            // Prefer the URL the admin saved into /bot-customize so the
            // panel reflects the latest configuration even if Discord's
            // own member cache hasn't refreshed yet (e.g. immediately
            // after editMe, or if Discord rejected the live update but
            // we kept the local value as the source of truth).
            const serverAvatar = guildCustom.avatarUrl
                || botMember.displayAvatarURL({ size: 256 });
            const globalName = message.client.user.username;
            const serverName = botMember.nickname || globalName;

            const container = new ContainerBuilder().setAccentColor(accentColor);

            // Banner preview if set
            if (hasCustomBanner) {
                try {
                    container.addMediaGalleryComponents(
                        new MediaGalleryBuilder().addItems(item => item.setURL(guildCustom.bannerUrl))
                    );
                } catch (e) {}
            }

            // Header with avatar thumbnail
            let headerText = `# <:bots:1521227848101396610> Bot Server Profile\n`;
            headerText += `-# Showing how **${message.client.user.username}** appears in **${message.guild.name}**\n`;

            const section = new SectionBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText))
                .setThumbnailAccessory(new ThumbnailBuilder().setURL(serverAvatar));
            container.addSectionComponents(section);

            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

            // Identity section
            let identityText = `### <:Copy:1521227960554881084> Identity\n`;
            identityText += `> <:Edit:1521227886634205298> **Display Name:** ${serverName}\n`;
            identityText += `> -# ${hasCustomNickname ? '<:Checkedbox:1521227734943269077> Custom nickname set' : '<:Cancel:1521227723916181644> Using global name'}\n`;
            identityText += `> <:Picture:1521227954191995024> **Avatar:** ${hasCustomAvatar ? '[Custom per-server avatar](' + guildCustom.avatarUrl + ')' : '[Global avatar](' + globalAvatar + ')'}\n`;
            identityText += `> -# ${hasCustomAvatar ? '<:Checkedbox:1521227734943269077> Per-server avatar active' : '<:Cancel:1521227723916181644> Using global avatar'}\n`;
            identityText += `> <:Picture:1521227954191995024> **Banner:** ${hasCustomBanner ? '[Custom banner](' + guildCustom.bannerUrl + ')' : 'Not set'}\n`;
            identityText += `> -# ${hasCustomBanner ? '<:Checkedbox:1521227734943269077> Custom banner set' : '<:Cancel:1521227723916181644> No banner configured'}`;

            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(identityText));

            // About section
            if (hasAbout) {
                container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
                let aboutText = `### <:Document:1521227875016114266> About / Bio\n`;
                aboutText += `> ${guildCustom.aboutText.substring(0, 300)}${guildCustom.aboutText.length > 300 ? '...' : ''}`;
                container.addTextDisplayComponents(new TextDisplayBuilder().setContent(aboutText));
            }

            // Settings overview
            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
            let settingsText = `### <:Settings:1521227767780343879> Server Settings\n`;
            settingsText += `> <:Edit:1521227886634205298> **Prefix:** ${guildCustom.prefix ? `\`${guildCustom.prefix}\`` : 'Default'}\n`;
            settingsText += `> <:Palette:1521227950601539755> **Embed Color:** ${botCustomize.getEmbedColorName(guildId)}\n`;
            settingsText += `> <:Bookopen:1521227911137595605> **Language:** ${guildCustom.language || 'en'}\n`;
            settingsText += `> <:Timer:1521227971590095070> **Cooldown:** ${guildCustom.commandCooldown}s`;

            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(settingsText));

            container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('-# Use `bot-customize` to modify these settings • Requires Premium')
            );

            // Customize button
            container.addActionRowComponents(new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('botcustom_category')
                    .setLabel('Open Customization Panel')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('<:Palette:1521227950601539755>')
                    .setDisabled(true)
            ));

            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[BotProfile] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
