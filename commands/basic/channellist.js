const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ChannelType, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');

function buildChannelListContainer(guild) {
    const channels = guild.channels.cache;

    const counts = {
        text: channels.filter(c => c.type === ChannelType.GuildText).size,
        voice: channels.filter(c => c.type === ChannelType.GuildVoice).size,
        category: channels.filter(c => c.type === ChannelType.GuildCategory).size,
        announcement: channels.filter(c => c.type === ChannelType.GuildAnnouncement).size,
        stage: channels.filter(c => c.type === ChannelType.GuildStageVoice).size,
        forum: channels.filter(c => c.type === ChannelType.GuildForum).size,
        thread: channels.filter(c => [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(c.type)).size,
    };

    const container = new ContainerBuilder().setAccentColor(COLORS.INFO);

    const iconUrl = guild.iconURL({ size: 256 });
    const headerSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Folder:1521228095225331765> ${guild.name} — Channels`)
        );
    if (iconUrl) {
        headerSection.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: iconUrl } }));
    }
    container.addSectionComponents(headerSection);

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    const lines = [
        `**Total Channels:** ${channels.size}`,
        ``,
        `<:Edit:1521227886634205298> **Text:** ${counts.text}`,
        `<:Volumeup:1521228004502536272> **Voice:** ${counts.voice}`,
        `<:Folderopen:1521227986966417642> **Categories:** ${counts.category}`,
        `<:Bullhorn:1521227936575914016> **Announcements:** ${counts.announcement}`,
        `<:Userplus:1521227719621218477> **Stage:** ${counts.stage}`,
        `<:Hashtag:1521227771957870604> **Forums:** ${counts.forum}`,
    ];
    if (counts.thread > 0) lines.push(`🧵 **Threads:** ${counts.thread}`);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    return container;
}

module.exports = {
    prefix: 'channellist',
    description: 'View channel statistics for the server',
    usage: 'channellist',
    category: 'basic',
    aliases: ['channels', 'clist'],

    data: new SlashCommandBuilder()
        .setName('channellist')
        .setDescription('View channel statistics for the server'),

    async execute(interaction) {
        try {
            const container = buildChannelListContainer(interaction.guild);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error(`[CHANNELLIST] Error:`, error);
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
            const container = buildChannelListContainer(message.guild);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error(`[CHANNELLIST] Error:`, error);
            await message.reply('<:Cancel:1521227723916181644> An error occurred while running this command.').catch(() => {});
        }
    }
};
