'use strict';

/**
 * leaderboardCard.js — Canvas-rendered leaderboard image for the unified
 * `/leaderboard` command (leveling / messages / voice / invites / economy).
 *
 * Exports generateLeaderboardCard(entries, options).
 *
 *   entries: Array<{
 *     rank, name, avatar, isRequester,
 *     primaryValue?  (number)  OR  valueText? (preformatted string),
 *     primaryLabel?, statLine?
 *   }>
 *   options: {
 *     accentInt, accentEmoji, titleLabel,
 *     modeLabel, scopeLabel, scopeEmoji,
 *     totalCount, page, totalPages,
 *     requester: { rank, gapText } | null
 *   }
 */

const { createCanvas } = require('@napi-rs/canvas');
const { registerAllFonts, getFontHelpers } = require('./fontRegistry');
const { drawRoundedRect, truncateText, formatNumber } = require('./canvasDesign');
const imageCache = require('./imageCache');

try { registerAllFonts(); } catch {}

const RANK_BADGE_URLS = {
    1: 'https://cdn.discordapp.com/emojis/1522973015002976297.png',
    2: 'https://cdn.discordapp.com/emojis/1522973012385599519.png',
    3: 'https://cdn.discordapp.com/emojis/1522973009525080176.png',
    4: 'https://cdn.discordapp.com/emojis/1522973006874279936.png',
    5: 'https://cdn.discordapp.com/emojis/1522973004378935486.png',
    6: 'https://cdn.discordapp.com/emojis/1522973001849770044.png',
    7: 'https://cdn.discordapp.com/emojis/1522972998569689098.png',
};

const COL = {
    bg: '#0f1116', card: '#1a1d24', cardBorder: '#262a33',
    text: '#e6edf3', muted: '#8b949e', dim: '#484f58',
    gold: '#FFD700', silver: '#C0C0C0', bronze: '#CD7F32',
    accentDefault: '#5865f2',
    row1: '#1e2229', row2: '#181c22',
    rank1Bg: '#3d3015', rank2Bg: '#2d2d30', rank3Bg: '#2d2218',
};

const W = 640, PAD = 24, ROW_H = 58, HEADER_H = 96, FOOTER_H = 46;

function intToHex(n, fallback) {
    if (!Number.isFinite(n)) return fallback;
    return '#' + (n & 0xFFFFFF).toString(16).padStart(6, '0');
}

function rankStyle(rank) {
    if (rank === 1) return { color: COL.gold, bg: COL.rank1Bg, trophy: true, sub: 'CHAMPION' };
    if (rank === 2) return { color: COL.silver, bg: COL.rank2Bg, trophy: true, sub: 'RUNNER UP' };
    if (rank === 3) return { color: COL.bronze, bg: COL.rank3Bg, trophy: true, sub: 'THIRD PLACE' };
    return { color: COL.muted, bg: null, trophy: false, sub: null };
}

function formatValue(entry) {
    if (typeof entry.valueText === 'string' && entry.valueText.length) return entry.valueText;
    const v = Number(entry.primaryValue) || 0;
    const label = entry.primaryLabel ? ` ${entry.primaryLabel}` : '';
    return `${formatNumber(v)}${label}`;
}

async function generateLeaderboardCard(entries = [], options = {}) {
    const fh = getFontHelpers('Inter');
    const accent = intToHex(options.accentInt, COL.accentDefault);
    const rows = entries.slice(0, 10);
    const count = rows.length;
    const H = HEADER_H + Math.max(1, count) * ROW_H + FOOTER_H + PAD;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Background
    drawRoundedRect(ctx, 0, 0, W, H, 14);
    ctx.fillStyle = COL.bg; ctx.fill();

    // Accent top strip
    drawRoundedRect(ctx, 0, 0, W, 5, 0);
    ctx.fillStyle = accent; ctx.fillRect(0, 0, W, 5);

    // Preload rank badges
    ctx._badges = {};
    await Promise.all(Object.entries(RANK_BADGE_URLS).map(async ([r, url]) => {
        try { const img = await imageCache.loadWithCache(url, 3000); if (img) ctx._badges[Number(r)] = img; } catch {}
    }));

    // ── Header ──
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = fh.getBoldFont(23); ctx.fillStyle = COL.text;
    ctx.fillText(`${options.titleLabel || 'Leaderboard'}`, PAD, 40);

    ctx.font = fh.getFont(13); ctx.fillStyle = COL.muted;
    const scopeLine = `${truncateText(ctx, options.scopeLabel || 'Server', 260)} • ${options.modeLabel || 'Server'}`;
    ctx.fillText(scopeLine, PAD, 62);

    // Count + page badge (right)
    const badgeText = `${(options.totalCount || count).toLocaleString()} ranked`;
    ctx.font = fh.getSemiBoldFont(11);
    const bw = ctx.measureText(badgeText).width + 18;
    drawRoundedRect(ctx, W - PAD - bw, 26, bw, 22, 6);
    ctx.fillStyle = accent + '30'; ctx.fill();
    ctx.strokeStyle = accent + '60'; ctx.lineWidth = 1;
    drawRoundedRect(ctx, W - PAD - bw, 26, bw, 22, 6); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillStyle = accent;
    ctx.fillText(badgeText, W - PAD - bw / 2, 41);
    ctx.textAlign = 'right'; ctx.font = fh.getFont(11); ctx.fillStyle = COL.dim;
    ctx.fillText(`Page ${(options.page ?? 0) + 1}/${options.totalPages || 1}`, W - PAD, 62);
    ctx.textAlign = 'left';

    // Divider
    ctx.strokeStyle = COL.cardBorder; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, HEADER_H - 12); ctx.lineTo(W - PAD, HEADER_H - 12); ctx.stroke();

    // ── Empty ──
    if (count === 0) {
        ctx.font = fh.getFont(14); ctx.fillStyle = COL.muted; ctx.textAlign = 'center';
        ctx.fillText('No ranked users yet', W / 2, HEADER_H + 30);
        ctx.textAlign = 'left';
        return canvas.toBuffer('image/png');
    }

    // ── Rows ──
    for (let i = 0; i < count; i++) {
        const entry = rows[i];
        const y = HEADER_H + i * ROW_H;
        const st = rankStyle(entry.rank);

        if (st.bg) {
            drawRoundedRect(ctx, PAD - 4, y, W - PAD * 2 + 8, ROW_H - 6, 10);
            ctx.fillStyle = st.bg; ctx.fill();
            ctx.strokeStyle = st.color + '30'; ctx.lineWidth = 1;
            drawRoundedRect(ctx, PAD - 4, y, W - PAD * 2 + 8, ROW_H - 6, 10); ctx.stroke();
        } else {
            drawRoundedRect(ctx, PAD - 4, y, W - PAD * 2 + 8, ROW_H - 6, 8);
            ctx.fillStyle = i % 2 === 0 ? COL.row1 : COL.row2; ctx.fill();
        }
        if (entry.isRequester) {
            ctx.strokeStyle = accent; ctx.lineWidth = 2;
            drawRoundedRect(ctx, PAD - 4, y, W - PAD * 2 + 8, ROW_H - 6, 8); ctx.stroke();
        }

        // Rank badge
        const badgeSize = 30, bx = PAD + 6, by = y + (ROW_H - 6 - badgeSize) / 2;
        if (entry.rank <= 7 && ctx._badges[entry.rank]) {
            ctx.drawImage(ctx._badges[entry.rank], bx, by, badgeSize, badgeSize);
        } else {
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = fh.getBoldFont(14); ctx.fillStyle = st.color;
            ctx.fillText(`#${entry.rank}`, bx + badgeSize / 2, y + (ROW_H - 6) / 2);
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        }

        // Avatar
        const avSize = 34, avX = PAD + 44, avY = y + (ROW_H - 6 - avSize) / 2;
        let drawn = false;
        if (entry.avatar) {
            try {
                const img = await imageCache.loadWithCache(entry.avatar, 3000);
                if (img) {
                    ctx.save();
                    ctx.beginPath(); ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2); ctx.clip();
                    ctx.drawImage(img, avX, avY, avSize, avSize);
                    ctx.restore();
                    drawn = true;
                }
            } catch {}
        }
        if (!drawn) {
            ctx.beginPath(); ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2, 0, Math.PI * 2);
            ctx.fillStyle = COL.cardBorder; ctx.fill();
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = fh.getBoldFont(14); ctx.fillStyle = COL.muted;
            ctx.fillText((entry.name || '?')[0].toUpperCase(), avX + avSize / 2, avY + avSize / 2 + 1);
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        }
        if (st.trophy) {
            ctx.beginPath(); ctx.arc(avX + avSize / 2, avY + avSize / 2, avSize / 2 + 2, 0, Math.PI * 2);
            ctx.strokeStyle = st.color + '90'; ctx.lineWidth = 2; ctx.stroke();
        }

        // Name + statline
        const nameX = avX + avSize + 14;
        const rowMid = y + (ROW_H - 6) / 2;
        ctx.font = fh.getSemiBoldFont(15); ctx.fillStyle = st.trophy ? st.color : COL.text;
        const youTag = entry.isRequester ? '  (you)' : '';
        ctx.fillText(truncateText(ctx, (entry.name || 'Unknown') + youTag, W - nameX - 150), nameX, rowMid - 2);
        if (entry.statLine || st.sub) {
            ctx.font = fh.getFont(10); ctx.fillStyle = st.trophy ? st.color + 'AA' : COL.dim;
            ctx.fillText(st.sub || entry.statLine, nameX, rowMid + 12);
        }

        // Value (right)
        ctx.textAlign = 'right';
        ctx.font = fh.getBoldFont(15); ctx.fillStyle = st.trophy ? st.color : COL.text;
        ctx.fillText(formatValue(entry), W - PAD - 8, rowMid + 4);
        ctx.textAlign = 'left';
    }

    // ── Footer ──
    const footerY = HEADER_H + count * ROW_H + 16;
    ctx.strokeStyle = COL.cardBorder; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD, footerY - 8); ctx.lineTo(W - PAD, footerY - 8); ctx.stroke();

    ctx.font = fh.getFont(11); ctx.fillStyle = COL.dim;
    if (options.requester && options.requester.rank) {
        const g = options.requester.gapText ? ` • ${options.requester.gapText}` : '';
        ctx.fillText(`Your rank: #${options.requester.rank}${g}`, PAD, footerY + 6);
    } else {
        ctx.fillText('xNico • Live rankings', PAD, footerY + 6);
    }
    ctx.textAlign = 'right';
    ctx.fillText('Powered by xNico', W - PAD, footerY + 6);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

module.exports = { generateLeaderboardCard };
