'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { EMOJIS, getPlatformInfo, truncateText } = require('../../utils/musicPanel');
const { formatTime } = require('../../utils/musicHelpers');
const jsonStore = require('../../utils/jsonStore');
const premiumManager = require('../../utils/premiumManager');
const {
    preflightPlayer, musicSuccess, musicError, replyMusic,
} = require('../../utils/musicResponse');

const MAX_SKIP = 25;

function read247(guildId) {
    try {
        // 24/7 is premium-only — non-premium servers fall through to the
        // normal "destroy player when queue empty" branch even if the
        // saved config still says enabled.
        if (!premiumManager.isServerPremium(guildId)) return false;
        if (!jsonStore.has('musicpanel-247')) return false;
        const cfg = jsonStore.read('musicpanel-247');
        return !!cfg?.[guildId]?.enabled;
    } catch { return false; }
}

async function performSkip(player, count, guildId) {
    if (count > 1 && player.queue.tracks.length > 0) {
        const drop = Math.min(count - 1, player.queue.tracks.length);
        if (typeof player.queue.splice === 'function') player.queue.splice(0, drop);
        else                                            player.queue.tracks.splice(0, drop);
    }

    if (!player.queue?.tracks?.length) {
        if (read247(guildId) && player.queue?.current) {
            try { await player.stopPlaying(); } catch {}
            return { kind: 'stay-247' };
        }
        try { await player.destroy(); } catch {}
        return { kind: 'left' };
    }

    const nextTrack = player.queue.tracks[0];
    await player.skip();
    return { kind: 'next', nextTrack };
}

function buildResultContainer(result, count) {
    if (result.kind === 'stay-247') {
        return musicSuccess('Skipped', 'Queue is empty.', '24/7 mode is on — staying in voice.');
    }
    if (result.kind === 'left') {
        return musicSuccess('Skipped', 'Queue is empty.', 'Left the voice channel.');
    }
    const t = result.nextTrack;
    const platform = getPlatformInfo(t?.info?.sourceName);
    const heading = count > 1 ? `Skipped ${count} tracks` : 'Skipped';
    const body = `### ${EMOJIS.next} Now Playing\n${platform.icon} **${truncateText(t?.info?.title, 45)}**\n-# by ${truncateText(t?.info?.author, 35)} · \`${formatTime(t?.info?.duration || 0)}\``;
    return musicSuccess(heading, body);
}

async function run(target, lavalinkManager, count) {
    const player  = lavalinkManager.getPlayer(target.guild.id);
    const isSlash = typeof target.isRepliable === 'function';
    const member  = target.member;

    const pre = preflightPlayer({ player, member });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    try {
        const safe = Math.min(Math.max(1, Number.isFinite(count) ? count : 1), MAX_SKIP);
        const result = await performSkip(player, safe, target.guild.id);
        return replyMusic(target, buildResultContainer(result, safe));
    } catch (err) {
        return replyMusic(target, musicError('Skip Failed', 'An error occurred while skipping.', err.message || 'Unknown error'), { ephemeral: isSlash });
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skip')
        .setDescription('Skip the current track (or several at once)')
        .addIntegerOption(o => o.setName('count')
            .setDescription(`How many tracks to skip (1-${MAX_SKIP})`)
            .setMinValue(1).setMaxValue(MAX_SKIP).setRequired(false)),

    prefix: 'skip',
    description: 'Skip the current track or several',
    usage: 'skip [count]',
    category: 'music',
    aliases: ['s', 'next'],

    async execute(interaction, lavalinkManager) {
        const count = interaction.options.getInteger('count') || 1;
        return run(interaction, lavalinkManager, count);
    },
    async executePrefix(message, args, lavalinkManager) {
        const count = parseInt(args[0]) || 1;
        return run(message, lavalinkManager, count);
    },
};
