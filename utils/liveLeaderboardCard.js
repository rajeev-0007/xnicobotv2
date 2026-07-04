'use strict';

/**
 * liveLeaderboardCard.js — Canvas-rendered LIVE (auto-refreshing) leaderboard.
 * Professional dark theme with ranked entries, badge-style rank indicators,
 * avatars, and stats. Top 3 get special trophy-colored treatments.
 *
 * Exports createLeaderboardCard() — used by the `liveleaderboard` command.
 * (Separate from leaderboardCard.js which powers the unified `/leaderboard`.)
 */

const { createCanvas } = require('@napi-rs/canvas');
const { registerAllFonts, getFontHelpers } = require('./fontRegistry');
const { drawRoundedRect, truncateText, formatNumber } = require('./canvasDesign');
const imageCache = require('./imageCache');

try { registerAllFonts(); } catch {}

// Rank badge CDN URLs (application emojis)
const RANK_BADGE_URLS = {
    1: 'https://cdn.discordapp.com/emojis/1522972998569689098.png',
    2: 'https://cdn.discordapp.com/emojis/1522973001849770044.png',
    3: 'https://cdn.discordapp.com/emojis/1522973004378935486.png',
    4: 'https://cdn.discordapp.com/emojis/1522973006874279936.png',
    5: 'https://cdn.discordapp.com/emojis/1522973009525080176.png',
    6: 'https://cdn.discordapp.com/emojis/1522973012385599519.png',
    7: 'https://cdn.discordapp.com/emojis/1522973015002976297.png',
};

const COL = {
    bg: '#0f1116', card: '#1a1d24', cardBorder: '#262a33',
    text: '#e6edf3', muted: '#8b949e', dim: '#484f58',
    gold: '#FFD700', silver: '#C0C0C0', bronze: '#CD7F32',
    accent: '#5865f2', green: '#3fb950',
    rank1Bg: '#3d3015', rank2Bg: '#2d2d30', rank3Bg: '#2d2218',
    row1: '#1e2229', row2: '#181c22',
};

const W = 620, PAD = 24, ROW_H = 60, HEADER_H = 90, FOOTER_H = 44;

function getRankStyle(rank) {
    if (rank === 1) return { color: COL.gold, bg: COL.rank1Bg, label: '1ST', trophy: true };
    if (rank === 2) return { color: COL.silver, bg: COL.rank2Bg, label: '2ND', trophy: true };
    if (rank === 3) return { color: COL.bronze, bg: COL.rank3Bg, label: '3RD', trophy: true };
    return { color: COL.muted, bg: null, label: String(rank), trophy: false };
}

function drawRankBadge(ctx, fh, x, y, rank) {
    const style = getRankStyle(rank);
    const badgeSize = 32;

    // Try to draw the badge image if preloaded
    if (rank <= 7 && ctx._badgeImages && ctx._badgeImages[rank]) {
        ctx.drawImage(ctx._badgeImages[rank], x, y, badgeSize, badgeSize);
        return;
    }

    // Fallback: colored circle with number
    ctx.beginPath();
    ctx.arc(x + badgeSize / 2, y + badgeSize / 2, badgeSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = style.color + (style.trophy ? '35' : '20');
    ctx.fill();

    ctx.strokeStyle = style.color + '80';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = fh.getBoldFont(style.trophy ? 12 : 13);
    ctx.fillStyle = style.color;
    ctx.fillText(style.label, x + badgeSize / 2, y + badgeSize / 2 + 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

/**
 * @param {object} opts
 * @param {string} opts.guildName
 * @param {string|null} opts.guildIconURL
 * @param {string} opts.period - 'Daily' | 'Weekly' | 'Monthly' | 'All Time'
 * @param {Array<{rank, username, avatarURL, value, label}>} opts.entries - max 10
 */
async function createLeaderboardCard({ guildName, guildIconURL, period, entries }) {
    const fh = getFontHelpers('Inter');
    const entryCount = Math.min(entries.length, 10);
    const H = HEADER_H + (entryCount * ROW_H) + FOOTER_H + PAD;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Preload rank badge images
    ctx._badgeImages = {};
    const badgeLoads = Object.entries(RANK_BADGE_URLS).map(async ([rank, url]) => {
        try {
            const img = await imageCache.loadWithCache(url, 3000);
            if (img) ctx._badgeImages[Number(rank)] = img;
        } catch {}
    });
    await Promise.all(badgeLoads);

    // Background
    drawRoundedRect(ctx, 0, 0, W, H, 14);
    ctx.fillStyle = COL.bg; ctx.fill();

    // ── Header ──
    const iconSize = 44;
    let iconX = PAD;

    if (guildIconURL) {
        try {
            const icon = await imageCache.loadWithCache(guildIconURL, 4000);
            if (icon) {
                ctx.save();
                drawRoundedRect(ctx, iconX, PAD, iconSize, iconSize, 12); ctx.clip();
                ctx.drawImage(icon, iconX, PAD, iconSize, iconSize);
                ctx.restore();
                iconX += iconSize + 14;
            }
        } catch { /* use text only */ }
    }

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = fh.getBoldFont(22); ctx.fillStyle = COL.text;
    ctx.fillText('Live Leaderboard', iconX, PAD + 24);

    ctx.font = fh.getFont(12); ctx.fillStyle = COL.muted;
    ctx.fillText(`${truncateText(ctx, guildName || 'Server', 200)}`, iconX, PAD + 42);

    // Period badge (top-right)
    ctx.font = fh.getSemiBoldFont(11);
    const periodW = ctx.measureText(period || 'All Time').width + 16;
    const periodX = W - PAD - periodW;
    drawRoundedRect(ctx, periodX, PAD + 6, periodW, 24, 6);
    ctx.fillStyle = COL.accent + '30'; ctx.fill();
    ctx.strokeStyle = COL.accent + '60'; ctx.lineWidth = 1;
    drawRoundedRect(ctx, periodX, PAD + 6, periodW, 24, 6); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = fh.getSemiBoldFont(11); ctx.fillStyle = COL.accent;
    ctx.fillText(period || 'All Time', periodX + periodW / 2, PAD + 22);
    ctx.textAlign = 'left';

    // Updated timestamp
    const now = new Date();
    const timeStr = `Updated ${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')} UTC`;
    ctx.font = fh.getFont(10); ctx.fillStyle = COL.dim;
    ctx.textAlign = 'right';
    ctx.fillText(timeStr, W - PAD, PAD + 42);
    ctx.textAlign = 'left';

    // Divider
    ctx.strokeStyle = COL.cardBorder; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, HEADER_H - 8); ctx.lineTo(W - PAD, HEADER_H - 8); ctx.stroke();

    // ── Entries ──
    for (let i = 0; i < entryCount; i++) {
        const entry = entries[i];
        const y = HEADER_H + i * ROW_H;
        const style = getRankStyle(entry.rank);

        // Row background (special for top 3)
        if (style.bg) {
            drawRoundedRect(ctx, PAD - 4, y + 2, W - PAD * 2 + 8, ROW_H - 6, 10);
            ctx.fillStyle = style.bg; ctx.fill();
            ctx.strokeStyle = style.color + '30'; ctx.lineWidth = 1;
            drawRoundedRect(ctx, PAD - 4, y + 2, W - PAD * 2 + 8, ROW_H - 6, 10); ctx.stroke();
        } else {
            drawRoundedRect(ctx, PAD - 4, y + 2, W - PAD * 2 + 8, ROW_H - 6, 8);
            ctx.fillStyle = i % 2 === 0 ? COL.row1 : COL.row2; ctx.fill();
        }

        // Rank badge
        const badgeX = PAD + 6;
        const badgeY = y + (ROW_H - 32) / 2 - 2;
        drawRankBadge(ctx, fh, badgeX, badgeY, entry.rank);

        // Avatar
        const avSize = 36;
        const avX = PAD + 48, avY = y + (ROW_H - avSize) / 2 - 2;
        let avatarDrawn = false;
        if (entry.avatarURL) {
            try {
                const av = await imageCache.loadWithCache(entry.avatarURL, 3000);
                if (av) {
                    ctx.save();
                    ctx.beginPath(); ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2); ctx.clip();
                    ctx.drawImage(av, avX, avY, avSize, avSize);
                    ctx.restore();
                    avatarDrawn = true;
                }
            } catch {}
        }
        if (!avatarDrawn) {
            ctx.beginPath(); ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
            ctx.fillStyle = COL.cardBorder; ctx.fill();
            ctx.font = fh.getBoldFont(14); ctx.fillStyle = COL.muted; ctx.textAlign = 'center';
            ctx.fillText((entry.username || '?')[0].toUpperCase(), avX + avSize / 2, avY + avSize / 2 + 5);
            ctx.textAlign = 'left';
        }

        // Avatar ring for top 3
        if (style.trophy) {
            ctx.beginPath(); ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2 + 2, 0, Math.PI * 2);
            ctx.strokeStyle = style.color + '80'; ctx.lineWidth = 2; ctx.stroke();
        }

        // Username
        const nameX = avX + avSize + 14;
        ctx.font = fh.getSemiBoldFont(15); ctx.fillStyle = style.trophy ? style.color : COL.text;
        ctx.fillText(truncateText(ctx, entry.username || 'Unknown', W - nameX - 130), nameX, y + ROW_H / 2 - 2);

        // Subtitle (rank label for top 3)
        if (style.trophy) {
            ctx.font = fh.getFont(10); ctx.fillStyle = style.color + 'AA';
            const labels = { 1: 'CHAMPION', 2: 'RUNNER UP', 3: 'THIRD PLACE' };
            ctx.fillText(labels[entry.rank] || '', nameX, y + ROW_H / 2 + 12);
        }

        // Value (right-aligned)
        ctx.textAlign = 'right';
        ctx.font = fh.getBoldFont(16); ctx.fillStyle = style.trophy ? style.color : COL.text;
        ctx.fillText(formatNumber(entry.value), W - PAD - 8, y + ROW_H / 2 - 2);
        ctx.font = fh.getFont(10); ctx.fillStyle = COL.dim;
        ctx.fillText(entry.label || 'msgs', W - PAD - 8, y + ROW_H / 2 + 12);
        ctx.textAlign = 'left';
    }

    // ── Footer ──
    const footerY = HEADER_H + entryCount * ROW_H + 18;
    ctx.strokeStyle = COL.cardBorder; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, footerY - 8); ctx.lineTo(W - PAD, footerY - 8); ctx.stroke();

    ctx.font = fh.getFont(11); ctx.fillStyle = COL.dim;
    ctx.fillText('Auto-refreshes every minute', PAD, footerY + 6);
    ctx.textAlign = 'right';
    ctx.fillText('Powered by xNico', W - PAD, footerY + 6);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

module.exports = { createLeaderboardCard };
