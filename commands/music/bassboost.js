'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { buildEQ } = require('../../utils/musicHelpers');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

function applyBass(player, level) {
    const gain = level * 0.2;
    return player.filterManager.setEQ(buildEQ({
        0: gain,
        1: gain * 0.8,
        2: gain * 0.6,
    }));
}

async function run(target, lavalinkManager, raw) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const level = raw == null ? 3 : parseInt(raw, 10);
    if (!Number.isFinite(level) || level < 0 || level > 5) {
        return replyMusic(target, musicError(
            'Invalid Level',
            'Bass boost level must be between **0** and **5**.',
            '`0` disables · `5` is maximum'
        ), { ephemeral: isSlash });
    }

    try {
        await applyBass(player, level);
        const headline = level === 0 ? 'Bass Boost Disabled' : `Bass Boost — Level ${level}/5`;
        const body = level === 0
            ? 'Low frequencies returned to normal.'
            : 'Low frequencies enhanced. Sounds best on speakers or headphones.';
        return replyMusic(target, musicSuccess(headline, body, 'Use `/bassboost 0` or `/filters clear` to reset.'));
    } catch {
        return replyMusic(target, musicError('Filter Failed', 'Could not apply bass boost.'), { ephemeral: isSlash });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bassboost')
        .setDescription('Apply bass boost to playback (0-5)')
        .addIntegerOption(o => o.setName('level')
            .setDescription('Bass boost level (0-5, 0 disables)')
            .setRequired(false).setMinValue(0).setMaxValue(5)),

    prefix: 'bassboost',
    description: 'Apply bass boost to playback',
    usage: 'bassboost [0-5]',
    category: 'music',
    aliases: ['bb', 'bass'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getInteger('level') ?? 3);
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args[0]);
    },
};
