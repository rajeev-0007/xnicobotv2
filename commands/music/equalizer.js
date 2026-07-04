'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

const PRESETS = {
    reset:      { label: 'Default (Reset)', bands: Array(15).fill(0) },
    bass:       { label: 'Bass Boost',      bands: [0.6, 0.4, 0.3, 0.2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
    treble:     { label: 'Treble Boost',    bands: [0, 0, 0, 0, 0, 0, 0, 0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8] },
    party:      { label: 'Party',           bands: [0.7, 0.7, 0, 0, 0, 0, 0, 0, 0.7, 0.7, 0.7, 0, 0, 0, 0.7] },
    soft:       { label: 'Soft',            bands: [-0.25, 0, 0, 0, 0.25, 0.25, 0.25, 0.25, 0, 0, 0, 0, 0, 0, -0.25] },
    rock:       { label: 'Rock',            bands: [0.3, 0.25, 0.2, 0.1, -0.05, -0.15, -0.15, 0, 0.1, 0.25, 0.35, 0.35, 0.35, 0.3, 0.3] },
    classical:  { label: 'Classical',       bands: [0, 0, 0, 0, 0, 0, -0.05, -0.05, -0.05, 0, 0, 0.2, 0.25, 0.3, 0.3] },
    electronic: { label: 'Electronic',      bands: [0.375, 0.35, 0.125, 0, -0.125, 0.25, -0.125, 0.25, 0.3, 0.35, 0.4, 0.4, 0.375, 0.35, 0.3] },
    fullbass:   { label: 'Full Bass',       bands: [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0, 0, 0, 0, 0, 0, 0] },
};

async function run(target, lavalinkManager, presetKey) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const preset = PRESETS[presetKey];
    if (!preset) {
        return replyMusic(target, musicError(
            'Invalid Preset',
            'Unknown equalizer preset.',
            `Available: ${Object.keys(PRESETS).join(', ')}`
        ), { ephemeral: isSlash });
    }

    try {
        const bands = preset.bands.map((gain, band) => ({ band, gain }));
        await player.filterManager.setEQ(bands);
        return replyMusic(target, musicSuccess(
            `Equalizer — ${preset.label}`,
            `Preset applied to **${player.queue.current.info.title}**.`,
            'Use `/equalizer reset` to restore defaults.'
        ));
    } catch {
        return replyMusic(target, musicError('Equalizer Failed', 'Could not apply equalizer. The audio engine may not support this preset.'), { ephemeral: isSlash });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('equalizer')
        .setDescription('Apply an equalizer preset')
        .addStringOption(o => o.setName('preset')
            .setDescription('Equalizer preset').setRequired(true)
            .addChoices(...Object.keys(PRESETS).map(k => ({ name: PRESETS[k].label, value: k })))),

    prefix: 'equalizer',
    description: 'Apply an equalizer preset',
    usage: 'equalizer <preset>',
    category: 'music',
    aliases: ['eq'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getString('preset'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args[0]?.toLowerCase());
    },
};
