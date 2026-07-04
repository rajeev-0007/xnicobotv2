'use strict';

/**
 * emit.js — Owner-only debugging tool that fires Discord client events
 * with synthetic payloads so listeners (logging, automod, welcomers,
 * starboard, anti-nuke, etc.) can be exercised without waiting for a
 * real event to occur.
 *
 * Usage:
 *   emit                    → list every supported event
 *   emit <event>            → fire <event> using sensible defaults
 *   emit <event> @user      → fire <event> with mentioned user as the target
 */

const { isOwner } = require('../../utils/helpers');
const { MessageFlags, SeparatorSpacingSize, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require('discord.js');
const {
    buildSuccessResponse, buildErrorResponse,
    COLORS, EMOJIS, BRANDING
} = require('../../utils/responseBuilder');

/* ─────────────── supported events ─────────────── */

const SUPPORTED_EVENTS = {
    // ── Members ──
    guildMemberAdd:     { description: 'Member joins the server',       emoji: '<:Userplus:1521227719621218477>',   target: 'member', requiresGuild: true },
    guildMemberRemove:  { description: 'Member leaves the server',      emoji: '<:Userblock:1521227822641975366>',  target: 'member', requiresGuild: true },
    guildMemberUpdate:  { description: 'Member updated (role/nick)',    emoji: '<:Editalt:1521227921673556019>',    target: 'member', requiresGuild: true },
    guildMemberAvailable:{description: 'Member becomes available',      emoji: '<:online:1521228065752088576>',     target: 'member', requiresGuild: true },
    userUpdate:         { description: 'Global user update (name/avatar)', emoji: '<:Edit:1521227886634205298>',    target: 'user',   requiresGuild: false },

    // ── Bans ──
    guildBanAdd:        { description: 'Member is banned',              emoji: '<:banhammer:1521227777083314529>',  target: 'ban',    requiresGuild: true },
    guildBanRemove:     { description: 'Member is unbanned',            emoji: '<:Unlock:1521228030842769610>',     target: 'ban',    requiresGuild: true },

    // ── Channels ──
    channelCreate:      { description: 'Channel is created',            emoji: '<:Add:1521227828199293152>',        target: 'channel', requiresGuild: true },
    channelDelete:      { description: 'Channel is deleted',            emoji: '<:Trash:1521227750420254820>',      target: 'channel', requiresGuild: true },
    channelUpdate:      { description: 'Channel is updated',            emoji: '<:Editalt:1521227921673556019>',    target: 'channel', requiresGuild: true },
    channelPinsUpdate:  { description: 'Channel pins changed',          emoji: '<:Pin:1521227932625014916>',        target: 'channel', requiresGuild: true },

    // ── Roles ──
    roleCreate:         { description: 'Role is created',               emoji: '<:Add:1521227828199293152>',        target: 'role',    requiresGuild: true },
    roleDelete:         { description: 'Role is deleted',               emoji: '<:Trash:1521227750420254820>',      target: 'role',    requiresGuild: true },
    roleUpdate:         { description: 'Role is updated',               emoji: '<:Editalt:1521227921673556019>',    target: 'role',    requiresGuild: true },

    // ── Threads ──
    threadCreate:       { description: 'Thread created',                emoji: '<:Hashtag:1521227771957870604>',       target: 'thread',  requiresGuild: true },
    threadDelete:       { description: 'Thread deleted',                emoji: '<:Trash:1521227750420254820>',      target: 'thread',  requiresGuild: true },
    threadUpdate:       { description: 'Thread updated',                emoji: '<:Editalt:1521227921673556019>',    target: 'thread',  requiresGuild: true },

    // ── Messages ──
    messageCreate:      { description: 'Message is sent',               emoji: '<:Hashtag:1521227771957870604>',       target: 'message', requiresGuild: false },
    messageDelete:      { description: 'Message is deleted',            emoji: '<:Trash:1521227750420254820>',      target: 'message', requiresGuild: false },
    messageUpdate:      { description: 'Message is edited',             emoji: '<:Editalt:1521227921673556019>',    target: 'message', requiresGuild: false },

    // ── Reactions ──
    messageReactionAdd:    { description: 'Reaction added (synthetic)', emoji: '<:Add:1521227828199293152>',        target: 'reaction', requiresGuild: false },
    messageReactionRemove: { description: 'Reaction removed (synthetic)', emoji: '<:Trash:1521227750420254820>',    target: 'reaction', requiresGuild: false },

    // ── Voice ──
    voiceStateUpdate:   { description: 'Voice state change (join/leave/mute)', emoji: '<:Volumeup:1521228004502536272>', target: 'voiceState', requiresGuild: true },

    // ── Emojis & stickers ──
    emojiCreate:        { description: 'Emoji created',                 emoji: '<:Add:1521227828199293152>',        target: 'emoji',   requiresGuild: true },
    emojiDelete:        { description: 'Emoji deleted',                 emoji: '<:Trash:1521227750420254820>',      target: 'emoji',   requiresGuild: true },
    stickerCreate:      { description: 'Sticker created',               emoji: '<:Add:1521227828199293152>',        target: 'sticker', requiresGuild: true },
    stickerDelete:      { description: 'Sticker deleted',               emoji: '<:Trash:1521227750420254820>',      target: 'sticker', requiresGuild: true },

    // ── Invites ──
    inviteCreate:       { description: 'Invite created',                emoji: '<:Add:1521227828199293152>',        target: 'invite',  requiresGuild: true },
    inviteDelete:       { description: 'Invite deleted',                emoji: '<:Trash:1521227750420254820>',      target: 'invite',  requiresGuild: true },

    // ── Guild lifecycle ──
    guildCreate:        { description: 'Bot joins a server',            emoji: '<:Checkedbox:1521227734943269077>', target: 'guild',   requiresGuild: true },
    guildDelete:        { description: 'Bot leaves a server',           emoji: '<:Cancel:1521227723916181644>',     target: 'guild',   requiresGuild: true },
    guildUpdate:        { description: 'Guild settings updated',        emoji: '<:Editalt:1521227921673556019>',    target: 'guild',   requiresGuild: true },
    guildAvailable:     { description: 'Guild becomes available',       emoji: '<:online:1521228065752088576>',     target: 'guild',   requiresGuild: true },
    guildUnavailable:   { description: 'Guild becomes unavailable',     emoji: '<:offline:1521228263177977897>',    target: 'guild',   requiresGuild: true },

    // ── Misc client signals ──
    typingStart:        { description: 'Typing started (synthetic)',    emoji: '<:Edit:1521227886634205298>',       target: 'typing',  requiresGuild: false },
    presenceUpdate:     { description: 'Presence change (synthetic)',   emoji: '<:online:1521228065752088576>',     target: 'presence', requiresGuild: true },

    // ── Cannot be safely simulated ──
    interactionCreate:  { description: 'Interaction triggered (cannot simulate)', emoji: '<:Settings:1521227767780343879>', target: 'interaction', requiresGuild: false }
};

/* ─────────────── target builders ─────────────── */

function buildEventTarget(event, message, targetUser) {
    const info = SUPPORTED_EVENTS[event];
    if (!info) return null;

    const member = targetUser
        ? message.guild?.members.cache.get(targetUser.id) || message.member
        : message.member;
    const userObj = targetUser || message.author;

    switch (info.target) {
        case 'member':     return member;
        case 'user':       return userObj;
        case 'ban':        return { guild: message.guild, user: (member?.user) || userObj };
        case 'channel':    return message.channel;
        case 'role':       return message.guild?.roles.cache.find(r => !r.managed && r.id !== message.guild.id) || message.guild?.roles.everyone;
        case 'thread':     return message.guild?.channels.cache.find(c => c.isThread?.()) || null;
        case 'message':    return message;
        case 'reaction': {
            // Build a synthetic MessageReaction-like object.
            return {
                message,
                emoji: { name: '👍', id: null, toString: () => '👍' },
                count: 1,
                me: false,
                users: { cache: new Map() }
            };
        }
        case 'voiceState': {
            // emit(voiceStateUpdate, oldState, newState) — return the member's current state both ways.
            return member?.voice || null;
        }
        case 'emoji':      return message.guild?.emojis.cache.first() || null;
        case 'sticker':    return message.guild?.stickers.cache.first() || null;
        case 'invite':     return null;       // handled specially below
        case 'guild':      return message.guild;
        case 'typing':     return { channel: message.channel, user: userObj, startedAt: new Date() };
        case 'presence':   return member?.presence || null;
        case 'interaction':return null;
        default:           return member;
    }
}

/* ─────────────── help panel ─────────────── */

function buildEventListContainer() {
    let listContent = `# ${EMOJIS.LIST} Event Emitter\n\n`;
    listContent += `Fire Discord client events with synthetic payloads to test listeners.\n\n`;

    const groups = {
        'Members':            ['guildMemberAdd', 'guildMemberRemove', 'guildMemberUpdate', 'guildMemberAvailable', 'userUpdate'],
        'Bans':               ['guildBanAdd', 'guildBanRemove'],
        'Channels & Threads': ['channelCreate', 'channelDelete', 'channelUpdate', 'channelPinsUpdate', 'threadCreate', 'threadDelete', 'threadUpdate'],
        'Roles':              ['roleCreate', 'roleDelete', 'roleUpdate'],
        'Messages':           ['messageCreate', 'messageDelete', 'messageUpdate'],
        'Reactions':          ['messageReactionAdd', 'messageReactionRemove'],
        'Voice':              ['voiceStateUpdate'],
        'Emojis & Stickers':  ['emojiCreate', 'emojiDelete', 'stickerCreate', 'stickerDelete'],
        'Invites':            ['inviteCreate', 'inviteDelete'],
        'Guild Lifecycle':    ['guildCreate', 'guildDelete', 'guildUpdate', 'guildAvailable', 'guildUnavailable'],
        'Misc':               ['typingStart', 'presenceUpdate', 'interactionCreate']
    };

    for (const [groupName, events] of Object.entries(groups)) {
        listContent += `### ${groupName}\n`;
        for (const name of events) {
            const info = SUPPORTED_EVENTS[name];
            if (!info) continue;
            listContent += `> ${info.emoji} \`${name}\` — ${info.description}\n`;
        }
        listContent += `\n`;
    }

    listContent += `### Usage\n`;
    listContent += `\`emit <event>\` — emit using yourself as target\n`;
    listContent += `\`emit <event> @user\` — emit with mentioned user as target\n`;

    return new ContainerBuilder()
        .setAccentColor(COLORS.CYAN || 0x5BC0EB)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(listContent))
;
}

/* ─────────────── module ─────────────── */

module.exports = {
    name: 'emit',
    prefix: 'emit',
    aliases: ['fireevent', 'triggerevent', 'eventfire'],
    description: 'Owner-only: emit Discord client events for testing',
    usage: 'emit [event] [@user]',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message, args, lavalinkManager, client) {
        if (!isOwner(message.author.id)) {
            const container = buildErrorResponse('Owner Only', 'This command is restricted to the bot owner.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const event = args[0];
        const targetUser = message.mentions.users.first();

        // No args → show event list
        if (!event) {
            return message.reply({ components: [buildEventListContainer()], flags: MessageFlags.IsComponentsV2 });
        }

        if (!SUPPORTED_EVENTS[event]) {
            const container = buildErrorResponse(
                'Unknown Event',
                `**${event}** is not a supported event.`,
                'Run `emit` (no args) to see the full list.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const eventInfo = SUPPORTED_EVENTS[event];

        if (eventInfo.requiresGuild && !message.guild) {
            const container = buildErrorResponse('Guild Required', `The **${event}** event must be emitted inside a server.`);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Block events that cannot be safely faked.
        if (event === 'interactionCreate') {
            const container = buildErrorResponse('Cannot Emit', '`interactionCreate` requires a real Interaction object and cannot be safely simulated.');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const target = buildEventTarget(event, message, targetUser);

        if (target === null && !['invite', 'interaction'].includes(eventInfo.target)) {
            const container = buildErrorResponse('Target Error', `Could not build a valid target for **${event}**.`);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            // Events that need special argument patterns.
            switch (event) {
                case 'guildMemberUpdate':
                case 'channelUpdate':
                case 'roleUpdate':
                case 'threadUpdate':
                case 'guildUpdate':
                case 'messageUpdate':
                case 'userUpdate':
                case 'presenceUpdate':
                    // (oldX, newX)
                    client.emit(event, target, target);
                    break;
                case 'voiceStateUpdate':
                    // (oldState, newState)
                    client.emit(event, target, target);
                    break;
                case 'inviteCreate':
                case 'inviteDelete': {
                    // Construct a minimal invite-like object.
                    const fakeInvite = {
                        guild: message.guild,
                        channel: message.channel,
                        code: 'EMIT-FAKE',
                        inviter: message.author,
                        uses: 0,
                        maxUses: 0,
                        maxAge: 0,
                        temporary: false,
                        createdTimestamp: Date.now(),
                        url: 'https://discord.gg/EMIT-FAKE'
                    };
                    client.emit(event, fakeInvite);
                    break;
                }
                case 'channelPinsUpdate':
                    client.emit(event, target, new Date());
                    break;
                default:
                    client.emit(event, target);
            }

            const member = targetUser
                ? message.guild?.members.cache.get(targetUser.id) || message.member
                : message.member;

            const targetLabel = (() => {
                switch (eventInfo.target) {
                    case 'member':
                    case 'ban':       return member ? `${member.user.tag} (${member.id})` : 'N/A';
                    case 'user':      return `${(targetUser || message.author).tag}`;
                    case 'channel':   return message.channel ? `#${message.channel.name} (${message.channel.id})` : 'N/A';
                    case 'guild':     return message.guild ? `${message.guild.name} (${message.guild.id})` : 'N/A';
                    case 'message':   return `Message in #${message.channel.name}`;
                    case 'role':      return 'Server role';
                    case 'thread':    return 'First thread in cache';
                    case 'reaction':  return 'Synthetic reaction (👍)';
                    case 'voiceState':return member ? `${member.user.tag} voice state` : 'N/A';
                    case 'emoji':     return 'First guild emoji';
                    case 'sticker':   return 'First guild sticker';
                    case 'invite':    return 'Synthetic invite (EMIT-FAKE)';
                    case 'typing':    return `${(targetUser || message.author).tag} in #${message.channel.name}`;
                    case 'presence':  return member ? `${member.user.tag} presence` : 'N/A';
                    default:          return 'N/A';
                }
            })();

            const container = buildSuccessResponse(
                'Event Emitted',
                `Successfully emitted **${event}**.`,
                {
                    'Event':       `${eventInfo.emoji} ${event}`,
                    'Description': eventInfo.description,
                    'Target':      targetLabel,
                    'Emitted By':  message.author.tag
                },
                true
            );
            container.setAccentColor(0x57F287);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[emit] Error:', error);
            const container = buildErrorResponse('Emit Failed', `Failed to emit **${event}**.`, error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
