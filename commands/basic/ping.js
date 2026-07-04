'use strict';

const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const { registerAllFonts, getFontHelpers } = require('../../utils/fontRegistry');
const { drawRoundedRect } = require('../../utils/canvasDesign');

try { registerAllFonts(); } catch {}

const COL = {
    bg: '#0f1116', card: '#1a1d24', border: '#262a33',
    text: '#e6edf3', muted: '#8b949e', dim: '#484f58',
    green: '#3fb950', yellow: '#d29922', red: '#f85149',
    accent: '#5865f2',
};

function getStatusInfo(ms) {
    if (ms <= 80) return { label: 'Excellent', color: COL.green };
    if (ms <= 150) return { label: 'Good', color: COL.green };
    if (ms <= 300) return { label: 'Moderate', color: COL.yellow };
    return { label: 'Poor', color: COL.red };
}

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor(seconds / 3600) % 24;
    const m = Math.floor(seconds / 60) % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

async function buildPingCard(client, roundtripMs) {
    const fh = getFontHelpers('Inter');
    const W = 420, H = 180;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const api = Math.round(client.ws.ping);
    const status = getStatusInfo(api);
    const uptime = formatUptime(process.uptime());
    const shard = client.shard?.ids?.[0] ?? 0;

    // Background
    drawRoundedRect(ctx, 0, 0, W, H, 12);
    ctx.fillStyle = COL.bg; ctx.fill();

    // Header
    ctx.font = fh.getBoldFont(20); ctx.fillStyle = COL.text;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('Pong!', 20, 34);

    // Status badge (top-right)
    const badgeW = ctx.measureText(status.label).width + 20;
    ctx.font = fh.getSemiBoldFont(11);
    const bw = ctx.measureText(status.label).width + 16;
    drawRoundedRect(ctx, W - 20 - bw, 18, bw, 22, 6);
    ctx.fillStyle = status.color + '30'; ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = fh.getSemiBoldFont(11); ctx.fillStyle = status.color;
    ctx.fillText(status.label, W - 20 - bw / 2, 33);
    ctx.textAlign = 'left';

    // Divider line
    ctx.strokeStyle = COL.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(20, 48); ctx.lineTo(W - 20, 48); ctx.stroke();

    // Stats grid (2 columns)
    const col1x = 20, col2x = W / 2 + 10;
    let y = 72;

    // API Latency
    ctx.font = fh.getFont(11); ctx.fillStyle = COL.muted;
    ctx.fillText('API Latency', col1x, y);
    ctx.font = fh.getBoldFont(22); ctx.fillStyle = status.color;
    ctx.fillText(`${api}ms`, col1x, y + 26);

    // Roundtrip
    ctx.font = fh.getFont(11); ctx.fillStyle = COL.muted;
    ctx.fillText('Roundtrip', col2x, y);
    ctx.font = fh.getBoldFont(22); ctx.fillStyle = COL.text;
    ctx.fillText(roundtripMs !== null ? `${roundtripMs}ms` : '...', col2x, y + 26);

    y += 56;

    // Uptime
    ctx.font = fh.getFont(11); ctx.fillStyle = COL.muted;
    ctx.fillText('Uptime', col1x, y);
    ctx.font = fh.getSemiBoldFont(14); ctx.fillStyle = COL.text;
    ctx.fillText(uptime, col1x, y + 20);

    // Shard
    ctx.font = fh.getFont(11); ctx.fillStyle = COL.muted;
    ctx.fillText('Shard', col2x, y);
    ctx.font = fh.getSemiBoldFont(14); ctx.fillStyle = COL.text;
    ctx.fillText(`#${shard}`, col2x, y + 20);

    // Footer line
    ctx.font = fh.getFont(10); ctx.fillStyle = COL.dim;
    ctx.fillText('xNico • System Latency', 20, H - 12);
    ctx.textAlign = 'right';
    ctx.fillText(new Date().toUTCString().slice(0, -4), W - 20, H - 12);

    return canvas.toBuffer('image/png');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency'),
    prefix: 'ping',
    description: 'Check bot latency',
    usage: 'ping',
    category: 'basic',
    aliases: ['pong', 'latency'],
    dmAllowed: true,

    async execute(interaction) {
        try {
            const start = Date.now();
            await interaction.deferReply();
            const roundtrip = Date.now() - start;
            const buffer = await buildPingCard(interaction.client, roundtrip);
            await interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'ping.png' })] });
        } catch (error) {
            const content = '<:Cancel:1521227723916181644> Failed to check latency.';
            if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
            else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    },

    async executePrefix(message) {
        try {
            const start = Date.now();
            const sent = await message.reply({ content: '<:Heartbeat:1521228203665129664> Pinging...' });
            const roundtrip = sent.createdTimestamp - message.createdTimestamp;
            const buffer = await buildPingCard(message.client, roundtrip);
            await sent.edit({ content: null, files: [new AttachmentBuilder(buffer, { name: 'ping.png' })] });
        } catch (error) {
            await message.reply('<:Cancel:1521227723916181644> Failed to check latency.').catch(() => {});
        }
    },
};
