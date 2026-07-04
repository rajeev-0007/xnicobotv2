'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { formatTime } = require('../../utils/musicHelpers');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    // We only need a player + correct VC for previous; the queue may be
    // empty and we still want to play the most recent past track.
    const pre = preflightPlayer({ player, member: target.member, requireCurrent: false });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const prev = player.queue.previous || [];
    const previousTrack = prev[prev.length - 1] || prev[0];
    if (!previousTrack) {
        return replyMusic(target, musicError('No History', 'No previous track to play.'), { ephemeral: isSlash });
    }

    await player.queue.add(previousTrack, 0);
    if (player.queue.current) await player.skip();
    else                       await player.play();

    return replyMusic(target, musicSuccess(
        'Playing Previous Track',
        `**${previousTrack.info.title}**`,
        `Duration: \`${formatTime(previousTrack.info.duration || 0)}\``
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('previous')
        .setDescription('Play the previous track'),

    prefix: 'previous',
    description: 'Play the previous track',
    usage: 'previous',
    category: 'music',
    aliases: ['prev'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); },
};
