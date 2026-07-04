'use strict';

const fs = require('fs');
const path = require('path');
const { ChannelType, PermissionFlagsBits } = require('discord.js');

const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

/* ─── Available stat types with their display templates ─── */
/* Styles: 'default' uses xN prefix, 'minimal' uses emoji prefix,
   'dots' uses dot separators like the Voice Statistics image */
const STAT_STYLES = {
    default:  { prefix: 'xN | ', separator: ': ' },
    minimal:  { prefix: '', separator: ': ' },
    dots:     { prefix: '· ', separator: ' ' },
    brackets: { prefix: '[ ', separator: ' ] ' },
    clean:    { prefix: '', separator: ' — ' }
};

const STAT_TYPES = {
    members:   { emoji: '1⃣', label: 'Members',    template: '{prefix}Members{sep}{value}' },
    humans:    { emoji: '2⃣', label: 'Humans',     template: '{prefix}Humans{sep}{value}' },
    bots:      { emoji: '3⃣', label: 'Bots',       template: '{prefix}Bots{sep}{value}' },
    channels:  { emoji: '4⃣', label: 'Channels',   template: '{prefix}Channels{sep}{value}' },
    roles:     { emoji: '5⃣', label: 'Roles',      template: '{prefix}Roles{sep}{value}' },
    online:    { emoji: '6⃣', label: 'Online',     template: '{prefix}Online{sep}{value}' },
    inVoice:   { emoji: '7⃣', label: 'In Voice',   template: '{prefix}{value} Users' },
    boosts:    { emoji: '8⃣', label: 'Boosts',     template: '{prefix}Boosts{sep}{value}' },
    boostTier: { emoji: '9⃣', label: 'Boost Level', template: '{prefix}Level{sep}{value}' },
    textCh:    { emoji: '🔟', label: 'Text Ch.',   template: '{prefix}Text{sep}{value}' },
    voiceCh:   { emoji: '🔢', label: 'Voice Ch.',  template: '{prefix}Voice{sep}{value}' },
    categories:{ emoji: '🔣', label: 'Categories', template: '{prefix}Categories{sep}{value}' },
    activeVc:  { emoji: '🔊', label: 'Active VC',  template: '{prefix}{value} Active VC' }
};

/* ─── Load / Save config ─── */
let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 5000;

function loadConfig() {
    const now = Date.now();
    if (_configCache && (now - _configCacheTime) < CONFIG_CACHE_TTL) return _configCache;
    _configCache = jsonStore.read('serverstats');
    _configCacheTime = now;
    return _configCache;
}

function saveConfig(data) {
    try {
        jsonStore.write('serverstats', data);
        _configCache = data;
        _configCacheTime = Date.now();
    } catch (e) {
        log.error('ServerStats: Failed to save config:', e.message);
    }
}

/**
 * Drop the in-memory TTL cache so the next loadConfig() call hits jsonStore.
 * Called by utils/storeSync.js when the 'serverstats' store is updated from
 * any source (dashboard PUT, slash command, PostgreSQL poll). Without this,
 * a dashboard change to the serverstats config could go unseen by this
 * manager for up to CONFIG_CACHE_TTL milliseconds.
 */
function invalidateCache() {
    _configCache = null;
    _configCacheTime = 0;
}

function getGuildConfig(guildId) {
    const all = loadConfig();
    return all[guildId] || null;
}

function setGuildConfig(guildId, config) {
    const all = loadConfig();
    all[guildId] = config;
    saveConfig(all);
}

function removeGuildConfig(guildId) {
    const all = loadConfig();
    delete all[guildId];
    saveConfig(all);
}

/* ─── Compute stat values ─── */

// Track last full member fetch per guild to avoid spamming the API
const _lastMemberFetch = new Map();
const MEMBER_FETCH_INTERVAL = 10 * 60 * 1000; // Only re-fetch all members every 10 min

async function computeStats(guild) {
    try {
        // Only do a full member fetch if cache is significantly stale
        // guild.memberCount is always accurate (gateway), but cache might not have all members
        const now = Date.now();
        const lastFetch = _lastMemberFetch.get(guild.id) || 0;
        const cacheRatio = guild.members.cache.size / (guild.memberCount || 1);

        // Fetch members only if cache has less than 90% of members AND we haven't fetched recently
        if (cacheRatio < 0.9 && (now - lastFetch) > MEMBER_FETCH_INTERVAL) {
            try {
                await guild.members.fetch({ time: 15_000 });
                _lastMemberFetch.set(guild.id, Date.now());
            } catch {
                // If fetch fails, work with what we have in cache
            }
        }

        const members = guild.memberCount || 0;
        const cachedBots = guild.members.cache.filter(m => m.user?.bot).size;
        
        // If cache covers most of the guild, use precise count. Otherwise estimate.
        let bots, humans;
        if (guild.members.cache.size >= members * 0.8) {
            bots = cachedBots;
            humans = Math.max(0, members - bots);
        } else {
            // Cache is incomplete — use cached ratio to estimate
            const botRatio = guild.members.cache.size > 0 ? cachedBots / guild.members.cache.size : 0;
            bots = Math.round(members * botRatio);
            humans = Math.max(0, members - bots);
        }

        const allChannels = guild.channels.cache;
        const channels = allChannels.filter(c => c.type !== ChannelType.GuildCategory).size;
        const roles = guild.roles.cache.size;
        const online = 0; // Presence Intent disabled – always 0
        const inVoice = guild.voiceStates?.cache?.filter(vs => vs.channelId).size || guild.members.cache.filter(m => m.voice?.channelId).size;
        const boosts = guild.premiumSubscriptionCount || 0;
        const boostTier = guild.premiumTier || 0;
        const textCh = allChannels.filter(c => [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(c.type)).size;
        const voiceCh = allChannels.filter(c => [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(c.type)).size;
        const categories = allChannels.filter(c => c.type === ChannelType.GuildCategory).size;
        const activeVc = allChannels.filter(c =>
            (c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice) && c.members?.size > 0
        ).size;

        return { members, humans, bots, channels, roles, online, inVoice, boosts, boostTier, textCh, voiceCh, categories, activeVc };
    } catch (e) {
        log.error('ServerStats: Failed to compute stats:', e.message);
        return { members: 0, humans: 0, bots: 0, channels: 0, roles: 0, online: 0, inVoice: 0, boosts: 0, boostTier: 0, textCh: 0, voiceCh: 0, categories: 0, activeVc: 0 };
    }
}

/* ─── Format a stat channel name ─── */
function formatChannelName(statType, value, style = 'default') {
    const type = STAT_TYPES[statType];
    if (!type) return `${statType}: ${value}`;
    const formatted = typeof value === 'number' ? value.toLocaleString() : String(value);
    const s = STAT_STYLES[style] || STAT_STYLES.default;
    return type.template
        .replace('{prefix}', s.prefix)
        .replace('{sep}', s.separator)
        .replace('{value}', formatted);
}

/* ─── Create stat channels for a guild ─── */
async function setupStatsChannels(guild, selectedStats = ['members', 'humans', 'bots', 'channels', 'roles', 'online']) {
    if (!guild || !guild.available) throw new Error('Guild is not available.');
    
    // Verify bot permissions
    const botMember = guild.members.cache.get(guild.client?.user?.id);
    if (botMember && !botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
        throw new Error('Bot is missing **Manage Channels** permission.');
    }

    const stats = await computeStats(guild);
    const channelMap = {};

    // Create category
    let category;
    try {
        category = await guild.channels.create({
            name: '<:Invoice:1521227903956811836> Server Stats',
            type: ChannelType.GuildCategory,
            position: 0,
            permissionOverwrites: [
                {
                    id: guild.id,
                    deny: [PermissionFlagsBits.Connect],
                    allow: [PermissionFlagsBits.ViewChannel]
                }
            ]
        });
    } catch (e) {
        throw new Error('Failed to create stats category: ' + e.message);
    }

    // Create a voice channel for each selected stat
    const style = 'default'; // Style is set after initial setup via dashboard
    for (const statKey of selectedStats) {
        if (!STAT_TYPES[statKey]) continue;
        const value = stats[statKey] ?? 0;
        const channelName = formatChannelName(statKey, value, style);

        try {
            const vc = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildVoice,
                parent: category.id,
                permissionOverwrites: [
                    {
                        id: guild.id,
                        deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
                        allow: [PermissionFlagsBits.ViewChannel]
                    }
                ]
            });
            channelMap[statKey] = vc.id;
        } catch (e) {
            log.error(`ServerStats: Failed to create ${statKey} channel:`, e.message);
        }
    }

    // Save config
    const guildCfg = {
        enabled: true,
        categoryId: category.id,
        stats: selectedStats,
        channelMap,
        lastUpdate: Date.now()
    };

    setGuildConfig(guild.id, guildCfg);
    return { category, channelMap, stats, config: guildCfg };
}

/* ═══════════════════════════════════════════════════════════
   UPDATE ENGINE  —  debounce + cooldown
   
   Discord rate-limits voice channel renames to 2 per 10 min
   per channel. With 6 stat channels that's 12 renames per 10 min.
   We use a 3 min cooldown + 10s debounce to stay well within limits.
   
   Flow for non-forced calls:
   1. Event fires → updateStatsChannels(guild)
   2. If a timer is already pending → cancel it, set a new one
      (ensures the LATEST event is always captured)
   3. Timer fires after either debounce (10s) or cooldown remaining
   4. _doUpdate runs, renames channels as needed
   ═══════════════════════════════════════════════════════════ */
const UPDATE_COOLDOWN = 3 * 60 * 1000;   // 3 min between actual renames
const DEBOUNCE_DELAY  = 10_000;           // 10s debounce for rapid events
const pendingUpdates  = new Map();        // guildId → setTimeout id
const lastUpdates     = new Map();        // guildId → timestamp of last _doUpdate

async function updateStatsChannels(guild, force = false) {
    if (!guild?.id) return;
    
    const config = getGuildConfig(guild.id);
    if (!config?.enabled) return;
    if (!config.channelMap || !config.stats?.length) return;

    // Force mode: execute immediately, no debounce
    if (force) {
        // Clear any pending timer
        if (pendingUpdates.has(guild.id)) {
            clearTimeout(pendingUpdates.get(guild.id));
            pendingUpdates.delete(guild.id);
        }
        try {
            await _doUpdate(guild, getGuildConfig(guild.id) || config);
        } catch (e) {
            log.error(`ServerStats: Forced update failed for ${guild.id}:`, e.message);
        }
        return;
    }

    // Non-force: always cancel existing timer and reschedule
    // This way rapid events don't get lost — the last one always triggers
    if (pendingUpdates.has(guild.id)) {
        clearTimeout(pendingUpdates.get(guild.id));
    }

    const now = Date.now();
    const lastUpdate = lastUpdates.get(guild.id) || 0;
    const elapsed = now - lastUpdate;

    // Calculate delay: at least DEBOUNCE_DELAY, but if within cooldown wait for cooldown end
    let delay;
    if (elapsed >= UPDATE_COOLDOWN) {
        // Outside cooldown — just debounce to batch rapid events
        delay = DEBOUNCE_DELAY;
    } else {
        // Within cooldown — wait until cooldown expires + small buffer
        delay = Math.max(UPDATE_COOLDOWN - elapsed + 1000, DEBOUNCE_DELAY);
    }

    pendingUpdates.set(guild.id, setTimeout(async () => {
        pendingUpdates.delete(guild.id);
        try {
            // Re-read config in case it changed during the wait
            const freshConfig = getGuildConfig(guild.id);
            if (freshConfig?.enabled) {
                await _doUpdate(guild, freshConfig);
            }
        } catch (e) {
            log.error(`ServerStats: Scheduled update failed for ${guild.id}:`, e.message);
        }
    }, delay));
}

async function _doUpdate(guild, config) {
    if (!guild?.available) return;
    
    const stats = await computeStats(guild);
    lastUpdates.set(guild.id, Date.now());

    let configDirty = false;
    let renamedCount = 0;

    for (const statKey of config.stats) {
        const channelId = config.channelMap?.[statKey];
        if (!channelId) continue;

        const channel = guild.channels.cache.get(channelId);
        if (!channel) {
            // Channel was deleted externally — mark it for cleanup
            delete config.channelMap[statKey];
            configDirty = true;
            continue;
        }

        const value = stats[statKey] ?? 0;
        const style = config.style || 'default';
        const newName = formatChannelName(statKey, value, style);

        // Only rename if the name actually changed
        if (channel.name !== newName) {
            try {
                await channel.setName(newName, 'Server stats auto-update');
                renamedCount++;
            } catch (e) {
                if (e.code === 10003 || e.code === 50001 || e.code === 50013) {
                    // Unknown Channel / Missing Access / Missing Permissions
                    delete config.channelMap[statKey];
                    configDirty = true;
                }
                // Rate limit errors (429) are handled by discord.js rest manager
            }
        }
    }

    // If all channels are gone, disable the system
    const remainingChannels = Object.keys(config.channelMap || {}).length;
    if (remainingChannels === 0) {
        config.enabled = false;
    }

    config.lastUpdate = Date.now();
    setGuildConfig(guild.id, config);
}

/* ─── Remove stats system from a guild ─── */
async function removeStatsChannels(guild) {
    if (!guild || !guild.id) return { success: false, error: 'Invalid guild.' };
    
    const config = getGuildConfig(guild.id);
    if (!config) return { success: false, error: 'Server stats not set up.' };

    let deleted = 0;

    // Delete all stat channels
    for (const [, channelId] of Object.entries(config.channelMap || {})) {
        try {
            const ch = guild.channels.cache.get(channelId);
            if (ch) { await ch.delete('Server stats removed'); deleted++; }
        } catch {}
    }

    // Delete category
    try {
        const cat = guild.channels.cache.get(config.categoryId);
        if (cat) { await cat.delete('Server stats removed'); deleted++; }
    } catch {}

    // Clear pending timers
    if (pendingUpdates.has(guild.id)) {
        clearTimeout(pendingUpdates.get(guild.id));
        pendingUpdates.delete(guild.id);
    }
    lastUpdates.delete(guild.id);

    removeGuildConfig(guild.id);
    return { success: true, deleted };
}

module.exports = {
    STAT_TYPES,
    STAT_STYLES,
    getGuildConfig,
    setGuildConfig,
    setupStatsChannels,
    updateStatsChannels,
    removeStatsChannels,
    computeStats,
    formatChannelName,
    loadConfig,
    invalidateCache
};
