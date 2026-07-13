'use strict';

/**
 * generate-rarity-badges.js — Crystal-gem rarity badges for the 6 tiers
 * (common … mythic). Style: a faceted central crystal flanked by angular
 * shard "wings", with a small accent gem below — matching the reference art.
 *
 * Output: assets/emojis/rarity_<tier>.png (256×256, transparent bg).
 * Used (downscaled) by the anime + economy canvas cards.
 *
 * Run: node scripts/generate-rarity-badges.js
 */

const { createCanvas } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '../assets/emojis');
const SIZE = 256;

// Per-tier crystal palette [light, base, dark] — matches anime RARITIES colors.
const TIERS = {
    common:    { light: '#eef1f5', base: '#b4bcc6', dark: '#767e88' },
    uncommon:  { light: '#8ff0ad', base: '#2ecc71', dark: '#1b8f4d' },
    rare:      { light: '#86c8f5', base: '#3498db', dark: '#1f6699' },
    epic:      { light: '#cf9cf0', base: '#9b59b6', dark: '#6b3585' },
    legendary: { light: '#ffe488', base: '#f1c40f', dark: '#b8900a' },
    mythic:    { light: '#ff9385', base: '#e74c3c', dark: '#a0271b' },
};

const CX = SIZE / 2;
const CY = 122;
const GW = 62;   // crystal half-width
const GH = 118;  // crystal height

/** Slim crystal blade between a base point and a tip point. */
function drawBlade(ctx, bx, by, tx, ty, halfW, light, dark) {
    const dx = tx - bx, dy = ty - by;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const mx = (bx + tx) / 2, my = (by + ty) / 2;

    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(mx + nx * halfW, my + ny * halfW);
    ctx.lineTo(tx, ty);
    ctx.lineTo(mx - nx * halfW, my - ny * halfW);
    ctx.closePath();

    const g = ctx.createLinearGradient(bx, by, tx, ty);
    g.addColorStop(0, dark);
    g.addColorStop(1, light);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = dark;
    ctx.lineWidth = 1;
    ctx.stroke();
}

/** Central faceted crystal (kite/diamond, widest above center). */
function drawCrystal(ctx, pal) {
    const top = CY - GH / 2;
    const shoulderY = CY - GH * 0.10;
    const bot = CY + GH / 2;
    const left = CX - GW, right = CX + GW;

    // Outline
    const outline = () => {
        ctx.beginPath();
        ctx.moveTo(CX, top);
        ctx.lineTo(right, shoulderY);
        ctx.lineTo(CX, bot);
        ctx.lineTo(left, shoulderY);
        ctx.closePath();
    };

    // Base fill
    outline();
    const g = ctx.createLinearGradient(CX, top, CX, bot);
    g.addColorStop(0, pal.light);
    g.addColorStop(0.5, pal.base);
    g.addColorStop(1, pal.dark);
    ctx.fillStyle = g;
    ctx.fill();

    // Facets — left half lighter, right half darker for a cut-gem look
    ctx.save();
    outline();
    ctx.clip();

    // right half darker
    ctx.beginPath();
    ctx.moveTo(CX, top);
    ctx.lineTo(right, shoulderY);
    ctx.lineTo(CX, bot);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fill();

    // top table facet (bright)
    ctx.beginPath();
    ctx.moveTo(CX, top);
    ctx.lineTo(CX - GW * 0.42, shoulderY);
    ctx.lineTo(CX, CY - GH * 0.02);
    ctx.lineTo(CX + GW * 0.42, shoulderY);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fill();

    // center vertical seam
    ctx.beginPath();
    ctx.moveTo(CX, top);
    ctx.lineTo(CX, bot);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Edge stroke + glow
    ctx.save();
    ctx.shadowColor = pal.base;
    ctx.shadowBlur = 18;
    outline();
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
}

function drawBadge(tier) {
    const canvas = createCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    const pal = TIERS[tier];

    // Ambient glow behind
    const glow = ctx.createRadialGradient(CX, CY, 10, CX, CY, 120);
    glow.addColorStop(0, hexA(pal.base, 0.28));
    glow.addColorStop(1, hexA(pal.base, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Side shard "wings" (behind crystal) — two bold blades per side, fanning
    // up and out from behind the crystal for a clean crest silhouette.
    for (const dir of [-1, 1]) {
        const originX = CX + dir * 22;
        // tall outer blade
        drawBlade(ctx, originX, CY + 24, CX + dir * 96, CY - 58, 12, pal.light, pal.dark);
        // shorter inner blade
        drawBlade(ctx, originX, CY + 10, CX + dir * 58, CY - 80, 9, pal.light, pal.dark);
    }

    // Central crystal (prominent centerpiece)
    drawCrystal(ctx, pal);

    // Accent gem below the tip
    const gy = CY + GH / 2 + 24;
    drawBlade(ctx, CX, gy - 13, CX, gy + 13, 9, pal.light, pal.dark);

    return canvas.toBuffer('image/png');
}

function hexA(hex, a) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return `rgba(0,0,0,${a})`;
    return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

function main() {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const tier of Object.keys(TIERS)) {
        fs.writeFileSync(path.join(OUT_DIR, `rarity_${tier}.png`), drawBadge(tier));
        console.log(`  ✓ rarity_${tier}.png`);
    }
    console.log('\n✅ Generated 6 rarity crystal badges → assets/emojis/');
}

main();
