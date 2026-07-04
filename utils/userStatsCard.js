'use strict';

/**
 * userStatsCard.js — Statbot-style server activity card for /userstats.
 *
 * Renders a clean, minimal dashboard card: header (avatar, name, server,
 * created/joined dates), server ranks, message + voice breakdowns (1d/7d/14d),
 * top channels, and a 14-day message/voice activity chart.
 *
 * © Rajeev (Rexzy) — xNico
 */

const { createCanvas } = require('@napi-rs/canvas');
const imageCache = require('./imageCache');
const { registerAllFonts, getFontHelpers } = require('./fontRegistry');
const { drawRoundedRect, truncateText, formatNumber } = require('./canvasDesign');
const { drawTextWithEmoji } = require('./emojiCanvasHelper');

try { registerAllFonts(); } catch {}

const COL = {
    bg:        '#1e2024',
    panel:     '#2b2d31',
    panelSoft: '#26282c',
    chip:      '#1b1d21',
    text:      '#ffffff',
    muted:     '#a8adb6',
    dim:       '#7a8088',
    msg:       '#57F287',  // green  — messages
    voice:     '#EB459E',  // pink   — voice
    accent:    '#5865f2',
    border:    'rgba(255,255,255,0.06)',
};

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

function rankText(rank, total) {
    if (!rank) return 'Unranked';
    return `#${rank}`;
}

/** Rounded panel with title + optional right-aligned icon glyph. */
function panel(ctx, fh, x, y, w, h, title, rightGlyph) {
    drawRoundedRect(ctx, x, y, w, h, 12);
    ctx.fillStyle = COL.panel;
    ctx.fill();
    ctx.strokeStyle = COL.border;
    ctx.lineWidth = 1;
    drawRoundedRect(ctx, x, y, w, h, 12);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = fh.getBoldFont(15);
    ctx.fillStyle = COL.text;
    ctx.fillText(title, x + 14, y + 26);

    if (rightGlyph) {
        ctx.textAlign = 'right';
        ctx.font = fh.getBoldFont(15);
        ctx.fillStyle = COL.muted;
        ctx.fillText(rightGlyph, x + w - 14, y + 26);
        ctx.textAlign = 'left';
    }
}

/** A small chip row: bold left label inside a darker pill + value to its right. */
function chipRow(ctx, fh, x, y, w, label, value, valueColor) {
    const chipW = 54, chipH = 26;
    drawRoundedRect(ctx, x, y, chipW, chipH, 7);
    ctx.fillStyle = COL.chip;
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = fh.getBoldFont(12);
    ctx.fillStyle = COL.text;
    ctx.fillText(label, x + chipW / 2, y + chipH / 2 + 1);

    ctx.textAlign = 'left';
    ctx.font = fh.getSemiBoldFont(13);
    ctx.fillStyle = valueColor || COL.text;
    ctx.fillText(value, x + chipW + 12, y + chipH / 2 + 1);
    ctx.textBaseline = 'alphabetic';
}

function drawChart(ctx, x, y, w, h, series) {
    // Plot area
    drawRoundedRect(ctx, x, y, w, h, 8);
    ctx.fillStyle = COL.panelSoft;
    ctx.fill();

    const padX = 10, padY = 10;
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
            if (i === 0) ctx.moveTo(vx, vy);
            else ctx.lineTo(vx, vy);
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
    };

    plot('vc', maxVc, COL.voice);
    plot('msg', maxMsg, COL.msg);
}

async function generateUserStatsCard(data) {
    const {
        username, handle, avatarURL, serverName,
        createdTs, joinedTs,
        msgRank, vcRank, msgTotalRanked, vcTotalRanked,
        msg1d, msg7d, msg14d,
        vc1d, vc7d, vc14d,
        topMsgChannelName, topMsgChannelValue,
        topVcChannelName, topVcChannelValue,
        series = [],
    } = data;

    const fh = getFontHelpers('Inter');
    const W = 900, H = 500, PAD = 24;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // ── Background ──
    drawRoundedRect(ctx, 0, 0, W, H, 18);
    ctx.fillStyle = COL.bg;
    ctx.fill();

    // ════ Header ════
    const headerH = 84;
    // Avatar
    const avSize = 58, avX = PAD, avY = 18;
    if (avatarURL) {
        try {
            const av = await imageCache.loadWithCache(avatarURL, 5000);
            if (av) {
                ctx.save();
                drawRoundedRect(ctx, avX, avY, avSize, avSize, 12);
                ctx.clip();
                ctx.drawImage(av, avX, avY, avSize, avSize);
                ctx.restore();
            }
        } catch { /* ignore */ }
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    // Username (bold) + handle (muted) — emoji-aware so display-name emojis render
    ctx.font = fh.getBoldFont(24);
    ctx.fillStyle = COL.text;
    const nameX = avX + avSize + 16;
    const nameStr = truncateText(ctx, username, 300);
    const nameW = await drawTextWithEmoji(ctx, nameStr, nameX, avY + 26, 24);
    ctx.font = fh.getFont(15);
    ctx.fillStyle = COL.muted;
    await drawTextWithEmoji(ctx, truncateText(ctx, handle || '', 200), nameX + nameW + 10, avY + 26, 15);
    // Server name with badge
    drawRoundedRect(ctx, nameX, avY + 40, 14, 14, 4);
    ctx.fillStyle = COL.accent;
    ctx.fill();
    ctx.font = fh.getSemiBoldFont(14);
    ctx.fillStyle = COL.muted;
    ctx.fillText(truncateText(ctx, serverName || 'Server', 320), nameX + 22, avY + 52);

    // Created / Joined pills (top-right)
    const pillW = 150, pillH = 50, pillGap = 12;
    const joinX = W - PAD - pillW;
    const createX = joinX - pillGap - pillW;
    const drawDatePill = (px, label, date) => {
        drawRoundedRect(ctx, px, avY, pillW, pillH, 10);
        ctx.fillStyle = COL.panel;
        ctx.fill();
        ctx.textAlign = 'center';
        // label chip
        const lblW = ctx.measureText(label).width;
        drawRoundedRect(ctx, px + pillW / 2 - 46, avY - 9, 92, 18, 6);
        ctx.fillStyle = COL.chip;
        ctx.fill();
        ctx.font = fh.getBoldFont(11);
        ctx.fillStyle = COL.muted;
        ctx.fillText(label, px + pillW / 2, avY + 3);
        ctx.font = fh.getSemiBoldFont(14);
        ctx.fillStyle = COL.text;
        ctx.fillText(truncateText(ctx, date, pillW - 16), px + pillW / 2, avY + 38);
        ctx.textAlign = 'left';
    };
    drawDatePill(createX, 'Created On', fmtDate(createdTs));
    drawDatePill(joinX, 'Joined On', fmtDate(joinedTs));

    // ════ Row 1: Ranks | Messages | Voice ════
    const r1y = headerH + 18, r1h = 132;
    const usable = W - PAD * 2;
    const gap = 14;
    const ranksW = 232;
    const colW = (usable - ranksW - gap * 2) / 2;
    const ranksX = PAD;
    const msgX = ranksX + ranksW + gap;
    const vcX = msgX + colW + gap;

    // Server Ranks
    panel(ctx, fh, ranksX, r1y, ranksW, r1h, 'Server Ranks', '🏆');
    const subW = ranksW - 28, subH = 40;
    const drawRankPill = (sy, label, value) => {
        drawRoundedRect(ctx, ranksX + 14, sy, subW, subH, 8);
        ctx.fillStyle = COL.panelSoft;
        ctx.fill();
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = fh.getSemiBoldFont(14);
        ctx.fillStyle = COL.text;
        ctx.fillText(label, ranksX + 28, sy + subH / 2);
        ctx.textAlign = 'right';
        ctx.font = fh.getBoldFont(15);
        ctx.fillStyle = COL.muted;
        ctx.fillText(value, ranksX + 14 + subW - 14, sy + subH / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    };
    drawRankPill(r1y + 42, 'Message', rankText(msgRank, msgTotalRanked));
    drawRankPill(r1y + 88, 'Voice', rankText(vcRank, vcTotalRanked));

    // Messages
    panel(ctx, fh, msgX, r1y, colW, r1h, 'Messages', '#');
    chipRow(ctx, fh, msgX + 14, r1y + 42, colW, '1d', `${formatNumber(msg1d)} messages`, COL.muted);
    chipRow(ctx, fh, msgX + 14, r1y + 76, colW, '7d', `${formatNumber(msg7d)} messages`, COL.muted);
    chipRow(ctx, fh, msgX + 14, r1y + 110, colW, '14d', `${formatNumber(msg14d)} messages`, COL.muted);

    // Voice Activity
    panel(ctx, fh, vcX, r1y, colW, r1h, 'Voice Activity', '🔊');
    chipRow(ctx, fh, vcX + 14, r1y + 42, colW, '1d', `${fmtHours(vc1d)} hours`, COL.muted);
    chipRow(ctx, fh, vcX + 14, r1y + 76, colW, '7d', `${fmtHours(vc7d)} hours`, COL.muted);
    chipRow(ctx, fh, vcX + 14, r1y + 110, colW, '14d', `${fmtHours(vc14d)} hours`, COL.muted);

    // ════ Row 2: Top Channels | Charts ════
    const r2y = r1y + r1h + 16, r2h = 168;
    const topW = 472;
    const chartX = PAD + topW + gap;
    const chartW = usable - topW - gap;

    // Top Channels & Applications
    panel(ctx, fh, PAD, r2y, topW, r2h, 'Top Channels & Applications', '📈');
    const drawTopRow = (ry, glyph, name, value, glyphColor) => {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        drawRoundedRect(ctx, PAD + 14, ry, 30, 30, 7);
        ctx.fillStyle = COL.chip; ctx.fill();
        ctx.font = fh.getBoldFont(14); ctx.fillStyle = glyphColor || COL.muted;
        ctx.fillText(glyph, PAD + 14 + 15, ry + 16);
        // name pill
        drawRoundedRect(ctx, PAD + 52, ry, topW - 52 - 130, 30, 7);
        ctx.fillStyle = COL.panelSoft; ctx.fill();
        ctx.textAlign = 'left';
        ctx.font = fh.getSemiBoldFont(13); ctx.fillStyle = COL.text;
        ctx.fillText(truncateText(ctx, name || '—', topW - 52 - 150), PAD + 64, ry + 16);
        // value
        ctx.textAlign = 'right'; ctx.font = fh.getFont(13); ctx.fillStyle = COL.muted;
        ctx.fillText(value || '', PAD + topW - 16, ry + 16);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    };
    drawTopRow(r2y + 44, '#', topMsgChannelName, topMsgChannelValue ? `${formatNumber(topMsgChannelValue)} messages` : 'No data', COL.msg);
    drawTopRow(r2y + 88, '🔊', topVcChannelName, topVcChannelValue ? `${fmtHours(topVcChannelValue)} hours` : 'No data', COL.voice);
    drawTopRow(r2y + 132, '🔗', '', '', COL.muted);

    // Charts
    panel(ctx, fh, chartX, r2y, chartW, r2h, 'Charts');
    // Legend
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const legY = r2y + 20;
    ctx.fillStyle = COL.msg;
    ctx.beginPath(); ctx.arc(chartX + chartW - 150, legY, 5, 0, Math.PI * 2); ctx.fill();
    ctx.font = fh.getSemiBoldFont(13); ctx.fillStyle = COL.text;
    ctx.fillText('Message', chartX + chartW - 140, legY + 1);
    ctx.fillStyle = COL.voice;
    ctx.beginPath(); ctx.arc(chartX + chartW - 70, legY, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = COL.text;
    ctx.fillText('Voice', chartX + chartW - 60, legY + 1);
    ctx.textBaseline = 'alphabetic';
    drawChart(ctx, chartX + 12, r2y + 40, chartW - 24, r2h - 56, series);

    // ════ Footer ════
    const footY = r2y + r2h + 22;
    ctx.textAlign = 'left'; ctx.font = fh.getSemiBoldFont(12); ctx.fillStyle = COL.dim;
    ctx.fillText('Server Lookback: Last 14 days  •  Timezone: UTC', PAD, footY);
    ctx.textAlign = 'right'; ctx.font = fh.getSemiBoldFont(12); ctx.fillStyle = COL.dim;
    ctx.fillText('Powered by xNico', W - PAD, footY);

    return canvas.toBuffer('image/png');
}

module.exports = { generateUserStatsCard };
