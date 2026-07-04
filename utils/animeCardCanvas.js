'use strict';

/**
 * animeCardCanvas.js — Renders anime gacha cards as images.
 * A single character card shows the character portrait, a rarity-colored
 * frame, name, anime, and a rarity gem. Also renders a multi-roll grid.
 */

const { createCanvas } = require('@napi-rs/canvas');
const { registerAllFonts, getFontHelpers } = require('./fontRegistry');
const { drawRoundedRect, truncateText } = require('./canvasDesign');
const imageCache = require('./imageCache');

try { registerAllFonts(); } catch {}

const RARITY_COL = {
    common:    { c: '#95A5A6', name: 'COMMON' },
    uncommon:  { c: '#2ECC71', name: 'UNCOMMON' },
    rare:      { c: '#3498DB', name: 'RARE' },
    epic:      { c: '#9B59B6', name: 'EPIC' },
    legendary: { c: '#F1C40F', name: 'LEGENDARY' },
    mythic:    { c: '#E74C3C', name: 'MYTHIC' },
};

function rc(rarity) { return RARITY_COL[rarity] || RARITY_COL.common; }

/**
 * Single character card. 340×480 portrait card.
 */
async function renderCard(character, { isDuplicate = false, isNew = false } = {}) {
    const fh = getFontHelpers('Inter');
    const W = 340, H = 480;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rar = rc(character.rarity);

    // Background
    ctx.fillStyle = '#0f1116';
    ctx.fillRect(0, 0, W, H);

    // Portrait area
    const imgX = 16, imgY = 16, imgW = W - 32, imgH = 340;
    let drew = false;
    if (character.image) {
        try {
            const img = await imageCache.loadWithCache(character.image, 6000);
            if (img) {
                ctx.save();
                drawRoundedRect(ctx, imgX, imgY, imgW, imgH, 12);
                ctx.clip();
                // cover-fit
                const scale = Math.max(imgW / img.width, imgH / img.height);
                const dw = img.width * scale, dh = img.height * scale;
                ctx.drawImage(img, imgX + (imgW - dw) / 2, imgY + (imgH - dh) / 2, dw, dh);
                ctx.restore();
                drew = true;
            }
        } catch {}
    }
    if (!drew) {
        drawRoundedRect(ctx, imgX, imgY, imgW, imgH, 12);
        ctx.fillStyle = '#1a1d24'; ctx.fill();
        ctx.fillStyle = rar.c; ctx.font = fh.getBoldFont(40); ctx.textAlign = 'center';
        ctx.fillText('?', W / 2, imgY + imgH / 2);
        ctx.textAlign = 'left';
    }

    // Gradient fade at bottom of portrait for text legibility
    const grad = ctx.createLinearGradient(0, imgY + imgH - 80, 0, imgY + imgH);
    grad.addColorStop(0, 'rgba(15,17,22,0)');
    grad.addColorStop(1, 'rgba(15,17,22,0.9)');
    ctx.save(); drawRoundedRect(ctx, imgX, imgY, imgW, imgH, 12); ctx.clip();
    ctx.fillStyle = grad; ctx.fillRect(imgX, imgY + imgH - 80, imgW, 80); ctx.restore();

    // Rarity frame
    ctx.strokeStyle = rar.c; ctx.lineWidth = 3;
    drawRoundedRect(ctx, imgX, imgY, imgW, imgH, 12); ctx.stroke();

    // Rarity badge (top-left over image)
    ctx.font = fh.getBoldFont(12);
    const rw = ctx.measureText(rar.name).width + 20;
    drawRoundedRect(ctx, imgX + 8, imgY + 8, rw, 24, 6);
    ctx.fillStyle = rar.c; ctx.fill();
    ctx.fillStyle = '#0f1116'; ctx.textAlign = 'center';
    ctx.fillText(rar.name, imgX + 8 + rw / 2, imgY + 24);
    ctx.textAlign = 'left';

    // NEW / DUP tag (top-right)
    if (isNew || isDuplicate) {
        const tag = isNew ? 'NEW' : 'DUPE';
        const tagCol = isNew ? '#57F287' : '#8b949e';
        ctx.font = fh.getBoldFont(12);
        const tw = ctx.measureText(tag).width + 18;
        drawRoundedRect(ctx, imgX + imgW - 8 - tw, imgY + 8, tw, 24, 6);
        ctx.fillStyle = tagCol; ctx.fill();
        ctx.fillStyle = '#0f1116'; ctx.textAlign = 'center';
        ctx.fillText(tag, imgX + imgW - 8 - tw / 2, imgY + 24);
        ctx.textAlign = 'left';
    }

    // Name
    ctx.fillStyle = '#e6edf3'; ctx.font = fh.getBoldFont(22); ctx.textAlign = 'center';
    ctx.fillText(truncateText(ctx, character.name, W - 40), W / 2, imgY + imgH + 42);

    // Anime
    ctx.fillStyle = '#8b949e'; ctx.font = fh.getFont(14);
    ctx.fillText(truncateText(ctx, character.anime, W - 40), W / 2, imgY + imgH + 66);

    // Rarity dot line
    ctx.fillStyle = rar.c;
    ctx.beginPath(); ctx.arc(W / 2 - 40, imgY + imgH + 90, 4, 0, Math.PI * 2); ctx.fill();
    ctx.font = fh.getSemiBoldFont(12); ctx.fillStyle = rar.c;
    ctx.fillText(rar.name, W / 2, imgY + imgH + 94);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

/**
 * Multi-roll grid — up to 10 mini cards (5×2).
 */
async function renderMulti(characters) {
    const fh = getFontHelpers('Inter');
    const cols = 5, rows = Math.ceil(characters.length / cols);
    const cw = 130, ch = 180, gap = 12, pad = 16;
    const W = pad * 2 + cols * cw + (cols - 1) * gap;
    const H = pad * 2 + rows * ch + (rows - 1) * gap + 30;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0f1116'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e6edf3'; ctx.font = fh.getBoldFont(18); ctx.textAlign = 'left';
    ctx.fillText('Multi Roll ×' + characters.length, pad, 26);

    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        const rar = rc(char.rarity);
        const col = i % cols, row = Math.floor(i / cols);
        const x = pad + col * (cw + gap);
        const y = 40 + row * (ch + gap);

        // Image
        const imgH = 130;
        let drew = false;
        if (char.image) {
            try {
                const img = await imageCache.loadWithCache(char.image, 5000);
                if (img) {
                    ctx.save(); drawRoundedRect(ctx, x, y, cw, imgH, 8); ctx.clip();
                    const scale = Math.max(cw / img.width, imgH / img.height);
                    const dw = img.width * scale, dh = img.height * scale;
                    ctx.drawImage(img, x + (cw - dw) / 2, y + (imgH - dh) / 2, dw, dh);
                    ctx.restore(); drew = true;
                }
            } catch {}
        }
        if (!drew) { drawRoundedRect(ctx, x, y, cw, imgH, 8); ctx.fillStyle = '#1a1d24'; ctx.fill(); }

        ctx.strokeStyle = rar.c; ctx.lineWidth = 2;
        drawRoundedRect(ctx, x, y, cw, imgH, 8); ctx.stroke();

        // Name below
        ctx.fillStyle = '#e6edf3'; ctx.font = fh.getSemiBoldFont(11); ctx.textAlign = 'center';
        ctx.fillText(truncateText(ctx, char.name, cw - 6), x + cw / 2, y + imgH + 18);
        ctx.fillStyle = rar.c; ctx.font = fh.getFont(9);
        ctx.fillText(rar.name, x + cw / 2, y + imgH + 32);
        ctx.textAlign = 'left';
    }

    return canvas.toBuffer('image/png');
}

module.exports = { renderCard, renderMulti };
