'use strict';

/**
 * nodecheck.js — Owner-only: ping every Lavalink node and report
 * connection state, latency and current player counts. Lighter and
 * faster than `lavalinkinfo` for ad-hoc health checks.
 */

const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');

module.exports = {
    name: 'nodecheck',
    prefix: 'nodecheck',
    aliases: ['llping', 'lavaping', 'nodes'],
    description: 'Owner-only: quick health check on every Lavalink node',
    usage: 'nodecheck',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        if (!lavalinkManager?.nodeManager?.nodes) {
            return message.reply(require('../../utils/ownerUI').errReply('Not Initialized', 'Lavalink manager not initialised.'));
        }

        const nodes = [...lavalinkManager.nodeManager.nodes.values()];
        if (nodes.length === 0) {
            return message.reply(require('../../utils/ownerUI').errReply('No Nodes', 'No Lavalink nodes configured.'));
        }

        let content = `# <:Music:1521228141543165982> Lavalink Node Check\n\n`;
        let connectedCount = 0;
        let totalPing = 0;

        for (const node of nodes) {
            const id = node.id || node.options?.id || 'unknown';
            const host = node.options?.host || 'unknown';
            const isConnected = node.connected;
            const ping = Number.isFinite(node.ping) ? node.ping : null;

            if (isConnected) connectedCount++;
            if (ping != null) totalPing += ping;

            const stateIcon = isConnected ? '<:online:1521228065752088576>' : '<:offline:1521228263177977897>';
            const pingText = ping != null ? `${ping}ms` : 'n/a';
            const players = node.stats?.playingPlayers ?? '?';
            const total = node.stats?.players ?? '?';

            content += `${stateIcon} **${id}** \`${host}\`\n`;
            content += `> ping: \`${pingText}\` · players: \`${players}/${total}\`\n\n`;
        }

        const avgPing = nodes.length ? Math.round(totalPing / nodes.length) : 0;
        content += `### Summary\n`;
        content += `> Connected: **${connectedCount}/${nodes.length}**\n`;
        content += `> Average ping: **${avgPing}ms**`;

        const container = new ContainerBuilder()
            .setAccentColor(connectedCount === nodes.length ? 0x57F287 : connectedCount === 0 ? 0xED4245 : 0xFEE75C)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
