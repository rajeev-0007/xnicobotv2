'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { parseTime, formatTime } = require('../../utils/musicHelpers');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager, time) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const t = player.queue.current;
    if (!t.info.duration || t.info.isStream) {
        return replyMusic(target, musicError('Cannot Seek', 'Seeking is not supported on live streams.'), { ephemeral: isSlash });
    }
    if (!time) {
        return replyMusic(target, musicError('Missing Time', 'Provide a time. Examples: `90`, `1:30`, `1m30s`.'), { ephemeral: isSlash });
    }

    const ms = parseTime(time);
    if (ms == null || ms < 0) {
        return replyMusic(target, musicError(
            'Invalid Time',
            'Could not parse that time.',
            'Accepted formats: `90` (seconds) · `1:30` · `1:02:30` · `1m30s`'
        ), { ephemeral: isSlash });
    }
    if (ms > t.info.duration) {
        return replyMusic(target, musicError(
            'Out of Bounds',
            `That time is past the end of the track (\`${formatTime(t.info.duration)}\`).`
        ), { ephemeral: isSlash });
    }

    await player.seek(ms);
    return replyMusic(target, musicSuccess(
        'Seeked',
        `**${t.info.title}**`,
        `Position: \`${formatTime(ms)}\` / \`${formatTime(t.info.duration)}\``
    ));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('seek')
        .setDescription('Seek to a specific time in the current track')
        .addStringOption(o => o.setName('time')
            .setDescription('Time to seek to (e.g. 90, 1:30, 1m30s)').setRequired(true)),

    prefix: 'seek',
    description: 'Seek to a specific time in the current track',
    usage: 'seek <time>',
    category: 'music',
    aliases: ['sk', 'goto'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getString('time'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args[0]);
    },
};
