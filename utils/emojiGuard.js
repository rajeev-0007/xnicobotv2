/**
 * emojiGuard.js — Runtime safety for Discord custom emojis.
 *
 * Discord rejects components that reference custom emojis the bot cannot use.
 * (COMPONENT_INVALID_EMOJI). Older versions of this codebase referenced emojis
 * from servers the bot is no longer in.  This guard installs a single source
 * of truth for valid IDs and patches ButtonBuilder.setEmoji + similar setters
 * so any invalid ID is silently replaced with a safe Unicode fallback before
 * the payload reaches Discord.
 *
 * Two behaviours:
 *   1. Static fallback map (BAD_EMOJI_FALLBACKS) — replaces known-bad IDs
 *      with Unicode emojis chosen to match the original meaning.
 *   2. Runtime client check — once Client is logged in, any custom emoji
 *      whose ID is NOT present in client.emojis.cache is replaced with the
 *      fallback in DEFAULT_FALLBACK.
 */

const DEFAULT_FALLBACK = '<:Star:1521227981685526568>';

// Lazy-loaded emoji-regex (matches Unicode emoji codepoints/sequences).
// Used to filter out characters that *look* like a glyph but aren't a
// real emoji (e.g. the typographical stars '✧' / '✦' / '𖤐' / '𖤍').
// Discord's setEmoji + select-menu option.emoji require either a
// valid <a?:NAME:ID> custom emoji or a true Unicode emoji — anything
// else fails validation as INVALID_FORM_BODY.
let _emojiRegex = null;
function _getEmojiRegex() {
    if (_emojiRegex) return _emojiRegex;
    try {
        const factory = require('emoji-regex');
        _emojiRegex = factory();
    } catch {
        _emojiRegex = null;
    }
    return _emojiRegex;
}

/**
 * Returns true if `str` is a single, complete Unicode emoji that
 * Discord will accept. Returns false for typographical symbols like
 * '✧' (U+2727), '✦' (U+2726), '𖤐' (U+16D90), '𖤍' (U+16D8D),
 * letters, digits, punctuation, etc.
 */
function isUnicodeEmoji(str) {
    if (typeof str !== 'string' || str.length === 0) return false;
    const re = _getEmojiRegex();
    if (re) {
        re.lastIndex = 0;
        const m = re.exec(str);
        return !!m && m[0] === str;
    }
    // Fallback when emoji-regex isn't available: treat anything that's
    // *purely* in known emoji blocks (Misc Symbols & Pictographs +
    // Emoticons + Transport + Supplemental + Dingbats with VS-16) as
    // an emoji. Conservative — false negatives are fine here.
    const codePoints = [...str].map(c => c.codePointAt(0));
    return codePoints.every(cp =>
        (cp >= 0x1F300 && cp <= 0x1FAFF) ||      // pictographs / emoticons / transport / supplemental
        (cp >= 0x2600 && cp <= 0x26FF && str.includes('\uFE0F')) || // misc symbols (with VS-16)
        (cp >= 0x2700 && cp <= 0x27BF && str.includes('\uFE0F')) || // dingbats (with VS-16)
        cp === 0x200D || cp === 0xFE0F           // ZWJ + VS-16 joiners
    );
}

// Specific bad-id → semantic fallback map.
// IDs sourced from cross-server emojis the bot lost access to.
const BAD_EMOJI_FALLBACKS = {
    // music / streaming
    '1435331502710722592': '📺',   // YoutubeLive
    '1435332317341159424': '🟠',   // soundCloud
    '1435332305919938680': '🍎',   // applemusic
    '1473663456182800446': '🟢',   // spotify
    '1435331508989636642': '🔴',   // live
    '1479681956273852607': '⏳',   // Load (animated)
    '1479349681049043096': '📜',   // queue
    '1479349855217516544': '⏹',   // qended
    // hearts / likes / dislikes
    '1473038488893526016': '❤️',  // Heartalt
    '1473038965111259307': '👍',   // Like
    '1473038962762317834': '👎',   // Dislike
    // generic ui (older server emojis)
    '1417485105437478943': '◀️',   // back
    '1417485139595890728': '▶️',   // next
    '1415659106735599646': '<:Checkedbox:1521227734943269077>',   // correct
    '1473038659514007616': '❤️',  // Heart
    '1417581304299741184': '👤',   // user
    '1430999565011648512': '⚪',   // offline
    '1415659283017707640': '⚙️',  // settings
    '1415658900384096346': '❓',   // help
    '1415659000846159903': '⚠️',  // warning
    '1415659155809280161': 'ℹ️',  // info
    '1417583659531243612': '·',    // Dot
    '1506015728871149770': '⏳',   // loading (deprecated)
    // misc external-server crowns / staff / boost / nitro
    '1386229254403919903': '👑',   // wcrown
    '1476259690315780229': '🛡️',  // staff
    '1388164213988192370': '🚀',   // nitro_boost
    '1386229251895857304': '📷',   // wcamera
    '1386229297827545089': '🚀',   // nitroboost
    '1435683544302223420': '📣',   // announce
    // discord brand emojis (not always available)
    '1415659385635737734': '▶️',   // play
    '1415659399703171183': '⏸',   // pause
    '1415659247017922642': '⏹',   // stop
    '1415659339334811698': '⏮',   // rewind
    '1415659354895683626': '⏭',   // forward
    '1417522689375207476': '🔚',   // end
    '1417523546099548292': '🔁',   // loop1
    '1415659428954505226': '🔊',   // volume
    '1415659415243325484': '🔇',   // mute
    '1415659151794634849': '📜',   // read
    '1415659276923437096': '🛡️',  // shield1
    '1415659902168207432': '⚙️',  // setting
    '1415659478103232562': '🔨',   // moderate
    '1415659108249374830': '⚠️',  // error
    '1415658909066067978': '🤖',   // discord
    '1415659003194904586': '🎮',   // games
    '1415659874729201735': '📁',   // folder
    '1415658776488448080': '🎉',   // giveaway
    '1415659457760854026': '📈',   // up
    '1415659121927262258': '<:Cancel:1521227723916181644>',   // wrong
    '1423904534928953426': '💬',   // messages
    '1426523323646345309': '📌',   // pin
    '1426523275206332426': '✉️',   // mail
    '1454871326144725066': '🎨',   // war/palette
    '1455551935716393080': '<:Star:1521227981685526568>',   // shine
    '1455550639584186439': '<:Checkedbox:1521227734943269077>',   // verify
    '1388078753481101353': '🔗',   // glazewhite_link
    '1388078703724204142': '💎',   // 2_boost_blue
    '1386229088141967390': '🎙️',  // wvoice
    '1386229066104836126': '·',    // wdot
};

// Trusted prefix ranges. Anything matching one of these ID prefixes is
// considered valid UNLESS it appears in BAD_EMOJI_FALLBACKS (specific
// known-bad IDs even within trusted servers, e.g. emojis the bot lost
// access to).
const KNOWN_GOOD_PREFIXES = [
    '147303',                             // bot's main server (147303xxx — Settings, Cancel, Music, etc.)
    '14733',                              // 1473370101…, 1473377877… (dnd, Money, …)
    '14735',                              // 1473546762… (topgg)
    '147336',                             // 1473367388…, 1473368718…, 1473369837… (banhammer, bots, online)
    '14555',                              // partner emoji server (xnico)
    '14867',                              // 1486755… (xnico extra)
    '14852',                              // badge server
    '14797',                              // animated rockets
    '15060',                              // Crown
    '15212',                              // bot's own APPLICATION emojis (1521227…/1521228…)
];

// Whitelist: emoji IDs that we KNOW are valid.
const KNOWN_GOOD_IDS = new Set([
    '1473038797540298792', // Lightning
    '1473039575302803629', // Copy
    '1473038624172937287', // Inforect
]);

let runtimeClient = null;

// Application-emoji awareness. Application emojis are NOT in
// client.emojis.cache (that's guild emojis only), so without this the guard
// would treat the bot's own uploaded app emojis as invalid and replace them
// with fallbacks. Populated by attachClient() once the client is ready.
const appEmojiIds = new Set();
const appEmojiByName = new Map(); // nameLower -> { id, animated, name }

function isWhitelistedId(id) {
    if (!id) return false;
    if (BAD_EMOJI_FALLBACKS[id]) return false; // explicit bad list always wins
    if (appEmojiIds.has(id)) return true;       // our own application emoji
    if (KNOWN_GOOD_IDS.has(id)) return true;
    return KNOWN_GOOD_PREFIXES.some(p => id.startsWith(p));
}

function clientHasEmoji(id) {
    if (appEmojiIds.has(id)) return true;       // application emoji — always valid
    if (!runtimeClient || !runtimeClient.emojis?.cache) return null;
    return runtimeClient.emojis.cache.has(id);
}

/**
 * Given an emoji NAME, return the current application emoji tag
 * (`<a?:name:id>`) for it, or null if the app has no such emoji.
 *
 * This is what makes components token-portable: when a hardcoded tag
 * references an id that isn't valid on THIS application (e.g. after
 * deploying with a new token), we re-resolve it by name to whatever id
 * the running application uses, instead of dropping to a Unicode fallback.
 */
function remapByName(name) {
    if (!name) return null;
    const hit = appEmojiByName.get(String(name).toLowerCase());
    if (!hit) return null;
    return `<${hit.animated ? 'a' : ''}:${hit.name}:${hit.id}>`;
}

// Matches custom emoji tags in free text for runtime ID remapping.
const REMAP_TAG_RE = /<(a?):(\w{2,32}):(\d{15,22})>/g;

/**
 * Rewrite every custom-emoji tag in a string to the CURRENT application's
 * emoji id for that name. This is what makes emojis work after deploying
 * with a NEW token: the emoji-sync uploads the bundled images to the new
 * application (same names, new ids), and this remaps the hardcoded ids in
 * outgoing text to those new ids automatically.
 *
 * Safe by construction: only remaps tags whose NAME exists as an application
 * emoji, and only when the id actually differs — so on the current app it's a
 * no-op, and unknown/guild emojis are left untouched.
 *
 * @param {string} text
 * @returns {string}
 */
function remapText(text) {
    if (!text || typeof text !== 'string' || appEmojiByName.size === 0) return text;
    if (text.indexOf('<') === -1) return text;
    return text.replace(REMAP_TAG_RE, (full, a, name, id) => {
        const hit = appEmojiByName.get(name.toLowerCase());
        if (!hit || hit.id === id) return full;
        return `<${hit.animated ? 'a' : ''}:${hit.name}:${hit.id}>`;
    });
}

/**
 * Sanitize a single emoji string.
 * Accepts:
 *   - Unicode emoji (validated; non-emoji glyphs fall back to null)
 *   - <a?:name:id> string
 *   - { id, name, animated } object
 *   - bare numeric id
 * Returns: the same shape as input, or null/fallback when the value
 *          is not a Discord-valid emoji.
 *
 * Returning `null` is intentional — `ButtonBuilder#setEmoji(null)` and
 * select-menu `option.emoji = null` are both valid no-ops, so this
 * never breaks a component that previously had a bad glyph; it just
 * renders the button/option without an icon instead of failing the
 * whole payload with INVALID_FORM_BODY.
 *
 * Precedence (in order):
 *   1. Explicit `BAD_EMOJI_FALLBACKS[id]` — known-bad → unicode swap
 *   2. Live client cache (`clientHasEmoji`) — most authoritative
 *      • cache says HAS  → keep the input as-is
 *      • cache says MISS → swap for `DEFAULT_FALLBACK`
 *   3. `KNOWN_GOOD_IDS` set — explicit whitelist
 *   4. `KNOWN_GOOD_PREFIXES` heuristic — only used when the client
 *      cache hasn't populated yet (e.g. during early startup before
 *      `attachClient` is called). Once the cache is live, step 2
 *      always overrides this so emojis the bot lost access to don't
 *      slip through.
 */
function sanitizeEmoji(input) {
    if (input == null) return input;

    // Object form
    if (typeof input === 'object') {
        const id = input.id ? String(input.id) : null;
        if (!id) {
            // Unicode-only object: validate the name field too.
            if (typeof input.name === 'string' && !isUnicodeEmoji(input.name)) {
                return null;
            }
            return input;
        }
        if (BAD_EMOJI_FALLBACKS[id]) return BAD_EMOJI_FALLBACKS[id];
        const has = clientHasEmoji(id);
        if (has === true) return input;
        if (has === false) return remapByName(input.name) || DEFAULT_FALLBACK;
        // cache not available yet — fall back to heuristic
        if (isWhitelistedId(id)) return input;
        return remapByName(input.name) || DEFAULT_FALLBACK;
    }

    if (typeof input !== 'string') return input;

    // Plain numeric id (used wrongly in a few places)
    if (/^\d{15,22}$/.test(input)) {
        if (BAD_EMOJI_FALLBACKS[input]) return BAD_EMOJI_FALLBACKS[input];
        const has = clientHasEmoji(input);
        if (has === true) return `<:emoji:${input}>`;
        if (has === false) return DEFAULT_FALLBACK;
        if (isWhitelistedId(input)) return `<:emoji:${input}>`;
        return DEFAULT_FALLBACK;
    }

    // <a?:name:id>
    const m = input.match(/^<(a?):([^:]+):(\d{15,22})>$/);
    if (m) {
        const id = m[3];
        if (BAD_EMOJI_FALLBACKS[id]) return BAD_EMOJI_FALLBACKS[id];
        const has = clientHasEmoji(id);
        if (has === true) return input;
        if (has === false) return remapByName(m[2]) || DEFAULT_FALLBACK;
        // cache not available yet — fall back to heuristic
        if (isWhitelistedId(id)) return input;
        return remapByName(m[2]) || DEFAULT_FALLBACK;
    }

    // Plain unicode string — validate it's an actual emoji.
    return isUnicodeEmoji(input) ? input : null;
}

function attachClient(client) {
    runtimeClient = client;
    // Load the bot's application emojis so the guard treats them as valid
    // and can remap hardcoded tags by name. Non-blocking; the prefix
    // heuristic covers the brief window before this resolves.
    loadApplicationEmojis(client).catch(() => {});
}

/**
 * Fetch the running application's emojis into the local registry.
 * Safe to call repeatedly (e.g. to refresh after an auto-sync upload).
 */
async function loadApplicationEmojis(client) {
    try {
        if (!client?.application?.emojis?.fetch) return;
        const coll = await client.application.emojis.fetch();
        appEmojiIds.clear();
        appEmojiByName.clear();
        for (const e of coll.values()) {
            appEmojiIds.add(e.id);
            appEmojiByName.set(e.name.toLowerCase(), { id: e.id, animated: !!e.animated, name: e.name });
        }
    } catch {
        /* leave registry empty — heuristic + prefix handle it */
    }
}

/**
 * Patch discord.js builders so any setEmoji call routes through sanitizeEmoji.
 * Idempotent — safe to call multiple times.
 */
function installPatches() {
    let djs;
    try { djs = require('discord.js'); }
    catch { return; }

    const targets = [
        djs.ButtonBuilder,
        djs.SelectMenuOptionBuilder,
        djs.StringSelectMenuOptionBuilder,
    ].filter(Boolean);

    for (const T of targets) {
        const proto = T.prototype;
        if (!proto || proto.__emojiGuardPatched) continue;
        const original = proto.setEmoji;
        if (typeof original !== 'function') continue;
        proto.setEmoji = function patchedSetEmoji(emoji) {
            return original.call(this, sanitizeEmoji(emoji));
        };
        proto.__emojiGuardPatched = true;
    }

    // Patch the option-list mutators on every select-menu builder we know.
    // A bad emoji in a single option still poisons the whole component
    // payload, so this needs to fire for `addOptions`, `setOptions`, and
    // `spliceOptions` regardless of which select builder the caller used.
    const selectBuilders = [
        djs.StringSelectMenuBuilder,
        djs.SelectMenuBuilder,           // legacy alias still exported in djs v14
        djs.UserSelectMenuBuilder,
        djs.RoleSelectMenuBuilder,
        djs.ChannelSelectMenuBuilder,
        djs.MentionableSelectMenuBuilder,
    ].filter(Boolean);

    for (const B of selectBuilders) {
        const sm = B.prototype;
        if (!sm || sm.__emojiGuardPatched) continue;
        for (const fn of ['addOptions', 'setOptions', 'spliceOptions']) {
            const orig = sm[fn];
            if (typeof orig !== 'function') continue;
            sm[fn] = function patchedSelectFn(...args) {
                const fixed = args.map(a => Array.isArray(a) ? a.map(fixOpt) : fixOpt(a));
                return orig.apply(this, fixed);
            };
        }
        sm.__emojiGuardPatched = true;
    }
}

// Coerce any emoji value (object / "<:name:id>" / "<a:name:id>" / unicode)
// into the option-data OBJECT form select menus require. Raw select
// option data must carry `emoji` as an object ({ id?, name?, animated? })
// — a string or null fails @discordjs/builders validation and poisons
// the whole component ("Received one or more errors").
function toEmojiObject(v) {
    if (!v) return undefined;
    if (typeof v === 'object') {
        return (v.id || v.name) ? v : undefined;
    }
    if (typeof v === 'string') {
        const m = v.match(/^<(a?):([^:]+):(\d{15,22})>$/);
        if (m) return { id: m[3], name: m[2], animated: m[1] === 'a' };
        // Plain unicode glyph
        return { name: v };
    }
    return undefined;
}

function fixOpt(opt) {
    if (!opt || typeof opt !== 'object') return opt;
    if ('emoji' in opt) {
        const obj = toEmojiObject(sanitizeEmoji(opt.emoji));
        // Always end up with a valid emoji OBJECT or no emoji key at all —
        // never null and never a raw string, both of which crash the
        // select-menu option validator.
        if (obj) opt.emoji = obj;
        else delete opt.emoji;
    }
    return opt;
}

module.exports = {
    sanitizeEmoji,
    isUnicodeEmoji,
    attachClient,
    loadApplicationEmojis,
    remapByName,
    remapText,
    installPatches,
    BAD_EMOJI_FALLBACKS,
    DEFAULT_FALLBACK,
};
