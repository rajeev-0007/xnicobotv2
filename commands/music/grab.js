'use strict';

const {
    SlashCommandBuilder,
    ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
    SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { formatTime } = require('../../utils/musicHelpers');
const { } = require('../../utils/responseBuilder');
const {
    musicSuccess, musicError, replyMusic, COLOR } = require('../../utils/musicResponse');

function buildTrackDmContainer(track, guildName) {
    const container = new ContainerBuilder().setAccentColor(COLOR.BRAND);

    const body =
        `**${track.info.title}**\n\n` +
        `**Artist:** ${track.info.author || 'Unknown'}\n` +
        `**Duration:** ${formatTime(track.info.duration || 0)}\n` +
        `**Server:** ${guildName}\n` +
        (track.info.uri ? `**Link:** ${track.info.uri}` : '**Link:** _not available_');

    if (track.info.artworkUrl) {
        const section = new SectionBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Music:1521228141543165982> Saved Track`))
            .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: track.info.artworkUrl } }));
        container
            .addSectionComponents(section)
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Music:1521228141543165982> Saved Track\n\n${body}`));
    }

    container
;
    return container;
}

async function run(target, lavalinkManager) {
    const isSlash = typeof target.isRepliable === 'function';
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const user    = isSlash ? target.user : target.author;

    if (!player || !player.queue?.current) {
        return replyMusic(target, musicError('No Track Playing', 'There is no current track to grab.'), { ephemeral: isSlash });
    }

    const track = player.queue.current;
    const dmContainer = buildTrackDmContainer(track, target.guild.name);

    try {
        await user.send({ components: [dmContainer], flags: require('discord.js').MessageFlags.IsComponentsV2 });
    } catch {
        return replyMusic(target, musicError(
            'DM Failed',
            'I could not send you a direct message.',
            'Open your DMs from server members and try again.'
        ), { ephemeral: isSlash });
    }

    return replyMusic(target, musicSuccess(
        'Track Saved',
        'Track details were sent to your DMs.',
    ), { ephemeral: isSlash });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('grab')
        .setDescription('Save the current track info to your DMs'),

    prefix: 'grab',
    description: 'Save the current track info to your DMs',
    usage: 'grab',
    category: 'music',
    aliases: ['save', 'snatch'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); } };
