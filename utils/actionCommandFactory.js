/**
 * Action Command Factory — generates all 29 action commands (hug, kiss, etc.)
 * from a simple config object. Each command fetches an anime GIF from
 * nekos.best → waifu.pics → Tenor → GIPHY → hardcoded fallbacks.
 *
 * Professional CV2 container layout (3-item MediaGallery):
 *   ┌──────────────────────────────────────────────────────┐
 *   │ <emoji> Action Command Executed                      │
 *   │ -# Author <verb> Target                              │
 *   │ ┌──────────────────────────┐ ┌──────────────────┐   │
 *   │ │                          │ │  Author Avatar   │   │
 *   │ │       Action GIF         │ ├──────────────────┤   │
 *   │ │      (large, left)       │ │  Target Avatar   │   │
 *   │ └──────────────────────────┘ └──────────────────┘   │
 *   │ ──────────────────────────────────────────────────── │
 *   │ <emoji> Author <:Caretright:1521227704953864202> Target  ·  <t:now:R>                │
 *   │ -# <:xnico:…> <:xnico:1486755083390550036> [xNico </>](https://discord.gg/Zs35X7Umak) Development · Action System              │
 *   └──────────────────────────────────────────────────────┘
 */

'use strict';

const {
    SlashCommandBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags
} = require('discord.js');
const { buildErrorResponse } = require('./responseBuilder');
const { resolveUser } = require('./resolveUser');

// ── Brand constants (kept in sync with utils/responseBuilder.js) ─────────
const BRAND_EMOJI = '<:xnico:1521228240440660180>';
const BRAND_LINE  = `${BRAND_EMOJI} **xNico** \`</>\` · Action System`;
const ARROW_EMOJI = '<:Caretright:1521227704953864202>';

// ── Custom emoji map for professional styling ────────────────────────────
const ACTION_EMOJIS = {
    // Love / affection
    hug:       '<a:HeartCross:1521228391531941958>',
    kiss:      '<a:HeartCross:1521228391531941958>',
    cuddle:    '<a:HeartCross:1521228391531941958>',
    handhold:  '<a:HeartCross:1521228391531941958>',
    peck:      '<a:HeartCross:1521228391531941958>',
    snuggle:   '<a:HeartCross:1521228391531941958>',
    blowkiss:  '<a:HeartCross:1521228391531941958>',
    lappillow: '<a:HeartCross:1521228391531941958>',
    carry:     '<a:HeartCross:1521228391531941958>',

    // Happy / positive
    pat:       '<:Star:1521227981685526568>',
    pet:       '<:Star:1521227981685526568>',
    praise:    '<:Star:1521227981685526568>',
    highfive:  '<:Checkedbox:1521227734943269077>',
    wave:      '<:Checkedbox:1521227734943269077>',
    celebrate: '<:Checkedbox:1521227734943269077>',
    salute:    '<:Checkedbox:1521227734943269077>',
    smile:     '<:Checkedbox:1521227734943269077>',
    wink:      '<:Checkedbox:1521227734943269077>',
    thumbsup:  '<:Checkedbox:1521227734943269077>',
    nod:       '<:Checkedbox:1521227734943269077>',
    handshake: '<:Checkedbox:1521227734943269077>',
    happy:     '<:Star:1521227981685526568>',

    // Fun / playful
    dance:     '<:Music:1521228141543165982>',
    laugh:     '<:Music:1521228141543165982>',
    blush:     '<:Music:1521228141543165982>',
    spin:      '<:Music:1521228141543165982>',
    smug:      '<:Lightning:1521227915537285150>',
    think:     '<:Lightning:1521227915537285150>',

    // Attack / playful violence
    bite:      '<:Fire:1521227907647668374>',
    bonk:      '<:Fire:1521227907647668374>',
    slap:      '<:Fire:1521227907647668374>',
    punch:     '<:Fire:1521227907647668374>',
    yeet:      '<:Fire:1521227907647668374>',
    bully:     '<:Fire:1521227907647668374>',
    baka:      '<:Fire:1521227907647668374>',
    shoot:     '<:Fire:1521227907647668374>',
    tableflip: '<:Fire:1521227907647668374>',
    angry:     '<:Fire:1521227907647668374>',

    // Light teasing / interaction
    poke:      '<:Lightning:1521227915537285150>',
    tickle:    '<:Lightning:1521227915537285150>',
    feed:      '<:Lightning:1521227915537285150>',

    // Sad / passive
    cry:       '<:Cancel:1521227723916181644>',
    facepalm:  '<:Cancel:1521227723916181644>',
    stare:     '<:Eye:1521227940480815156>',
    yawn:      '<:Clock:1521228110408847623>',
    stretch:   '<:Clock:1521228110408847623>',
    sleep:     '<:Clock:1521228110408847623>',
    pout:      '<:Cancel:1521227723916181644>',
    shocked:   '<:Eye:1521227940480815156>',
    shrug:     '<:Cancel:1521227723916181644>',
    bored:     '<:Clock:1521228110408847623>',
    confused:  '<:Eye:1521227940480815156>',
};

// Accent colors per action mood
const ACTION_COLORS = {
    love:   0xE91E63,  // pink
    happy:  0x57F287,  // green
    fun:    0xFEE75C,  // yellow
    attack: 0xED4245,  // red
    sad:    0x5865F2,  // blurple
};

const ACTION_MOOD = {
    // Love
    hug: 'love', kiss: 'love', cuddle: 'love', handhold: 'love', peck: 'love',
    snuggle: 'love', blowkiss: 'love', lappillow: 'love', carry: 'love',

    // Happy
    pat: 'happy', pet: 'happy', praise: 'happy', highfive: 'happy', wave: 'happy',
    celebrate: 'happy', salute: 'happy', smile: 'happy', wink: 'happy',
    thumbsup: 'happy', nod: 'happy', handshake: 'happy', happy: 'happy',

    // Fun
    dance: 'fun', laugh: 'fun', blush: 'fun', tickle: 'fun', poke: 'fun', feed: 'fun',
    spin: 'fun', smug: 'fun', think: 'fun',

    // Attack
    bite: 'attack', bonk: 'attack', slap: 'attack', punch: 'attack',
    yeet: 'attack', bully: 'attack', baka: 'attack',
    shoot: 'attack', tableflip: 'attack', angry: 'attack',

    // Sad
    cry: 'sad', facepalm: 'sad', stare: 'sad', yawn: 'sad', stretch: 'sad',
    sleep: 'sad', pout: 'sad', shocked: 'sad', shrug: 'sad', bored: 'sad', confused: 'sad',
};

// ── API endpoint sets ────────────────────────────────────────────────────

const NEKOS_BEST_ENDPOINTS = new Set([
    'hug', 'kiss', 'pat', 'slap', 'bite', 'cuddle', 'poke', 'tickle',
    'highfive', 'wave', 'wink', 'cry', 'dance', 'blush', 'smile',
    'laugh', 'facepalm', 'stare', 'yawn', 'kick', 'happy',
    'thumbsup', 'handhold', 'shoot', 'baka', 'nod', 'nom',
    'nope', 'bored', 'lurk', 'sleep', 'think', 'yes', 'handshake',
    'bonk', 'punch', 'clap', 'angry', 'carry', 'confused', 'feed',
    'pout', 'run', 'salute', 'shake', 'shocked', 'shrug', 'sip',
    'spin', 'tableflip', 'peck', 'blowkiss', 'kabedon', 'lappillow',
    'smug', 'teehee', 'wag', 'yeet'
]);

const WAIFU_PICS_ENDPOINTS = new Set([
    'bite', 'bonk', 'bully', 'cry', 'cuddle', 'dance', 'handhold',
    'happy', 'highfive', 'hug', 'kick', 'kill', 'kiss', 'nom',
    'pat', 'poke', 'punch', 'slap', 'smile', 'wave', 'wink', 'yeet'
]);

// ── GIF fetching (API-only: nekos.best → waifu.pics → Tenor → GIPHY) ─────

// Per-action recent-URL memory so the same user doesn't get the same GIF
// twice in a row even when the upstream APIs return cached responses.
// Bounded to ~12 entries per action so the Map can't grow unbounded.
const _recentByAction = new Map();
const RECENT_LIMIT = 12;
function rememberUrl(actionKey, url) {
    if (!url || !actionKey) return;
    let arr = _recentByAction.get(actionKey);
    if (!arr) { arr = []; _recentByAction.set(actionKey, arr); }
    arr.push(url);
    while (arr.length > RECENT_LIMIT) arr.shift();
}
function isRecent(actionKey, url) {
    if (!url || !actionKey) return false;
    const arr = _recentByAction.get(actionKey);
    return arr ? arr.includes(url) : false;
}

// Common headers — nekos.best and waifu.pics return cleaner data when
// a User-Agent is present, and a few CDNs reject default Node fetch UAs.
const FETCH_HEADERS = {
    'User-Agent': 'xNicoBot/2.0 (Discord Action Commands; +https://github.com/Rajeev0007/xnicobotv2)',
    'Accept': 'application/json',
};

async function fetchAnimeGif(query, _legacyFallbacks, nekosName = null, waifuName = null, actionKey = null) {
    waifuName = waifuName ?? nekosName;
    actionKey = actionKey ?? nekosName ?? waifuName ?? query;

    // Shuffle the lookup order on every call so we don't hammer the
    // same API twice in a row when one of them caches aggressively.
    // nekos.best and waifu.pics both serve random results per request,
    // but a CDN edge can occasionally return identical bytes — adding
    // a tiny cache-bust query param defeats that.
    const cacheBust = `?_=${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

    // 1. nekos.best (free, dedicated anime endpoints)
    if (nekosName && NEKOS_BEST_ENDPOINTS.has(nekosName)) {
        // Up to 2 retries if the URL we get back was just shown to
        // this user. Most of the time the first roll is fine.
        for (let i = 0; i < 3; i++) {
            try {
                const res = await fetch(`https://nekos.best/api/v2/${nekosName}${cacheBust}`, {
                    signal: AbortSignal.timeout(4000),
                    headers: FETCH_HEADERS,
                });
                if (res.ok) {
                    const data = await res.json();
                    const url = data.results?.[0]?.url;
                    if (url && (i === 2 || !isRecent(actionKey, url))) {
                        rememberUrl(actionKey, url);
                        return url;
                    }
                }
            } catch { break; /* timeout — fall through to next provider */ }
        }
    }

    // 2. waifu.pics (free, good coverage)
    if (waifuName && WAIFU_PICS_ENDPOINTS.has(waifuName)) {
        for (let i = 0; i < 3; i++) {
            try {
                const res = await fetch(`https://api.waifu.pics/sfw/${waifuName}${cacheBust}`, {
                    signal: AbortSignal.timeout(4000),
                    headers: FETCH_HEADERS,
                });
                if (res.ok) {
                    const data = await res.json();
                    const url = data.url;
                    if (url && (i === 2 || !isRecent(actionKey, url))) {
                        rememberUrl(actionKey, url);
                        return url;
                    }
                }
            } catch { break; }
        }
    }

    // 3. Tenor API v2 (requires TENOR_API_KEY)
    const tenorKey = process.env.TENOR_API_KEY;
    if (tenorKey && query) {
        try {
            const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${encodeURIComponent(tenorKey)}&client_key=xnicobot&limit=40&media_filter=tinygif,gif&random=true`;
            const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: FETCH_HEADERS });
            if (res.ok) {
                const data = await res.json();
                if (data.results?.length) {
                    // Try a few different items if the first picks happen
                    // to be already-shown URLs.
                    for (let i = 0; i < 3; i++) {
                        const gifUrl = selectMediaUrl(data.results);
                        if (gifUrl && (i === 2 || !isRecent(actionKey, gifUrl))) {
                            rememberUrl(actionKey, gifUrl);
                            return gifUrl;
                        }
                    }
                }
            }
        } catch { /* fall through */ }
    }

    // 4. GIPHY API (requires GIPHY_API_KEY)
    const giphyKey = process.env.GIPHY_API_KEY;
    if (giphyKey && query) {
        try {
            const url = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(giphyKey)}&q=${encodeURIComponent(query)}&limit=30&rating=pg-13`;
            const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: FETCH_HEADERS });
            if (res.ok) {
                const data = await res.json();
                if (data.data?.length) {
                    for (let i = 0; i < 3; i++) {
                        const gifUrl = selectMediaUrl(data.data, true);
                        if (gifUrl && (i === 2 || !isRecent(actionKey, gifUrl))) {
                            rememberUrl(actionKey, gifUrl);
                            return gifUrl;
                        }
                    }
                }
            }
        } catch { /* fall through */ }
    }

    // No source returned a GIF — container will render avatars only.
    return null;
}

function selectMediaUrl(items, isGiphy = false) {
    if (!items?.length) return null;
    const pick = getRandomElement(items);
    if (isGiphy) return pick.images?.original?.url || pick.images?.fixed_height?.url;
    return ['gif', 'tinygif', 'mediumgif'].map(t => pick.media_formats?.[t]?.url).find(u => u);
}

function getRandomElement(array) {
    if (!Array.isArray(array) || array.length === 0) return null;
    return array[Math.floor(Math.random() * array.length)];
}

// ── Container builder ────────────────────────────────────────────────────

function getAvatarUrl(user, size = 256) {
    if (typeof user.displayAvatarURL === 'function') {
        return user.displayAvatarURL({ size, extension: 'png' });
    }
    return user.avatarURL?.({ size }) || user.defaultAvatarURL || 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function buildActionContainer(author, target, verb, emoji, gifUrl, actionName) {
    const customEmoji = ACTION_EMOJIS[actionName] || emoji;
    const mood        = ACTION_MOOD[actionName] || 'happy';
    const accentColor = ACTION_COLORS[mood] || 0x2b2d31;
    const authorAvatar = getAvatarUrl(author, 512);
    const targetAvatar = getAvatarUrl(target, 512);

    const authorName = author.globalName || author.username;
    const targetName = target.globalName || target.username;
    const nowEpoch   = Math.floor(Date.now() / 1000);

    const container = new ContainerBuilder().setAccentColor(accentColor);

    // ── Header ─────────────────────────────────────────────────────────
    // Bold title + subtitle line stating the action sentence.
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${customEmoji} **Action Command Executed**\n` +
            `-# **${escapeMd(authorName)}** ${verb} **${escapeMd(targetName)}**`
        )
    );

    // ── Hero gallery ───────────────────────────────────────────────────
    // Discord's MediaGallery auto-arranges 3 items as [big | small/small].
    // 1: large action GIF (left)   2: author avatar (top-right)
    //                              3: target avatar (bottom-right)
    if (gifUrl) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder()
                    .setURL(gifUrl)
                    .setDescription(`${authorName} ${verb} ${targetName}`),
                new MediaGalleryItemBuilder()
                    .setURL(authorAvatar)
                    .setDescription(`${author.username} — executor`),
                new MediaGalleryItemBuilder()
                    .setURL(targetAvatar)
                    .setDescription(`${target.username} — target`)
            )
        );
    } else {
        // No GIF available — keep the layout clean with just the avatars.
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder()
                    .setURL(authorAvatar)
                    .setDescription(`${author.username} — executor`),
                new MediaGalleryItemBuilder()
                    .setURL(targetAvatar)
                    .setDescription(`${target.username} — target`)
            )
        );
    }

    // ── Meta line (action summary + timestamp) ─────────────────────────
    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `-# ${customEmoji} **${escapeMd(author.username)}** ${ARROW_EMOJI} ` +
            `**${escapeMd(target.username)}**  ·  <t:${nowEpoch}:R>`
        )
    );

    // ── Branded footer ─────────────────────────────────────────────────
    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${BRAND_LINE}`)
    );

    return container;
}

// ── Markdown helper ──────────────────────────────────────────────────────
// Escapes characters that would otherwise break Discord markdown when a
// user has special chars in their display name (e.g. `_` `*` `~` `|` `\`).
function escapeMd(str) {
    if (!str) return '';
    return String(str).replace(/([\\*_~`|>])/g, '\\$1');
}

// ── Solo container (no target, e.g. /sleep, /pout, /tableflip) ───────────
function buildSoloActionContainer(author, verb, emoji, gifUrl, actionName) {
    const customEmoji = ACTION_EMOJIS[actionName] || emoji;
    const mood        = ACTION_MOOD[actionName] || 'happy';
    const accentColor = ACTION_COLORS[mood] || 0x2b2d31;
    const authorAvatar = getAvatarUrl(author, 512);
    const authorName   = author.globalName || author.username;
    const nowEpoch     = Math.floor(Date.now() / 1000);

    const container = new ContainerBuilder().setAccentColor(accentColor);

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${customEmoji} **Action Command Executed**\n` +
            `-# **${escapeMd(authorName)}** ${verb}`
        )
    );

    if (gifUrl) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder()
                    .setURL(gifUrl)
                    .setDescription(`${authorName} ${verb}`),
                new MediaGalleryItemBuilder()
                    .setURL(authorAvatar)
                    .setDescription(`${author.username} — executor`)
            )
        );
    } else {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder()
                    .setURL(authorAvatar)
                    .setDescription(`${author.username} — executor`)
            )
        );
    }

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `-# ${customEmoji} **${escapeMd(author.username)}**  ·  <t:${nowEpoch}:R>`
        )
    );

    container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${BRAND_LINE}`)
    );

    return container;
}

// ── Factory ──────────────────────────────────────────────────────────────

function createActionCommand(opts) {
    const nekosName = opts.nekosEndpoint ?? opts.name;
    const waifuName = opts.waifuEndpoint ?? opts.name;
    const isSolo    = opts.solo === true;

    const slash = new SlashCommandBuilder()
        .setName(opts.name)
        .setDescription(opts.description);

    if (!isSolo) {
        slash.addUserOption(option =>
            option.setName('user')
                .setDescription(`The user to ${opts.name}`)
                .setRequired(true));
    }

    return {
        data: slash,
        prefix: opts.name,
        description: opts.description,
        usage: isSolo ? opts.name : `${opts.name} <@user>`,
        category: 'action',
        aliases: opts.aliases || [],
        dmAllowed: true,

        async execute(interaction) {
            // ── Solo action path ───────────────────────────────────────
            if (isSolo) {
                await interaction.deferReply();
                const gif = await fetchAnimeGif(opts.searchQuery, null, nekosName, waifuName, opts.name);
                const container = buildSoloActionContainer(
                    interaction.user, opts.verb, opts.emoji, gif, opts.name
                );
                return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // ── Targeted action path ───────────────────────────────────
            const target = interaction.options.getUser('user');

            if (!opts.selfAllowed && target.id === interaction.user.id) {
                const errEmoji = ACTION_EMOJIS[opts.name] || opts.emoji;
                return interaction.reply({
                    components: [buildErrorResponse(
                        `Can't ${opts.name} Yourself`,
                        opts.selfMessage || `${errEmoji} Mention someone else to ${opts.name}!`
                    )],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }

            await interaction.deferReply();
            const gif = await fetchAnimeGif(opts.searchQuery, null, nekosName, waifuName, opts.name);
            const container = buildActionContainer(
                interaction.user, target, opts.verb, opts.emoji, gif, opts.name
            );
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        },

        async executePrefix(message, args) {
            // ── Solo action path ───────────────────────────────────────
            if (isSolo) {
                const gif = await fetchAnimeGif(opts.searchQuery, null, nekosName, waifuName, opts.name);
                const container = buildSoloActionContainer(
                    message.author, opts.verb, opts.emoji, gif, opts.name
                );
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            // ── Targeted action path ───────────────────────────────────
            const target = await resolveUser(message, args);

            if (!target) {
                const errEmoji = ACTION_EMOJIS[opts.name] || opts.emoji;
                return message.reply({
                    components: [buildErrorResponse(
                        'No User Mentioned',
                        `${errEmoji} Mention someone to ${opts.name}!`,
                        `**Usage:** \`-${opts.name} @user\``
                    )],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            if (!opts.selfAllowed && target.id === message.author.id) {
                const errEmoji = ACTION_EMOJIS[opts.name] || opts.emoji;
                return message.reply({
                    components: [buildErrorResponse(
                        `Can't ${opts.name} Yourself`,
                        opts.selfMessage || `${errEmoji} Mention someone else to ${opts.name}!`
                    )],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            const gif = await fetchAnimeGif(opts.searchQuery, null, nekosName, waifuName, opts.name);
            const container = buildActionContainer(
                message.author, target, opts.verb, opts.emoji, gif, opts.name
            );
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    };
}

module.exports = {
    createActionCommand,
    fetchAnimeGif,
    buildActionContainer,
    buildSoloActionContainer,
    getRandomElement,
    selectMediaUrl
};
