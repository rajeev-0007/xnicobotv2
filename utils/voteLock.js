'use strict';

/**
 * voteLock.js — Vote-gated commands system.
 *
 * Commands listed here require the user to have voted within the last 12 hours.
 * Users with active vote perks (from top.gg webhook) bypass automatically.
 * Premium users always bypass.
 */

const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const jsonStore = require('./jsonStore');

/* ─────────────────────────────────────────────────────────────
   VOTE-LOCKED COMMANDS
   Add command names here to gate them behind voting.
   ───────────────────────────────────────────────────────────── */

const VOTE_LOCKED_COMMANDS = new Set([
    // Economy — high-value earning
    'rob',
    'heist',
    'adventure',
    'lottery',
    'mine',
    'farm',
    'craft',
    // Economy — gambling
    'crash',
    'mines',
    'plinko',
    'tower',
    'limbo',
    'keno',
    'roulette',
    'blackjack',
    'wheel',
    // Economy — PvP
    'battle',
    'stocks',
    'auction',
    // Anime Collection
    'aroll',
    'atrade',
    'agift',
    // Music
    'filters',
    'bassboost',
    'equalizer',
    'recommendations',
    // Fun
    'ship',
    'howrich',
    'faketweet',
    // Games
    'akinator',
    // Image
    'imagine',
    'deepfry',
    'trigger',
    // Social
    'marry',
    'profile-customize',
    'rank-customize',
    // Leveling
    'levelmultiplier',
    // Voice
    'speak',
    'record',
    // Server / Admin
    'server-backup-create',
    'massban',
    'masskick',
    // Automation
    'giveaway',
    // Stats
    'liveleaderboard',
    // Encoding
    'translate',
    // Basic / Utility
    'screenshot',
    'weather',
    'download',
    'reddit',
    'spotify',
    'anime',
    'manga',
    'crypto',
    'urban',
    'wikipedia',
    'stockprice',
    // Action / Roleplay (20%)
    'kiss',
    'cuddle',
    'slap',
    'punch',
    'carry',
    'lappillow',
    'snuggle',
    'blowkiss',
    'yeet',
    'shoot',
    'bully',
    // Admin / Moderation (30%)
    'massban',
    'masskick',
    'unbanall',
    'massnick',
    'softban',
    'hackban',
    'nuke',
    'clearspam',
    // Automation (10%)
    'automeme',
    'starboard-setup',
    'reactionroles',
    // Games (4 commands)
    'akinator',
    'wordle',
    'truthdare',
    'wouldyourather',
    // Music (10%)
    'filters',
    'bassboost',
    'equalizer',
    'recommendations',
    // Voice (10%)
    'speak',
    'record',
    'voicemoveall',
]);

/* ─────────────────────────────────────────────────────────────
   CHECK FUNCTIONS
   ───────────────────────────────────────────────────────────── */

function isVoteLocked(commandName) {
    return VOTE_LOCKED_COMMANDS.has(commandName);
}

function hasActiveVote(userId) {
    try {
        // read() returns {} when the store isn't present, so this is safe
        // regardless of whether the store has been lazily loaded yet.
        const userVotes = jsonStore.read('user-votes') || {};
        const data = userVotes[userId];
        if (!data || !data.lastVote) return false;
        // 12 hour window
        return (Date.now() - data.lastVote) < 12 * 60 * 60 * 1000;
    } catch {
        return false;
    }
}

/* ─────────────────────────────────────────────────────────────
   GATE UI
   ───────────────────────────────────────────────────────────── */

function buildVoteGate(commandName) {
    const clientId = process.env.CLIENT_ID || '';
    const voteLink = `https://top.gg/bot/${clientId}/vote`;

    const container = new ContainerBuilder().setAccentColor(0x5865F2);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `# <:Shield:1521227694677692467> Vote Required\n\n` +
        `> The command \`${commandName}\` requires you to vote for the bot.\n\n` +
        `<:Caretright:1521227704953864202> **No-Prefix** Access For **12 Hours**\n` +
        `<:Caretright:1521227704953864202> Unlock **vote-locked** commands\n` +
        `<:Caretright:1521227704953864202> Support the bot and help it grow\n\n` +
        `-# Vote once every 12 hours to keep access. Premium users bypass this.`
    ));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Vote Now')
            .setURL(voteLink)
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:topgg:1521228219066482790>'),
        new ButtonBuilder()
            .setLabel('Vote on DBL')
            .setURL('https://discordbotlist.com/bots/xnico')
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:Cursor:1521228147071127732>')
    );
    container.addActionRowComponents(row);

    return container;
}

module.exports = {
    VOTE_LOCKED_COMMANDS,
    isVoteLocked,
    hasActiveVote,
    buildVoteGate,
};
