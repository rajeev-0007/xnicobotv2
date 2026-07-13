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

/** Catmull-Rom → cubic-bezier smoothing for a clean latency curve. */
function strokeSmooth(ctx, pts) {
    if (pts.length < 2) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
}

function drawGraph(ctx, fh, x, y, w, h, data, color) {
    // Panel
    drawRoundedRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.02)'; ctx.fill();
    ctx.strokeStyle = COL.border; ctx.lineWidth = 1;
    drawRoundedRect(ctx, x, y, w, h, 10); ctx.stroke();

    if (data.length < 2) {
        ctx.font = fh.getFont(12); ctx.fillStyle = COL.dim; ctx.textAlign = 'center';
        ctx.fillText('Collecting latency data…', x + w / 2, y + h / 2 + 4);
        ctx.textAlign = 'left';
        return;
    }

    // Nice rounded max for the y-axis
    const rawMax = Math.max(...data, 1);
    const step = rawMax <= 50 ? 20 : rawMax <= 100 ? 25 : rawMax <= 250 ? 50 : rawMax <= 500 ? 100 : 200;
    const max = Math.ceil((rawMax * 1.15) / step) * step;

    const axisW = 34;                 // room for y-axis labels
    const padT = 12, padB = 14, padR = 12;
    const gx = x + axisW, gy = y + padT, gw = w - axisW - padR, gh = h - padT - padB;
    const n = data.length;
    const px = i => gx + (gw * i) / (n - 1);
    const py = v => gy + gh - (gh * (v / max));

    // Gridlines + y-axis labels
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.font = fh.getFont(9);
    const rows = 4;
    for (let i = 0; i <= rows; i++) {
        const val = (max / rows) * (rows - i);
        const yy = gy + (gh * i) / rows;
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gx, yy); ctx.lineTo(gx + gw, yy); ctx.stroke();
        ctx.fillStyle = COL.dim;
        ctx.fillText(`${Math.round(val)}`, gx - 8, yy);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    const pts = data.map((v, i) => ({ x: px(i), y: py(v) }));

    // Area fill (under the smoothed curve)
    ctx.save();
    ctx.beginPath();
    strokeSmooth(ctx, pts);
    ctx.lineTo(gx + gw, gy + gh);
    ctx.lineTo(gx, gy + gh);
    ctx.closePath();
    const areaGrad = ctx.createLinearGradient(0, gy, 0, gy + gh);
    areaGrad.addColorStop(0, color + '33');
    areaGrad.addColorStop(1, color + '05');
    ctx.fillStyle = areaGrad; ctx.fill();
    ctx.restore();

    // Smoothed line with glow
    ctx.save();
    ctx.beginPath();
    strokeSmooth(ctx, pts);
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    // Last point marker
    const last = pts[n - 1];
    ctx.beginPath(); ctx.arc(last.x, last.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = COL.bg; ctx.lineWidth = 2; ctx.stroke();
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

    const W = 520, H = 340, PAD = 22;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Card background + border
    drawRoundedRect(ctx, 0, 0, W, H, 14);
    ctx.fillStyle = COL.bg; ctx.fill();
    ctx.strokeStyle = COL.border; ctx.lineWidth = 1;
    drawRoundedRect(ctx, 0.5, 0.5, W - 1, H - 1, 14); ctx.stroke();

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    // ── Header ──
    ctx.font = fh.getBoldFont(20); ctx.fillStyle = COL.text;
    ctx.fillText('Latency', PAD, PAD + 18);
    ctx.font = fh.getFont(11); ctx.fillStyle = COL.dim;
    ctx.fillText('Gateway & API response', PAD, PAD + 34);

    // Status pill (top-right)
    ctx.font = fh.getSemiBoldFont(11);
    const bw = ctx.measureText(status.label).width + 20;
    const bx = W - PAD - bw;
    drawRoundedRect(ctx, bx, PAD, bw, 24, 12);
    ctx.fillStyle = status.color + '26'; ctx.fill();
    ctx.strokeStyle = status.color + '80'; ctx.lineWidth = 1;
    drawRoundedRect(ctx, bx, PAD, bw, 24, 12); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillStyle = status.color;
    ctx.fillText(status.label, bx + bw / 2, PAD + 16);
    ctx.textAlign = 'left';

    // ── Big API number ──
    const numY = PAD + 84;
    ctx.font = fh.getFont(11); ctx.fillStyle = COL.muted;
    ctx.fillText('API LATENCY', PAD, PAD + 58);
    ctx.font = fh.getBoldFont(40); ctx.fillStyle = status.color;
    ctx.fillText(`${api}`, PAD, numY);
    const bigW = ctx.measureText(`${api}`).width;
    ctx.font = fh.getFont(15); ctx.fillStyle = COL.muted;
    ctx.fillText('ms', PAD + bigW + 6, numY);

    // avg / peak (right, aligned with the number)
    ctx.textAlign = 'right';
    ctx.font = fh.getSemiBoldFont(12); ctx.fillStyle = COL.text;
    ctx.fillText(`avg ${avg}ms`, W - PAD, numY - 18);
    ctx.font = fh.getFont(11); ctx.fillStyle = COL.muted;
    ctx.fillText(`peak ${peak}ms`, W - PAD, numY);
    ctx.textAlign = 'left';

    // ── Graph ──
    drawGraph(ctx, fh, PAD, PAD + 98, W - PAD * 2, 130, hist, status.color);

    // ── Bottom stat row ──
    const by = H - PAD - 6;
    ctx.strokeStyle = COL.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, by - 26); ctx.lineTo(W - PAD, by - 26); ctx.stroke();

    const cols = 4;
    const colW = (W - PAD * 2) / cols;
    const cell = (label, val, i) => {
        const cx = PAD + i * colW;
        ctx.font = fh.getFont(9); ctx.fillStyle = COL.dim; ctx.fillText(label, cx, by - 10);
        ctx.font = fh.getSemiBoldFont(13); ctx.fillStyle = COL.text; ctx.fillText(val, cx, by + 8);
    };
    cell('ROUNDTRIP', roundtripMs !== null ? `${roundtripMs}ms` : '…', 0);
    cell('UPTIME', uptime, 1);
    cell('SHARD', `#${shard}`, 2);
    cell('SAMPLES', String(hist.length), 3);

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
