'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { nextLoopMode } = require('../../utils/musicHelpers');
const { preflightPlayer, musicSuccess, musicError, replyMusic } = require('../../utils/musicResponse');

const ICONS = {
    off:   '<:Forward:1521228316093186098>',
    track: '<:Refresh:1521227946441052420>',
    queue: '<:Shuffle:1521228321403437228>',
};

const TEXT = { off: 'Off', track: 'Track', queue: 'Queue' };
const VALID = new Set(Object.keys(TEXT));

function buildResponse(mode) {
    const body = mode === 'off'
        ? 'Repeat is disabled — tracks will play through once.'
        : mode === 'track'
            ? 'Current track will repeat indefinitely.'
            : 'Whole queue will repeat after the last track.';
    const footer = mode === 'off' ? null : 'Run `/loop off` to disable.';
    return musicSuccess(`Loop — ${TEXT[mode]}`, body, footer);
}

async function run(target, lavalinkManager, requested) {
    const player = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    let mode;
    if (!requested) mode = nextLoopMode(player.repeatMode || 'off');
    else if (VALID.has(requested)) mode = requested;
    else return replyMusic(target, musicError('Invalid Mode', 'Use one of: `off`, `track`, `queue` — or omit to cycle.'), { ephemeral: isSlash });

    player.setRepeatMode(mode);
    return replyMusic(target, buildResponse(mode));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('loop')
        .setDescription('Cycle or set the repeat mode')
        .addStringOption(o => o.setName('mode')
            .setDescription('Loop mode (omit to cycle)').setRequired(false)
            .addChoices(
                { name: 'Off',   value: 'off' },
                { name: 'Track', value: 'track' },
                { name: 'Queue', value: 'queue' }
            )),

    prefix: 'loop',
    description: 'Cycle or set the repeat mode',
    usage: 'loop [off|track|queue]',
    category: 'music',
    aliases: ['lp', 'rp'],

    async execute(interaction, lavalinkManager) {
        const requested = interaction.options.getString('mode');
        return run(interaction, lavalinkManager, requested);
    },
    async executePrefix(message, args, lavalinkManager) {
        const requested = args[0]?.toLowerCase() || null;
        return run(message, lavalinkManager, requested);
    },
};
