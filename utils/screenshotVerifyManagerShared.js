'use strict';

/**
 * Shared constants + read-only helpers for the screenshot verification
 * system. Lives in its own file so embed builders can import it without
 * pulling the full manager (which would create a cycle).
 */

const jsonStore = require('./jsonStore');

const STORE_CONFIG = 'screenshot-verify';
const STORE_SUBS   = 'screenshot-verify-submissions';

const MAX_TASKS_PER_GUILD       = 15;
const MAX_ACTIONS_PER_TASK      = 8;
const MAX_IMAGE_BYTES           = 8 * 1024 * 1024;
const DEFAULT_CONFIDENCE        = 75;

const TASK_PRESETS = {
    youtube_subscribe: {
        label: 'YouTube Subscribe',
        emoji: '<:Lightning:1521227915537285150>',
        defaultName: 'YouTube Subscribe',
        defaultDescription: 'Subscribe to our YouTube channel and post a screenshot showing the **Subscribed** button.',
        defaultKeywords: ['youtube', 'subscribed', 'subscribe', 'bell', 'notifications'],
        targetHint: 'YouTube channel name or @handle (e.g. @xNico)'
    },
    instagram_follow: {
        label: 'Instagram Follow',
        emoji: '<:Heart:1521228100652765247>',
        defaultName: 'Instagram Follow',
        defaultDescription: 'Follow our Instagram and post a screenshot showing the **Following** button on our profile.',
        defaultKeywords: ['instagram', 'following', 'followers', 'profile', 'posts'],
        targetHint: 'Instagram username (e.g. @xnico.bot)'
    },
    twitter_follow: {
        label: 'X / Twitter Follow',
        emoji: '<:Lightning:1521227915537285150>',
        defaultName: 'X / Twitter Follow',
        defaultDescription: 'Follow us on X (Twitter) and post a screenshot showing the **Following** button.',
        defaultKeywords: ['x.com', 'twitter', 'following', 'follow', 'profile'],
        targetHint: 'X / Twitter handle (e.g. @xNicoBot)'
    },
    tiktok_follow: {
        label: 'TikTok Follow',
        emoji: '<:Lightning:1521227915537285150>',
        defaultName: 'TikTok Follow',
        defaultDescription: 'Follow our TikTok and post a screenshot showing the **Following** button.',
        defaultKeywords: ['tiktok', 'following', 'follow', 'profile', 'fyp'],
        targetHint: 'TikTok handle (e.g. @xnico)'
    },
    discord_join: {
        label: 'Discord Server Join',
        emoji: '<:Userplus:1521227719621218477>',
        defaultName: 'Discord Server Join',
        defaultDescription: 'Join our Discord and post a screenshot showing you are a member.',
        defaultKeywords: ['discord', 'channel', 'server', 'members', 'voice'],
        targetHint: 'Discord server name or invite (e.g. discord.gg/xnico)'
    },
    website_signup: {
        label: 'Website Signup',
        emoji: '<:Document:1521227875016114266>',
        defaultName: 'Website Signup',
        defaultDescription: 'Sign up on our website and post a screenshot of your account dashboard.',
        defaultKeywords: ['account', 'profile', 'dashboard', 'welcome', 'signed up'],
        targetHint: 'Website URL (e.g. thenico.vercel.app)'
    },
    custom: {
        label: 'Custom Task',
        emoji: '<:Settings:1521227767780343879>',
        defaultName: 'Custom Verification',
        defaultDescription: 'Complete the action described and post a screenshot proving it.',
        defaultKeywords: [],
        targetHint: 'Anything (e.g. URL, handle, action name)'
    }
};

const ACTION_PRESETS = {
    add_role: {
        label:       'Add Role',
        emoji:       '<:Userplus:1521227719621218477>',
        description: 'Grant a role to the user when this task succeeds.',
        params:      ['roleId']
    },
    remove_role: {
        label:       'Remove Role',
        emoji:       '<:Trash:1521227750420254820>',
        description: 'Remove a role from the user (e.g. an "Unverified" gating role).',
        params:      ['roleId']
    },
    send_channel: {
        label:       'Send Channel Message',
        emoji:       '<:Hashtag:1521227771957870604>',
        description: 'Post a public message in a channel announcing the verification.',
        params:      ['channelId', 'content']
    },
    send_dm: {
        label:       'Send DM',
        emoji:       '<:Envelope:1521228013910626426>',
        description: 'DM the user with a custom message.',
        params:      ['content']
    }
};

function countByStatus(guildId) {
    if (!jsonStore.has(STORE_SUBS)) return { pending: 0, approved: 0, rejected: 0, total: 0 };
    const guildSubs = jsonStore.peekGuild(STORE_SUBS, guildId) || {};
    let pending = 0, approved = 0, rejected = 0;
    for (const s of Object.values(guildSubs)) {
        if (s.status === 'pending')       pending++;
        else if (s.status === 'approved') approved++;
        else if (s.status === 'rejected') rejected++;
    }
    return { pending, approved, rejected, total: pending + approved + rejected };
}

module.exports = {
    STORE_CONFIG, STORE_SUBS,
    TASK_PRESETS, ACTION_PRESETS,
    MAX_TASKS_PER_GUILD, MAX_ACTIONS_PER_TASK,
    MAX_IMAGE_BYTES, DEFAULT_CONFIDENCE,
    countByStatus
};
