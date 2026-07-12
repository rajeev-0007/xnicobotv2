'use strict';

/**
 * liveMusicCard.js — keeps a single "Now Playing" canvas card message
 * updating in place (every 10s) so the progress bar advances live, WITHOUT
 * spamming new messages.
 *
 * Design (deliberately self-contained + safe):
 *   • One live card per guild. Starting a new one replaces the previous
 *     (the old message is simply left on its last frame).
 *   • Each tick re-reads the current player state, so the card naturally
 *     follows track changes, pause/resume, and platform changes.
 *   • A signature guard skips redundant edits (e.g. while paused, or if the
 *     position hasn't advanced a full 5s bucket) to avoid needless API calls.
 *   • The interval self-terminates when the player is gone, the queue is
 *     empty, the message was deleted, or a 1-hour safety cap is hit.
 *   • Every path is guarded — a render/edit failure never throws.
 */

const { AttachmentBuilder, MessageFlags } = require('discord.js');
const { renderNowPlayingCard, cardOptionsFromPlayer } = require('./musicCard');
const { buildNowPlayingContainer } = require('./musicPanel');

const REFRESH_MS = 10_000;                 // update cadence
const MAX_LIFETIME_MS = 60 * 60 * 1000;    // safety cap: stop after 1h

// guildId -> { client, channelId, messageId, style, timer, inProgress, lastSig, startedAt }
const live = new Map();

/** State fingerprint — if unchanged since the last edit we skip the edit. */
function signature(player) {
    const t = player?.queue?.current;
    if (!t?.info) return 'none';
    // While paused the position is frozen — collapse to a single bucket so we
    // don't re-render. While playing, bucket by 5s so we edit ~every tick.
    const posBucket = player.paused ? 'paused' : Math.floor((player.position || 0) / 5000);
    return `${t.info.identifier}|${player.paused ? 1 : 0}|${posBucket}|${t.info.isStream ? 1 : 0}`;
}

function stopLiveCard(guildId) {
    const d = live.get(guildId);
    if (d) {
        clearInterval(d.timer);
        live.delete(guildId);
    }
}

async function tick(guildId) {
    const d = live.get(guildId);
    if (!d || d.inProgress) return;

    if (Date.now() - d.startedAt > MAX_LIFETIME_MS) { stopLiveCard(guildId); return; }

    const player = d.client.lavalinkManager?.getPlayer(guildId);
    if (!player || !player.queue?.current) { stopLiveCard(guildId); return; }

    const sig = signature(player);
    if (sig === d.lastSig) return; // nothing meaningful changed — skip edit

    d.inProgress = true;
    try {
        const channel = d.client.channels.cache.get(d.channelId)
            || await d.client.channels.fetch(d.channelId).catch(() => null);
        if (!channel) { stopLiveCard(guildId); return; }

        const msg = await channel.messages.fetch(d.messageId).catch(() => null);
        if (!msg) { stopLiveCard(guildId); return; }

        const buffer = await renderNowPlayingCard(cardOptionsFromPlayer(player, d.style));
        if (!buffer) return; // render failed — leave the last good frame, try again next tick

        const autoplay = d.client.autoplayStatus || new Map();
        const container = buildNowPlayingContainer(player, autoplay, { cardImageUrl: 'attachment://nowplaying.png' });
        if (!container) return;

        const attachment = new AttachmentBuilder(buffer, { name: 'nowplaying.png' });
        // attachments:[] clears the previous image so attachments don't pile up.
        await msg.edit({
            components: [container],
            files: [attachment],
            attachments: [],
            flags: MessageFlags.IsComponentsV2,
        });
        d.lastSig = sig;
    } catch (err) {
        // Unknown Message / Missing Access / Unknown Channel → give up.
        const code = err?.code;
        if (code === 10008 || code === 10003 || code === 50001) {
            stopLiveCard(guildId);
        }
        // Any other (transient) error: keep the interval alive and retry.
    } finally {
        if (live.has(guildId)) live.get(guildId).inProgress = false;
    }
}

/**
 * Begin live-updating a Now Playing card message for a guild.
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message  The already-sent card message
 * @param {string} [style='default']
 */
function startLiveCard(client, message, style = 'default') {
    try {
        if (!client || !message?.id || !message.channel?.id) return;
        const guildId = message.guild?.id || message.guildId;
        if (!guildId) return;

        stopLiveCard(guildId); // replace any existing live card for this guild

        const entry = {
            client,
            channelId: message.channel.id,
            messageId: message.id,
            style,
            inProgress: false,
            lastSig: null,
            startedAt: Date.now(),
            timer: null,
        };
        entry.timer = setInterval(() => { tick(guildId).catch(() => {}); }, REFRESH_MS);
        // Don't let the interval keep the process alive on shutdown.
        if (typeof entry.timer.unref === 'function') entry.timer.unref();
        live.set(guildId, entry);
    } catch { /* never throw from a fire-and-forget starter */ }
}

module.exports = { startLiveCard, stopLiveCard, REFRESH_MS };
