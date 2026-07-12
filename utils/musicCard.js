'use strict';

/**
 * musicCard.js — professional, minimal "Now Playing" canvas card (900 × 300).
 *
 * Renders the live track as a clean album-style card: a square thumbnail on
 * the left and a right column with a NOW PLAYING / PAUSED label, the track
 * title, the artist, the requester (avatar + name), a slim progress bar with
 * position / duration timestamps, and a platform badge.
 *
 * Design philosophy (deliberately restrained — one layout, many skins):
 *   • Every style shares the SAME layout grid. Styles differ ONLY in the
 *     background treatment + text palette. This keeps the surface area tiny
 *     and the bug risk low.
 *   • Styles:
 *       default  → blurred thumbnail backdrop + dark scrim (album ambience)
 *       dark     → flat dark gradient
 *       light    → flat light gradient (dark text)
 *       vibrant  → platform-colour gradient
 *       minimal  → near-black flat with a thin accent rail
 *
 * The renderer NEVER throws: every external input (image loads, blur filter,
 * missing fields) is guarded so a music command can always fall back to the
 * text panel if a buffer can't be produced.
 */

const { createCanvas } = require('@napi-rs/canvas');
const imageCache = require('./imageCache');
const {
    drawRoundedRect, truncateText, fitText, rgba, getFontHelpers, getNicoLogo,
} = require('./canvasDesign');

const fh = getFontHelpers('Inter');

/* ─────────────────────────────────────────────────────────────
   PLATFORMS — canvas-friendly hex colours (musicPanel uses number
   colours for embeds, so we keep our own map here on purpose).
   ───────────────────────────────────────────────────────────── */

const PLATFORMS = {
    youtube:    { name: 'YouTube',     color: '#ff0000' },
    spotify:    { name: 'Spotify',     color: '#1db954' },
    soundcloud: { name: 'SoundCloud',  color: '#ff5500' },
    apple:      { name: 'Apple Music', color: '#fc3c44' },
    deezer:     { name: 'Deezer',      color: '#a238ff' },
    default:    { name: 'Music',       color: '#5865f2' },
};

function resolvePlatform(sourceName) {
    const s = String(sourceName || '').toLowerCase();
    if (s.includes('youtube')) return PLATFORMS.youtube;
    if (s.includes('spotify')) return PLATFORMS.spotify;
    if (s.includes('soundcloud')) return PLATFORMS.soundcloud;
    if (s.includes('apple')) return PLATFORMS.apple;
    if (s.includes('deezer')) return PLATFORMS.deezer;
    return PLATFORMS.default;
}

/** Format milliseconds → `m:ss` or `h:mm:ss`. */
function fmt(ms) {
    ms = Math.max(0, Number(ms) || 0);
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

/** Shade a hex colour: amt > 0 lightens, amt < 0 darkens. */
function shade(hex, amt) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
    if (!m) return hex;
    const adj = (c) => {
        const v = parseInt(c, 16) + amt;
        return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
    };
    return `#${adj(m[1])}${adj(m[2])}${adj(m[3])}`;
}

const STYLES = ['default', 'dark', 'light', 'vibrant', 'minimal'];

/** Resolve the palette for a given style + platform accent. */
function resolveTheme(style, accent) {
    const s = STYLES.includes(style) ? style : 'default';
    if (s === 'light') {
        return {
            style: s,
            text: '#14141a',
            muted: 'rgba(20,20,26,0.58)',
            faint: 'rgba(20,20,26,0.40)',
            track: 'rgba(20,20,26,0.12)',
            accent,
        };
    }
    return {
        style: s,
        text: '#ffffff',
        muted: 'rgba(255,255,255,0.62)',
        faint: 'rgba(255,255,255,0.42)',
        track: 'rgba(255,255,255,0.15)',
        accent,
    };
}

/* ─────────────────────────────────────────────────────────────
   Background painters — one per style. Each fills the already
   rounded-clipped canvas.
   ───────────────────────────────────────────────────────────── */

async function paintBackground(ctx, W, H, theme, accent, thumbImg) {
    const s = theme.style;

    if (s === 'light') {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#fafafc');
        g.addColorStop(1, '#e9e9f0');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        return;
    }

    if (s === 'dark') {
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#16161f');
        g.addColorStop(1, '#0c0c12');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        return;
    }

    if (s === 'minimal') {
        ctx.fillStyle = '#101015';
        ctx.fillRect(0, 0, W, H);
        // thin accent rail on the far left edge
        ctx.fillStyle = accent;
        ctx.fillRect(0, 0, 5, H);
        return;
    }

    if (s === 'vibrant') {
        const g = ctx.createLinearGradient(0, 0, W, H);
        g.addColorStop(0, shade(accent, -40));
        g.addColorStop(0.55, shade(accent, -120));
        g.addColorStop(1, '#0a0a0f');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        // subtle darkening scrim so white text always reads
        ctx.fillStyle = 'rgba(8,8,12,0.28)';
        ctx.fillRect(0, 0, W, H);
        return;
    }

    // default — blurred thumbnail backdrop + dark scrim
    // Base fill first (used when there is no artwork to blur).
    const base = ctx.createLinearGradient(0, 0, 0, H);
    base.addColorStop(0, '#181820');
    base.addColorStop(1, '#0b0b10');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    if (thumbImg) {
        ctx.save();
        try {
            // Blur is best-effort — not all canvas builds support ctx.filter.
            ctx.filter = 'blur(34px)';
        } catch { /* no-op */ }
        try {
            const scale = Math.max(W / thumbImg.width, H / thumbImg.height) * 1.2;
            const dw = thumbImg.width * scale;
            const dh = thumbImg.height * scale;
            ctx.globalAlpha = 0.55;
            ctx.drawImage(thumbImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
        } catch { /* ignore draw failures */ }
        ctx.restore();
    }

    // Dark scrim (left→right) keeps text legible over any artwork.
    const scrim = ctx.createLinearGradient(0, 0, W, 0);
    scrim.addColorStop(0, 'rgba(9,9,13,0.82)');
    scrim.addColorStop(0.5, 'rgba(9,9,13,0.74)');
    scrim.addColorStop(1, 'rgba(9,9,13,0.86)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, W, H);
}

/* ─────────────────────────────────────────────────────────────
   Thumbnail (left square) with rounded corners + accent border.
   ───────────────────────────────────────────────────────────── */

function drawThumbnail(ctx, img, x, y, size, accent, theme) {
    const radius = 18;

    // Soft drop shadow for separation.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = '#000000';
    drawRoundedRect(ctx, x, y, size, size, radius);
    ctx.fill();
    ctx.restore();

    ctx.save();
    drawRoundedRect(ctx, x, y, size, size, radius);
    ctx.clip();

    if (img) {
        const scale = Math.max(size / img.width, size / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh);
    } else {
        // Placeholder: accent gradient + music glyph.
        const g = ctx.createLinearGradient(x, y, x + size, y + size);
        g.addColorStop(0, shade(accent, -20));
        g.addColorStop(1, shade(accent, -90));
        ctx.fillStyle = g;
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = fh.getBoldFont(Math.round(size * 0.4));
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('\u266A', x + size / 2, y + size / 2 + 4);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();

    // Accent border ring.
    ctx.strokeStyle = rgba(accent, theme.style === 'light' ? 0.5 : 0.7);
    ctx.lineWidth = 2.5;
    drawRoundedRect(ctx, x + 1, y + 1, size - 2, size - 2, radius);
    ctx.stroke();
}

/* ─────────────────────────────────────────────────────────────
   Public renderer
   ───────────────────────────────────────────────────────────── */

/**
 * Render the Now Playing card.
 * @returns {Promise<Buffer|null>} PNG buffer, or null if rendering fails.
 */
async function renderNowPlayingCard(opts = {}) {
    try {
        const {
            title = 'Unknown Title',
            author = 'Unknown Artist',
            durationMs = 0,
            positionMs = 0,
            thumbnail = null,
            requesterName = null,
            requesterAvatar = null,
            sourceName = '',
            paused = false,
            isStream = false,
            style = 'default',
        } = opts;

        const W = 900, H = 300, PAD = 30;
        const platform = resolvePlatform(sourceName);
        const accent = platform.color;
        const theme = resolveTheme(style, accent);

        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');

        // Preload images (best-effort; never blocks rendering on failure).
        let thumbImg = null;
        if (thumbnail && /^https?:\/\//.test(thumbnail)) {
            thumbImg = await imageCache.loadWithCache(thumbnail, 5000).catch(() => null);
        }
        let avatarImg = null;
        if (requesterAvatar && /^https?:\/\//.test(requesterAvatar)) {
            avatarImg = await imageCache.loadWithCache(requesterAvatar, 5000).catch(() => null);
        }

        /* ── Background ── */
        ctx.save();
        drawRoundedRect(ctx, 0, 0, W, H, 22);
        ctx.clip();
        await paintBackground(ctx, W, H, theme, accent, thumbImg);

        // Subtle nico logo watermark (background, small) — like the rank card.
        // Drawn inside the clip and BEFORE the thumbnail/text so it always
        // sits behind the content and never collides with the timestamps.
        try {
            const logo = await getNicoLogo();
            if (logo) {
                const size = 150;
                const lx = W - size - 46;
                const ly = (H - size) / 2;
                ctx.save();
                ctx.globalAlpha = theme.style === 'light' ? 0.05 : 0.07;
                ctx.beginPath();
                ctx.arc(lx + size / 2, ly + size / 2, size / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(logo, lx, ly, size, size);
                ctx.restore();
            }
        } catch { /* watermark is decorative — never fail the render */ }

        ctx.restore();

        /* ── Thumbnail ── */
        const thumbSize = H - PAD * 2;               // 240
        const thumbX = PAD;
        const thumbY = PAD;
        drawThumbnail(ctx, thumbImg, thumbX, thumbY, thumbSize, accent, theme);

        /* ── Right column layout ── */
        const colX = thumbX + thumbSize + 34;        // 308
        const colRight = W - PAD;                     // 870
        const colW = colRight - colX;                 // 532

        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';

        /* Platform badge (top-right pill) */
        const badgeText = platform.name.toUpperCase();
        ctx.font = fh.getBoldFont(12);
        const badgeTextW = ctx.measureText(badgeText).width;
        const badgePadX = 12;
        const badgeH = 26;
        const badgeW = badgeTextW + badgePadX * 2;
        const badgeX = colRight - badgeW;
        const badgeY = PAD + 4;
        ctx.fillStyle = rgba(accent, theme.style === 'light' ? 0.16 : 0.24);
        drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
        ctx.fill();
        ctx.strokeStyle = rgba(accent, 0.7);
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
        ctx.stroke();
        ctx.fillStyle = theme.style === 'light' ? shade(accent, -30) : '#ffffff';
        ctx.fillText(badgeText, badgeX + badgePadX, badgeY + 17);

        /* NOW PLAYING / PAUSED label */
        const label = paused ? 'PAUSED' : (isStream ? 'LIVE NOW' : 'NOW PLAYING');
        ctx.font = fh.getBoldFont(13);
        ctx.fillStyle = accent;
        // small status dot
        const dotY = PAD + 12;
        ctx.beginPath();
        ctx.arc(colX + 4, dotY, 4, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.fillText(label, colX + 15, PAD + 17);

        /* Title (auto-fit, single line, keep clear of the badge on line 1) */
        const rawTitle = String(title || 'Unknown Title');
        const titleSize = fitText(ctx, rawTitle, colW, 34, 20); // sets bold font
        ctx.font = fh.getBoldFont(titleSize);
        ctx.fillStyle = theme.text;
        ctx.fillText(truncateText(ctx, rawTitle, colW), colX, PAD + 62);

        /* Artist */
        ctx.font = fh.getMediumFont(18);
        ctx.fillStyle = theme.muted;
        ctx.fillText(truncateText(ctx, `by ${author || 'Unknown Artist'}`, colW), colX, PAD + 92);

        /* Requester (avatar + name) */
        const reqY = PAD + 122;
        let reqTextX = colX;
        if (requesterName) {
            const av = 24;
            if (avatarImg) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(colX + av / 2, reqY, av / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(avatarImg, colX, reqY - av / 2, av, av);
                ctx.restore();
                ctx.strokeStyle = rgba(accent, 0.6);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(colX + av / 2, reqY, av / 2, 0, Math.PI * 2);
                ctx.stroke();
                reqTextX = colX + av + 10;
            }
            ctx.font = fh.getSemiBoldFont(14);
            ctx.fillStyle = theme.faint;
            ctx.textBaseline = 'middle';
            ctx.fillText(
                truncateText(ctx, `Requested by ${requesterName}`, colRight - reqTextX),
                reqTextX, reqY + 1,
            );
            ctx.textBaseline = 'alphabetic';
        }

        /* Progress bar / LIVE indicator (bottom anchor) */
        const barX = colX;
        const barW = colW;
        const barH = 8;
        const barY = H - PAD - 34;

        if (isStream || durationMs <= 0) {
            // LIVE: full accent bar + label
            ctx.fillStyle = theme.track;
            drawRoundedRect(ctx, barX, barY, barW, barH, barH / 2);
            ctx.fill();
            ctx.fillStyle = accent;
            drawRoundedRect(ctx, barX, barY, barW, barH, barH / 2);
            ctx.fill();
            ctx.font = fh.getBoldFont(13);
            ctx.fillStyle = accent;
            ctx.fillText('\u25CF LIVE', barX, barY + barH + 20);
        } else {
            const progress = Math.min(Math.max(positionMs / durationMs, 0), 1);

            // Track
            ctx.fillStyle = theme.track;
            drawRoundedRect(ctx, barX, barY, barW, barH, barH / 2);
            ctx.fill();

            // Fill (clipped gradient)
            const fillW = Math.max(barW * progress, progress > 0 ? barH : 0);
            if (fillW > 0) {
                ctx.save();
                drawRoundedRect(ctx, barX, barY, barW, barH, barH / 2);
                ctx.clip();
                const fg = ctx.createLinearGradient(barX, 0, barX + barW, 0);
                fg.addColorStop(0, shade(accent, 30));
                fg.addColorStop(1, accent);
                ctx.fillStyle = fg;
                drawRoundedRect(ctx, barX, barY, fillW, barH, barH / 2);
                ctx.fill();
                ctx.restore();

                // Playhead knob
                const knobX = Math.min(barX + fillW, barX + barW);
                ctx.beginPath();
                ctx.arc(knobX, barY + barH / 2, 7, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.strokeStyle = rgba(accent, 0.9);
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            // Timestamps below the bar (position left, duration right)
            ctx.font = fh.getSemiBoldFont(13);
            ctx.fillStyle = theme.muted;
            ctx.fillText(fmt(positionMs), barX, barY + barH + 20);
            ctx.textAlign = 'right';
            ctx.fillText(fmt(durationMs), colRight, barY + barH + 20);
            ctx.textAlign = 'left';
        }

        /* Outer hairline border */
        ctx.strokeStyle = rgba(accent, theme.style === 'light' ? 0.22 : 0.2);
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, 0.75, 0.75, W - 1.5, H - 1.5, 22);
        ctx.stroke();

        return canvas.toBuffer('image/png');
    } catch {
        // Never let a render failure bubble into a command — callers
        // gracefully fall back to the text panel when this returns null.
        return null;
    }
}

/**
 * Build renderNowPlayingCard() options from a Lavalink player. Keeps the
 * data-shaping in one place so nowplaying + musiccard stay in sync.
 * @param {object} player Lavalink player (must have queue.current)
 * @param {string} [style]
 * @returns {object|null} options for renderNowPlayingCard, or null if no track
 */
function cardOptionsFromPlayer(player, style = 'default') {
    const track = player?.queue?.current;
    if (!track?.info) return null;
    const info = track.info;
    const requester = track.requester || {};
    return {
        title: info.title,
        author: info.author,
        durationMs: info.duration || 0,
        positionMs: player.position || 0,
        thumbnail: info.artworkUrl || info.thumbnail || null,
        requesterName: requester.username || requester.globalName || null,
        requesterAvatar: requester.avatar || null,
        sourceName: info.sourceName,
        paused: !!player.paused,
        isStream: !!info.isStream || (info.duration || 0) <= 0,
        style,
    };
}

module.exports = {
    renderNowPlayingCard,
    cardOptionsFromPlayer,
    STYLES,
    PLATFORMS,
};
