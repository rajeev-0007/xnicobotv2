'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { preflightPlayer, musicSuccess, musicError, replyMusic, COLOR, buildMusicContainer } = require('../../utils/musicResponse');

function volumeIcon(v) {
    if (v === 0) return '<:Volumeoff:1521228297864745193>';
    if (v < 100) return '<:Volumedown:1521228131825090792>';
    return '<:Volumeup:1521228004502536272>';
}

function buildVolumeContainer(newVolume, oldVolume) {
    const filled = Math.min(20, Math.max(0, Math.floor(newVolume / 10)));
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
    const warn = newVolume > 150 ? `\n\n> <:Infotriangle:1521227710381428926> High volume — protect your hearing.` : '';
    const body =
        `**Previous:** ${oldVolume}%\n` +
        `**New:** ${newVolume}%\n\n` +
        `\`${bar}\` ${newVolume}%${warn}`;
    return buildMusicContainer({
        title: 'Volume Updated',
        emoji: volumeIcon(newVolume),
        body,
        color: COLOR.BRAND,
    });
}

async function run(target, lavalinkManager, raw) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';

    const pre = preflightPlayer({ player, member: target.member, requireCurrent: false });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const volume = parseInt(raw, 10);
    if (!Number.isFinite(volume) || volume < 0 || volume > 200) {
        return replyMusic(target, musicError(
            'Invalid Volume',
            'Volume must be between **0** and **200**.',
            'Examples: `/volume 50` · `/volume 100` · `/volume 150`'
        ), { ephemeral: isSlash });
    }

    const old = player.volume || 100;
    await player.setVolume(volume);
    return replyMusic(target, buildVolumeContainer(volume, old));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('volume')
        .setDescription('Set the playback volume')
        .addIntegerOption(o => o.setName('level')
            .setDescription('Volume level (0-200)').setRequired(true).setMinValue(0).setMaxValue(200)),

    prefix: 'volume',
    description: 'Set the playback volume',
    usage: 'volume <0-200>',
    category: 'music',
    aliases: ['vol', 'v'],

    async execute(interaction, lavalinkManager) {
        return run(interaction, lavalinkManager, interaction.options.getInteger('level'));
    },
    async executePrefix(message, args, lavalinkManager) {
        return run(message, lavalinkManager, args[0]);
    },
};
