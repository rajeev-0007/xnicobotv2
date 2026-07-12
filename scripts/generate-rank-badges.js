'use strict';

/**
 * generate-rank-badges.js — Ornate game-style rank badges (rank1.png … rank10.png).
 *
 * Style: pointed pennant/banner with a peaked top, a crystal gem at the top,
 * feathered metallic side wings, a downward pointed tip with a bottom gem,
 * a glossy dark inner face with a bold number, and a crown on #1.
 * Rendered at 256×256 with transparent background, then used (downscaled)
 * by the live leaderboard canvas.
 *
 * Run: node scripts/generate-rank-badges.js
 */

const { createCanvas } = require('@napi-rs/canvas');
const { registerAllFonts, getFontHelpers } = require('../utils/fontRegistry');
const fs = require('fs');
const path = require('path');

try { registerAllFonts(); } catch {}

const OUT_DIR = path.join(__dirname, '../assets/emojis');
const SIZE = 256;

/**
 * Per-rank palette.
 *   metalL/metalB/metalD — metallic frame gradient (light / base / dark)
 *   gem                  — crystal + number + inner glow color
 *   gemD                 — darker crystal edge
 *   crown                — draw a crown (rank 1)
 */
const PALETTE = {
    1:  { metalL: '#ffe9a0', metalB: '#e2b23a', metalD: '#8f6a15', gem: '#ffd24d', gemD: '#b8860b', crown: true },
    2:  { metalL: '#f2f5fa', metalB: '#c2cad6', metalD: '#7c8492', gem: '#e6ecf5', gemD: '#9aa4b2' },
    3:  { metalL: '#f0c79a', metalB: '#c98a4e', metalD: '#7d4e22', gem: '#f0a860', gemD: '#a86828' },
    4:  { metalL: '#d8b8ff', metalB: '#9a5cf0', metalD: '#5c2ea0', gem: '#c48aff', gemD: '#7c3ad0' },
    5:  { metalL: '#a8d0ff', metalB: '#4f8ff0', metalD: '#255aa8', gem: '#66aaff', gemD: '#2f6ad0' },
    6:  { metalL: '#a8f0ea', metalB: '#3cc4bb', metalD: '#1c827a', gem: '#4fe0d4', gemD: '#249b90' },
    7:  { metalL: '#c8f0a0', metalB: '#6fc23f', metalD: '#3d8018', gem: '#8fe04f', gemD: '#4f9b1f' },
    8:  { metalL: '#ffdca0', metalB: '#f0a03f', metalD: '#b06818', gem: '#ffb84d', gemD: '#c07818' },
    9:  { metalL: '#ffb0d8', metalB: '#f04f9b', metalD: '#a82863', gem: '#ff6fb0', gemD: '#c02f73' },
    10: { metalL: '#f0f4fa', metalB: '#c8d0dc', metalD: '#858d9a', gem: '#e0e6f0', gemD: '#a0a8b6' },
};

/* ── Geometry ─────────────────────────────────────────────── */

const CX = SIZE / 2;
const CY = 138;
const HW = 62;          // half width of the banner body
const TOP = 58;         // top edge y
const SHOULDER = 44;    // peak y (higher than top edge)
const TAPER_Y = 196;    // where sides start tapering to the tip
const TIP_Y = 236;      // bottom point y

/** Trace the main banner/pennant outline. */
function bannerPath(ctx, inset = 0) {
    const hw = HW - inset;
    const top = TOP + inset;
    const shoulder = SHOULDER + inset;
    const taper = TAPER_Y - inset * 0.5;
    const tip = TIP_Y - inset;
    const cx = CX;

    ctx.beginPath();
    ctx.moveTo(cx - hw, top + 6);                 // top-left corner
    ctx.lineTo(cx - hw * 0.5, shoulder);          // left peak
    ctx.lineTo(cx, top + 2);                      // center notch
    ctx.lineTo(cx + hw * 0.5, shoulder);          // right peak
    ctx.lineTo(cx + hw, top + 6);                 // top-right corner
    ctx.lineTo(cx + hw, taper);                   // right side down
    ctx.lineTo(cx, tip);                          // bottom tip
    ctx.lineTo(cx - hw, taper);                   // left side up
    ctx.closePath();
}

/** Draw feathered metallic wing barbs down one side. */
function drawFeathers(ctx, pal, side) {
    const dir = side === 'left' ? -1 : 1;
    const baseX = CX + dir * HW;
    const startY = TOP + 14;
    const endY = TAPER_Y - 6;
    const count = 5;
    const step = (endY - startY) / count;

    for (let i = 0; i < count; i++) {
        const y = startY + i * step;
        const len = 26 - i * 2.5;      // barbs shrink toward the bottom
        const tipX = baseX + dir * len;

        ctx.beginPath();
        ctx.moveTo(baseX, y);
        ctx.lineTo(tipX, y + step * 0.35);
        ctx.lineTo(baseX, y + step * 0.85);
        ctx.closePath();

        const g = ctx.createLinearGradient(baseX, y, tipX, y);
        g.addColorStop(0, pal.metalB);
        g.addColorStop(1, pal.metalD);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = pal.metalD;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

/** Draw a faceted diamond/crystal gem. */
function drawGem(ctx, cx, cy, w, h, pal) {
    // outer glow
    ctx.save();
    ctx.shadowColor = pal.gem;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(cx, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy);
    ctx.lineTo(cx, cy + h / 2);
    ctx.lineTo(cx - w / 2, cy);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx, cy - h / 2, cx, cy + h / 2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, pal.gem);
    g.addColorStop(1, pal.gemD);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();

    // facet highlight
    ctx.beginPath();
    ctx.moveTo(cx, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fill();
}

/** Small crown for the #1 badge. */
function drawCrown(ctx, cx, y, size, pal) {
    const hw = size / 2;
    ctx.save();
    ctx.shadowColor = pal.gem;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo(cx - hw, y);
    ctx.lineTo(cx - hw, y - size * 0.55);
    ctx.lineTo(cx - hw * 0.42, y - size * 0.12);
    ctx.lineTo(cx, y - size * 0.75);
    ctx.lineTo(cx + hw * 0.42, y - size * 0.12);
    ctx.lineTo(cx + hw, y - size * 0.55);
    ctx.lineTo(cx + hw, y);
    ctx.closePath();
    const g = ctx.createLinearGradient(cx, y - size * 0.75, cx, y);
    g.addColorStop(0, pal.metalL);
    g.addColorStop(1, pal.metalD);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = pal.metalD;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // crown jewels
    ctx.beginPath();
    ctx.arc(cx, y - size * 0.28, 3, 0, Math.PI * 2);
    ctx.fillStyle = pal.gem;
    ctx.fill();
}

/* ── Compose one badge ────────────────────────────────────── */

function drawBadge(rank) {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    const fh = getFontHelpers('Inter');
    const pal = PALETTE[rank];

    // 1) Side feathers (behind the frame)
    drawFeathers(ctx, pal, 'left');
    drawFeathers(ctx, pal, 'right');

    // 2) Drop shadow of the body
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 6;
    bannerPath(ctx, 0);
    ctx.fillStyle = pal.metalD;
    ctx.fill();
    ctx.restore();

    // 3) Metallic outer frame
    bannerPath(ctx, 0);
    const frame = ctx.createLinearGradient(CX, TOP - 10, CX, TIP_Y);
    frame.addColorStop(0, pal.metalL);
    frame.addColorStop(0.45, pal.metalB);
    frame.addColorStop(1, pal.metalD);
    ctx.fillStyle = frame;
    ctx.fill();

    // frame edge stroke
    ctx.strokeStyle = pal.metalD;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // 4) Dark glossy inner face
    bannerPath(ctx, 12);
    const faceGrad = ctx.createRadialGradient(CX, CY - 20, 10, CX, CY + 20, 130);
    faceGrad.addColorStop(0, mix(pal.gemD, '#0b0b10', 0.55));
    faceGrad.addColorStop(1, '#0a0a0e');
    ctx.fillStyle = faceGrad;
    ctx.fill();

    // inner rim highlight
    bannerPath(ctx, 12);
    ctx.strokeStyle = withAlpha(pal.gem, 0.35);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // top gloss on inner face
    ctx.save();
    bannerPath(ctx, 12);
    ctx.clip();
    const gloss = ctx.createLinearGradient(CX, TOP, CX, CY);
    gloss.addColorStop(0, 'rgba(255,255,255,0.16)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.fillRect(CX - HW, TOP, HW * 2, CY - TOP);
    ctx.restore();

    // 5) Top crystal gem + flanking chevrons
    drawGem(ctx, CX, TOP + 4, 20, 30, pal);
    drawGem(ctx, CX - 26, SHOULDER + 14, 9, 16, pal);
    drawGem(ctx, CX + 26, SHOULDER + 14, 9, 16, pal);

    // 6) Bottom tip gem
    drawGem(ctx, CX, TIP_Y - 14, 14, 22, pal);

    // 7) Crown for #1
    if (pal.crown) {
        drawCrown(ctx, CX, TOP - 8, 40, pal);
    }

    // 8) Number — centered in the flat body region (above the taper),
    //    using true glyph metrics so single- and double-digit sit identically.
    const label = String(rank);
    const isDouble = label.length > 1;
    const fontSize = isDouble ? 58 : 76;
    ctx.font = fh.getBoldFont(fontSize);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Vertical center of the usable face: between the top gem area and the taper.
    const faceTop = SHOULDER + 26;   // just below the top gems
    const faceBottom = TAPER_Y - 4;  // just above where the sides taper in
    const faceMid = (faceTop + faceBottom) / 2;

    // Measure real glyph box to center on the digit's actual ink, not the em box.
    const m = ctx.measureText(label);
    const ascent = m.actualBoundingBoxAscent || fontSize * 0.72;
    const descent = m.actualBoundingBoxDescent || fontSize * 0.02;
    const glyphH = ascent + descent;
    const baselineY = faceMid + glyphH / 2 - descent;

    // glow pass
    ctx.save();
    ctx.shadowColor = pal.gem;
    ctx.shadowBlur = 16;
    ctx.fillStyle = pal.gem;
    ctx.fillText(label, CX, baselineY);
    ctx.restore();

    // crisp white→color gradient on top
    const numGrad = ctx.createLinearGradient(CX, baselineY - ascent, CX, baselineY + descent);
    numGrad.addColorStop(0, '#ffffff');
    numGrad.addColorStop(1, pal.gem);
    ctx.fillStyle = numGrad;
    ctx.fillText(label, CX, baselineY);

    return canvas.toBuffer('image/png');
}

/* ── Color helpers ────────────────────────────────────────── */

function toRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 0, b: 0 };
}
function toHex({ r, g, b }) {
    const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}
function mix(a, b, t) {
    const A = toRgb(a), B = toRgb(b);
    return toHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}
function withAlpha(hex, a) {
    const { r, g, b } = toRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/* ── Main ─────────────────────────────────────────────────── */

function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    for (let rank = 1; rank <= 10; rank++) {
        const buf = drawBadge(rank);
        fs.writeFileSync(path.join(OUT_DIR, `rank${rank}.png`), buf);
        console.log(`  ✓ rank${rank}.png`);
    }
    console.log('\n✅ Generated 10 ornate rank badges → assets/emojis/');
}

main();
