/* =========================================================
   xNico Dashboard — Module Schema
   Defines every module page, its fields, and route.
   Each field is rendered by app.js into a working form that
   saves to /api/guild/:id/:module
   ========================================================= */

window.XNICO_MODULES = [
    {
        id: 'welcomer',
        name: 'Welcomer',
        group: 'Engagement',
        description: 'Welcome & leave messages with Components V2, embeds, canvas cards, buttons and more.',
        icon: 'welcomer',
        custom: true  // rendered by a dedicated page function, not the generic form
    },
    {
        id: 'actions',
        name: 'Roleplay Actions',
        group: 'Engagement',
        description: 'Enable or disable roleplay action commands (hug, kiss, pat, etc.) for your server.',
        icon: 'star',
        fields: [
            { key: 'enabled', label: 'Enable Actions', type: 'toggle', premium: true }
        ]
    },
    {
        id: 'message-builder',
        name: 'Message Builder',
        group: 'Utility',
        description: 'Create & send custom messages with embeds, CV2 containers, buttons, and templates.',
        icon: 'chat',
        custom: true
    },
    {
        id: 'button-commands',
        name: 'Button Creator',
        group: 'Utility',
        description: 'Create interactive buttons with role, message, ticket and other actions.',
        icon: 'grid',
        custom: true
    },
    {
        id: 'select-menus',
        name: 'Menu Creator',
        group: 'Utility',
        description: 'Create dropdown select menus with per-option actions.',
        icon: 'hash',
        custom: true
    },
    {
        id: 'automod',
        name: 'AutoMod',
        group: 'Moderation',
        description: 'Automatic content filtering: bad words, spam, links, invites, mass mentions, caps.',
        icon: 'shield',
        custom: true
    },
    {
        id: 'leveling',
        name: 'Leveling',
        group: 'Engagement',
        description: 'XP system with level roles, announcements, multipliers and leaderboard.',
        icon: 'trend',
        custom: true
    },
    {
        id: 'economy',
        name: 'Economy',
        group: 'Engagement',
        description: 'Currency system with custom symbol, rewards, shop, gambling, and leaderboard.',
        icon: 'coin',
        custom: true
    },
    {
        id: 'tickets',
        name: 'Tickets',
        group: 'Utility',
        description: 'Support ticket system with categories, panels, and transcripts.',
        icon: 'ticket',
        custom: true
    },
    {
        id: 'logging',
        name: 'Audit Logging',
        group: 'Moderation',
        description: 'Track server events in log channels.',
        icon: 'log',
        fields: [
            { key: 'enabled', label: 'Enable Logging', type: 'toggle' },
            { key: 'modLog', label: 'Moderation Log', type: 'channel' },
            { key: 'messageLog', label: 'Message Log', type: 'channel' },
            { key: 'memberLog', label: 'Member Log', type: 'channel' },
            { key: 'serverLog', label: 'Server Log', type: 'channel' },
            { key: 'voiceLog', label: 'Voice Log', type: 'channel' },
            { key: 'ignoredChannels', label: 'Ignored Channels', type: 'channels' }
        ]
    },
    {
        id: 'antinuke',
        name: 'Anti-Nuke',
        group: 'Moderation',
        description: 'Stop mass bans, role/channel deletes, rogue webhooks and bot adds.',
        icon: 'nuke',
        custom: true
    },
    {
        id: 'antiraid',
        name: 'Anti-Raid',
        group: 'Moderation',
        description: 'Detect and stop raid-style mass joins.',
        icon: 'raid',
        fields: [
            { key: 'enabled', label: 'Enable Anti-Raid', type: 'toggle' },
            { key: 'joinLimit', label: 'Max Joins', type: 'number', min: 1, max: 100 },
            { key: 'timeWindow', label: 'Within (s)', type: 'number', min: 1, max: 300 },
            { key: 'action', label: 'Action', type: 'select', options: ['kick', 'ban', 'lockdown'] },
            { key: 'logChannel', label: 'Log Channel', type: 'channel' }
        ]
    },
    {
        id: 'antialt',
        name: 'Anti-Alt',
        group: 'Moderation',
        description: 'Block newly-created accounts from joining.',
        icon: 'user-x',
        fields: [
            { key: 'enabled', label: 'Enable Anti-Alt', type: 'toggle' },
            { key: 'minAge', label: 'Minimum Age (days)', type: 'number', min: 0, max: 365 },
            { key: 'action', label: 'Action', type: 'select', options: ['kick', 'ban'] },
            { key: 'logChannel', label: 'Log Channel', type: 'channel' }
        ]
    },
    {
        id: 'antispam',
        name: 'Anti-Spam',
        group: 'Moderation',
        description: 'Granular spam filtering.',
        icon: 'shield',
        fields: [
            { key: 'enabled', label: 'Enable Anti-Spam', type: 'toggle' },
            { key: 'logChannel', label: 'Log Channel', type: 'channel' },
            { section: 'Message Spam' },
            { key: 'messageSpam.enabled', label: 'Enabled', type: 'toggle' },
            { key: 'messageSpam.limit', label: 'Limit', type: 'number', min: 2, max: 20 },
            { key: 'messageSpam.time', label: 'Window (s)', type: 'number', min: 1, max: 60 },
            { key: 'messageSpam.action', label: 'Action', type: 'select', options: ['delete', 'warn', 'timeout', 'kick', 'ban'] },
            { section: 'Caps & Emoji Spam' },
            { key: 'capsSpam.enabled', label: 'Caps Spam', type: 'toggle' },
            { key: 'capsSpam.percentage', label: 'Caps %', type: 'number', min: 10, max: 100 },
            { key: 'emojiSpam.enabled', label: 'Emoji Spam', type: 'toggle' },
            { key: 'emojiSpam.limit', label: 'Emoji Limit', type: 'number', min: 1, max: 50 },
            { section: 'Mention Spam' },
            { key: 'mentionSpam.enabled', label: 'Mention Spam', type: 'toggle' },
            { key: 'mentionSpam.limit', label: 'Mention Limit', type: 'number', min: 1, max: 20 }
        ]
    },
    {
        id: 'antilink',
        name: 'Anti-Link',
        group: 'Moderation',
        description: 'Block or filter links with whitelists.',
        icon: 'link',
        fields: [
            { key: 'enabled', label: 'Enable Anti-Link', type: 'toggle' },
            { key: 'action', label: 'Action', type: 'select', options: ['delete', 'warn', 'timeout', 'kick', 'ban'] },
            { key: 'whitelistedLinks', label: 'Whitelisted Domains', type: 'tags', desc: 'e.g. discord.gg, youtube.com' },
            { key: 'whitelistedRoles', label: 'Whitelisted Roles', type: 'roles' },
            { key: 'whitelistedChannels', label: 'Whitelisted Channels', type: 'channels' },
            { key: 'logChannel', label: 'Log Channel', type: 'channel' }
        ]
    },
    {
        id: 'verification',
        name: 'Verification',
        group: 'Moderation',
        description: 'Button or captcha verification for new members.',
        icon: 'check',
        deploy: { panel: 'verification', label: 'Verification', needsChannel: true, channelKey: 'channelId' },
        fields: [
            { key: 'enabled', label: 'Enable Verification', type: 'toggle' },
            { key: 'type', label: 'Verification Type', type: 'select', options: ['button', 'captcha', 'reaction'] },
            { key: 'channelId', label: 'Verification Channel', type: 'channel' },
            { key: 'roleId', label: 'Verified Role', type: 'role' },
            { key: 'message', label: 'Verification Message', type: 'textarea' },
            { key: 'logChannel', label: 'Log Channel', type: 'channel' }
        ]
    },
    {
        id: 'trust',
        name: 'Trust System',
        group: 'Moderation',
        description: 'Manage trusted admins, moderators, and VC mods with auto-role assignment.',
        icon: 'shield',
        custom: true
    },
    {
        id: 'starboard',
        name: 'Starboard',
        group: 'Engagement',
        description: 'Highlight popular messages when they get enough star reactions.',
        icon: 'star',
        custom: true
    },
    {
        id: 'autorole',
        name: 'Auto-Role',
        group: 'Utility',
        description: 'Auto-assign roles when a human or bot joins the server.',
        icon: 'user-plus',
        custom: true
    },
    {
        id: 'music',
        name: 'Music',
        group: 'Entertainment',
        description: 'Music player settings: volume, queue, DJ role, vote-skip.',
        icon: 'music',
        deploy: { panel: 'music', label: 'Music', optionalChannel: true },
        fields: [
            { key: 'enabled', label: 'Enable Music', type: 'toggle' },
            { key: 'defaultVolume', label: 'Default Volume', type: 'number', min: 0, max: 200 },
            { key: 'maxQueueSize', label: 'Max Queue Size', type: 'number', min: 10, max: 1000 },
            { key: 'djRoleId', label: 'DJ Role', type: 'role', desc: 'Only this role can use DJ commands (skip, stop, etc). Leave empty for everyone.' },
            { key: 'voteSkip', label: 'Vote-Skip', type: 'toggle', desc: 'Require majority vote to skip a song.' },
            { key: 'announce', label: 'Announce Now-Playing', type: 'toggle', desc: 'Post a message when a new song starts.' }
        ]
    },
    {
        id: 'suggestions',
        name: 'Suggestions',
        group: 'Utility',
        description: 'Numbered suggestion cards with vote bars, threads, mod review and DMs.',
        icon: 'bulb',
        premium: true,
        custom: true
    },
    {
        id: 'feedback',
        name: 'Feedback',
        group: 'Utility',
        description: 'Star-rated feedback panel and analytics.',
        icon: 'star',
        premium: true,
        custom: true
    },
    {
        id: 'counting',
        name: 'Counting',
        group: 'Engagement',
        description: 'A counting game channel with stats and high scores.',
        icon: 'hash',
        custom: true
    },
    {
        id: 'autoreact',
        name: 'Auto-React',
        group: 'Engagement',
        description: 'Auto-add reactions when messages contain trigger words.',
        icon: 'smile',
        custom: true
    },
    {
        id: 'voice',
        name: 'Voice / J2C',
        group: 'Utility',
        description: 'Join-to-create temporary voice channels.',
        icon: 'mic',
        custom: true
    },
    {
        id: 'reactionroles',
        name: 'Reaction Roles',
        group: 'Utility',
        description: 'Role panels triggered by reactions or buttons.',
        icon: 'react-role',
        custom: true
    },
    {
        id: 'giveaway',
        name: 'Giveaways',
        group: 'Engagement',
        description: 'Run giveaways with role requirements, DM winners, and auto-end.',
        icon: 'gift',
        custom: true
    },
    {
        id: 'afk',
        name: 'AFK',
        group: 'Utility',
        description: 'Let members mark themselves as AFK with auto-notifications.',
        icon: 'moon',
        custom: true
    },
    {
        id: 'media-only',
        name: 'Media-Only',
        group: 'Utility',
        description: 'Force channels to only accept media attachments.',
        icon: 'image',
        custom: true
    },
    {
        id: 'sticky',
        name: 'Sticky Messages',
        group: 'Utility',
        description: 'Keep a message pinned at the bottom of a channel.',
        icon: 'pin',
        custom: true
    },
    {
        id: 'invites',
        name: 'Invite Tracking',
        group: 'Utility',
        description: 'Track invites with rewards, leaderboard, and alt detection.',
        icon: 'user-plus',
        custom: true
    },
    {
        id: 'serverstats',
        name: 'Stats Channels',
        group: 'Utility',
        description: 'Auto-updating voice channels showing member/role/boost counts.',
        icon: 'chart',
        custom: true
    },
    {
        id: 'backups',
        name: 'Server Backups',
        group: 'Utility',
        description: 'View server configuration backups.',
        icon: 'server',
        custom: true
    },
    {
        id: 'autoresponder',
        name: 'Auto-Responder',
        group: 'Utility',
        description: 'Auto-reply to trigger phrases with custom messages.',
        icon: 'chat',
        fields: [
            { key: 'enabled', label: 'Enable Auto-Responder', type: 'toggle' },
            {
                key: 'triggers', label: 'Triggers', type: 'jsonList',
                schema: [
                    { key: 'trigger', label: 'Trigger', type: 'text' },
                    { key: 'response', label: 'Response', type: 'textarea' },
                    { key: 'exact', label: 'Exact match', type: 'toggle' }
                ]
            }
        ]
    },
    {
        id: 'bot-customize',
        name: 'Bot Customize',
        group: 'Premium',
        premium: true,
        description: 'Custom bot nickname, avatar, prefix, embed colors and footer per server.',
        icon: 'settings',
        custom: true
    },

    // ── Newly surfaced bot features (added in dashboard v4.1) ─────────
    {
        id: 'aichat',
        name: 'AI Chat',
        group: 'Engagement',
        description: 'Set up a dedicated AI chat channel powered by Llama 3 / Groq.',
        icon: 'chat',
        premium: true,
        custom: true
    },
    {
        id: 'birthdays',
        name: 'Birthdays',
        group: 'Engagement',
        description: 'Auto-celebrate birthdays with messages, optional ping role and configurable hour.',
        icon: 'gift',
        custom: true
    },
    {
        id: 'applications',
        name: 'Applications',
        group: 'Utility',
        description: 'Custom application forms with reviewable responses, accept/deny role automation.',
        icon: 'log',
        custom: true
    },
    {
        id: 'warn-config',
        name: 'Warning Thresholds',
        group: 'Moderation',
        description: 'Punishment escalation per warn count: warning → timeout → kick → ban.',
        icon: 'shield',
        custom: true
    },
    {
        id: 'warnings',
        name: 'Warnings Log',
        group: 'Moderation',
        description: 'View and remove user warnings logged by the warn command.',
        icon: 'log',
        custom: true
    },
    {
        id: 'statusrole',
        name: 'Status Roles',
        group: 'Utility',
        description: 'Auto-assign roles when a member sets a configured custom status text.',
        icon: 'user-plus',
        custom: true
    },
    {
        id: 'botblock',
        name: 'Bot Block',
        group: 'Moderation',
        description: 'Auto-delete bot messages in configured channels.',
        icon: 'shield',
        custom: true
    },
    {
        id: 'vanityguard',
        name: 'Vanity Guard',
        group: 'Moderation',
        description: 'Detect, revert, and optionally ban anyone who changes the server vanity URL without permission.',
        icon: 'shield',
        premium: true,
        custom: true
    },
    {
        id: 'confessions',
        name: 'Confessions',
        group: 'Utility',
        description: 'Anonymous confession channel with reply threads and admin-only audit log.',
        icon: 'chat',
        premium: true,
        custom: true
    },
    {
        id: 'ignored-channels',
        name: 'Ignored Channels',
        group: 'Moderation',
        description: 'Channels excluded from leveling, logging, and automod scans.',
        icon: 'shield',
        custom: true
    },
    {
        id: 'modlogs',
        name: 'Moderation Logs',
        group: 'Moderation',
        description: 'Browse the real moderation cases logged by /warn, /ban, /kick, /timeout.',
        icon: 'log',
        custom: true
    },

    {
        id: 'autonick',
        name: 'Auto-Nick',
        group: 'Utility',
        description: 'Automatically nick new members to a custom format with {user} placeholders.',
        icon: 'user-plus',
        premium: true,
        fields: [
            { key: 'enabled', label: 'Enable Auto-Nick', type: 'toggle' },
            { key: 'format', label: 'Nickname Format', type: 'text', desc: 'Use {user} for username.' }
        ]
    },
    {
        id: 'nightmode',
        name: 'Night Mode',
        group: 'Moderation',
        description: 'Schedule channel lockdowns based on time of day to fight late-night raids.',
        icon: 'moon',
        premium: true,
        fields: [
            { key: 'enabled', label: 'Enable Night Mode', type: 'toggle' },
            { key: 'startHour', label: 'Start Hour (0-23)', type: 'number', min: 0, max: 23 },
            { key: 'endHour', label: 'End Hour (0-23)', type: 'number', min: 0, max: 23 },
            { key: 'lockChannels', label: 'Channels to Lock', type: 'channels' },
            { key: 'lockMessage', label: 'Lock Message', type: 'textarea' },
            { key: 'logChannel', label: 'Log Channel', type: 'channel' }
        ]
    },
    {
        id: 'superthreatmode',
        name: 'Super Threat Mode',
        group: 'Moderation',
        description: 'Tighten every protection (anti-nuke, anti-raid, automod) at once during an active threat.',
        icon: 'shield',
        premium: true,
        fields: [
            { key: 'enabled', label: 'Enable Super Threat Mode', type: 'toggle' },
            { key: 'triggerThreshold', label: 'Joins per minute to trigger', type: 'number', min: 1, max: 100 },
            { key: 'action', label: 'Auto Action', type: 'select', options: ['lockdown', 'kick', 'ban'] },
            { key: 'notifyChannel', label: 'Alert Channel', type: 'channel' }
        ]
    },
    {
        id: 'customshop',
        name: 'Custom Shop',
        group: 'Engagement',
        description: 'Build a guild-specific shop with custom items and reward actions (give role, DM, add coins...).',
        icon: 'gift',
        premium: true,
        fields: [
            { key: 'enabled', label: 'Enable Custom Shop', type: 'toggle' },
            { key: 'logChannel', label: 'Purchase Log Channel', type: 'channel' },
            {
                key: 'items', label: 'Shop Items', type: 'jsonList',
                schema: [
                    { key: 'name', label: 'Item Name', type: 'text' },
                    { key: 'price', label: 'Price', type: 'number' },
                    { key: 'roleReward', label: 'Reward Role (optional)', type: 'role' },
                    { key: 'description', label: 'Description', type: 'textarea' }
                ]
            }
        ]
    },
    {
        id: 'loan',
        name: 'Loan Office',
        group: 'Engagement',
        description: 'Borrow against your bank with daily interest and repay anytime.',
        icon: 'trend',
        premium: true,
        fields: [
            { key: 'enabled', label: 'Enable Loan Office', type: 'toggle' },
            { key: 'maxLoan', label: 'Max Loan Amount', type: 'number', min: 100, max: 10000000 },
            { key: 'dailyInterest', label: 'Daily Interest (%)', type: 'number', min: 1, max: 100 },
            { key: 'logChannel', label: 'Log Channel', type: 'channel' }
        ]
    },{
        id: 'profilebadge',
        name: 'Premium Profile Badge',
        group: 'Premium',
        description: 'A premium badge on your /profile and /userinfo views.',
        icon: 'crown',
        premium: true,
        fields: [
            { key: 'enabled', label: 'Show Premium Badge', type: 'toggle' }
        ]
    },

    // ── Parity additions (dashboard v4.2): systems the bot supports that
    //    previously had no dashboard surface. ───────────────────────────
    {
        id: 'botignore',
        name: 'Bot Ignore',
        group: 'Moderation',
        description: "Stop the bot responding to commands from chosen channels, roles or users.",
        icon: 'user-x',
        custom: true   // dedicated page lives in webhook-botignore.js
    },
    {
        id: 'webhook',
        name: 'Webhook Manager',
        group: 'Utility',
        description: 'View, create and delete this server\u2019s webhooks via the bot.',
        icon: 'link',
        custom: true   // dedicated page lives in webhook-botignore.js
    },
    {
        id: 'vote-config',
        name: 'Vote Rewards',
        group: 'Engagement',
        description: 'Announce and ping when members vote for the bot on listing sites.',
        icon: 'bell',
        ownerOnly: true,
        fields: [
            { key: 'enabled', label: 'Enable Vote Notifications', type: 'toggle' },
            { key: 'channelId', label: 'Announcement Channel', type: 'channel' },
            { key: 'pingRoleId', label: 'Ping Role', type: 'role', desc: 'Role pinged when someone votes (optional).' }
        ]
    },
    {
        id: 'social-notify',
        name: 'Social Alerts',
        group: 'Engagement',
        description: 'Announce new YouTube uploads and live streams in a channel.',
        icon: 'bell',
        fields: [
            { key: 'youtube.enabled', label: 'Enable YouTube Alerts', type: 'toggle' },
            { key: 'youtube.notifyChannel', label: 'Announcement Channel', type: 'channel' },
            { key: 'youtube.pingRole', label: 'Ping Role', type: 'role' },
            { key: 'youtube.channels', label: 'YouTube Channels (Unlimited on Premium)', type: 'tags', desc: 'Channel IDs or handles to watch. Limit 1 for free tier.', premium: true },
            { key: 'youtube.message', label: 'Upload Message', type: 'textarea', desc: 'Placeholders: {channel} {title} {url}', premium: true },
            { key: 'youtube.liveEnabled', label: 'Announce Live Streams', type: 'toggle' },
            { key: 'youtube.liveMessage', label: 'Live Message', type: 'textarea', desc: 'Placeholders: {channel} {url}', premium: true }
        ]
    },
    {
        id: 'servertag',
        name: 'Server Tag',
        group: 'Utility',
        description: 'Reward members who include your server tag in their name with a role, coins or XP.',
        icon: 'tag',
        fields: [
            { key: 'enabled', label: 'Enable Server Tag', type: 'toggle' },
            { key: 'tag', label: 'Tag Text', type: 'text', desc: 'The text members must include in their name.' },
            { key: 'roleId', label: 'Reward Role', type: 'role' },
            { key: 'notifyChannel', label: 'Notify Channel', type: 'channel' },
            { key: 'coinReward', label: 'Coin Reward', type: 'number', min: 0, max: 1000000 },
            { key: 'xpReward', label: 'XP Reward', type: 'number', min: 0, max: 1000000 },
            { key: 'dmNotify', label: 'DM member on reward', type: 'toggle' }
        ]
    },
    {
        id: 'broadcaster',
        name: 'Broadcaster',
        group: 'Utility',
        description: 'Send a notification to a specific channel when you activate new features.',
        icon: 'bell',
        fields: [
            { key: 'enabled', label: 'Enable Broadcaster', type: 'toggle' },
            { key: 'channelId', label: 'Broadcast Channel', type: 'channel' }
        ]
    },
    {
        id: 'guildtags',
        name: 'Guild Tag',
        group: 'Utility',
        description: 'Set the guild tag used by the bot\u2019s tag features.',
        icon: 'tag',
        fields: [
            { key: 'enabled', label: 'Enable Guild Tag', type: 'toggle' },
            { key: 'tag', label: 'Guild Tag', type: 'text' }
        ]
    }
];

// Module icons — resolved by app.js
window.XNICO_ICONS = {
    welcomer: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    coin: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    ticket: '<path d="M3 7v3a2 2 0 0 1 0 4v3a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3a2 2 0 0 1 0-4V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"/><line x1="13" y1="5" x2="13" y2="19"/>',
    log: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    nuke: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
    raid: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    'user-x': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.8V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.2A7 7 0 0 0 12 2z"/>',
    hash: '<line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    smile: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
    mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
    'react-role': '<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>',
    gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
    moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    pin: '<line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.68-4.38A4 4 0 0 1 17 11V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v6a4 4 0 0 1-.32 1.62L5 17z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
    server: '<rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
    code: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
    crown: '<path d="M3 17l2-10 5 5 2-7 2 7 5-5 2 10"/>',
    chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'
};


