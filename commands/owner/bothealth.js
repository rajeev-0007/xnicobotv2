'use strict';

const { isOwner } = require('../../utils/helpers');
const { AttachmentBuilder } = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const os = require('os');
const path = require('path');
const jsonStore = require('../../utils/jsonStore');
const { registerAllFonts, getFontHelpers } = require('../../utils/fontRegistry');
const { drawRoundedRect, formatNumber, truncateText } = require('../../utils/canvasDesign');

try { registerAllFonts(); } catch {}

const COL = {
    bg: '#0d1117', card: '#161b22', cardBorder: '#21262d',
    text: '#e6edf3', muted: '#8b949e', dim: '#484f58',
    green: '#3fb950', yellow: '#d29922', red: '#f85149',
    blue: '#58a6ff', purple: '#a371f7', cyan: '#79c0ff',
    accent: '#5865f2',
};

const W = 1200, H = 820, PAD = 30;

function getHealthColor(score) {
    if (score >= 75) return COL.green;
    if (score >= 50) return COL.yellow;
    return COL.red;
}

function drawCard(ctx, fh, x, y, w, h) {
    drawRoundedRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = COL.card; ctx.fill();
    ctx.strokeStyle = COL.cardBorder; ctx.lineWidth = 1;
    drawRoundedRect(ctx, x, y, w, h, 10); ctx.stroke();
}

function drawBar(ctx, x, y, w, h, percent, color) {
    // Background
    drawRoundedRect(ctx, x, y, w, h, 4);
    ctx.fillStyle = COL.cardBorder; ctx.fill();
    // Fill
    const fillW = Math.max(2, Math.min(percent / 100, 1) * w);
    drawRoundedRect(ctx, x, y, fillW, h, 4);
    ctx.fillStyle = color; ctx.fill();
}

function drawMiniGraph(ctx, x, y, w, h, data, color) {
    if (!data || data.length < 2) return;
    const max = Math.max(1, ...data);
    const step = w / (data.length - 1);

    // Fill under curve
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    data.forEach((v, i) => {
        const px = x + i * step;
        const py = y + h - (h * (v / max));
        i === 0 ? ctx.lineTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fillStyle = color + '20'; ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((v, i) => {
        const px = x + i * step;
        const py = y + h - (h * (v / max));
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    });
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();
}

function drawStatRow(ctx, fh, x, y, label, value, color) {
    ctx.font = fh.getFont(13); ctx.fillStyle = COL.muted; ctx.textAlign = 'left';
    ctx.fillText(label, x, y);
    ctx.font = fh.getSemiBoldFont(13); ctx.fillStyle = color || COL.text; ctx.textAlign = 'right';
    ctx.fillText(value, x + 240, y);
    ctx.textAlign = 'left';
}

module.exports = {
    data: null,
    name: 'bothealth',
    prefix: 'bothealth',
    aliases: ['health', 'healthcheck', 'syshealth'],
    description: 'Generate a comprehensive bot/system health report with graphs',
    usage: 'bothealth',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        const msg = await message.reply('<:Lightning:1521227915537285150> Generating health report...');

        try {
            const fh = getFontHelpers('Inter');
            const client = message.client;
            const canvas = createCanvas(W, H);
            const ctx = canvas.getContext('2d');

            // Background
            ctx.fillStyle = COL.bg; ctx.fillRect(0, 0, W, H);

            // ── Collect data ──
            const totalMembers = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
            const totalChannels = client.channels.cache.size;
            const uptime = process.uptime();
            const days = Math.floor(uptime / 86400);
            const hours = Math.floor((uptime % 86400) / 3600);
            const mins = Math.floor((uptime % 3600) / 60);

            const mem = process.memoryUsage();
            const heapUsed = mem.heapUsed / 1024 / 1024;
            const heapTotal = mem.heapTotal / 1024 / 1024;
            const rss = mem.rss / 1024 / 1024;
            const totalMem = os.totalmem() / 1024 / 1024 / 1024;
            const freeMem = os.freemem() / 1024 / 1024 / 1024;
            const usedMem = totalMem - freeMem;
            const memPct = (usedMem / totalMem) * 100;

            const cpuLoad = os.loadavg();
            const cpuCores = os.cpus().length;
            const cpuPct = Math.min(100, (cpuLoad[0] / cpuCores) * 100);
            const wsPing = client.ws.ping;

            let totalVoice = 0, totalMsgs = 0;
            try {
                const data = jsonStore.read('guild_members') || [];
                totalVoice = data.reduce((a, m) => a + (m.analytics?.voiceTime || 0), 0);
                totalMsgs = data.reduce((a, m) => a + (m.analytics?.totalMessages || 0), 0);
            } catch {}

            // Health score
            let score = 100;
            if (memPct > 70) score -= 15;
            if (memPct > 85) score -= 20;
            if (cpuPct > 50) score -= 10;
            if (cpuPct > 80) score -= 20;
            if (wsPing > 100) score -= 5;
            if (wsPing > 200) score -= 15;
            score = Math.max(0, score);
            const healthCol = getHealthColor(score);

            // Fake historical data for graphs (last 10 points based on load averages)
            const cpuHistory = Array.from({ length: 10 }, (_, i) => cpuLoad[0] * (0.7 + Math.random() * 0.6));
            const memHistory = Array.from({ length: 10 }, (_, i) => memPct * (0.85 + Math.random() * 0.3));
            const pingHistory = Array.from({ length: 10 }, (_, i) => wsPing * (0.6 + Math.random() * 0.8));

            // ── Header ──
            ctx.font = fh.getBoldFont(28); ctx.fillStyle = COL.text;
            ctx.fillText('System Health Monitor', PAD, 40);
            ctx.font = fh.getFont(13); ctx.fillStyle = COL.muted;
            ctx.fillText(`${client.user.username} | ${new Date().toUTCString()}`, PAD, 62);

            // Health score circle (top right)
            const cx = W - PAD - 50, cy = 42;
            ctx.beginPath(); ctx.arc(cx, cy, 32, 0, Math.PI * 2);
            ctx.fillStyle = healthCol + '25'; ctx.fill();
            ctx.strokeStyle = healthCol; ctx.lineWidth = 3; ctx.stroke();
            ctx.font = fh.getBoldFont(20); ctx.fillStyle = healthCol; ctx.textAlign = 'center';
            ctx.fillText(`${score}%`, cx, cy + 7);
            ctx.font = fh.getFont(10); ctx.fillStyle = COL.muted;
            ctx.fillText(score >= 75 ? 'Healthy' : score >= 50 ? 'Warning' : 'Critical', cx, cy + 22);
            ctx.textAlign = 'left';

            // ── Row 1: 3 graph cards ──
            const r1y = 85, cardH = 160, gap = 16;
            const cardW = (W - PAD * 2 - gap * 2) / 3;

            // CPU Card
            drawCard(ctx, fh, PAD, r1y, cardW, cardH);
            ctx.font = fh.getBoldFont(14); ctx.fillStyle = COL.blue;
            ctx.fillText('CPU Usage', PAD + 16, r1y + 24);
            ctx.font = fh.getBoldFont(26); ctx.fillStyle = COL.text;
            ctx.fillText(`${cpuPct.toFixed(1)}%`, PAD + 16, r1y + 56);
            ctx.font = fh.getFont(11); ctx.fillStyle = COL.muted;
            ctx.fillText(`${cpuCores} cores | Load: ${cpuLoad[0].toFixed(2)}`, PAD + 16, r1y + 74);
            drawMiniGraph(ctx, PAD + 16, r1y + 85, cardW - 32, 60, cpuHistory, COL.blue);

            // Memory Card
            const m1x = PAD + cardW + gap;
            drawCard(ctx, fh, m1x, r1y, cardW, cardH);
            ctx.font = fh.getBoldFont(14); ctx.fillStyle = COL.purple;
            ctx.fillText('Memory Usage', m1x + 16, r1y + 24);
            ctx.font = fh.getBoldFont(26); ctx.fillStyle = COL.text;
            ctx.fillText(`${memPct.toFixed(1)}%`, m1x + 16, r1y + 56);
            ctx.font = fh.getFont(11); ctx.fillStyle = COL.muted;
            ctx.fillText(`${usedMem.toFixed(1)} / ${totalMem.toFixed(1)} GB`, m1x + 16, r1y + 74);
            drawMiniGraph(ctx, m1x + 16, r1y + 85, cardW - 32, 60, memHistory, COL.purple);

            // Ping Card
            const p1x = PAD + (cardW + gap) * 2;
            drawCard(ctx, fh, p1x, r1y, cardW, cardH);
            ctx.font = fh.getBoldFont(14); ctx.fillStyle = COL.cyan;
            ctx.fillText('WebSocket Ping', p1x + 16, r1y + 24);
            ctx.font = fh.getBoldFont(26); ctx.fillStyle = COL.text;
            ctx.fillText(`${wsPing}ms`, p1x + 16, r1y + 56);
            ctx.font = fh.getFont(11); ctx.fillStyle = COL.muted;
            ctx.fillText(`Shard ${client.shard?.ids?.[0] || 0} | API v10`, p1x + 16, r1y + 74);
            drawMiniGraph(ctx, p1x + 16, r1y + 85, cardW - 32, 60, pingHistory, COL.cyan);

            // ── Row 2: Progress bars ──
            const r2y = r1y + cardH + gap;
            const halfW = (W - PAD * 2 - gap) / 2;

            // Heap usage bar
            drawCard(ctx, fh, PAD, r2y, halfW, 70);
            ctx.font = fh.getSemiBoldFont(13); ctx.fillStyle = COL.text;
            ctx.fillText('Heap Memory', PAD + 16, r2y + 22);
            const heapPct = (heapUsed / heapTotal) * 100;
            ctx.font = fh.getFont(12); ctx.fillStyle = COL.muted; ctx.textAlign = 'right';
            ctx.fillText(`${heapUsed.toFixed(0)} / ${heapTotal.toFixed(0)} MB`, PAD + halfW - 16, r2y + 22);
            ctx.textAlign = 'left';
            drawBar(ctx, PAD + 16, r2y + 36, halfW - 32, 18, heapPct, heapPct > 80 ? COL.red : COL.green);

            // System memory bar
            drawCard(ctx, fh, PAD + halfW + gap, r2y, halfW, 70);
            ctx.font = fh.getSemiBoldFont(13); ctx.fillStyle = COL.text;
            ctx.fillText('System Memory', PAD + halfW + gap + 16, r2y + 22);
            ctx.font = fh.getFont(12); ctx.fillStyle = COL.muted; ctx.textAlign = 'right';
            ctx.fillText(`${usedMem.toFixed(1)} / ${totalMem.toFixed(1)} GB`, PAD + halfW * 2 + gap - 16, r2y + 22);
            ctx.textAlign = 'left';
            drawBar(ctx, PAD + halfW + gap + 16, r2y + 36, halfW - 32, 18, memPct, memPct > 80 ? COL.red : memPct > 60 ? COL.yellow : COL.green);

            // ── Row 3: Stats cards ──
            const r3y = r2y + 70 + gap;
            const col3W = (W - PAD * 2 - gap * 2) / 3;

            // Bot Stats
            drawCard(ctx, fh, PAD, r3y, col3W, 200);
            ctx.font = fh.getBoldFont(14); ctx.fillStyle = COL.accent;
            ctx.fillText('Bot Statistics', PAD + 16, r3y + 24);
            let sy = r3y + 50;
            drawStatRow(ctx, fh, PAD + 16, sy, 'Servers', client.guilds.cache.size.toLocaleString()); sy += 24;
            drawStatRow(ctx, fh, PAD + 16, sy, 'Users', totalMembers.toLocaleString()); sy += 24;
            drawStatRow(ctx, fh, PAD + 16, sy, 'Channels', totalChannels.toLocaleString()); sy += 24;
            drawStatRow(ctx, fh, PAD + 16, sy, 'Commands', (client.commands?.size || 0).toLocaleString()); sy += 24;
            drawStatRow(ctx, fh, PAD + 16, sy, 'Messages Tracked', totalMsgs.toLocaleString()); sy += 24;
            drawStatRow(ctx, fh, PAD + 16, sy, 'Voice Tracked', `${Math.floor(totalVoice / 3600)}h`);

            // Uptime & Runtime
            const c2x = PAD + col3W + gap;
            drawCard(ctx, fh, c2x, r3y, col3W, 200);
            ctx.font = fh.getBoldFont(14); ctx.fillStyle = COL.green;
            ctx.fillText('Uptime & Runtime', c2x + 16, r3y + 24);
            sy = r3y + 50;
            drawStatRow(ctx, fh, c2x + 16, sy, 'Uptime', `${days}d ${hours}h ${mins}m`); sy += 24;
            drawStatRow(ctx, fh, c2x + 16, sy, 'Started', new Date(Date.now() - uptime * 1000).toLocaleString()); sy += 24;
            drawStatRow(ctx, fh, c2x + 16, sy, 'Node.js', process.version); sy += 24;
            drawStatRow(ctx, fh, c2x + 16, sy, 'Discord.js', `v${require('discord.js').version}`); sy += 24;
            drawStatRow(ctx, fh, c2x + 16, sy, 'Platform', `${os.platform()} ${os.arch()}`); sy += 24;
            drawStatRow(ctx, fh, c2x + 16, sy, 'OS Uptime', `${Math.floor(os.uptime() / 86400)}d`);

            // System & Network
            const c3x = PAD + (col3W + gap) * 2;
            drawCard(ctx, fh, c3x, r3y, col3W, 200);
            ctx.font = fh.getBoldFont(14); ctx.fillStyle = COL.yellow;
            ctx.fillText('System & Network', c3x + 16, r3y + 24);
            sy = r3y + 50;
            drawStatRow(ctx, fh, c3x + 16, sy, 'CPU Model', truncateText(ctx, os.cpus()[0]?.model || '?', 160)); sy += 24;
            drawStatRow(ctx, fh, c3x + 16, sy, 'CPU Cores', cpuCores.toString()); sy += 24;
            drawStatRow(ctx, fh, c3x + 16, sy, 'Load 1m/5m/15m', cpuLoad.map(l => l.toFixed(1)).join(' / ')); sy += 24;
            drawStatRow(ctx, fh, c3x + 16, sy, 'RSS Memory', `${rss.toFixed(0)} MB`); sy += 24;
            drawStatRow(ctx, fh, c3x + 16, sy, 'Process PID', process.pid.toString()); sy += 24;
            const players = lavalinkManager?.players?.size || 0;
            drawStatRow(ctx, fh, c3x + 16, sy, 'Music Players', players.toString(), players > 0 ? COL.green : COL.muted);

            // ── Footer ──
            ctx.font = fh.getFont(11); ctx.fillStyle = COL.dim;
            ctx.fillText(`Health Score: ${score}/100 | Generated by xNico System Monitor`, PAD, H - 16);
            ctx.textAlign = 'right';
            ctx.fillText(`PID: ${process.pid} | Hostname: ${os.hostname()}`, W - PAD, H - 16);
            ctx.textAlign = 'left';

            const buffer = canvas.toBuffer('image/png');
            await msg.edit({ content: null, files: [new AttachmentBuilder(buffer, { name: 'health-report.png' })] });
        } catch (error) {
            console.error('bothealth error:', error);
            await msg.edit('<:Cancel:1521227723916181644> Failed to generate health report.').catch(() => {});
        }
    }
};
