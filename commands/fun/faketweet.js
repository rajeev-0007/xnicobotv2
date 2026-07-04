const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const { registerAllFonts } = require('../../utils/fontRegistry');
const path = require('path');

try { registerAllFonts(); } catch {}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('faketweet')
        .setDescription('Generate a realistic fake tweet image')
        .addStringOption(opt => opt.setName('text').setDescription('Tweet text').setRequired(true).setMaxLength(280))
        .addUserOption(opt => opt.setName('user').setDescription('User to tweet as (defaults to you)')),
    prefix: 'faketweet',
    name: 'faketweet',
    description: 'Generate a realistic fake tweet image',
    usage: 'faketweet <@user|username> <text>',
    category: 'fun',
    aliases: ['tweet', 'trumptweet', 'ftweet'],

    async execute(interaction) {
        const mentioned = interaction.options.getUser('user');
        const tweetText = interaction.options.getString('text');

        let displayName, handle, avatarURL;
        if (mentioned) {
            const member = interaction.guild?.members.cache.get(mentioned.id);
            displayName = member?.displayName || mentioned.displayName || mentioned.username;
            handle = mentioned.username;
            avatarURL = mentioned.displayAvatarURL({ extension: 'png', size: 128 });
        } else {
            const member = interaction.member;
            displayName = member?.displayName || interaction.user.displayName || interaction.user.username;
            handle = interaction.user.username;
            avatarURL = interaction.user.displayAvatarURL({ extension: 'png', size: 128 });
        }

        await interaction.deferReply();
        try {
            const buffer = await generateTweetImage(displayName, handle, avatarURL, tweetText);
            const attachment = new AttachmentBuilder(buffer, { name: 'tweet.png' });

            const gallery = new MediaGalleryBuilder()
                .addItems(new MediaGalleryItemBuilder({ media: { url: 'attachment://tweet.png' } }));

            const container = new ContainerBuilder()
                .addMediaGalleryComponents(gallery)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# This is a fake tweet generated for fun. Not real.`));

            await interaction.editReply({ components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[FakeTweet] Error generating tweet:', error);
            const container = buildErrorResponse('Error', 'Failed to generate tweet image.');
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        if (!args.length) {
            let content = `# <:Attach:1521228039135170722> Fake Tweet Generator\n\n`;
            content += `**Usage:** \`faketweet <@user> <text>\`\n`;
            content += `**Usage:** \`faketweet <custom_name> | <text>\`\n\n`;
            content += `### Examples\n`;
            content += `> \`faketweet @User This is amazing!\`\n`;
            content += `> \`faketweet Elon Musk | I love rockets\`\n`;
            content += `> \`faketweet Donald Trump | This is HUGE!\`\n\n`;
            content += `-# Generates a realistic tweet image for fun`;

            const container = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const fullText = args.join(' ');
        let displayName, handle, avatarURL, tweetText;

        // Check for pipe separator: "Name | text"
        if (fullText.includes('|')) {
            const parts = fullText.split('|');
            displayName = parts[0].trim();
            handle = displayName.toLowerCase().replace(/[^a-z0-9]/g, '');
            tweetText = parts.slice(1).join('|').trim();
            avatarURL = null;
        } else {
            // Check for mentioned user
            const mentioned = message.mentions.users.first();
            if (mentioned) {
                displayName = mentioned.displayName || mentioned.username;
                handle = mentioned.username;
                avatarURL = mentioned.displayAvatarURL({ extension: 'png', size: 128 });
                tweetText = args.slice(1).join(' ');
            } else {
                // Use the author by default
                displayName = message.member?.displayName || message.author.displayName || message.author.username;
                handle = message.author.username;
                avatarURL = message.author.displayAvatarURL({ extension: 'png', size: 128 });
                tweetText = fullText;
            }
        }

        if (!tweetText || tweetText.trim().length === 0) {
            const container = buildErrorResponse('Missing Text', 'Please provide text for the tweet.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        tweetText = tweetText.substring(0, 280);

        try {
            const buffer = await generateTweetImage(displayName, handle, avatarURL, tweetText);
            const attachment = new AttachmentBuilder(buffer, { name: 'tweet.png' });

            const gallery = new MediaGalleryBuilder()
                .addItems(new MediaGalleryItemBuilder({ media: { url: 'attachment://tweet.png' } }));

            const container = new ContainerBuilder()
                .addMediaGalleryComponents(gallery)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# This is a fake tweet generated for fun. Not real.`));

            await message.reply({ components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[FakeTweet] Error generating tweet:', error);
            const container = buildErrorResponse('Error', 'Failed to generate tweet image.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};

/**
 * Generate a realistic X/Twitter tweet image.
 */
async function generateTweetImage(displayName, handle, avatarURL, text) {
    const W = 600;
    const PAD = 20;
    const AVATAR_SIZE = 48;
    const TEXT_X = PAD + AVATAR_SIZE + 12;
    const TEXT_MAX_W = W - TEXT_X - PAD;

    // Pre-calculate text height for dynamic canvas
    const tempCanvas = createCanvas(W, 100);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.font = '15px Inter-Regular, sans-serif';
    const lines = wrapText(tempCtx, text, TEXT_MAX_W);
    const lineHeight = 21;
    const textBlockH = lines.length * lineHeight;

    // Layout measurements
    const nameY = PAD + 14;
    const tweetTextY = PAD + AVATAR_SIZE + 14;
    const statsY = tweetTextY + textBlockH + 18;
    const actionsY = statsY + 28;
    const H = actionsY + 30;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    // ── Background (dark theme) ──
    ctx.fillStyle = '#000000';
    roundRect(ctx, 0, 0, W, H, 16);
    ctx.fill();

    // ── Avatar ──
    ctx.save();
    const avatarX = PAD;
    const avatarY = PAD;
    roundRect(ctx, avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE, AVATAR_SIZE / 2);
    ctx.clip();
    if (avatarURL) {
        try {
            const avatarImg = await loadImage(avatarURL);
            ctx.drawImage(avatarImg, avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
        } catch {
            ctx.fillStyle = '#2F3336';
            ctx.fillRect(avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
            ctx.fillStyle = '#71767B';
            ctx.font = 'bold 20px Inter-Bold, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(displayName.charAt(0).toUpperCase(), avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2 + 7);
            ctx.textAlign = 'left';
        }
    } else {
        ctx.fillStyle = '#1D9BF0';
        ctx.fillRect(avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 22px Inter-Bold, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(displayName.charAt(0).toUpperCase(), avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2 + 8);
        ctx.textAlign = 'left';
    }
    ctx.restore();

    // ── Display Name + Verified + Handle ──
    ctx.font = 'bold 15px Inter-Bold, sans-serif';
    ctx.fillStyle = '#E7E9EA';
    const nameMetrics = ctx.measureText(displayName);
    ctx.fillText(displayName, TEXT_X, nameY);

    // Verified badge (blue checkmark)
    const badgeX = TEXT_X + nameMetrics.width + 4;
    drawVerifiedBadge(ctx, badgeX, nameY - 10, 16);

    // Handle
    ctx.font = '14px Inter-Regular, sans-serif';
    ctx.fillStyle = '#71767B';
    ctx.fillText(`@${handle}`, badgeX + 20, nameY);

    // ── "three dots" icon ──
    ctx.fillStyle = '#71767B';
    const dotsY = nameY - 4;
    const dotsX = W - PAD - 5;
    for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(dotsX, dotsY - i * 5, 1.5, 0, Math.PI * 2);
        ctx.fill();
    }

    // ── Tweet Text ──
    ctx.font = '15px Inter-Regular, sans-serif';
    ctx.fillStyle = '#E7E9EA';
    let curY = tweetTextY;
    for (const line of lines) {
        ctx.fillText(line, TEXT_X, curY);
        curY += lineHeight;
    }

    // ── Timestamp ──
    const now = new Date();
    const timeStr = now.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    ctx.font = '13px Inter-Regular, sans-serif';
    ctx.fillStyle = '#71767B';
    ctx.fillText(`${timeStr} · ${dateStr}`, TEXT_X, statsY);

    // ── View count ──
    const viewsStr = `${formatNumber(Math.floor(Math.random() * 500000) + 10000)} Views`;
    const timeWidth = ctx.measureText(`${timeStr} · ${dateStr} · `).width;
    ctx.fillText('· ', TEXT_X + timeWidth - 2, statsY);
    ctx.font = 'bold 13px Inter-Bold, sans-serif';
    ctx.fillStyle = '#E7E9EA';
    ctx.fillText(viewsStr, TEXT_X + timeWidth + 6, statsY);

    // ── Divider ──
    ctx.strokeStyle = '#2F3336';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(TEXT_X, statsY + 12);
    ctx.lineTo(W - PAD, statsY + 12);
    ctx.stroke();

    // ── Action icons (reply, retweet, like, bookmark, share) ──
    const actionY = actionsY;
    const actions = [
        { icon: 'comment', count: Math.floor(Math.random() * 2000) + 50 },
        { icon: 'retweet', count: Math.floor(Math.random() * 10000) + 100 },
        { icon: 'heart', count: Math.floor(Math.random() * 50000) + 500 },
        { icon: 'bookmark', count: null },
        { icon: 'share', count: null },
    ];
    const spacing = TEXT_MAX_W / actions.length;

    for (let i = 0; i < actions.length; i++) {
        const ax = TEXT_X + i * spacing;
        const a = actions[i];
        drawActionIcon(ctx, a.icon, ax, actionY, a.count);
    }

    return canvas.toBuffer('image/png');
}

function drawVerifiedBadge(ctx, x, y, size) {
    ctx.save();
    ctx.fillStyle = '#1D9BF0';
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.fill();
    // Checkmark
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x + size * 0.25, y + size * 0.5);
    ctx.lineTo(x + size * 0.42, y + size * 0.68);
    ctx.lineTo(x + size * 0.75, y + size * 0.32);
    ctx.stroke();
    ctx.restore();
}

function drawActionIcon(ctx, icon, x, y, count) {
    ctx.save();
    const s = 16;

    if (icon === 'comment') {
        ctx.strokeStyle = '#71767B';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x + s / 2, y - s / 2 + 1, s / 2.5, 0, Math.PI * 2);
        ctx.stroke();
    } else if (icon === 'retweet') {
        ctx.strokeStyle = '#71767B';
        ctx.lineWidth = 1.5;
        // Two arrows
        ctx.beginPath();
        ctx.moveTo(x + 2, y - 2);
        ctx.lineTo(x + s - 4, y - 2);
        ctx.lineTo(x + s - 7, y - 5);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + s - 2, y - 8);
        ctx.lineTo(x + 4, y - 8);
        ctx.lineTo(x + 7, y - 5);
        ctx.stroke();
    } else if (icon === 'heart') {
        ctx.strokeStyle = '#71767B';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const hx = x + s / 2, hy = y - s / 2;
        ctx.moveTo(hx, hy + 4);
        ctx.bezierCurveTo(hx - 5, hy - 2, hx - 9, hy + 2, hx, hy + 8);
        ctx.bezierCurveTo(hx + 9, hy + 2, hx + 5, hy - 2, hx, hy + 4);
        ctx.stroke();
    } else if (icon === 'bookmark') {
        ctx.strokeStyle = '#71767B';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 3, y - 2);
        ctx.lineTo(x + 3, y - s + 2);
        ctx.lineTo(x + s / 2, y - s / 2);
        ctx.lineTo(x + s - 3, y - s + 2);
        ctx.lineTo(x + s - 3, y - 2);
        ctx.stroke();
    } else if (icon === 'share') {
        ctx.strokeStyle = '#71767B';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x + 2, y - s / 2);
        ctx.lineTo(x + s - 2, y - s + 2);
        ctx.lineTo(x + s - 2, y - 2);
        ctx.closePath();
        ctx.stroke();
    }

    // Count label
    if (count !== null) {
        ctx.font = '12px Inter-Regular, sans-serif';
        ctx.fillStyle = '#71767B';
        ctx.textAlign = 'left';
        ctx.fillText(formatNumber(count), x + s + 4, y);
    }
    ctx.restore();
}

function formatNumber(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace('.0', '') + 'K';
    return n.toString();
}

function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
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
    return lines;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}
