'use strict';

const {
    SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder,
    SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize,
    ChannelType, MessageFlags
} = require('discord.js');
const {
    buildPermissionDenied, buildErrorResponse, buildLoadingResponse,
} = require('../../utils/responseBuilder');

const CHANNEL_TYPE_LABELS = {
    [ChannelType.GuildText]:        '<:Hashtag:1521227771957870604> Text',
    [ChannelType.GuildVoice]:       '<:Volumeup:1521228004502536272> Voice',
    [ChannelType.GuildAnnouncement]:'<:Bookopen:1521227911137595605> Announcement',
    [ChannelType.GuildStageVoice]:  '<:Volumeup:1521228004502536272> Stage',
    [ChannelType.GuildForum]:       '<:Document:1521227875016114266> Forum',
    [ChannelType.GuildMedia]:       '<:Document:1521227875016114266> Media',
};

function describeType(channel) {
    return CHANNEL_TYPE_LABELS[channel.type] || '<:Document:1521227875016114266> Channel';
}

function buildResultContainer(originalChannel, clonedChannel, actorName) {
    const guild = originalChannel.guild;
    const iconUrl = guild?.iconURL?.({ size: 256 }) || null;

    const headerSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <:Checkedbox:1521227734943269077> Channel Cloned\n` +
                `-# Settings, permissions, and topic copied from the source`
            )
        );
    if (iconUrl) headerSection.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: iconUrl } }));

    const details =
        `### <:Folderopen:1521227986966417642> Source\n` +
        `<:Caretright:1521227704953864202> **Channel:** ${originalChannel}\n` +
        `<:Caretright:1521227704953864202> **Type:** ${describeType(originalChannel)}\n` +
        `<:Caretright:1521227704953864202> **ID:** \`${originalChannel.id}\`\n\n` +
        `### <:Document:1521227875016114266> Clone\n` +
        `<:Caretright:1521227704953864202> **Channel:** ${clonedChannel}\n` +
        `<:Caretright:1521227704953864202> **Type:** ${describeType(clonedChannel)}\n` +
        `<:Caretright:1521227704953864202> **ID:** \`${clonedChannel.id}\``;

    const meta =
        `### <:User:1521227714227343380> Performed By\n` +
        `<:Caretright:1521227704953864202> **Moderator:** ${actorName}\n` +
        `<:Caretright:1521227704953864202> **Cloned:** <t:${Math.floor(Date.now() / 1000)}:R>`;

    return new ContainerBuilder()
        .setAccentColor(0x57F287)
        .addSectionComponents(headerSection)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(details))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(meta))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

function isCloneable(channel) {
    return channel?.guild
        && typeof channel.clone === 'function'
        && channel.type !== ChannelType.GuildCategory; // categories use a different flow
}

async function performClone(channel, customName, actor) {
    const cloneName = customName?.trim() || `${channel.name}-clone`;
    return channel.clone({
        name: cloneName.slice(0, 100),
        reason: `Cloned by ${actor}`,
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('channelclone')
        .setDescription('Clone a channel along with its settings and permission overwrites')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to clone (defaults to the current channel)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('name')
                .setDescription('Custom name for the cloned channel')
                .setMaxLength(100)
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

    prefix: 'channelclone',
    description: 'Clone a channel along with its settings and permission overwrites',
    usage: 'channelclone [#channel] [name]',
    category: 'admin',
    permissions: ['ManageChannels'],

    async execute(interaction) {
        try {
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
            const customName = interaction.options.getString('name');

            if (!isCloneable(targetChannel)) {
                const container = buildErrorResponse(
                    'Cannot Clone',
                    'This channel type cannot be cloned (categories and DMs are not supported).',
                    'Try cloning a text, voice, announcement, or forum channel instead.'
                );
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            const loading = buildLoadingResponse('Cloning Channel', `Copying ${targetChannel}…`, 'This usually completes in a second or two.');
            await interaction.reply({ components: [loading], flags: MessageFlags.IsComponentsV2 });

            const cloned = await performClone(targetChannel, customName, interaction.user.username);
            const result = buildResultContainer(targetChannel, cloned, interaction.user.username);
            await interaction.editReply({ components: [result], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[CHANNELCLONE] Slash error:', error);
            const container = buildErrorResponse('Clone Failed', 'Could not clone the channel.', error.message);
            const fn = interaction.replied || interaction.deferred ? interaction.editReply : interaction.reply;
            await fn.call(interaction, { components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        if (!message.guild) {
            return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        }
        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            const container = buildPermissionDenied('Manage Channels');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const targetChannel = message.mentions.channels.first() || message.channel;
        const customName = args.filter(a => !/^<#\d+>$/.test(a)).join(' ').trim();

        if (!isCloneable(targetChannel)) {
            const container = buildErrorResponse(
                'Cannot Clone',
                'This channel type cannot be cloned (categories and DMs are not supported).',
                'Try cloning a text, voice, announcement, or forum channel instead.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const loading = buildLoadingResponse('Cloning Channel', `Copying ${targetChannel}…`, 'This usually completes in a second or two.');
        const loadingMsg = await message.reply({ components: [loading], flags: MessageFlags.IsComponentsV2 });

        try {
            const cloned = await performClone(targetChannel, customName, message.author.username);
            const result = buildResultContainer(targetChannel, cloned, message.author.username);
            await loadingMsg.edit({ components: [result], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[CHANNELCLONE] Prefix error:', error);
            const container = buildErrorResponse('Clone Failed', 'Could not clone the channel.', error.message);
            await loadingMsg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },
};
