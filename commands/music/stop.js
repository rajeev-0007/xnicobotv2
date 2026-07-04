'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { updateMusicPanel, updateVoiceChannelStatus } = require('../../utils/musicPanel');
const { preflightPlayer, musicSuccess, replyMusic } = require('../../utils/musicResponse');
const jsonStore = require('../../utils/jsonStore');
const premiumManager = require('../../utils/premiumManager');

function read247(guildId) {
    try {
        // 24/7 is premium-only — non-premium servers fall through to
        // the normal "leave voice on stop" branch even if the saved
        // config still says enabled.
        if (!premiumManager.isServerPremium(guildId)) return false;
        if (!jsonStore.has('musicpanel-247')) return false;
        const cfg = jsonStore.read('musicpanel-247');
        return !!cfg?.[guildId]?.enabled;
    } catch { return false; }
}

function clearQueue(player) {
    const tracks = player.queue?.tracks;
    if (!tracks) return 0;
    const len = tracks.length;
    if (typeof player.queue.splice === 'function') player.queue.splice(0, len);
    else                                            tracks.splice(0, len);
    return len;
}

async function performStop(client, player, guildId) {
    const queueSize = player.queue?.tracks?.length || 0;
    const stay = read247(guildId);
    if (stay) {
        clearQueue(player);
        try { await player.stopPlaying(); } catch {}
        await updateVoiceChannelStatus(client, player, 'waiting');
        setTimeout(async () => {
            try { await updateMusicPanel(client, null, client.autoplayStatus || new Map(), guildId); } catch {}
        }, 500);
        return { queueSize, mode: '247' };
    }
    try { await player.destroy(); } catch {}
    return { queueSize, mode: 'left' };
}

function buildResult(queueSize, mode) {
    const tail = mode === '247'
        ? '24/7 mode is on — staying in voice.'
        : 'Left the voice channel.';
    return musicSuccess(
        'Music Stopped',
        `Cleared **${queueSize}** track${queueSize === 1 ? '' : 's'} from the queue.`,
        tail
    );
}

async function run(target, lavalinkManager) {
    const player = lavalinkManager.getPlayer(target.guild.id);

    // Allow stop without a current track (e.g. last track ended) — only need
    // a player + same VC.
    const pre = preflightPlayer({ player, member: target.member, requireCurrent: false });
    if (!pre.ok) return replyMusic(target, pre.container, { ephemeral: pre.ephemeral });

    const r = await performStop(target.client, player, target.guild.id);
    return replyMusic(target, buildResult(r.queueSize, r.mode));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop playback and clear the queue'),

    prefix: 'stop',
    description: 'Stop playback and clear the queue',
    usage: 'stop',
    category: 'music',
    aliases: ['disconnect', 'dc', 'leave', 'lv', 'bye'],

    async execute(interaction, lavalinkManager)         { return run(interaction, lavalinkManager); },
    async executePrefix(message, _args, lavalinkManager){ return run(message,     lavalinkManager); },
};
