'use strict';

/**
 * profileCard.js — clean 934×520 user profile card.
 *
 * Restrained redesign (single flat gradient, no stacked glow/lattice/
 * halo, flat stat panels). Sections, top → bottom:
 *   • Slim accent banner strip behind the header.
 *   • Avatar (single ring) + name + handle.
 *   • RANK + LEVEL as plain right-aligned text.
 *   • EXPERIENCE bar (full width).
 *   • Four flat stat panels: Messages / Voice / Reputation / Balance.
 *   • Badge strip.
 *   • Bio + ID footer.
 */

const { createCanvas } = require('@napi-rs/canvas');
const imageCache = require('./imageCache');
const {
    DESIGN, drawRoundedRect, drawText, truncateText, fitText,
    drawProgressBar, formatNumber, formatVoiceTime, rgba,
    getFontHelpers, drawNicoBranding, normalizeCanvasText,
} = require('./canvasDesign');

// Restrained palette — base bg + a single accent.
const STYLE_THEMES = {
    default: { bg: '#1e1f22', accent: '#5865f2', text: '#ffffff' },
    minimal: { bg: '#18191c', accent: '#b5bac1', text: '#ffffff' },
    neon:    { bg: '#0f0f1c', accent: '#a855f7', text: '#f5f3ff' },
    classic: { bg: '#1a2030', accent: '#5865f2', text: '#e8eaf0' },
    modern:  { bg: '#101012', accent: '#3ba55d', text: '#f2f3f5' },
};

const STAT_DEFS = [
    { key: 'messageCount', label: 'Messages',   color: '#5865f2', fmt: formatNumber },
    { key: 'voiceTime',    label: 'Voice Time', color: '#a855f7', fmt: formatVoiceTime },
    { key: 'reputation',   label: 'Reputation', color: '#fbbf24', fmt: (v) => String(v) },
    { key: 'balance',      label: 'Balance',    color: '#3ba55d', fmt: formatNumber },
];

class ProfileCard {
    constructor() {
        this.width = 934;
        this.height = 520;
        this.backgroundColor = '#1e1f22';
        this.accentColor = '#5865f2';
        this.textColor = '#ffffff';
        this.backgroundImage = null;
        this.bannerImage = null;
        this.bannerMode = 'strip';   // 'strip' = header band · 'full' = whole-card background
        this.backgroundOpacity = 0.45;
        this.cardStyle = 'default';
        this.fontFamily = 'Inter';
        this._fh = getFontHelpers('Inter');
    }

    setFontFamily(family)       { this.fontFamily = family || 'Inter'; this._fh = getFontHelpers(this.fontFamily); return this; }
    setBackground(c)            { this.backgroundColor = c; return this; }
    setBackgroundImage(url)     { this.backgroundImage = url; return this; }
    setBannerImage(url)         { this.bannerImage = url; return this; }
    setBannerMode(mode)         { this.bannerMode = (mode === 'full') ? 'full' : 'strip'; return this; }
    setAccentColor(c)           { this.accentColor = c; return this; }
    setTextColor(c)             { this.textColor = c; return this; }
    setBackgroundOpacity(o)     { this.backgroundOpacity = Math.max(0, Math.min(1, o)); return this; }
    setCardStyle(style) {
        this.cardStyle = style || 'default';
        const t = STYLE_THEMES[this.cardStyle.toLowerCase()] || STYLE_THEMES.default;
        if (!this.backgroundImage) this.backgroundColor = t.bg;
        this.accentColor = t.accent;
        this.textColor = t.text;
        return this;
    }

    _font(s)   { return this._fh.getFont(s); }
    _medium(s) { return this._fh.getMediumFont(s); }
    _semi(s)   { return this._fh.getSemiBoldFont(s); }
    _bold(s)   { return this._fh.getBoldFont(s); }

    async generate(user, data = {}) {
        const W = this.width, H = this.height, PAD = 36;

        data = {
            reputation: 0, level: 1, totalXp: 0, currentXp: 0, requiredXp: 100,
            commandsUsed: 0, messageCount: 0, voiceTime: 0, rank: 0, balance: 0,
            bio: '', customBadges: [], ...data,
        };
        for (const k of ['reputation','level','totalXp','currentXp','requiredXp','commandsUsed','messageCount','voiceTime','rank','balance']) {
            data[k] = Number(data[k]) || 0;
        }
        data.bio = data.bio ? String(data.bio) : '';

        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');
        const accent = this.accentColor;
        const bannerH = 120;

        // Resolve which image fills the whole card vs. the header strip.
        const bannerIsFull = this.bannerImage && this.bannerMode === 'full';
        const fullBgImage  = bannerIsFull ? this.bannerImage : this.backgroundImage;
        const stripBanner  = (this.bannerImage && !bannerIsFull) ? this.bannerImage : null;

        /* ── 1. Background (single flat gradient) ── */
        ctx.save();
        drawRoundedRect(ctx, 0, 0, W, H, 20);
        ctx.clip();
        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, this._lighten(this.backgroundColor, 6));
        bgGrad.addColorStop(1, this.backgroundColor);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // Full-card background image — full strength + a single light
        // gradient scrim (not a heavy flat 0.66 cover) so the user's
        // image is actually visible while text stays legible.
        if (fullBgImage) {
            try {
                const bg = await imageCache.loadWithCache(fullBgImage, 5000);
                if (bg) {
                    ctx.globalAlpha = bannerIsFull ? 1 : Math.max(0.5, this.backgroundOpacity);
                    const scale = Math.max(W / bg.width, H / bg.height);
                    const ix = (W - bg.width * scale) / 2;
                    const iy = (H - bg.height * scale) / 2;
                    ctx.drawImage(bg, ix, iy, bg.width * scale, bg.height * scale);
                    ctx.globalAlpha = 1;
                    const scrim = ctx.createLinearGradient(0, 0, 0, H);
                    scrim.addColorStop(0, 'rgba(15,15,20,0.35)');
                    scrim.addColorStop(0.55, 'rgba(15,15,20,0.50)');
                    scrim.addColorStop(1, 'rgba(15,15,20,0.70)');
                    ctx.fillStyle = scrim;
                    ctx.fillRect(0, 0, W, H);
                }
            } catch {}
        }

        // Banner: a real image strip across the header (Discord style).
        // Falls back to a slim accent tint band when no banner is set.
        if (stripBanner) {
            try {
                const banner = await imageCache.loadWithCache(stripBanner, 5000);
                if (banner) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(0, 0, W, bannerH);
                    ctx.clip();
                    const scale = Math.max(W / banner.width, bannerH / banner.height);
                    const ix = (W - banner.width * scale) / 2;
                    const iy = (bannerH - banner.height * scale) / 2;
                    ctx.drawImage(banner, ix, iy, banner.width * scale, banner.height * scale);
                    // Fade banner into the card body.
                    const fade = ctx.createLinearGradient(0, 0, 0, bannerH);
                    fade.addColorStop(0, 'rgba(0,0,0,0.12)');
                    fade.addColorStop(0.65, 'rgba(0,0,0,0.0)');
                    fade.addColorStop(1, this._rgba(this.backgroundColor, 0.9));
                    ctx.fillStyle = fade;
                    ctx.fillRect(0, 0, W, bannerH);
                    ctx.restore();
                    ctx.fillStyle = rgba(accent, 0.6);
                    ctx.fillRect(0, bannerH - 2, W, 2);
                }
            } catch {}
        } else if (!fullBgImage) {
            // Slim accent banner strip behind the header (only when there's
            // no full-card image already providing the header backdrop).
            ctx.fillStyle = rgba(accent, 0.16);
            ctx.fillRect(0, 0, W, bannerH);
        }

        ctx.fillStyle = rgba(accent, 0.9);
        ctx.fillRect(0, H - 4, W, 4);
        ctx.restore();

        /* ── 2. Avatar (single ring, overlaps banner) ── */
        const avatarSize = 140;
        const avatarX = PAD;
        const avatarY = bannerH - avatarSize / 2;
        const cx = avatarX + avatarSize / 2, cy = avatarY + avatarSize / 2;

        ctx.fillStyle = this.backgroundColor;
        ctx.beginPath();
        ctx.arc(cx, cy, avatarSize / 2 + 6, 0, Math.PI * 2);
        ctx.fill();
        try {
            const avatar = await imageCache.loadWithCache(
                user.displayAvatarURL({ extension: 'png', size: 512 }), 5000
            );
            if (avatar) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, avatarSize / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
                ctx.restore();
            } else {
                ctx.fillStyle = rgba(accent, 0.3);
                ctx.beginPath();
                ctx.arc(cx, cy, avatarSize / 2, 0, Math.PI * 2);
                ctx.fill();
            }
        } catch {}
        ctx.strokeStyle = accent;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, avatarSize / 2 + 2.5, 0, Math.PI * 2);
        ctx.stroke();

        // Status dot
        const sX = cx + avatarSize / 2 * Math.cos(Math.PI / 4);
        const sY = cy + avatarSize / 2 * Math.sin(Math.PI / 4);
        ctx.beginPath();
        ctx.arc(sX, sY, 13, 0, Math.PI * 2);
        ctx.fillStyle = this.backgroundColor;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sX, sY, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#3ba55d';
        ctx.fill();

        /* ── 3. RANK + LEVEL (plain right-aligned text, top-right) ── */
        const clusterY = 30;
        ctx.textAlign = 'right';
        const levelStr = String(data.level);
        const rankStr = data.rank > 0 ? `#${formatNumber(data.rank)}` : '#—';

        ctx.font = this._bold(32);
        ctx.fillStyle = accent;
        ctx.fillText(levelStr, W - PAD, clusterY + 28);
        ctx.font = this._semi(12);
        ctx.fillStyle = DESIGN.colors.textMuted;
        ctx.fillText('LEVEL', W - PAD, clusterY + 46);
        const levelBlockW = Math.max(
            ctx.measureText('LEVEL').width,
            (ctx.font = this._bold(32), ctx.measureText(levelStr).width)
        );

        const rankRight = W - PAD - levelBlockW - 26;
        ctx.font = this._bold(32);
        ctx.fillStyle = this.textColor;
        ctx.fillText(rankStr, rankRight, clusterY + 28);
        ctx.font = this._semi(12);
        ctx.fillStyle = DESIGN.colors.textMuted;
        ctx.fillText('RANK', rankRight, clusterY + 46);
        ctx.textAlign = 'left';

        /* ── 4. Name + handle (below avatar) ── */
        const infoX = avatarX + avatarSize + 26;
        const infoY = avatarY + 52;
        const nameMaxW = W - PAD - 220 - infoX;

        const rawName = normalizeCanvasText(String(user.globalName || user.username));
        const nameSize = fitText(ctx, rawName, nameMaxW, 30, 20);
        ctx.font = this._bold(nameSize);
        ctx.fillStyle = this.textColor;
        await drawText(ctx, truncateText(ctx, rawName, nameMaxW), infoX, infoY);

        ctx.font = this._medium(15);
        ctx.fillStyle = DESIGN.colors.textMuted;
        await drawText(ctx, `@${user.username}`, infoX, infoY + 24);

        /* ── 5. XP bar ── */
        const progY = avatarY + avatarSize + 26;
        const progX = PAD;
        const progW = W - PAD * 2;
        const progH = 18;

        ctx.font = this._semi(12);
        ctx.fillStyle = DESIGN.colors.textMuted;
        ctx.fillText('EXPERIENCE', progX, progY - 9);
        const xpText = `${formatNumber(data.currentXp)} / ${formatNumber(data.requiredXp)} XP`;
        ctx.textAlign = 'right';
        ctx.fillStyle = this.textColor;
        ctx.fillText(xpText, progX + progW, progY - 9);
        ctx.textAlign = 'left';

        const pct = data.requiredXp > 0 ? Math.min(data.currentXp / data.requiredXp, 1) : 0;
        drawProgressBar(ctx, progX, progY, progW, progH, pct, accent, accent);
        ctx.font = this._bold(10);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(pct * 100)}%`, progX + progW / 2, progY + progH / 2 + 3.5);
        ctx.textAlign = 'left';

        /* ── 6. Flat stat panels ── */
        const statsY = progY + progH + 26;
        const gap = 12;
        const statW = (W - PAD * 2 - gap * 3) / 4;
        const statH = 70;
        STAT_DEFS.forEach((def, i) => {
            const x = PAD + i * (statW + gap);
            drawRoundedRect(ctx, x, statsY, statW, statH, 12);
            ctx.fillStyle = 'rgba(0,0,0,0.22)';
            ctx.fill();
            ctx.strokeStyle = rgba(def.color, 0.35);
            ctx.lineWidth = 1.2;
            drawRoundedRect(ctx, x, statsY, statW, statH, 12);
            ctx.stroke();
            drawRoundedRect(ctx, x, statsY, 4, statH, 2);
            ctx.fillStyle = def.color;
            ctx.fill();

            ctx.font = this._semi(11);
            ctx.fillStyle = DESIGN.colors.textMuted;
            ctx.fillText(def.label.toUpperCase(), x + 14, statsY + 24);
            ctx.font = this._bold(20);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(truncateText(ctx, def.fmt(data[def.key]), statW - 24), x + 14, statsY + statH - 16);
        });

        /* ── 7. Badge strip ── */
        let cursorY = statsY + statH + 22;
        if (data.customBadges && data.customBadges.length > 0) {
            ctx.font = this._semi(12);
            ctx.fillStyle = DESIGN.colors.textMuted;
            ctx.fillText('BADGES', PAD, cursorY);
            cursorY += 12;

            const badgeSize = 36;
            const space = 8;
            const maxBadges = Math.floor((W - PAD * 2) / (badgeSize + space));
            const visible = data.customBadges.slice(0, Math.min(maxBadges, 16));
            let bx = PAD;
            for (const badge of visible) {
                const badgeColor = badge.color || accent;
                drawRoundedRect(ctx, bx, cursorY, badgeSize, badgeSize, 9);
                ctx.fillStyle = 'rgba(0,0,0,0.25)';
                ctx.fill();
                ctx.strokeStyle = rgba(badgeColor, 0.5);
                ctx.lineWidth = 1.2;
                drawRoundedRect(ctx, bx, cursorY, badgeSize, badgeSize, 9);
                ctx.stroke();

                const innerPad = 6;
                const innerSize = badgeSize - innerPad * 2;
                let rendered = false;
                if (badge.imageUrl && String(badge.imageUrl).startsWith('http')) {
                    try {
                        const img = await imageCache.loadWithCache(badge.imageUrl, 5000);
                        if (img) {
                            ctx.save();
                            drawRoundedRect(ctx, bx + innerPad, cursorY + innerPad, innerSize, innerSize, 5);
                            ctx.clip();
                            ctx.drawImage(img, bx + innerPad, cursorY + innerPad, innerSize, innerSize);
                            ctx.restore();
                            rendered = true;
                        }
                    } catch {}
                }
                if (!rendered && badge.emoji) {
                    const isCustom = badge.emoji.startsWith('<');
                    const id = badge.emoji.match(/:(\d+)>/)?.[1];
                    const animated = badge.emoji.startsWith('<a:');
                    let url = null;
                    if (isCustom && id) url = `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=128&quality=lossless`;
                    else { try { url = require('./canvasEmojiDefaults').getCanvasEmojiAssetUrl(badge.emoji); } catch {} }
                    if (url) {
                        try {
                            const img = await imageCache.loadWithCache(url, 5000);
                            if (img) { ctx.drawImage(img, bx + innerPad, cursorY + innerPad, innerSize, innerSize); rendered = true; }
                        } catch {}
                    }
                }
                if (!rendered) {
                    const initial = ((badge.name && String(badge.name).trim()) || '?')[0].toUpperCase();
                    ctx.font = this._bold(15);
                    ctx.fillStyle = badgeColor;
                    ctx.textAlign = 'center';
                    ctx.fillText(initial, bx + badgeSize / 2, cursorY + badgeSize / 2 + 5);
                    ctx.textAlign = 'left';
                }
                bx += badgeSize + space;
            }
            if (data.customBadges.length > visible.length) {
                ctx.font = this._semi(11);
                ctx.fillStyle = DESIGN.colors.textDim;
                ctx.fillText(`+${data.customBadges.length - visible.length}`, bx + 4, cursorY + badgeSize / 2 + 4);
            }
        }

        /* ── 8. Bio + footer ── */
        if (data.bio) {
            ctx.font = this._font(14);
            ctx.fillStyle = DESIGN.colors.textMuted;
            const bioMaxW = W - PAD * 2 - 110;
            await drawText(ctx, `"${truncateText(ctx, data.bio, bioMaxW)}"`, PAD, H - 42);
        }

        ctx.font = this._font(10);
        ctx.fillStyle = DESIGN.colors.textDim;
        ctx.textAlign = 'left';
        ctx.fillText(`ID: ${user.id}`, PAD, H - 16);

        ctx.strokeStyle = rgba(accent, 0.18);
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, 0.75, 0.75, W - 1.5, H - 1.5, 20);
        ctx.stroke();

        await drawNicoBranding(ctx, W, H, accent);

        return canvas.toBuffer('image/png');
    }

    _lighten(hex, amt) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
        if (!m) return hex;
        const adj = (c) => Math.min(255, parseInt(c, 16) + Math.round(amt * 2.55));
        return `#${adj(m[1]).toString(16).padStart(2, '0')}${adj(m[2]).toString(16).padStart(2, '0')}${adj(m[3]).toString(16).padStart(2, '0')}`;
    }

    _rgba(hex, a) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
        if (!m) return `rgba(30,31,34,${a})`;
        return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
    }
}

module.exports = ProfileCard;
