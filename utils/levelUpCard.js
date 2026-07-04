'use strict';

/**
 * levelUpCard.js — minimal 900×260 level-up announcement card.
 *
 * Professional, restrained redesign:
 *   • flat vertical gradient + one quiet accent glow behind the avatar
 *   • a slim left accent stripe instead of a noisy bottom band
 *   • clean avatar ring, letter-spaced "LEVEL UP" eyebrow with a dot
 *   • the new level rendered as one large gradient numeral on the right,
 *     with a subtle "from N" beneath it (no boxy badge, no fake bar)
 *
 * Layout
 * ──────
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │▏ ⬭        • LEVEL UP                                  LEVEL      │
 *   │▏avatar    Username                                       13      │
 *   │▏(108)     Advanced to Level 13                        from 12    │
 *   │▏          Rank #5    ·    Total XP 562.3K    ·    +120          │
 *   └────────────────────────────────────────────────────────────────┘
 */

const { createCanvas } = require('@napi-rs/canvas');
const imageCache = require('./imageCache');
const { registerAllFonts, getFontHelpers } = require('./fontRegistry');
const {
    DESIGN, drawRoundedRect, formatNumber, rgba, drawNicoBranding,
} = require('./canvasDesign');
const { drawTextWithEmoji, measureMixedText, normalizeCanvasText } = require('./emojiCanvasHelper');

try { registerAllFonts(); } catch {}

const W = 900;
const H = 260;
const RAD = 20;

// Selectable level-up card styles. Each is a clean, minimal palette
// (background gradient + two accents) — the layout stays identical so
// every style stays professional and legible. Admins pick one via
// /leveling-setup → Card Style.
const LEVELUP_STYLES = {
    default:  { label: 'Default',  accent: '#5865f2', accent2: '#a855f7', bgTop: '#26272b', bgBottom: '#1c1d21' },
    midnight: { label: 'Midnight', accent: '#3b82f6', accent2: '#6366f1', bgTop: '#1a1d2b', bgBottom: '#12131c' },
    emerald:  { label: 'Emerald',  accent: '#10b981', accent2: '#34d399', bgTop: '#16241f', bgBottom: '#0f1814' },
    crimson:  { label: 'Crimson',  accent: '#ef4444', accent2: '#f87171', bgTop: '#261a1c', bgBottom: '#1a1113' },
    gold:     { label: 'Gold',     accent: '#f59e0b', accent2: '#fbbf24', bgTop: '#2a2419', bgBottom: '#1c180f' },
    aqua:     { label: 'Aqua',     accent: '#06b6d4', accent2: '#22d3ee', bgTop: '#16242a', bgBottom: '#0f1a1e' },
    mono:     { label: 'Mono',     accent: '#e5e7eb', accent2: '#9ca3af', bgTop: '#1f2023', bgBottom: '#161719' },
};
const LEVELUP_STYLE_KEYS = Object.keys(LEVELUP_STYLES);

function resolveStyle(name) {
    return LEVELUP_STYLES[String(name || '').toLowerCase()] || LEVELUP_STYLES.default;
}

function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString();
}

/* Letter-spaced text (canvas has no tracking) — draws each glyph with a
   fixed gap. Uses the current font/fillStyle and textAlign 'left'. */
function measureTracked(ctx, text, spacing) {
    let w = 0;
    for (const ch of String(text)) w += ctx.measureText(ch).width + spacing;
    return Math.max(0, w - spacing);
}

function drawTracked(ctx, text, x, y, spacing) {
    const prevAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    let cx = x;
    for (const ch of String(text)) {
        ctx.fillText(ch, cx, y);
        cx += ctx.measureText(ch).width + spacing;
    }
    ctx.textAlign = prevAlign;
    return cx - x - spacing;
}

async function generateLevelUpCard(user, data = {}) {
    try {
        return await _renderCard(user, data);
    } catch {
        return _fallbackCard(user, data);
    }
}

function _fallbackCard(user, data) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1e1f22';
    drawRoundedRect(ctx, 0, 0, W, H, RAD);
    ctx.fill();
    const fh = getFontHelpers(data.fontFamily || 'Inter');
    ctx.font = fh.getBoldFont(28);
    ctx.fillStyle = '#5865f2';
    ctx.fillText('LEVEL UP', 40, H / 2 - 8);
    ctx.font = fh.getFont(16);
    ctx.fillStyle = '#b5bac1';
    const name = normalizeCanvasText(user.globalName || user.username || 'User');
    ctx.fillText(`${name} reached Level ${data.newLevel || '?'}`, 40, H / 2 + 22);
    return canvas.toBuffer('image/png');
}

async function _renderCard(user, data = {}) {
    const fh = getFontHelpers(data.fontFamily || 'Inter');
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const oldLevel = Number(data.oldLevel) || 0;
    const newLevel = Number(data.newLevel) || 1;
    const totalXp  = Number(data.totalXp)  || 0;
    const rank     = Number(data.rank)     || 0;
    const xpGain   = Number(data.xpGain)   || 0;

    const accent = resolveStyle(data.style).accent;
    const accent2 = resolveStyle(data.style).accent2;
    const _style = resolveStyle(data.style);

    const PAD = 44;

    /* ── 1. Background (single flat gradient + optional user image) ── */
    ctx.save();
    drawRoundedRect(ctx, 0, 0, W, H, RAD);
    ctx.clip();
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, _style.bgTop);
    bg.addColorStop(1, _style.bgBottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Optional custom background image (the only thing the user can
    // customize on the level-up card). Drawn as a cover image with a
    // single readability scrim so the text stays legible.
    if (data.backgroundImage) {
        try {
            const img = await imageCache.loadWithCache(data.backgroundImage, 5000);
            if (img) {
                const scale = Math.max(W / img.width, H / img.height);
                const ix = (W - img.width * scale) / 2;
                const iy = (H - img.height * scale) / 2;
                ctx.drawImage(img, ix, iy, img.width * scale, img.height * scale);
                const scrim = ctx.createLinearGradient(0, 0, W, 0);
                scrim.addColorStop(0, 'rgba(16,16,22,0.86)');
                scrim.addColorStop(0.55, 'rgba(16,16,22,0.64)');
                scrim.addColorStop(1, 'rgba(16,16,22,0.80)');
                ctx.fillStyle = scrim;
                ctx.fillRect(0, 0, W, H);
            }
        } catch {}
    } else {
        // One quiet accent glow behind the avatar — the only ambient light.
        const glow = ctx.createRadialGradient(150, H / 2, 0, 150, H / 2, 320);
        glow.addColorStop(0, rgba(accent, 0.16));
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
    }

    // Slim left accent stripe (rounded by the card clip).
    const stripe = ctx.createLinearGradient(0, 0, 0, H);
    stripe.addColorStop(0, accent2);
    stripe.addColorStop(1, accent);
    ctx.fillStyle = stripe;
    ctx.fillRect(0, 0, 5, H);
    ctx.restore();

    /* ── 2. Avatar (single clean ring) ── */
    const avSize = 108;
    const avX = PAD + 6;
    const cy = H / 2;
    const avY = cy - avSize / 2;
    const cx = avX + avSize / 2;

    // Soft drop shadow for separation.
    ctx.fillStyle = rgba('#000000', 0.28);
    ctx.beginPath();
    ctx.arc(cx, cy + 2, avSize / 2 + 5, 0, Math.PI * 2);
    ctx.fill();

    try {
        const avatar = await imageCache.loadWithCache(
            user.displayAvatarURL({ extension: 'png', size: 256 }), 5000
        );
        if (avatar) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, avSize / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(avatar, avX, avY, avSize, avSize);
            ctx.restore();
        } else {
            ctx.fillStyle = rgba(accent, 0.3);
            ctx.beginPath();
            ctx.arc(cx, cy, avSize / 2, 0, Math.PI * 2);
            ctx.fill();
        }
    } catch {}

    // Thin dark gap + accent ring (two hairlines read cleaner than one thick one).
    ctx.strokeStyle = _style.bgBottom;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cx, cy, avSize / 2 + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, avSize / 2 + 6, 0, Math.PI * 2);
    ctx.stroke();

    /* ── 3. Big level numeral (right) ── */
    const colRight = W - PAD;

    // "LEVEL" label, letter-spaced, right-aligned above the number.
    ctx.font = fh.getSemiBoldFont(13);
    ctx.fillStyle = DESIGN.colors.textMuted;
    const lblW = measureTracked(ctx, 'LEVEL', 3);
    drawTracked(ctx, 'LEVEL', colRight - lblW, 84, 3);

    // The level number itself — one large gradient numeral.
    const numStr = String(newLevel);
    ctx.font = fh.getBoldFont(82);
    const numW = ctx.measureText(numStr).width;
    const numBaseline = 168;
    const numGrad = ctx.createLinearGradient(0, numBaseline - 70, 0, numBaseline);
    numGrad.addColorStop(0, accent2);
    numGrad.addColorStop(1, accent);
    ctx.fillStyle = numGrad;
    ctx.textAlign = 'left';
    ctx.fillText(numStr, colRight - numW, numBaseline);

    // "from {old}" beneath, right-aligned and muted.
    if (newLevel > oldLevel) {
        ctx.font = fh.getMediumFont(14);
        ctx.fillStyle = DESIGN.colors.textDim;
        ctx.textAlign = 'right';
        ctx.fillText(`from ${oldLevel}`, colRight, numBaseline + 26);
        ctx.textAlign = 'left';
    }

    const numLeft = colRight - Math.max(numW, lblW) - 36;

    /* ── 4. Text block (between avatar and number) ── */
    const tx = avX + avSize + 30;
    const tw = numLeft - tx;

    // Eyebrow: accent dot + letter-spaced "LEVEL UP".
    const eyeY = 80;
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(tx + 3, eyeY - 4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = fh.getBoldFont(12);
    ctx.fillStyle = accent2;
    drawTracked(ctx, 'LEVEL UP', tx + 14, eyeY, 2);

    // Username (fitted, emoji-aware).
    let username = String(user.globalName || user.username);
    ctx.font = fh.getBoldFont(32);
    while (measureMixedText(ctx, username, 32) > tw && username.length > 1) {
        username = username.slice(0, -1);
    }
    if (username !== String(user.globalName || user.username)) username += '…';
    ctx.fillStyle = '#ffffff';
    await drawTextWithEmoji(ctx, username, tx, 122, 32);

    // Subtitle: admin custom line, or the default "Advanced to Level N".
    if (data.customLine) {
        let line = String(data.customLine);
        ctx.font = fh.getMediumFont ? fh.getMediumFont(15) : fh.getFont(15);
        while (measureMixedText(ctx, line, 15) > tw && line.length > 1) {
            line = line.slice(0, -1);
        }
        if (line !== String(data.customLine)) line += '…';
        ctx.fillStyle = DESIGN.colors.textMuted;
        await drawTextWithEmoji(ctx, line, tx, 152, 15);
    } else {
        ctx.font = fh.getMediumFont ? fh.getMediumFont(15) : fh.getFont(15);
        ctx.fillStyle = DESIGN.colors.textMuted;
        ctx.fillText('Advanced to ', tx, 152);
        const advW = ctx.measureText('Advanced to ').width;
        ctx.font = fh.getBoldFont(15);
        ctx.fillStyle = accent;
        ctx.fillText(`Level ${newLevel}`, tx + advW, 152);
    }

    /* ── 5. Stats row (single baseline, dotted separators) ── */
    const statY = 198;
    const stats = [];
    if (rank > 0) stats.push({ label: 'Rank', value: `#${formatNumber(rank)}` });
    stats.push({ label: 'Total XP', value: fmtNum(totalXp) });
    if (xpGain > 0) stats.push({ label: 'Gained', value: `+${fmtNum(xpGain)}` });

    let sx = tx;
    ctx.textAlign = 'left';
    for (let i = 0; i < stats.length; i++) {
        const part = stats[i];
        ctx.font = fh.getMediumFont(13);
        ctx.fillStyle = DESIGN.colors.textMuted;
        ctx.fillText(part.label, sx, statY);
        const lw = ctx.measureText(part.label).width;
        ctx.font = fh.getSemiBoldFont(13);
        ctx.fillStyle = '#ffffff';
        const vx = sx + lw + 8;
        ctx.fillText(part.value, vx, statY);
        const vw = ctx.measureText(part.value).width;
        sx = vx + vw + 22;
        if (i < stats.length - 1) {
            ctx.fillStyle = DESIGN.colors.textDim;
            ctx.fillText('·', sx - 13, statY);
        }
    }

    /* ── 6. Border + branding ── */
    ctx.strokeStyle = rgba(accent, 0.16);
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, 0.75, 0.75, W - 1.5, H - 1.5, RAD);
    ctx.stroke();

    await drawNicoBranding(ctx, W, H, accent);

    return canvas.toBuffer('image/png');
}

module.exports = { generateLevelUpCard, LEVELUP_STYLES, LEVELUP_STYLE_KEYS };
