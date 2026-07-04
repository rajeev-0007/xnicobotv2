'use strict';

/**
 * /ship — Compatibility card between two users.
 *
 * Visually consistent with the percentCard look-and-feel:
 *  - Same accent palette (red → orange → amber → lime → emerald)
 *    so the colour responds to the compatibility percent.
 *  - Same glassy layered background, accent halo, top sweep,
 *    diagonal lattice texture, and corner brand pill.
 *  - Two avatar rings with a glowing heart between them, and a
 *    horizontal compatibility bar with a glowing tip.
 */

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder,
    MediaGalleryItemBuilder, MessageFlags, AttachmentBuilder,
} = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const imageCache = require('../../utils/imageCache');
const { registerAllFonts, getFontHelpers } = require('../../utils/fontRegistry');
const { hashPercent, pickTier } = require('../../utils/percentCommandFactory');
const { colorForPercent } = require('../../utils/percentCard');
const { drawTextWithEmoji } = require('../../utils/emojiCanvasHelper');
const funUI = require('../../utils/funUI');

try { registerAllFonts(); } catch (_) { }

const W = 1100;
const H = 460;
const PAD = 32;
const RADIUS = 28;

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

function drawTracked(ctx, text, x, y, tracking = 0) {
    if (!tracking) { ctx.fillText(text, x, y); return; }
    let cursor = x;
    for (const ch of text) {
        ctx.fillText(ch, cursor, y);
        cursor += ctx.measureText(ch).width + tracking;
    }
}

function truncate(ctx, text, max) {
    let s = String(text || '');
    while (ctx.measureText(s).width > max && s.length > 1) s = s.slice(0, -1);
    if (s.length < (text || '').length) s = s.slice(0, -1) + '…';
    return s;
}

async function drawAvatarRing(ctx, url, cx, cy, r, accent) {
    // Halo behind ring
    const halo = ctx.createRadialGradient(cx, cy, r - 4, cx, cy, r + 50);
    halo.addColorStop(0, accent.rgba(0.42));
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 50, 0, Math.PI * 2);
    ctx.fill();

    // Ring track
    ctx.beginPath();
    ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 6;
    ctx.stroke();

    // Solid accent ring
    ctx.beginPath();
    ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
    ctx.strokeStyle = accent.hex;
    ctx.lineWidth = 6;
    ctx.stroke();

    try {
        const img = await imageCache.loadWithCache(url, 8000).catch(() => null);
        if (img) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
            ctx.restore();
        } else {
            ctx.fillStyle = '#1f2937';
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fill();
        }
    } catch {
        ctx.fillStyle = '#1f2937';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    }

    // Inner highlight
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
}

const tiers = [
    {
        max: 5,
        text: 'Tragically incompatible 🪦',
        detail: 'Even the algorithm filed a sad face. The vibes refused to match.'
    },
    {
        max: 15,
        text: 'Not happening 😬',
        detail: 'Plot twist: you\'d both be happier swiping past each other.'
    },
    {
        max: 30,
        text: 'Maybe in another life 🤷',
        detail: 'Nice in theory, awkward in practice. Friends-of-friends material.'
    },
    {
        max: 45,
        text: 'Could go either way 🪙',
        detail: 'There\'s potential — start with coffee and see what brews.'
    },
    {
        max: 60,
        text: 'Could work out 😌',
        detail: 'Dinner sounds promising. The first three texts are going to be cute.'
    },
    {
        max: 75,
        text: 'Pretty solid match 😍',
        detail: 'The kind of duo that texts each other memes within an hour of meeting.'
    },
    {
        max: 90,
        text: 'Power-couple energy 💞',
        detail: 'Friends already screen-shotting your interactions. Save the date energy.'
    },
    {
        max: 100,
        text: 'Soulmates confirmed 💍<:Star:1521227981685526568>',
        detail: 'Locals are placing bets on the wedding date. Three of them are already in.'
    },
];

async function renderShipCard(user1, user2, name1, name2, percent) {
    const accent = colorForPercent(percent);
    const display = getFontHelpers('Outfit');
    const ui = getFontHelpers('Inter');

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    /* ── Background ── */
    const base = ctx.createLinearGradient(0, 0, W, H);
    base.addColorStop(0, '#0f0a22');
    base.addColorStop(0.5, '#0b0820');
    base.addColorStop(1, '#070514');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    // Centred accent halo (heart glow)
    const heartGlow = ctx.createRadialGradient(W / 2, H / 2 - 30, 30, W / 2, H / 2 - 30, 360);
    heartGlow.addColorStop(0, accent.rgba(0.55));
    heartGlow.addColorStop(0.35, accent.rgba(0.18));
    heartGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = heartGlow;
    ctx.fillRect(0, 0, W, H);

    // Diagonal lattice
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.018)';
    ctx.lineWidth = 1;
    for (let i = -H; i < W + H; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + H, H);
        ctx.stroke();
    }
    ctx.restore();

    // Top sweep
    const sweep = ctx.createLinearGradient(0, 0, W, 0);
    sweep.addColorStop(0, 'rgba(0,0,0,0)');
    sweep.addColorStop(0.22, accent.rgba(0.30));
    sweep.addColorStop(0.65, accent.rgba(0.10));
    sweep.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, W, 3);

    // Bottom vignette
    const vig = ctx.createLinearGradient(0, H - 220, 0, H);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    /* ── Card frame ── */
    roundedRect(ctx, PAD / 2, PAD / 2, W - PAD, H - PAD, RADIUS);
    ctx.fillStyle = 'rgba(15,18,28,0.55)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = accent.rgba(0.35);
    ctx.stroke();

    /* ── Title (eyebrow) ── */
    ctx.font = ui.getSemiBoldFont(15);
    ctx.fillStyle = accent.rgba(0.85);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    drawTracked(ctx, 'COMPATIBILITY', W / 2 - 70, 80, 2.5);
    ctx.textAlign = 'left';

    /* ── Two avatars ── */
    const avatarRadius = 84;
    const cy = 200;
    await drawAvatarRing(ctx, user1.displayAvatarURL({ extension: 'png', size: 256 }), 230, cy, avatarRadius, accent);
    await drawAvatarRing(ctx, user2.displayAvatarURL({ extension: 'png', size: 256 }), W - 230, cy, avatarRadius, accent);

    /* ── Heart in the middle ── */
    ctx.save();
    ctx.shadowColor = accent.rgba(0.6);
    ctx.shadowBlur = 28;
    ctx.font = display.getBoldFont(72);
    ctx.fillStyle = accent.hex;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    await drawTextWithEmoji(ctx, '💗', W / 2, cy, 72, 64);
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    /* ── Names below avatars ── */
    ctx.font = display.getSemiBoldFont(22);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText(truncate(ctx, name1, 240), 230, cy + avatarRadius + 38);
    ctx.fillText(truncate(ctx, name2, 240), W - 230, cy + avatarRadius + 38);
    ctx.textAlign = 'left';

    /* ── Hero percent ── */
    const pctStr = `${percent}%`;
    ctx.font = display.getBoldFont(64);
    ctx.textAlign = 'center';
    const pctW = ctx.measureText(pctStr).width;
    const pctX = W / 2;
    const pctY = 360;
    ctx.save();
    ctx.shadowColor = accent.rgba(0.55);
    ctx.shadowBlur = 24;
    const grad = ctx.createLinearGradient(pctX - pctW / 2, pctY - 50, pctX + pctW / 2, pctY);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, accent.hex);
    ctx.fillStyle = grad;
    ctx.fillText(pctStr, pctX, pctY);
    ctx.restore();
    ctx.textAlign = 'left';

    /* ── Compatibility bar ── */
    const barW = 520;
    const barH = 14;
    const barX = (W - barW) / 2;
    const barY = pctY + 16;
    roundedRect(ctx, barX, barY, barW, barH, barH / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();

    if (percent > 0) {
        ctx.save();
        const fillW = Math.max(barH, (barW * percent) / 100);
        roundedRect(ctx, barX, barY, fillW, barH, barH / 2);
        ctx.clip();
        const barGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
        barGrad.addColorStop(0, accent.rgba(0.55));
        barGrad.addColorStop(0.6, accent.rgba(0.95));
        barGrad.addColorStop(1, '#ffffff');
        ctx.fillStyle = barGrad;
        ctx.fillRect(barX, barY, fillW, barH);
        ctx.restore();
    }

    /* ── Verdict ── */
    const tier = pickTier(percent, tiers);
    ctx.font = display.getMediumFont(18);
    ctx.fillStyle = '#cbd5e1';
    ctx.textAlign = 'center';
    await drawTextWithEmoji(ctx, `“${tier.text || ''}”`, W / 2, barY + 42, 18);

    if (tier.detail) {
        ctx.font = ui.getMediumFont(13);
        ctx.fillStyle = '#7d8aa3';
        // Truncate roughly so the line never wraps off the card.
        let detailText = tier.detail;
        const maxW = W - 200;
        while (ctx.measureText(detailText).width > maxW && detailText.length > 4) {
            detailText = detailText.slice(0, -4) + '…';
        }
        ctx.fillText(detailText, W / 2, barY + 66);
    }

    ctx.textAlign = 'left';

    /* ── Brand pill ── */
    const brandText = 'XNICO';
    ctx.font = ui.getSemiBoldFont(12);
    const brandTextW = ctx.measureText(brandText).width;
    const dotR = 4;
    const padX = 14;
    const pillW = brandTextW + dotR * 2 + 10 + padX * 2;
    const pillH = 24;
    const pillX = W - PAD - pillW;
    const pillY = H - PAD - pillH;
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

    return canvas.toBuffer('image/png');
}

function shipPercent(a, b) {
    const ids = [a, b].sort();
    return hashPercent(`ship:${ids[0]}:${ids[1]}`);
}

async function buildAndSend(user1, user2, name1, name2) {
    const p = shipPercent(user1.id, user2.id);
    const buffer = await renderShipCard(user1, user2, name1, name2, p);
    const attachment = new AttachmentBuilder(buffer, { name: 'ship.png' });
    const gallery = new MediaGalleryBuilder()
        .addItems(new MediaGalleryItemBuilder({ media: { url: 'attachment://ship.png' } }));

    const container = new ContainerBuilder()
        .addMediaGalleryComponents(gallery)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '-# Compatibility is just for fun — chemistry is real life only.'
        ));
    return { container, attachment };
}

module.exports = {
    prefix: 'ship',
    description: 'Ship two users together and see their compatibility',
    usage: 'ship <@user1> [@user2]',
    category: 'fun',
    aliases: ['love', 'compatibility'],
    data: new SlashCommandBuilder()
        .setName('ship')
        .setDescription('Ship two users together')
        .addUserOption(o => o.setName('user1').setDescription('First user').setRequired(true))
        .addUserOption(o => o.setName('user2').setDescription('Second user (defaults to you)')),

    async execute(interaction) {
        await interaction.deferReply().catch(() => { });
        const u1 = interaction.options.getUser('user1');
        const u2 = interaction.options.getUser('user2') || interaction.user;
        const m1 = interaction.guild?.members.cache.get(u1.id);
        const m2 = interaction.guild?.members.cache.get(u2.id);
        try {
            const { container, attachment } = await buildAndSend(
                u1, u2,
                m1?.displayName || u1.username,
                m2?.displayName || u2.username
            );
            await interaction.editReply({ components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            console.error('[ship] render error:', err);
            await interaction.editReply(funUI.payload(funUI.err(interaction.guild?.id, 'Render Failed', 'Failed to generate the ship card. Please try again.'))).catch(() => { });
        }
    },

    async executePrefix(message, args) {
        const mentions = [...message.mentions.users.values()];
        const u1 = mentions[0];
        const u2 = mentions[1] || message.author;
        if (!u1) {
            return message.reply({
                components: [new ContainerBuilder()
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                        '# 💘 Ship\n\n**Usage:** `ship <@user1> [@user2]`\n-# Mention at least one user.'
                    ))],
                flags: MessageFlags.IsComponentsV2,
            });
        }
        const m1 = message.guild?.members.cache.get(u1.id);
        const m2 = message.guild?.members.cache.get(u2.id);
        try {
            const { container, attachment } = await buildAndSend(
                u1, u2,
                m1?.displayName || u1.username,
                m2?.displayName || u2.username
            );
            await message.reply({ components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 });
        } catch (err) {
            console.error('[ship] render error:', err);
            await message.reply(funUI.payload(funUI.err(message.guild?.id, 'Render Failed', 'Failed to generate the ship card. Please try again.'))).catch(() => { });
        }
    },
};
