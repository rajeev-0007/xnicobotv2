const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const os = require('os');
const jsonStore = require('../../utils/jsonStore');

module.exports = {
    name: 'system',
    prefix: 'system',
    aliases: ['sys', 'resources', 'perf'],
    description: 'View system resources and performance metrics',
    usage: 'system',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message) {
        if (!isOwner(message.author.id)) return;
        await this.showSystem(message, message.client);
    },

    async showSystem(context, client) {
        const mem = process.memoryUsage();
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const cpus = os.cpus();
        const uptime = process.uptime();

        const formatBytes = (b) => {
            if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
            if (b >= 1048576) return (b / 1048576).toFixed(2) + ' MB';
            return (b / 1024).toFixed(2) + ' KB';
        };

        const formatUptime = (s) => {
            const d = Math.floor(s / 86400);
            const h = Math.floor((s % 86400) / 3600);
            const m = Math.floor((s % 3600) / 60);
            const sec = Math.floor(s % 60);
            const parts = [];
            if (d > 0) parts.push(`${d}d`);
            if (h > 0) parts.push(`${h}h`);
            if (m > 0) parts.push(`${m}m`);
            parts.push(`${sec}s`);
            return parts.join(' ');
        };

        // CPU load average
        const loadAvg = os.loadavg();

        // Guild/user stats
        const totalGuilds = client.guilds.cache.size;
        const totalUsers = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
        const totalChannels = client.channels.cache.size;

        const memPercent = ((mem.heapUsed / mem.heapTotal) * 100).toFixed(1);
        const sysMemPercent = ((usedMem / totalMem) * 100).toFixed(1);

        // ── Data layer (PostgreSQL / Redis / local fallback) ─────────────
        // Redis is optional, so everything here is defensive: an older
        // jsonStore without redisStats() must not break the command.
        let dataLayerLine;
        try {
            const storeCount = jsonStore.cache?.size ?? 0;
            const dirtyCount = jsonStore.dirty?.size ?? 0;
            const localMode = jsonStore._localMode === true;

            let pgLabel;
            if (localMode) {
                pgLabel = '<:Infotriangle:1521227710381428926> Local files (PostgreSQL unavailable)';
            } else {
                let onFallback = false;
                try { onFallback = require('../../utils/pgPool').getPool().usingFallback; } catch {}
                pgLabel = onFallback
                    ? '<:Infotriangle:1521227710381428926> Connected (fallback DB)'
                    : '<:Checkedbox:1521227734943269077> Connected (primary)';
            }

            const r = typeof jsonStore.redisStats === 'function' ? jsonStore.redisStats() : null;
            let redisLabel;
            if (!r || !r.enabled) {
                redisLabel = '<:Cancel:1521227723916181644> Disabled — set `REDIS_URL` to enable';
            } else if (!r.ready) {
                redisLabel = '<:Infotriangle:1521227710381428926> Configured but not connected';
            } else {
                redisLabel =
                    `<:Checkedbox:1521227734943269077> Connected via \`${r.driver}\`\n` +
                    `> <:Refresh:1521227946441052420> **Sync bus:** ${r.busActive ? 'active (instant)' : 'inactive — polling PostgreSQL'}\n` +
                    `> <:Star:1521227981685526568> **Cache:** ${r.hits} hits / ${r.misses} misses (${r.hitRate})\n` +
                    `> <:Envelope:1521228013910626426> **Messages:** ${r.published} sent / ${r.received} received\n` +
                    `> <:Bookopen:1521227911137595605> **Hydrated at boot:** ${r.hydratedAtBoot} stores` +
                    (r.errors ? `\n> <:Cancel:1521227723916181644> **Errors:** ${r.errors}` : '');
            }

            dataLayerLine =
                `### <:Folder:1521228095225331765> Data Layer\n` +
                `> <:Bank:1521228286813012169> **PostgreSQL:** ${pgLabel}\n` +
                `> <:Lightning:1521227915537285150> **Redis:** ${redisLabel}\n` +
                `> <:Document:1521227875016114266> **Stores cached:** ${storeCount}  •  **Unsaved:** ${dirtyCount}`;
        } catch (e) {
            dataLayerLine =
                `### <:Folder:1521228095225331765> Data Layer\n` +
                `> <:Cancel:1521227723916181644> Unavailable: ${String(e?.message || e).slice(0, 80)}`;
        }

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# <:Settings:1521227767780343879> System Monitor`)
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### <:Shield:1521227694677692467> Platform\n` +
                    `> <:Document:1521227875016114266> **OS:** ${os.platform()} ${os.arch()}\n` +
                    `> <:Bookopen:1521227911137595605> **Node.js:** ${process.version}\n` +
                    `> <:Lightning:1521227915537285150> **Uptime:** ${formatUptime(uptime)}`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### <:Invoice:1521227903956811836> CPU\n` +
                    `> <:Settings:1521227767780343879> **Model:** ${cpus[0]?.model || 'Unknown'}\n` +
                    `> <:Add:1521227828199293152> **Cores:** ${cpus.length}\n` +
                    `> <:Alarm:1521227869047750689> **Load:** ${loadAvg.map(l => l.toFixed(2)).join(' / ')}`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### <:Editalt:1521227921673556019> Memory\n` +
                    `> <:Star:1521227981685526568> **Heap:** ${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)} (${memPercent}%)\n` +
                    `> <:Bookopen:1521227911137595605> **RSS:** ${formatBytes(mem.rss)}  •  **External:** ${formatBytes(mem.external)}\n` +
                    `> <:Invoice:1521227903956811836> **System:** ${formatBytes(usedMem)} / ${formatBytes(totalMem)} (${sysMemPercent}% used)\n` +
                    `> <:Checkedbox:1521227734943269077> **Free:** ${formatBytes(freeMem)} (${((freeMem / totalMem) * 100).toFixed(1)}%)`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### <:Bookopen:1521227911137595605> Bot Stats\n` +
                    `> <:Fileuser:1521228225466859792> **${totalGuilds}** servers  •  **${totalUsers.toLocaleString()}** users  •  **${totalChannels}** channels\n` +
                    `> <:Lightning:1521227915537285150> **WS Ping:** ${client.ws.ping}ms\n` +
                    `> <:Alarm:1521227869047750689> **Bot Uptime:** ${formatUptime(uptime)}`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(dataLayerLine)
            )

        const opts = { components: [container], flags: MessageFlags.IsComponentsV2 };
        return context.editReply ? context.editReply(opts) : context.reply(opts);
    }
};
