const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { COLORS, EMOJIS } = require('../../utils/responseBuilder');
const os = require('os');

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);
    return parts.join(' ');
}

async function buildShardStatus(client) {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();
    const totalGuilds = client.guilds.cache.size;
    const totalMembers = client.guilds.cache.reduce((acc, g) => acc + g.memberCount, 0);
    const totalChannels = client.channels.cache.size;

    const cpuLoad = os.loadavg();
    const cpuCores = os.cpus().length;
    const cpuPercent = ((cpuLoad[0] / cpuCores) * 100).toFixed(1);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = ((usedMem / totalMem) * 100).toFixed(1);

    const healthScore = calculateHealth(client.ws.ping, memUsage.heapUsed / memUsage.heapTotal * 100, parseFloat(cpuPercent));
    const healthEmoji = healthScore >= 90 ? '<:Checkedbox:1521227734943269077>' :
        healthScore >= 70 ? '<:Infotriangle:1521227710381428926>' : '<:Cancel:1521227723916181644>';
    const healthLabel = healthScore >= 90 ? 'Excellent' : healthScore >= 70 ? 'Good' : healthScore >= 50 ? 'Warning' : 'Critical';

    let content = `# <:Shield:1521227694677692467> Shard Status\n`;
    content += `-# ${healthEmoji} Health: **${healthScore}%** (${healthLabel})\n\n`;

    if (client.shard) {
        const shardIds = client.shard.ids;
        const totalShards = client.shard.count;

        content += `### <:Invoice:1521227903956811836> Shard Information\n`;
        content += `> <:Caretright:1521227704953864202> **Shard IDs:** ${shardIds.join(', ')}\n`;
        content += `> <:Caretright:1521227704953864202> **Total Shards:** ${totalShards}\n`;
        content += `> <:Caretright:1521227704953864202> **WS Ping:** ${client.ws.ping}ms\n`;
        content += `> <:Caretright:1521227704953864202> **WS Status:** <:online:1521228065752088576> Connected\n\n`;

        try {
            const results = await client.shard.broadcastEval(c => ({
                id: c.shard?.ids?.[0] ?? 0,
                guilds: c.guilds.cache.size,
                members: c.guilds.cache.reduce((a, g) => a + g.memberCount, 0),
                channels: c.channels.cache.size,
                ping: c.ws.ping,
                uptime: process.uptime(),
                memory: process.memoryUsage().heapUsed
            }));

            content += `### <:Document:1521227875016114266> All Shards\n`;
            for (const shard of results) {
                const shardHealth = shard.ping < 100 ? '<:online:1521228065752088576>' :
                    shard.ping < 200 ? '<:idle:1521228053936603257>' : '<:dnd:1521228070701502486>';
                content += `> ${shardHealth} **Shard ${shard.id}** — ${shard.guilds} guilds, ${shard.members.toLocaleString()} members, ${shard.ping}ms, ${formatBytes(shard.memory)}\n`;
            }
            content += '\n';
        } catch {}
    } else {
        content += `### <:Invoice:1521227903956811836> Single Instance\n`;
        content += `> <:Caretright:1521227704953864202> **Mode:** No sharding (single process)\n`;
        content += `> <:Caretright:1521227704953864202> **WS Ping:** ${client.ws.ping}ms\n`;
        content += `> <:Caretright:1521227704953864202> **WS Status:** <:online:1521228065752088576> Connected\n\n`;
    }

    content += `### <:Bookopen:1521227911137595605> Guild Distribution\n`;

    const sizeRanges = [
        { label: '1-10', min: 1, max: 10 },
        { label: '11-50', min: 11, max: 50 },
        { label: '51-100', min: 51, max: 100 },
        { label: '101-500', min: 101, max: 500 },
        { label: '501-1K', min: 501, max: 1000 },
        { label: '1K-5K', min: 1001, max: 5000 },
        { label: '5K+', min: 5001, max: Infinity }
    ];

    for (const range of sizeRanges) {
        const count = client.guilds.cache.filter(g => g.memberCount >= range.min && g.memberCount <= range.max).size;
        if (count > 0) {
            const bar = '█'.repeat(Math.min(Math.ceil((count / totalGuilds) * 20), 20)) + '░'.repeat(Math.max(20 - Math.ceil((count / totalGuilds) * 20), 0));
            content += `> \`${range.label.padEnd(6)}\` \`${bar}\` **${count}** (${((count / totalGuilds) * 100).toFixed(1)}%)\n`;
        }
    }

    content += `\n### <:Settings:1521227767780343879> System Resources\n`;
    content += `> <:Caretright:1521227704953864202> **Heap Used:** ${formatBytes(memUsage.heapUsed)} / ${formatBytes(memUsage.heapTotal)}\n`;
    content += `> <:Caretright:1521227704953864202> **RSS:** ${formatBytes(memUsage.rss)}\n`;
    content += `> <:Caretright:1521227704953864202> **System Memory:** ${formatBytes(usedMem)} / ${formatBytes(totalMem)} (${memPercent}%)\n`;
    content += `> <:Caretright:1521227704953864202> **CPU Load:** ${cpuPercent}% (${cpuCores} cores)\n`;
    content += `> <:Caretright:1521227704953864202> **Uptime:** ${formatUptime(uptime)}\n`;
    content += `> <:Caretright:1521227704953864202> **Platform:** ${os.platform()} ${os.arch()}\n`;
    content += `> <:Caretright:1521227704953864202> **Node.js:** ${process.version}\n\n`;

    content += `### <:Star:1521227981685526568> Totals\n`;
    content += `> <:Home:1521228339736482056> **Guilds:** ${totalGuilds.toLocaleString()}\n`;
    content += `> <:User:1521227714227343380> **Members:** ${totalMembers.toLocaleString()}\n`;
    content += `> <:Edit:1521227886634205298> **Channels:** ${totalChannels.toLocaleString()}\n`;

    return new ContainerBuilder()
        .setAccentColor(COLORS.INFO)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;
}

function calculateHealth(ping, heapPercent, cpuPercent) {
    let score = 100;
    if (ping > 200) score -= 20;
    else if (ping > 100) score -= 10;
    else if (ping > 50) score -= 5;

    if (heapPercent > 90) score -= 25;
    else if (heapPercent > 75) score -= 15;
    else if (heapPercent > 60) score -= 5;

    if (cpuPercent > 80) score -= 20;
    else if (cpuPercent > 50) score -= 10;

    return Math.max(0, Math.min(100, score));
}

module.exports = {
    name: 'shard-status',
    prefix: 'shard-status',
    aliases: ['shards', 'shardstatus', 'shardinfo'],
    description: 'View shard info, memory, and guild distribution',
    usage: 'shard-status',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args) {
        if (!isOwner(message.author.id)) {
            return message.reply(`${EMOJIS.ERROR} This command is only available to the bot owner!`);
        }

        const loadingMsg = await message.reply(`${EMOJIS.LOADING} Gathering shard information...`);
        const container = await buildShardStatus(message.client);
        await loadingMsg.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
