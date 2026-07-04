'use strict';

/**
 * runtimeflags.js — Owner-only: print runtime feature flags & state in
 * one place: maintenance mode, dev mode, premium counts, lavalink
 * status, intents, shard info.
 */

const { isOwner } = require('../../utils/helpers');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags, IntentsBitField } = require('discord.js');
const jsonStore = require('../../utils/jsonStore');

let premiumManager = null;
try { premiumManager = require('../../utils/premiumManager'); } catch {}

module.exports = {
    name: 'runtimeflags',
    prefix: 'runtimeflags',
    aliases: ['rflags', 'runtime'],
    description: 'Owner-only: dump key runtime feature flags & state',
    usage: 'runtimeflags',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager, client) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const cfg = jsonStore.has('globalconfig') ? jsonStore.read('globalconfig') : {};
        const intents = client.options?.intents;
        const intentNames = intents
            ? new IntentsBitField(intents).toArray()
            : [];

        // Premium counts (best effort)
        let userPremium = '?';
        let serverPremium = '?';
        try {
            if (premiumManager?.getActivePremiumUsers)   userPremium   = premiumManager.getActivePremiumUsers().length;
            if (premiumManager?.getActivePremiumServers) serverPremium = premiumManager.getActivePremiumServers().length;
        } catch {}

        // Lavalink summary
        const nodes = lavalinkManager?.nodeManager?.nodes ? [...lavalinkManager.nodeManager.nodes.values()] : [];
        const connectedNodes = nodes.filter(n => n.connected).length;
        const players = lavalinkManager?.players?.size ?? 0;

        const onOff = (v) => v ? '<:Toggleon:1521227758011809964> ON' : '<:Toggleoff:1521227763816595559> OFF';

        const content =
            `# <:Settings:1521227767780343879> Runtime Flags\n\n` +
            `### Bot\n` +
            `> **Username:** ${client.user.tag}\n` +
            `> **Shard:** ${client.shard?.ids?.join(',') ?? '0'} / ${client.shard?.count ?? 1}\n` +
            `> **Guilds:** ${client.guilds.cache.size}\n` +
            `> **WS Ping:** ${client.ws.ping}ms\n` +
            `> **Uptime:** ${Math.floor(process.uptime())}s\n\n` +
            `### Modes\n` +
            `> **Maintenance:** ${onOff(cfg.maintenanceMode)}\n` +
            `> **Developer:** ${onOff(cfg.developerMode)}\n` +
            `> **Auto-Restart:** ${onOff(cfg.autoRestart)}\n` +
            `> **Default Prefix:** \`${cfg.defaultPrefix || process.env.PREFIX || '-'}\`\n\n` +
            `### Premium\n` +
            `> **Users:** ${userPremium}\n` +
            `> **Servers:** ${serverPremium}\n\n` +
            `### Lavalink\n` +
            `> **Nodes:** ${connectedNodes}/${nodes.length} connected\n` +
            `> **Players:** ${players}\n\n` +
            `### Intents (${intentNames.length})\n` +
            `> ${intentNames.length ? intentNames.map(i => `\`${i}\``).join(', ') : '*none*'}\n`;

        const container = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
