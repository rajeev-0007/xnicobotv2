'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

async function run(target, lavalinkManager, raw) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const pitch = Number.parseFloat(raw);
    if (!Number.isFinite(pitch) || pitch < 0.5 || pitch > 2.0) {
        return replyMusic(target, musicError(
            'Invalid Pitch',
            'Pitch must be between **0.5** and **2.0**.',
            'Examples: `0.8` lower · `1.0` normal · `1.3` higher'
        ), { ephemeral: isSlash });
    }

    try {
        await player.filterManager.setTimescale({ pitch });
        return replyMusic(target, musicSuccess(
            'Track Pitch',
            `Pitch set to **${pitch.toFixed(2)}x**.`,
            'Use `1.0` to restore normal pitch.'
        ));
    } catch {
        return replyMusic(target, musicError('Filter Failed', 'Could not change pitch. The audio engine may not support this filter.'), { ephemeral: isSlash });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('pitch')
        .setDescription('Change the pitch of the music (0.5 - 2.0)')
        .addNumberOption(o => o.setName('value')
            .setDescription('Pitch value (0.5 - 2.0, default 1.0)')
            .setRequired(true).setMinValue(0.5).setMaxValue(2.0)),

    prefix: 'pitch',
    description: 'Change the pitch of the music',
    usage: 'pitch <0.5-2.0>',
    category: 'music',
    aliases: [],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getNumber('value'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args[0]);
    },
};
