'use strict';

/**
 * Help Menu Category Configuration
 * ─────────────────────────────────
 * Central source-of-truth for all help-menu categories,
 * subcategory groups, dropdown options and metadata.
 *
 * Commands are listed explicitly so every command always
 * lands in the correct bucket regardless of its source folder.
 */

const WEBHOOK_PORTAL_URL = 'https://thenico.vercel.app/webhook';

/* ─────────────────────────────────────────────────────────────
   NEW COMMAND BADGES
   ───────────────────────────────────────────────────────────── */

const NEW_COMMANDS = new Set([
    'abbreviate', 'activities', 'ascii-convert', 'base64', 'calculate',
    'channelstats', 'color', 'define', 'hash', 'hexconvert', 'image',
    'leetspeak', 'morse', 'octal', 'qrcode', 'randomcase', 'reddit',
    'rot13', 'upside-down', 'urbanrandom', 'userstats', 'uuid',
    'weather', 'wordcount', 'zalgo', 'pay', 'work',
    'leveling-announcement', 'leveling-ignore',
    'profile-customize', 'rank-customize',
    'sticky-message', 'autoresponder', 'autoreact', 'reactionroles', 'roletemplate',
    'spotify-link',
    'voicemoveall', 'vclimit', 'vclist', 'vcdisconnectall', 'vcrename', 'vcbitrate', 'vcstatus',
    'servertag', 'guildtag',
    'socialprofile', 'rank',
    'messagestats', 'voicestats', 'memberstats', 'topstats',
    'serveractivity', 'comparestats', 'rankposition',
    'statusrole',
    'wordle', 'akinator', 'trivia',
    'birthday', 'birthday-setup',
    // ── Latest additions ──
    'automeme', 'afk', 'afklist', 'vcmod', 'vcmods',
    // ── New "How X?" personality meters ──
    'howtoxic', 'howweeb', 'howgamer', 'howbroke', 'howsleepy',
    'howannoying', 'howfunny', 'howfriendly', 'howcaring',
    'howbaby', 'howmature', 'howcrazy', 'howlazy', 'howkind',
    'howdramatic', 'howemo',
    // ── Economy stats overview ──
    'economystats',
    // ── Auction marketplace ──
    'auction',
    // ── Anime Collection System ──
    'aroll', 'acollection', 'atrade', 'awishlist', 'asell', 'afavorites',
    'acharinfo', 'acharlist', 'aleaderboard', 'aprofile', 'agift',
    'animequiz', 'adaily', 'adroprates', 'aguess', 'abattle', 'adropsetup',
    // ── Message Stats System ──
    'messages', 'addmessages', 'blacklistchannel',
    'unblacklistchannel', 'blacklistedchannels', 'clearmessages',
    'dailymessages', 'voicetime', 'liveleaderboard',
]);

/* ─────────────────────────────────────────────────────────────
   SUBCATEGORY DEFINITIONS — 24 help categories + Owner
   ───────────────────────────────────────────────────────────── */

const CATEGORY_GROUP_RULES = {

    // ── 1. Music ──────────────────────────────────────────────
    music: [
        { name: 'Playback',            emoji: '<:Play:1521228333700878416>',       cmds: ['play', 'playtop', 'playskip', 'pause', 'resume', 'stop', 'skip', 'previous', 'back', 'replay', 'search', 'join'] },
        { name: 'Queue Management',    emoji: '<:Bookopen:1521227911137595605>',   cmds: ['queue', 'nowplaying', 'shuffle', 'remove', 'clearqueue', 'move', 'skipto', 'save-queue', 'removedupes', 'grab'] },
        { name: 'Audio & Filters',     emoji: '<:Volumeup:1521228004502536272>',   cmds: ['volume', 'seek', 'forward', 'loop', 'autoplay', 'filters', 'bassboost', 'equalizer', 'pitch', 'speed'] },
        { name: 'Library & Playlists', emoji: '<:spotify:1521228327761744043>',    cmds: ['like', 'unlike', 'my-music', 'play-favorites', 'playlists', 'load-playlist', 'delete-playlist', 'spotify-playlist', 'spotify-link', 'recommendations', 'lyrics', 'history'] },
        { name: 'Panel & Sessions',    emoji: '<:Refresh:1521227946441052420>',    cmds: ['247', 'musicpanel', 'removepanel'] },
    ],

    // ── 2. Voice ──────────────────────────────────────────────
    voice: [
        { name: 'Text-to-Speech',      emoji: '<:Bullhorn:1521227936575914016>',   cmds: ['speak', 'speak-config', 'join-greet', 'record'] },
        { name: 'VC Kick & Mute',      emoji: '<:banhammer:1521227777083314529>',  cmds: ['vckick', 'vckickall', 'vcmute', 'vcmuteall', 'vcunmute', 'vcunmuteall', 'vcdeafen', 'vcdeafenall', 'vcundeafen', 'vcundeafenall', 'voiceban', 'voiceunban', 'voicemove', 'voicemoveall', 'vcdrag', 'vcdisconnectall'] },
        { name: 'VC Lock & Access',    emoji: '<:Shield:1521227694677692467>',     cmds: ['vclock', 'vcunlock', 'lockall-voice', 'unlockall-voice', 'hideall-voice', 'unhideall-voice'] },
        { name: 'VC Settings',         emoji: '<:Settings:1521227767780343879>',   cmds: ['vclimit', 'vclist', 'vcrename', 'vcbitrate', 'vcstatus', 'vcstatusremove'] },
        { name: 'VC Roles & Setup',    emoji: '<:Caretright:1521227704953864202>', cmds: ['roleallvoice', 'roleallvoice-off', 'join2create-setup'] },
    ],

    // ── 3. Moderation ─────────────────────────────────────────
    moderation: [
        { name: 'Bans & Kicks',        emoji: '<:banhammer:1521227777083314529>',  cmds: ['ban', 'unban', 'kick', 'hackban', 'softban', 'massban', 'masskick', 'banlist', 'unbanall'] },
        { name: 'Mute & Timeout',      emoji: '<:Shield:1521227694677692467>',     cmds: ['mute', 'unmute', 'timeout', 'untimeout'] },
        { name: 'Warnings',            emoji: '<:Bookopen:1521227911137595605>',   cmds: ['warn', 'warnings', 'removewarn', 'warnconfig', 'clearwarnings', 'reason'] },
        { name: 'Cases & Logging',     emoji: '<:Lightning:1521227915537285150>',  cmds: ['cases', 'modhistory', 'delcase', 'audit', 'logging-setup', 'logging'] },
        { name: 'Members & Nicknames', emoji: '<:xnico:1521228240440660180>',       cmds: ['setnick', 'nickreset', 'massnick', 'inactive-members', 'members-without-role'] },
    ],

    // ── 4. Server Security ────────────────────────────────────
    security: [
        { name: 'Auto Protection',     emoji: '<:Shield:1521227694677692467>',     cmds: ['anti', 'antialt', 'antiraid', 'antispam', 'automod', 'antinuke', 'automod-manage', 'blacklistword'] },
        { name: 'Threat Response',      emoji: '<:Lightningalt:1521227851796447472>', cmds: ['threatmode', 'superthreatmode', 'securitycheck', 'config', 'emergency', 'nightmode', 'vanityguard', 'trap'] },
    ],

    // ── 5. Message Tools ──────────────────────────────────────
    msgmod: [
        { name: 'Clear & Delete',      emoji: '<:banhammer:1521227777083314529>',  cmds: ['clear', 'clearspam', 'nuke'] },
        { name: 'Embeds & Messages',   emoji: '<:Envelope:1521228013910626426>',   cmds: ['embed-say', 'mention', 'move-messages', 'pin-message'] },
        { name: 'Message History',     emoji: '<:Bookopen:1521227911137595605>',   cmds: ['snipe', 'editsnipe', 'ghostping'] },
    ],

    // ── 6. Server Management ──────────────────────────────────
    server: [
        { name: 'Channel Access',      emoji: '<:Shield:1521227694677692467>',     cmds: ['lock', 'unlock', 'lockall', 'unlockall', 'lock-category', 'unlock-category', 'hide', 'unhide', 'hideall', 'unhideall', 'hide-category', 'unhide-category'] },
        { name: 'Channel Speed',       emoji: '<:Lightning:1521227915537285150>',  cmds: ['slowmode', 'slowmode-all'] },
        { name: 'Channel Setup',       emoji: '<:Folder:1521228095225331765>',     cmds: ['create-channel', 'delete-channel', 'channelclone', 'channel-nsfw', 'channel-permissions', 'channel-position', 'channel-rename', 'channel-topic', 'clone-permissions', 'setcategory', 'category-delete', 'category-rename', 'ignore-channels', 'backup-channel'] },
        { name: 'Role Management',     emoji: '<:Settings:1521227767780343879>',   cmds: ['create-role', 'delete-role', 'addrole', 'removerole', 'roleall', 'massrole', 'move-role', 'role-color', 'role-hoist', 'role-icon', 'role-mentionable', 'role-position-set', 'role-rename'] },
    ],

    // ── 7. Server Settings ────────────────────────────────────
    settings: [
        { name: 'Bot Configuration',   emoji: '<:Settings:1521227767780343879>',   cmds: ['setprefix', 'setbotname', 'bot-customize', 'botprofile', 'quicksetup', 'botblock', 'aichat-setup'] },
        { name: 'Server Configuration', emoji: '<:Caretright:1521227704953864202>', cmds: ['reset-permissions', 'resetserver', 'servertag', 'guildtag', 'config-backup', 'dm-user', 'application', 'confession-setup'] },
        { name: 'Emoji & Sticker',     emoji: '<:Gamepad:1521228035213230090>',    cmds: ['deleteemoji', 'renameemoji', 'sticker-delete', 'stealemoji', 'stealsticker', 'extract-emoji', 'remove-duplicates', 'globalemoji', 'globalsticker', 'steal'] },
        { name: 'Soundboard',          emoji: '<:Volumeup:1521228004502536272>',   cmds: ['uploadsoundboard', 'globalsoundboard'] },
    ],

    // ── 8. Trust System ───────────────────────────────────────
    trust: [
        { name: 'Owners',              emoji: '<:Lightningalt:1521227851796447472>', cmds: ['add-owner', 'remove-owner', 'show-owner', 'extraowner'] },
        { name: 'Admins',              emoji: '<:Shield:1521227694677692467>',     cmds: ['add-admin', 'removeadmin', 'admins', 'adminreset'] },
        { name: 'Moderators',          emoji: '<:banhammer:1521227777083314529>',  cmds: ['addmod', 'removemod', 'mods', 'modreset'] },
        { name: 'VC Moderators',       emoji: '<:Volumeup:1521228004502536272>',   cmds: ['add-vcmod', 'remove-vcmod', 'vcmod', 'vcmodreset'] },
        { name: 'Whitelist',           emoji: '<:Checkedbox:1521227734943269077>', cmds: ['whitelist', 'unwhitelist', 'showwhitelist'] },
    ],

    // ── 9. Automation ─────────────────────────────────────────
    automation: [
        { name: 'Auto Triggers',       emoji: '<:Refresh:1521227946441052420>',    cmds: ['autoreact', 'autoresponder', 'sticky-message', 'automeme'] },
        { name: 'Auto Membership',     emoji: '<:Settings:1521227767780343879>',   cmds: ['autorole', 'autonick', 'statusrole'] },
        { name: 'Tickets',             emoji: '<:Attach:1521228039135170722>',     cmds: ['ticket-setup', 'ticket-add', 'ticket-close', 'ticket-remove', 'ticket-categories'] },
        { name: 'Welcomer & Leave',    emoji: '<:Shield:1521227694677692467>',     cmds: ['welcomer', 'leave-setup'] },
        { name: 'Verification & Safety', emoji: '<:Checkedbox:1521227734943269077>', cmds: ['verification-setup', 'media-only', 'automodconfig', 'screenshot-verify'] },
        { name: 'Notifications',       emoji: '<:Bullhorn:1521227936575914016>',   cmds: ['booster-notify', 'social-notify', 'youtube-notify', 'minecraft', 'vote-notify'] },
        { name: 'Engagement',          emoji: '<:Gamepad:1521228035213230090>',    cmds: ['giveaway', 'poll', 'reactionroles', 'roletemplate', 'starboard-setup', 'serverstats', 'suggestion', 'feedback', 'birthday', 'birthday-setup'] },
    ],

    // ── 10. Buttons & Selection ───────────────────────────────
    components: [
        { name: 'Message Components',  emoji: '<:Caretright:1521227704953864202>', cmds: ['button-maker', 'select-menu-maker'] },
        { name: 'Message Builders',    emoji: '<:Envelope:1521228013910626426>',   cmds: ['message-builder'] },
        { name: 'Custom Commands',     emoji: '<:Settings:1521227767780343879>',   cmds: ['customcmd', 'delcustomcmd'] },
    ],

    // ── 11. Invite System ─────────────────────────────────────
    invites: [
        { name: 'Setup & Config',      emoji: '<:Settings:1521227767780343879>',   cmds: ['invite-setup', 'invite-manage', 'invite-rewards'] },
        { name: 'Stats & Tracking',    emoji: '<:Bookopen:1521227911137595605>',   cmds: ['invite-stats', 'invite-analytics', 'invite-leaderboard', 'invited'] },
    ],

    // ── 12. Members & Info ────────────────────────────────────
    info: [
        { name: 'User Info',           emoji: '<:xnico:1521228240440660180>',       cmds: ['userinfo', 'avatar', 'banner', 'banner-url', 'permissions', 'joined', 'user-flags', 'member-join-position'] },
        { name: 'Server Info',         emoji: '<:Pin:1521227932625014916>',        cmds: ['serverinfo', 'icon', 'boosters', 'server-owner', 'server-boost-info', 'roleinfo', 'rolecount', 'serverroles', 'inrole', 'channellist', 'channelinfo', 'emojis', 'emoji-info', 'bots', 'members', 'guild-features', 'newest-member', 'oldest-member'] },
    ],

    // ── 13. Basic & Misc ─────────────────────────────────────
    basic: [
        { name: 'Bot Core',            emoji: '<:xnico:1521228240440660180>',       cmds: ['help', 'botinfo', 'ping', 'invite', 'uptime', 'vote', 'myvotes', 'support', 'variables'] },
        { name: 'Premium',             emoji: '<:Crown:1521227739988889764>',     cmds: ['premium', 'redeemkey', 'redeemserverkey', 'serverpremium'] },
        { name: 'Reminders & AFK',     emoji: '<:Lightning:1521227915537285150>',  cmds: ['afk', 'reminder', 'timer', 'announce', 'timezone'] },
        { name: 'Lookup & APIs',       emoji: '<:Attach:1521228039135170722>',     cmds: ['github', 'npm', 'define', 'urban', 'urbanrandom', 'wikipedia', 'reddit', 'youtube', 'yt', 'spotify', 'weather', 'color', 'ip', 'stockprice'] },
        { name: 'Media & Tools',       emoji: '<:Pin:1521227932625014916>',        cmds: ['image', 'screenshot', 'qrcode', 'shorten', 'pastebin', 'calculate', 'password', 'uuid', 'download'] },
        { name: 'Misc & Community',    emoji: '<:Fire:1521227907647668374>',       cmds: ['firstmsg', 'pinned-messages', 'snowflake', 'enlarge', 'afklist', 'anime', 'manga', 'crypto', 'covid', 'suggest', 'report', 'apply', 'partners'] },
    ],

    // ── 14. Stats & Activity ──────────────────────────────────
    stats: [
        { name: 'Activity Tracking',   emoji: '<:Bookopen:1521227911137595605>',   cmds: ['messages', 'dailymessages', 'voicetime', 'serveractivity', 'channelstats', 'userstats'] },
        { name: 'Message Management',  emoji: '<:Envelope:1521228013910626426>',   cmds: ['addmessages', 'clearmessages'] },
        { name: 'Message Blacklist',   emoji: '<:Shield:1521227694677692467>',     cmds: ['blacklistchannel', 'unblacklistchannel', 'blacklistedchannels'] },
        { name: 'Comparisons',         emoji: '<:Inforect:1521228008285929532>',   cmds: ['comparestats'] },
        { name: 'Leaderboards & Tools', emoji: '<:Lightning:1521227915537285150>', cmds: ['liveleaderboard', 'activities', 'timestamp', 'statboard'] },
    ],

    // ── 15. Image ─────────────────────────────────────────────
    image: [
        { name: 'Color Filters',       emoji: '<:Fire:1521227907647668374>',       cmds: ['blur', 'brighten', 'greyscale', 'sepia', 'invertcolors', 'deepfry', 'charcoal', 'oilpaint'] },
        { name: 'Effects & Transforms', emoji: '<:Lightningalt:1521227851796447472>', cmds: ['pixelate', 'border', 'mirror', 'rotate', 'sketch', 'trigger', 'jpeg'] },
        { name: 'AI Image',            emoji: '<:xnico:1521228240440660180>',       cmds: ['imagine'] },
    ],

    // ── 16. Text & Encoding ───────────────────────────────────
    encoding: [
        { name: 'Encoding & Decoding', emoji: '<:Inforect:1521228008285929532>',   cmds: ['base64', 'morse', 'binary', 'hexconvert', 'octal', 'hash', 'rot13', 'ascii-convert'] },
        { name: 'Text Effects',        emoji: '<:Envelope:1521228013910626426>',   cmds: ['emojify', 'fancy-text', 'case-convert', 'zalgo', 'vaporwave', 'leetspeak', 'randomcase', 'upside-down', 'abbreviate'] },
        { name: 'Analysis & Transform', emoji: '<:Bookopen:1521227911137595605>',  cmds: ['wordcount', 'word-frequency', 'split-text', 'repeat', 'json-format', 'translate'] },
    ],

    // ── 17. Anime Collection ──────────────────────────────────
    anime: [
        { name: 'Gacha & Rolls',       emoji: '<:Gamepad:1521228035213230090>',    cmds: ['aroll', 'adaily', 'adroprates'] },
        { name: 'Collection',          emoji: '<:Bookopen:1521227911137595605>',   cmds: ['acollection', 'aprofile', 'afavorites', 'acharinfo', 'acharlist'] },
        { name: 'Trading & Economy',   emoji: '<:transfer:1521228019824590948>',   cmds: ['atrade', 'asell', 'agift'] },
        { name: 'Games & Battles',     emoji: '<:Star:1521227981685526568>',       cmds: ['aguess', 'abattle', 'animequiz', 'awishlist', 'aleaderboard'] },
        { name: 'Auto Drops',          emoji: '<:Present:1521228115655917659>',    cmds: ['adropsetup'] },
    ],

    // ── 18. Games (skill / no-bet) ─────────────────────────────
    // Bet-based games (blackjack, roulette, rps, tictactoe, hangman,
    // numguess, memory, 2048, battleship, connect4) live under
    // Economy → Gambling now.
    games: [
        { name: 'Word & Puzzle',       emoji: '<:Bookopen:1521227911137595605>',   cmds: ['wordle', 'scramble', 'wordchain', 'trivia'] },
        { name: 'Skill & Speed',       emoji: '<:Lightningalt:1521227851796447472>', cmds: ['fasttype', 'reactionspeed', 'mathgame', 'counting', 'emojiguess'] },
        { name: 'AI & Interactive',    emoji: '<:Inforect:1521228008285929532>',   cmds: ['akinator', '8ball', 'truthdare', 'wouldyourather'] },
    ],

    // ── 18. Fun ───────────────────────────────────────────────
    fun: [
        { name: 'Entertainment',        emoji: '<:Fire:1521227907647668374>',      cmds: ['meme', 'joke', 'fact', 'quote', 'advice', 'gif', 'fortune', 'riddle', 'roast', 'compliment', 'pickup-line', 'pickupline', 'choose', 'roll', 'random-yes-no', 'yesno'] },
        { name: 'Personality Meters',   emoji: '<:Star:1521227981685526568>',      cmds: [
            // Identity / orientation
            'howgay', 'howstraight', 'howlesbian',
            // Social vibes
            'howcute', 'howcool', 'howhot', 'howfunny', 'howkind', 'howcaring', 'howfriendly',
            // Disposition
            'howsmart', 'howmature', 'howbaby', 'howsleepy', 'howlazy', 'howdramatic',
            // Personality archetypes
            'howsigma', 'howedgy', 'howemo', 'howweeb', 'howgamer',
            // Vibe / mood
            'howcursed', 'howevil', 'howcrazy', 'howsus', 'howannoying', 'howtoxic',
            // Status
            'howrich', 'howbroke', 'howlucky', 'howbraindead', 'howsimp',
        ] },
        { name: 'Social Fun',          emoji: '<:Money:1521228266957045900>',      cmds: ['ship', 'rate', 'pp', 'magic-number', 'magicnumber', 'iq'] },
        { name: 'Pranks & Misc',       emoji: '<:Caretright:1521227704953864202>', cmds: ['fkick', 'reaction', 'confession', 'confess', 'nitro', 'faketweet'] },
        { name: 'Text Fun',            emoji: '<:Envelope:1521228013910626426>',   cmds: ['ascii', 'clap', 'mock', 'reverse'] },
    ],

    // ── 19. Action / Roleplay ─────────────────────────────────
    action: [
        { name: 'Affection',           emoji: '<:Money:1521228266957045900>',      cmds: ['hug', 'kiss', 'cuddle', 'pat', 'pet', 'praise', 'feed', 'handhold', 'peck'] },
        { name: 'Expressions',         emoji: '<:Fire:1521227907647668374>',       cmds: ['wave', 'wink', 'smile', 'blush', 'laugh', 'cry', 'dance', 'celebrate', 'yawn', 'stretch', 'salute'] },
        { name: 'Playful',             emoji: '<:Gamepad:1521228035213230090>',    cmds: ['slap', 'punch', 'bite', 'bonk', 'poke', 'tickle', 'highfive', 'facepalm', 'stare'] },
        { name: 'More Reactions',      emoji: '<:Star:1521227981685526568>',       cmds: ['angry', 'baka', 'blowkiss', 'bored', 'bully', 'carry', 'confused', 'handshake', 'happy', 'lappillow', 'nod', 'nom', 'pout', 'shocked', 'shoot', 'shrug', 'sleep', 'smug', 'snuggle', 'spin', 'tableflip', 'think', 'thumbsup', 'yeet'] },
    ],

    // ── 20. Economy ───────────────────────────────────────────
    economy: [
        { name: 'Earning',             emoji: '<:Lightning:1521227915537285150>',  cmds: ['daily', 'weekly', 'work', 'beg', 'crime', 'fish', 'hunt', 'adventure', 'mine', 'farm', 'heist'] },
        { name: 'Classic Gambling',    emoji: '<:Gamepad:1521228035213230090>',    cmds: ['slots', 'betflip', 'gamble', 'rob', 'lottery', 'highlow', 'scratch', 'dice', 'blackjack', 'roulette'] },
        { name: 'Bet Games — Setup',   emoji: '<:Lightning:1521227915537285150>',  cmds: ['mines', 'crash', 'plinko', 'wheel', 'limbo', 'tower', 'keno'] },
        { name: 'PvP & Mini-Games',    emoji: '<:transfer:1521228019824590948>',   cmds: ['rps', 'tictactoe', 'connect4', 'hangman', 'numguess', 'memory', '2048', 'battleship'] },
        { name: 'Balance & Profile',   emoji: '<:Bookopen:1521227911137595605>',   cmds: ['profile', 'balance', 'deposit', 'withdraw', 'pay', 'loan', 'economy-leaderboard', 'economystats'] },
        { name: 'Shop & Inventory',    emoji: '<:Folder:1521228095225331765>',     cmds: ['shop', 'buy', 'sell', 'sell-item', 'inventory', 'trade', 'use', 'craft', 'gift', 'customshop', 'stocks', 'auction'] },
        { name: 'Combat & Pets',       emoji: '<:Fire:1521227907647668374>',       cmds: ['battle', 'weapon', 'skill', 'pets'] },
        { name: 'Admin Controls',      emoji: '<:Shield:1521227694677692467>',     cmds: ['addcoins', 'currency'] },
    ],

    // ── 21. Social ────────────────────────────────────────────
    social: [
        { name: 'Profile & Reputation', emoji: '<:xnico:1521228240440660180>',     cmds: ['socialprofile', 'profile-customize', 'rep', 'badges'] },
        { name: 'Relationships',        emoji: '<:Money:1521228266957045900>',    cmds: ['marry', 'divorce'] },
    ],

    // ── 22. Leveling ──────────────────────────────────────────
    leveling: [
        { name: 'User',                emoji: '<:Bookopen:1521227911137595605>',   cmds: ['rank', 'leaderboard', 'rank-customize'] },
        { name: 'Admin Controls',      emoji: '<:Settings:1521227767780343879>',   cmds: ['setlevel', 'resetlevel', 'levelroles', 'toggleleveling', 'levelmultiplier', 'levelchannel'] },
        { name: 'Setup',               emoji: '<:banhammer:1521227777083314529>',  cmds: ['leveling-setup', 'leveling-announcement', 'leveling-ignore'] },
    ],

    // ── 23. Backup & Database ─────────────────────────────────
    backup: [
        { name: 'Config Backups',      emoji: '<:Bookopen:1521227911137595605>',   cmds: ['backup-create', 'backup-load', 'backup-list', 'backup-delete'] },
        { name: 'Server Backups',      emoji: '<:Pin:1521227932625014916>',        cmds: ['server-backup-create', 'server-backup-load', 'server-backup-list', 'server-backup-delete'] },
        { name: 'Database',            emoji: '<:Settings:1521227767780343879>',   cmds: ['database-set', 'database-get', 'database-list', 'database-delete'] },
    ],

    // ── 24. Webhook ───────────────────────────────────────────
    webhook: [
        { name: 'Manage Webhooks',     emoji: '<:Settings:1521227767780343879>',   cmds: ['webhook-create', 'webhook-delete', 'webhook-info', 'webhook-list', 'webhook-rename'] },
        { name: 'Send Messages',       emoji: '<:Envelope:1521228013910626426>',   cmds: ['webhook-send'] },
    ],

    // ── Owner ─────────────────────────────────────────────────
    owner: [
        { name: 'Runtime Control',     emoji: '<:Settings:1521227767780343879>',   cmds: ['shutdown', 'restart', 'maintenance', 'reload', 'eval', 'exec', 'emit', 'system', 'disablecommand'] },
        { name: 'Shard & Deploy',      emoji: '<:Refresh:1521227946441052420>',    cmds: ['force-sync', 'shard-status', 'command-stats'] },
        { name: 'Configuration',       emoji: '<:banhammer:1521227777083314529>',  cmds: ['apikeys', 'globalconfig', 'configview', 'configreset', 'lavalinkconfig', 'lavalinkinfo', 'setavatar', 'fetchmsg'] },
        { name: 'Premium & Keys',      emoji: '<:Money:1521228266957045900>',      cmds: ['addpremium', 'removepremium', 'premiumstats', 'premiums', 'transferpremium', 'createkey', 'deletekey', 'listkeys', 'syncpremium'] },
        { name: 'Guild Management',    emoji: '<:Pin:1521227932625014916>',        cmds: ['serverlist', 'leaveguild', 'serverinfo-owner', 'guild-search', 'getinvite', 'partner'] },
        { name: 'User Management',     emoji: '<:Shield:1521227694677692467>',     cmds: ['globalban', 'globalunban', 'blacklist', 'noprefix', 'dmuser', 'userlookup', 'addowner', 'removeowner', 'listowners'] },
        { name: 'Badge System',        emoji: '<:Fire:1521227907647668374>',       cmds: ['badge-create', 'badge-edit', 'badge-give', 'badge-remove', 'badge-list'] },
        { name: 'Bot Health & Stats',  emoji: '<:Lightning:1521227915537285150>',  cmds: ['botstats', 'bothealth', 'systemlogs', 'botinvite', 'botpanel'] },
        { name: 'Utilities',           emoji: '<:Envelope:1521228013910626426>',   cmds: ['broadcast', 'clearcache', 'activity', 'botnick', 'topgg-sync', 'uptimemonitor'] },
        { name: 'Developer Tools',     emoji: '<:Lightning:1521227915537285150>',  cmds: ['canvas', 'botsay', 'cleanup-webhooks', 'datasnapshot', 'dmstats', 'errortest', 'flushcache', 'listenerinfo', 'nodecheck', 'ownerbadges', 'purge-mass', 'runtimeflags', 'namestyle', 'presence'] },
    ],
};

/* ─────────────────────────────────────────────────────────────
   REVERSE MAP: commandName → helpCategory
   ───────────────────────────────────────────────────────────── */

function buildCategoryMap() {
    const map = new Map();
    for (const [cat, groups] of Object.entries(CATEGORY_GROUP_RULES)) {
        for (const group of groups) {
            for (const cmd of group.cmds) {
                map.set(cmd, cat);
            }
        }
    }
    return map;
}

const COMMAND_CATEGORY_MAP = buildCategoryMap();

/** Fallback: map folder-based categories to a help category for unlisted commands */
const FOLDER_FALLBACK = {
    admin: 'moderation',
    utility: 'basic',
};

/* ─────────────────────────────────────────────────────────────
   CATEGORY METADATA (emoji, title, footer)
   ───────────────────────────────────────────────────────────── */

const CATEGORY_META = {
    music:      { title: 'Music Commands',           emoji: '<:Music:1521228141543165982>',        footer: '-# <:YoutubeLive:1521228137541927022> YouTube • <:spotify:1521228327761744043> Spotify • <:soundCloud:1521228420468445375> SoundCloud • <:applemusic:1521228425962983484> Apple Music' },
    voice:      { title: 'Voice Commands',           emoji: '<:Volumeup:1521228004502536272>',      footer: '-# TTS, J2C, VC moderation, limits, bitrate, autorole & more' },
    moderation: { title: 'Moderation',               emoji: '<:banhammer:1521227777083314529>',     footer: '-# Bans, kicks, mutes, warns, cases & audit logging' },
    security:   { title: 'Server Security',          emoji: '<:Shield:1521227694677692467>',        footer: '-# Anti-raid, anti-spam, anti-nuke & threat detection systems' },
    msgmod:     { title: 'Message Tools',            emoji: '<:Hashtag:1521227771957870604>',          footer: '-# `clear` (1 channel, up to 1000) • `clearspam @user` (ALL channels) — Filters: `text` `links` `images` `embeds` `mentions` `invites` `contains:<text>`' },
    server:     { title: 'Server Management',        emoji: '<:Folder:1521228095225331765>',        footer: '-# Channels, roles, permissions, categories & server structure' },
    settings:   { title: 'Server Settings',          emoji: '<:Settings:1521227767780343879>',      footer: '-# Bot config, prefix, nicknames, emoji & sticker management' },
    trust:      { title: 'Trust System',             emoji: '<:Checkedbox:1521227734943269077>',    footer: '-# Manage trusted owners, admins, moderators & whitelist' },
    automation: { title: 'Automation',               emoji: '<:Refresh:1521227946441052420>',       footer: '-# Welcomer, tickets, giveaways, auto-roles, notifications & more' },
    components: { title: 'Buttons & Selection',      emoji: '<:staff:1521228077269647583>',         footer: '-# Build interactive button rows, select menus, embeds & custom commands' },
    invites:    { title: 'Invite System',            emoji: '<:Bullhorn:1521227936575914016>',      footer: '-# Track invites, set rewards, view analytics & leaderboards' },
    info:       { title: 'Members & Info',           emoji: '<:Pin:1521227932625014916>',           footer: '-# User profiles, server details, roles, channels & member lookup' },
    basic:      { title: 'Basic & Misc',             emoji: '<:Bookopen:1521227911137595605>',      footer: '-# Core commands, premium, lookup, media tools & community features' },
    stats:      { title: 'Stats & Activity',         emoji: '<:Lightning:1521227915537285150>',     footer: '-# Message, voice & member activity tracking across your server' },
    image:      { title: 'Image Commands',           emoji: '<:Image:1521227966435037255>',         footer: '-# AI image generation plus avatar and image effects for attachments, URLs and user avatars' },
    encoding:   { title: 'Text & Encoding',          emoji: '<:Envelope:1521228013910626426>',      footer: '-# Translate, encode, decode, text effects & analysis tools' },
    games:      { title: 'Games',                    emoji: '<:Gamepad:1521228035213230090>',       footer: '-# Card games, word puzzles, speed challenges & AI-powered fun — play solo or with friends' },
    anime:      { title: 'Anime Collection',         emoji: '<:Star:1521227981685526568>',          footer: '-# Gacha rolls, character collection, trading, wishlist & anime quiz — collect them all!' },
    fun:        { title: 'Fun Commands',             emoji: '<:Fire:1521227907647668374>',          footer: '-# Memes, entertainment, pranks, text tricks & social fun' },
    action:     { title: 'Action & Roleplay',        emoji: '<:Money:1521228266957045900>',         footer: '-# Anime GIFs powered by nekos.best & waifu.pics APIs' },
    economy:    { title: 'Economy Commands',         emoji: '<:Money:1521228266957045900>',         footer: '-# <:Caretright:1521227704953864202> Canvas-rendered: fish, hunt, adventure, slots, coinflip, battle, profile' },
    social:     { title: 'Social Commands',          emoji: '<:Inforect:1521228008285929532>',      footer: '-# Custom card styles, fonts, badges & profile bio — personalize your card' },
    leveling:   { title: 'Leveling Commands',        emoji: '<:Lightning:1521227915537285150>',     footer: '-# XP is earned per message with cooldowns — Custom rank cards via `rank-customize`' },
    backup:     { title: 'Backup & Database',        emoji: '<:Folder:1521228095225331765>',        footer: '-# Full server clone — roles, channels, permissions, messages & bot configs' },
    webhook:    { title: 'Webhook Commands',         emoji: '<:Attach:1521228039135170722>',        footer: `-# Requires **Manage Webhooks** permission · [Web Portal](${WEBHOOK_PORTAL_URL})` },
    owner:      { title: 'Owner Commands',           emoji: '<:Lightningalt:1521227851796447472>',  footer: '-# Restricted to bot owners — runtime control, premium, user/guild management' },
};

/* ─────────────────────────────────────────────────────────────
   DROPDOWN OPTIONS (25 max — Home + 24 categories)
   Owner is accessible via -help owner / -help dev (prefix only)
   ───────────────────────────────────────────────────────────── */

const CATEGORY_OPTIONS = [
    { label: 'Home',            description: 'Main menu & overview',                    value: 'home',        emoji: { id: '1521228339736482056' } },
    // ── Music & Voice ──
    { label: 'Music',           description: 'Playback, queue, filters & playlists',    value: 'music',       emoji: { id: '1521228141543165982' } },
    { label: 'Voice',           description: 'TTS, J2C, VC mod & management',           value: 'voice',       emoji: { id: '1521227746376683590' } },
    // ── Moderation & Security ──
    { label: 'Moderation',      description: 'Bans, kicks, warns, cases & logging',     value: 'moderation',  emoji: { id: '1521227777083314529' } },
    { label: 'Security',        description: 'Anti-raid, anti-spam & threat protection', value: 'security',   emoji: { id: '1521227694677692467' } },
    { label: 'Messages',        description: 'Clear, embeds, snipe & message tools',    value: 'msgmod',      emoji: { id: '1521227771957870604' } },
    // ── Server ──
    { label: 'Server Mgmt',     description: 'Channels, roles & permissions',            value: 'server',      emoji: { id: '1521228095225331765' } },
    { label: 'Settings',        description: 'Bot config, prefix & emoji tools',         value: 'settings',    emoji: { id: '1521227767780343879' } },
    { label: 'Trust System',    description: 'Owners, admins, mods & whitelist',         value: 'trust',       emoji: { id: '1521227734943269077' } },
    // ── Automation & Components ──
    { label: 'Automation',      description: 'Welcomer, tickets, giveaways & setup',    value: 'automation',  emoji: { id: '1521227946441052420' } },
    { label: 'Components',      description: 'Buttons, select menus & builders',         value: 'components',  emoji: { id: '1521227704953864202' } },
    { label: 'Invites',         description: 'Invite tracking, stats & rewards',         value: 'invites',     emoji: { id: '1521227936575914016' } },
    // ── Info & Basics ──
    { label: 'Members & Info',  description: 'User, server & channel information',       value: 'info',        emoji: { id: '1521227932625014916' } },
    { label: 'Basic & Misc',    description: 'Core commands, lookup & utilities',        value: 'basic',       emoji: { id: '1521227911137595605' } },
    { label: 'Stats',           description: 'Message, voice & activity statistics',     value: 'stats',       emoji: { id: '1521228272426418367' } },
    // ── Media & Text ──
    { label: 'Images',          description: 'Filters, effects & image transforms',      value: 'image',       emoji: { id: '1521227966435037255' } },
    { label: 'Text & Encoding', description: 'Translate, encode, decode & text fun',     value: 'encoding',    emoji: { id: '1521228013910626426' } },
    // ── Entertainment ──
    { label: 'Games',           description: 'Card, word, speed & AI-powered games',     value: 'games',       emoji: { id: '1521228035213230090' } },
    { label: 'Fun',             description: 'Memes, entertainment & pranks',             value: 'fun',         emoji: { id: '1521227907647668374' } },
    { label: 'Anime',           description: 'Gacha rolls, collection & trading',         value: 'anime',       emoji: { id: '1521227981685526568' } },
    // ── Progression ──
    { label: 'Economy',         description: 'Currency, shop, gambling & pets',           value: 'economy',     emoji: { id: '1521228286813012169' } },
    { label: 'Social',          description: 'Profiles, badges, rep & marriage',          value: 'social',      emoji: { id: '1521227719621218477' } },
    { label: 'Leveling',        description: 'XP, rank cards & level roles',              value: 'leveling',    emoji: { id: '1521227915537285150' } },
    // ── System ──
    { label: 'Backup & DB',     description: 'Server backups, config & database',        value: 'backup',      emoji: { id: '1521228191899975810' } },
    { label: 'Webhook',         description: 'Create, manage & send webhooks',            value: 'webhook',     emoji: { id: '1521228008285929532' } },
];

/* ─────────────────────────────────────────────────────────────
   HOME PAGE CATEGORY ROWS
   ───────────────────────────────────────────────────────────── */

const HOME_CATEGORY_ROWS = [
    ['<:Music:1521228141543165982>',       'Music',       'music'],
    ['<:Volumeup:1521228004502536272>',     'Voice',       'voice'],
    ['<:banhammer:1521227777083314529>',    'Moderation',  'moderation'],
    ['<:Shield:1521227694677692467>',       'Security',    'security'],
    ['<:Hashtag:1521227771957870604>',         'Messages',    'msgmod'],
    ['<:Folder:1521228095225331765>',       'Server Mgmt', 'server'],
    ['<:Settings:1521227767780343879>',     'Settings',    'settings'],
    ['<:Checkedbox:1521227734943269077>',   'Trust',       'trust'],
    ['<:Refresh:1521227946441052420>',      'Automation',  'automation'],
    ['<:Caretright:1521227704953864202>',   'Components',  'components'],
    ['<:Bullhorn:1521227936575914016>',     'Invites',     'invites'],
    ['<:Pin:1521227932625014916>',          'Info',        'info'],
    ['<:Bookopen:1521227911137595605>',     'Basic',       'basic'],
    ['<:Lightning:1521227915537285150>',    'Stats',       'stats'],
    ['<:Caretright:1521227704953864202>',   'Images',      'image'],
    ['<:Envelope:1521228013910626426>',     'Encoding',    'encoding'],
    ['<:Gamepad:1521228035213230090>',      'Games',       'games'],
    ['<:Fire:1521227907647668374>',         'Fun',         'fun'],
    ['<:Star:1521227981685526568>',         'Anime',       'anime'],
    ['<:Money:1521228266957045900>',        'Action',      'action'],
    ['<:Money:1521228266957045900>',        'Economy',     'economy'],
    ['<:Inforect:1521228008285929532>',     'Social',      'social'],
    ['<:Lightning:1521227915537285150>',    'Leveling',    'leveling'],
    ['<:Folder:1521228095225331765>',       'Backup',      'backup'],
    ['<:Attach:1521228039135170722>',       'Webhook',     'webhook'],
    ['<:Lightningalt:1521227851796447472>', 'Owner',       'owner'],
];

/* ─────────────────────────────────────────────────────────────
   PREFIX → HELP CATEGORY ALIASES
   ───────────────────────────────────────────────────────────── */

const CATEGORY_ALIASES = {
    // Moderation
    mod: 'moderation', moderate: 'moderation', bans: 'moderation', ban: 'moderation',
    kick: 'moderation', kicks: 'moderation', warn: 'moderation', warns: 'moderation',
    mute: 'moderation', cases: 'moderation', logs: 'moderation', logging: 'moderation',
    // Security
    secure: 'security', sec: 'security', antiraid: 'security', raid: 'security',
    antispam: 'security', antinuke: 'security', automod: 'security', threat: 'security',
    // Message Tools
    msg: 'msgmod', messages: 'msgmod', message: 'msgmod', embeds: 'msgmod',
    embed: 'msgmod', snipe: 'msgmod', clear: 'msgmod',
    // Server Management
    channels: 'server', channel: 'server', roles: 'server', role: 'server',
    permissions: 'server', perms: 'server',
    // Settings
    config: 'settings', prefix: 'settings', setup: 'settings', emoji: 'settings',
    emojis: 'settings', sticker: 'settings', stickers: 'settings',
    // Trust System
    trusted: 'trust', whitelist: 'trust', admins: 'trust', mods: 'trust',
    owners: 'trust', admin: 'trust',
    // Automation
    auto: 'automation', welcome: 'automation', welcomes: 'automation', welcomer: 'automation',
    ticket: 'automation', tickets: 'automation',
    giveaway: 'automation', giveaways: 'automation', gaway: 'automation',
    reaction: 'automation', reactions: 'automation', reactionrole: 'automation',
    reactionroles: 'automation', rr: 'automation',
    roletemplate: 'automation', roletemplates: 'automation', rolepreset: 'automation', rt: 'automation',
    starboard: 'automation', stars: 'automation',
    autorole: 'automation', autoroles: 'automation',
    verify: 'automation', verification: 'automation',
    notifications: 'automation',
    // Components
    buttons: 'components', button: 'components', builder: 'components',
    builders: 'components', selectmenu: 'components',
    // Invites
    invite: 'invites', inviter: 'invites', invitetracker: 'invites',
    // Info
    info: 'info', userinfo: 'info', serverinfo: 'info', members: 'info',
    member: 'info', channelinfo: 'info',
    // Basic
    general: 'basic', bot: 'basic', misc: 'basic', lookup: 'basic',
    api: 'basic', tools: 'basic', util: 'basic', utils: 'basic', utility: 'basic',
    // Stats
    stat: 'stats', statistics: 'stats', activity: 'stats', leaderboard: 'stats',
    memberstats: 'stats', voicestats: 'stats', lb: 'stats',
    // Images
    img: 'image', images: 'image', filter: 'image', filters: 'image',
    // Encoding
    encode: 'encoding', decode: 'encoding', text: 'encoding', translate: 'encoding',
    morse: 'encoding', binary: 'encoding', base64: 'encoding',
    // Music
    songs: 'music', song: 'music', play: 'music',
    // Voice
    vc: 'voice', tts: 'voice',
    // Games (skill / no-bet)
    game: 'games', trivia: 'games', wordle: 'games',
    // Fun
    meme: 'fun', memes: 'fun', entertainment: 'fun',
    // Economy
    eco: 'economy', money: 'economy', coins: 'economy',
    highlow: 'economy', mine: 'economy', farm: 'economy', heist: 'economy',
    scratch: 'economy', dice: 'economy', loan: 'economy', craft: 'economy',
    gift: 'economy', 'economy-leaderboard': 'economy', eleaderboard: 'economy',
    blackjack: 'economy', bj: 'economy', roulette: 'economy', wheel: 'economy', rps: 'economy',
    tictactoe: 'economy', ttt: 'economy', connect4: 'economy', c4: 'economy',
    hangman: 'economy', numguess: 'economy', memory: 'economy', '2048': 'economy', battleship: 'economy',
    // Leveling
    lvl: 'leveling', xp: 'leveling', level: 'leveling', rank: 'leveling',
    // Social
    profile: 'social', rep: 'social', badges: 'social', marriage: 'social',
    // Action
    actions: 'action', roleplay: 'action',
    // Anime Collection
    animecollection: 'anime', gacha: 'anime', animecards: 'anime', animeroll: 'anime',
    cards: 'anime', collection: 'anime', acollection: 'anime', aroll: 'anime',
    // Backup
    backups: 'backup', db: 'backup', database: 'backup',
    // Webhook
    webhooks: 'webhook',
    // Owner
    dev: 'owner', bot_owner: 'owner', owner: 'owner',
};

/* ─────────────────────────────────────────────────────────────
   EXPORTS
   ───────────────────────────────────────────────────────────── */

module.exports = {
    NEW_COMMANDS,
    CATEGORY_GROUP_RULES,
    COMMAND_CATEGORY_MAP,
    FOLDER_FALLBACK,
    CATEGORY_META,
    CATEGORY_OPTIONS,
    HOME_CATEGORY_ROWS,
    CATEGORY_ALIASES,
};
