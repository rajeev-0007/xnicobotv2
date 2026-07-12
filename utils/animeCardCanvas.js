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
    common:    { c: '#B0BEC5', c2: '#78909C', name: 'COMMON',    tier: 1 },
    uncommon:  { c: '#2ECC71', c2: '#1E8E4E', name: 'UNCOMMON',  tier: 2 },
    rare:      { c: '#3FA9F5', c2: '#2472C8', name: 'RARE',      tier: 3 },
    epic:      { c: '#B673E8', c2: '#8E44AD', name: 'EPIC',      tier: 4 },
    legendary: { c: '#F5D442', c2: '#E6A817', name: 'LEGENDARY', tier: 5 },
    mythic:    { c: '#FF6B6B', c2: '#C0392B', name: 'MYTHIC',    tier: 6 },
};

function rc(rarity) { return RARITY_COL[rarity] || RARITY_COL.common; }

/** Convert #rrggbb to an rgba() string with the given alpha. */
function hexToRgba(hex, alpha = 1) {
    const h = (hex || '#000000').replace('#', '');
    const r = parseInt(h.substring(0, 2), 16) || 0;
    const g = parseInt(h.substring(2, 4), 16) || 0;
    const b = parseInt(h.substring(4, 6), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Fill text with a soft drop shadow for legibility over artwork. */
function shadowText(ctx, text, x, y, blur = 6) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    ctx.fillText(text, x, y);
    ctx.restore();
}

/** Draw a two-tone gradient rounded frame around the given box. */
function drawGradientFrame(ctx, x, y, w, h, r, colA, colB, lineWidth = 3) {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, colA);
    grad.addColorStop(1, colB);
    ctx.strokeStyle = grad;
    ctx.lineWidth = lineWidth;
    drawRoundedRect(ctx, x, y, w, h, r);
    ctx.stroke();
}

/** Draw a compact row of rarity stars (filled = tier) centered at cx. */
function drawStars(ctx, fh, cx, y, tier, color) {
    const total = 6;
    const gap = 15;
    const startX = cx - ((total - 1) * gap) / 2;
    ctx.font = fh.getBoldFont(13);
    ctx.textAlign = 'center';
    for (let i = 0; i < total; i++) {
        ctx.fillStyle = i < tier ? color : 'rgba(255,255,255,0.15)';
        ctx.fillText('★', startX + i * gap, y);
    }
    ctx.textAlign = 'left';
}

/**
 * Single character card. 340×480 portrait card.
 */
async function renderCard(character, { isDuplicate = false, isNew = false } = {}) {
    const fh = getFontHelpers('Inter');
    const W = 360, H = 520;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rar = rc(character.rarity);

    // Base background
    ctx.fillStyle = '#0e1013';
    ctx.fillRect(0, 0, W, H);

    // Rarity glow behind the card (radial from top)
    ctx.save();
    const bgGlow = ctx.createRadialGradient(W / 2, 150, 30, W / 2, 150, 360);
    bgGlow.addColorStop(0, hexToRgba(rar.c, 0.28));
    bgGlow.addColorStop(1, 'rgba(14,16,19,0)');
    ctx.fillStyle = bgGlow;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Portrait area
    const imgX = 18, imgY = 18, imgW = W - 36, imgH = 360;
    let drew = false;
    if (character.image) {
        try {
            const img = await imageCache.loadWithCache(character.image, 6000);
            if (img) {
                ctx.save();
                drawRoundedRect(ctx, imgX, imgY, imgW, imgH, 14);
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
        drawRoundedRect(ctx, imgX, imgY, imgW, imgH, 14);
        ctx.fillStyle = '#1a1d24'; ctx.fill();
        ctx.fillStyle = rar.c; ctx.font = fh.getBoldFont(44); ctx.textAlign = 'center';
        ctx.fillText('?', W / 2, imgY + imgH / 2 + 14);
        ctx.textAlign = 'left';
    }

    // Gradient fade at bottom of portrait for text legibility
    ctx.save();
    drawRoundedRect(ctx, imgX, imgY, imgW, imgH, 14); ctx.clip();
    const grad = ctx.createLinearGradient(0, imgY + imgH - 110, 0, imgY + imgH);
    grad.addColorStop(0, 'rgba(14,16,19,0)');
    grad.addColorStop(1, 'rgba(14,16,19,0.92)');
    ctx.fillStyle = grad; ctx.fillRect(imgX, imgY + imgH - 110, imgW, 110);
    ctx.restore();

    // Two-tone gradient rarity frame (double stroke for a premium edge)
    drawGradientFrame(ctx, imgX, imgY, imgW, imgH, 14, rar.c, rar.c2, 3.5);
    ctx.save();
    ctx.globalAlpha = 0.35;
    drawGradientFrame(ctx, imgX + 4, imgY + 4, imgW - 8, imgH - 8, 11, rar.c2, rar.c, 1);
    ctx.restore();

    // Rarity badge (top-left over image)
    ctx.font = fh.getBoldFont(12);
    const rw = ctx.measureText(rar.name).width + 22;
    ctx.save();
    ctx.shadowColor = hexToRgba(rar.c, 0.6); ctx.shadowBlur = 10;
    drawRoundedRect(ctx, imgX + 10, imgY + 10, rw, 26, 8);
    ctx.fillStyle = rar.c; ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#0f1116'; ctx.textAlign = 'center';
    ctx.fillText(rar.name, imgX + 10 + rw / 2, imgY + 27);
    ctx.textAlign = 'left';

    // NEW / DUP tag (top-right)
    if (isNew || isDuplicate) {
        const tag = isNew ? 'NEW' : 'DUPE';
        const tagCol = isNew ? '#57F287' : '#8b949e';
        ctx.font = fh.getBoldFont(12);
        const tw = ctx.measureText(tag).width + 20;
        drawRoundedRect(ctx, imgX + imgW - 10 - tw, imgY + 10, tw, 26, 8);
        ctx.fillStyle = tagCol; ctx.fill();
        ctx.fillStyle = '#0f1116'; ctx.textAlign = 'center';
        ctx.fillText(tag, imgX + imgW - 10 - tw / 2, imgY + 27);
        ctx.textAlign = 'left';
    }

    // Name (with drop shadow) — drawn over the faded portrait bottom
    ctx.fillStyle = '#ffffff'; ctx.font = fh.getBoldFont(24); ctx.textAlign = 'center';
    shadowText(ctx, truncateText(ctx, character.name, imgW - 24), W / 2, imgY + imgH - 40, 8);

    // Anime subtitle
    ctx.fillStyle = '#c9d1d9'; ctx.font = fh.getFont(14);
    shadowText(ctx, truncateText(ctx, character.anime, imgW - 24), W / 2, imgY + imgH - 16, 5);
    ctx.textAlign = 'left';

    // Rarity stars row below the portrait
    drawStars(ctx, fh, W / 2, imgY + imgH + 34, rar.tier, rar.c);

    // Rarity name label under the stars
    ctx.font = fh.getSemiBoldFont(13); ctx.fillStyle = rar.c; ctx.textAlign = 'center';
    ctx.fillText(rar.name, W / 2, imgY + imgH + 60);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

/**
 * Multi-roll grid — up to 10 mini cards (5×2).
 */
async function renderMulti(characters) {
    const fh = getFontHelpers('Inter');
    const cols = 5, rows = Math.ceil(characters.length / cols);
    const cw = 134, ch = 186, gap = 14, pad = 20;
    const W = pad * 2 + cols * cw + (cols - 1) * gap;
    const headerH = 44;
    const H = pad + headerH + rows * ch + (rows - 1) * gap + pad;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Background + subtle top glow (uses the best rarity pulled)
    ctx.fillStyle = '#0e1013'; ctx.fillRect(0, 0, W, H);
    const bestTier = characters.reduce((m, c) => Math.max(m, rc(c.rarity).tier), 0);
    const bestCol = Object.values(RARITY_COL).find(r => r.tier === bestTier) || RARITY_COL.common;
    ctx.save();
    const glow = ctx.createLinearGradient(0, 0, 0, headerH + 40);
    glow.addColorStop(0, hexToRgba(bestCol.c, 0.22));
    glow.addColorStop(1, 'rgba(14,16,19,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, headerH + 40);
    ctx.restore();

    ctx.fillStyle = '#ffffff'; ctx.font = fh.getBoldFont(20); ctx.textAlign = 'left';
    shadowText(ctx, `Multi Roll ×${characters.length}`, pad, 32, 6);

    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        const rar = rc(char.rarity);
        const col = i % cols, row = Math.floor(i / cols);
        const x = pad + col * (cw + gap);
        const y = headerH + pad + row * (ch + gap);

        // Image
        const imgH = 134;
        let drew = false;
        if (char.image) {
            try {
                const img = await imageCache.loadWithCache(char.image, 5000);
                if (img) {
                    ctx.save(); drawRoundedRect(ctx, x, y, cw, imgH, 10); ctx.clip();
                    const scale = Math.max(cw / img.width, imgH / img.height);
                    const dw = img.width * scale, dh = img.height * scale;
                    ctx.drawImage(img, x + (cw - dw) / 2, y + (imgH - dh) / 2, dw, dh);
                    ctx.restore(); drew = true;
                }
            } catch {}
        }
        if (!drew) {
            drawRoundedRect(ctx, x, y, cw, imgH, 10); ctx.fillStyle = '#1a1d24'; ctx.fill();
            ctx.fillStyle = rar.c; ctx.font = fh.getBoldFont(28); ctx.textAlign = 'center';
            ctx.fillText('?', x + cw / 2, y + imgH / 2 + 10); ctx.textAlign = 'left';
        }

        // Gradient rarity frame
        drawGradientFrame(ctx, x, y, cw, imgH, 10, rar.c, rar.c2, 2.5);

        // Name below
        ctx.fillStyle = '#e6edf3'; ctx.font = fh.getSemiBoldFont(11); ctx.textAlign = 'center';
        ctx.fillText(truncateText(ctx, char.name, cw - 8), x + cw / 2, y + imgH + 20);
        ctx.fillStyle = rar.c; ctx.font = fh.getBoldFont(9);
        ctx.fillText(rar.name, x + cw / 2, y + imgH + 36);
        ctx.textAlign = 'left';
    }

    return canvas.toBuffer('image/png');
}

/**
 * Side-by-side comparison of two characters.
 */
async function renderCompare(char1, char2) {
    const fh = getFontHelpers('Inter');
    const W = 620, H = 360;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#0f1116';
    ctx.fillRect(0, 0, W, H);

    const drawSide = async (char, x, isRight = false) => {
        const iw = 240, ih = 240, iy = 40;
        const rar = rc(char.rarity);
        
        let drew = false;
        if (char.image) {
            try {
                const img = await imageCache.loadWithCache(char.image, 6000);
                if (img) {
                    ctx.save();
                    drawRoundedRect(ctx, x, iy, iw, ih, 12);
                    ctx.clip();
                    const scale = Math.max(iw / img.width, ih / img.height);
                    const dw = img.width * scale, dh = img.height * scale;
                    ctx.drawImage(img, x + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh);
                    ctx.restore();
                    drew = true;
                }
            } catch {}
        }
        
        if (!drew) {
            drawRoundedRect(ctx, x, iy, iw, ih, 12);
            ctx.fillStyle = '#1a1d24'; ctx.fill();
        }

        drawGradientFrame(ctx, x, iy, iw, ih, 12, rar.c, rar.c2, 3);

        ctx.fillStyle = '#e6edf3'; 
        ctx.font = fh.getBoldFont(18); 
        ctx.textAlign = 'center';
        ctx.fillText(truncateText(ctx, char.name, iw), x + iw / 2, iy + ih + 30);
        
        ctx.fillStyle = rar.c;
        ctx.font = fh.getSemiBoldFont(12);
        ctx.fillText(rar.name.toUpperCase(), x + iw / 2, iy + ih + 50);
        ctx.textAlign = 'left';
    };

    await drawSide(char1, 30, false);
    await drawSide(char2, W - 270, true);

    ctx.fillStyle = '#E74C3C'; 
    ctx.font = fh.getBoldFont(40); 
    ctx.textAlign = 'center';
    ctx.fillText('VS', W / 2, H / 2 + 10);
    ctx.textAlign = 'left';
    
    return canvas.toBuffer('image/png');
}

/**
 * Premium Showcase render
 */
async function renderShowcase(character) {
    const fh = getFontHelpers('Inter');
    const W = 400, H = 560;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rar = rc(character.rarity);

    ctx.fillStyle = '#0f1116';
    ctx.fillRect(0, 0, W, H);

    // Glow
    ctx.save();
    ctx.globalAlpha = 0.2;
    const glow = ctx.createRadialGradient(W/2, H/2, 50, W/2, H/2, 250);
    glow.addColorStop(0, rar.c);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const imgX = 20, imgY = 20, imgW = W - 40, imgH = 400;
    let drew = false;
    if (character.image) {
        try {
            const img = await imageCache.loadWithCache(character.image, 6000);
            if (img) {
                ctx.save();
                drawRoundedRect(ctx, imgX, imgY, imgW, imgH, 16);
                ctx.clip();
                const scale = Math.max(imgW / img.width, imgH / img.height);
                const dw = img.width * scale, dh = img.height * scale;
                ctx.drawImage(img, imgX + (imgW - dw) / 2, imgY + (imgH - dh) / 2, dw, dh);
                ctx.restore();
                drew = true;
            }
        } catch {}
    }
    
    if (!drew) {
        drawRoundedRect(ctx, imgX, imgY, imgW, imgH, 16);
        ctx.fillStyle = '#1a1d24'; ctx.fill();
    }

    // Border
    drawGradientFrame(ctx, imgX, imgY, imgW, imgH, 16, rar.c, rar.c2, 4);

    // Rarity Badge
    ctx.font = fh.getBoldFont(14);
    const rw = ctx.measureText(rar.name).width + 24;
    drawRoundedRect(ctx, imgX + 12, imgY + 12, rw, 28, 8);
    ctx.fillStyle = rar.c; ctx.fill();
    ctx.fillStyle = '#0f1116'; ctx.textAlign = 'center';
    ctx.fillText(rar.name, imgX + 12 + rw / 2, imgY + 30);
    ctx.textAlign = 'left';

    // Showcase text
    ctx.fillStyle = '#e6edf3'; 
    ctx.font = fh.getBoldFont(26); 
    ctx.textAlign = 'center';
    ctx.fillText(truncateText(ctx, character.name, W - 40), W / 2, imgY + imgH + 50);

    ctx.fillStyle = '#8b949e'; 
    ctx.font = fh.getFont(16);
    ctx.fillText(truncateText(ctx, character.anime, W - 40), W / 2, imgY + imgH + 76);

    ctx.fillStyle = '#f1c40f';
    ctx.font = fh.getSemiBoldFont(14);
    ctx.fillText('✨ PREMIUM SHOWCASE ✨', W / 2, imgY + imgH + 104);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

/**
 * Mystery Box Reveal
 */
async function renderMysteryBox(characters, boxName) {
    const fh = getFontHelpers('Inter');
    const cols = 3, rows = 1;
    const cw = 150, ch = 210, gap = 16, pad = 24;
    const W = pad * 2 + cols * cw + (cols - 1) * gap;
    const H = pad * 2 + rows * ch + (rows - 1) * gap + 50;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#0f1116'; ctx.fillRect(0, 0, W, H);
    
    ctx.fillStyle = '#e6edf3'; 
    ctx.font = fh.getBoldFont(22); 
    ctx.textAlign = 'center';
    ctx.fillText(`🎁 ${boxName} Unboxed!`, W / 2, 34);

    for (let i = 0; i < characters.length; i++) {
        const char = characters[i];
        const rar = rc(char.rarity);
        const col = i % cols, row = Math.floor(i / cols);
        const x = pad + col * (cw + gap);
        const y = 60 + row * (ch + gap);

        const imgH = 150;
        let drew = false;
        if (char.image) {
            try {
                const img = await imageCache.loadWithCache(char.image, 5000);
                if (img) {
                    ctx.save(); drawRoundedRect(ctx, x, y, cw, imgH, 10); ctx.clip();
                    const scale = Math.max(cw / img.width, imgH / img.height);
                    const dw = img.width * scale, dh = img.height * scale;
                    ctx.drawImage(img, x + (cw - dw) / 2, y + (imgH - dh) / 2, dw, dh);
                    ctx.restore(); drew = true;
                }
            } catch {}
        }
        if (!drew) { drawRoundedRect(ctx, x, y, cw, imgH, 10); ctx.fillStyle = '#1a1d24'; ctx.fill(); }

        drawGradientFrame(ctx, x, y, cw, imgH, 10, rar.c, rar.c2, 3);

        ctx.fillStyle = '#e6edf3'; ctx.font = fh.getSemiBoldFont(13); ctx.textAlign = 'center';
        ctx.fillText(truncateText(ctx, char.name, cw - 10), x + cw / 2, y + imgH + 22);
        ctx.fillStyle = rar.c; ctx.font = fh.getBoldFont(11);
        ctx.fillText(rar.name, x + cw / 2, y + imgH + 38);
        ctx.textAlign = 'left';
    }

    return canvas.toBuffer('image/png');
}

/**
 * Fusion Result
 */
async function renderFusion(resultChar, isUpgrade) {
    const fh = getFontHelpers('Inter');
    const W = 360, H = 500;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rar = rc(resultChar.rarity);

    ctx.fillStyle = '#0f1116';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.3;
    const glow = ctx.createRadialGradient(W/2, H/2, 20, W/2, H/2, 200);
    glow.addColorStop(0, isUpgrade ? '#57F287' : rar.c);
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const imgX = 24, imgY = 24, imgW = W - 48, imgH = 340;
    let drew = false;
    if (resultChar.image) {
        try {
            const img = await imageCache.loadWithCache(resultChar.image, 6000);
            if (img) {
                ctx.save();
                drawRoundedRect(ctx, imgX, imgY, imgW, imgH, 16);
                ctx.clip();
                const scale = Math.max(imgW / img.width, imgH / img.height);
                const dw = img.width * scale, dh = img.height * scale;
                ctx.drawImage(img, imgX + (imgW - dw) / 2, imgY + (imgH - dh) / 2, dw, dh);
                ctx.restore();
                drew = true;
            }
        } catch {}
    }
    
    if (!drew) {
        drawRoundedRect(ctx, imgX, imgY, imgW, imgH, 16);
        ctx.fillStyle = '#1a1d24'; ctx.fill();
    }

    drawGradientFrame(ctx, imgX, imgY, imgW, imgH, 16, rar.c, rar.c2, 4);

    ctx.font = fh.getBoldFont(14);
    const rw = ctx.measureText(rar.name).width + 24;
    drawRoundedRect(ctx, imgX + 12, imgY + 12, rw, 28, 8);
    ctx.fillStyle = rar.c; ctx.fill();
    ctx.fillStyle = '#0f1116'; ctx.textAlign = 'center';
    ctx.fillText(rar.name, imgX + 12 + rw / 2, imgY + 30);
    ctx.textAlign = 'left';

    if (isUpgrade) {
        const tw = ctx.measureText('UPGRADED!').width + 18;
        drawRoundedRect(ctx, imgX + imgW - 12 - tw, imgY + 12, tw, 28, 8);
        ctx.fillStyle = '#57F287'; ctx.fill();
        ctx.fillStyle = '#0f1116'; ctx.textAlign = 'center';
        ctx.fillText('UPGRADED!', imgX + imgW - 12 - tw / 2, imgY + 30);
        ctx.textAlign = 'left';
    }

    ctx.fillStyle = '#e6edf3'; 
    ctx.font = fh.getBoldFont(24); 
    ctx.textAlign = 'center';
    ctx.fillText(truncateText(ctx, resultChar.name, W - 40), W / 2, imgY + imgH + 50);

    ctx.fillStyle = '#8b949e'; 
    ctx.font = fh.getFont(16);
    ctx.fillText(truncateText(ctx, resultChar.anime, W - 40), W / 2, imgY + imgH + 74);
    
    ctx.fillStyle = '#9b59b6';
    ctx.font = fh.getSemiBoldFont(14);
    ctx.fillText('🔮 FUSION SUCCESS 🔮', W / 2, imgY + imgH + 104);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

/**
 * Upgrade Result
 */
async function renderUpgrade(resultChar) {
    const fh = getFontHelpers('Inter');
    const W = 360, H = 500;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const rar = rc(resultChar.rarity);

    ctx.fillStyle = '#0f1116';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.3;
    const glow = ctx.createRadialGradient(W/2, H/2, 20, W/2, H/2, 200);
    glow.addColorStop(0, '#F1C40F');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const imgX = 24, imgY = 24, imgW = W - 48, imgH = 340;
    let drew = false;
    if (resultChar.image) {
        try {
            const img = await imageCache.loadWithCache(resultChar.image, 6000);
            if (img) {
                ctx.save();
                drawRoundedRect(ctx, imgX, imgY, imgW, imgH, 16);
                ctx.clip();
                const scale = Math.max(imgW / img.width, imgH / img.height);
                const dw = img.width * scale, dh = img.height * scale;
                ctx.drawImage(img, imgX + (imgW - dw) / 2, imgY + (imgH - dh) / 2, dw, dh);
                ctx.restore();
                drew = true;
            }
        } catch {}
    }
    
    if (!drew) {
        drawRoundedRect(ctx, imgX, imgY, imgW, imgH, 16);
        ctx.fillStyle = '#1a1d24'; ctx.fill();
    }

    drawGradientFrame(ctx, imgX, imgY, imgW, imgH, 16, rar.c, rar.c2, 4);

    ctx.font = fh.getBoldFont(14);
    const rw = ctx.measureText(rar.name).width + 24;
    drawRoundedRect(ctx, imgX + 12, imgY + 12, rw, 28, 8);
    ctx.fillStyle = rar.c; ctx.fill();
    ctx.fillStyle = '#0f1116'; ctx.textAlign = 'center';
    ctx.fillText(rar.name, imgX + 12 + rw / 2, imgY + 30);
    ctx.textAlign = 'left';

    const tw = ctx.measureText('ASCENDED!').width + 18;
    drawRoundedRect(ctx, imgX + imgW - 12 - tw, imgY + 12, tw, 28, 8);
    ctx.fillStyle = '#F1C40F'; ctx.fill();
    ctx.fillStyle = '#0f1116'; ctx.textAlign = 'center';
    ctx.fillText('ASCENDED!', imgX + imgW - 12 - tw / 2, imgY + 30);
    ctx.textAlign = 'left';

    ctx.fillStyle = '#e6edf3'; 
    ctx.font = fh.getBoldFont(24); 
    ctx.textAlign = 'center';
    ctx.fillText(truncateText(ctx, resultChar.name, W - 40), W / 2, imgY + imgH + 50);

    ctx.fillStyle = '#8b949e'; 
    ctx.font = fh.getFont(16);
    ctx.fillText(truncateText(ctx, resultChar.anime, W - 40), W / 2, imgY + imgH + 74);
    
    ctx.fillStyle = '#F1C40F';
    ctx.font = fh.getSemiBoldFont(14);
    ctx.fillText('✨ ASCENSION COMPLETE ✨', W / 2, imgY + imgH + 104);
    ctx.textAlign = 'left';

    return canvas.toBuffer('image/png');
}

module.exports = { renderCard, renderMulti, renderCompare, renderShowcase, renderMysteryBox, renderFusion, renderUpgrade };
