'use strict';

/**
 * levelCard.js — clean, ProBot-style rank card (900 × 270).
 *
 * Design principles (deliberately restrained):
 *   • ONE background treatment — a flat vertical gradient (+ optional
 *     user background image with a single dark overlay). No stacked
 *     vignette + glow + lattice + gradient noise.
 *   • A strict layout grid: left column = avatar, right column =
 *     everything else, all sharing a consistent left edge and
 *     baseline rhythm so nothing looks "floated".
 *   • Stats live on a single baseline row, not in heavy glassy boxes.
 *   • The progress bar is the visual anchor at the bottom, full width
 *     of the content column, with the XP figures sitting directly
 *     above its right edge.
 *
 * Layout
 * ──────
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │                                                                │
 *   │   ⬭          Username                          RANK #5         │
 *   │  avatar      @username                         LEVEL 42        │
 *   │  (160)                                                         │
 *   │              Messages 1,284   ·   Voice 12h 34m               │
 *   │                                                                │
 *   │              62,300 / 100,000 XP                       62%     │
 *   │              ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░         │
 *   └────────────────────────────────────────────────────────────────┘
 */

const { createCanvas } = require('@napi-rs/canvas');
const imageCache = require('./imageCache');
const {
    DESIGN, drawRoundedRect, drawText, truncateText, fitText,
    drawProgressBar, formatNumber, rgba,
    getFontHelpers, drawNicoBranding, normalizeCanvasText,
} = require('./canvasDesign');

// Restrained palette — a base background + a single accent the user
// can override. No secondary "neon" accent stacking.
const STYLE_THEMES = {
    default: { bg: '#1e1f22', accent: '#5865f2', text: '#ffffff' },
    minimal: { bg: '#18191c', accent: '#b5bac1', text: '#ffffff' },
    neon:    { bg: '#0f0f1c', accent: '#a855f7', text: '#f5f3ff' },
    classic: { bg: '#1a2030', accent: '#5865f2', text: '#e8eaf0' },
    modern:  { bg: '#101012', accent: '#3ba55d', text: '#f2f3f5' },
};

class LevelCard {
    constructor() {
        this.width = 900;
        this.height = 290;
        this.backgroundColor = '#1e1f22';
        this.accentColor = '#5865f2';
        this.textColor = '#ffffff';
        this.progressBarColor = this.accentColor;
        this.backgroundImage = null;
        this.bannerImage = null;
        this.bannerMode = 'strip';   // 'strip' = top band · 'full' = whole-card background
        this.backgroundOpacity = 0.45;
        this.bio = null;
        this.cardStyle = 'default';
        this.fontFamily = 'Inter';
        this._fh = getFontHelpers('Inter');
    }

    /* ─────────── chainable setters ─────────── */
    setFontFamily(family)       { this.fontFamily = family || 'Inter'; this._fh = getFontHelpers(this.fontFamily); return this; }
    setBackground(c)            { this.backgroundColor = c; return this; }
    setBackgroundImage(url)     { this.backgroundImage = url; return this; }
    setBannerImage(url)         { this.bannerImage = url; return this; }
    setBannerMode(mode)         { this.bannerMode = (mode === 'full') ? 'full' : 'strip'; return this; }
    setProgressBarColor(c)      { this.progressBarColor = c; this.accentColor = c; return this; }
    setAccentColor(c)           { this.accentColor = c; return this; }
    setTextColor(c)             { this.textColor = c; return this; }
    setBio(b)                   { this.bio = b; return this; }
    setBackgroundOpacity(o)     { this.backgroundOpacity = Math.max(0, Math.min(1, o)); return this; }
    setCardStyle(style) {
        this.cardStyle = style || 'default';
        const t = STYLE_THEMES[this.cardStyle.toLowerCase()] || STYLE_THEMES.default;
        if (!this.backgroundImage) this.backgroundColor = t.bg;
        this.accentColor = t.accent;
        this.progressBarColor = t.accent;
        this.textColor = t.text;
        return this;
    }

    /* ─────────── per-family fonts ─────────── */
    _font(s)     { return this._fh.getFont(s); }
    _medium(s)   { return this._fh.getMediumFont(s); }
    _semi(s)     { return this._fh.getSemiBoldFont(s); }
    _bold(s)     { return this._fh.getBoldFont(s); }

    async generate(user, data = {}) {
        const W = this.width, H = this.height;

        data = {
            level: 1, rank: 0, xpProgress: 0, xpNeeded: 100,
            totalXp: 0, messagesCount: 0, voiceTime: 0, ...data,
        };
        for (const k of ['level','rank','xpProgress','xpNeeded','totalXp','messagesCount','voiceTime']) {
            data[k] = Number(data[k]) || 0;
        }

        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');

        const BANNER_H = 92;   // top strip for the optional banner image

        // Resolve which image fills the whole card vs. the top strip.
        //   • bannerMode 'full' + a banner → banner becomes the full bg.
        //   • otherwise the custom background (if any) fills the card and
        //     the banner (if any) is drawn as a top strip.
        const bannerIsFull = this.bannerImage && this.bannerMode === 'full';
        const fullBgImage  = bannerIsFull ? this.bannerImage : this.backgroundImage;
        const stripBanner  = (this.bannerImage && !bannerIsFull) ? this.bannerImage : null;

        /* ── 1. Background (single, clean treatment) ── */
        ctx.save();
        drawRoundedRect(ctx, 0, 0, W, H, 20);
        ctx.clip();

        // Flat vertical gradient base.
        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, this._lighten(this.backgroundColor, 6));
        bgGrad.addColorStop(1, this.backgroundColor);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // Full-card background image — drawn at the user's chosen
        // opacity, then a SINGLE light readability scrim (not a heavy
        // 0.62 cover on top of an already-dimmed image). This is why
        // backgrounds looked invisible before.
        if (fullBgImage) {
            try {
                const bg = await imageCache.loadWithCache(fullBgImage, 5000);
                if (bg) {
                    // A full banner reads as a deliberate cover image, so
                    // show it close to full strength; a plain background
                    // honours the user's opacity slider.
                    ctx.globalAlpha = bannerIsFull ? 1 : Math.max(0.5, this.backgroundOpacity);
                    const scale = Math.max(W / bg.width, H / bg.height);
                    const ix = (W - bg.width * scale) / 2;
                    const iy = (H - bg.height * scale) / 2;
                    ctx.drawImage(bg, ix, iy, bg.width * scale, bg.height * scale);
                    ctx.globalAlpha = 1;
                    // Light gradient scrim — darker at the bottom where
                    // the stats + bar sit, lighter at the top.
                    const scrim = ctx.createLinearGradient(0, 0, 0, H);
                    scrim.addColorStop(0, bannerIsFull ? 'rgba(15,15,20,0.40)' : 'rgba(15,15,20,0.30)');
                    scrim.addColorStop(1, bannerIsFull ? 'rgba(15,15,20,0.74)' : 'rgba(15,15,20,0.55)');
                    ctx.fillStyle = scrim;
                    ctx.fillRect(0, 0, W, H);
                }
            } catch {}
        }

        // Banner strip — a separate top image (Discord-profile style).
        // Sits above the background, only across the header band, and
        // fades into the card so the avatar reads cleanly over it.
        if (stripBanner) {
            try {
                const banner = await imageCache.loadWithCache(stripBanner, 5000);
                if (banner) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(0, 0, W, BANNER_H);
                    ctx.clip();
                    const scale = Math.max(W / banner.width, BANNER_H / banner.height);
                    const ix = (W - banner.width * scale) / 2;
                    const iy = (BANNER_H - banner.height * scale) / 2;
                    ctx.drawImage(banner, ix, iy, banner.width * scale, banner.height * scale);
                    // Fade the banner into the card body at its base.
                    const fade = ctx.createLinearGradient(0, 0, 0, BANNER_H);
                    fade.addColorStop(0, 'rgba(0,0,0,0.10)');
                    fade.addColorStop(0.7, 'rgba(0,0,0,0.0)');
                    fade.addColorStop(1, this._rgba(this.backgroundColor, 0.85));
                    ctx.fillStyle = fade;
                    ctx.fillRect(0, 0, W, BANNER_H);
                    ctx.restore();
                    // Thin accent divider under the banner.
                    ctx.fillStyle = rgba(this.accentColor, 0.6);
                    ctx.fillRect(0, BANNER_H - 2, W, 2);
                }
            } catch {}
        }

        // One quiet accent band along the very bottom edge.
        ctx.fillStyle = rgba(this.accentColor, 0.9);
        ctx.fillRect(0, H - 4, W, 4);

        ctx.restore();

        /* ── Layout grid ── */
        const PAD = 36;
        const avatarSize = 132;
        const avatarX = PAD;
        // When a strip banner is present the avatar overlaps it (Discord
        // style); otherwise it sits vertically centered in the upper area.
        const avatarY = stripBanner
            ? BANNER_H - avatarSize / 2
            : 28;
        const contentX = avatarX + avatarSize + 30;   // shared left edge for all text
        const contentRight = W - PAD;

        /* ── 2. Avatar (simple solid ring, no halo spam) ── */
        let avatar = null;
        try {
            avatar = await imageCache.loadWithCache(
                user.displayAvatarURL({ extension: 'png', size: 256 }),
                5000
            );
        } catch {}
        await this._drawAvatar(ctx, avatar, avatarX, avatarY, avatarSize);

        /* ── 3. Right cluster: RANK + LEVEL as clean text ── */
        // ProBot renders these as plain right-aligned text, big numbers
        // with small grey labels. No heavy pills.
        const clusterTop = avatarY + 6;
        ctx.textAlign = 'right';

        // RANK
        let cursorRight = contentRight;
        const rankNum = data.rank > 0 ? `#${formatNumber(data.rank)}` : '#—';
        const levelNum = String(data.level);

        // Measure both number widths at the headline size so labels align.
        ctx.font = this._bold(34);
        const rankNumW = ctx.measureText(rankNum).width;
        const levelNumW = ctx.measureText(levelNum).width;

        // LEVEL block (rightmost), RANK block to its left.
        const blockGap = 26;
        // value baseline
        const valueBaseline = clusterTop + 30;
        const labelBaseline = clusterTop + 48;

        // LEVEL value (accent)
        ctx.font = this._bold(34);
        ctx.fillStyle = this.accentColor;
        ctx.fillText(levelNum, contentRight, valueBaseline);
        // LEVEL label
        ctx.font = this._semi(13);
        ctx.fillStyle = DESIGN.colors.textMuted;
        ctx.fillText('LEVEL', contentRight, labelBaseline);

        // RANK value (white) — positioned left of the LEVEL block
        const levelBlockW = Math.max(levelNumW, ctx.measureText('LEVEL').width);
        const rankRight = contentRight - levelBlockW - blockGap;
        ctx.font = this._bold(34);
        ctx.fillStyle = this.textColor;
        ctx.fillText(rankNum, rankRight, valueBaseline);
        ctx.font = this._semi(13);
        ctx.fillStyle = DESIGN.colors.textMuted;
        ctx.fillText('RANK', rankRight, labelBaseline);

        ctx.textAlign = 'left';

        /* ── 4. Username + handle (left, shares contentX) ── */
        // Keep clear of the rank/level cluster on the right.
        const rankBlockLeft = rankRight - Math.max(rankNumW, ctx.measureText('RANK').width);
        const nameMaxW = rankBlockLeft - contentX - 24;

        const rawName = normalizeCanvasText(String(user.globalName || user.username));
        const nameSize = fitText(ctx, rawName, nameMaxW, 32, 20);
        ctx.font = this._bold(nameSize);
        ctx.fillStyle = this.textColor;
        await drawText(ctx, truncateText(ctx, rawName, nameMaxW), contentX, clusterTop + 26);

        ctx.font = this._medium(15);
        ctx.fillStyle = DESIGN.colors.textMuted;
        await drawText(ctx, truncateText(ctx, `@${user.username}`, nameMaxW), contentX, clusterTop + 50);

        /* ── 5. Secondary stats — single baseline row, aligned to the
               avatar's lower third so the card fills evenly ── */
        const statRowY = avatarY + avatarSize - 6;
        const statParts = [
            { label: 'Messages', value: formatNumber(data.messagesCount) },
            { label: 'Voice',    value: this._formatVoice(data.voiceTime) },
            { label: 'Total XP', value: formatNumber(data.totalXp) },
        ];
        let sx = contentX;
        for (let i = 0; i < statParts.length; i++) {
            const part = statParts[i];
            // label (muted)
            ctx.font = this._medium(13);
            ctx.fillStyle = DESIGN.colors.textMuted;
            ctx.fillText(part.label, sx, statRowY);
            const labelW = ctx.measureText(part.label).width;
            // value (white, bold)
            ctx.font = this._semi(13);
            ctx.fillStyle = this.textColor;
            const valX = sx + labelW + 8;
            ctx.fillText(part.value, valX, statRowY);
            const valW = ctx.measureText(part.value).width;
            sx = valX + valW + 24;
            // separator dot
            if (i < statParts.length - 1) {
                ctx.fillStyle = DESIGN.colors.textDim;
                ctx.fillText('·', sx - 14, statRowY);
            }
        }

        /* ── 6. XP progress bar (the bottom anchor, full width) ── */
        const barX = PAD;
        const barW = contentRight - PAD;
        const barH = 22;
        const barY = H - 52;

        // XP figures sit directly above the bar, left + right aligned.
        const progress = data.xpNeeded > 0 ? Math.min(data.xpProgress / data.xpNeeded, 1) : 0;

        ctx.font = this._semi(13);
        ctx.fillStyle = this.textColor;
        ctx.textAlign = 'left';
        ctx.fillText(`${formatNumber(data.xpProgress)} / ${formatNumber(data.xpNeeded)} XP`, barX, barY - 9);

        ctx.fillStyle = DESIGN.colors.textMuted;
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(progress * 100)}%`, barX + barW, barY - 9);
        ctx.textAlign = 'left';

        drawProgressBar(ctx, barX, barY, barW, barH, progress, this.accentColor, this.accentColor);

        /* ── 7. Outer hairline border ── */
        ctx.strokeStyle = rgba(this.accentColor, 0.18);
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, 0.75, 0.75, W - 1.5, H - 1.5, 20);
        ctx.stroke();

        await drawNicoBranding(ctx, W, H, this.accentColor);

        return canvas.toBuffer('image/png');
    }

    /* ─────────── helpers ─────────── */

    // Clean avatar: solid background ring + thin accent ring. No
    // multi-layer halo (that's what made it look "AI").
    async _drawAvatar(ctx, avatar, x, y, size) {
        const cx = x + size / 2;
        const cy = y + size / 2;
        const r = size / 2;

        // Separation ring against the background
        ctx.fillStyle = rgba('#000000', 0.25);
        ctx.beginPath();
        ctx.arc(cx, cy, r + 5, 0, Math.PI * 2);
        ctx.fill();

        if (avatar) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(avatar, x, y, size, size);
            ctx.restore();
        } else {
            ctx.fillStyle = rgba(this.accentColor, 0.3);
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
        }

        // Single accent ring
        ctx.strokeStyle = this.accentColor;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
        ctx.stroke();
    }

    _formatVoice(seconds) {
        seconds = Math.max(0, Number(seconds) || 0);
        if (seconds < 60) return `${seconds}s`;
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h >= 1) return m > 0 ? `${h}h ${m}m` : `${h}h`;
        return `${m}m`;
    }

    // Lighten a hex colour by `amt` (0-100) for the gradient top.
    _lighten(hex, amt) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
        if (!m) return hex;
        const adj = (c) => Math.min(255, parseInt(c, 16) + Math.round(amt * 2.55));
        const r = adj(m[1]).toString(16).padStart(2, '0');
        const g = adj(m[2]).toString(16).padStart(2, '0');
        const b = adj(m[3]).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`;
    }

    // rgba() string from a hex + alpha (used by the banner fade).
    _rgba(hex, a) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
        if (!m) return `rgba(30,31,34,${a})`;
        return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
    }
}

module.exports = LevelCard;
