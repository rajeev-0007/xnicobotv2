const { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle, 
    ContainerBuilder, 
    TextDisplayBuilder, 
    SeparatorBuilder,
    SeparatorSpacingSize,
    SectionBuilder,
    ThumbnailBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    EmbedBuilder,
    MessageFlags
} = require('discord.js');

const messageBuilderSessions = new Map();

const MESSAGE_BUILDER_ACTIONS = [
    'mode_simple', 'mode_embed', 'mode_components', 'channel', 'title', 'description', 
    'color', 'author', 'content', 'image', 'thumbnail', 'footer', 
    'addfield', 'clearfields', 'preview', 'save', 'cancel'
];

function extractPrefixFromCustomId(customId) {
    // Check _modal_<action> patterns first (longer suffix, more specific)
    // This prevents _modal_title from matching just _title and corrupting the prefix
    for (const action of MESSAGE_BUILDER_ACTIONS) {
        const modalSuffix = '_modal_' + action;
        if (customId.endsWith(modalSuffix)) {
            return customId.slice(0, -modalSuffix.length);
        }
    }
    // Then check _<action> patterns for button interactions
    for (const action of MESSAGE_BUILDER_ACTIONS) {
        const suffix = '_' + action;
        if (customId.endsWith(suffix)) {
            return customId.slice(0, -suffix.length);
        }
    }
    return customId;
}

function getDefaultMessageData() {
    return {
        mode: 'simple',
        content: '',
        title: '',
        description: '',
        color: '#bcf1e4',
        image: '',
        thumbnail: '',
        footer: '',
        footerIcon: '',
        author: '',
        authorIcon: '',
        fields: [],
        channelId: ''
    };
}

function replacePlaceholders(text, user, guild, channel) {
    if (!text || typeof text !== 'string') return text || '';
    
    const replacements = {
        '{user}': user ? `<@${user.id}>` : '',
        '{username}': user?.username || '',
        '{displayname}': user?.displayName || user?.username || '',
        '{userid}': user?.id || '',
        '{useravatar}': user?.displayAvatarURL({ size: 256 }) || '',
        '{server}': guild?.name || '',
        '{servername}': guild?.name || '',
        '{serverid}': guild?.id || '',
        '{servericon}': guild?.iconURL({ size: 256 }) || '',
        '{membercount}': guild?.memberCount?.toLocaleString() || '0',
        '{channel}': channel ? `<#${channel.id}>` : '',
        '{channelname}': channel?.name || '',
        '{boostcount}': guild?.premiumSubscriptionCount?.toString() || '0',
        '{boostlevel}': guild?.premiumTier?.toString() || '0',
        '{date}': new Date().toLocaleDateString(),
        '{time}': new Date().toLocaleTimeString(),
        '{timestamp}': `<t:${Math.floor(Date.now() / 1000)}:F>`
    };
    
    let result = text;
    for (const [placeholder, value] of Object.entries(replacements)) {
        result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'gi'), value);
    }
    
    return result;
}

function buildActionPreviewSection(container, data) {
    const mode = data.mode || 'simple';

    if (mode === 'components') {
        if (!data.content) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('-# <:Lightbulbalt:1521227880703463675> Click **Content** to start building')
            );
            return;
        }
        const displayContent = data.content.length > 800 ? data.content.substring(0, 800) + '...' : data.content;
        if (data.thumbnail) {
            container.addSectionComponents(
                new SectionBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(displayContent))
                    .setThumbnailAccessory(new ThumbnailBuilder().setURL(data.thumbnail))
            );
        } else {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(displayContent));
        }
        if (data.image) {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(data.image))
            );
        }
        if (data.fields?.length > 0) {
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            for (const field of data.fields.slice(0, 6)) {
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`**${field.name}**\n${field.value}`)
                );
            }
            if (data.fields.length > 6) {
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`-# *...and ${data.fields.length - 6} more fields*`)
                );
            }
        }
        if (data.footer) {
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${data.footer}`));
        }
    } else if (mode === 'embed') {
        if (!data.title && !data.description) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('-# <:Lightbulbalt:1521227880703463675> Click **Title** or **Description** to start building')
            );
            return;
        }
        let previewText = '';
        if (data.author) previewText += `> -# ${data.author}\n`;
        if (data.title) previewText += `> ### ${data.title}\n`;
        if (data.description) {
            const desc = data.description.length > 600 ? data.description.substring(0, 600) + '...' : data.description;
            previewText += desc.split('\n').map(l => `> ${l}`).join('\n') + '\n';
        }
        if (data.fields?.length > 0) {
            previewText += '> \n';
            for (const field of data.fields.slice(0, 6)) {
                previewText += `> **${field.name}**\n> ${field.value}\n`;
            }
            if (data.fields.length > 6) previewText += `> -# *...and ${data.fields.length - 6} more fields*\n`;
        }
        if (data.footer) previewText += `> \n> -# ${data.footer}`;
        if (previewText) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(previewText));
        const mediaUrls = [data.thumbnail, data.image].filter(Boolean);
        if (mediaUrls.length > 0) {
            const gallery = new MediaGalleryBuilder();
            for (const url of mediaUrls) gallery.addItems(new MediaGalleryItemBuilder().setURL(url));
            container.addMediaGalleryComponents(gallery);
        }
    } else {
        if (!data.content) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent('-# <:Lightbulbalt:1521227880703463675> Click **Edit Content** to start building')
            );
            return;
        }
        const displayContent = data.content.length > 800 ? data.content.substring(0, 800) + '...' : data.content;
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(displayContent));
    }
}

function buildMessageBuilderPanel(data, prefix, context) {
    const mode = data.mode || 'simple';
    const isEmbed = mode === 'embed';
    const isComponents = mode === 'components';
    
    const modeLabels = { simple: '<:Hashtag:1521227771957870604> Simple', embed: '<:Document:1521227875016114266> Embed', components: '<:Fire:1521227907647668374> Components V2' };
    
    let header = `# <:Editalt:1521227921673556019> Message Builder\n`;
    header += `**For:** ${context} \u2022 **Mode:** ${modeLabels[mode] || modeLabels.simple} \u2022 **Channel:** ${data.channelId ? `<#${data.channelId}>` : 'Current'}`;

    const container = new ContainerBuilder()
        .setAccentColor(parseInt((data.color || '#bcf1e4').replace('#', ''), 16))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

    // The preview IS the panel
    buildActionPreviewSection(container, data);

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${prefix}_mode_simple`)
            .setLabel('Simple')
            .setStyle(mode === 'simple' ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('<:Hashtag:1521227771957870604>'),
        new ButtonBuilder()
            .setCustomId(`${prefix}_mode_embed`)
            .setLabel('Embed')
            .setStyle(mode === 'embed' ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('<:Document:1521227875016114266>'),
        new ButtonBuilder()
            .setCustomId(`${prefix}_mode_components`)
            .setLabel('Components V2')
            .setStyle(mode === 'components' ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('<:Fire:1521227907647668374>'),
        new ButtonBuilder()
            .setCustomId(`${prefix}_channel`)
            .setLabel('Channel')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Pin:1521227932625014916>')
    );

    let row2;
    if (isComponents) {
        row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${prefix}_content`)
                .setLabel('Content')
                .setStyle(data.content ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Editalt:1521227921673556019>'),
            new ButtonBuilder()
                .setCustomId(`${prefix}_color`)
                .setLabel('Accent Color')
                .setStyle(data.color && data.color !== '#bcf1e4' ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Palette:1521227950601539755>'),
            new ButtonBuilder()
                .setCustomId(`${prefix}_image`)
                .setLabel('Banner')
                .setStyle(data.image ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Picture:1521227954191995024>'),
            new ButtonBuilder()
                .setCustomId(`${prefix}_thumbnail`)
                .setLabel('Thumbnail')
                .setStyle(data.thumbnail ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Copy:1521227960554881084>'),
            new ButtonBuilder()
                .setCustomId(`${prefix}_footer`)
                .setLabel('Footer')
                .setStyle(data.footer ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Attach:1521228039135170722>')
        );
    } else if (isEmbed) {
        row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${prefix}_title`)
                .setLabel('Title')
                .setStyle(data.title ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Edit:1521227886634205298>'),
            new ButtonBuilder()
                .setCustomId(`${prefix}_description`)
                .setLabel('Description')
                .setStyle(data.description ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Clipboardalt:1521228169753923755>'),
            new ButtonBuilder()
                .setCustomId(`${prefix}_color`)
                .setLabel('Color')
                .setStyle(data.color && data.color !== '#bcf1e4' ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Palette:1521227950601539755>'),
            new ButtonBuilder()
                .setCustomId(`${prefix}_author`)
                .setLabel('Author')
                .setStyle(data.author ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:User:1521227714227343380>')
        );
    } else {
        row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${prefix}_content`)
                .setLabel('Edit Content')
                .setStyle(data.content ? ButtonStyle.Success : ButtonStyle.Primary)
                .setEmoji('<:Editalt:1521227921673556019>')
        );
    }

    let row3;
    if (isEmbed) {
        row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${prefix}_image`)
                .setLabel('Image')
                .setStyle(data.image ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Picture:1521227954191995024>'),
            new ButtonBuilder()
                .setCustomId(`${prefix}_thumbnail`)
                .setLabel('Thumbnail')
                .setStyle(data.thumbnail ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Copy:1521227960554881084>'),
            new ButtonBuilder()
                .setCustomId(`${prefix}_footer`)
                .setLabel('Footer')
                .setStyle(data.footer ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Attach:1521228039135170722>'),
            new ButtonBuilder()
                .setCustomId(`${prefix}_addfield`)
                .setLabel(`Fields (${data.fields?.length || 0})`)
                .setStyle(data.fields?.length ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Add:1521227828199293152>')
        );
    } else if (isComponents) {
        row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`${prefix}_addfield`)
                .setLabel(`Fields (${data.fields?.length || 0})`)
                .setStyle(data.fields?.length ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setEmoji('<:Add:1521227828199293152>')
        );
        if (data.fields?.length) {
            row3.addComponents(
                new ButtonBuilder()
                    .setCustomId(`${prefix}_clearfields`)
                    .setLabel('Clear Fields')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('<:Trash:1521227750420254820>')
            );
        }
    }

    const rowActions = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`${prefix}_preview`)
            .setLabel('Preview')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Eye:1521227940480815156>'),
        new ButtonBuilder()
            .setCustomId(`${prefix}_save`)
            .setLabel('Save Action')
            .setStyle(ButtonStyle.Success)
            .setEmoji('<:Save:1521228186229276734>'),
        new ButtonBuilder()
            .setCustomId(`${prefix}_cancel`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('<:Cancel:1521227723916181644>')
    );

    container.addActionRowComponents(row1, row2);
    if (row3) container.addActionRowComponents(row3);
    container.addActionRowComponents(rowActions);

    return container;
}

function buildPreviewEmbed(data, user, guild, channel) {
    const embed = new EmbedBuilder();
    
    if (data.title) embed.setTitle(replacePlaceholders(data.title, user, guild, channel));
    if (data.description) embed.setDescription(replacePlaceholders(data.description, user, guild, channel));
    if (data.color) embed.setColor(data.color);
    if (data.image) {
        const processedImage = replacePlaceholders(data.image, user, guild, channel);
        if (processedImage) embed.setImage(processedImage);
    }
    if (data.thumbnail) {
        const processedThumb = replacePlaceholders(data.thumbnail, user, guild, channel);
        if (processedThumb) embed.setThumbnail(processedThumb);
    }
    
    if (data.author) {
        const authorOpts = { name: replacePlaceholders(data.author, user, guild, channel) };
        if (data.authorIcon) authorOpts.iconURL = replacePlaceholders(data.authorIcon, user, guild, channel);
        embed.setAuthor(authorOpts);
    }
    
    if (data.footer) {
        const footerOpts = { text: replacePlaceholders(data.footer, user, guild, channel) };
        if (data.footerIcon) footerOpts.iconURL = replacePlaceholders(data.footerIcon, user, guild, channel);
        embed.setFooter(footerOpts);
    }
    
    if (data.fields && data.fields.length > 0) {
        for (const field of data.fields.slice(0, 25)) {
            embed.addFields({
                name: replacePlaceholders(field.name, user, guild, channel),
                value: replacePlaceholders(field.value, user, guild, channel),
                inline: field.inline || false
            });
        }
    }
    
    return embed;
}

function getSessionKey(userId, type, id1, id2) {
    return `${userId}:${type}:${id1}:${id2 || ''}`;
}

function getSession(userId, type, id1, id2) {
    return messageBuilderSessions.get(getSessionKey(userId, type, id1, id2));
}

function setSession(userId, type, id1, id2, data) {
    messageBuilderSessions.set(getSessionKey(userId, type, id1, id2), data);
}

function deleteSession(userId, type, id1, id2) {
    messageBuilderSessions.delete(getSessionKey(userId, type, id1, id2));
}

async function handleButtonInteraction(interaction, prefix, type, id1, id2, onSave, onCancel) {
    const customId = interaction.customId;
    if (!customId.startsWith(prefix + '_')) return false;
    
    const action = customId.replace(prefix + '_', '');
    const sessionKey = getSessionKey(interaction.user.id, type, id1, id2);
    let data = messageBuilderSessions.get(sessionKey);
    
    if (!data) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> Session expired! Start again.', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'mode_simple') {
        data.mode = 'simple';
        messageBuilderSessions.set(sessionKey, data);
        const container = buildMessageBuilderPanel(data, prefix, data.context);
        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'mode_embed') {
        data.mode = 'embed';
        messageBuilderSessions.set(sessionKey, data);
        const container = buildMessageBuilderPanel(data, prefix, data.context);
        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'mode_components') {
        data.mode = 'components';
        if (!data.color || data.color === '#bcf1e4') data.color = '#5865F2';
        messageBuilderSessions.set(sessionKey, data);
        const container = buildMessageBuilderPanel(data, prefix, data.context);
        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'channel') {
        const modal = new ModalBuilder()
            .setCustomId(`${prefix}_modal_channel`)
            .setTitle('Set Channel');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('channelId')
                    .setLabel('Channel ID (leave empty for current)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(data.channelId || '')
                    .setRequired(false)
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'content') {
        const modal = new ModalBuilder()
            .setCustomId(`${prefix}_modal_content`)
            .setTitle('Edit Content');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('content')
                    .setLabel('Message Content')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(2000)
                    .setValue(data.content || '')
                    .setRequired(true)
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'title') {
        const modal = new ModalBuilder()
            .setCustomId(`${prefix}_modal_title`)
            .setTitle('Edit Title');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('title')
                    .setLabel('Embed Title')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(256)
                    .setValue(data.title || '')
                    .setRequired(false)
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'description') {
        const modal = new ModalBuilder()
            .setCustomId(`${prefix}_modal_description`)
            .setTitle('Edit Description');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('description')
                    .setLabel('Embed Description')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(4000)
                    .setValue(data.description || '')
                    .setRequired(false)
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'color') {
        const modal = new ModalBuilder()
            .setCustomId(`${prefix}_modal_color`)
            .setTitle('Edit Color');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('color')
                    .setLabel('Embed Color (hex code)')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('#bcf1e4')
                    .setValue(data.color || '#bcf1e4')
                    .setRequired(true)
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'image') {
        const modal = new ModalBuilder()
            .setCustomId(`${prefix}_modal_image`)
            .setTitle('Edit Image');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('image')
                    .setLabel('Image URL')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('https://example.com/image.png')
                    .setValue(data.image || '')
                    .setRequired(false)
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'thumbnail') {
        const modal = new ModalBuilder()
            .setCustomId(`${prefix}_modal_thumbnail`)
            .setTitle('Edit Thumbnail');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('thumbnail')
                    .setLabel('Thumbnail URL')
                    .setStyle(TextInputStyle.Short)
                    .setValue(data.thumbnail || '')
                    .setRequired(false)
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'author') {
        const modal = new ModalBuilder()
            .setCustomId(`${prefix}_modal_author`)
            .setTitle('Edit Author');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('author')
                    .setLabel('Author Name')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(256)
                    .setValue(data.author || '')
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('authorIcon')
                    .setLabel('Author Icon URL')
                    .setStyle(TextInputStyle.Short)
                    .setValue(data.authorIcon || '')
                    .setRequired(false)
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'footer') {
        const modal = new ModalBuilder()
            .setCustomId(`${prefix}_modal_footer`)
            .setTitle('Edit Footer');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('footer')
                    .setLabel('Footer Text')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(2048)
                    .setValue(data.footer || '')
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('footerIcon')
                    .setLabel('Footer Icon URL')
                    .setStyle(TextInputStyle.Short)
                    .setValue(data.footerIcon || '')
                    .setRequired(false)
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'addfield') {
        if (data.fields && data.fields.length >= 25) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Maximum 25 fields!', flags: MessageFlags.Ephemeral });
            return true;
        }
        const modal = new ModalBuilder()
            .setCustomId(`${prefix}_modal_addfield`)
            .setTitle('Add Field');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('name')
                    .setLabel('Field Name')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(256)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('value')
                    .setLabel('Field Value')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1024)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('inline')
                    .setLabel('Inline? (yes/no)')
                    .setStyle(TextInputStyle.Short)
                    .setValue('no')
                    .setRequired(false)
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'clearfields') {
        data.fields = [];
        messageBuilderSessions.set(sessionKey, data);
        const container = buildMessageBuilderPanel(data, prefix, data.context);
        await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return true;
    }

    if (action === 'preview') {
        if (data.mode === 'components') {
            if (!data.content) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Add content first!', flags: MessageFlags.Ephemeral });
                return true;
            }
            const previewContainer = buildComponentsV2Message(data, interaction.user, interaction.guild, interaction.channel);
            await interaction.reply({ components: [previewContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        } else if (data.mode === 'embed') {
            if (!data.title && !data.description) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Add at least a title or description!', flags: MessageFlags.Ephemeral });
                return true;
            }
            const embed = buildPreviewEmbed(data, interaction.user, interaction.guild, interaction.channel);
            await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        } else {
            if (!data.content) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Add content first!', flags: MessageFlags.Ephemeral });
                return true;
            }
            const previewContent = replacePlaceholders(data.content, interaction.user, interaction.guild, interaction.channel);
            await interaction.reply({ content: `**Preview:**\n${previewContent}`, flags: MessageFlags.Ephemeral });
        }
        return true;
    }

    if (action === 'save') {
        if (data.mode === 'components') {
            if (!data.content) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Add content first!', flags: MessageFlags.Ephemeral });
                return true;
            }
        } else if (data.mode === 'embed') {
            if (!data.title && !data.description) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Add at least a title or description!', flags: MessageFlags.Ephemeral });
                return true;
            }
        } else {
            if (!data.content) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Add content first!', flags: MessageFlags.Ephemeral });
                return true;
            }
        }
        await onSave(interaction, data);
        messageBuilderSessions.delete(sessionKey);
        return true;
    }

    if (action === 'cancel') {
        messageBuilderSessions.delete(sessionKey);
        await onCancel(interaction);
        return true;
    }

    return false;
}

async function handleModalSubmit(interaction, prefix, type, id1, id2) {
    const customId = interaction.customId;
    if (!customId.startsWith(`${prefix}_modal_`)) return false;
    
    const modalType = customId.replace(`${prefix}_modal_`, '');
    const sessionKey = getSessionKey(interaction.user.id, type, id1, id2);
    let data = messageBuilderSessions.get(sessionKey);
    
    if (!data) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> Session expired!', flags: MessageFlags.Ephemeral });
        return true;
    }

    if (modalType === 'channel') {
        data.channelId = interaction.fields.getTextInputValue('channelId') || '';
    } else if (modalType === 'content') {
        data.content = interaction.fields.getTextInputValue('content') || '';
    } else if (modalType === 'title') {
        data.title = interaction.fields.getTextInputValue('title') || '';
    } else if (modalType === 'description') {
        data.description = interaction.fields.getTextInputValue('description') || '';
    } else if (modalType === 'color') {
        let color = interaction.fields.getTextInputValue('color') || '#bcf1e4';
        if (!color.startsWith('#')) color = '#' + color;
        data.color = color;
    } else if (modalType === 'image') {
        data.image = interaction.fields.getTextInputValue('image') || '';
    } else if (modalType === 'thumbnail') {
        data.thumbnail = interaction.fields.getTextInputValue('thumbnail') || '';
    } else if (modalType === 'author') {
        data.author = interaction.fields.getTextInputValue('author') || '';
        data.authorIcon = interaction.fields.getTextInputValue('authorIcon') || '';
    } else if (modalType === 'footer') {
        data.footer = interaction.fields.getTextInputValue('footer') || '';
        data.footerIcon = interaction.fields.getTextInputValue('footerIcon') || '';
    } else if (modalType === 'addfield') {
        if (!data.fields) data.fields = [];
        const name = interaction.fields.getTextInputValue('name')?.trim();
        const value = interaction.fields.getTextInputValue('value')?.trim();
        if (!name || !value) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Field name and value cannot be empty.', flags: MessageFlags.Ephemeral });
            return true;
        }
        const inlineVal = interaction.fields.getTextInputValue('inline')?.toLowerCase();
        const inline = inlineVal === 'yes' || inlineVal === 'true' || inlineVal === '1';
        data.fields.push({ name, value, inline });
    }

    messageBuilderSessions.set(sessionKey, data);
    const container = buildMessageBuilderPanel(data, prefix, data.context);
    // Modal submit interactions do NOT support interaction.update() — only component
    // interactions (buttons/selects) support that method. Using update() on a modal
    // submit throws "Unknown interaction" or crashes with INTERACTION_ALREADY_REPLIED.
    // We must use reply() here to send the refreshed builder panel.
    await interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
    return true;
}

function startMessageBuilderSession(userId, type, id1, id2, context) {
    const data = getDefaultMessageData();
    data.context = context;
    const sessionKey = getSessionKey(userId, type, id1, id2);
    messageBuilderSessions.set(sessionKey, data);
    return data;
}

/**
 * Build a Components V2 ContainerBuilder from stored message data.
 * Callers can append additional components (buttons, select menus) to the returned container.
 */
function buildComponentsV2Message(data, user, guild, channel) {
    if (!data) return new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('No data available.'));
    const resolvedContent = replacePlaceholders(data.content || '', user, guild, channel);
    const accentHex = (data.color || '#5865F2').replace('#', '');
    const accentColor = parseInt(accentHex, 16);

    const container = new ContainerBuilder().setAccentColor(accentColor);

    // Thumbnail + text section (if thumbnail is set)
    if (data.thumbnail) {
        const section = new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(resolvedContent)
            )
            .setThumbnailAccessory(
                new ThumbnailBuilder().setURL(data.thumbnail)
            );
        container.addSectionComponents(section);
    } else {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(resolvedContent)
        );
    }

    // Banner image (MediaGallery)
    if (data.image) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(data.image)
            )
        );
    }

    // Footer text
    if (data.footer) {
        const resolvedFooter = replacePlaceholders(data.footer, user, guild, channel);
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`-# ${resolvedFooter}`)
        );
    }

    // Fields
    if (data.fields?.length > 0) {
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
        for (const field of data.fields.slice(0, 25)) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**${replacePlaceholders(field.name, user, guild, channel)}**\n${replacePlaceholders(field.value, user, guild, channel)}`
                )
            );
        }
    }

    return container;
}

module.exports = {
    getDefaultMessageData,
    buildMessageBuilderPanel,
    buildPreviewEmbed,
    buildComponentsV2Message,
    replacePlaceholders,
    handleButtonInteraction,
    handleModalSubmit,
    startMessageBuilderSession,
    getSession,
    setSession,
    deleteSession,
    messageBuilderSessions,
    MESSAGE_BUILDER_ACTIONS,
    extractPrefixFromCustomId
};
