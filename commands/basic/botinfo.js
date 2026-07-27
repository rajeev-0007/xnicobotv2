'use strict';

const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ComponentType
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const botCustomize = require('../../utils/botCustomize');

// ─── Emojis ────────────────────────────────────────────────────────────────────
const E = {
    bot: '<:xnico:1521228240440660180>',
    server: '<:Folderopen:1521227986966417642>',
    members: '<:Userplus:1521227719621218477>',
    commands: '<:Bookopen:1521227911137595605>',
    ping: '<:Heartbeat:1521228203665129664>',
    clock: '<:Clock:1521228110408847623>',
    memory: '<:Cursor:1521228147071127732>',
    music: '<:Music:1521228141543165982>',
    node: '<:Lightningalt:1521227851796447472>',
    shield: '<:Shield:1521227694677692467>',
    owner: '<:Crown:1521227739988889764>',
    fire: '<:Fire:1521227907647668374>',
    code: '<:developer:1521228209096622202>',
    link: '<:Link:1473038786530316298>',
    star: '<:Star:1521227981685526568>',
    topgg: '<:topgg:1521228219066482790>',
    check: '<:Checkedbox:1521227734943269077>',
    cpu: '<:Lightning:1521227915537285150>',
    database: '<:Document:1521227875016114266>',
    channel: '<:Hashtag:1521227771957870604>',
    TestersHelper: '<:tester:1531292444899934218>',
    dev: '<:command:1531290225618321408>',
    pre: '<:Developers:1531279424627146792>'
};

// ─── Credits ───────────────────────────────────────────────────────────────────
const CREDITS = [
    { id: '588982544545087498', emoji: E.owner }
];

const DH = [
    { id: '1264506198489563143', emoji: E.dev }
];

const TH = [
    { id: ['1489253879320154266', '1199557673687986230'], emoji: E.TestersHelper }
];

// ─── Pages ─────────────────────────────────────────────────────────────────────
const PAGES = [
    { value: 'overview', label: 'Overview & About', emoji: '📋', description: 'Server stats and bot description' },
    { value: 'performance', label: 'Performance & System', emoji: '⚙️', description: 'Latency, memory, CPU, versions' },
    { value: 'nodes', label: 'Nodes & Engine', emoji: '🎵', description: 'Lavalink nodes and active sessions' },
    { value: 'credits', label: 'Developers & Helpers', emoji: '👑', description: 'Meet the team behind the bot' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor(seconds / 3600) % 24;
    const m = Math.floor(seconds / 60) % 60;
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function countCommands(baseDir) {
    let total = 0;
    try {
        for (const folder of fs.readdirSync(baseDir)) {
            const full = path.join(baseDir, folder);
            if (fs.statSync(full).isDirectory()) {
                total += fs.readdirSync(full).filter(f => f.endsWith('.js')).length;
            }
        }
    } catch { }
    return total;
}

function getCpuUsage() {
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;
    for (const cpu of cpus) {
        for (const type in cpu.times) totalTick += cpu.times[type];
        totalIdle += cpu.times.idle;
    }
    return ((1 - totalIdle / totalTick) * 100).toFixed(1);
}

// ─── Gather all the raw stats once per render ──────────────────────────────────

function gatherStats(client, guild) {
    const guildId = guild?.id;
    const accentColor = botCustomize.getEmbedColor(guildId);
    const guildCustom = botCustomize.getConfig(guildId);
    const prefix = guildCustom.prefix || process.env.PREFIX || '-';

    const lm = client.lavalinkManager;
    const totalNodes = lm?.nodeManager?.nodes?.size || 0;
    const connectedNodes = lm?.nodeManager?.nodes
        ? [...lm.nodeManager.nodes.values()].filter(n => n.connected).length
        : 0;

    return {
        accentColor,
        customBio: (guildCustom.aboutText || '').trim(),
        customBanner: guildCustom.bannerUrl,
        prefix,
        totalMembers: client.guilds.cache.reduce((a, g) => a + g.memberCount, 0),
        totalChannels: client.channels.cache.size,
        totalCommands: countCommands(path.join(__dirname, '..')),
        uptime: formatUptime(process.uptime()),
        heapUsed: formatBytes(process.memoryUsage().heapUsed),
        heapTotal: formatBytes(process.memoryUsage().heapTotal),
        rss: formatBytes(process.memoryUsage().rss),
        apiPing: Math.round(client.ws.ping),
        cpuUsage: getCpuUsage(),
        platform: `${os.type()} ${os.arch()}`,
        nodeVersion: process.version,
        djsVersion: require('discord.js').version,
        totalNodes,
        connectedNodes,
        lavalinkPlayers: lm?.players?.size || 0,
        playingPlayers: lm?.players
            ? [...lm.players.values()].filter(p => p?.playing && !p?.paused).length
            : 0,
        shardId: guild?.shardId ?? 0,
        createdTs: Math.floor(client.user.createdTimestamp / 1000),
        thumbnailUrl: guildCustom.avatarUrl
            || guild?.members?.me?.displayAvatarURL?.({ size: 256 })
            || client.user.displayAvatarURL({ size: 256 }),
    };
}

// ─── Page content builders ─────────────────────────────────────────────────────

function addOverviewPage(container, client, s) {
    if (s.customBanner) {
        try {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(s.customBanner))
            );
            container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        } catch { }
    }

    const aboutBlock = s.customBio
        ? `### ${E.database}  About\n` + s.customBio.slice(0, 1500)
        : `### ${E.database}  About\n` +
        `All-in-one Discord toolkit — Music, Moderation, Economy, Levels, Tickets & more.`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(aboutBlock));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### ${E.server}  Overview\n` +
        `> ${E.server} **Servers**  ${client.guilds.cache.size.toLocaleString()}\n` +
        `> ${E.members} **Users**  ${s.totalMembers.toLocaleString()}\n` +
        `> ${E.channel} **Channels**  ${s.totalChannels.toLocaleString()}\n` +
        `> ${E.commands} **Commands**  ${s.totalCommands}\n` +
        `> ${E.shield} **Shard**  #${s.shardId}\n` +
        `> ${E.pre} **Prefix**  \`${s.prefix}\``
    ));
}

function addPerformancePage(container, s) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### ${E.cpu}  Performance\n` +
        `> ${E.ping} **Latency**  ${s.apiPing}ms\n` +
        `> ${E.clock} **Uptime**  ${s.uptime}\n` +
        `> ${E.memory} **Memory**  ${s.heapUsed} / ${s.heapTotal} (RSS ${s.rss})\n` +
        `> ${E.fire} **CPU**  ${s.cpuUsage}%\n` +
        `> **Platform**  ${s.platform}`
    ));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### ${E.code}  System\n` +
        `> ${E.fire} **Node.js**  ${s.nodeVersion}\n` +
        `> **Discord.js**  v${s.djsVersion}\n` +
        `> ${E.clock} **Created**  <t:${s.createdTs}:D> (<t:${s.createdTs}:R>)`
    ));
}

function addNodesPage(container, s) {
    const nodeStateLine = s.totalNodes === 0
        ? '`No nodes configured`'
        : s.connectedNodes === s.totalNodes
            ? `\`${s.connectedNodes}/${s.totalNodes}\` online`
            : s.connectedNodes === 0
                ? `\`0/${s.totalNodes}\` offline`
                : `\`${s.connectedNodes}/${s.totalNodes}\` online (degraded)`;

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### ${E.music}  Nodes & Engine\n` +
        `> ${E.node} **Nodes**  ${nodeStateLine}\n` +
        `> ${E.music} **Sessions**  ${s.lavalinkPlayers}\n` +
        `> ${E.fire} **Playing**  ${s.playingPlayers}`
    ));
}

function addCreditsPage(container) {
    const creditLines = CREDITS.map(c => {
        const ids = Array.isArray(c.id) ? c.id.map(id => `<@${id}>`).join(' ') : `<@${c.id}>`;
        const emoji = c.emoji || E.dev;
        return `> ${emoji} ${ids}`;
    }).join('\n');

    const dhLines = DH.map(c => {
        const ids = Array.isArray(c.id) ? c.id.map(id => `<@${id}>`).join(' ') : `<@${c.id}>`;
        const emoji = c.emoji || E.dev;
        return `> ${emoji} ${ids}`;
    }).join('\n');

    const thLines = TH.map(c => {
        const ids = Array.isArray(c.id) ? c.id.map(id => `<@${id}>`).join(' ') : `<@${c.id}>`;
        const emoji = c.emoji || E.TestersHelper;
        return `> ${emoji} ${ids}`;
    }).join('\n');

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### ${E.owner}  Owner\n${creditLines}\n### ${E.dev}  Developer & Helper\n${dhLines}\n### ${E.TestersHelper}  Testers & Hunters\n${thLines}`
    ));
}

// ─── Build the panel for a given page ──────────────────────────────────────────

function buildBotInfo(client, guild, page = 'overview') {
    const s = gatherStats(client, guild);
    const container = new ContainerBuilder().setAccentColor(s.accentColor);

    // ── Header (always visible) ──
    container.addSectionComponents(
        new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `## ${E.bot}  ${client.user.username}\n` +
                    `-# ${s.totalCommands} commands  •  ${client.guilds.cache.size.toLocaleString()} servers  •  Powered by Discord.js`
                )
            )
            .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: s.thumbnailUrl } }))
    );
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large).setDivider(true));

    // ── Page-specific content ──
    switch (page) {
        case 'performance': addPerformancePage(container, s); break;
        case 'nodes': addNodesPage(container, s); break;
        case 'credits': addCreditsPage(container); break;
        case 'overview':
        default: addOverviewPage(container, client, s); break;
    }

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // ── Branding footer (always visible) ──
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# ${E.star} Thank you for using ${client.user.username} · Trusted by ${client.guilds.cache.size.toLocaleString()} communities`
    ));

    // ── Select menu row ──
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('botinfo_page_select')
        .setPlaceholder('📂 Browse a category...')
        .addOptions(PAGES.map(p =>
            new StringSelectMenuOptionBuilder()
                .setLabel(p.label)
                .setValue(p.value)
                .setEmoji(p.emoji)
                .setDescription(p.description)
                .setDefault(p.value === page)
        ));
    const selectRow = new ActionRowBuilder().addComponents(selectMenu);

    // ── Link Buttons ──
    const linkRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('check_ping')
            .setLabel('Ping')
            .setEmoji(E.ping)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setLabel('Invite')
            .setURL(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`)
            .setStyle(ButtonStyle.Link)
            .setEmoji(E.bot),
        new ButtonBuilder()
            .setLabel('Support')
            .setURL(process.env.SUPPORT_SERVER || 'https://discord.gg/Zs35X7Umak')
            .setStyle(ButtonStyle.Link)
            .setEmoji(E.members),
        new ButtonBuilder()
            .setLabel('Vote')
            .setURL(`https://top.gg/bot/${client.user.id}/vote`)
            .setStyle(ButtonStyle.Link)
            .setEmoji(E.topgg),
        new ButtonBuilder()
            .setLabel('Website')
            .setURL(process.env.BOT_WEBSITE || 'https://thenico.vercel.app')
            .setStyle(ButtonStyle.Link)
            .setEmoji(E.link)
    );

    container.addActionRowComponents(selectRow).addActionRowComponents(linkRow);

    return { container, selectRow, linkRow };
}

// ─── Collector wiring (shared between slash + prefix) ──────────────────────────

function attachPageCollector(replyMessage, client, guild, ownerId) {
    let currentPage = 'overview';

    const collector = replyMessage.createMessageComponentCollector({
        time: 5 * 60 * 1000, // 5 minutes
    });

    collector.on('collect', async i => {
        if (i.user.id !== ownerId) {
            return i.reply({ content: "This menu isn't for you — run the command yourself to browse it.", ephemeral: true });
        }
        if (i.isStringSelectMenu() && i.customId === 'botinfo_page_select') {
            currentPage = i.values[0];
            const { container } = buildBotInfo(client, guild, currentPage);
            await i.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } else if (i.isButton() && i.customId === 'check_ping') {
            try {
                const pingCmd = require('./ping.js');
                await pingCmd.execute(i);
            } catch (err) {
                console.error("Ping button error:", err);
                if (!i.replied && !i.deferred) {
                    await i.reply({ content: 'An error occurred while checking ping.', ephemeral: true }).catch(() => { });
                }
            }
        }
    });
    collector.on('end', async () => {
        try {
            const { container, selectRow } = buildBotInfo(client, guild, currentPage);
            // Disable the select menu once the collector has expired.
            selectRow.components[0].setDisabled(true);
            await replyMessage.edit({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
        } catch { }
    });
}

// ─── Module Export ─────────────────────────────────────────────────────────────

module.exports = {
    aliases: ['bi', 'about', 'botstat', 'info'],
    category: 'basic',
    prefix: 'botinfo',
    description: 'Display detailed bot information, stats, and performance metrics',
    usage: 'botinfo',
    dmAllowed: true,

    data: new SlashCommandBuilder()
        .setName('botinfo')
        .setDescription('Display detailed bot information, stats, and performance metrics'),

    async execute(interaction) {
        const { container } = buildBotInfo(interaction.client, interaction.guild, 'overview');
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        const replyMessage = await interaction.fetchReply();
        attachPageCollector(replyMessage, interaction.client, interaction.guild, interaction.user.id);
    },

    async executePrefix(message) {
        const { container } = buildBotInfo(message.client, message.guild, 'overview');
        const replyMessage = await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        attachPageCollector(replyMessage, message.client, message.guild, message.author.id);
    },

    buildBotInfo
};
