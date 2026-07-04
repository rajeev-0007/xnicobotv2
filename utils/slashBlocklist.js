'use strict';

/**
 * slashBlocklist.js — Single source of truth for commands that should
 * NEVER be registered as Discord slash commands.
 *
 * These commands stay loaded in `client.commands` (so prefix invocation
 * still works through their `executePrefix` handler), but they are
 * filtered out before any payload is pushed to Discord's API.
 *
 * Use it from:
 *   • index.js                — startup slash registration (loads commands)
 *   • utils/slashRegistrar.js — auto-registration cache & REST push
 *
 * © xNico
 */

const SLASH_BLOCKLIST = new Set([
    // ── Removed/prefix-only automation ──
    'automeme',     // converted to prefix-only
    'massrole',     // removed — use /roleall instead

    // ── basic / info APIs (kept as prefix-only) ──
    'covid',
    'crypto',
    'emoji-info',
    'channelinfo',
    'manga',

    // ── fun text/utility ──
    'ascii',
    'clap',
    'fasttype',
    'fortune',

    // ── image filters & generators ──
    'blur',
    'border',
    'brighten',
    'charcoal',
    'deepfry',
    'greyscale',
    'imagine',
    'invertcolors',
    'jpeg',
    'mirror',
    'oilpaint',
    'pixelate',
    'rotate',
    'sepia',
    'sketch',
    'trigger',

    // ── owner-only commands ──
    'apikeys',
    'badge-create',
    'badge-edit',
    'badge-give',
    'badge-list',
    'badge-remove',
    'blacklist',
    'botinvite',
    'command-stats',
    'dmuser',
    'eval',
    'fetchmsg',
    'force-sync',
    'getinvite',
    'guild-search',
    'lavalinkinfo',
    'leaveguild',
    'ownerbadges',
    'reload',
    'restart',
    'serverinfo-owner',
    'serverlist',
    'shard-status',
    'shutdown',
    'system',
    'topgg-sync',
    'userlookup',
    'vote-notify',

    // ── utility text/encoding ──
    'zalgo',
    'morse',
    'octal',
    'password',
    'rot13',
    'upside-down',
    'urbanrandom',
    'uuid',

    // ── Per-user request: keep these as prefix-only ──
    // (info / role / server inspection commands)
    'inrole',
    'joined',
    'member-join-position',
    'newest-member',
    'oldest-member',
    'permissions',
    'pinned-messages',
    'rolecount',
    'roleinfo',
    'server-boost-info',
    'serverroles',
    'snowflake',
    'stockprice',
    'user-flags',
    // (admin role / channel / message tools)
    'channelclone',
    'embed-say',
    'members-without-role',
    'role-hoist',
    'role-mentionable',
    'role-rename',

    // ── Action commands (kept as prefix-only) ──
    'bite',
    'blush',
    'bonk',
    'celebrate',
    'cry',
    'cuddle',
    'dance',
    'facepalm',
    'feed',
    'handhold',
    'highfive',
    'hug',
    'kiss',
    'laugh',
    'pat',
    'peck',
    'pet',
    'poke',
    'praise',
    'punch',
    'salute',
    'slap',
    'smile',
    'stare',
    'stretch',
    'tickle',
    'wave',
    'wink',
    'yawn',

    // ──────────────────────────────────────────────────────────────
    // User-requested prefix-only conversion (slash data kept in source
    // for the prefix loader, but never registered with Discord).
    // ──────────────────────────────────────────────────────────────

    // ── backup ──
    'backup-create',
    'backup-delete',
    'backup-list',
    'backup-load',

    // ── basic ──
    'suggest',

    // ── economy ──
    '2048',
    'addcoins',

    // ── fun ──
    '8ball',
    'advice',
    'akinator',
    'choose',
    'compliment',
    'emojiguess',
    'fact',
    'iq',
    'joke',
    'magicnumber',
    'mathgame',
    'mock',
    'nitro',
    'pickupline',
    'pp',
    'quote',
    'rate',
    'reactionspeed',
    'reverse',
    'riddle',
    'roast',
    'roll',
    'scramble',
    'ship',
    'trivia',
    'truthdare',
    'wordchain',
    'wordle',
    'wouldyourather',
    'yesno',

    // ── utility ──
    'abbreviate',
    'activities',
    'announce',
    'ascii-convert',
    'base64',
    'color',
    'define',
    'hash',
    'hexconvert',
    'image',
    'wordcount',
    'word-frequency',
    'vaporwave',
    'remove-duplicates',
    'repeat',
    'reddit',
    'qrcode',
    'randomcase',
]);

/**
 * @param {string} name Slash command name to test.
 * @returns {boolean}   True if the command must be excluded from slash registration.
 */
function isSlashBlocked(name) {
    return typeof name === 'string' && SLASH_BLOCKLIST.has(name);
}

module.exports = {
    SLASH_BLOCKLIST,
    isSlashBlocked,
};
