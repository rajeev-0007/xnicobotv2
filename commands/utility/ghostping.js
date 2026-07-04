const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');

// Ghost pings reuse the snipe command's deleted-message store — a ghost
// ping is simply a deleted message that had pinged someone. This keeps a
// single source of truth (no extra event hook / second cache).
function getGhostPings(client, channelId) {
    const snipeCmd = client.commands.get('snipe');
    if (!snipeCmd?.getGhostPings) return [];
    return snipeCmd.getGhostPings(channelId);
}

function pingedText(mentions) {
    const parts = [];
    if (mentions?.everyone) parts.push('`@everyone / @here`');
    if (mentions?.users?.length) parts.push(mentions.users.map(id => `<@${id}>`).join(' '));
    if (mentions?.roles?.length) parts.push(mentions.roles.map(id => `<@&${id}>`).join(' '));
    return parts.join('  ·  ') || '*someone*';
}

function buildNavRow(index, total) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ghostnav_${index - 1}`).setEmoji('<:Caretleft:1521227977495543838>').setLabel('Prev').setStyle(ButtonStyle.Secondary).setDisabled(index <= 1),
        new ButtonBuilder().setCustomId('ghostnav_info').setLabel(`${index} / ${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`ghostnav_${index + 1}`).setEmoji('<:Caretright:1521227704953864202>').setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(index >= total),
    );
}

function buildEmpty() {
    return new ContainerBuilder().setAccentColor(COLORS.ERROR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '# <:Cancel:1521227723916181644> No Ghost Pings\n\nNo one has pinged and deleted a message in this channel recently.\n-# The last 15 deleted messages are checked.'
        ));
}

function buildGhostContainer(g, index, total) {
    const ts = Math.floor(g.deletedAt / 1000);
    const avatarUrl = g.authorAvatar || `https://cdn.discordapp.com/embed/avatars/${(parseInt(g.authorId) >> 22) % 6}.png`;
    const indexLabel = total > 1 ? ` (${index}/${total})` : '';

    const container = new ContainerBuilder().setAccentColor(COLORS.PRIMARY);
    container.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### <:Bullhorn:1521227936575914016> Ghost Ping${indexLabel}\n**${g.author}** · <t:${ts}:R>`
            ))
            .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl))
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    const content = g.content ? (g.content.length > 1500 ? g.content.slice(0, 1500) + '...' : g.content) : '*[No text content]*';
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `**Pinged:** ${pingedText(g.mentions)}\n\n**Message:**\n${content}`
    ));

    if (total > 1) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addActionRowComponents(buildNavRow(index, total));
    }
    return container;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ghostping')
        .setDescription('View recent ghost pings (deleted messages that pinged someone) in this channel')
        .addIntegerOption(opt => opt.setName('index').setDescription('Which ghost ping to view (1 = most recent)').setMinValue(1).setMaxValue(15).setRequired(false)),

    prefix: 'ghostping',
    description: 'View recent ghost pings in this channel',
    usage: 'ghostping [index]',
    category: 'utility',
    aliases: ['ghost', 'gp'],

    async execute(interaction) {
        const snipes = getGhostPings(interaction.client, interaction.channel.id);
        let index = interaction.options.getInteger('index') || 1;
        if (!snipes.length) {
            return interaction.reply({ components: [buildEmpty()], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        index = Math.max(1, Math.min(index, snipes.length));
        await interaction.reply({ components: [buildGhostContainer(snipes[index - 1], index, snipes.length)], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async executePrefix(message, args) {
        const snipes = getGhostPings(message.client, message.channel.id);
        let index = parseInt(args[0]) || 1;
        if (!snipes.length) {
            return message.reply({ components: [buildEmpty()], flags: MessageFlags.IsComponentsV2 });
        }
        index = Math.max(1, Math.min(index, snipes.length));
        await message.reply({ components: [buildGhostContainer(snipes[index - 1], index, snipes.length)], flags: MessageFlags.IsComponentsV2 });
    },

    async handleButton(interaction) {
        if (!interaction.customId.startsWith('ghostnav_')) return false;
        if (interaction.customId === 'ghostnav_info') {
            await interaction.deferUpdate().catch(() => {});
            return true;
        }
        const snipes = getGhostPings(interaction.client, interaction.channel.id);
        if (!snipes.length) {
            await interaction.update({ components: [buildEmpty()], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
            return true;
        }
        let index = parseInt(interaction.customId.split('_')[1]) || 1;
        index = Math.max(1, Math.min(index, snipes.length));
        await interaction.update({ components: [buildGhostContainer(snipes[index - 1], index, snipes.length)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        return true;
    }
};
