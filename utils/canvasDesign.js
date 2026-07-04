'use strict';

/**
 * canvasDesign.js — design system + shared primitives for every
 * canvas card the bot generates.
 *
 * What lives here:
 *   • Theme constants (palette, radii, font scale)
 *   • Pure geometry: rounded rect path, hex→rgb, gradients
 *   • Composable primitives: drawBox, drawBadgeBox, drawAvatar,
 *     drawProgressBar, drawDivider, drawStarField …
 *   • drawText / measureText that delegate to emojiCanvasHelper so
 *     custom + Unicode emojis render as proper images.
 *   • drawNicoBranding watermark.
 *
 * Card files (welcomeCard, leveCard, …) should consume these helpers
 * instead of duplicating their own glow/box/text routines.
 */

const { loadImage } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');
const imageCache = require('./imageCache');
const { drawTextWithEmoji, measureMixedText, normalizeCanvasText } = require('./emojiCanvasHelper');
const { getCanvasEmojiAssetUrl } = require('./canvasEmojiDefaults');
const { getFontHelpers, registerAllFonts } = require('./fontRegistry');

try { registerAllFonts(); } catch {}

/* ════════════════════════════════════════════════════════════════
   THEME
   ════════════════════════════════════════════════════════════════ */

const DESIGN = {
    padding: 35,
    borderRadius: 24,
    boxRadius: 14,
    badgeRadius: 10,
    pillRadius: 999,    // resolves to height/2 inside the pill helper
    colors: {
        bg:           '#0f0f23',
        bgSecondary:  '#1a1a3e',
        bgTertiary:   '#1c1c3a',
        boxBg:        'rgba(30, 30, 65, 0.95)',
        boxBorder:    '50',
        text:         '#ffffff',
        textMuted:    '#9ca3af',
        textDim:      '#6b7280',
        accent:       '#7c3aed',
        secondary:    '#06b6d4',
        welcome:      '#22c55e',
        leave:        '#ef4444',
        gold:         '#fbbf24',
    },
    fonts: {
        title:       30,
        titleLarge:  40,
        username:    28,
        subtitle:    13,
        label:       10,
        message:     18,
        value:       18,
        smallValue:  16,
        small:       12,
        tiny:        9,
    },
};

/* ════════════════════════════════════════════════════════════════
   FONTS
   ════════════════════════════════════════════════════════════════ */

const FALLBACK_STACK = 'Arial, NotoSans, NotoSansJP, sans-serif';
function getFont(size)         { return `400 ${size}px Inter-Regular, ${FALLBACK_STACK}`; }
function getMediumFont(size)   { return `500 ${size}px Inter-Medium, ${FALLBACK_STACK}`; }
function getSemiBoldFont(size) { return `600 ${size}px Inter-SemiBold, ${FALLBACK_STACK}`; }
function getBoldFont(size)     { return `700 ${size}px Inter-Bold, ${FALLBACK_STACK}`; }

/* ════════════════════════════════════════════════════════════════
   COLOUR
   ════════════════════════════════════════════════════════════════ */

function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
    return m
        ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
        : { r: 124, g: 58, b: 237 };
}

function rgba(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/* ════════════════════════════════════════════════════════════════
   FORMAT
   ════════════════════════════════════════════════════════════════ */

function formatNumber(n) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString();
}

function formatVoiceTime(seconds) {
    seconds = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function truncateText(ctx, text, maxWidth) {
    text = String(text ?? '');
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 0 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
}

function fitText(ctx, text, maxWidth, baseSize, minSize = 10) {
    for (let size = baseSize; size >= minSize; size--) {
        ctx.font = getBoldFont(size);
        if (ctx.measureText(text).width <= maxWidth) return size;
    }
    return minSize;
}

/* ════════════════════════════════════════════════════════════════
   GEOMETRY
   ════════════════════════════════════════════════════════════════ */

function drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

/* ════════════════════════════════════════════════════════════════
   TEXT (delegates to emoji helper)
   ════════════════════════════════════════════════════════════════ */

function _currentFontSize(ctx) {
    // Match the "px" size, NOT the leading font weight (e.g. "700 16px Inter-Bold").
    const m = String(ctx.font || '').match(/(\d+(?:\.\d+)?)px/);
    return m ? parseInt(m[1], 10) : 16;
}

function measureText(ctx, text) {
    return measureMixedText(ctx, text, _currentFontSize(ctx));
}

async function drawText(ctx, text, x, y, centered = false) {
    const fs = _currentFontSize(ctx);
    const savedAlign = ctx.textAlign;
    if (centered) ctx.textAlign = 'center';
    const w = await drawTextWithEmoji(ctx, text, x, y, fs);
    ctx.textAlign = savedAlign;
    return w;
}

/* ════════════════════════════════════════════════════════════════
   PRIMITIVES — backgrounds & textures
   ════════════════════════════════════════════════════════════════ */

function drawGradientBackground(ctx, width, height, primary, secondary) {
    const g = ctx.createLinearGradient(0, 0, width, height);
    g.addColorStop(0, primary);
    g.addColorStop(0.5, secondary);
    g.addColorStop(1, primary);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
}

function drawDiagonalLines(ctx, width, height, color, spacing = 45) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (let i = -height; i < width + height; i += spacing) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + height, height);
        ctx.stroke();
    }
    ctx.restore();
}

function drawNoise(ctx, width, height, alpha = 0.025) {
    ctx.save();
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    for (let y = 12; y < height; y += 22) {
        for (let x = 12; x < width; x += 22) {
            ctx.beginPath();
            ctx.arc(x, y, 0.7, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.restore();
}

function drawAmbientGlow(ctx, cx, cy, radius, color, alpha = 0.1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, rgba(color, 1));
    g.addColorStop(0.5, rgba(color, 0.4));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.restore();
}

/* ════════════════════════════════════════════════════════════════
   PRIMITIVES — boxes, badges, dividers, pills
   ════════════════════════════════════════════════════════════════ */

function drawBox(ctx, x, y, width, height, color, shadowBlur = 12) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = shadowBlur;
    ctx.fillStyle = 'rgba(20, 20, 45, 0.95)';
    drawRoundedRect(ctx, x, y, width, height, DESIGN.boxRadius);
    ctx.fill();
    ctx.restore();

    const grad = ctx.createLinearGradient(x, y, x + width, y + height);
    grad.addColorStop(0, 'rgba(35, 35, 75, 0.92)');
    grad.addColorStop(1, 'rgba(22, 22, 52, 0.95)');
    ctx.fillStyle = grad;
    drawRoundedRect(ctx, x, y, width, height, DESIGN.boxRadius);
    ctx.fill();

    ctx.strokeStyle = color + DESIGN.colors.boxBorder;
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, x, y, width, height, DESIGN.boxRadius);
    ctx.stroke();

    // Top hairline highlight — gives the box a glassy edge.
    ctx.save();
    const top = ctx.createLinearGradient(x + 10, y, x + width - 10, y);
    top.addColorStop(0, 'transparent');
    top.addColorStop(0.5, rgba(color, 0.35));
    top.addColorStop(1, 'transparent');
    ctx.strokeStyle = top;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 0.5);
    ctx.lineTo(x + width - 10, y + 0.5);
    ctx.stroke();
    ctx.restore();
}

function drawBadgeBox(ctx, x, y, size, color) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(22, 22, 50, 0.95)';
    drawRoundedRect(ctx, x, y, size, size, DESIGN.badgeRadius);
    ctx.fill();
    ctx.restore();

    const grad = ctx.createLinearGradient(x, y, x + size, y + size);
    grad.addColorStop(0, 'rgba(38, 38, 78, 0.92)');
    grad.addColorStop(1, 'rgba(22, 22, 52, 0.95)');
    ctx.fillStyle = grad;
    drawRoundedRect(ctx, x, y, size, size, DESIGN.badgeRadius);
    ctx.fill();

    ctx.strokeStyle = color + '55';
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, x, y, size, size, DESIGN.badgeRadius);
    ctx.stroke();
}

function drawDivider(ctx, x1, x2, y, color, weight = 1.5) {
    const g = ctx.createLinearGradient(x1, y, x2, y);
    g.addColorStop(0,    'rgba(0,0,0,0)');
    g.addColorStop(0.2,  rgba(color, 0.5));
    g.addColorStop(0.8,  rgba(color, 0.3));
    g.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = weight;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
}

/**
 * Modern progress bar with a track, gradient fill, and tip glow.
 * Matches the look used across level/profile/economy cards.
 */
function drawProgressBar(ctx, x, y, width, height, progress, accentColor, secondaryColor = null, options = {}) {
    const radius = options.radius ?? height / 2;
    const trackBg = options.trackBg ?? 'rgba(30, 30, 60, 0.8)';
    const showShine = options.showShine !== false;

    // Track
    ctx.fillStyle = trackBg;
    drawRoundedRect(ctx, x, y, width, height, radius);
    ctx.fill();

    const p = Math.min(Math.max(progress, 0), 1);
    if (p <= 0) return;

    const fillWidth = Math.max(width * p, radius * 2);

    ctx.save();
    drawRoundedRect(ctx, x, y, width, height, radius);
    ctx.clip();

    const fill = ctx.createLinearGradient(x, 0, x + width, 0);
    fill.addColorStop(0,   accentColor);
    fill.addColorStop(0.5, secondaryColor || accentColor);
    fill.addColorStop(1,   accentColor);
    ctx.fillStyle = fill;
    drawRoundedRect(ctx, x, y, fillWidth, height, radius);
    ctx.fill();

    if (showShine) {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, fillWidth, height / 2);
        ctx.globalAlpha = 1;
    }
    ctx.restore();
}

/**
 * Stat box used by level/profile/stats cards: a glassy panel with
 * an icon, an uppercase label, and a value.
 *
 * @param {object} ctx
 * @param {object} opts
 *   x, y, width, height – box geometry
 *   color               – accent
 *   icon                – optional Discord/Unicode emoji string
 *   label, value        – uppercase label + bold value
 *   labelFont, valueFont – CSS font strings
 *   valueColor          – defaults to accent
 */
async function drawStatBox(ctx, opts) {
    const {
        x, y, width, height, color,
        icon, label, value,
        labelFont = getSemiBoldFont(DESIGN.fonts.tiny),
        valueFont = getBoldFont(DESIGN.fonts.value),
        valueColor,
        iconSize = 18,
        iconPadding = 12,
    } = opts;

    drawBox(ctx, x, y, width, height, color, 8);

    let textX = x + iconPadding;
    if (icon) {
        const iconUrl = getCanvasEmojiAssetUrl(icon);
        if (iconUrl) {
            try {
                const img = await imageCache.loadWithCache(iconUrl, 4000);
                if (img) {
                    ctx.drawImage(img, x + iconPadding, y + 10, iconSize, iconSize);
                    textX = x + iconPadding + iconSize + 6;
                }
            } catch {}
        }
    }

    ctx.font = labelFont;
    ctx.fillStyle = DESIGN.colors.textMuted;
    const labelMaxW = x + width - textX - iconPadding;
    ctx.fillText(truncateText(ctx, label, labelMaxW), textX, y + 21);

    const fitSize = fitText(
        ctx,
        value,
        width - iconPadding * 2,
        // Pull the "px" size from "700 18px Inter-Bold, ..." — must NOT match the
        // leading font weight (700/600/etc.) or fitText would start at a huge size.
        parseInt(String(valueFont).match(/(\d+(?:\.\d+)?)px/)?.[1]) || DESIGN.fonts.value,
        12,
    );
    ctx.font = getBoldFont(fitSize);
    ctx.fillStyle = valueColor || color;
    ctx.fillText(value, x + iconPadding, y + height - 16);
}

/* ════════════════════════════════════════════════════════════════
   PRIMITIVES — avatar
   ════════════════════════════════════════════════════════════════ */

/**
 * Round avatar with a background ring and a conic accent ring on top.
 * Falls back to a coloured initial if the image fails to load.
 */
async function drawConicAvatarRing(ctx, avatar, x, y, size, primary, secondary, bgColor) {
    const cx = x + size / 2;
    const cy = y + size / 2;
    const r  = size / 2;

    // Soft halo
    ctx.save();
    ctx.shadowColor = primary;
    ctx.shadowBlur  = 30;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fillStyle = rgba(primary, 0.2);
    ctx.fill();
    ctx.restore();

    if (avatar) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatar, x, y, size, size);
        ctx.restore();
    } else {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = rgba(primary, 0.25);
        ctx.fill();
    }

    // Background ring (separation against bg)
    ctx.strokeStyle = bgColor;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
    ctx.stroke();

    // Conic accent ring
    const ring = ctx.createConicGradient(0, cx, cy);
    ring.addColorStop(0,   primary);
    ring.addColorStop(0.3, secondary);
    ring.addColorStop(0.6, primary);
    ring.addColorStop(1,   secondary);
    ctx.strokeStyle = ring;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 8, 0, Math.PI * 2);
    ctx.stroke();
}

/* ════════════════════════════════════════════════════════════════
   BRANDING
   ════════════════════════════════════════════════════════════════ */

const LOGO_PATH = path.join(__dirname, '../assets/images/nico-avatar.png');
let _cachedLogo = null;
let _logoLoadAttempted = false;

async function getNicoLogo() {
    if (_cachedLogo || _logoLoadAttempted) return _cachedLogo;
    _logoLoadAttempted = true;
    try {
        if (fs.existsSync(LOGO_PATH)) {
            _cachedLogo = await loadImage(LOGO_PATH);
        }
    } catch {}
    return _cachedLogo;
}

async function drawNicoBranding(ctx, canvasW, canvasH, accentColor = '#7c3aed') {
    const logo = await getNicoLogo();
    const rgb = hexToRgb(accentColor);

    if (logo) {
        // Faint watermark behind everything
        ctx.save();
        ctx.globalAlpha = 0.06;
        const wmSize = 160;
        const wmX = canvasW - wmSize - 30;
        const wmY = canvasH - wmSize - 10;
        ctx.beginPath();
        ctx.arc(wmX + wmSize / 2, wmY + wmSize / 2, wmSize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(logo, wmX, wmY, wmSize, wmSize);
        ctx.restore();

        // Small corner badge
        const logoSize = 20;
        const logoX = canvasW - 68;
        const logoY = canvasH - 28;

        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(logo, logoX, logoY, logoSize, logoSize);
        ctx.restore();

        const ring = ctx.createConicGradient(0, logoX + logoSize / 2, logoY + logoSize / 2);
        ring.addColorStop(0,   `rgba(${rgb.r},${rgb.g},${rgb.b},0.3)`);
        ring.addColorStop(0.5, 'rgba(6,182,212,0.3)');
        ring.addColorStop(1,   `rgba(${rgb.r},${rgb.g},${rgb.b},0.3)`);
        ctx.strokeStyle = ring;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2 + 1, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = getSemiBoldFont(10);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.textAlign = 'left';
        ctx.fillText('xNico', logoX + logoSize + 5, logoY + 14);
    } else {
        ctx.font = getSemiBoldFont(10);
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.textAlign = 'right';
        ctx.fillText('xNico', canvasW - 14, canvasH - 10);
        ctx.textAlign = 'left';
    }
}

/* ════════════════════════════════════════════════════════════════
   LEGACY SHIM
   ════════════════════════════════════════════════════════════════ */

/**
 * Older code paths still call loadEmoji() directly. Route them through
 * the proper helpers so behaviour is consistent everywhere.
 */
async function loadEmoji(emojiContent, isCustom = false, emojiId = null, animated = false, emojiName = '') {
    try {
        if (isCustom && emojiId) {
            const url = `https://cdn.discordapp.com/emojis/${emojiId}.${animated ? 'gif' : 'png'}?size=128&quality=lossless`;
            return await imageCache.loadWithCache(url, 4000);
        }
        const url = getCanvasEmojiAssetUrl(emojiContent || emojiName || 'emoji');
        return url ? await imageCache.loadWithCache(url, 4000) : null;
    } catch { return null; }
}

/* ════════════════════════════════════════════════════════════════
   EXPORTS
   ════════════════════════════════════════════════════════════════ */

module.exports = {
    DESIGN,
    // Fonts
    getFont,
    getMediumFont,
    getBoldFont,
    getSemiBoldFont,
    getFontHelpers,
    // Colour
    hexToRgb,
    rgba,
    // Format
    formatNumber,
    formatVoiceTime,
    truncateText,
    fitText,
    // Geometry
    drawRoundedRect,
    // Text
    drawText,
    measureText,
    drawTextWithEmoji,
    measureMixedText,
    normalizeCanvasText,
    // Primitives
    drawGradientBackground,
    drawDiagonalLines,
    drawNoise,
    drawAmbientGlow,
    drawBox,
    drawBadgeBox,
    drawDivider,
    drawProgressBar,
    drawStatBox,
    drawConicAvatarRing,
    // Legacy shim (still used by levelUpCard)
    loadEmoji,
    // Branding
    getNicoLogo,
    drawNicoBranding,
};
