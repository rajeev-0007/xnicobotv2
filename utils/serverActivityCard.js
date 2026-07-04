'use strict';

/**
 * serverActivityCard.js — Statbot-style "Server Overview" dashboard card.
 *
 * Header (icon, name, created/invited dates) → three stat panels
 * (Messages, Voice Activity, Contributors over 1d/7d/14d) → Top Members +
 * Top Channels → a 14-day Messages-vs-Voice line chart → footer.
 *
 * All figures come from utils/activityTracker (the same per-user data behind
 * /userstats and the leveling system), so everything stays in sync.
 */

const { createCanvas } = require('@napi-rs/canvas');
const { loadImage } = require('@napi-rs/canvas');
const path = require('path');
const imageCache = require('./imageCache');
const { registerAllFonts, getFontHelpers } = require('./fontRegistry');
const { drawRoundedRect, truncateText, formatNumber } = require('./canvasDesign');
const { drawTextWithEmoji, normalizeCanvasText } = require('./emojiCanvasHelper');

try { registerAllFonts(); } catch {}

const FALLBACK_ICON = path.join(__dirname, '..', 'assets', 'images', 'nico-avatar.png');

const COL = {
    bg: '#1e2024', panel: '#2b2d31', panelSoft: '#26282c', chip: '#1b1d21',
    text: '#ffffff', muted: '#a8adb6', dim: '#7a8088',
    msg: '#57F287', voice: '#EB459E', accent: '#5865f2',
    border: 'rgba(255,255,255,0.06)',
};

const W = 1024, PAD = 24;

function fmtHours(seconds) {
    const h = (seconds || 0) / 3600;
    if (h >= 100) return Math.round(h).toLocaleString();
    if (h >= 10) return h.toFixed(2);
    return h.toFixed(h < 1 ? 1 : 2);
}
function fmtDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function panel(ctx, fh, x, y, w, h, title, glyph) {
    drawRoundedRect(ctx, x, y, w, h, 12); ctx.fillStyle = COL.panel; ctx.fill();
    ctx.strokeStyle = COL.border; ctx.lineWidth = 1; drawRoundedRect(ctx, x, y, w, h, 12); ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = fh.getBoldFont(16); ctx.fillStyle = COL.text;
    ctx.fillText(title, x + 16, y + 28);
    if (glyph) {
        ctx.textAlign = 'right'; ctx.font = fh.getBoldFont(14); ctx.fillStyle = COL.muted;
        ctx.fillText(glyph, x + w - 16, y + 28); ctx.textAlign = 'left';
    }
}

/** chip (1d/7d/14d) + value text */
function chipRow(ctx, fh, x, y, label, value) {
    const chipW = 50, chipH = 26;
    drawRoundedRect(ctx, x, y, chipW, chipH, 7); ctx.fillStyle = COL.chip; ctx.fill();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = fh.getBoldFont(12); ctx.fillStyle = COL.text;
    ctx.fillText(label, x + chipW / 2, y + chipH / 2 + 1);
    ctx.textAlign = 'left'; ctx.font = fh.getSemiBoldFont(13); ctx.fillStyle = COL.muted;
    ctx.fillText(value, x + chipW + 12, y + chipH / 2 + 1);
    ctx.textBaseline = 'alphabetic';
}

function drawChart(ctx, x, y, w, h, series) {
    drawRoundedRect(ctx, x, y, w, h, 8); ctx.fillStyle = COL.panelSoft; ctx.fill();
    const padX = 12, padY = 12;
    const px = x + padX, py = y + padY, pw = w - padX * 2, ph = h - padY * 2;
    const n = series.length;
    if (n < 2) return;
    const maxMsg = Math.max(1, ...series.map(s => s.msg));
    const maxVc = Math.max(1, ...series.map(s => s.vc));
    const plot = (key, max, color) => {
        ctx.beginPath();
        series.forEach((s, i) => {
            const vx = px + (pw * i) / (n - 1);
            const vy = py + ph - (ph * (s[key] / max));
            i === 0 ? ctx.moveTo(vx, vy) : ctx.lineTo(vx, vy);
        });
        ctx.strokeStyle = color; ctx.lineWidth = 2.4; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.stroke();
    };
    plot('vc', maxVc, COL.voice);
    plot('msg', maxMsg, COL.msg);
}

/**
 * @param {object} o
 * @param {string} o.serverName
 * @param {string} [o.iconURL]
 * @param {number} o.createdTs
 * @param {number} o.invitedTs
 * @param {object} o.stats   from activityTracker.getServerStats
 * @param {object} o.names   resolved labels: { topMsgUser, topVcUser, topMsgChannel, topVcChannel }
 */
async function createServerActivityCard({ serverName, iconURL, createdTs, invitedTs, stats, names }) {
    const fh = getFontHelpers('Inter');
    const headerH = 96;
    const r1y = headerH + 16, r1h = 150;
    const r2y = r1y + r1h + 16, r2h = 150;
    const r3y = r2y + r2h + 16, r3h = 170;
    const H = r3y + r3h + 44;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    drawRoundedRect(ctx, 0, 0, W, H, 18); ctx.fillStyle = COL.bg; ctx.fill();

    /* ── Header ── */
    const avSize = 60, avX = PAD, avY = 20;
    let iconLoaded = false;
    if (iconURL) {
        try {
            const av = await imageCache.loadWithCache(iconURL, 5000);
            if (av) { ctx.save(); drawRoundedRect(ctx, avX, avY, avSize, avSize, 14); ctx.clip(); ctx.drawImage(av, avX, avY, avSize, avSize); ctx.restore(); iconLoaded = true; }
        } catch {}
    }
    if (!iconLoaded) {
        try {
            const fs = require('fs');
            if (fs.existsSync(FALLBACK_ICON)) {
                const fallback = await loadImage(FALLBACK_ICON);
                ctx.save(); drawRoundedRect(ctx, avX, avY, avSize, avSize, 14); ctx.clip(); ctx.drawImage(fallback, avX, avY, avSize, avSize); ctx.restore();
            } else {
                // Draw a placeholder circle with first letter
                drawRoundedRect(ctx, avX, avY, avSize, avSize, 14); ctx.fillStyle = COL.accent; ctx.fill();
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.font = fh.getBoldFont(24); ctx.fillStyle = COL.text;
                ctx.fillText((serverName || 'S')[0].toUpperCase(), avX + avSize / 2, avY + avSize / 2);
                ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            }
        } catch {
            // Draw placeholder initial
            drawRoundedRect(ctx, avX, avY, avSize, avSize, 14); ctx.fillStyle = COL.accent; ctx.fill();
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = fh.getBoldFont(24); ctx.fillStyle = COL.text;
            ctx.fillText((serverName || 'S')[0].toUpperCase(), avX + avSize / 2, avY + avSize / 2);
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        }
    }
    const nameX = avX + avSize + 16;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = fh.getBoldFont(26); ctx.fillStyle = COL.text;
    await drawTextWithEmoji(ctx, truncateText(ctx, normalizeCanvasText(serverName || 'Server'), 420), nameX, avY + 28, 26);
    ctx.font = fh.getSemiBoldFont(15); ctx.fillStyle = COL.muted;
    ctx.fillText('Server Overview', nameX, avY + 52);

    // Date pills (top-right)
    const pillW = 168, pillH = 52, pillGap = 12;
    const invX = W - PAD - pillW;
    const creX = invX - pillGap - pillW;
    const datePill = (px, label, date) => {
        drawRoundedRect(ctx, px, avY, pillW, pillH, 10); ctx.fillStyle = COL.panel; ctx.fill();
        ctx.textAlign = 'center';
        drawRoundedRect(ctx, px + pillW / 2 - 52, avY - 9, 104, 18, 6); ctx.fillStyle = COL.chip; ctx.fill();
        ctx.font = fh.getBoldFont(11); ctx.fillStyle = COL.muted; ctx.fillText(label, px + pillW / 2, avY + 4);
        ctx.font = fh.getSemiBoldFont(14); ctx.fillStyle = COL.text;
        ctx.fillText(truncateText(ctx, date, pillW - 18), px + pillW / 2, avY + 40);
        ctx.textAlign = 'left';
    };
    datePill(creX, 'Created On', fmtDate(createdTs));
    datePill(invX, 'Invited Bot On', fmtDate(invitedTs));

    /* ── Row 1: Messages | Voice Activity | Contributors ── */
    const usable = W - PAD * 2, gap = 14;
    const colW = (usable - gap * 2) / 3;
    const mX = PAD, vX = mX + colW + gap, cX = vX + colW + gap;

    panel(ctx, fh, mX, r1y, colW, r1h, 'Messages', 'MSG');
    chipRow(ctx, fh, mX + 16, r1y + 46, '1d', `${formatNumber(stats.msg1d)} messages`);
    chipRow(ctx, fh, mX + 16, r1y + 84, '7d', `${formatNumber(stats.msg7d)} messages`);
    chipRow(ctx, fh, mX + 16, r1y + 122, '14d', `${formatNumber(stats.msg14d)} messages`);

    panel(ctx, fh, vX, r1y, colW, r1h, 'Voice Activity', 'VC');
    chipRow(ctx, fh, vX + 16, r1y + 46, '1d', `${fmtHours(stats.vc1d)} hours`);
    chipRow(ctx, fh, vX + 16, r1y + 84, '7d', `${fmtHours(stats.vc7d)} hours`);
    chipRow(ctx, fh, vX + 16, r1y + 122, '14d', `${fmtHours(stats.vc14d)} hours`);

    panel(ctx, fh, cX, r1y, colW, r1h, 'Contributors', null);
    chipRow(ctx, fh, cX + 16, r1y + 46, '1d', `${formatNumber(stats.contrib1d)} members`);
    chipRow(ctx, fh, cX + 16, r1y + 84, '7d', `${formatNumber(stats.contrib7d)} members`);
    chipRow(ctx, fh, cX + 16, r1y + 122, '14d', `${formatNumber(stats.contrib14d)} members`);

    /* ── Row 2: Top Members | Top Channels ── */
    const halfW = (usable - gap) / 2;
    const tmX = PAD, tcX = PAD + halfW + gap;

    const topRow = (x, panelW, ry, glyphColor, name, value) => {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        // Draw colored indicator dot instead of emoji
        drawRoundedRect(ctx, x + 16, ry, 34, 34, 8); ctx.fillStyle = COL.chip; ctx.fill();
        ctx.fillStyle = glyphColor || COL.muted;
        ctx.beginPath(); ctx.arc(x + 16 + 17, ry + 17, 6, 0, Math.PI * 2); ctx.fill();
        const nameW = panelW - 60 - 150;
        drawRoundedRect(ctx, x + 58, ry, nameW, 34, 8); ctx.fillStyle = COL.panelSoft; ctx.fill();
        ctx.textAlign = 'left'; ctx.font = fh.getSemiBoldFont(14); ctx.fillStyle = COL.text;
        ctx.fillText(truncateText(ctx, normalizeCanvasText(name || '—'), nameW - 20), x + 70, ry + 18);
        ctx.textAlign = 'right'; ctx.font = fh.getFont(13); ctx.fillStyle = COL.muted;
        ctx.fillText(value || 'No data', x + panelW - 16, ry + 18);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    };

    panel(ctx, fh, tmX, r2y, halfW, r2h, 'Top Members', null);
    topRow(tmX, halfW, r2y + 50, COL.msg, names.topMsgUser, stats.topMsgUser ? `${formatNumber(stats.topMsgUser.value)} messages` : null);
    topRow(tmX, halfW, r2y + 98, COL.voice, names.topVcUser, stats.topVcUser ? `${fmtHours(stats.topVcUser.value)} hours` : null);

    panel(ctx, fh, tcX, r2y, halfW, r2h, 'Top Channels', null);
    topRow(tcX, halfW, r2y + 50, COL.msg, names.topMsgChannel, stats.topMsgChannel ? `${formatNumber(stats.topMsgChannel.value)} messages` : null);
    topRow(tcX, halfW, r2y + 98, COL.voice, names.topVcChannel, stats.topVcChannel ? `${fmtHours(stats.topVcChannel.value)} hours` : null);

    /* ── Row 3: Charts (full width) ── */
    panel(ctx, fh, PAD, r3y, usable, r3h, 'Charts');
    // legend (top-right)
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = COL.msg; ctx.beginPath(); ctx.arc(W - PAD - 150, r3y + 20, 5, 0, Math.PI * 2); ctx.fill();
    ctx.font = fh.getSemiBoldFont(13); ctx.fillStyle = COL.text; ctx.fillText('Message', W - PAD - 140, r3y + 21);
    ctx.fillStyle = COL.voice; ctx.beginPath(); ctx.arc(W - PAD - 70, r3y + 20, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COL.text; ctx.fillText('Voice', W - PAD - 60, r3y + 21);
    ctx.textBaseline = 'alphabetic';
    drawChart(ctx, PAD + 14, r3y + 42, usable - 28, r3h - 58, stats.series || []);

    /* ── Footer ── */
    const footY = r3y + r3h + 24;
    ctx.textAlign = 'left'; ctx.font = fh.getSemiBoldFont(12); ctx.fillStyle = COL.dim;
    ctx.fillText('Server Lookback: Last 30 days  •  Timezone: UTC', PAD, footY);
    ctx.textAlign = 'right'; ctx.fillStyle = COL.dim;
    ctx.fillText('Powered by xNico', W - PAD, footY);

    return canvas.toBuffer('image/png');
}

module.exports = { createServerActivityCard };
