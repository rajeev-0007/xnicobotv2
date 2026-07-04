
const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');

const deletedMessages = new Map();
const MAX_SNIPES = 15;              // keep the last 15 deleted messages per channel
const MAX_TRACKED_CHANNELS = 5000;  // bound memory across many channels

function buildNavRow(index, total) {
    // index/total are 1-based. Prev/Next walk through the stored snipes;
    // the middle button is a static page indicator.
    const row = new ActionRowBuilder();
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`snipenav_${index - 1}`)
            .setEmoji('<:Caretleft:1521227977495543838>')
            .setLabel('Prev')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index <= 1),
        new ButtonBuilder()
            .setCustomId('snipenav_info')
            .setLabel(`${index} / ${total}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`snipenav_${index + 1}`)
            .setEmoji('<:Caretright:1521227704953864202>')
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index >= total),
    );
    return row;
}

function buildSnipeContainer(snipedMessage, index, total) {
    const timestamp = Math.floor(snipedMessage.deletedAt / 1000);
    const avatarUrl = snipedMessage.authorAvatar || `https://cdn.discordapp.com/embed/avatars/${(parseInt(snipedMessage.authorId) >> 22) % 6}.png`;
    const indexLabel = total > 1 ? ` (${index}/${total})` : '';

    const container = new ContainerBuilder().setAccentColor(COLORS.PRIMARY);

    // Header with avatar thumbnail
    container.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### <:Search:1521228231263387738> Sniped Message${indexLabel}\n` +
                    `**${snipedMessage.author}** · <t:${timestamp}:R>`
                )
            )
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    // Message content
    const content = snipedMessage.content || null;
    // `embeds` is stored as a count (number); guard for older shapes too.
    const embedCount = typeof snipedMessage.embeds === 'number'
        ? snipedMessage.embeds
        : (snipedMessage.embeds?.length || 0);
    const hasStickers = snipedMessage.stickers?.length > 0;

    let bodyText = '';
    if (content) {
        bodyText += content.length > 1900 ? content.slice(0, 1900) + '...' : content;
    }
    if (hasStickers) {
        bodyText += (bodyText ? '\n\n' : '') + '**Stickers:** ' + snipedMessage.stickers.map(s => '`' + s + '`').join(', ');
    }
    if (embedCount > 0) {
        bodyText += (bodyText ? '\n\n' : '') + '*Message contained ' + embedCount + ' embed(s)*';
    }
    if (!bodyText) bodyText = '*[No text content]*';

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyText));

    // Image attachments in media gallery
    const imageAttachments = (snipedMessage.attachments || []).filter(a => a.contentType?.startsWith('image/'));
    const otherAttachments = (snipedMessage.attachments || []).filter(a => !a.contentType?.startsWith('image/'));

    if (imageAttachments.length > 0) {
        const gallery = new MediaGalleryBuilder();
        for (const img of imageAttachments.slice(0, 10)) {
            gallery.addItems(new MediaGalleryItemBuilder().setURL(img.url));
        }
        container.addMediaGalleryComponents(gallery);
    }

    // Non-image attachments listed as text
    if (otherAttachments.length > 0) {
        const fileList = otherAttachments.map(a => `📎 [${a.name}](${a.url})`).join('\n');
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fileList));
    }

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    // Pagination through the last (up to 10) deleted messages.
    if (total > 1) {
        container.addActionRowComponents(buildNavRow(index, total));
    }

    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('snipe')
        .setDescription('View recently deleted messages in this channel')
        .addIntegerOption(opt => opt.setName('index').setDescription('Which deleted message to view (1 = most recent)').setMinValue(1).setMaxValue(MAX_SNIPES).setRequired(false)),

    prefix: 'snipe',
    description: 'View recently deleted messages in this channel',
    usage: 'snipe [index]',
    category: 'utility',
    aliases: [],

    async execute(interaction) {
        const channelId = interaction.channel.id;
        const snipes = getValidSnipes(channelId);
        const index = (interaction.options.getInteger('index') || 1);

        if (!snipes.length) {
            const container = new ContainerBuilder().setAccentColor(COLORS.ERROR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> No Deleted Messages\n\nThere are no recently deleted messages in this channel.\n-# The last 15 deleted messages are kept.'));
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (index > snipes.length) {
            const container = new ContainerBuilder().setAccentColor(COLORS.ERROR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Invalid Index\n\nOnly **${snipes.length}** sniped message(s) available. Use \`/snipe index:1-${snipes.length}\`.`));
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const snipedMessage = snipes[index - 1];
        await interaction.reply({ components: [buildSnipeContainer(snipedMessage, index, snipes.length)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async executePrefix(message, args) {
        const channelId = message.channel.id;
        const snipes = getValidSnipes(channelId);
        const index = parseInt(args[0]) || 1;

        if (!snipes.length) {
            const container = new ContainerBuilder().setAccentColor(COLORS.ERROR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> No Deleted Messages\n\nThere are no recently deleted messages in this channel.\n-# The last 15 deleted messages are kept.'));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (index < 1 || index > snipes.length) {
            const container = new ContainerBuilder().setAccentColor(COLORS.ERROR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Invalid Index\n\nOnly **${snipes.length}** sniped message(s) available. Use \`snipe 1-${snipes.length}\`.`));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const snipedMessage = snipes[index - 1];
        await message.reply({ components: [buildSnipeContainer(snipedMessage, index, snipes.length)], flags: MessageFlags.IsComponentsV2 });
    },

    // Prev/Next pagination through the last deleted messages.
    async handleButton(interaction) {
        if (!interaction.customId.startsWith('snipenav_')) return false;
        if (interaction.customId === 'snipenav_info') {
            await interaction.deferUpdate().catch(() => {});
            return true;
        }

        const snipes = getValidSnipes(interaction.channel.id);
        if (!snipes.length) {
            await interaction.update({
                components: [new ContainerBuilder().setAccentColor(COLORS.ERROR)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> No Deleted Messages\n\nThere are no deleted messages to show.'))],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
            return true;
        }

        let index = parseInt(interaction.customId.split('_')[1]) || 1;
        index = Math.max(1, Math.min(index, snipes.length));

        await interaction.update({
            components: [buildSnipeContainer(snipes[index - 1], index, snipes.length)],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => {});
        return true;
    },

    saveDeletedMessage(message) {
        if (message.author?.bot) return;
        if (!message.author) return;

        const channelId = message.channel.id;
        if (!deletedMessages.has(channelId)) {
            // Evict the oldest-tracked channel once the cap is hit (Map keeps
            // insertion order) so long-running bots don't grow unbounded.
            if (deletedMessages.size >= MAX_TRACKED_CHANNELS) {
                deletedMessages.delete(deletedMessages.keys().next().value);
            }
            deletedMessages.set(channelId, []);
        }
        const snipes = deletedMessages.get(channelId);

        // ── Detect pings (for the ghostping checker) ──
        // Prefer the resolved mention collections; fall back to parsing the
        // raw content when the deleted message was uncached/partial.
        const users = message.mentions?.users ? [...message.mentions.users.keys()] : [];
        const roles = message.mentions?.roles ? [...message.mentions.roles.keys()] : [];
        let everyone = !!message.mentions?.everyone;
        const raw = message.content || '';
        if (!users.length && !roles.length && !everyone) {
            if (/@everyone|@here/.test(raw)) everyone = true;
            for (const m of raw.matchAll(/<@!?(\d+)>/g)) users.push(m[1]);
            for (const m of raw.matchAll(/<@&(\d+)>/g)) roles.push(m[1]);
        }
        const mentions = { everyone, users: [...new Set(users)].slice(0, 20), roles: [...new Set(roles)].slice(0, 20) };
        const hadMention = everyone || mentions.users.length > 0 || mentions.roles.length > 0;

        snipes.unshift({
            author: message.author.displayName || message.author.username,
            authorId: message.author.id,
            authorAvatar: message.author.displayAvatarURL({ size: 128 }),
            content: message.content || null,
            attachments: message.attachments?.map(a => ({ url: a.url, name: a.name, contentType: a.contentType })) || [],
            embeds: message.embeds?.length || 0,
            stickers: message.stickers?.map(s => s.name) || [],
            mentions,
            hadMention,
            deletedAt: Date.now()
        });

        if (snipes.length > MAX_SNIPES) snipes.length = MAX_SNIPES;
    },

    // Deleted messages that pinged someone — powers the /ghostping command.
    getGhostPings(channelId) {
        return getValidSnipes(channelId).filter(s => s.hadMention);
    }
};

function getValidSnipes(channelId) {
    return deletedMessages.get(channelId) || [];
}
