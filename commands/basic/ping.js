'use strict';

const { SlashCommandBuilder, AttachmentBuilder, MessageFlags } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const { registerAllFonts, getFontHelpers } = require('../../utils/fontRegistry');
const { drawRoundedRect } = require('../../utils/canvasDesign');

try { registerAllFonts(); } catch { }

const COL = {
    bg: '#0b0d12',
    bgGrad: '#12151c',
    card: '#161923',
    panel: '#1a1e29',
    border: '#262b38',
    borderSoft: 'rgba(255,255,255,0.06)',
    text: '#eef1f6',
    muted: '#8b93a7',
    dim: '#565e70',
    green: '#3fb950',
    yellow: '#d29922',
    red: '#f85149',
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
    drawRoundedRect(ctx, x, y, w, h, 12);
    const panelGrad = ctx.createLinearGradient(0, y, 0, y + h);
    panelGrad.addColorStop(0, 'rgba(255,255,255,0.035)');
    panelGrad.addColorStop(1, 'rgba(255,255,255,0.012)');
    ctx.fillStyle = panelGrad; ctx.fill();
    ctx.strokeStyle = COL.border; ctx.lineWidth = 1;
    drawRoundedRect(ctx, x, y, w, h, 12); ctx.stroke();

    // Panel label
    ctx.font = fh.getSemiBoldFont(10); ctx.fillStyle = COL.muted; ctx.textAlign = 'left';
    ctx.fillText('LATENCY HISTORY', x + 14, y + 18);

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

    const axisW = 32;                 // room for y-axis labels
    const padT = 30, padB = 16, padR = 14, padL = 14;
    const gx = x + padL + axisW, gy = y + padT, gw = w - padL - axisW - padR, gh = h - padT - padB;
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
        ctx.strokeStyle = 'rgba(255,255,255,0.045)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(gx, yy); ctx.lineTo(gx + gw, yy); ctx.stroke();
        ctx.fillStyle = COL.dim;
        ctx.fillText(`${Math.round(val)}`, gx - 10, yy);
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
    areaGrad.addColorStop(0, color + '30');
    areaGrad.addColorStop(1, color + '00');
    ctx.fillStyle = areaGrad; ctx.fill();
    ctx.restore();

    // Smoothed line with subtle glow
    ctx.save();
    ctx.beginPath();
    strokeSmooth(ctx, pts);
    ctx.shadowColor = color; ctx.shadowBlur = 10;
    ctx.strokeStyle = color; ctx.lineWidth = 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    // Last point marker (ring + dot)
    const last = pts[n - 1];
    ctx.beginPath(); ctx.arc(last.x, last.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = color + '26'; ctx.fill();
    ctx.beginPath(); ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = COL.card; ctx.lineWidth = 2; ctx.stroke();
}

/** A small bordered stat card used in the footer row — icon dot, label, value. */
function drawStatChip(ctx, fh, x, y, w, h, label, value, accentColor) {
    drawRoundedRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = COL.panel; ctx.fill();
    ctx.strokeStyle = COL.borderSoft; ctx.lineWidth = 1;
    drawRoundedRect(ctx, x, y, w, h, 10); ctx.stroke();

    // Accent tick on the left edge
    drawRoundedRect(ctx, x, y, 3, h, 1.5);
    ctx.fillStyle = accentColor; ctx.fill();

    const px = x + 16;
    ctx.textAlign = 'left';
    ctx.font = fh.getFont(9); ctx.fillStyle = COL.dim;
    ctx.fillText(label, px, y + 18);
    ctx.font = fh.getSemiBoldFont(15); ctx.fillStyle = COL.text;
    ctx.fillText(value, px, y + 38);
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

    const W = 560, H = 400, PAD = 28;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // ── Background: subtle vertical gradient instead of flat fill ──
    drawRoundedRect(ctx, 0, 0, W, H, 18);
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, COL.bgGrad);
    bgGrad.addColorStop(1, COL.bg);
    ctx.fillStyle = bgGrad; ctx.fill();
    ctx.strokeStyle = COL.border; ctx.lineWidth = 1;
    drawRoundedRect(ctx, 0.5, 0.5, W - 1, H - 1, 18); ctx.stroke();

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    // ── Header ──
    ctx.font = fh.getBoldFont(19); ctx.fillStyle = COL.text;
    ctx.fillText('Latency Monitor', PAD, PAD + 16);
    ctx.font = fh.getFont(11); ctx.fillStyle = COL.dim;
    ctx.fillText('Gateway & API response time', PAD, PAD + 33);

    // Status pill — dot + label, top-right
    ctx.font = fh.getSemiBoldFont(11);
    const dotGap = 16;
    const textW = ctx.measureText(status.label).width;
    const bw = textW + dotGap + 26;
    const bh = 26;
    const bx = W - PAD - bw, by = PAD;
    drawRoundedRect(ctx, bx, by, bw, bh, 13);
    ctx.fillStyle = status.color + '20'; ctx.fill();
    ctx.strokeStyle = status.color + '70'; ctx.lineWidth = 1;
    drawRoundedRect(ctx, bx, by, bw, bh, 13); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx + 16, by + bh / 2, 4, 0, Math.PI * 2);
    ctx.fillStyle = status.color; ctx.fill();
    ctx.textAlign = 'left'; ctx.fillStyle = status.color;
    ctx.fillText(status.label, bx + 16 + dotGap - 6, by + bh / 2 + 4);

    // Divider under header
    ctx.strokeStyle = COL.borderSoft; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, PAD + 52); ctx.lineTo(W - PAD, PAD + 52); ctx.stroke();

    // ── Hero: big API number + avg/peak ──
    const heroTop = PAD + 78;
    ctx.font = fh.getSemiBoldFont(10); ctx.fillStyle = COL.muted;
    ctx.fillText('API LATENCY', PAD, heroTop);

    const numY = heroTop + 46;
    ctx.font = fh.getBoldFont(46); ctx.fillStyle = status.color;
    ctx.fillText(`${api}`, PAD, numY);
    const bigW = ctx.measureText(`${api}`).width;
    ctx.font = fh.getFont(16); ctx.fillStyle = COL.muted;
    ctx.fillText('ms', PAD + bigW + 8, numY);

    // avg / peak mini-cards, right-aligned
    const miniW = 92, miniH = 46, miniGap = 10;
    const miniY = numY - 40;
    drawStatChip(ctx, fh, W - PAD - miniW * 2 - miniGap, miniY, miniW, miniH, 'AVG', `${avg}ms`, COL.accent);
    drawStatChip(ctx, fh, W - PAD - miniW, miniY, miniW, miniH, 'PEAK', `${peak}ms`, status.color);

    // ── Graph ──
    const graphY = numY + 32;
    drawGraph(ctx, fh, PAD, graphY, W - PAD * 2, 140, hist, status.color);

    // ── Footer stat cards ──
    const footY = graphY + 140 + 20;
    const cols = 4, gap = 10;
    const cardW = (W - PAD * 2 - gap * (cols - 1)) / cols;
    const cardH = 56;
    const footStats = [
        ['ROUNDTRIP', roundtripMs !== null ? `${roundtripMs}ms` : '…', COL.accent],
        ['UPTIME', uptime, COL.green],
        ['SHARD', `#${shard}`, COL.yellow],
        ['SAMPLES', String(hist.length), COL.muted],
    ];
    footStats.forEach(([label, value, color], i) => {
        drawStatChip(ctx, fh, PAD + i * (cardW + gap), footY, cardW, cardH, label, value, color);
    });

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
            await interaction.deferReply({ ephemeral: interaction.isButton?.() });
            const roundtrip = Date.now() - start;
            const buffer = await buildPingCard(interaction.client, roundtrip);
            await interaction.editReply({ files: [new AttachmentBuilder(buffer, { name: 'ping.png' })] });
        } catch (error) {
            const content = '<:Cancel:1521227723916181644> Failed to check latency.';
            if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => { });
            else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => { });
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
            await message.reply('<:Cancel:1521227723916181644> Failed to check latency.').catch(() => { });
        }
    },
};
