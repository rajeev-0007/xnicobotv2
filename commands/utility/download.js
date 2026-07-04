'use strict';

const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
} = require('discord.js');
const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
let youtubedl;
try { youtubedl = require('youtube-dl-exec'); } catch { youtubedl = null; }
let ffmpegStatic;
try { ffmpegStatic = require('ffmpeg-static'); } catch { ffmpegStatic = null; }
const { uploadFile } = require('../../utils/tempFileServer');

const execAsync = promisify(exec);
const LOGO_PATH       = path.join(__dirname, '../../assets/images/nico-avatar.png');
const TEMP_DIR        = path.join(__dirname, '../../temp_downloads');
const COOKIES_FILE    = path.join(__dirname, '../../data/cookies.txt');
const MAX_FILE_SIZE   = 100 * 1024 * 1024;
const COLLECTOR_TIMEOUT = 120_000;

const FFMPEG  = ffmpegStatic;
const YT_DLP  = youtubedl.constants.YOUTUBE_DL_PATH;
console.log('[Download] yt-dlp:', YT_DLP, '| ffmpeg:', FFMPEG);

/* ═══════════════════════════════════════════════
   COOKIE HELPERS
   ─ cookies.txt is a Netscape-format cookie file
   ─ exported from your browser while logged in
   ─ Place it at: data/cookies.txt
   ═══════════════════════════════════════════════ */

function hasCookies() {
    try {
        if (!fs.existsSync(COOKIES_FILE)) return false;
        const stat = fs.statSync(COOKIES_FILE);
        return stat.size > 50; // must have actual content
    } catch { return false; }
}

function cookieOpts() {
    return hasCookies() ? { cookies: COOKIES_FILE } : {};
}

/* ═══════════════════════════════════════════════
   PLATFORM DETECTION
   ═══════════════════════════════════════════════ */

const PLATFORMS = {
    youtube:     /(?:youtube\.com\/(?:watch|shorts|embed|live)|youtu\.be\/)/i,
    instagram:   /(?:instagram\.com|instagr\.am)/i,
    tiktok:      /(?:tiktok\.com|vm\.tiktok\.com)/i,
    twitter:     /(?:twitter\.com|x\.com)/i,
    reddit:      /(?:reddit\.com|redd\.it)/i,
    facebook:    /(?:facebook\.com|fb\.watch|fb\.com)/i,
    twitch:      /(?:twitch\.tv|clips\.twitch\.tv)/i,
    soundcloud:  /soundcloud\.com/i,
    pinterest:   /pinterest\./i,
    vimeo:       /vimeo\.com/i,
    dailymotion: /dailymotion\.com/i,
    bilibili:    /bilibili\.com/i,
    spotify:     /open\.spotify\.com/i,
};

const PLATFORM_INFO = {
    youtube:     { name: 'YouTube',      emoji: '<:Cloudcheck:1521228125437165678>',      color: 0xFF0000, hasVideo: true,  hasAudio: true  },
    instagram:   { name: 'Instagram',    emoji: '<:Cloudcheck:1521228125437165678>',    color: 0xE1306C, hasVideo: true,  hasAudio: true  },
    tiktok:      { name: 'TikTok',       emoji: '<:Cloudcheck:1521228125437165678>',       color: 0x010101, hasVideo: true,  hasAudio: true  },
    twitter:     { name: 'Twitter/X',    emoji: '<:Cloudcheck:1521228125437165678>',      color: 0x1DA1F2, hasVideo: true,  hasAudio: true  },
    reddit:      { name: 'Reddit',       emoji: '<:Cloudcheck:1521228125437165678>',       color: 0xFF4500, hasVideo: true,  hasAudio: true  },
    facebook:    { name: 'Facebook',     emoji: '<:Cloudcheck:1521228125437165678>',     color: 0x1877F2, hasVideo: true,  hasAudio: true  },
    twitch:      { name: 'Twitch',       emoji: '<:Cloudcheck:1521228125437165678>',       color: 0x9146FF, hasVideo: true,  hasAudio: true  },
    soundcloud:  { name: 'SoundCloud',   emoji: '<:Cloudcheck:1521228125437165678>',   color: 0xFF5500, hasVideo: false, hasAudio: true  },
    pinterest:   { name: 'Pinterest',    emoji: '<:Cloudcheck:1521228125437165678>',    color: 0xBD081C, hasVideo: true,  hasAudio: false },
    vimeo:       { name: 'Vimeo',        emoji: '<:Cloudcheck:1521228125437165678>',        color: 0x1AB7EA, hasVideo: true,  hasAudio: true  },
    dailymotion: { name: 'Dailymotion',  emoji: '<:Cloudcheck:1521228125437165678>',  color: 0x0066DC, hasVideo: true,  hasAudio: true  },
    bilibili:    { name: 'Bilibili',     emoji: '<:Cloudcheck:1521228125437165678>',     color: 0x00A1D6, hasVideo: true,  hasAudio: true  },
    spotify:     { name: 'Spotify',      emoji: '<:Cloudcheck:1521228125437165678>',      color: 0x1DB954, hasVideo: false, hasAudio: true  },
    unknown:     { name: 'Website',      emoji: '<:Cloudcheck:1521228125437165678>',        color: 0x5865F2, hasVideo: true,  hasAudio: true  },
};

function detectPlatform(url) {
    for (const [platform, regex] of Object.entries(PLATFORMS)) {
        if (regex.test(url)) return platform;
    }
    return 'unknown';
}

function isValidUrl(str) {
    try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
    catch { return false; }
}

function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9_\-.]/g, '_').substring(0, 80);
}

function ensureTempDir() {
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function cleanupFiles(...files) {
    for (const f of files) { try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {} }
}

function cleanupByTimestamp(ts) {
    try {
        const files = fs.readdirSync(TEMP_DIR).filter(f => f.includes(String(ts)));
        for (const f of files) cleanupFiles(path.join(TEMP_DIR, f));
    } catch {}
}

function esc(s) { return "'" + s.replace(/'/g, "'\\''") + "'"; }

function extractYouTubeId(url) {
    const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/))([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

function formatDuration(sec) {
    if (!sec || sec <= 0) return null;
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
}

/* ═══════════════════════════════════════════════
   ERROR CLASSIFIER
   ═══════════════════════════════════════════════ */

function isCookieError(msg) {
    return /sign in|login required|cookies|bot detection|confirm you.re not a bot|access denied|requires authentication|HTTP Error 4(01|03)/i.test(msg);
}

function isGeoError(msg) {
    return /not available in your country|geo.?restrict|region|country/i.test(msg);
}

function isPrivateError(msg) {
    return /private|unavailable|deleted|taken down|removed/i.test(msg);
}

function isNetworkError(msg) {
    return /ENOTFOUND|getaddrinfo|Name or service not known|Connection refused|timed? out/i.test(msg);
}

function isSizeError(msg) {
    return /too large|25MB|filesize|exceeds/i.test(msg);
}

function buildUserMessage(errMsg, platform) {
    if (isSizeError(errMsg)) {
        return `The file is too large to send via Discord (limit: 100 MB). Try a lower quality format.`;
    }
    if (isCookieError(errMsg)) {
        const hint = hasCookies()
            ? `> Your cookies file exists but may be **expired**. Export fresh cookies from your browser and replace \`data/cookies.txt\`.`
            : `> **Cookie Setup Required:**\n> 1. Install the *cookies.txt* browser extension\n> 2. Log in to ${PLATFORM_INFO[platform]?.name || 'the site'} in your browser\n> 3. Export cookies to \`data/cookies.txt\` on the bot server\n> 4. Retry your download`;
        return `**Login required** — ${PLATFORM_INFO[platform]?.name || 'This platform'} blocked the download from a server IP.\n\n${hint}`;
    }
    if (isGeoError(errMsg)) {
        return `This content is **geo-restricted** and cannot be accessed from this server's location.`;
    }
    if (isPrivateError(errMsg)) {
        return `This content is **private, deleted, or unavailable**. Make sure the link is public.`;
    }
    if (isNetworkError(errMsg)) {
        return `Could not reach this website. The URL may be invalid or the site is temporarily down.`;
    }
    if (errMsg.includes('Unsupported URL') || errMsg.includes('not supported')) {
        return `This URL is **not supported** by the downloader. Make sure the link is a direct media page.`;
    }
    if (errMsg.includes('upload services failed') || errMsg.includes('Invalid catbox')) {
        return `The file was downloaded but **upload failed**. All file hosting services are currently unavailable. Try again in a few minutes.`;
    }
    return `Download failed. The content may be restricted or temporarily unavailable.\n\n-# ${errMsg.substring(0, 200)}`;
}

/* ═══════════════════════════════════════════════
   MEDIA INFO FETCHING
   ═══════════════════════════════════════════════ */

async function getMediaInfo(url, platform) {
    let info = await getInfoFromOEmbed(url, platform);
    if (!info) info = await getInfoFromYtDlp(url);
    if (!info) info = buildFallbackInfo(url, platform);
    return info;
}

async function getInfoFromOEmbed(url, platform) {
    try {
        const resp = await axios.get('https://noembed.com/embed', { params: { url }, timeout: 8000 });
        const d = resp.data;
        if (d && d.title && !d.error) {
            const pi = PLATFORM_INFO[platform] || PLATFORM_INFO.unknown;
            return { title: d.title, uploader: d.author_name || 'Unknown', thumbnail: d.thumbnail_url || null, duration: 0, hasVideo: pi.hasVideo, hasAudio: pi.hasAudio, isLive: false, source: 'oembed' };
        }
    } catch {}

    if (platform === 'youtube') {
        try {
            const resp = await axios.get('https://www.youtube.com/oembed', { params: { url, format: 'json' }, timeout: 8000 });
            const d = resp.data;
            if (d && d.title) {
                return { title: d.title, uploader: d.author_name || 'Unknown', thumbnail: d.thumbnail_url || `https://i.ytimg.com/vi/${extractYouTubeId(url)}/hqdefault.jpg`, duration: 0, hasVideo: true, hasAudio: true, isLive: false, source: 'oembed' };
            }
        } catch {}
    }
    return null;
}

async function getInfoFromYtDlp(url) {
    const baseOpts = {
        dumpSingleJson: true,
        noPlaylist: true,
        noWarnings: true,
        noCheckCertificates: true,
        socketTimeout: 20,
        geoBypass: true,
        ffmpegLocation: FFMPEG,
    };

    const attempts = [
        // Attempt 1: with cookies + realistic browser UA
        {
            ...baseOpts,
            ...cookieOpts(),
            addHeader: [
                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'accept-language:en-US,en;q=0.9',
            ],
        },
        // Attempt 2: without cookies (in case cookie file causes errors)
        { ...baseOpts },
    ];

    for (let i = 0; i < attempts.length; i++) {
        try {
            const d = await youtubedl(url, attempts[i]);
            return {
                title:    d.title || 'Unknown',
                uploader: d.uploader || d.channel || 'Unknown',
                thumbnail: d.thumbnail || null,
                duration:  d.duration || 0,
                hasVideo:  !!(d.vcodec && d.vcodec !== 'none'),
                hasAudio:  !!(d.acodec && d.acodec !== 'none'),
                isLive:    d.is_live || false,
                source:    'ytdlp',
            };
        } catch (err) {
            const errText = (err.stderr || err.message || '').substring(0, 300);
            console.warn(`[Download] Info attempt ${i + 1} failed:`, errText.substring(0, 150));
        }
    }
    return null;
}

function buildFallbackInfo(url, platform) {
    const pi = PLATFORM_INFO[platform] || PLATFORM_INFO.unknown;
    let thumbnail = null;
    const ytId = extractYouTubeId(url);
    if (ytId) thumbnail = `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`;
    return { title: 'Media from ' + pi.name, uploader: 'Unknown', thumbnail, duration: 0, hasVideo: pi.hasVideo, hasAudio: pi.hasAudio, isLive: false, source: 'fallback' };
}

/* ═══════════════════════════════════════════════
   DOWNLOAD ENGINE — 4-ATTEMPT STRATEGY
   ─ 1. Full quality  + cookies  + browser UA
   ─ 2. best format   + cookies  + browser UA
   ─ 3. Full quality  + no cookies (bare)
   ─ 4. best format   + no cookies (bare)
   ═══════════════════════════════════════════════ */

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function buildFormatOpts(format) {
    switch (format) {
        case 'mp3':       return { extractAudio: true, audioFormat: 'mp3', audioQuality: 0 };
        case 'mp4_360':   return { format: 'bestvideo[height<=360]+bestaudio/best[height<=360]/best', mergeOutputFormat: 'mp4' };
        case 'mp4_720':   return { format: 'bestvideo[height<=720]+bestaudio/best[height<=720]/best', mergeOutputFormat: 'mp4' };
        case 'mp4_1080':  return { format: 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best', mergeOutputFormat: 'mp4' };
        default:          return { format: 'bestvideo+bestaudio/best', mergeOutputFormat: 'mp4' };
    }
}

async function downloadWithYtDlp(url, format, outputPath) {
    const base = {
        noPlaylist:          true,
        noWarnings:          true,
        noCheckCertificates: true,
        socketTimeout:       30,
        geoBypass:           true,
        maxFilesize:         '99m',
        noPart:              true,
        retries:             3,
        fragmentRetries:     3,
        output:              outputPath,
        ffmpegLocation:      FFMPEG,
    };

    const fmtOpts    = buildFormatOpts(format);
    const fmtBest    = { format: 'best', mergeOutputFormat: 'mp4' };
    const withUA     = { addHeader: [`user-agent:${BROWSER_UA}`, 'accept-language:en-US,en;q=0.9'] };
    const cookies    = cookieOpts();
    const hasCk      = hasCookies();

    const attempts = [
        // 1 — preferred quality + cookies + UA
        { ...base, ...fmtOpts,  ...cookies, ...withUA },
        // 2 — fallback quality + cookies + UA
        { ...base, ...fmtBest,  ...cookies, ...withUA },
        // 3 — preferred quality, no cookies
        ...(hasCk ? [{ ...base, ...fmtOpts, ...withUA }] : []),
        // 4 — best, no cookies (bare minimum)
        { ...base, ...fmtBest },
    ];

    let lastErr = '';
    for (let i = 0; i < attempts.length; i++) {
        try {
            console.log(`[Download] Attempt ${i + 1}/${attempts.length}${i < 2 && hasCk ? ' (cookies)' : ''}`);
            await youtubedl.exec(url, attempts[i]);
            return true;
        } catch (err) {
            lastErr = (err.stderr || err.message || '').substring(0, 400);
            console.error(`[Download] Attempt ${i + 1} failed:`, lastErr.substring(0, 200));
            cleanupFiles(outputPath);

            // Stop early on unrecoverable errors
            if (isPrivateError(lastErr) || isGeoError(lastErr)) break;
            // If cookies are causing errors, skip remaining cookie attempts
            if (hasCk && isCookieError(lastErr) && i === 0) {
                console.warn('[Download] Cookie attempt failed — cookies may be expired');
            }
        }
    }

    throw new Error(lastErr || 'All download attempts failed');
}

/* ═══════════════════════════════════════════════
   WATERMARK HELPERS
   ═══════════════════════════════════════════════ */

async function addVideoWatermark(inputPath, outputPath) {
    const hasLogo = fs.existsSync(LOGO_PATH);
    let filter;
    if (hasLogo) {
        filter = "[1:v]scale=40:40[logo];[0:v][logo]overlay=W-w-20:H-h-60[bg];[bg]drawtext=text='xNico':fontsize=24:fontcolor=white@0.85:x=W-tw-20:y=H-th-15:shadowcolor=black@0.7:shadowx=2:shadowy=2[out]";
    } else {
        filter = "[0:v]drawtext=text='xNico':fontsize=24:fontcolor=white@0.85:x=W-tw-20:y=H-th-20:shadowcolor=black@0.7:shadowx=2:shadowy=2[out]";
    }
    let cmd = `${esc(FFMPEG)} -i ${esc(inputPath)}`;
    if (hasLogo) cmd += ` -i ${esc(LOGO_PATH)}`;
    cmd += ` -filter_complex ${esc(filter)} -map '[out]' -map '0:a?' -codec:a copy -y -preset ultrafast ${esc(outputPath)}`;
    await execAsync(cmd, { timeout: 180000 });
}

async function addImageWatermark(inputPath, outputPath) {
    const hasLogo = fs.existsSync(LOGO_PATH);
    let filter;
    if (hasLogo) {
        filter = "[1:v]scale=iw*0.06:ih*0.06[logo];[0:v][logo]overlay=W-w-15:H-h-50[bg];[bg]drawtext=text='xNico':fontsize=h*0.035:fontcolor=white@0.8:x=W-tw-15:y=H-th-12:shadowcolor=black@0.8:shadowx=1:shadowy=1[out]";
    } else {
        filter = "[0:v]drawtext=text='xNico':fontsize=h*0.035:fontcolor=white@0.8:x=W-tw-15:y=H-th-15:shadowcolor=black@0.8:shadowx=1:shadowy=1[out]";
    }
    let cmd = `${esc(FFMPEG)} -i ${esc(inputPath)}`;
    if (hasLogo) cmd += ` -i ${esc(LOGO_PATH)}`;
    cmd += ` -filter_complex ${esc(filter)} -map '[out]' -y ${esc(outputPath)}`;
    await execAsync(cmd, { timeout: 60000 });
}

/* ═══════════════════════════════════════════════
   UI BUILDERS
   ═══════════════════════════════════════════════ */

function buildInfoPanel(mediaInfo, platform) {
    const pi  = PLATFORM_INFO[platform] || PLATFORM_INFO.unknown;
    const dur = formatDuration(mediaInfo.duration);
    const ck  = hasCookies() ? ' <:Checkedbox:1521227734943269077>' : '';

    let content = `# <:Lightning:1521227915537285150> Media Downloader\n\n`;
    content += `### <:Settings:1521227767780343879> Media Information\n`;
    content += `> <:Document:1521227875016114266> **Title:** ${mediaInfo.title.substring(0, 200)}\n`;
    if (mediaInfo.uploader && mediaInfo.uploader !== 'Unknown') {
        content += `> <:User:1521227714227343380> **Uploader:** ${mediaInfo.uploader}\n`;
    }
    content += `> <:Document:1521227875016114266> **Platform:** ${pi.name}\n`;
    if (dur) content += `> <:Alarm:1521227869047750689> **Duration:** \`${dur}\`\n`;
    content += `> <:Shield:1521227694677692467> **Cookies:**${ck ? ck + ' Active' : ' Not configured'}\n`;
    content += `\n### <:Bookopen:1521227911137595605> Select Format\n`;
    content += `-# Choose your preferred format below`;

    const container = new ContainerBuilder().setAccentColor(pi.color || 0x5865F2);

    if (mediaInfo.thumbnail) {
        try {
            container.addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(mediaInfo.thumbnail).setDescription(mediaInfo.title || 'Thumbnail')
                )
            );
        } catch {}
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    return container;
}

function buildFormatButtons(mediaInfo, userId) {
    const rows = [];

    if (mediaInfo.hasVideo) {
        const videoRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`dl_mp4_360_${userId}`)
                .setLabel('360p')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Lightning:1521227915537285150>'),
            new ButtonBuilder()
                .setCustomId(`dl_mp4_720_${userId}`)
                .setLabel('720p HD')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Lightning:1521227915537285150>'),
            new ButtonBuilder()
                .setCustomId(`dl_mp4_1080_${userId}`)
                .setLabel('1080p FHD')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:Lightning:1521227915537285150>')
        );
        rows.push(videoRow);
    }

    const utilRow = new ActionRowBuilder();
    if (mediaInfo.hasAudio) {
        utilRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`dl_mp3_${userId}`)
                .setLabel('MP3 Audio')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Music:1521228141543165982>')
        );
    }
    if (mediaInfo.thumbnail) {
        utilRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`dl_image_${userId}`)
                .setLabel('Thumbnail')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Image:1521227966435037255>')
        );
    }
    utilRow.addComponents(
        new ButtonBuilder()
            .setCustomId(`dl_cancel_${userId}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('<:Cancel:1521227723916181644>')
    );

    if (utilRow.components.length > 0) rows.push(utilRow);
    return rows;
}

function buildStatusContainer(color, content) {
    const container = new ContainerBuilder().setAccentColor(color);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    return container;
}

function findFile(dir, prefix) {
    try {
        return fs.readdirSync(dir)
            .filter(f => f.startsWith(prefix))
            .map(f => path.join(dir, f))
            .filter(f => { try { return fs.statSync(f).size > 0; } catch { return false; } })
            .sort((a, b) => { try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; } })[0] || null;
    } catch { return null; }
}

const FORMAT_LABELS = {
    mp3:      '<:Music:1521228141543165982> MP3 Audio',
    mp4_360:  '<:Lightning:1521227915537285150> 360p Video',
    mp4_720:  '<:Lightning:1521227915537285150> 720p HD Video',
    mp4_1080: '<:Lightning:1521227915537285150> 1080p FHD Video',
    image:    '<:Image:1521227966435037255> Thumbnail Image',
};

/* ═══════════════════════════════════════════════
   DOWNLOAD PROCESSOR
   ═══════════════════════════════════════════════ */

async function processDownload(editFn, url, mediaInfo, format, platform) {
    ensureTempDir();
    const ts        = Date.now();
    const safeName  = sanitizeFilename(mediaInfo.title || 'download');
    const ext       = format === 'mp3' ? 'mp3' : format === 'image' ? 'png' : 'mp4';
    const rawFile   = path.join(TEMP_DIR, `${safeName}_${ts}_raw.${ext}`);
    const finalFile = path.join(TEMP_DIR, `${safeName}_${ts}.${ext}`);
    const pi        = PLATFORM_INFO[platform] || PLATFORM_INFO.unknown;
    const formatLabel = FORMAT_LABELS[format] || format;

    try {
        await editFn({
            components: [buildStatusContainer(0xFEE75C,
                `# <:Lightning:1521227915537285150> Downloading...\n\n` +
                `> <:Document:1521227875016114266> **${mediaInfo.title.substring(0, 150)}**\n` +
                `> <:Settings:1521227767780343879> **Format:** ${formatLabel}\n` +
                `> <:Shield:1521227694677692467> **Cookies:** ${hasCookies() ? '<:Checkedbox:1521227734943269077> Active' : 'Not configured'}\n\n` +
                `-# Processing your download, please wait...` +
                (format !== 'image' && format !== 'mp3' ? `\n-# Video downloads include xNico watermark` : ''))],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => {});

        /* ── IMAGE ── */
        if (format === 'image') {
            const imgUrl = mediaInfo.thumbnail;
            if (!imgUrl) throw new Error('No thumbnail available for this media.');
            const resp = await axios.get(imgUrl, { responseType: 'arraybuffer', timeout: 30000 });
            fs.writeFileSync(rawFile, Buffer.from(resp.data));
            try { await addImageWatermark(rawFile, finalFile); } catch {
                fs.copyFileSync(rawFile, finalFile);
            }

        /* ── MP3 ── */
        } else if (format === 'mp3') {
            await downloadWithYtDlp(url, 'mp3', finalFile);
            if (!fs.existsSync(finalFile)) {
                const found = findFile(TEMP_DIR, `${safeName}_${ts}`);
                if (found && found !== finalFile) fs.renameSync(found, finalFile);
            }

        /* ── VIDEO ── */
        } else {
            await downloadWithYtDlp(url, format, rawFile);
            let actualRaw = fs.existsSync(rawFile) ? rawFile : findFile(TEMP_DIR, `${safeName}_${ts}_raw`);
            if (!actualRaw || !fs.existsSync(actualRaw)) throw new Error('File not found after download. The video may be too large or restricted.');

            try { await addVideoWatermark(actualRaw, finalFile); } catch (e) {
                console.error('[Download] Watermark failed:', e.message?.substring(0, 100));
                fs.copyFileSync(actualRaw, finalFile);
            }
        }

        /* ── FIND & UPLOAD ── */
        let outFile = fs.existsSync(finalFile) ? finalFile : findFile(TEMP_DIR, `${safeName}_${ts}`);
        if (!outFile || !fs.existsSync(outFile)) throw new Error('Could not find downloaded file.');

        const stat = fs.statSync(outFile);
        if (stat.size === 0) throw new Error('Downloaded file is empty.');
        if (stat.size > MAX_FILE_SIZE) throw new Error(`File is too large (${formatFileSize(stat.size)} — limit 100 MB). Try a lower quality.`);

        const fileSize = formatFileSize(stat.size);
        const sendName = `${safeName}${path.extname(outFile) || '.' + ext}`;

        await editFn({
            components: [buildStatusContainer(0xFEE75C,
                `# <:Lightning:1521227915537285150> Uploading...\n\n` +
                `> <:Document:1521227875016114266> **${mediaInfo.title.substring(0, 150)}**\n` +
                `> <:Invoice:1521227903956811836> **Size:** \`${fileSize}\`\n\n` +
                `-# Uploading your file, please wait...`)],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => {});

        const { url: downloadUrl, service } = await uploadFile(outFile, sendName);

        let successContent = `# <:Checkedbox:1521227734943269077> Download Ready\n\n`;
        successContent += `### <:Document:1521227875016114266> ${mediaInfo.title.substring(0, 150)}\n`;
        successContent += `> <:Settings:1521227767780343879> **Format:** ${formatLabel}\n`;
        successContent += `> <:Invoice:1521227903956811836> **Size:** \`${fileSize}\`\n`;
        successContent += `> <:Document:1521227875016114266> **Platform:** ${pi.name}\n`;
        if (format !== 'image' && format !== 'mp3') {
            successContent += `\n-# Watermarked by xNico`;
        }
        successContent += `\n-# Hosted on ${service}`;

        const successContainer = new ContainerBuilder().setAccentColor(0x57F287);
        successContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(successContent));
        successContainer.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        successContainer.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel('Download File')
                    .setStyle(ButtonStyle.Link)
                    .setURL(downloadUrl)
                    .setEmoji('⬇️')
            )
        );

        await editFn({ components: [successContainer], flags: MessageFlags.IsComponentsV2 });

    } catch (err) {
        const rawErrMsg = err.message || '';
        console.error('[Download] Error:', rawErrMsg.substring(0, 300));
        const userMsg = buildUserMessage(rawErrMsg, platform);

        await editFn({
            components: [buildStatusContainer(0xED4245,
                `# <:Cancel:1521227723916181644> Download Failed\n\n${userMsg}`)],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => {});

    } finally {
        cleanupFiles(rawFile, finalFile);
        cleanupByTimestamp(ts);
    }
}

/* ═══════════════════════════════════════════════
   COLLECTOR SETUP
   ═══════════════════════════════════════════════ */

function setupCollector(msgObj, editFn, url, mediaInfo, platform, userId) {
    const collector = msgObj.createMessageComponentCollector({
        filter: i => i.customId.startsWith('dl_') && i.customId.endsWith(`_${userId}`),
        time: COLLECTOR_TIMEOUT,
        max: 1,
    });

    collector.on('collect', async (btn) => {
        await btn.deferUpdate().catch(() => {});
        const cid = btn.customId;

        if (cid.startsWith('dl_cancel_')) {
            return editFn({
                components: [buildStatusContainer(0xED4245,
                    `# <:Cancel:1521227723916181644> Download Cancelled\n\nYou cancelled the download.`)],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }

        let fmt = null;
        if (cid.startsWith('dl_mp3_'))       fmt = 'mp3';
        else if (cid.startsWith('dl_mp4_360_'))  fmt = 'mp4_360';
        else if (cid.startsWith('dl_mp4_720_'))  fmt = 'mp4_720';
        else if (cid.startsWith('dl_mp4_1080_')) fmt = 'mp4_1080';
        else if (cid.startsWith('dl_image_'))    fmt = 'image';

        if (fmt) await processDownload(editFn, url, mediaInfo, fmt, platform);
    });

    collector.on('end', (collected) => {
        if (collected.size === 0) {
            editFn({
                components: [buildStatusContainer(0x99AAB5,
                    `# <:Alarm:1521227869047750689> Download Expired\n\nNo format was selected within 2 minutes.`)],
                flags: MessageFlags.IsComponentsV2,
            }).catch(() => {});
        }
    });
}

/* ═══════════════════════════════════════════════
   ENTRY POINT
   ═══════════════════════════════════════════════ */

async function handleCommand(editFn, msgObj, url, userId) {
    const platform  = detectPlatform(url);
    const mediaInfo = await getMediaInfo(url, platform);

    if (mediaInfo.isLive) {
        return editFn({
            components: [buildStatusContainer(0xED4245,
                `# <:Cancel:1521227723916181644> Download Failed\n\nLive streams cannot be downloaded.`)],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    const infoContainer = buildInfoPanel(mediaInfo, platform);
    const buttons       = buildFormatButtons(mediaInfo, userId);
    for (const row of buttons) infoContainer.addActionRowComponents(row);

    await editFn({ components: [infoContainer], flags: MessageFlags.IsComponentsV2 });
    setupCollector(msgObj, editFn, url, mediaInfo, platform, userId);
}

/* ═══════════════════════════════════════════════
   MODULE EXPORT
   ═══════════════════════════════════════════════ */

module.exports = {
    /**
     * Premium-gated feature. `premiumOnly` is read by the
     * command dispatcher in index.js — non-premium users get a
     * polite premium-gate message instead of execution.
     *
     * Downloading from third-party sites is bandwidth- and CPU-heavy
     * (yt-dlp + ffmpeg), so this is a premium feature.
     */
    premiumOnly: true,

    data: new SlashCommandBuilder()
        .setName('download')
        .setDescription('Download videos, audio, or images from YouTube, Instagram, TikTok & more')
        .addStringOption(opt =>
            opt.setName('url').setDescription('The URL of the media to download').setRequired(true)
        ),

    prefix:      'download',
    description: 'Download videos, audio, or images from YouTube, Instagram, TikTok & more',
    usage:       'download <url>',
    category:    'utility',
    aliases:     ['dl', 'save', 'ytdl'],

    async execute(interaction) {
        let url = interaction.options.getString('url').trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;

        if (!isValidUrl(url)) {
            return interaction.reply({
                components: [buildStatusContainer(0xED4245,
                    `# <:Cancel:1521227723916181644> Invalid URL\n\nPlease provide a valid URL.\n\n### <:Bookopen:1521227911137595605> Supported Platforms\n> YouTube, Instagram, TikTok, Twitter/X, Reddit, Facebook, SoundCloud, Twitch, Vimeo & more`)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply();
        const editFn = (opts) => interaction.editReply(opts);
        const reply  = await interaction.editReply({
            components: [buildStatusContainer(0x5865F2,
                `# <:Lightning:1521227915537285150> Analyzing URL...\n\nFetching media information, please wait...`)],
            flags: MessageFlags.IsComponentsV2,
        });

        await handleCommand(editFn, reply, url, interaction.user.id);
    },

    async executePrefix(message, args) {
        if (!args[0]) {
            return message.reply({
                components: [buildStatusContainer(0xED4245,
                    `# <:Cancel:1521227723916181644> Missing URL\n\nProvide a URL to download.\n\n**Usage:** \`-download <url>\`\n**Example:** \`-download https://youtube.com/watch?v=dQw4w9WgXcQ\`\n\n### <:Bookopen:1521227911137595605> Supported Platforms\n> YouTube, Instagram, TikTok, Twitter/X, Reddit\n> Facebook, SoundCloud, Twitch, Vimeo & more`)],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        let url = args[0].trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'https://' + url;

        if (!isValidUrl(url)) {
            return message.reply({
                components: [buildStatusContainer(0xED4245,
                    `# <:Cancel:1521227723916181644> Invalid URL\n\nPlease provide a valid URL.`)],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        const reply  = await message.reply({
            components: [buildStatusContainer(0x5865F2,
                `# <:Lightning:1521227915537285150> Analyzing URL...\n\nFetching media information, please wait...`)],
            flags: MessageFlags.IsComponentsV2,
        });
        const editFn = (opts) => reply.edit(opts);
        await handleCommand(editFn, reply, url, message.author.id);
    },
};
