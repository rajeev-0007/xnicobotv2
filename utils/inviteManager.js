
const jsonStore = require('./jsonStore');
const log = require('./logger-styled');
const { renderMessage, getDefaultMessages } = require('./inviteMessageBuilder');
const inviteCache = new Map();

function loadConfig() {
    if (!jsonStore.has('invites')) {
        jsonStore.write('invites', {});
        return {};
    }
    return jsonStore.read('invites');
}

function saveConfig(config) {
    jsonStore.write('invites', config);
}

function ensureGuildConfig(config, guildId) {
    if (!config[guildId]) {
        config[guildId] = {
            invites: {},
            members: {},
            rewards: [],
            totals: {},
            enabled: true,  // enabled by default
            messages: getDefaultMessages()
        };
    }
    // Backfill messages for guilds created before this feature shipped.
    if (!config[guildId].messages) {
        config[guildId].messages = getDefaultMessages();
    }
    return config[guildId];
}

async function preloadGuildInvites(guild) {
    try {
        const invites = await guild.invites.fetch();
        const inviteMap = new Map();
        
        invites.forEach(invite => {
            inviteMap.set(invite.code, {
                uses: invite.uses,
                inviterId: invite.inviter?.id,
                code: invite.code
            });
        });
        
        inviteCache.set(guild.id, inviteMap);
    } catch (error) {
        log.error(`<:Cancel:1521227723916181644> Failed to load invites for ${guild.name}:`, error.message);
        inviteCache.set(guild.id, new Map());
    }
}

async function refreshGuildInvite(guild) {
    try {
        const invites = await guild.invites.fetch();
        const inviteMap = new Map();
        
        invites.forEach(invite => {
            inviteMap.set(invite.code, {
                uses: invite.uses,
                inviterId: invite.inviter?.id,
                code: invite.code
            });
        });
        
        inviteCache.set(guild.id, inviteMap);
    } catch (error) {
        log.error(`Failed to refresh invites for  ${guild.name}:`, error.message);
    }
}

/**
 * Analyze a member for suspicious/alt account indicators
 * Returns { isSuspicious, flags[], riskScore }
 */
function analyzeAccount(member) {
    const flags = [];
    let riskScore = 0;
    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    const accountAgeDays = Math.floor(accountAgeMs / (24 * 60 * 60 * 1000));

    // Account age checks
    if (accountAgeDays < 1) {
        flags.push('Account created less than 1 day ago');
        riskScore += 40;
    } else if (accountAgeDays < 3) {
        flags.push('Account created less than 3 days ago');
        riskScore += 30;
    } else if (accountAgeDays < 7) {
        flags.push('Account created less than 7 days ago');
        riskScore += 15;
    }

    // No avatar
    if (!member.user.avatar) {
        flags.push('No profile picture set');
        riskScore += 15;
    }

    // Default/generic username patterns
    const username = member.user.username.toLowerCase();
    if (/^(user|discord|test|alt|fake|bot|spam|temp)\d{0,10}$/i.test(username)) {
        flags.push('Suspicious username pattern');
        riskScore += 20;
    }

    // Username is mostly numbers
    const numberRatio = (username.replace(/[^0-9]/g, '').length) / username.length;
    if (numberRatio > 0.6 && username.length > 3) {
        flags.push('Username is mostly numbers');
        riskScore += 10;
    }

    // No banner (minor indicator)
    if (!member.user.banner) {
        riskScore += 5;
    }

    return {
        isSuspicious: riskScore >= 30,
        flags,
        riskScore: Math.min(riskScore, 100),
        accountAgeDays
    };
}

/**
 * Resolve the configured invite-log channel for a guild.
 * Returns null if no channel configured or it isn't sendable.
 */
function getInviteLogChannel(guild) {
    const config = loadConfig();
    const guildConfig = config[guild.id];
    const channelId = guildConfig?.channel;
    if (!channelId) return null;
    const channel = guild.channels.cache.get(channelId);
    if (!channel || typeof channel.send !== 'function') return null;
    return channel;
}

/**
 * Send a custom invite event message (join / leave / vanity / fake).
 * Reads the guild's `messages.<type>` template, resolves variables,
 * and ships a Components V2 container to the configured log channel.
 *
 * Failures are swallowed — invite logging must never break member
 * join/leave handling.
 */
async function sendInviteMessage(type, member, guild, ctxExtras = {}) {
    try {
        const config = loadConfig();
        const guildConfig = config[guild.id];
        if (!guildConfig) return;

        const messages = guildConfig.messages || getDefaultMessages();
        const messageConfig = messages[type];
        if (!messageConfig || messageConfig.enabled === false) return;

        const channel = getInviteLogChannel(guild);
        if (!channel) return;

        const ctx = { member, guild, ...ctxExtras };
        const container = renderMessage(messageConfig, ctx);
        if (!container) return;

        const { MessageFlags } = require('discord.js');
        await channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => {});
    } catch (err) {
        log.error(`[InviteManager] Failed to send ${type} message:`, err.message);
    }
}

/**
 * Send alt detection alert to the configured invite log channel.
 * Uses the user-configured `fake` template when available.
 */
async function sendAltAlert(member, analysis, inviterData) {
    try {
        const config = loadConfig();
        const guildConfig = config[member.guild.id];
        if (!guildConfig) return;

        // Resolve inviter user object if we know who it was
        let inviterUser = null;
        let totalForInviter = 0;
        let inviterCodeCount = 0;
        if (inviterData?.inviterId) {
            inviterUser = await member.guild.client.users.fetch(inviterData.inviterId).catch(() => null);
            const totals = guildConfig.totals?.[inviterData.inviterId];
            if (totals) totalForInviter = (totals.regular || 0) + (totals.bonus || 0);
            try {
                const allInvites = await member.guild.invites.fetch();
                inviterCodeCount = allInvites.filter(inv => inv.inviter?.id === inviterData.inviterId).size;
            } catch { /* ignore */ }
        }

        await sendInviteMessage('fake', member, member.guild, {
            inviter: inviterUser,
            invite: inviterData ? {
                code: inviterData.inviteCode,
                url: inviterData.inviteCode ? `https://discord.gg/${inviterData.inviteCode}` : null,
                totalForInviter,
                inviterCodeCount,
            } : null,
            alt: analysis,
        });
    } catch (err) {
        log.error('Error sending alt alert:', err.message);
    }
}

async function handleMemberJoin(member) {
    if (member.user.bot) return;
    
    const config = loadConfig();
    const guildConfig = ensureGuildConfig(config, member.guild.id);
    
    if (!guildConfig.enabled) return;
    
    try {
        const newInvites = await member.guild.invites.fetch();
        const oldInvites = inviteCache.get(member.guild.id) || new Map();
        
        let usedInvite = null;
        let inviterData = null;
        
        newInvites.forEach(invite => {
            const oldInvite = oldInvites.get(invite.code);
            if (oldInvite && invite.uses > oldInvite.uses) {
                usedInvite = invite;
            }
        });
        
        if (usedInvite && usedInvite.inviter) {
            const inviterId = usedInvite.inviter.id;
            
            if (!guildConfig.totals[inviterId]) {
                guildConfig.totals[inviterId] = {
                    regular: 0,
                    fake: 0,
                    left: 0,
                    bonus: 0
                };
            }
            
            guildConfig.totals[inviterId].regular++;
            
            guildConfig.members[member.id] = {
                inviterId: inviterId,
                inviteCode: usedInvite.code,
                joinedAt: Date.now(),
                left: false
            };
            
            inviterData = {
                inviterId: inviterId,
                inviteCode: usedInvite.code
            };
            
            saveConfig(config);
            const totalInvites = guildConfig.totals[inviterId].regular + guildConfig.totals[inviterId].bonus;
            await checkRewards(member.guild, inviterId, totalInvites, guildConfig.rewards);

            // Send custom join message
            const inviterCodeCount = newInvites.filter(inv => inv.inviter?.id === inviterId).size;
            await sendInviteMessage('join', member, member.guild, {
                inviter: usedInvite.inviter,
                invite: {
                    code: usedInvite.code,
                    url: `https://discord.gg/${usedInvite.code}`,
                    uses: usedInvite.uses,
                    totalForInviter: totalInvites,
                    inviterCodeCount,
                },
            });
        } else {
            guildConfig.members[member.id] = {
                inviterId: 'unknown',
                inviteCode: 'unknown',
                joinedAt: Date.now(),
                left: false
            };
            saveConfig(config);

            // Send vanity / unknown source message
            await sendInviteMessage('vanity', member, member.guild, {
                inviter: null,
                invite: { code: 'Unknown', url: null, totalForInviter: 0, inviterCodeCount: 0 },
            });
        }

        // Alt/fake account detection
        const analysis = analyzeAccount(member);
        if (analysis.isSuspicious) {
            // Increment fake counter for inviter
            if (inviterData && guildConfig.totals[inviterData.inviterId]) {
                guildConfig.totals[inviterData.inviterId].fake++;
                saveConfig(config);
            }
            // Send alert to log channel
            await sendAltAlert(member, analysis, inviterData);
        }

        await refreshGuildInvite(member.guild);
        
        return inviterData;
    } catch (error) {
        log.error('Error handling member join:', error);
        await refreshGuildInvite(member.guild);
        return null;
    }
}

async function handleMemberLeave(member) {
    if (member.user.bot) return;
    
    const config = loadConfig();
    const guildConfig = ensureGuildConfig(config, member.guild.id);
    
    if (!guildConfig.enabled) return;
    
    const memberData = guildConfig.members[member.id];
    
    if (memberData && memberData.inviterId !== 'unknown' && !memberData.left) {
        const inviterId = memberData.inviterId;
        
        if (guildConfig.totals[inviterId]) {
            guildConfig.totals[inviterId].regular--;
            guildConfig.totals[inviterId].left++;
            
            if (guildConfig.totals[inviterId].regular < 0) {
                guildConfig.totals[inviterId].regular = 0;
            }
            
            guildConfig.members[member.id].left = true;
            saveConfig(config);
            const totalInvites = guildConfig.totals[inviterId].regular + guildConfig.totals[inviterId].bonus;
            await checkRewards(member.guild, inviterId, totalInvites, guildConfig.rewards);

            // Send custom leave message
            const inviterUser = await member.guild.client.users.fetch(inviterId).catch(() => null);
            let inviterCodeCount = 0;
            try {
                const allInvites = await member.guild.invites.fetch();
                inviterCodeCount = allInvites.filter(inv => inv.inviter?.id === inviterId).size;
            } catch { /* ignore */ }

            await sendInviteMessage('leave', member, member.guild, {
                inviter: inviterUser,
                invite: {
                    code: memberData.inviteCode,
                    url: memberData.inviteCode && memberData.inviteCode !== 'unknown'
                        ? `https://discord.gg/${memberData.inviteCode}` : null,
                    totalForInviter: totalInvites,
                    inviterCodeCount,
                },
            });
        }
    } else {
        // Unknown-source leave — still post a leave message if the template is enabled
        await sendInviteMessage('leave', member, member.guild, {
            inviter: null,
            invite: { code: 'Unknown', url: null, totalForInviter: 0, inviterCodeCount: 0 },
        });
    }

    // Refresh invite cache after leave
    await refreshGuildInvite(member.guild).catch(() => {});
}

async function addBonusInvites(guildId, userId, amount, guild = null) {
    const config = loadConfig();
    const guildConfig = ensureGuildConfig(config, guildId);
    
    if (!guildConfig.totals[userId]) {
        guildConfig.totals[userId] = {
            regular: 0,
            fake: 0,
            left: 0,
            bonus: 0
        };
    }
    
    guildConfig.totals[userId].bonus += amount;
    saveConfig(config);
    
    if (guild) {
        const totalInvites = guildConfig.totals[userId].regular + guildConfig.totals[userId].bonus;
        await checkRewards(guild, userId, totalInvites, guildConfig.rewards);
    }
    
    return guildConfig.totals[userId];
}

function resetUserInvites(guildId, userId) {
    const config = loadConfig();
    const guildConfig = ensureGuildConfig(config, guildId);
    
    if (guildConfig.totals[userId]) {
        guildConfig.totals[userId] = {
            regular: 0,
            fake: 0,
            left: 0,
            bonus: 0
        };
    }
    
    saveConfig(config);
}

function resetGuildInvites(guildId) {
    const config = loadConfig();
    const existing = config[guildId] || {};
    config[guildId] = {
        invites: {},
        members: {},
        rewards: existing.rewards || [],
        totals: {},
        enabled: existing.enabled || false,
        channel: existing.channel || null
    };
    saveConfig(config);
}

function getUserStats(guildId, userId) {
    const config = loadConfig();
    const guildConfig = ensureGuildConfig(config, guildId);
    
    const stats = guildConfig.totals[userId] || {
        regular: 0,
        fake: 0,
        left: 0,
        bonus: 0
    };
    
    const total = stats.regular + stats.bonus;
    
    return {
        ...stats,
        total: total
    };
}

/**
 * Fetch real invite stats from Discord API for a user in a guild.
 * This counts ALL invite uses across all invite codes created by the user,
 * not just those tracked since the bot joined.
 * @param {Guild} guild - Discord guild object
 * @param {string} userId - User ID to check
 * @returns {Promise<{ total: number, codes: Array, tracked: object }>}
 */
async function fetchRealInviteStats(guild, userId) {
    const config = loadConfig();
    const guildConfig = ensureGuildConfig(config, guild.id);
    const tracked = guildConfig.totals[userId] || { regular: 0, fake: 0, left: 0, bonus: 0 };

    try {
        const invites = await guild.invites.fetch();
        const userInvites = invites.filter(inv => inv.inviter?.id === userId);
        
        let totalUses = 0;
        const codes = [];
        
        userInvites.forEach(inv => {
            totalUses += inv.uses || 0;
            codes.push({
                code: inv.code,
                uses: inv.uses || 0,
                maxUses: inv.maxUses || 0,
                temporary: inv.temporary,
                createdAt: inv.createdTimestamp,
                expiresAt: inv.expiresTimestamp
            });
        });

        // Sort by most uses
        codes.sort((a, b) => b.uses - a.uses);

        return {
            total: totalUses + tracked.bonus,
            realUses: totalUses,
            bonus: tracked.bonus,
            left: tracked.left,
            fake: tracked.fake,
            trackedRegular: tracked.regular,
            codes,
            codeCount: codes.length
        };
    } catch (error) {
        log.error(`Failed to fetch real invite stats for ${userId} in ${guild.name}:`, error.message);
        // Fallback to tracked data
        return {
            total: tracked.regular + tracked.bonus,
            realUses: tracked.regular,
            bonus: tracked.bonus,
            left: tracked.left,
            fake: tracked.fake,
            trackedRegular: tracked.regular,
            codes: [],
            codeCount: 0,
            error: true
        };
    }
}

function getLeaderboard(guildId, limit = 10) {
    const config = loadConfig();
    const guildConfig = ensureGuildConfig(config, guildId);
    
    const leaderboard = Object.entries(guildConfig.totals)
        .map(([userId, stats]) => ({
            userId: userId,
            total: stats.regular + stats.bonus,
            regular: stats.regular,
            bonus: stats.bonus,
            left: stats.left
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, limit);
    
    return leaderboard;
}

function setReward(guildId, inviteCount, roleId) {
    const config = loadConfig();
    const guildConfig = ensureGuildConfig(config, guildId);
    
    guildConfig.rewards = guildConfig.rewards.filter(r => r.invites !== inviteCount);
    guildConfig.rewards.push({ invites: inviteCount, roleId: roleId });
    guildConfig.rewards.sort((a, b) => a.invites - b.invites);
    
    saveConfig(config);
}

function removeReward(guildId, inviteCount) {
    const config = loadConfig();
    const guildConfig = ensureGuildConfig(config, guildId);
    
    guildConfig.rewards = guildConfig.rewards.filter(r => r.invites !== inviteCount);
    saveConfig(config);
}

function getRewards(guildId) {
    const config = loadConfig();
    const guildConfig = ensureGuildConfig(config, guildId);
    return guildConfig.rewards;
}

async function checkRewards(guild, inviterId, totalInvites, rewards) {
    if (!rewards || !rewards.length) return;
    
    try {
        const inviterMember = await guild.members.fetch(inviterId).catch(() => null);
        if (!inviterMember) return;
        
        for (const reward of rewards) {
            const hasRole = inviterMember.roles.cache.has(reward.roleId);
            
            if (totalInvites >= reward.invites && !hasRole) {
                try {
                    await inviterMember.roles.add(reward.roleId);
                    log.info(`<:Checkedbox:1521227734943269077> Added reward role to ${inviterMember.user.username} for ${reward.invites} invites (current: ${totalInvites})`);
                } catch (error) {
                    log.error(`<:Cancel:1521227723916181644> Failed to add reward role:`, error.message);
                }
            } else if (totalInvites < reward.invites && hasRole) {
                try {
                    await inviterMember.roles.remove(reward.roleId);
                    log.info(`<:Checkedbox:1521227734943269077> Removed reward role from ${inviterMember.user.username} (below ${reward.invites} invites, current: ${totalInvites})`);
                } catch (error) {
                    log.error(`<:Cancel:1521227723916181644> Failed to remove reward role:`, error.message);
                }
            }
        }
    } catch (error) {
        log.error('Error checking rewards:', error);
    }
}

function toggleInviteTracking(guildId, enabled) {
    const config = loadConfig();
    const guildConfig = ensureGuildConfig(config, guildId);
    guildConfig.enabled = enabled;
    saveConfig(config);
}

function isTrackingEnabled(guildId) {
    const config = loadConfig();
    const guildConfig = config[guildId];
    // Default to true — invite checking is enabled by default
    if (!guildConfig) return true;
    return guildConfig.enabled !== false;
}

function getInviteAnalytics(guildId) {
    const config = loadConfig();
    const guildConfig = ensureGuildConfig(config, guildId);
    
    const totalInvites = Object.values(guildConfig.totals).reduce((sum, stats) => sum + stats.regular + stats.bonus, 0);
    const totalLeft = Object.values(guildConfig.totals).reduce((sum, stats) => sum + stats.left, 0);
    const totalMembers = Object.keys(guildConfig.members).filter(id => !guildConfig.members[id].left).length;
    const topInviters = getLeaderboard(guildId, 5);
    
    const inviterCodes = {};
    Object.values(guildConfig.members).forEach(member => {
        if (!member.left && member.inviteCode !== 'unknown') {
            inviterCodes[member.inviteCode] = (inviterCodes[member.inviteCode] || 0) + 1;
        }
    });
    
    const topCodes = Object.entries(inviterCodes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
    
    return {
        totalInvites,
        totalLeft,
        totalMembers,
        topInviters,
        topCodes
    };
}

module.exports = {
    preloadGuildInvites,
    refreshGuildInvite,
    handleMemberJoin,
    handleMemberLeave,
    addBonusInvites,
    resetUserInvites,
    resetGuildInvites,
    getUserStats,
    fetchRealInviteStats,
    getLeaderboard,
    setReward,
    removeReward,
    getRewards,
    checkRewards,
    toggleInviteTracking,
    isTrackingEnabled,
    getInviteAnalytics,
    analyzeAccount,
    sendInviteMessage,
    inviteCache
};
