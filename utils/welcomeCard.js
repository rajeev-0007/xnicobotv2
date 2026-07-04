'use strict';

/**
 * welcomeCard.js — clean 1024×420 welcome card.
 *
 * Restrained, professional layout (no stacked glow + lattice + halo):
 *   • ONE flat vertical gradient (or user image + single dark overlay).
 *   • Centered avatar with a single accent ring + a small status dot.
 *   • "WELCOME" headline, display name, @handle, one message line.
 *   • Server-name pill at the bottom.
 *   • One quiet accent band along the bottom edge.
 *
 * Public API (setters + generate) is unchanged so callers in the
 * welcomer pipeline keep working.
 */

const { createCanvas } = require('@napi-rs/canvas');
const imageCache = require('./imageCache');
const {
    DESIGN, drawRoundedRect, drawText, truncateText, fitText,
    hexToRgb, rgba, getFontHelpers, drawNicoBranding, normalizeCanvasText,
} = require('./canvasDesign');

class WelcomeCard {
    constructor() {
        this.width = 1024;
        this.height = 420;
        this.backgroundColor = '#1e1f22';
        this.accentColor = DESIGN.colors.welcome || '#3ba55d';
        this.textColor = '#ffffff';
        this.backgroundImage = null;
        this.backgroundOpacity = 0.4;
        this.fontFamily = 'Inter';
        this._fh = getFontHelpers('Inter');
        this._headline = 'WELCOME';
        this._statusColor = DESIGN.colors.welcome || '#3ba55d';
    }

    /* ─────────── chainable setters ─────────── */
    setFont(family)             { this.fontFamily = family || 'Inter'; this._fh = getFontHelpers(this.fontFamily); return this; }
    setBackground(c)            { this.backgroundColor = c; return this; }
    setBackgroundImage(url)     { this.backgroundImage = url; return this; }
    setAccentColor(c)           { this.accentColor = c; return this; }
    setTextColor(c)             { this.textColor = c; return this; }
    setBackgroundOpacity(o)     { this.backgroundOpacity = Math.max(0, Math.min(1, o)); return this; }

    /* ─────────── per-family font helpers ─────────── */
    _font(s)        { return this._fh.getFont(s); }
    _medium(s)      { return this._fh.getMediumFont(s); }
    _semibold(s)    { return this._fh.getSemiBoldFont(s); }
    _bold(s)        { return this._fh.getBoldFont(s); }

    async generate(user, guild, memberCount, customMessage = null) {
        return this._render(user, guild, memberCount, customMessage,
            this._headline, this.accentColor, this._statusColor, false);
    }

    // Shared renderer so LeaveCard can extend without duplicating.
    async _render(user, guild, memberCount, customMessage, headline, accent, statusColor, greyscale) {
        const W = this.width, H = this.height;
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext('2d');

        /* ── 1. Background (single, clean treatment) ── */
        ctx.save();
        drawRoundedRect(ctx, 0, 0, W, H, 22);
        ctx.clip();

        const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
        bgGrad.addColorStop(0, this._lighten(this.backgroundColor, 6));
        bgGrad.addColorStop(1, this.backgroundColor);
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        if (this.backgroundImage) {
            try {
                const bg = await imageCache.loadWithCache(this.backgroundImage, 5000);
                if (bg) {
                    ctx.globalAlpha = this.backgroundOpacity;
                    const scale = Math.max(W / bg.width, H / bg.height);
                    const ix = (W - bg.width * scale) / 2;
                    const iy = (H - bg.height * scale) / 2;
                    ctx.drawImage(bg, ix, iy, bg.width * scale, bg.height * scale);
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = 'rgba(15,15,20,0.66)';
                    ctx.fillRect(0, 0, W, H);
                }
            } catch {}
        }

        // One quiet accent band along the bottom edge.
        ctx.fillStyle = rgba(accent, 0.9);
        ctx.fillRect(0, H - 4, W, 4);
        ctx.restore();

        /* ── 2. Avatar (single accent ring, no halo) ── */
        const avatarSize = 150;
        const avatarX = (W - avatarSize) / 2;
        const avatarY = 44;
        const cx = avatarX + avatarSize / 2;
        const cy = avatarY + avatarSize / 2;

        // Separation ring against background
        ctx.fillStyle = rgba('#000000', 0.25);
        ctx.beginPath();
        ctx.arc(cx, cy, avatarSize / 2 + 5, 0, Math.PI * 2);
        ctx.fill();

        try {
            const avatar = await imageCache.loadWithCache(
                user.displayAvatarURL({ extension: 'png', size: 256 }),
                5000
            );
            if (avatar) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, avatarSize / 2, 0, Math.PI * 2);
                ctx.clip();
                if (greyscale) ctx.filter = 'grayscale(45%)';
                ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
                ctx.filter = 'none';
                ctx.restore();
            } else {
                ctx.fillStyle = rgba(accent, 0.3);
                ctx.beginPath();
                ctx.arc(cx, cy, avatarSize / 2, 0, Math.PI * 2);
                ctx.fill();
            }
        } catch {}

        // Single accent ring
        ctx.strokeStyle = accent;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, avatarSize / 2 + 2.5, 0, Math.PI * 2);
        ctx.stroke();

        // Status dot
        const sX = cx + avatarSize / 2 * Math.cos(Math.PI / 4);
        const sY = cy + avatarSize / 2 * Math.sin(Math.PI / 4);
        ctx.beginPath();
        ctx.arc(sX, sY, 14, 0, Math.PI * 2);
        ctx.fillStyle = this.backgroundColor;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(sX, sY, 9, 0, Math.PI * 2);
        ctx.fillStyle = statusColor;
        ctx.fill();

        /* ── 3. Text stack (centered, consistent rhythm) ── */
        const textY = avatarY + avatarSize + 44;

        // Headline
        ctx.font = this._bold(38);
        ctx.fillStyle = accent;
        ctx.textAlign = 'center';
        ctx.fillText(headline, W / 2, textY);

        // Display name
        const nameMaxW = W - 120;
        const rawName = normalizeCanvasText(String(user.globalName || user.username));
        const nameSize = fitText(ctx, rawName, nameMaxW, 26, 18);
        ctx.font = this._semibold(nameSize);
        ctx.fillStyle = this.textColor;
        await drawText(ctx, truncateText(ctx, rawName, nameMaxW), W / 2, textY + 40, true);

        // Handle
        ctx.font = this._medium(15);
        ctx.fillStyle = DESIGN.colors.textMuted;
        await drawText(ctx, `@${user.username}`, W / 2, textY + 64, true);

        // Message line
        ctx.font = this._medium(16);
        ctx.fillStyle = DESIGN.colors.textMuted;
        const msg = customMessage || this._defaultMessage(memberCount);
        await drawText(ctx, truncateText(ctx, msg, W - 100), W / 2, textY + 92, true);
        ctx.textAlign = 'left';

        /* ── 4. Server-name pill ── */
        const serverName = String(guild?.name || 'Server');
        ctx.font = this._semibold(14);
        const nameW = ctx.measureText(serverName).width;
        const pillW = Math.min(W - 120, Math.max(180, nameW + 48));
        const pillH = 40;
        const pillX = (W - pillW) / 2;
        const pillY = H - 56;

        drawRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
        ctx.fillStyle = rgba(accent, 0.16);
        ctx.fill();
        ctx.strokeStyle = rgba(accent, 0.5);
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
        ctx.stroke();

        ctx.font = this._semibold(14);
        ctx.fillStyle = this.textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        await drawText(ctx, truncateText(ctx, serverName, pillW - 32), W / 2, pillY + pillH / 2 + 1, true);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';

        /* ── 5. Outer hairline border ── */
        ctx.strokeStyle = rgba(accent, 0.18);
        ctx.lineWidth = 1.5;
        drawRoundedRect(ctx, 0.75, 0.75, W - 1.5, H - 1.5, 22);
        ctx.stroke();

        await drawNicoBranding(ctx, W, H, accent);

        return canvas.toBuffer('image/png');
    }

    _defaultMessage(memberCount) {
        return `You are member #${Number(memberCount || 0).toLocaleString()}`;
    }

    _lighten(hex, amt) {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || ''));
        if (!m) return hex;
        const adj = (c) => Math.min(255, parseInt(c, 16) + Math.round(amt * 2.55));
        return `#${adj(m[1]).toString(16).padStart(2, '0')}${adj(m[2]).toString(16).padStart(2, '0')}${adj(m[3]).toString(16).padStart(2, '0')}`;
    }
}

module.exports = WelcomeCard;
