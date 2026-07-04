'use strict';

const { isOwner } = require('../../utils/helpers');
const { AttachmentBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { registerAllFonts } = require('../../utils/fontRegistry');

try { registerAllFonts(); } catch {}

module.exports = {
    name: 'canvas',
    prefix: 'canvas',
    aliases: ['canvas-generate', 'cgenerate', 'canvasgen'],
    description: 'Owner-only: Generate a custom designed text canvas card.',
    usage: 'canvas generate <text>',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager, client) {
        if (!isOwner(message.author.id)) {
            return message.reply(require('../../utils/ownerUI').ownerOnly());
        }

        let text = args.join(' ').trim();
        if (args[0] && args[0].toLowerCase() === 'generate') {
            text = args.slice(1).join(' ').trim();
        }

        if (!text) {
            return message.reply(require('../../utils/ownerUI').errReply('Missing Text', 'Please provide the text to generate.', { hint: 'Usage: `canvas generate <text>` or `canvas <text>`' }));
        }

        const statusMsg = await message.reply('<:Lightning:1521227915537285150> Generating your custom canvas card...');

        try {
            const buffer = await generateCanvasCard(message.author, text);
            const attachment = new AttachmentBuilder(buffer, { name: 'canvas-card.png' });

            await statusMsg.edit({ content: null, files: [attachment] });
        } catch (error) {
            console.error('[CanvasCommand] Error generating canvas:', error);
            await statusMsg.edit(`<:Cancel:1521227723916181644> Failed to generate canvas: ${error.message}`).catch(() => {});
        }
    }
};

async function generateCanvasCard(user, text) {
    const W = 1000;
    const H = 600;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // ── 1. BACKGROUND GRADIENT ──
    const bgGrad = ctx.createLinearGradient(0, 0, W, H);
    bgGrad.addColorStop(0, '#0F1016');
    bgGrad.addColorStop(0.5, '#151722');
    bgGrad.addColorStop(1, '#08090C');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // ── 2. AMBIENT GLOW EFFECTS ──
    // Top-Left Soft Glow
    const glowTL = ctx.createRadialGradient(0, 0, 50, 150, 150, 450);
    glowTL.addColorStop(0, 'rgba(138, 43, 226, 0.18)'); // soft violet
    glowTL.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glowTL;
    ctx.beginPath();
    ctx.arc(0, 0, 600, 0, Math.PI * 2);
    ctx.fill();

    // Bottom-Right Soft Glow
    const glowBR = ctx.createRadialGradient(W, H, 50, W - 150, H - 150, 450);
    glowBR.addColorStop(0, 'rgba(0, 242, 254, 0.15)'); // soft cyan
    glowBR.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glowBR;
    ctx.beginPath();
    ctx.arc(W, H, 600, 0, Math.PI * 2);
    ctx.fill();

    // ── 3. FROSTED GLASS CARD CONTAINER ──
    const cardX = 60;
    const cardY = 60;
    const cardW = W - cardX * 2;
    const cardH = H - cardY * 2;
    const cardR = 24;

    ctx.save();
    drawRoundRect(ctx, cardX, cardY, cardW, cardH, cardR);
    ctx.fillStyle = 'rgba(22, 26, 38, 0.78)'; // dark glass
    ctx.fill();

    // Border with gradient
    const borderGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
    borderGrad.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
    borderGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.04)');
    borderGrad.addColorStop(0.65, 'rgba(138, 43, 226, 0.25)'); // violet touch
    borderGrad.addColorStop(1, 'rgba(0, 242, 254, 0.3)'); // cyan touch
    ctx.strokeStyle = borderGrad;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // ── 4. RESOLVE AVATAR IMAGE ──
    const avatarURL = user.displayAvatarURL({ extension: 'png', size: 256 });
    let avatarImg = null;
    try {
        avatarImg = await loadImage(avatarURL);
    } catch (e) {
        console.error('[CanvasCommand] Failed to load avatar image:', e.message);
    }

    const avatarX = 100;
    const avatarY = 100;
    const avatarSize = 72;
    const avatarR = avatarSize / 2;

    // Draw Avatar Ring Glow
    ctx.save();
    ctx.shadowColor = 'rgba(138, 43, 226, 0.5)';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = '#8A2BE2';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(avatarX + avatarR, avatarY + avatarR, avatarR + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Draw Avatar
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarR, avatarY + avatarR, avatarR, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (avatarImg) {
        ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
    } else {
        ctx.fillStyle = '#8A2BE2';
        ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
        ctx.font = 'bold 36px Poppins-Bold, sans-serif';
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(user.username.charAt(0).toUpperCase(), avatarX + avatarR, avatarY + avatarR);
    }
    ctx.restore();

    // ── 5. HEADER DETAILS ──
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Owner Name
    const ownerName = user.globalName || user.username;
    ctx.font = 'bold 24px Poppins-Bold, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(ownerName, 195, 132);

    // Pill Badge: "SYSTEM OWNER"
    const nameWidth = ctx.measureText(ownerName).width;
    const badgeX = 195 + nameWidth + 12;
    const badgeY = 111;
    const badgeW = 112;
    const badgeH = 24;
    const badgeR = 6;

    ctx.save();
    const badgeGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY);
    badgeGrad.addColorStop(0, '#FF416C');
    badgeGrad.addColorStop(1, '#FF4B2B');
    ctx.fillStyle = badgeGrad;
    drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeR);
    ctx.fill();

    ctx.font = 'bold 11px SpaceGrotesk, sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText('SYSTEM OWNER', badgeX + badgeW / 2, badgeY + 16);
    ctx.restore();

    // Subtitle
    ctx.font = '14px Inter-Regular, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.fillText(`@${user.username} · Console Session`, 195, 158);
    ctx.restore();

    // Cyber HUD details on the right
    ctx.save();
    ctx.textAlign = 'right';
    ctx.font = 'bold 12px SpaceGrotesk, sans-serif';
    ctx.fillStyle = '#00F2FE';
    ctx.fillText('// CANVAS GENERATOR ACTIVE', cardX + cardW - 40, 120);

    ctx.font = '11px SpaceGrotesk, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillText('RENDER: ENGINE_V2.0', cardX + cardW - 52, 142);

    // Blinking status dot
    ctx.fillStyle = '#39FF14';
    ctx.beginPath();
    ctx.arc(cardX + cardW - 40, 138, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Divider Line
    ctx.save();
    const dividerGrad = ctx.createLinearGradient(cardX + 40, 185, cardX + cardW - 40, 185);
    dividerGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    dividerGrad.addColorStop(0.15, 'rgba(255, 255, 255, 0.08)');
    dividerGrad.addColorStop(0.85, 'rgba(255, 255, 255, 0.08)');
    dividerGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.strokeStyle = dividerGrad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 40, 185);
    ctx.lineTo(cardX + cardW - 40, 185);
    ctx.stroke();
    ctx.restore();

    // ── 6. DRAW TEXT CONTENT ──
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    // Dynamic Font Scaling
    let fontSize = 38;
    if (text.length > 150) fontSize = 22;
    else if (text.length > 80) fontSize = 28;
    else if (text.length > 40) fontSize = 34;

    ctx.font = `600 ${fontSize}px Poppins-Medium, sans-serif`;
    ctx.fillStyle = '#ECECF1';

    // Glow effect
    ctx.shadowColor = 'rgba(255, 255, 255, 0.12)';
    ctx.shadowBlur = 8;

    const textX = cardX + 40;
    const textY = 220;
    const maxTextW = cardW - 80;
    const lineHeight = fontSize * 1.45;
    const lines = wrapText(ctx, text, maxTextW);

    let curY = textY;
    const maxLines = Math.floor((cardY + cardH - 60 - textY) / lineHeight);
    const printedLines = lines.slice(0, maxLines);

    for (let i = 0; i < printedLines.length; i++) {
        let lineText = printedLines[i];
        if (i === maxLines - 1 && lines.length > maxLines) {
            lineText += '...';
        }
        ctx.fillText(lineText, textX, curY);
        curY += lineHeight;
    }
    ctx.restore();

    // ── 7. FOOTER ──
    ctx.save();
    ctx.font = '12px SpaceGrotesk, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.textAlign = 'left';

    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    ctx.fillText(`DATE: ${dateStr}  ·  TIME: ${timeStr} GMT`, cardX + 40, cardY + cardH - 35);

    ctx.textAlign = 'right';
    ctx.fillText('XNICO DEVELOPMENT FRAMEWORK', cardX + cardW - 40, cardY + cardH - 35);
    ctx.restore();

    return canvas.toBuffer('image/png');
}

function drawRoundRect(ctx, x, y, width, height, radius) {
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, width, height, radius);
    } else {
        if (width < 2 * radius) radius = width / 2;
        if (height < 2 * radius) radius = height / 2;
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + width, y, x + width, y + height, radius);
        ctx.arcTo(x + width, y + height, x, y + height, radius);
        ctx.arcTo(x, y + height, x, y, radius);
        ctx.arcTo(x, y, x + width, y, radius);
        ctx.closePath();
    }
}

function wrapText(ctx, text, maxWidth) {
    const paragraphs = text.split('\n');
    const lines = [];
    for (const paragraph of paragraphs) {
        const words = paragraph.split(' ');
        let line = '';
        for (const word of words) {
            const test = line ? line + ' ' + word : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = test;
            }
        }
        if (line) lines.push(line);
    }
    return lines;
}
