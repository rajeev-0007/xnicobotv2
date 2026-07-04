
const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');

const editedMessages = new Map();
const MAX_SNIPES = 15;              // keep the last 15 edited messages per channel
const MAX_TRACKED_CHANNELS = 5000;  // bound memory across many channels

function buildNavRow(index, total) {
    const row = new ActionRowBuilder();
    row.addComponents(
        new ButtonBuilder()
            .setCustomId(`esnipenav_${index - 1}`)
            .setEmoji('<:Caretleft:1521227977495543838>')
            .setLabel('Prev')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index <= 1),
        new ButtonBuilder()
            .setCustomId('esnipenav_info')
            .setLabel(`${index} / ${total}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`esnipenav_${index + 1}`)
            .setEmoji('<:Caretright:1521227704953864202>')
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index >= total),
    );
    return row;
}

function buildEditSnipeContainer(snipedMessage, index, total) {
    const timestamp = Math.floor(snipedMessage.editedAt / 1000);
    const avatarUrl = snipedMessage.authorAvatar || `https://cdn.discordapp.com/embed/avatars/${(parseInt(snipedMessage.authorId) >> 22) % 6}.png`;
    const indexLabel = total > 1 ? ` (${index}/${total})` : '';

    const container = new ContainerBuilder().setAccentColor(COLORS.PRIMARY);

    container.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### <:Editalt:1521227921673556019> Edit Sniped Message${indexLabel}\n` +
                    `**${snipedMessage.author}** · <t:${timestamp}:R>`
                )
            )
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const before = snipedMessage.before ? (snipedMessage.before.length > 900 ? snipedMessage.before.slice(0, 900) + '...' : snipedMessage.before) : '*[No text content]*';
    const after = snipedMessage.after ? (snipedMessage.after.length > 900 ? snipedMessage.after.slice(0, 900) + '...' : snipedMessage.after) : '*[No text content]*';

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Before:**\n${before}\n\n**After:**\n${after}`));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    if (total > 1) {
        container.addActionRowComponents(buildNavRow(index, total));
    }

    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('editsnipe')
        .setDescription('View recently edited messages in this channel')
        .addIntegerOption(opt => opt.setName('index').setDescription('Which edited message to view (1 = most recent)').setMinValue(1).setMaxValue(MAX_SNIPES).setRequired(false)),

    prefix: 'editsnipe',
    description: 'View recently edited messages in this channel',
    usage: 'editsnipe [index]',
    category: 'utility',
    aliases: ['esnipe'],

    async execute(interaction) {
        const channelId = interaction.channel.id;
        const snipes = getValidSnipes(channelId);
        const index = (interaction.options.getInteger('index') || 1);

        if (!snipes.length) {
            const container = new ContainerBuilder().setAccentColor(COLORS.ERROR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> No Edited Messages\n\nThere are no recently edited messages in this channel.\n-# The last 15 edited messages are kept.'));
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        if (index > snipes.length) {
            const container = new ContainerBuilder().setAccentColor(COLORS.ERROR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Invalid Index\n\nOnly **${snipes.length}** sniped edit(s) available. Use \`/editsnipe index:1-${snipes.length}\`.`));
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const snipedMessage = snipes[index - 1];
        await interaction.reply({ components: [buildEditSnipeContainer(snipedMessage, index, snipes.length)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async executePrefix(message, args) {
        const channelId = message.channel.id;
        const snipes = getValidSnipes(channelId);
        const index = parseInt(args[0]) || 1;

        if (!snipes.length) {
            const container = new ContainerBuilder().setAccentColor(COLORS.ERROR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> No Edited Messages\n\nThere are no recently edited messages in this channel.\n-# The last 15 edited messages are kept.'));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (index < 1 || index > snipes.length) {
            const container = new ContainerBuilder().setAccentColor(COLORS.ERROR)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Invalid Index\n\nOnly **${snipes.length}** sniped edit(s) available. Use \`editsnipe 1-${snipes.length}\`.`));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const snipedMessage = snipes[index - 1];
        await message.reply({ components: [buildEditSnipeContainer(snipedMessage, index, snipes.length)], flags: MessageFlags.IsComponentsV2 });
    },

    // Prev/Next pagination through the last edited messages.
    async handleButton(interaction) {
        if (!interaction.customId.startsWith('esnipenav_')) return false;
        if (interaction.customId === 'esnipenav_info') {
            await interaction.deferUpdate().catch(() => {});
            return true;
        }

        const snipes = getValidSnipes(interaction.channel.id);
        if (!snipes.length) {
            await interaction.update({
                components: [new ContainerBuilder().setAccentColor(COLORS.ERROR)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> No Edited Messages\n\nThere are no edited messages to show.'))],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
            return true;
        }

        let index = parseInt(interaction.customId.split('_')[1]) || 1;
        index = Math.max(1, Math.min(index, snipes.length));

        await interaction.update({
            components: [buildEditSnipeContainer(snipes[index - 1], index, snipes.length)],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => {});
        return true;
    },

    saveEditedMessage(oldMessage, newMessage) {
        if (newMessage.author?.bot) return;
        if (!newMessage.author) return;
        if (oldMessage.content === newMessage.content) return;

        const channelId = newMessage.channel.id;
        if (!editedMessages.has(channelId)) {
            if (editedMessages.size >= MAX_TRACKED_CHANNELS) {
                editedMessages.delete(editedMessages.keys().next().value);
            }
            editedMessages.set(channelId, []);
        }
        const snipes = editedMessages.get(channelId);

        snipes.unshift({
            author: newMessage.author.displayName || newMessage.author.username,
            authorId: newMessage.author.id,
            authorAvatar: newMessage.author.displayAvatarURL({ size: 128 }),
            before: oldMessage.content || null,
            after: newMessage.content || null,
            editedAt: Date.now()
        });

        if (snipes.length > MAX_SNIPES) snipes.length = MAX_SNIPES;
    }
};

function getValidSnipes(channelId) {
    return editedMessages.get(channelId) || [];
}
