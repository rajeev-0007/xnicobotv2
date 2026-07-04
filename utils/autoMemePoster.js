'use strict';

/**
 * AutoMeme Poster
 * ───────────────────────────────────────────────────────────────────
 * Per-guild scheduled meme delivery. Each guild can:
 *   • turn it on/off
 *   • pick a target channel
 *   • pick a category preset (english | hindi | anime | gaming | mixed)
 *   • add custom subreddits (premium)
 *   • set an interval (minutes) — 30..1440
 *   • set a ping (none | here | everyone | role-id)
 *   • require an NSFW channel for posting (and only then will NSFW
 *     subs be allowed — by default we filter NSFW out aggressively)
 *
 * Persistence: store key `automeme`
 *   {
 *     [guildId]: {
 *       enabled, channelId,
 *       category,                // 'english' | 'hindi' | ... | 'mixed' | 'custom'
 *       customSubs: [string],
 *       intervalMinutes,         // integer
 *       lastPostedAt,            // ms timestamp
 *       ping: { type, id? },     // { type: 'none'|'here'|'everyone'|'role', id? }
 *       allowNsfw,               // boolean — only honored when channel is NSFW
 *       seenIds,                 // array of last 50 reddit post IDs (dedup)
 *       totalPosted,             // counter
 *       lastError                // string|null  (visible in /automeme status)
 *     }
 *   }
 *
 * Scheduler tick runs every 60s. Each tick scans enabled guilds and
 * posts to any whose `lastPostedAt + intervalMinutes` has elapsed.
 *
 * Free tier:
 *   - intervalMinutes >= 60
 *   - presets only (no customSubs)
 *   - up to 1 active guild config
 *
 * Premium tier (user OR server premium):
 *   - intervalMinutes >= 30
 *   - up to 5 customSubs
 *   - per-guild config persists indefinitely
 *
 * Premium gating happens in the COMMAND module (commands/automation/automeme.js)
 * — this file only respects what's persisted, so an expired premium server
 * keeps posting on its current schedule until an admin edits anything.
 */

const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

const STORE = 'automeme';
const MAX_SEEN = 50;
const TICK_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 6_000;

// Curated, family-safe subreddit pools per preset.
const PRESETS = {
    english: ['memes', 'dankmemes', 'me_irl', 'wholesomememes', 'meme', 'funny'],
    hindi:   ['IndianMeyMeys', 'SaimanSays', 'IndianDankMemes', 'desimemes'],
    anime:   ['Animemes', 'animememes', 'goodanimemes'],
    gaming:  ['gaming', 'gamingmemes', 'pcmasterrace'],
    mixed:   [
        'memes', 'dankmemes', 'me_irl', 'wholesomememes', 'meme',
        'Animemes', 'gaming', 'IndianMeyMeys',
    ],
};

/* ─────────────────────────── store helpers ─────────────────────── */

function loadAll() {
    if (!jsonStore.has(STORE)) {
        jsonStore.write(STORE, {});
        return {};
    }
    const data = jsonStore.read(STORE);
    return (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
}

function saveAll(data) {
    jsonStore.write(STORE, data);
}

function defaultGuildConfig() {
    return {
        enabled:          false,
        channelId:        null,
        category:         'english',
        customSubs:       [],
        intervalMinutes:  60,
        lastPostedAt:     0,
        ping:             { type: 'none' },
        allowNsfw:        false,
        seenIds:          [],
        totalPosted:      0,
        lastError:        null,
    };
}

function getGuildConfig(guildId) {
    const all = loadAll();
    const cfg = all[guildId];
    if (!cfg) return defaultGuildConfig();
    // Defensive merge so legacy entries without new keys don't crash.
    return { ...defaultGuildConfig(), ...cfg };
}

function saveGuildConfig(guildId, patch) {
    const all = loadAll();
    const next = { ...defaultGuildConfig(), ...(all[guildId] || {}), ...patch };
    all[guildId] = next;
    saveAll(all);
    return next;
}

function deleteGuildConfig(guildId) {
    const all = loadAll();
    if (all[guildId]) {
        delete all[guildId];
        saveAll(all);
    }
}

/* ─────────────────────────── reddit fetch ──────────────────────── */

/**
 * Resolve which subreddit pool to use based on a guild config.
 */
function resolvePool(cfg) {
    if (cfg.category === 'custom') {
        const subs = Array.isArray(cfg.customSubs) ? cfg.customSubs.filter(Boolean) : [];
        return subs.length ? subs : PRESETS.english;
    }
    return PRESETS[cfg.category] || PRESETS.english;
}

/**
 * Fetch a single fresh meme post.
 *
 * Strategy:
 *   1. Pick a random sub from the pool.
 *   2. Hit Reddit JSON listing with hot+50.
 *   3. Filter for image posts that aren't sticky / over_18 (unless allowed)
 *      and aren't already in `seenIds`.
 *   4. Pick one at random.
 *
 * Returns { id, title, url, subreddit, author, ups, permalink, nsfw }
 * or null on hard failure.
 */
async function fetchFreshMeme(cfg) {
    const pool = resolvePool(cfg);
    if (!pool.length) return null;

    // Try up to 3 different subs before giving up — a single sub may be
    // private, banned, or all-stickied at the moment.
    const tried = new Set();
    for (let attempt = 0; attempt < 3; attempt++) {
        const sub = pool[Math.floor(Math.random() * pool.length)];
        if (tried.has(sub)) continue;
        tried.add(sub);

        try {
            const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=50`;
            const res = await fetch(url, {
                headers: { 'User-Agent': 'xNicoBot/2.0 AutoMeme' },
                signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (!res.ok) continue;

            const json = await res.json();
            const children = json?.data?.children || [];

            const candidates = children
                .map(c => c.data)
                .filter(p => !!p)
                .filter(p => !p.stickied)
                .filter(p => p.post_hint === 'image' && p.url)
                .filter(p => /\.(jpe?g|png|gif|webp)$/i.test(p.url) ||
                             /^https:\/\/i\.redd\.it\//.test(p.url) ||
                             /^https:\/\/i\.imgur\.com\//.test(p.url))
                .filter(p => cfg.allowNsfw ? true : !p.over_18)
                .filter(p => !cfg.seenIds?.includes(p.id));

            if (!candidates.length) continue;

            const pick = candidates[Math.floor(Math.random() * candidates.length)];
            return {
                id:        pick.id,
                title:     pick.title || 'Untitled',
                url:       pick.url,
                subreddit: pick.subreddit || sub,
                author:    pick.author || 'unknown',
                ups:       Number(pick.ups || 0),
                permalink: `https://reddit.com${pick.permalink}`,
                nsfw:      !!pick.over_18,
            };
        } catch (err) {
            // Network blip — try next sub.
            continue;
        }
    }

    return null;
}

/* ─────────────────────────── post one ──────────────────────────── */

const {
    ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
    SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    MessageFlags, PermissionFlagsBits,
} = require('discord.js');

function buildMemeContainer(meme, cfg) {
    const container = new ContainerBuilder().setAccentColor(0xFF4500);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### ${meme.title.slice(0, 200)}\n` +
        `-# r/${meme.subreddit} · u/${meme.author} · 👍 ${meme.ups.toLocaleString()}` +
        (meme.nsfw ? ' · 🔞 NSFW' : ''),
    ));

    container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(meme.url)),
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
    );

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Source')
            .setStyle(ButtonStyle.Link)
            .setURL(meme.permalink)
            .setEmoji('<:Attach:1521228039135170722>'),
        new ButtonBuilder()
            .setCustomId(`automeme_next_${cfg.category}`)
            .setLabel('Another')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('<:Refresh:1521227946441052420>'),
        new ButtonBuilder()
            .setCustomId('automeme_settings')
            .setLabel('Settings')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('<:Settings:1521227767780343879>'),
    );
    container.addActionRowComponents(row);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `-# AutoMeme · ${cfg.category} · every ${cfg.intervalMinutes}m`,
    ));

    return container;
}

function pingPrefix(cfg) {
    const p = cfg.ping || { type: 'none' };
    if (p.type === 'everyone') return '@everyone ';
    if (p.type === 'here')     return '@here ';
    if (p.type === 'role' && p.id) return `<@&${p.id}> `;
    return '';
}

/**
 * Attempt one post. Returns true on success. Updates lastPostedAt and
 * pushes the post id to seenIds on success. On failure, sets lastError.
 */
async function postOnce(client, guildId, cfg, { manual = false } = {}) {
    const all = loadAll();
    const live = all[guildId];
    if (!live) return false;

    if (!cfg.channelId) {
        live.lastError = 'No channel configured.';
        saveAll(all);
        return false;
    }

    const channel = await client.channels.fetch(cfg.channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) {
        live.lastError = 'Channel missing or not text-based.';
        saveAll(all);
        return false;
    }

    // Bot permission preflight — saves the embarrassing 50013 spam in logs.
    const me = channel.guild?.members?.me;
    const required = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
    ];
    if (me && !channel.permissionsFor(me)?.has(required)) {
        live.lastError = 'Missing channel permissions.';
        saveAll(all);
        return false;
    }

    // Honor allowNsfw only when the target channel is actually NSFW.
    const channelIsNsfw = !!channel.nsfw;
    const effectiveCfg = { ...cfg, allowNsfw: cfg.allowNsfw && channelIsNsfw };

    const meme = await fetchFreshMeme(effectiveCfg);
    if (!meme) {
        live.lastError = 'No fresh meme found this cycle.';
        saveAll(all);
        return false;
    }

    const container = buildMemeContainer(meme, effectiveCfg);
    const ping = pingPrefix(cfg);

    try {
        const payload = {
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: cfg.ping?.type === 'role'
                ? { roles: cfg.ping.id ? [cfg.ping.id] : [] }
                : cfg.ping?.type === 'everyone' || cfg.ping?.type === 'here'
                    ? { parse: ['everyone'] }
                    : { parse: [] },
        };
        if (ping) payload.content = ping.trim();

        await channel.send(payload);

        live.lastPostedAt = Date.now();
        live.totalPosted = (live.totalPosted || 0) + 1;
        live.seenIds = [...(live.seenIds || []), meme.id].slice(-MAX_SEEN);
        live.lastError = null;
        saveAll(all);
        return true;
    } catch (err) {
        live.lastError = `Send failed: ${err.message?.slice(0, 100) || 'unknown'}`;
        saveAll(all);
        if (!manual) {
            log.error(`[AutoMeme] Send failed in guild ${guildId}: ${err.message}`);
        }
        return false;
    }
}

/* ─────────────────────────── scheduler ─────────────────────────── */

let _tickHandle = null;

async function tick(client) {
    const all = loadAll();
    const now = Date.now();
    const due = [];

    for (const [guildId, raw] of Object.entries(all)) {
        const cfg = { ...defaultGuildConfig(), ...raw };
        if (!cfg.enabled || !cfg.channelId) continue;

        const minMs = cfg.intervalMinutes * 60 * 1000;
        const since = now - (cfg.lastPostedAt || 0);
        if (since < minMs) continue;

        // Skip if guild isn't in the bot's cache (shard/sweep ejected it).
        if (!client.guilds.cache.has(guildId)) continue;
        due.push([guildId, cfg]);
    }

    if (!due.length) return;

    // Stagger sequentially with a small gap to avoid burst-posting all guilds
    // in the same JS task — this keeps Reddit happier.
    for (const [guildId, cfg] of due) {
        await postOnce(client, guildId, cfg).catch(() => {});
        await new Promise(r => setTimeout(r, 800));
    }
}

function startScheduler(client) {
    if (_tickHandle) return;
    // Fire first tick after 60s to let the bot fully boot.
    setTimeout(() => { tick(client).catch(() => {}); }, 60 * 1000);
    _tickHandle = setInterval(() => { tick(client).catch(() => {}); }, TICK_MS);
    if (_tickHandle.unref) _tickHandle.unref();
    log.success('[AutoMeme] Scheduler started — checking every 60s');
}

function stopScheduler() {
    if (_tickHandle) {
        clearInterval(_tickHandle);
        _tickHandle = null;
    }
}

/* ─────────────────────────── exports ───────────────────────────── */

module.exports = {
    STORE,
    PRESETS,
    defaultGuildConfig,
    getGuildConfig,
    saveGuildConfig,
    deleteGuildConfig,
    fetchFreshMeme,
    buildMemeContainer,
    postOnce,
    startScheduler,
    stopScheduler,
};
