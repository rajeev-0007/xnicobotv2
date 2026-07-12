'use strict';

/**
 * fix — Self-heal the music system.
 *
 * When music stops working because a Lavalink node has gone offline, users
 * can run `fix` to force an immediate reconnect of every offline node
 * (instead of waiting for the passive background retry loop). Once a node
 * comes back the bot is ready to play again.
 *
 * Works anywhere (no voice channel required). Light per-user cooldown so it
 * can't be used to hammer the nodes.
 */

const { SlashCommandBuilder } = require('discord.js');
const {
    musicWarn, musicError, musicLoading, buildMusicContainer,
    replyMusic, COLOR, ICON, CV2, CV2_EPH,
} = require('../../utils/musicResponse');
const { reconnectAllNodes } = require('../../utils/lavalinkSetup');

const REFRESH = '<:Refresh:1521227946441052420>';
const COOLDOWN_MS = 15_000;
const cooldowns = new Map(); // userId → timestamp

/** Returns remaining cooldown seconds, or 0 if the user may run `fix`. */
function checkCooldown(userId) {
    const now = Date.now();
    const last = cooldowns.get(userId) || 0;
    const remaining = COOLDOWN_MS - (now - last);
    if (remaining > 0) return Math.ceil(remaining / 1000);
    cooldowns.set(userId, now);
    // Opportunistic cleanup so the map can't grow unbounded.
    if (cooldowns.size > 500) {
        for (const [id, ts] of cooldowns) if (now - ts > COOLDOWN_MS) cooldowns.delete(id);
    }
    return 0;
}

/** Build the result panel from a reconnectAllNodes() summary. */
function buildResultContainer(r) {
    const total = r.total || 0;
    const anyOnline = r.online > 0;
    const allOnline = total > 0 && r.online === total;

    const title = anyOnline ? 'Music Nodes Ready' : 'Music Still Offline';
    const emoji = anyOnline ? ICON.SUCCESS : ICON.ERROR;
    const color = allOnline ? COLOR.SUCCESS : (anyOnline ? COLOR.WARNING : COLOR.ERROR);

    const lines = [
        `> ${REFRESH} **Nodes online:** \`${r.online}/${total}\``,
    ];
    if (r.reconnected > 0) {
        lines.push(`> ${ICON.SUCCESS} **Reconnected:** \`${r.reconnected}\` node${r.reconnected === 1 ? '' : 's'}`);
    } else if (r.attempted > 0) {
        lines.push(`> ${ICON.WARNING} **Reconnect attempts:** \`${r.attempted}\``);
    }
    lines.push('');
    lines.push(anyOnline
        ? 'The music system is ready — try `play <song>` again.'
        : 'All nodes are still unreachable. Wait a minute and run `fix` again.');

    // Only list nodes that are still offline (keeps the panel compact).
    const offline = (r.nodes || []).filter(n => !n.connected).map(n => n.id);
    let footer;
    if (offline.length) {
        const shown = offline.slice(0, 6).join(', ');
        footer = `Still offline: ${shown}${offline.length > 6 ? ` +${offline.length - 6} more` : ''}`;
    }

    return buildMusicContainer({ title, emoji, body: lines.join('\n'), footer, color });
}

async function run(target, lavalinkManager, isSlash) {
    if (!lavalinkManager?.nodeManager) {
        return replyMusic(target, musicError(
            'Music Unavailable',
            'The music engine is not initialized yet. Please try again in a moment.',
        ), { ephemeral: isSlash });
    }

    // Slash: defer (reconnect can take a few seconds). Prefix: show a
    // loading card we edit in place once the reconnect settles.
    let loadingMsg = null;
    if (isSlash) {
        if (!target.deferred && !target.replied) {
            await target.deferReply().catch(() => {});
        }
    } else {
        loadingMsg = await replyMusic(target, musicLoading(
            'Reconnecting Music Nodes',
            'Bringing offline Lavalink nodes back online — this takes a few seconds…',
        ));
    }

    const result = await reconnectAllNodes(lavalinkManager);
    const container = buildResultContainer(result);

    // Prefix path: edit the loading message in place when possible.
    if (!isSlash && loadingMsg?.edit) {
        try {
            await loadingMsg.edit({ components: [container], flags: CV2 });
            return loadingMsg;
        } catch { /* fall through to a fresh reply */ }
    }
    return replyMusic(target, container);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('fix')
        .setDescription('Reconnect the music nodes when music stops working'),

    name: 'fix',
    prefix: 'fix',
    aliases: ['fixmusic', 'reconnect', 'musicfix'],
    description: 'Reconnect offline music (Lavalink) nodes so music plays again',
    usage: 'fix',
    category: 'music',

    async execute(interaction, lavalinkManager) {
        const cd = checkCooldown(interaction.user.id);
        if (cd) {
            return interaction.reply({
                components: [musicWarn('Slow Down', `Please wait **${cd}s** before running \`fix\` again.`)],
                flags: CV2_EPH,
            }).catch(() => {});
        }
        return run(interaction, lavalinkManager, true);
    },

    async executePrefix(message, _args, lavalinkManager) {
        const cd = checkCooldown(message.author.id);
        if (cd) {
            return replyMusic(message, musicWarn('Slow Down', `Please wait **${cd}s** before running \`fix\` again.`));
        }
        return run(message, lavalinkManager, false);
    },
};
