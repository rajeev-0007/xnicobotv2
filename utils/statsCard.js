'use strict';

/**
 * statsCard.js — clean 880×400 user stats summary card.
 *
 * Restrained redesign: one flat gradient background, a clean header
 * (avatar + name + scope + rank as plain text), and five stats laid
 * out on a tidy 3+2 grid of flat panels. No stacked glow/lattice.
 */

const { createCanvas } = require('@napi-rs/canvas');
const imageCache = require('./imageCache');
const { registerAllFonts, getFontHelpers } = require('./fontRegistry');
const {
    DESIGN, hexToRgb, rgba, formatNumber, formatVoiceTime,
    drawRoundedRect, drawText, truncateText, drawNicoBranding,
} = require('./canvasDesign');
const { drawTextWithEmoji } = require('./emojiCanvasHelper');

try { registerAllFonts(); } catch {}

const STAT_ICONS = {
    messages: '<:Bookopen:1521227911137595605>',
    voice:    '<:Volumeup:1521228004502536272>',
    xp:       '<:Lightning:1521227915537285150>',
    invites:  '<:Bullhorn:1521227936575914016>',
    commands: '<:Gamepad:1521228035213230090>',
};

/** Flat stat panel: label (muted, top) + value (white, bold, below). */
function drawFlatStat(ctx, fh, { x, y, w, h, label, value, color }) {
    drawRoundedRect(ctx, x, y, w, h, 12);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fill();
    ctx.strokeStyle = rgba(color, 0.35);
    ctx.lineWidth = 1.2;
    drawRoundedRect(ctx, x, y, w, h, 12);
    ctx.stroke();
    // Accent strip on the left
    drawRoundedRect(ctx, x, y, 4, h, 2);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = fh.getSemiBoldFont(11);
    ctx.fillStyle = DESIGN.colors.textMuted;
    ctx.fillText(String(label).toUpperCase(), x + 16, y + 26);

    ctx.font = fh.getBoldFont(24);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(truncateText(ctx, String(value), w - 28), x + 16, y + h - 16);
}

async function generateStatsCard({
    username,
    avatarURL,
    totalMessages = 0,
    voiceTime = 0,
    xp = 0,
    level = 0,
    invites = 0,
    commandsUsed = 0,
    rank = 'N/A',
    scope = 'server',
    scopeLabel = '',
    guildsActive = 0,
    fontFamily,
}) {
    const fh = getFontHelpers(fontFamily || 'Inter');
    const W = 880, H = 400, PAD = 32;
    const accent = '#5865f2';

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    /* ── Background ── */
    ctx.save();
    drawRoundedRect(ctx, 0, 0, W, H, 20);
    ctx.clip();
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#26272b');
    bg.addColorStop(1, '#1c1d21');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = rgba(accent, 0.9);
    ctx.fillRect(0, H - 4, W, 4);
    ctx.restore();

    /* ── Header: avatar + name + scope + rank ── */
    const avSize = 84;
    const avX = PAD, avY = PAD;
    const cx = avX + avSize / 2, cy = avY + avSize / 2;

    ctx.fillStyle = rgba('#000000', 0.25);
    ctx.beginPath();
    ctx.arc(cx, cy, avSize / 2 + 4, 0, Math.PI * 2);
    ctx.fill();
    if (avatarURL) {
        try {
            const avatar = await imageCache.loadWithCache(avatarURL, 5000);
            if (avatar) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, avSize / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(avatar, avX, avY, avSize, avSize);
                ctx.restore();
            }
        } catch {}
    }
    ctx.strokeStyle = accent;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(cx, cy, avSize / 2 + 2, 0, Math.PI * 2);
    ctx.stroke();

    const nameX = avX + avSize + 22;

    // Rank (right-aligned, plain text)
    const rankText = typeof rank === 'number' ? `#${rank}` : String(rank);
    ctx.textAlign = 'right';
    ctx.font = fh.getBoldFont(30);
    ctx.fillStyle = accent;
    ctx.fillText(rankText, W - PAD, avY + 34);
    ctx.font = fh.getSemiBoldFont(12);
    ctx.fillStyle = DESIGN.colors.textMuted;
    ctx.fillText('RANK', W - PAD, avY + 54);
    const rankBlockW = Math.max(
        ctx.measureText('RANK').width,
        (ctx.font = fh.getBoldFont(30), ctx.measureText(rankText).width)
    );
    ctx.textAlign = 'left';

    // Username (fitted clear of the rank block) — emoji-aware
    const nameMaxW = (W - PAD - rankBlockW - 24) - nameX;
    ctx.font = fh.getBoldFont(26);
    ctx.fillStyle = DESIGN.colors.text;
    await drawTextWithEmoji(ctx, truncateText(ctx, username || 'Unknown User', nameMaxW), nameX, avY + 32, 26);

    ctx.font = fh.getFont(13);
    ctx.fillStyle = DESIGN.colors.textMuted;
    const scopeText = scope === 'global'
        ? `Global Stats${guildsActive > 0 ? ` · Active in ${guildsActive} servers` : ''}`
        : (scopeLabel || 'Server Stats');
    ctx.fillText(truncateText(ctx, scopeText, nameMaxW), nameX, avY + 54);

    /* ── Divider ── */
    ctx.strokeStyle = rgba('#ffffff', 0.08);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, avY + avSize + 18);
    ctx.lineTo(W - PAD, avY + avSize + 18);
    ctx.stroke();

    /* ── Stat grid (row 1: 3 across, row 2: 2 across) ── */
    const gridY = avY + avSize + 36;
    const gap = 14;
    const rowH = 78;

    const w3 = (W - PAD * 2 - gap * 2) / 3;
    const row1 = [
        { label: 'Messages',   value: formatNumber(totalMessages),         color: '#5865f2' },
        { label: 'Voice Time', value: formatVoiceTime(voiceTime),          color: '#a855f7' },
        { label: 'XP / Level', value: `${formatNumber(xp)} · Lv.${level}`, color: '#fbbf24' },
    ];
    row1.forEach((s, i) => drawFlatStat(ctx, fh, {
        x: PAD + i * (w3 + gap), y: gridY, w: w3, h: rowH, ...s,
    }));

    const w2 = (W - PAD * 2 - gap) / 2;
    const row2Y = gridY + rowH + gap;
    const row2 = [
        { label: 'Invites',  value: formatNumber(invites),      color: '#34d399' },
        { label: 'Commands', value: formatNumber(commandsUsed), color: '#f472b6' },
    ];
    row2.forEach((s, i) => drawFlatStat(ctx, fh, {
        x: PAD + i * (w2 + gap), y: row2Y, w: w2, h: rowH, ...s,
    }));

    /* ── Border + branding ── */
    ctx.strokeStyle = rgba(accent, 0.18);
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, 0.75, 0.75, W - 1.5, H - 1.5, 20);
    ctx.stroke();

    await drawNicoBranding(ctx, W, H, accent);

    return canvas.toBuffer('image/png');
}

module.exports = { generateStatsCard };
