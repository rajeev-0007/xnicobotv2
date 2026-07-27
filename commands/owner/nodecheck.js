'use strict';

/**
 * nodecheck.js — Owner-only: ping every Lavalink node and report
 * connection state, latency and current player counts. Lighter and
 * faster than `lavalinkinfo` for ad-hoc health checks.
 */

const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');

const PAGE_SIZE = 5;
const ID_PREFIX = 'nodecheck';

function buildPanel(state) {
    const { nodes, page, totalPages } = state;
    const start = page * PAGE_SIZE;
    const slice = nodes.slice(start, start + PAGE_SIZE);

    let connectedCount = 0;
    let totalPing = 0;
    let pingNodes = 0;

    for (const node of nodes) {
        if (node.connected) connectedCount++;
        if (Number.isFinite(node.ping)) {
            totalPing += node.ping;
            pingNodes++;
        }
    }

    const avgPing = pingNodes ? Math.round(totalPing / pingNodes) : 0;
    const isAllConnected = connectedCount === nodes.length && nodes.length > 0;
    
    const container = new ContainerBuilder()
        .setAccentColor(isAllConnected ? 0x57F287 : connectedCount === 0 ? 0xED4245 : 0xFEE75C);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Music:1521228141543165982> Lavalink Node Check\n\n` +
        `> Connected: **${connectedCount}/${nodes.length}** · Avg Ping: **${avgPing}ms**` + 
        (totalPages > 1 ? `\n-# Page **${page + 1}/${totalPages}**` : '')
    ));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    if (slice.length === 0) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`*No nodes found.*`));
    } else {
        let content = '';
        for (const node of slice) {
            const id = node.id || node.options?.id || 'unknown';
            const host = node.options?.host || 'unknown';
            const isConnected = node.connected;
            const ping = Number.isFinite(node.ping) ? node.ping : null;

            const stateIcon = isConnected ? '<:online:1521228065752088576>' : '<:offline:1521228263177977897>';
            const pingText = ping != null ? `${ping}ms` : 'n/a';
            const players = node.stats?.playingPlayers ?? '?';
            const total = node.stats?.players ?? '?';

            content += `${stateIcon} **${id}** \`${host}\`\n`;
            content += `> ping: \`${pingText}\` · players: \`${players}/${total}\`\n\n`;
        }
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content.trim()));
    }

    if (totalPages > 1) {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${ID_PREFIX}_prev`).setLabel('Prev').setStyle(ButtonStyle.Primary).setEmoji('<:Caretleft:1521227977495543838>').setDisabled(page === 0),
            new ButtonBuilder().setCustomId(`${ID_PREFIX}_indicator`).setLabel(`${page + 1} / ${totalPages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
            new ButtonBuilder().setCustomId(`${ID_PREFIX}_next`).setLabel('Next').setStyle(ButtonStyle.Primary).setEmoji('<:Caretright:1521227704953864202>').setDisabled(page >= totalPages - 1)
        ));
    }

    return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function attachCollector(panelMessage, ownerId, state) {
    if (state.totalPages <= 1) return;

    const collector = panelMessage.createMessageComponentCollector({
        filter: (i) => i.user.id === ownerId && i.customId.startsWith(`${ID_PREFIX}_`),
        time: 120_000,
    });

    collector.on('collect', async (i) => {
        if (i.customId === `${ID_PREFIX}_prev`) {
            state.page = Math.max(0, state.page - 1);
            await i.update(buildPanel(state)).catch(() => {});
        } else if (i.customId === `${ID_PREFIX}_next`) {
            state.page = Math.min(state.totalPages - 1, state.page + 1);
            await i.update(buildPanel(state)).catch(() => {});
        }
    });

    collector.on('end', async () => {
        try {
            const payload = buildPanel(state);
            if (payload.components[0]?.components) {
                // Remove the action row components (buttons) on expire
                payload.components[0].components = payload.components[0].components.filter(c => c.type !== 1);
            }
            await panelMessage.edit(payload);
        } catch {}
    });
}

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

        const totalPages = Math.max(1, Math.ceil(nodes.length / PAGE_SIZE));
        const state = { nodes, page: 0, totalPages };

        const payload = buildPanel(state);
        const panelMsg = await message.reply(payload);
        
        attachCollector(panelMsg, message.author.id, state);
    }
};
