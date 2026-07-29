'use strict';

/**
 * messagePlaceholders — the single placeholder engine.
 *
 * ═══ WHY THIS EXISTS ═══
 * There were FOUR independent implementations:
 *
 *   utils/interactionHandlers.js:2336   ~54 placeholders   used by the RUNTIME send
 *   commands/automation/welcomer.js:1044 ~33 placeholders   used by the welcomer PREVIEW
 *   commands/utility/message-builder.js:161 ~17 placeholders
 *   utils/actionMessageBuilder.js:65    ~17 placeholders (byte-identical copy of ^)
 *
 * They disagreed, and the disagreements were user-visible:
 *
 *   1. {separator} / {separator:small|medium|large} existed ONLY in the welcomer
 *      preview implementation. An admin would design a welcome message with a
 *      divider, see it render correctly in the preview, and then real joining
 *      members received the literal text "{separator}". Preview lied about
 *      production, in the damaging direction.
 *   2. {usertag}, {nickname}, {discriminator}, {categories}, {emojicount},
 *      {roletotal}, {serverbanner}, {usercreated:date} and the other `:variant`
 *      forms worked at runtime but rendered literally in the preview.
 *   3. {timestamp} meant `<t:…:F>` in message-builder but `<t:…:R>` at runtime,
 *      so the same placeholder produced different output per feature.
 *   4. {date}/{time} were server-locale strings in message-builder
 *      (toLocaleDateString) but Discord timestamps at runtime. The Discord form
 *      is strictly better because it renders in each VIEWER's timezone, so that
 *      is the behaviour kept here.
 *   5. message-builder matched case-insensitively; the others did not, so
 *      {User} worked in one feature and not another.
 *
 * This module is the union of all four, with the inconsistencies resolved. Every
 * previous entry point delegates here, so a placeholder added once works
 * everywhere — preview and production alike.
 *
 * ═══ CALLING CONVENTIONS ═══
 * The four originals had two different signatures. Both are accepted:
 *
 *   replacePlaceholders(text, user,   guild, channel)              // 3 of them
 *   replacePlaceholders(text, member, guild, memberCount, opts)    // welcomer
 *
 * The shape is detected from the arguments (a GuildMember has `.user`; a member
 * count is a number), so no call site has to change.
 */

/** Discord ChannelType values used for counting, inlined to avoid the import. */
const CHANNEL_TYPE = { TEXT: 0, VOICE: 2, CATEGORY: 4 };

const VERIFICATION_LEVELS = ['None', 'Low', 'Medium', 'High', 'Very High'];

/**
 * Normalize the two historical signatures into one context object.
 *
 * @returns {{user:object|null, member:object|null, guild:object|null, channel:object|null, memberCount:number, skipSeparators:boolean}}
 */
function normalizeContext(a, b, c, opts = {}) {
    // arg2 is either a User or a GuildMember. A GuildMember carries `.user`.
    const isMember = !!(a && typeof a === 'object' && a.user);
    const member = isMember ? a : null;
    const user = isMember ? a.user : a;
    const guild = b || member?.guild || null;

    // arg4 is a memberCount (welcomer) or a channel (everything else).
    let channel = null;
    let memberCount = null;
    if (typeof c === 'number') memberCount = c;
    else if (c && typeof c === 'object') channel = c;

    return {
        user: user || null,
        // Resolve the member from cache when only a User was supplied, so
        // role/join placeholders work on the 3-arg signature too. The old
        // runtime implementation did exactly this.
        member: member || (guild?.members?.cache?.get?.(user?.id) ?? null),
        guild,
        channel,
        memberCount: memberCount ?? guild?.memberCount ?? 0,
        skipSeparators: !!opts.skipSeparators,
    };
}

/* ───────────────────────── helpers ───────────────────────── */

const ts = (ms) => Math.floor((ms || 0) / 1000);
const rel = (ms) => `<t:${ts(ms)}:R>`;
const nowSec = () => Math.floor(Date.now() / 1000);

function countChannels(guild, type) {
    return String(guild?.channels?.cache?.filter(ch => ch.type === type)?.size ?? 0);
}

function botCount(guild) {
    return guild?.members?.cache?.filter(m => m.user?.bot)?.size ?? 0;
}

function joinPosition(ctx) {
    const { member, guild } = ctx;
    if (!member || !guild?.members?.cache) return '0';
    const sorted = [...guild.members.cache.values()]
        .sort((x, y) => (x.joinedTimestamp || 0) - (y.joinedTimestamp || 0));
    const idx = sorted.indexOf(member);
    return String(idx >= 0 ? idx + 1 : 0);
}

/** Prefer the system channel when no explicit channel was supplied. */
function fallbackChannel(ctx) {
    if (ctx.channel) return ctx.channel;
    return ctx.guild?.systemChannel || ctx.guild?.channels?.cache?.first?.() || null;
}

/* ───────────────────────── resolvers ───────────────────────── */
/**
 * Keys are lowercase and WITHOUT braces. Every resolver must tolerate a missing
 * user/member/guild/channel and return a string.
 */
const RESOLVERS = {
    /* ── user ── */
    'user': (c) => (c.user ? `<@${c.user.id}>` : ''),
    'usermention': (c) => (c.user ? `<@${c.user.id}>` : ''),
    'username': (c) => c.user?.username || 'Unknown',
    'usertag': (c) => c.user?.tag || c.user?.username || 'Unknown',
    'displayname': (c) => c.member?.displayName || c.user?.globalName || c.user?.username || 'Unknown',
    'nickname': (c) => c.member?.nickname || c.user?.username || 'Unknown',
    'userid': (c) => c.user?.id || '0',
    'discriminator': (c) => c.user?.discriminator || '0',
    'useravatar': (c) => c.user?.displayAvatarURL?.({ dynamic: true, size: 1024 }) || '',
    'usericon': (c) => c.user?.displayAvatarURL?.({ dynamic: true, size: 1024 }) || '',
    'userbanner': (c) => c.user?.bannerURL?.({ dynamic: true, size: 1024 }) || '',
    'userbot': (c) => (c.user?.bot ? 'Yes' : 'No'),

    /* ── user timestamps ── */
    'usercreated': (c) => (c.user?.createdTimestamp ? rel(c.user.createdTimestamp) : 'Unknown'),
    'usercreated:relative': (c) => (c.user?.createdTimestamp ? `<t:${ts(c.user.createdTimestamp)}:R>` : 'Unknown'),
    'usercreated:date': (c) => (c.user?.createdTimestamp ? `<t:${ts(c.user.createdTimestamp)}:D>` : 'Unknown'),
    'usercreated:time': (c) => (c.user?.createdTimestamp ? `<t:${ts(c.user.createdTimestamp)}:T>` : 'Unknown'),
    'usercreated:full': (c) => (c.user?.createdTimestamp ? `<t:${ts(c.user.createdTimestamp)}:F>` : 'Unknown'),
    'userjoined': (c) => (c.member?.joinedTimestamp ? rel(c.member.joinedTimestamp) : 'N/A'),
    'userjoined:relative': (c) => (c.member?.joinedTimestamp ? `<t:${ts(c.member.joinedTimestamp)}:R>` : 'N/A'),
    'userjoined:date': (c) => (c.member?.joinedTimestamp ? `<t:${ts(c.member.joinedTimestamp)}:D>` : 'N/A'),
    'userjoined:time': (c) => (c.member?.joinedTimestamp ? `<t:${ts(c.member.joinedTimestamp)}:T>` : 'N/A'),
    'userjoined:full': (c) => (c.member?.joinedTimestamp ? `<t:${ts(c.member.joinedTimestamp)}:F>` : 'N/A'),

    /* ── roles ── */
    'roles': (c) => {
        const list = c.member?.roles?.cache
            ?.filter(r => r.id !== c.guild?.id)
            ?.map(r => r.name)
            ?.join(', ');
        return list || 'None';
    },
    'rolecount': (c) => String(Math.max(0, (c.member?.roles?.cache?.size ?? 0) - 1)),
    'highestrole': (c) => c.member?.roles?.highest?.name || 'None',
    'highestrolemention': (c) => c.member?.roles?.highest?.toString?.() || 'None',
    'highestrolecolor': (c) => c.member?.roles?.highest?.hexColor || '#000000',
    'joinposition': (c) => joinPosition(c),

    /* ── server ── */
    'server': (c) => c.guild?.name || 'Unknown',
    'servername': (c) => c.guild?.name || 'Unknown',
    'serverid': (c) => c.guild?.id || '0',
    'servericon': (c) => c.guild?.iconURL?.({ dynamic: true, size: 1024 }) || '',
    'serverbanner': (c) => c.guild?.bannerURL?.({ dynamic: true, size: 1024 }) || '',
    'serversplash': (c) => c.guild?.splashURL?.({ size: 1024 }) || '',
    'serverdiscovery': (c) => c.guild?.discoverySplashURL?.({ size: 1024 }) || '',
    'serverowner': (c) => (c.guild?.ownerId ? `<@${c.guild.ownerId}>` : 'Unknown'),
    'serverowner:mention': (c) => (c.guild?.ownerId ? `<@${c.guild.ownerId}>` : 'Unknown'),
    'serverownerid': (c) => c.guild?.ownerId || '0',
    'serverdescription': (c) => c.guild?.description || '',
    'serververification': (c) => VERIFICATION_LEVELS[c.guild?.verificationLevel] || 'None',
    'servercreated': (c) => (c.guild?.createdTimestamp ? rel(c.guild.createdTimestamp) : 'Unknown'),
    'servercreated:relative': (c) => (c.guild?.createdTimestamp ? `<t:${ts(c.guild.createdTimestamp)}:R>` : 'Unknown'),
    'servercreated:date': (c) => (c.guild?.createdTimestamp ? `<t:${ts(c.guild.createdTimestamp)}:D>` : 'Unknown'),
    'servercreated:time': (c) => (c.guild?.createdTimestamp ? `<t:${ts(c.guild.createdTimestamp)}:T>` : 'Unknown'),
    'servercreated:full': (c) => (c.guild?.createdTimestamp ? `<t:${ts(c.guild.createdTimestamp)}:F>` : 'Unknown'),

    /* ── counts ── */
    'membercount': (c) => String(c.memberCount || 0),
    'members': (c) => String(c.memberCount || 0),
    // Presence intent is gated behind ENABLE_PRESENCE_INTENT, so this is 0
    // unless it is enabled. All four originals hardcoded 0; kept honest here.
    'onlinecount': (c) => String(
        c.guild?.members?.cache?.filter(m => m.presence && m.presence.status !== 'offline')?.size ?? 0
    ),
    'botcount': (c) => String(botCount(c.guild)),
    'humancount': (c) => String(Math.max(0, (c.memberCount || 0) - botCount(c.guild))),
    'textchannels': (c) => countChannels(c.guild, CHANNEL_TYPE.TEXT),
    'voicechannels': (c) => countChannels(c.guild, CHANNEL_TYPE.VOICE),
    'categories': (c) => countChannels(c.guild, CHANNEL_TYPE.CATEGORY),
    'emojicount': (c) => String(c.guild?.emojis?.cache?.size ?? 0),
    'roletotal': (c) => String(Math.max(0, (c.guild?.roles?.cache?.size ?? 0) - 1)),
    'rolecount:server': (c) => String(Math.max(0, (c.guild?.roles?.cache?.size ?? 0) - 1)),

    /* ── boosts ── */
    'boostcount': (c) => String(c.guild?.premiumSubscriptionCount || 0),
    'boostlevel': (c) => String(c.guild?.premiumTier || 0),
    'boosttier': (c) => String(c.guild?.premiumTier || 0),

    /* ── channel ── */
    'channel': (c) => { const ch = fallbackChannel(c); return ch ? `<#${ch.id}>` : ''; },
    'channelmention': (c) => { const ch = fallbackChannel(c); return ch ? `<#${ch.id}>` : ''; },
    'channelname': (c) => fallbackChannel(c)?.name || '',
    'channelid': (c) => fallbackChannel(c)?.id || '',

    /* ── current time ──
     * Discord timestamp markup rather than toLocaleString, so each viewer sees
     * it in their own timezone. message-builder used server-locale strings,
     * which showed the host's clock to everyone. */
    'time': () => `<t:${nowSec()}:T>`,
    'date': () => `<t:${nowSec()}:D>`,
    'datetime': () => `<t:${nowSec()}:F>`,
    'now': () => `<t:${nowSec()}:F>`,
    // The two originals disagreed (:F vs :R). :F is the more useful default for
    // "insert the current time", and :R remains available as {now:relative}.
    'timestamp': () => `<t:${nowSec()}:F>`,
    'timestamp:relative': () => `<t:${nowSec()}:R>`,
    'now:relative': () => `<t:${nowSec()}:R>`,

    /* ── separators ──
     * Text dividers for embed-mode messages. These previously existed ONLY in
     * the welcomer's preview implementation, which is why a designed divider
     * rendered in the preview and arrived literally in production.
     *
     * Suppressed via { skipSeparators: true } for Components V2 messages, which
     * use real Separator components instead. */
    'separator': (c) => (c.skipSeparators ? '' : `\n${'─'.repeat(20)}\n`),
    'separator:small': (c) => (c.skipSeparators ? '' : `\n${'─'.repeat(10)}\n`),
    'separator:medium': (c) => (c.skipSeparators ? '' : `\n${'─'.repeat(20)}\n`),
    'separator:large': (c) => (c.skipSeparators ? '' : `\n${'─'.repeat(30)}\n`),
};

/** Every supported placeholder, brace-wrapped, for help/variable listings. */
const PLACEHOLDER_NAMES = Object.keys(RESOLVERS).map(k => `{${k}}`);

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One regex, built once at module load.
 *
 * Keys are sorted longest-first so `{usercreated:full}` is considered before
 * `{usercreated}`. Not strictly required (every key ends in `}`) but it removes
 * a whole class of future foot-gun if a non-braced key is ever added.
 */
const PLACEHOLDER_RE = new RegExp(
    Object.keys(RESOLVERS)
        .sort((a, b) => b.length - a.length)
        .map(k => escapeRe(`{${k}}`))
        .join('|'),
    'gi'
);

/**
 * Substitute placeholders in `text`.
 *
 * Accepts both historical signatures — see the module header.
 * Unknown `{tokens}` are left untouched so unrelated braces survive.
 *
 * @param {string} text
 * @param {object} userOrMember  a User or a GuildMember
 * @param {object} guild
 * @param {object|number} channelOrCount  a channel, or a member count
 * @param {{skipSeparators?:boolean}} [opts]
 * @returns {string}
 */
function replacePlaceholders(text, userOrMember, guild, channelOrCount, opts = {}) {
    if (!text || typeof text !== 'string') return text || '';

    try {
        const ctx = normalizeContext(userOrMember, guild, channelOrCount, opts);
        // Without a guild almost nothing can be resolved; return the input
        // rather than emitting a message full of "Unknown".
        if (!ctx.guild && !ctx.user) return text;

        return text.replace(PLACEHOLDER_RE, (match) => {
            const key = match.slice(1, -1).toLowerCase();
            const resolver = RESOLVERS[key];
            if (!resolver) return match;
            try {
                const value = resolver(ctx);
                return value === undefined || value === null ? '' : String(value);
            } catch {
                // A single bad resolver must not blank the whole message.
                return match;
            }
        });
    } catch {
        return text;
    }
}

module.exports = {
    replacePlaceholders,
    PLACEHOLDER_NAMES,
    RESOLVERS,
    normalizeContext,
};
