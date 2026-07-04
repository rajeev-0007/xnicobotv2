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

// Keep a rolling history of API pings for the graph.
global._pingHistory = global._pingHistory || [];
function pushPing(v) {
    global._pingHistory.push(v);
    if (global._pingHistory.length > 24) global._pingHistory.shift();
}

function drawGraph(ctx, fh, x, y, w, h, data, color) {
    // Panel
    drawRoundedRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fill();

    if (data.length < 2) {
        ctx.font = fh.getFont(11); ctx.fillStyle = COL.dim; ctx.textAlign = 'center';
        ctx.fillText('collecting data…', x + w / 2, y + h / 2 + 4);
        ctx.textAlign = 'left';
        return;
    }

    const max = Math.max(...data, 1) * 1.2;
    const min = 0;
    const pad = 10;
    const gx = x + pad, gy = y + pad, gw = w - pad * 2, gh = h - pad * 2;
    const n = data.length;
    const px = i => gx + (gw * i) / (n - 1);
    const py = v => gy + gh - (gh * ((v - min) / (max - min)));

    // Gridlines
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
        const yy = gy + (gh * i) / 3;
        ctx.beginPath(); ctx.moveTo(gx, yy); ctx.lineTo(gx + gw, yy); ctx.stroke();
    }

    // Area fill
    ctx.beginPath();
    ctx.moveTo(gx, gy + gh);
    data.forEach((v, i) => ctx.lineTo(px(i), py(v)));
    ctx.lineTo(gx + gw, gy + gh);
    ctx.closePath();
    ctx.fillStyle = color + '22'; ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((v, i) => { i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)); });
    ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();

    // Last point dot
    const lx = px(n - 1), ly = py(data[n - 1]);
    ctx.beginPath(); ctx.arc(lx, ly, 3.5, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill();
}

async function buildPingCard(client, roundtripMs) {
    const fh = getFontHelpers('Inter');
    const api = Math.round(client.ws.ping);
    pushPing(api >= 0 ? api : 0);
    const status = getStatusInfo(api);
    const uptime = formatUptime(process.uptime());
    const shard = client.shard?.ids?.[0] ?? 0;
    const hist = global._pingHistory;
    const avg = hist.length ? Math.round(hist.reduce((a, b) => a + b, 0) / hist.length) : api;
    const peak = hist.length ? Math.max(...hist) : api;

    const W = 480, H = 300;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    drawRoundedRect(ctx, 0, 0, W, H, 12);
    ctx.fillStyle = COL.bg; ctx.fill();

    // Header
    ctx.font = fh.getBoldFont(20); ctx.fillStyle = COL.text;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('Pong!', 20, 34);

    // Status badge
    ctx.font = fh.getSemiBoldFont(11);
    const bw = ctx.measureText(status.label).width + 16;
    drawRoundedRect(ctx, W - 20 - bw, 18, bw, 22, 6);
    ctx.fillStyle = status.color + '30'; ctx.fill();
    ctx.textAlign = 'center'; ctx.fillStyle = status.color;
    ctx.fillText(status.label, W - 20 - bw / 2, 33);
    ctx.textAlign = 'left';

    // Big API number
    ctx.font = fh.getFont(11); ctx.fillStyle = COL.muted;
    ctx.fillText('API LATENCY', 20, 58);
    ctx.font = fh.getBoldFont(34); ctx.fillStyle = status.color;
    ctx.fillText(`${api}`, 20, 92);
    ctx.font = fh.getFont(14); ctx.fillStyle = COL.muted;
    const numW = ctx.measureText(`${api}`).width;
    ctx.font = fh.getBoldFont(34); const bigW = ctx.measureText(`${api}`).width;
    ctx.font = fh.getFont(14); ctx.fillStyle = COL.muted;
    ctx.fillText('ms', 24 + bigW, 92);

    // Right-side mini stats
    ctx.textAlign = 'right';
    ctx.font = fh.getFont(11); ctx.fillStyle = COL.muted;
    ctx.fillText(`avg ${avg}ms  •  peak ${peak}ms`, W - 20, 92);
    ctx.textAlign = 'left';

    // Graph
    drawGraph(ctx, fh, 20, 108, W - 40, 120, hist, status.color);

    // Bottom stat row
    const by = 258;
    ctx.strokeStyle = COL.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(20, by - 12); ctx.lineTo(W - 20, by - 12); ctx.stroke();

    const cell = (label, val, x) => {
        ctx.font = fh.getFont(10); ctx.fillStyle = COL.muted; ctx.fillText(label, x, by);
        ctx.font = fh.getSemiBoldFont(13); ctx.fillStyle = COL.text; ctx.fillText(val, x, by + 18);
    };
    cell('ROUNDTRIP', roundtripMs !== null ? `${roundtripMs}ms` : '...', 20);
    cell('UPTIME', uptime, 150);
    cell('SHARD', `#${shard}`, 300);
    cell('SAMPLES', String(hist.length), 400);

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
