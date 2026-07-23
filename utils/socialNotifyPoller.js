const https = require('https');
const http = require('http');
const {
    EmbedBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MediaGalleryBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
} = require('discord.js');

const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const YOUTUBE_RSS_BASE = 'https://www.youtube.com/feeds/videos.xml';

let pollTimer = null;

function loadConfig() {
    try {
        if (!jsonStore.has('social-notify')) return {};
        return jsonStore.read('social-notify');
    } catch { return {}; }
}

function loadCache() {
    try {
        if (!jsonStore.has('social-notify-cache')) return {};
        return jsonStore.read('social-notify-cache');
    } catch { return {}; }
}

function saveCache(cache) {
    try {
        jsonStore.write('social-notify-cache', cache);
    } catch (e) {
        log.error('[Social Notify] Failed to save cache:', e.message);
    }
}

/**
 * Fetch a URL and return the response body as a string.
 * Follows up to 5 redirects. Uses built-in http/https modules.
 */
function fetchUrl(url, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

        const lib = url.startsWith('https') ? https : http;
        const req = lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DiscordBot/1.0)' }, timeout: 15000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(fetchUrl(res.headers.location, maxRedirects - 1));
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    });
}

/**
 * Resolve a YouTube @handle or username to a channel ID by scraping the page.
 */
async function resolveYouTubeChannelId(handle) {
    // Already a channel ID
    if (handle.startsWith('UC') && handle.length >= 20) return handle;

    const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
    try {
        const html = await fetchUrl(`https://www.youtube.com/${encodeURIComponent(cleanHandle)}`);
        // Look for channel ID in meta tags or canonical links
        const channelIdMatch = html.match(/(?:"channelId"|"externalId"|channel_id=|\/channel\/)(UC[\w-]{22})/);
        if (channelIdMatch) return channelIdMatch[1];
    } catch { /* ignore */ }
    return null;
}

/**
 * Parse YouTube RSS XML and extract video entries.
 * Returns array of { videoId, title, channelName, published, url }
 */
function parseYouTubeRSS(xml) {
    const entries = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;

    while ((match = entryRegex.exec(xml)) !== null) {
        const entry = match[1];

        const videoIdMatch = entry.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/);
        const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/);
        const publishedMatch = entry.match(/<published>([\s\S]*?)<\/published>/);
        const authorMatch = entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/);
        const linkMatch = entry.match(/<link[^>]*href="([^"]*)"[^>]*\/>/);

        if (videoIdMatch) {
            entries.push({
                videoId: videoIdMatch[1].trim(),
                title: titleMatch ? decodeXMLEntities(titleMatch[1].trim()) : 'Untitled',
                channelName: authorMatch ? decodeXMLEntities(authorMatch[1].trim()) : 'Unknown',
                published: publishedMatch ? new Date(publishedMatch[1].trim()) : new Date(),
                url: linkMatch ? linkMatch[1] : `https://www.youtube.com/watch?v=${videoIdMatch[1].trim()}`
            });
        }
    }

    return entries;
}

function decodeXMLEntities(str) {
    return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x27;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
}

/**
 * Build a Components V2 container for a YouTube upload / livestream
 * notification.  Discord rejects mixing v2 components with embeds, so
 * the caller must send with `flags: MessageFlags.IsComponentsV2` and
 * NOT pass an `embeds` array.
 */
function buildYouTubeContainer(video, isLive, messageText) {
    const container = new ContainerBuilder().setAccentColor(0xFF0000);

    const thumb = `https://img.youtube.com/vi/${video.videoId}/maxresdefault.jpg`;
    try {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(item => item.setURL(thumb))
        );
    } catch { /* ignore — Discord will reject if URL is unreachable */ }

    const liveBadge = isLive ? '🔴 **LIVE**' : '<:YoutubeLive:1521228137541927022> **New Upload**';
    let body = `# ${liveBadge}\n\n`;
    body += `### ${video.title}\n`;
    body += `-# by **${video.channelName}**\n`;
    if (messageText && messageText.trim()) {
        body += `\n${messageText.trim()}\n`;
    }
    body += `\n-# Posted <t:${Math.floor(video.published.getTime() / 1000)}:R>`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));

    container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
    );

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel(isLive ? 'Watch Live' : 'Watch Now')
                .setStyle(ButtonStyle.Link)
                .setURL(video.url)
                .setEmoji('▶️')
        )
    );

    return container;
}

/**
 * Build a YouTube notification embed (legacy fallback path).
 */
function buildYouTubeEmbed(video, isLive = false) {
    const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setAuthor({ name: video.channelName, iconURL: 'https://i.imgur.com/3pGrCPv.png' })
        .setTitle(`${isLive ? '🔴 LIVE: ' : ''}${video.title}`)
        .setURL(video.url)
        .setImage(`https://img.youtube.com/vi/${video.videoId}/maxresdefault.jpg`)
        .setTimestamp(video.published)
        .setFooter({ text: isLive ? 'YouTube • Live' : 'YouTube' });
    return embed;
}

/**
 * Check if a YouTube video is a livestream by checking page metadata.
 * Returns true only when the stream is currently live (active broadcast),
 * NOT for past broadcasts or upcoming-but-not-started ones.
 *
 * Reliable signals:
 *   - "isLiveNow":true      — stream is broadcasting right now
 *   - "hlsManifestUrl":      — live HLS manifest only present for active broadcasts
 *   - "liveBroadcastDetails": with isLiveNow=true (same thing, alternate JSON path)
 *
 * Past broadcast pages contain "isLiveContent":true but lack
 * isLiveNow/hlsManifestUrl, so we no longer false-positive on those.
 *
 * Upcoming streams have "isUpcoming":true and a startTimestamp; we
 * don't notify those — they'll fire when the broadcast actually starts.
 */
async function checkIfLive(videoId) {
    try {
        const html = await fetchUrl(`https://www.youtube.com/watch?v=${videoId}`);
        if (html.includes('"isLiveNow":true')) return true;
        if (html.includes('"hlsManifestUrl"')) return true;
        return false;
    } catch {
        return false;
    }
}

/**
 * Format a notification message with video variables.
 */
function formatMessage(message, video) {
    return message
        .replace(/{channel}/g, video.channelName)
        .replace(/{title}/g, video.title)
        .replace(/{url}/g, video.url)
        .replace(/{videoId}/g, video.videoId);
}

/**
 * Main polling function — checks YouTube RSS feeds for all guilds.
 */
async function pollYouTube(client, log) {
    const config = loadConfig();
    const cache = loadCache();

    // Collect all unique YouTube handles/IDs to check
    const channelMap = new Map(); // handle → channelId (resolved)

    for (const [guildId, guildConfig] of Object.entries(config)) {
        const ytConfig = guildConfig?.youtube;
        if (!ytConfig?.enabled || !ytConfig?.notifyChannel || !ytConfig?.channels?.length) continue;

        for (const handle of ytConfig.channels) {
            if (!channelMap.has(handle)) {
                channelMap.set(handle, null); // will resolve later
            }
        }
    }

    if (channelMap.size === 0) return;

    // Resolve handles to channel IDs (use cache to avoid re-resolving)
    if (!cache.channelIds) cache.channelIds = {};

    for (const handle of channelMap.keys()) {
        const cachedId = cache.channelIds[handle];
        // Only honour a positive cache hit. Null/undefined means we
        // failed last time — retry on every poll so a transient
        // outage doesn't permanently disable a channel.
        if (cachedId) {
            channelMap.set(handle, cachedId);
        } else {
            try {
                const channelId = await resolveYouTubeChannelId(handle);
                if (channelId) {
                    channelMap.set(handle, channelId);
                    cache.channelIds[handle] = channelId;
                }
            } catch { /* ignore — will retry next poll */ }
        }
    }

    // Fetch RSS feeds for each resolved channel
    const videosByHandle = new Map(); // handle → latest video entries
    if (!cache.failedHandles) cache.failedHandles = {};

    for (const [handle, channelId] of channelMap.entries()) {
        if (!channelId) continue;

        try {
            const xml = await fetchUrl(`${YOUTUBE_RSS_BASE}?channel_id=${channelId}`);
            const entries = parseYouTubeRSS(xml);
            if (entries.length > 0) {
                videosByHandle.set(handle, entries);
            }
            // Clear failure state on success
            if (cache.failedHandles[handle]) delete cache.failedHandles[handle];
        } catch (e) {
            // Log the first failure per handle, then suppress repeats for
            // 24 hours so we don't spam — but still surface a fresh
            // warning once per day if the channel keeps failing, so
            // the issue stays visible.
            const last = cache.failedHandles[handle] || 0;
            const ONE_DAY = 24 * 60 * 60 * 1000;
            if (Date.now() - last > ONE_DAY) {
                if (log) log.warning(`[Social Notify] YouTube RSS fetch failed for ${handle}: ${e.message} (suppressing repeats for 24h)`);
                cache.failedHandles[handle] = Date.now();
            }
        }
    }

    // Initialize seen videos cache
    if (!cache.seenVideos) cache.seenVideos = {};

    // Check each guild's YouTube config for new videos
    for (const [guildId, guildConfig] of Object.entries(config)) {
        const ytConfig = guildConfig?.youtube;
        if (!(ytConfig?.enabled || guildConfig?.enabled) || !ytConfig?.notifyChannel || !ytConfig?.channels?.length) continue;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;

        const notifyChannel = guild.channels.cache.get(ytConfig.notifyChannel);
        if (!notifyChannel) continue;

        for (const handle of ytConfig.channels) {
            const videos = videosByHandle.get(handle);
            if (!videos || videos.length === 0) continue;

            // Get seen video IDs for this guild+handle combo
            const cacheKey = `${guildId}:${handle}`;
            const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

            if (!cache.seenVideos[cacheKey]) {
                // First run: mark older videos as seen, but let
                // anything from the last 24h flow through so the user
                // gets the notification they expect right after
                // adding a channel. (Previously we marked every
                // current video as seen, so the channel had to upload
                // a *new* video before the integration ever fired —
                // which the user reads as "notifications don't work".)
                cache.seenVideos[cacheKey] = videos
                    .filter(v => v.published.getTime() <= oneDayAgo)
                    .map(v => v.videoId);
            }

            const seenIds = new Set(cache.seenVideos[cacheKey]);
            const newVideos = videos.filter(v => !seenIds.has(v.videoId));

            // Only notify for videos published within the last 24 hours
            const recentNewVideos = newVideos.filter(v => v.published.getTime() > oneDayAgo);

            for (const video of recentNewVideos) {
                try {
                    // Check if this video is a livestream
                    const isLive = await checkIfLive(video.videoId);

                    let messageTemplate;
                    if (isLive && ytConfig.liveEnabled !== false) {
                        messageTemplate = ytConfig.liveMessage || '🔴 **{channel}** is now **LIVE** on YouTube!\n\n**{title}**\n{url}';
                    } else if (isLive && ytConfig.liveEnabled === false) {
                        // Live alerts disabled, skip this
                        continue;
                    } else {
                        messageTemplate = ytConfig.message || '{channel} uploaded a new video!\n\n**{title}**\n{url}';
                    }

                    const messageText = formatMessage(messageTemplate, video);
                    // Build ping text. Accepts:
                    //   - "everyone" or "@everyone" → @everyone ping
                    //   - "here" or "@here"         → @here ping
                    //   - role ID                   → role mention
                    //   - "<@&id>"                  → role mention (legacy)
                    let pingRole = '';
                    const allowedMentions = { parse: [] };
                    const rawPing = ytConfig.pingRole;
                    if (rawPing) {
                        const lc = String(rawPing).toLowerCase();
                        if (lc === 'everyone' || lc === '@everyone') {
                            pingRole = '@everyone ';
                            allowedMentions.parse.push('everyone');
                        } else if (lc === 'here' || lc === '@here') {
                            pingRole = '@here ';
                            allowedMentions.parse.push('everyone');
                        } else {
                            const idMatch = String(rawPing).match(/(\d{17,20})/);
                            const roleId = idMatch ? idMatch[1] : null;
                            if (roleId) {
                                pingRole = `<@&${roleId}> `;
                                allowedMentions.roles = [roleId];
                            }
                        }
                    }

                    // Components V2 path — preferred. Send the ping as
                    // a separate plain message so it remains pingable
                    // (mentions in v2 containers don't trigger pings on
                    // every client).
                    try {
                        if (pingRole.trim()) {
                            await notifyChannel.send({
                                content: `${pingRole}${messageText.split('\n')[0]}`,
                                allowedMentions,
                            });
                        }
                        const container = buildYouTubeContainer(video, isLive, messageText);
                        await notifyChannel.send({
                            components: [container],
                            flags: MessageFlags.IsComponentsV2,
                        });
                    } catch (sendErr) {
                        // Fallback to legacy embed if the v2 send fails
                        // (e.g. missing permission to use v2 components).
                        const embed = buildYouTubeEmbed(video, isLive);
                        await notifyChannel.send({
                            content: `${pingRole}${messageText}`,
                            embeds: [embed],
                            allowedMentions,
                        });
                    }

                    if (log) log.info(`[Social Notify] YouTube: Notified ${guild.name} about ${video.title} by ${video.channelName}`);
                } catch (e) {
                    if (log) log.error(`[Social Notify] Failed to send notification in ${guild.name}: ${e.message}`);
                }
            }

            // Update seen videos (keep last 50 to prevent unbounded growth)
            const allIds = [...seenIds, ...newVideos.map(v => v.videoId)];
            cache.seenVideos[cacheKey] = allIds.slice(-50);
        }
    }

    saveCache(cache);
}

/**
 * Start the YouTube polling loop.
 */
function startPolling(client, log) {
    if (pollTimer) clearInterval(pollTimer);

    // Initial poll after 30 seconds (let bot fully start)
    setTimeout(() => {
        pollYouTube(client, log).catch(e => {
            if (log) log.error(`[Social Notify] Poll error: ${e.message}`);
        });
    }, 30000);

    // Then poll every 5 minutes
    pollTimer = setInterval(() => {
        pollYouTube(client, log).catch(e => {
            if (log) log.error(`[Social Notify] Poll error: ${e.message}`);
        });
    }, POLL_INTERVAL);

    if (log) log.success('YouTube notification polling started (every 5m)');
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

module.exports = { startPolling, stopPolling, pollYouTube, resolveYouTubeChannelId, checkIfLive };
