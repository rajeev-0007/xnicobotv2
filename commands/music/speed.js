'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager, raw) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const speed = Number.parseFloat(raw);
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 3.0) {
        return replyMusic(target, musicError(
            'Invalid Speed',
            'Speed must be between **0.25** and **3.0**.',
            'Examples: `0.5` half speed · `1.0` normal · `1.5` faster'
        ), { ephemeral: isSlash });
    }

    try {
        await player.filterManager.setTimescale({ speed });
        return replyMusic(target, musicSuccess(
            'Playback Speed',
            `Speed set to **${speed.toFixed(2)}x**.`,
            'Use `1.0` to restore normal speed.'
        ));
    } catch {
        return replyMusic(target, musicError('Filter Failed', 'Could not change speed. The audio engine may not support this filter.'), { ephemeral: isSlash });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('speed')
        .setDescription('Change playback speed (0.25 - 3.0)')
        .addNumberOption(o => o.setName('value')
            .setDescription('Speed value (0.25 - 3.0, default 1.0)')
            .setRequired(true).setMinValue(0.25).setMaxValue(3.0)),

    prefix: 'speed',
    description: 'Change playback speed',
    usage: 'speed <0.25-3.0>',
    category: 'music',
    aliases: ['playbackspeed'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getNumber('value'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args[0]);
    },
};
