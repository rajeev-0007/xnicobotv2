'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { formatTime } = require('../../utils/musicHelpers');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager, seconds) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const t = player.queue.current;
    if (!t.info.duration || t.info.isStream) {
        return replyMusic(target, musicError('Cannot Seek', 'Seeking is not supported on live streams.'), { ephemeral: isSlash });
    }
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 600) {
        return replyMusic(target, musicError('Invalid Input', 'Provide a value between 1 and 600 seconds.'), { ephemeral: isSlash });
    }

    const newPosition = Math.min(t.info.duration - 1000, (player.position || 0) + seconds * 1000);
    await player.seek(Math.max(0, newPosition));

    return replyMusic(target, musicSuccess(
        'Fast Forward',
        `Moved forward **${seconds}s**.`,
        `Position: \`${formatTime(newPosition)}\` / \`${formatTime(t.info.duration)}\``
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('forward')
        .setDescription('Skip forward in the current track')
        .addIntegerOption(o => o.setName('seconds')
            .setDescription('Seconds to skip forward (1-600, default 10)')
            .setMinValue(1).setMaxValue(600)),

    prefix: 'forward',
    description: 'Skip forward in the current track',
    usage: 'forward [seconds]',
    category: 'music',
    aliases: ['ff', 'fwd'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getInteger('seconds') || 10);
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, parseInt(args[0]) || 10);
    },
};
