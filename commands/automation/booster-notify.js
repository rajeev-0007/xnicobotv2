const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, SeparatorBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder } = require('discord.js');

const jsonStore = require('../../utils/jsonStore');
const { checkAndExpire } = require('../../utils/panelExpiration');

function loadConfig() {
    try {
        if (!jsonStore.has('booster-notify')) {
            jsonStore.write('booster-notify', {});
            return {};
        }
        return jsonStore.read('booster-notify');
    } catch (e) {
        return {};
    }
}

function saveConfig(config) {
    jsonStore.write('booster-notify', config);
}

function getDefaultGuildConfig() {
    return {
        enabled: false,
        channel: null,
        boostMessage: {
            content: '# <a:nitro_boost:1388164213988192370> New Server Boost!\n\n{user} just boosted the server!\n\n**Thank you for your support!** 💜\n\n-# We now have {boostCount} boosts! (Level {boostTier})',
            embed: false,
            embedColor: '#FF73FA',
            embedTitle: '<:Sketch:1521228025365004471> New Boost!',
            embedDescription: '{user} just boosted the server!\n\nThank you for your support! 💜',
            embedFooter: 'We now have {boostCount} boosts!',
            embedThumbnail: true,
            embedImage: null
        },
        unboostMessage: {
            enabled: false,
            content: '💔 {user} is no longer boosting the server.\n-# We now have {boostCount} boosts.',
            channel: null
        },
        boosterRole: null,
        dmThankYou: {
            enabled: false,
            message: 'Thank you so much for boosting **{server}**! 💜\n\nAs a thank you, you now have access to exclusive perks!'
        },
        specialPerks: {
            customRole: false,
            customRolePosition: null,
            nicknameEmoji: null
        }
    };
}

function buildBoosterPanel(guildConfig, guild) {
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('# <a:nitro_boost:1388164213988192370> Booster Notifications\n-# Thank your supporters with custom notifications')
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const statusEmoji = guildConfig.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';
    const channelText = guildConfig.channel ? `<#${guildConfig.channel}>` : '`Not Set`';
    const boosterRoleText = guildConfig.boosterRole ? `<@&${guildConfig.boosterRole}>` : '`Discord Default`';
    const dmEnabled = guildConfig.dmThankYou?.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';
    const unboostEnabled = guildConfig.unboostMessage?.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`<:Sketch:1521228025365004471> **${guild.premiumSubscriptionCount || 0}** boosts • Boost **Tier ${guild.premiumTier}**`)
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${statusEmoji} **Status:** ${guildConfig.enabled ? 'Enabled' : 'Disabled'}\n<:Bullhorn:1521227936575914016> **Channel:** ${channelText}\n<:Userplus:1521227719621218477> **Booster Role:** ${boosterRoleText}\n<:Envelope:1521228013910626426> **DM Thanks:** ${dmEnabled}\n💔 **Unboost Notify:** ${unboostEnabled}`)
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('booster_toggle')
            .setLabel(guildConfig.enabled ? 'Disable' : 'Enable')
            .setStyle(guildConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
            .setEmoji(guildConfig.enabled ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'),
        new ButtonBuilder()
            .setCustomId('booster_channel')
            .setLabel('Set Channel')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Bullhorn:1521227936575914016>'),
        new ButtonBuilder()
            .setCustomId('booster_message')
            .setLabel('Boost Message')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Editalt:1521227921673556019>')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('booster_dm_toggle')
            .setLabel(guildConfig.dmThankYou?.enabled ? 'Disable DM' : 'Enable DM')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Envelope:1521228013910626426>'),
        new ButtonBuilder()
            .setCustomId('booster_dm_message')
            .setLabel('DM Message')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Hashtag:1521227771957870604>'),
        new ButtonBuilder()
            .setCustomId('booster_unboost_toggle')
            .setLabel(guildConfig.unboostMessage?.enabled ? 'Disable Unboost' : 'Enable Unboost')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('💔')
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('booster_embed_config')
            .setLabel('Embed Settings')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Palette:1521227950601539755>'),
        new ButtonBuilder()
            .setCustomId('booster_preview')
            .setLabel('Preview')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Eye:1521227940480815156>'),
        new ButtonBuilder()
            .setCustomId('booster_test')
            .setLabel('Test')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🧪'),
        new ButtonBuilder()
            .setCustomId('booster_help')
            .setLabel('Help')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Lightbulbalt:1521227880703463675>')
    );

    container.addActionRowComponents(row1);
    container.addActionRowComponents(row2);
    container.addActionRowComponents(row3);

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('-# 💜 Make your boosters feel special!')
    );

    return container;
}

function buildEmbedConfigPanel(guildConfig) {
    const container = new ContainerBuilder();
    const embedConfig = guildConfig.boostMessage;

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent('# <:Palette:1521227950601539755> Embed Configuration\n-# Customize how boost notifications look')
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const useEmbed = embedConfig.embed ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';
    const showThumb = embedConfig.embedThumbnail ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`${useEmbed} **Use Embed:** ${embedConfig.embed ? 'Yes' : 'No'}\n<:Palette:1521227950601539755> **Color:** \`${embedConfig.embedColor || '#FF73FA'}\`\n<:Picture:1521227954191995024> **Show Thumbnail:** ${showThumb}`)
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('booster_embed_toggle')
            .setLabel(embedConfig.embed ? 'Use Plain Text' : 'Use Embed')
            .setStyle(embedConfig.embed ? ButtonStyle.Secondary : ButtonStyle.Primary)
            .setEmoji(embedConfig.embed ? '<:Edit:1521227886634205298>' : '<:Picture:1521227954191995024>'),
        new ButtonBuilder()
            .setCustomId('booster_embed_color')
            .setLabel('Set Color')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Palette:1521227950601539755>'),
        new ButtonBuilder()
            .setCustomId('booster_embed_thumb_toggle')
            .setLabel(embedConfig.embedThumbnail ? 'Hide Thumbnail' : 'Show Thumbnail')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Picture:1521227954191995024>')
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('booster_embed_title')
            .setLabel('Set Title')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Document:1521227875016114266>'),
        new ButtonBuilder()
            .setCustomId('booster_embed_desc')
            .setLabel('Set Description')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Edit:1521227886634205298>'),
        new ButtonBuilder()
            .setCustomId('booster_embed_footer')
            .setLabel('Set Footer')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔖')
    );

    const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('booster_embed_image')
            .setLabel('Set Image')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🌄'),
        new ButtonBuilder()
            .setCustomId('booster_embed_back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Caretleft:1521227977495543838>')
    );

    container.addActionRowComponents(row1);
    container.addActionRowComponents(row2);
    container.addActionRowComponents(row3);

    return container;
}

function formatMessage(message, member, guild) {
    return message
        .replace(/{user}/g, member ? `<@${member.id}>` : '@User')
        .replace(/{username}/g, member?.user?.username || 'Username')
        .replace(/{tag}/g, member?.user?.username || 'Unknown User')
        .replace(/{server}/g, guild.name)
        .replace(/{boostCount}/g, guild.premiumSubscriptionCount || 0)
        .replace(/{boostTier}/g, guild.premiumTier);
}

function createBoostEmbed(guildConfig, member, guild) {
    const embedConfig = guildConfig.boostMessage;
    const embed = new EmbedBuilder()
        .setColor(embedConfig.embedColor || '#FF73FA')
        .setTitle(formatMessage(embedConfig.embedTitle || '<:Sketch:1521228025365004471> New Boost!', member, guild))
        .setDescription(formatMessage(embedConfig.embedDescription || '{user} just boosted the server!\n\nThank you for your support! 💜', member, guild))
        .setTimestamp();

    if (embedConfig.embedFooter) {
        embed.setFooter({ text: formatMessage(embedConfig.embedFooter, member, guild) });
    }

    if (embedConfig.embedThumbnail && member) {
        embed.setThumbnail(member.user.displayAvatarURL({ size: 256 }));
    }

    if (embedConfig.embedImage) {
        embed.setImage(embedConfig.embedImage);
    }

    return embed;
}

module.exports = {
    category: 'automation',
    data: new SlashCommandBuilder()
        .setName('booster-notify')
        .setDescription('Configure server boost notifications')
        .setDefaultMemberPermissions(0x20),

    async execute(interaction) {
        const config = loadConfig();
        const guildId = interaction.guild.id;
        if (!config[guildId]) config[guildId] = getDefaultGuildConfig();
        
        const container = buildBoosterPanel(config[guildId], interaction.guild);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async executePrefix(message) {
        if (!message.member.permissions.has('ManageGuild')) {
            return message.reply('<:Cancel:1521227723916181644> You need **Manage Server** permission to configure booster notifications.');
        }
        
        const config = loadConfig();
        const guildId = message.guild.id;
        if (!config[guildId]) config[guildId] = getDefaultGuildConfig();
        
        const container = buildBoosterPanel(config[guildId], message.guild);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async handleInteraction(interaction) {
        if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isChannelSelectMenu()) return false;

        const customId = interaction.customId;
        if (!customId.startsWith('booster_')) return false;

        // Check if config session has expired
        if (await checkAndExpire(interaction, 'config')) return true;

        const config = loadConfig();
        const guildId = interaction.guild.id;
        if (!config[guildId]) config[guildId] = getDefaultGuildConfig();
        const guildConfig = config[guildId];

        if (customId === 'booster_toggle') {
            guildConfig.enabled = !guildConfig.enabled;
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildBoosterPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'booster_channel') {
            const channelSelect = new ChannelSelectMenuBuilder()
                .setCustomId('booster_channel_select')
                .setPlaceholder('Select notification channel')
                .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

            const row = new ActionRowBuilder().addComponents(channelSelect);
            await interaction.reply({ content: '**Select the channel for boost notifications:**', components: [row], flags: MessageFlags.Ephemeral });
            return true;
        }

        if (customId === 'booster_channel_select' && interaction.isChannelSelectMenu()) {
            guildConfig.channel = interaction.values[0];
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.update({ content: `<:Checkedbox:1521227734943269077> Boost notification channel set to <#${interaction.values[0]}>!`, components: [] });
            return true;
        }

        if (customId === 'booster_message') {
            const modal = new ModalBuilder()
                .setCustomId('booster_message_modal')
                .setTitle('Boost Notification Message');

            const input = new TextInputBuilder()
                .setCustomId('boost_message')
                .setLabel('Message (plain text when not using embed)')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Use {user}, {username}, {server}, {boostCount}, {boostTier}')
                .setValue(guildConfig.boostMessage.content || '')
                .setRequired(true)
                .setMaxLength(2000);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'booster_message_modal' && interaction.isModalSubmit()) {
            guildConfig.boostMessage.content = interaction.fields.getTextInputValue('boost_message');
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Boost message updated!', flags: MessageFlags.Ephemeral });
            try {
                const container = buildBoosterPanel(guildConfig, interaction.guild);
                await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch (e) {}
            return true;
        }

        if (customId === 'booster_dm_toggle') {
            guildConfig.dmThankYou.enabled = !guildConfig.dmThankYou.enabled;
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildBoosterPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'booster_dm_message') {
            const modal = new ModalBuilder()
                .setCustomId('booster_dm_modal')
                .setTitle('DM Thank You Message');

            const input = new TextInputBuilder()
                .setCustomId('dm_message')
                .setLabel('Message sent privately to boosters')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Use {user}, {username}, {server}')
                .setValue(guildConfig.dmThankYou.message || '')
                .setRequired(true)
                .setMaxLength(1000);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'booster_dm_modal' && interaction.isModalSubmit()) {
            guildConfig.dmThankYou.message = interaction.fields.getTextInputValue('dm_message');
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: '<:Checkedbox:1521227734943269077> DM thank you message updated!', flags: MessageFlags.Ephemeral });
            return true;
        }

        if (customId === 'booster_unboost_toggle') {
            guildConfig.unboostMessage.enabled = !guildConfig.unboostMessage.enabled;
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildBoosterPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'booster_embed_config') {
            const container = buildEmbedConfigPanel(guildConfig);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'booster_embed_back') {
            const container = buildBoosterPanel(guildConfig, interaction.guild);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'booster_embed_toggle') {
            guildConfig.boostMessage.embed = !guildConfig.boostMessage.embed;
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildEmbedConfigPanel(guildConfig);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'booster_embed_color') {
            const modal = new ModalBuilder()
                .setCustomId('booster_color_modal')
                .setTitle('Embed Color');

            const input = new TextInputBuilder()
                .setCustomId('embed_color')
                .setLabel('Hex Color Code')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('#FF73FA')
                .setValue(guildConfig.boostMessage.embedColor || '#FF73FA')
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'booster_color_modal' && interaction.isModalSubmit()) {
            const color = interaction.fields.getTextInputValue('embed_color');
            if (!color.match(/^#?([0-9A-Fa-f]{6})$/)) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid hex color!', flags: MessageFlags.Ephemeral });
                return true;
            }
            guildConfig.boostMessage.embedColor = color.startsWith('#') ? color : `#${color}`;
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Embed color set to \`${guildConfig.boostMessage.embedColor}\`!`, flags: MessageFlags.Ephemeral });
            try {
                const container = buildEmbedConfigPanel(guildConfig);
                await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } catch (e) {}
            return true;
        }

        if (customId === 'booster_embed_thumb_toggle') {
            guildConfig.boostMessage.embedThumbnail = !guildConfig.boostMessage.embedThumbnail;
            config[guildId] = guildConfig;
            saveConfig(config);
            const container = buildEmbedConfigPanel(guildConfig);
            await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (customId === 'booster_embed_title') {
            const modal = new ModalBuilder()
                .setCustomId('booster_title_modal')
                .setTitle('Embed Title');

            const input = new TextInputBuilder()
                .setCustomId('embed_title')
                .setLabel('Embed Title')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('New Boost!')
                .setValue(guildConfig.boostMessage.embedTitle || '')
                .setRequired(false);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'booster_title_modal' && interaction.isModalSubmit()) {
            guildConfig.boostMessage.embedTitle = interaction.fields.getTextInputValue('embed_title') || null;
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Embed title updated!', flags: MessageFlags.Ephemeral });
            return true;
        }

        if (customId === 'booster_embed_desc') {
            const modal = new ModalBuilder()
                .setCustomId('booster_desc_modal')
                .setTitle('Embed Description');

            const input = new TextInputBuilder()
                .setCustomId('embed_desc')
                .setLabel('Description')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('{user} just boosted! Thank you!')
                .setValue(guildConfig.boostMessage.embedDescription || '')
                .setRequired(false);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'booster_desc_modal' && interaction.isModalSubmit()) {
            guildConfig.boostMessage.embedDescription = interaction.fields.getTextInputValue('embed_desc') || null;
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Embed description updated!', flags: MessageFlags.Ephemeral });
            return true;
        }

        if (customId === 'booster_embed_footer') {
            const modal = new ModalBuilder()
                .setCustomId('booster_footer_modal')
                .setTitle('Embed Footer');

            const input = new TextInputBuilder()
                .setCustomId('embed_footer')
                .setLabel('Footer Text')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('We now have {boostCount} boosts!')
                .setValue(guildConfig.boostMessage.embedFooter || '')
                .setRequired(false);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'booster_footer_modal' && interaction.isModalSubmit()) {
            guildConfig.boostMessage.embedFooter = interaction.fields.getTextInputValue('embed_footer') || null;
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Embed footer updated!', flags: MessageFlags.Ephemeral });
            return true;
        }

        if (customId === 'booster_embed_image') {
            const modal = new ModalBuilder()
                .setCustomId('booster_image_modal')
                .setTitle('Embed Image');

            const input = new TextInputBuilder()
                .setCustomId('embed_image')
                .setLabel('Image URL (leave empty to remove)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('https://i.imgur.com/example.gif')
                .setValue(guildConfig.boostMessage.embedImage || '')
                .setRequired(false);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await interaction.showModal(modal);
            return true;
        }

        if (customId === 'booster_image_modal' && interaction.isModalSubmit()) {
            const url = interaction.fields.getTextInputValue('embed_image');
            guildConfig.boostMessage.embedImage = url || null;
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.reply({ content: url ? '<:Checkedbox:1521227734943269077> Embed image set!' : '<:Checkedbox:1521227734943269077> Embed image removed!', flags: MessageFlags.Ephemeral });
            return true;
        }

        if (customId === 'booster_preview') {
            if (guildConfig.boostMessage.embed) {
                const embed = createBoostEmbed(guildConfig, interaction.member, interaction.guild);
                await interaction.reply({ content: '**Preview:**', embeds: [embed], flags: MessageFlags.Ephemeral });
            } else {
                const content = formatMessage(guildConfig.boostMessage.content, interaction.member, interaction.guild);
                await interaction.reply({ content: `**Preview:**\n\n${content}`, flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        if (customId === 'booster_test') {
            if (!guildConfig.channel) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Please set a notification channel first!', flags: MessageFlags.Ephemeral });
                return true;
            }

            const channel = interaction.guild.channels.cache.get(guildConfig.channel);
            if (!channel) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Notification channel not found!', flags: MessageFlags.Ephemeral });
                return true;
            }

            try {
                if (guildConfig.boostMessage.embed) {
                    const embed = createBoostEmbed(guildConfig, interaction.member, interaction.guild);
                    await channel.send({ content: '-# 🧪 Test Notification', embeds: [embed] });
                } else {
                    const content = formatMessage(guildConfig.boostMessage.content, interaction.member, interaction.guild);
                    await channel.send({ content: `${content}\n\n-# 🧪 This is a test notification` });
                }
                await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Test notification sent to <#${channel.id}>!`, flags: MessageFlags.Ephemeral });
            } catch (error) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to send test notification. Check bot permissions!', flags: MessageFlags.Ephemeral });
            }
            return true;
        }

        if (customId === 'booster_help') {
            const helpText = `# 💜 Booster Notifications

## Quick Setup
\`\`\`
1. Set Channel      →  Where to post boost alerts
2. Edit Message     →  Customize your thank you
3. Enable           →  Turn on notifications
\`\`\`

## Message Variables
| Variable | Description |
|----------|-------------|
| \`{user}\` | @Mentions the booster |
| \`{username}\` | Booster's display name |
| \`{tag}\` | Full user tag (User#0000) |
| \`{server}\` | Your server name |
| \`{boostCount}\` | Total server boosts |
| \`{boostTier}\` | Boost level (0-3) |

## Available Features
- **Channel Alert** - Public thank you message
- **DM Thank You** - Private appreciation message
- **Unboost Alert** - Notify when boost expires
- **Embed Mode** - Rich formatted notifications

## Embed Customization
- Custom color, title, description
- Footer text and image
- Thumbnail and banner image

## Pro Tips
- Use embed mode for a polished look
- Add a celebratory GIF for extra flair
- DM messages create personal connection
- Preview before enabling

-# Boost events are detected automatically`;
            
            await interaction.reply({ content: helpText, flags: MessageFlags.Ephemeral });
            return true;
        }

        return false;
    },

    loadConfig,
    saveConfig,
    getDefaultGuildConfig,
    formatMessage,
    createBoostEmbed
};
