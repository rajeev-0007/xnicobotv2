'use strict';

/**
 * liveLeaderboardCard.js — Canvas-rendered LIVE (auto-refreshing) leaderboard.
 * Minimal dark theme with shield-style rank badge emojis, avatars, and stats.
 *
 * Exports createLeaderboardCard() — used by the `liveleaderboard` command.
 * (Separate from leaderboardCard.js which powers the unified `/leaderboard`.)
 */

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { registerAllFonts, getFontHelpers } = require('./fontRegistry');
const { drawRoundedRect, truncateText, formatNumber } = require('./canvasDesign');
const imageCache = require('./imageCache');
const { RANK_BADGE_URLS, RANK_BADGE_FILES } = require('./rankEmojis');
const fs = require('fs');

try { registerAllFonts(); } catch {}

const COL = {
    bg: '#101014',
    surface: '#18181c',
    border: '#252529',
    text: '#ececf0',
    sub: '#a0a0a8',
    dim: '#5c5c64',
    accent: '#5865f2',
};

const W = 560, PAD = 20, ROW_H = 54, HEADER_H = 72, FOOTER_H = 32;
const BADGE_SIZE = 34;

/**
 * Load a rank badge image. Tries local file first, then CDN.
 */
async function loadBadge(rank) {
    // Try local file
    const localPath = RANK_BADGE_FILES[rank];
    if (localPath && fs.existsSync(localPath)) {
        try {
            return await loadImage(localPath);
        } catch {}
    }
    // Fallback to CDN
    const url = RANK_BADGE_URLS[rank];
    if (url) {
        try {
            return await imageCache.loadWithCache(url, 4000);
        } catch {}
    }
    return null;
}

/**
 * @param {object} opts
 * @param {string} opts.guildName
 * @param {string|null} opts.guildIconURL
 * @param {string} opts.period - 'Daily' | 'Weekly' | 'Monthly' | 'All Time'
 * @param {Array<{rank, username, avatarURL, value, label}>} opts.entries
 */
async function createLeaderboardCard({ guildName, guildIconURL, period, entries }) {
    const fh = getFontHelpers('Inter');
    const entryCount = Math.min(entries.length, 20);
    const H = HEADER_H + (entryCount * ROW_H) + FOOTER_H + PAD;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Preload badge images (1–10, higher ranks use fallback text)
    const badges = {};
    const badgeLoads = [];
    for (let i = 1; i <= Math.min(entryCount, 10); i++) {
        badgeLoads.push(
            loadBadge(i).then(img => { if (img) badges[i] = img; })
        );
    }
    await Promise.all(badgeLoads);

    // ── Background ──
    drawRoundedRect(ctx, 0, 0, W, H, 12);
    ctx.fillStyle = COL.bg;
    ctx.fill();

    // ── Header ──
    let headerX = PAD;

    if (guildIconURL) {
        try {
            const icon = await imageCache.loadWithCache(guildIconURL, 4000);
            if (icon) {
                const iconSize = 36;
                ctx.save();
                ctx.beginPath();
                ctx.arc(headerX + iconSize / 2, PAD + iconSize / 2, iconSize / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(icon, headerX, PAD, iconSize, iconSize);
                ctx.restore();
                headerX += iconSize + 12;
            }
        } catch {}
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = fh.getBoldFont(18);
    ctx.fillStyle = COL.text;
    ctx.fillText('Live Leaderboard', headerX, PAD + 16);

    ctx.font = fh.getFont(11);
    ctx.fillStyle = COL.dim;
    ctx.fillText(truncateText(ctx, guildName || 'Server', 220), headerX, PAD + 32);

    // Period pill (top-right)
    const periodText = period || 'Daily';
    ctx.font = fh.getSemiBoldFont(10);
    const pw = ctx.measureText(periodText).width + 14;
    const px = W - PAD - pw;
    const py = PAD + 4;
    drawRoundedRect(ctx, px, py, pw, 20, 4);
    ctx.fillStyle = COL.surface;
    ctx.fill();
    ctx.strokeStyle = COL.border;
    ctx.lineWidth = 1;
    drawRoundedRect(ctx, px, py, pw, 20, 4);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = COL.sub;
    ctx.font = fh.getSemiBoldFont(10);
    ctx.fillText(periodText, px + pw / 2, py + 14);
    ctx.textAlign = 'left';

    // Timestamp
    const now = new Date();
    const ts = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')} UTC`;
    ctx.font = fh.getFont(9);
    ctx.fillStyle = COL.dim;
    ctx.textAlign = 'right';
    ctx.fillText(ts, W - PAD, PAD + 36);
    ctx.textAlign = 'left';

    // Header divider
    ctx.strokeStyle = COL.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, HEADER_H - 6);
    ctx.lineTo(W - PAD, HEADER_H - 6);
    ctx.stroke();

    // ── Entries ──
    for (let i = 0; i < entryCount; i++) {
        const entry = entries[i];
        const y = HEADER_H + i * ROW_H;

        // Alternating row bg
        if (i % 2 === 0) {
            drawRoundedRect(ctx, PAD - 4, y + 2, W - PAD * 2 + 8, ROW_H - 4, 6);
            ctx.fillStyle = COL.surface;
            ctx.fill();
        }

        // ── Rank badge (image or fallback text) ──
        const badgeX = PAD + 4;
        const badgeY = y + (ROW_H - BADGE_SIZE) / 2;

        if (badges[entry.rank]) {
            // Draw the badge emoji image
            ctx.drawImage(badges[entry.rank], badgeX, badgeY, BADGE_SIZE, BADGE_SIZE);
        } else {
            // Fallback: plain rank number for ranks > 10 or missing images
            ctx.font = fh.getBoldFont(13);
            ctx.fillStyle = COL.dim;
            ctx.textAlign = 'center';
            ctx.fillText(`#${entry.rank}`, badgeX + BADGE_SIZE / 2, y + ROW_H / 2 + 5);
            ctx.textAlign = 'left';
        }

        // ── Avatar ──
        const avSize = 32;
        const avX = PAD + BADGE_SIZE + 16;
        const avY = y + (ROW_H - avSize) / 2;
        let avatarDrawn = false;

        if (entry.avatarURL) {
            try {
                const av = await imageCache.loadWithCache(entry.avatarURL, 3000);
                if (av) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
                    ctx.clip();
                    ctx.drawImage(av, avX, avY, avSize, avSize);
                    ctx.restore();
                    avatarDrawn = true;
                }
            } catch {}
        }
        if (!avatarDrawn) {
            ctx.beginPath();
            ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
            ctx.fillStyle = COL.border;
            ctx.fill();
            ctx.font = fh.getBoldFont(13);
            ctx.fillStyle = COL.dim;
            ctx.textAlign = 'center';
            ctx.fillText((entry.username || '?')[0].toUpperCase(), avX + avSize / 2, avY + avSize / 2 + 5);
            ctx.textAlign = 'left';
        }

        // ── Username ──
        const nameX = avX + avSize + 12;
        ctx.font = fh.getSemiBoldFont(13);
        ctx.fillStyle = COL.text;
        ctx.fillText(truncateText(ctx, entry.username || 'Unknown', W - nameX - 90), nameX, y + ROW_H / 2 + 4);

        // ── Value (right-aligned) ──
        ctx.textAlign = 'right';
        ctx.font = fh.getBoldFont(14);
        ctx.fillStyle = COL.text;
        ctx.fillText(formatNumber(entry.value), W - PAD - 6, y + ROW_H / 2 - 1);
        ctx.font = fh.getFont(9);
        ctx.fillStyle = COL.dim;
        ctx.fillText(entry.label || 'msgs', W - PAD - 6, y + ROW_H / 2 + 12);
        ctx.textAlign = 'left';
    }

    // ── Footer ──
    const footerY = HEADER_H + entryCount * ROW_H + 10;
    ctx.strokeStyle = COL.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, footerY);
    ctx.lineTo(W - PAD, footerY);
    ctx.stroke();

    ctx.font = fh.getFont(9);
    ctx.fillStyle = COL.dim;
    ctx.fillText('Refreshes every 60s', PAD, footerY + 16);
    ctx.textAlign = 'right';
    ctx.fillText('xNico', W - PAD, footerY + 16);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

module.exports = { createLeaderboardCard };
