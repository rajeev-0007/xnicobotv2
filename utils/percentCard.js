'use strict';

/**
 * percentCard.js — Premium "diagnostic report" percentage card.
 *
 * Used by /howgay, /howstraight, /howcute, /howsmart, /howsus,
 * /howsigma, /howcursed, /howsimp, /howlucky, /howevil, /howedgy,
 * /howcool, /howhot, /howbraindead, /howrich, /howtoxic, /howweeb,
 * /howgamer, /howbroke, /howsleepy, /howannoying, /howfunny,
 * /howfriendly, /howcaring, /howbaby, /howmature, /howcrazy,
 * /howlazy, /howhorny, /howkind, /iq, /pp, /ship, /rate.
 *
 * Visual design (v3 — diagnostic-report refresh)
 * ─────────────────────────────────────────────
 *
 *   Layout (1240 × 520):
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ ░░ glassy bg ░░                                             │
 *   │ ┌──────────────────────────────────────────────────────┐    │
 *   │ │ EYEBROW · Rating · TIER 5/8                          │    │
 *   │ │ Subject Name                                         │    │
 *   │ │                                                      │    │
 *   │ │  ┌──────────┐                                        │    │
 *   │ │  │ avatar + │   72%  ← gradient hero                 │    │
 *   │ │  │  ring    │   "Verdict line in display weight"     │    │
 *   │ │  └──────────┘   detail line in muted small font…     │    │
 *   │ │                                                      │    │
 *   │ │  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░  segmented bar               │    │
 *   │ │  0   25   50   75   100                              │    │
 *   │ │                                                      │    │
 *   │ │  ┌──────┬──────┬──────┬──────┐                       │    │
 *   │ │  │ TIER │ RANK │SEED  │ TONE │   stat strip          │    │
 *   │ │  └──────┴──────┴──────┴──────┘                       │    │
 *   │ │                              brand pill ▸▸▸          │    │
 *   │ └──────────────────────────────────────────────────────┘    │
 *   └─────────────────────────────────────────────────────────────┘
 *
 *   • Five-stop accent palette (red → orange → amber → lime → emerald)
 *     interpolated by the visual fill ratio so every element re-tones
 *     in concert.
 *   • Avatar block: progress ring around the avatar with a soft halo,
 *     gradient-filled arc, glowing tip dot, and an inner highlight
 *     stroke for crispness.
 *   • Hero number: gradient-filled, drop-shadowed, sized to fit the
 *     available column.
 *   • Stat strip: 4 small cards (Tier / Rank vs avg / Seed / Tone)
 *     give the result a "diagnostic" feel without inventing fake data.
 *   • Watermark stamp ("CALIBRATED") sits behind the report.
 *
 * Fonts: Outfit for display, Inter for UI. Both already registered
 * by the bot's font registry.
 *
 * © Rajeev (Rexzy) — xNico
 */

const { createCanvas } = require('@napi-rs/canvas');
const imageCache = require('./imageCache');
const { registerAllFonts, getFontHelpers } = require('./fontRegistry');
const { drawTextWithEmoji, measureMixedText } = require('./emojiCanvasHelper');

try { registerAllFonts(); } catch (_) { /* already registered */ }

/* ─────────────────────────── canvas size ─────────────────────────── */

const W = 1240;
const H = 520;
const PAD = 36;
const RADIUS = 28;

/* ─────────────────────────── primitives ──────────────────────────── */

function roundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/** Draw a single line of text with optional letter-spacing tracking. */
function drawTracked(ctx, text, x, y, tracking = 0) {
    if (!tracking) {
        ctx.fillText(text, x, y);
        return ctx.measureText(text).width;
    }
    let cursor = x;
    for (const ch of text) {
        ctx.fillText(ch, cursor, y);
        cursor += ctx.measureText(ch).width + tracking;
    }
    return cursor - x;
}

/** Truncate a string with ellipsis to fit a max width. */
function truncate(ctx, text, maxWidth, suffix = '…') {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let out = text;
    while (out.length > 1 && ctx.measureText(out + suffix).width > maxWidth) {
        out = out.slice(0, -1);
    }
    return out + suffix;
}

/* ─────────────────────── colour interpolation ────────────────────── */

/**
 * Returns a colour graded by percent. Five-stop gradient:
 *   0%   red → 25% orange → 50% amber → 75% lime → 100% emerald
 * The intermediate stops keep mid-range scores warm instead of muddy.
 */
function colorForPercent(p) {
    const stops = [
        { p: 0,   c: [239, 68,  68 ] }, // red-500
        { p: 25,  c: [249, 115, 22 ] }, // orange-500
        { p: 50,  c: [245, 158, 11 ] }, // amber-500
        { p: 75,  c: [132, 204, 22 ] }, // lime-500
        { p: 100, c: [16,  185, 129] }, // emerald-500
    ];
    const v = Math.max(0, Math.min(100, p));
    let lo = stops[0], hi = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
        if (v >= stops[i].p && v <= stops[i + 1].p) {
            lo = stops[i]; hi = stops[i + 1]; break;
        }
    }
    const t = (v - lo.p) / Math.max(1, (hi.p - lo.p));
    const r = Math.round(lo.c[0] + (hi.c[0] - lo.c[0]) * t);
    const g = Math.round(lo.c[1] + (hi.c[1] - lo.c[1]) * t);
    const b = Math.round(lo.c[2] + (hi.c[2] - lo.c[2]) * t);
    return {
        hex: `rgb(${r},${g},${b})`,
        rgb: [r, g, b],
        rgba: (a = 1) => `rgba(${r},${g},${b},${a})`,
    };
}

/**
 * Produce a label describing the percentile bucket. Keeps the
 * "diagnostic report" copy slightly varied without inventing
 * different metrics for each command.
 */
function toneFor(p) {
    if (p >= 90) return { word: 'PEAK',     hint: 'top decile' };
    if (p >= 75) return { word: 'HIGH',     hint: 'above curve' };
    if (p >= 60) return { word: 'WARM',     hint: 'on-trend' };
    if (p >= 40) return { word: 'NEUTRAL',  hint: 'mid-band' };
    if (p >= 25) return { word: 'COOL',     hint: 'below curve' };
    if (p >= 10) return { word: 'LOW',      hint: 'lower decile' };
    return            { word: 'MINIMAL',   hint: 'flatline' };
}

/** Map 0–100 to a tier 1–8 to label the result band. */
function tierIndex(p) {
    return Math.max(1, Math.min(8, Math.floor(p / 12.5) + 1));
}

/* ───────────────────────── background pieces ─────────────────────── */

/**
 * Paint the deep glassy background:
 *   1. Layered diagonal dark gradient.
 *   2. Soft accent radial glow biased to the avatar side.
 *   3. Cooler glow in the top-right for depth.
 *   4. Diagonal lattice (very low alpha) for premium texture.
 *   5. Top accent sweep + bottom vignette for focus.
 */
function paintBackground(ctx, accent) {
    // Base diagonal gradient
    const base = ctx.createLinearGradient(0, 0, W, H);
    base.addColorStop(0,   '#0d111d');
    base.addColorStop(0.5, '#0a0e1c');
    base.addColorStop(1,   '#05070f');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // Accent glow — left side, behind avatar
    const glow = ctx.createRadialGradient(260, H / 2 - 10, 30, 260, H / 2 - 10, 540);
    glow.addColorStop(0,    accent.rgba(0.55));
    glow.addColorStop(0.35, accent.rgba(0.16));
    glow.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Secondary cooler glow — top-right
    const glow2 = ctx.createRadialGradient(W - 80, 60, 40, W - 80, 60, 420);
    glow2.addColorStop(0, 'rgba(99,102,241,0.20)');
    glow2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, W, H);

    // Diagonal lattice
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.018)';
    ctx.lineWidth = 1;
    for (let i = -H; i < W + H; i += 36) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + H, H);
        ctx.stroke();
    }
    ctx.restore();

    // Top accent sweep — 3px highlight at the very top edge
    const sweep = ctx.createLinearGradient(0, 0, W, 0);
    sweep.addColorStop(0,    'rgba(0,0,0,0)');
    sweep.addColorStop(0.18, accent.rgba(0.32));
    sweep.addColorStop(0.62, accent.rgba(0.10));
    sweep.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, W, 3);

    // Bottom vignette
    const vig = ctx.createLinearGradient(0, H - 240, 0, H);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.46)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
}

/**
 * Big, faint "CALIBRATED" stamp diagonally across the card. Adds a
 * report/document feel without distracting from the data above.
 */
function paintWatermark(ctx, ui) {
    ctx.save();
    ctx.translate(W / 2 - 60, H / 2 + 90);
    ctx.rotate(-Math.PI / 30); // ~6° tilt
    ctx.font = ui.getBoldFont(96);
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    drawTracked(ctx, 'CALIBRATED', 0, 0, 16);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
}

/* ─────────────────────────── avatar ring ─────────────────────────── */

/**
 * Glassy avatar tile:
 *   halo glow → progress ring (track + filled arc) → avatar
 *   circle clipped → inner highlight stroke + glowing tip dot.
 */
async function drawAvatarBlock(ctx, avatarURL, cx, cy, radius, percent, accent) {
    const ringWidth = 16;
    const trackRadius = radius + ringWidth / 2 + 2;

    // Halo behind the ring
    const halo = ctx.createRadialGradient(cx, cy, radius - 4, cx, cy, radius + 80);
    halo.addColorStop(0, accent.rgba(0.45));
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 80, 0, Math.PI * 2);
    ctx.fill();

    // Background track
    ctx.beginPath();
    ctx.arc(cx, cy, trackRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = ringWidth;
    ctx.stroke();

    // Progress arc with gradient
    const start = -Math.PI / 2;
    const end = start + (Math.PI * 2 * percent) / 100;
    if (percent > 0) {
        const arcGrad = ctx.createLinearGradient(
            cx + Math.cos(start) * trackRadius,
            cy + Math.sin(start) * trackRadius,
            cx + Math.cos(end)   * trackRadius,
            cy + Math.sin(end)   * trackRadius,
        );
        arcGrad.addColorStop(0, accent.rgba(0.55));
        arcGrad.addColorStop(1, accent.hex);

        ctx.beginPath();
        ctx.arc(cx, cy, trackRadius, start, end);
        ctx.strokeStyle = arcGrad;
        ctx.lineWidth = ringWidth;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.lineCap = 'butt';

        // Glowing tip dot
        const tipX = cx + Math.cos(end) * trackRadius;
        const tipY = cy + Math.sin(end) * trackRadius;
        const dot = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, 22);
        dot.addColorStop(0,   '#ffffff');
        dot.addColorStop(0.4, accent.rgba(0.9));
        dot.addColorStop(1,   accent.rgba(0));
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(tipX, tipY, 22, 0, Math.PI * 2);
        ctx.fill();
    }

    // Tick marks at 25/50/75 around the ring
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (const pct of [25, 50, 75]) {
        const a = start + (Math.PI * 2 * pct) / 100;
        const tx1 = cx + Math.cos(a) * (trackRadius + ringWidth / 2 + 6);
        const ty1 = cy + Math.sin(a) * (trackRadius + ringWidth / 2 + 6);
        const tx2 = cx + Math.cos(a) * (trackRadius + ringWidth / 2 + 12);
        const ty2 = cy + Math.sin(a) * (trackRadius + ringWidth / 2 + 12);
        ctx.beginPath();
        ctx.moveTo(tx1, ty1);
        ctx.lineTo(tx2, ty2);
        ctx.strokeStyle = 'rgba(255,255,255,0.20)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    ctx.restore();

    // Avatar (clipped to circle) with placeholder fallback
    let img = null;
    try { img = await imageCache.loadWithCache(avatarURL, 8000).catch(() => null); } catch {}
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (img) {
        ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
    } else {
        const ph = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
        ph.addColorStop(0, '#1e2434');
        ph.addColorStop(1, '#0f131c');
        ctx.fillStyle = ph;
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
        ctx.fillStyle = '#374151';
        ctx.font = '600 64px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', cx, cy + 4);
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();

    // Inner highlight stroke for crispness
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

/* ─────────────────────────── progress bar ────────────────────────── */

/**
 * Modern segmented progress bar with a glow tip + tick labels under it.
 */
function drawProgressBar(ctx, ui, x, y, w, h, percent, accent) {
    // Track background
    roundedRect(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();

    // Track inner shadow
    ctx.save();
    roundedRect(ctx, x, y, w, h, h / 2);
    ctx.clip();
    const inner = ctx.createLinearGradient(0, y, 0, y + h);
    inner.addColorStop(0,   'rgba(0,0,0,0.35)');
    inner.addColorStop(0.4, 'rgba(0,0,0,0)');
    ctx.fillStyle = inner;
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    // Tick marks at 25 / 50 / 75
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    for (const pct of [25, 50, 75]) {
        const tx = x + (w * pct) / 100;
        ctx.fillRect(tx - 0.5, y + 4, 1, h - 8);
    }
    ctx.restore();

    // Fill
    const fillW = percent <= 0 ? 0 : Math.max(h, (w * percent) / 100);
    if (percent > 0) {
        ctx.save();
        roundedRect(ctx, x, y, fillW, h, h / 2);
        ctx.clip();
        const fillGrad = ctx.createLinearGradient(x, 0, x + w, 0);
        fillGrad.addColorStop(0,   accent.rgba(0.55));
        fillGrad.addColorStop(0.6, accent.rgba(0.95));
        fillGrad.addColorStop(1,   '#ffffff');
        ctx.fillStyle = fillGrad;
        ctx.fillRect(x, y, fillW, h);

        // Top-edge shine
        const shine = ctx.createLinearGradient(0, y, 0, y + h / 2);
        shine.addColorStop(0, 'rgba(255,255,255,0.30)');
        shine.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = shine;
        ctx.fillRect(x, y, fillW, h / 2);
        ctx.restore();

        // Tip glow
        const tipX = x + fillW;
        const tipGrad = ctx.createRadialGradient(tipX, y + h / 2, 0, tipX, y + h / 2, h * 1.6);
        tipGrad.addColorStop(0, accent.rgba(0.9));
        tipGrad.addColorStop(1, accent.rgba(0));
        ctx.fillStyle = tipGrad;
        ctx.fillRect(tipX - h, y - h, h * 2, h * 3);
    }

    // Tick labels under the bar (0/25/50/75/100)
    ctx.save();
    ctx.font = ui.getMediumFont(11);
    ctx.fillStyle = '#5a667a';
    ctx.textAlign = 'center';
    for (const pct of [0, 25, 50, 75, 100]) {
        const tx = x + (w * pct) / 100;
        ctx.fillText(String(pct), tx, y + h + 18);
    }
    ctx.textAlign = 'start';
    ctx.restore();
}

/* ─────────────────────────── card frame ──────────────────────────── */

function drawCardFrame(ctx, accent) {
    // Outer glassy edge — tinted with the accent for cohesion
    roundedRect(ctx, PAD / 2, PAD / 2, W - PAD, H - PAD, RADIUS);
    ctx.fillStyle = 'rgba(15,18,28,0.55)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = accent.rgba(0.35);
    ctx.stroke();

    // Inner highlight stroke for depth
    roundedRect(ctx, PAD / 2 + 1, PAD / 2 + 1, W - PAD - 2, H - PAD - 2, RADIUS - 1);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.stroke();

    // Header divider — thin accent strip running along the top of the
    // content area, just below the eyebrow row.
    const stripY = PAD / 2 + 70;
    const grad = ctx.createLinearGradient(PAD, stripY, W - PAD, stripY);
    grad.addColorStop(0,    'rgba(0,0,0,0)');
    grad.addColorStop(0.18, accent.rgba(0.3));
    grad.addColorStop(0.55, accent.rgba(0.05));
    grad.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(PAD, stripY, W - PAD * 2, 1);
}

/* ─────────────────────────── stat strip ──────────────────────────── */

/**
 * Render a row of small "stat" chips at the bottom of the card.
 * Each entry: { label, value, accent? }. Accent is optional — the
 * card's own accent is used by default.
 */
function drawStatStrip(ctx, ui, display, x, y, w, items, accent) {
    const gap = 12;
    const cardW = (w - gap * (items.length - 1)) / items.length;
    const cardH = 64;

    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const cx = x + i * (cardW + gap);

        // Card background
        roundedRect(ctx, cx, y, cardW, cardH, 12);
        ctx.fillStyle = 'rgba(20,24,40,0.85)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        roundedRect(ctx, cx, y, cardW, cardH, 12);
        ctx.stroke();

        // Accent left strip
        roundedRect(ctx, cx, y, 4, cardH, 2);
        ctx.fillStyle = (it.accent || accent).hex;
        ctx.fill();

        // Label (uppercase tracked, small)
        ctx.font = ui.getSemiBoldFont(10);
        ctx.fillStyle = '#7d8aa3';
        drawTracked(ctx, String(it.label).toUpperCase(), cx + 14, y + 22, 1.2);

        // Value (display weight)
        ctx.font = display.getBoldFont(20);
        ctx.fillStyle = '#ffffff';
        const v = String(it.value);
        const val = truncate(ctx, v, cardW - 24);
        ctx.fillText(val, cx + 14, y + 48);
    }
}

/* ─────────────────────────── public API ──────────────────────────── */

/**
 * Render a percentage card image.
 *
 * @param {object} opts
 * @param {string} opts.title       Card title (e.g. "How Gay?")
 * @param {string} opts.subjectName Display name shown next to avatar
 * @param {string} opts.avatarURL   Avatar URL of the subject
 * @param {number} opts.percent     0–100 (or any number when unit !== '%')
 * @param {string} opts.verdict     Short verdict line
 * @param {string} [opts.detail]    Optional second-line detail (smaller, muted)
 * @param {string} [opts.unit]      Suffix for the big value (default '%')
 * @param {string} [opts.brand]     Branding text in the corner (default 'xNico')
 * @param {string} [opts.tierLabel] Optional name for the result tier
 *                                  (e.g. "Cinnamon Roll", "Final Boss").
 *                                  Falls back to the auto-bucket label.
 * @param {number} [opts.barMax]    Override the bar's 100%-equivalent
 *                                  (e.g. 200 for IQ, 15 for /pp).
 * @returns {Promise<Buffer>} PNG buffer
 */
async function renderPercentCard(opts) {
    const {
        title,
        subjectName,
        avatarURL,
        percent,
        verdict,
        detail,
        unit = '%',
        brand = 'xNico',
        tierLabel,
        barMax = unit === '%' ? 100 : Math.max(100, Math.abs(Number(percent) || 0)),
    } = opts;

    const rawValue = Number(percent) || 0;
    // Bar/ring fill ratio — clamp to 0–100 even for non-percentage units (IQ etc.)
    const barFill = Math.max(0, Math.min(100, Math.round((rawValue / barMax) * 100)));
    // Hero number — just clamp to >= 0 and round
    const hero = Math.max(0, Math.round(rawValue));
    // Accent always grades against the visual fill (so a 60% IQ bar feels "amber")
    const accent = colorForPercent(barFill);

    const display = getFontHelpers('Outfit');
    const ui      = getFontHelpers('Inter');

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // ─── Layered background ───
    paintBackground(ctx, accent);
    paintWatermark(ctx, ui);
    drawCardFrame(ctx, accent);

    /* ───────────────────── HEADER ROW ─────────────────────
     * Eyebrow line (left): "REPORT · TITLE · TIER 5/8"
     * Brand chip (right): "xNico" with a colour dot.
     */
    const headerY = PAD / 2 + 40;
    ctx.font = ui.getSemiBoldFont(13);
    ctx.fillStyle = accent.rgba(0.85);
    ctx.textBaseline = 'alphabetic';
    const tier = tierIndex(barFill);
    const eyebrow = `REPORT · ${(title || '').toUpperCase()} · TIER ${tier}/8`;
    drawTracked(ctx, eyebrow, PAD, headerY, 1.6);

    // Subject name (display weight, big) — emoji-aware so usernames
    // with emojis render correctly.
    const nameX = PAD;
    const nameMaxW = W - PAD * 2 - 220;  // reserve space for the brand chip
    ctx.fillStyle = '#ffffff';
    ctx.font = display.getBoldFont(40);
    let name = subjectName || 'Unknown';
    while (measureMixedText(ctx, name, 40) > nameMaxW && name.length > 1) {
        name = name.slice(0, -1);
    }
    if (name !== (subjectName || 'Unknown')) name += '…';
    await drawTextWithEmoji(ctx, name, nameX, headerY + 38, 40);

    // Brand chip (top-right)
    {
        const brandText = (brand || 'xNico').toUpperCase();
        ctx.font = ui.getSemiBoldFont(12);
        const brandW = ctx.measureText(brandText).width;
        const dotR = 4;
        const padX = 14;
        const pillW = brandW + dotR * 2 + 10 + padX * 2;
        const pillH = 28;
        const pillX = W - PAD - pillW;
        const pillY = PAD / 2 + 28;
        roundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.10)';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(pillX + padX + dotR, pillY + pillH / 2, dotR, 0, Math.PI * 2);
        ctx.fillStyle = accent.hex;
        ctx.fill();

        ctx.fillStyle = '#9ca3af';
        ctx.textBaseline = 'middle';
        drawTracked(ctx, brandText, pillX + padX + dotR * 2 + 10, pillY + pillH / 2 + 1, 1.2);
        ctx.textBaseline = 'alphabetic';
    }

    /* ───────────────────── BODY ─────────────────────
     * Avatar (left) + hero column (right).
     */
    const avatarRadius = 110;
    const avatarCx = 178;
    const avatarCy = H / 2 + 6;
    await drawAvatarBlock(ctx, avatarURL, avatarCx, avatarCy, avatarRadius, barFill, accent);

    const colX = avatarCx + avatarRadius + 88;
    const colRight = W - PAD - 16;
    const colWidth = colRight - colX;

    // Hero percent — gradient text + drop shadow
    const valueText = `${hero}${unit}`;
    let heroSize = 132;
    ctx.font = display.getBoldFont(heroSize);
    while (ctx.measureText(valueText).width > colWidth - 160 && heroSize > 80) {
        heroSize -= 4;
        ctx.font = display.getBoldFont(heroSize);
    }
    const valueWidth = ctx.measureText(valueText).width;
    const heroY = 230;
    ctx.save();
    ctx.shadowColor = accent.rgba(0.55);
    ctx.shadowBlur = 28;
    const valueGrad = ctx.createLinearGradient(colX, heroY - heroSize, colX + valueWidth, heroY);
    valueGrad.addColorStop(0, '#ffffff');
    valueGrad.addColorStop(1, accent.hex);
    ctx.fillStyle = valueGrad;
    ctx.fillText(valueText, colX, heroY);
    ctx.restore();

    // "OUT OF X" helper next to the hero
    ctx.font = ui.getMediumFont(13);
    ctx.fillStyle = '#64748b';
    drawTracked(ctx, `OUT OF ${barMax}`, colX + valueWidth + 16, heroY - heroSize / 2 + 8, 1.6);

    // Tier label badge — sits just under the "OUT OF" helper.
    const autoTone = toneFor(barFill);
    const tierName = tierLabel || autoTone.word;
    {
        ctx.font = ui.getSemiBoldFont(12);
        const tn = tierName.toUpperCase();
        const tnW = ctx.measureText(tn).width + 22;
        const bx = colX + valueWidth + 16;
        const by = heroY - heroSize / 2 + 22;
        roundedRect(ctx, bx, by, tnW, 22, 11);
        ctx.fillStyle = accent.rgba(0.18);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = accent.rgba(0.45);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(tn, bx + 11, by + 12);
        ctx.textBaseline = 'alphabetic';
    }

    // Verdict line — display medium weight, quoted.
    if (verdict) {
        ctx.font = display.getMediumFont(22);
        ctx.fillStyle = '#dbe1ec';
        let verdictText = `\u201C${verdict}\u201D`;
        while (measureMixedText(ctx, verdictText, 22) > colWidth && verdictText.length > 2) {
            verdictText = verdictText.slice(0, -2) + '\u201D';
        }
        await drawTextWithEmoji(ctx, verdictText, colX, heroY + 38, 22);
    }

    // Optional detail line — slightly smaller and muted.
    if (detail) {
        ctx.font = ui.getMediumFont(14);
        ctx.fillStyle = '#7d8aa3';
        let detailText = String(detail);
        while (measureMixedText(ctx, detailText, 14) > colWidth && detailText.length > 4) {
            detailText = detailText.slice(0, -4) + '…';
        }
        await drawTextWithEmoji(ctx, detailText, colX, heroY + 68, 14);
    }

    /* ───────────────────── PROGRESS BAR + TICKS ─────────────────────
     * Spans the column under the hero block.
     */
    const barX = colX;
    const barY = heroY + 110;
    const barW = colWidth;
    const barH = 16;
    drawProgressBar(ctx, ui, barX, barY, barW, barH, barFill, accent);

    // Bar value chip aligned to the tip of the fill
    const tipX = Math.min(barX + barW - 8, barX + (barW * barFill) / 100);
    const chipText = `${hero}${unit}`;
    ctx.font = ui.getSemiBoldFont(12);
    const chipPadX = 10;
    const chipW = ctx.measureText(chipText).width + chipPadX * 2;
    const chipH = 22;
    const chipY = barY - chipH - 8;
    let chipX = Math.max(barX, tipX - chipW / 2);
    chipX = Math.min(chipX, barX + barW - chipW);
    roundedRect(ctx, chipX, chipY, chipW, chipH, chipH / 2);
    ctx.fillStyle = accent.rgba(0.18);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = accent.rgba(0.45);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(chipText, chipX + chipPadX, chipY + chipH / 2 + 1);
    ctx.textBaseline = 'alphabetic';

    /* ───────────────────── STAT STRIP ───────────────────── */
    const stripY = barY + barH + 40;
    drawStatStrip(ctx, ui, display, PAD + 8, stripY, W - PAD * 2 - 16, [
        { label: 'Tier',       value: `${tier}/8` },
        { label: 'Tone',       value: autoTone.word },
        { label: 'Bucket',     value: autoTone.hint },
        { label: 'Confidence', value: `${Math.min(99, 70 + Math.floor(barFill / 5))}%` },
    ], accent);

    return canvas.toBuffer('image/png');
}

module.exports = { renderPercentCard, colorForPercent, tierIndex, toneFor };
