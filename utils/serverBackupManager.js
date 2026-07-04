const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { models } = require('./database');
const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

const DATA_DIR = path.join(__dirname, '..', 'datas');

/* ─── Safely extract permission overwrites from a channel/category ─── */
function safeGetPermOverwrites(channelOrCategory) {
    try {
        if (!channelOrCategory.permissionOverwrites || !channelOrCategory.permissionOverwrites.cache) {
            return [];
        }
        const guild = channelOrCategory.guild;
        return channelOrCategory.permissionOverwrites.cache.map(ow => {
            const entry = {
                id: ow.id,
                type: ow.type,
                allow: ow.allow.bitfield.toString(),
                deny: ow.deny.bitfield.toString()
            };
            // Store role name for remapping during cross-server restore
            if (ow.type === 0 && guild) {
                const role = guild.roles.cache.get(ow.id);
                if (role) entry.roleName = role.name;
            }
            return entry;
        });
    } catch {
        return [];
    }
}

/* ─── Apply permission overwrites to a channel/category during restore ─── */
async function applyPermissionOverwrites(channel, overwrites, roleMap, guild) {
    if (!overwrites || !Array.isArray(overwrites) || overwrites.length === 0) return;
    
    const permEntries = [];
    for (const ow of overwrites) {
        try {
            let targetId = null;
            
            if (ow.type === 0) {
                // Role overwrite — try to remap to newId via roleName
                if (ow.roleName && ow.roleName === '@everyone') {
                    targetId = guild.id;
                } else if (ow.roleName && roleMap.has(ow.roleName)) {
                    targetId = roleMap.get(ow.roleName);
                } else if (guild.roles.cache.has(ow.id)) {
                    // Role still exists with same ID (same-server restore)
                    targetId = ow.id;
                } else {
                    // Unknown role — skip
                    continue;
                }
            } else if (ow.type === 1) {
                // Member overwrite — use original member ID directly
                targetId = ow.id;
            }
            
            if (!targetId) continue;
            
            permEntries.push({
                id: targetId,
                type: ow.type,
                allow: BigInt(ow.allow || '0'),
                deny: BigInt(ow.deny || '0')
            });
        } catch {
            // Skip individual overwrites that fail
        }
    }
    
    if (permEntries.length > 0) {
        try {
            await channel.permissionOverwrites.set(permEntries, 'Server backup restore');
        } catch (e) {
            log.error(`Failed to set permission overwrites for ${channel.name}:`, e.message);
        }
    }
}

/* ─── Guild-keyed config files (OBJ where key = guildId) ─── */
const BOT_CONFIG_FILES = {
    // Moderation / Security
    automod:          'automod.json',
    antinuke:         'antinuke.json',
    antialt:          'antialt.json',
    antiraid:         'antiraid.json',
    trust:            'trust.json',
    warnings:         'warnings.json',
    modlogs:          'modlogs.json',
    ignoredChannels:  'ignored-channels.json',
    verification:     'verification.json',
    // Welcome / Greet
    welcomer:         'welcomer.json',
    joinGreet:        'join-greet.json',
    // Automation
    autoresponder:    'autoresponder.json',
    autoreact:        'autoreact.json',
    autorole:         'autorole.json',
    autonick:         'autonick.json',
    voiceautorole:    'voiceautorole.json',
    buttonCommands:   'button-commands.json',
    selectMenus:      'select-menus.json',
    customcmds:       'customcmds.json',
    // Tickets
    tickets:          'tickets.json',
    // Leveling
    leveling:         'leveling.json',
    levelchannel:     'levelchannel.json',
    levelingtoggle:   'levelingtoggle.json',
    levelmultiplier:  'levelmultiplier.json',
    levelroles:       'levelroles.json',
    // Music
    musicpanel:       'musicpanel.json',
    musicpanel247:    'musicpanel-247.json',
    // Logging
    logs:             'logs.json',
    // Social
    socialNotify:     'social-notify.json',
    boosterNotify:    'booster-notify.json',
    // Misc Config
    prefixes:         'prefixes.json',
    panelRegistry:    'panel-registry.json',
    botCustomize:     'bot-customize.json',
    noprefix:         'noprefix.json',
    mediaOnly:        'media-only.json',
    simpleSticky:     'simple-sticky.json',
    sticky:           'sticky.json',
    join2create:      'join2create.json',
    starboard:        'starboard.json',
    giveaways:        'giveaways.json',
    giveawaySettings: 'giveaway-settings.json',
    voteConfig:       'vote-config.json',
    invites:          'invites.json',
    reactionroles:    'reactionroles.json',
};

function loadGuildConfigs(guildId) {
    const configs = {};
    for (const [key, file] of Object.entries(BOT_CONFIG_FILES)) {
        try {
            const storeName = file.replace('.json', '');
            const raw = jsonStore.read(storeName);
            if (raw && typeof raw === 'object' && !Array.isArray(raw) && raw[guildId] !== undefined) {
                configs[key] = raw[guildId];
            }
        } catch { /* skip corrupt */ }
    }
    return configs;
}

function restoreGuildConfigs(guildId, configs) {
    let restored = 0;
    for (const [key, value] of Object.entries(configs)) {
        const file = BOT_CONFIG_FILES[key];
        if (!file) continue;
        try {
            const storeName = file.replace('.json', '');
            let current = jsonStore.read(storeName);
            current[guildId] = value;
            jsonStore.write(storeName, current);
            restored++;
        } catch (err) {
            log.error(`Error restoring config ${key}:`, err.message);
        }
    }
    return restored;
}

function generateShortId(length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function generateSecureToken(length = 16) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

async function generateUniqueBackupId() {
    let backupId;
    let attempts = 0;
    let exists = true;
    
    while (exists && attempts < 100) {
        backupId = generateShortId(8);
        exists = await models.ServerBackup.exists({ backupId });
        attempts++;
    }
    
    if (attempts >= 100) {
        backupId = generateShortId(12);
    }
    
    return backupId;
}

/* ─── Fetch all messages from a channel with pagination ─── */
async function fetchChannelMessages(channel, limit = 0) {
    const allMessages = [];
    let lastId = null;
    const batchSize = 100;
    const cap = limit > 0 ? limit : 10000; // safety cap

    while (allMessages.length < cap) {
        const opts = { limit: Math.min(batchSize, cap - allMessages.length) };
        if (lastId) opts.before = lastId;

        try {
            const batch = await channel.messages.fetch(opts);
            if (batch.size === 0) break;

            for (const [, msg] of batch) {
                allMessages.push({
                    author: {
                        id: msg.author.id,
                        username: msg.author.username,
                        discriminator: msg.author.discriminator,
                        avatar: msg.author.avatar,
                        bot: msg.author.bot,
                        displayAvatarURL: msg.author.displayAvatarURL({ size: 128, extension: 'png' })
                    },
                    content: msg.content || '',
                    embeds: msg.embeds.map(e => e.toJSON()),
                    attachments: msg.attachments.map(a => ({
                        name: a.name,
                        url: a.url,
                        proxyURL: a.proxyURL,
                        contentType: a.contentType,
                        size: a.size
                    })),
                    createdTimestamp: msg.createdTimestamp,
                    timestamp: msg.createdAt.toISOString()
                });
            }

            lastId = batch.last().id;
            if (batch.size < batchSize) break;
        } catch (err) {
            log.error(`Error fetching messages from ${channel.name}:`, err.message);
            break;
        }
    }

    return allMessages.reverse(); // chronological order
}

/* ─── Create a full or partial server backup ─── */
async function createServerBackup(guild, userId, options = {}) {
    const {
        includeRoles = true,
        includeChannels = true,
        includeEmojis = true,
        includeStickers = true,
        includeMessages = false,
        messageLimit = 0,       // 0 = all (up to 10 000/ch)
        includeBans = false,
        includeSettings = true,
        includeBotConfig = true
    } = options;

    const backupId = await generateUniqueBackupId();
    const secureToken = generateSecureToken(16);
    const msgCap = includeMessages ? (messageLimit > 0 ? messageLimit : 10000) : 0;

    const backupData = {
        backupId,
        secureToken,
        originalGuildId: guild.id,
        createdBy: userId,
        includesMessages: includeMessages,
        options: {
            roles: includeRoles,
            channels: includeChannels,
            emojis: includeEmojis,
            stickers: includeStickers,
            messages: includeMessages,
            messageLimit: msgCap,
            bans: includeBans,
            settings: includeSettings,
            botConfig: includeBotConfig
        },
        server: {},
        roles: [],
        categories: [],
        channels: [],
        emojis: [],
        stickers: [],
        bans: [],
        botConfig: {}
    };

    /* ── Server settings ── */
    if (includeSettings) {
        backupData.server = {
            name: guild.name,
            description: guild.description,
            icon: guild.iconURL({ size: 1024 }),
            banner: guild.bannerURL({ size: 1024 }),
            splash: guild.splashURL({ size: 1024 }),
            verificationLevel: guild.verificationLevel,
            defaultMessageNotifications: guild.defaultMessageNotifications,
            explicitContentFilter: guild.explicitContentFilter,
            afkChannelId: guild.afkChannelId,
            afkTimeout: guild.afkTimeout,
            systemChannelId: guild.systemChannelId,
            systemChannelFlags: guild.systemChannelFlags
        };
    } else {
        backupData.server = { name: guild.name };
    }

    /* ── Roles ── */
    if (includeRoles) {
        await guild.roles.fetch();
        guild.roles.cache
            .filter(role => role.name !== '@everyone')
            .sort((a, b) => b.position - a.position)
            .forEach(role => {
                backupData.roles.push({
                    name: role.name,
                    color: role.color,
                    hoist: role.hoist,
                    permissions: role.permissions.bitfield.toString(),
                    mentionable: role.mentionable,
                    position: role.position
                });
            });
    }

    /* ── Channels & Categories ── */
    if (includeChannels) {
        await guild.channels.fetch();
        const categories = guild.channels.cache.filter(c => c.type === 4);
        const chans = guild.channels.cache.filter(c => c.type !== 4);

        categories.sort((a, b) => a.position - b.position).forEach(category => {
            backupData.categories.push({
                name: category.name,
                position: category.position,
                permissionOverwrites: safeGetPermOverwrites(category)
            });
        });

        // Filter to only back up channel types we can restore (text, voice, announcement, stage, forum)
        const supportedTypes = new Set([0, 2, 5, 13, 15]);
        const backupChans = chans.filter(c => supportedTypes.has(c.type));

        for (const [, channel] of backupChans) {
            const chData = {
                name: channel.name,
                type: channel.type,
                position: channel.position,
                parentName: channel.parent ? channel.parent.name : null,
                permissionOverwrites: safeGetPermOverwrites(channel)
            };

            // Text-like channels (text, announcement, forum)
            if ([0, 5, 15].includes(channel.type)) {
                chData.nsfw = channel.nsfw || false;
                chData.topic = channel.topic || null;
                chData.rateLimitPerUser = channel.rateLimitPerUser || 0;

                if (includeMessages && [0, 5].includes(channel.type)) {
                    try {
                        chData.messages = await fetchChannelMessages(channel, msgCap);
                    } catch (error) {
                        log.error(`Error fetching messages from ${channel.name}:`, error);
                        chData.messages = [];
                    }
                }
            } else if ([2, 13].includes(channel.type)) {
                // Voice and Stage channels
                chData.bitrate = channel.bitrate || 64000;
                chData.userLimit = channel.userLimit || 0;
            }

            backupData.channels.push(chData);
        }
    }

    /* ── Emojis ── */
    if (includeEmojis) {
        await guild.emojis.fetch();
        guild.emojis.cache.forEach(emoji => {
            backupData.emojis.push({
                name: emoji.name,
                url: emoji.url,
                animated: emoji.animated
            });
        });
    }

    /* ── Stickers ── */
    if (includeStickers) {
        await guild.stickers.fetch();
        guild.stickers.cache.forEach(sticker => {
            backupData.stickers.push({
                name: sticker.name,
                description: sticker.description,
                tags: sticker.tags,
                url: sticker.url
            });
        });
    }

    /* ── Bans ── */
    if (includeBans) {
        try {
            const bans = await guild.bans.fetch();
            bans.forEach(ban => {
                backupData.bans.push({
                    userId: ban.user.id,
                    username: ban.user.username,
                    reason: ban.reason || null
                });
            });
        } catch (error) {
            log.error('Error fetching bans:', error.message);
        }
    }

    /* ── Bot Configuration (all guild-keyed JSON configs) ── */
    if (includeBotConfig) {
        backupData.botConfig = loadGuildConfigs(guild.id);
    }

    /* ── Save ── */
    await models.ServerBackup.create(backupData);

    let totalMessages = 0;
    if (includeMessages) {
        for (const ch of backupData.channels) {
            if (ch.messages) totalMessages += ch.messages.length;
        }
    }

    return {
        success: true,
        backupId,
        secureToken,
        backupName: backupId,
        serverName: guild.name,
        stats: {
            roles: backupData.roles.length,
            categories: backupData.categories.length,
            channels: backupData.channels.length,
            emojis: backupData.emojis.length,
            stickers: backupData.stickers.length,
            bans: backupData.bans.length,
            messages: totalMessages,
            botConfigs: Object.keys(backupData.botConfig).length,
            includesMessages: includeMessages
        },
        options: backupData.options
    };
}

async function listServerBackups(userId = null) {
    try {
        const query = userId ? { createdBy: userId } : {};
        const chainable = models.ServerBackup.find(query);
        const backups = chainable.sort({ createdAt: -1 }).select('');
        
        return backups.map(backup => {
            let totalMessages = 0;
            if (backup.channels) {
                for (const ch of backup.channels) {
                    if (ch.messages) totalMessages += ch.messages.length;
                }
            }
            return {
                id: backup.backupId,
                name: backup.backupId,
                createdAt: typeof backup.createdAt === 'string' ? new Date(backup.createdAt).getTime() : (backup.createdAt || Date.now()),
                createdBy: backup.createdBy,
                originalGuildId: backup.originalGuildId,
                serverName: backup.server?.name || 'Unknown Server',
                includesMessages: backup.includesMessages || false,
                options: backup.options || null,
                stats: {
                    roles: backup.roles?.length || 0,
                    channels: backup.channels?.length || 0,
                    categories: backup.categories?.length || 0,
                    emojis: backup.emojis?.length || 0,
                    stickers: backup.stickers?.length || 0,
                    bans: backup.bans?.length || 0,
                    messages: totalMessages,
                    botConfigs: Object.keys(backup.botConfig || {}).length
                }
            };
        });
    } catch (error) {
        log.error('Error listing backups:', error);
        return [];
    }
}

async function listAllServerBackups() {
    return await listServerBackups(null);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadServerBackup(guild, backupId, secureToken, userId = null, runtimeOptions = {}) {
    try {
        const {
            onProgress = null,
            isPaused = () => false,
            isStopped = () => false,
            excludeChannelIds = []
        } = runtimeOptions || {};

        let progressDone = 0;
        let progressTotal = 0;

        const emitProgress = (stage, details = '') => {
            if (!onProgress) return;
            const safeTotal = Math.max(progressTotal, 1);
            const percent = Math.max(0, Math.min(100, Math.round((progressDone / safeTotal) * 100)));
            try {
                onProgress({
                    stage,
                    details,
                    current: progressDone,
                    total: safeTotal,
                    percent
                });
            } catch {
                // ignore progress callback errors
            }
        };

        const checkControl = async () => {
            if (isStopped()) return false;
            while (isPaused()) {
                if (isStopped()) return false;
                emitProgress('Paused', 'Restore is paused by user');
                await sleep(500);
            }
            return !isStopped();
        };

        emitProgress('Preparing', 'Validating backup access');

        const backup = await models.ServerBackup.findOne({ backupId: String(backupId) });
        
        if (!backup) {
            return { success: false, error: 'Backup not found. Double-check the backup ID.' };
        }
        
        const backupData = backup.toObject();
        
        // Access control: same server, backup creator, or valid secure token
        const isSameServer = String(backupData.originalGuildId) === String(guild.id);
        const isCreator = userId && String(backupData.createdBy) === String(userId);
        const hasValidToken = secureToken && secureToken.length > 0 && backupData.secureToken === secureToken;
        
        if (!isSameServer && !isCreator && !hasValidToken) {
            return { success: false, error: 'Access denied. You need the secure token to load backups from other servers, or be the backup creator.' };
        }
        
        const stats = {
            rolesDeleted: 0,
            categoriesDeleted: 0,
            channelsDeleted: 0,
            rolesCreated: 0,
            categoriesCreated: 0,
            channelsCreated: 0,
            messagesRestored: 0,
            configsRestored: 0
        };
        
        await guild.roles.fetch();
        const rolesToDelete = guild.roles.cache.filter(role => 
            !role.managed && 
            role.name !== '@everyone' && 
            guild.members.me.roles.highest.comparePositionTo(role) > 0
        );

        await guild.channels.fetch();
        const excludeSet = new Set(excludeChannelIds);
        const channelsToDelete = guild.channels.cache.filter(channel => 
            channel.deletable && !excludeSet.has(channel.id)
        );

        const totalMessagesToRestore = (backupData.channels || []).reduce((sum, ch) => {
            if (ch && Array.isArray(ch.messages)) return sum + ch.messages.length;
            return sum;
        }, 0);

        progressTotal =
            rolesToDelete.size +
            channelsToDelete.size +
            (backupData.roles?.length || 0) +
            (backupData.categories?.length || 0) +
            (backupData.channels?.length || 0) +
            totalMessagesToRestore +
            1;

        emitProgress('Deleting Roles', `0/${rolesToDelete.size}`);
        
        for (const [, role] of rolesToDelete) {
            if (!(await checkControl())) {
                return { success: false, stopped: true, error: 'Restore stopped by user.', stats };
            }
            try {
                await role.delete('Server backup restore');
                stats.rolesDeleted++;
            } catch (error) {
                log.error(`Error deleting role ${role.name}:`, error);
            }
            progressDone++;
            emitProgress('Deleting Roles', `${stats.rolesDeleted}/${rolesToDelete.size}`);
        }

        emitProgress('Deleting Channels', `0/${channelsToDelete.size}`);
        
        for (const [, channel] of channelsToDelete) {
            if (!(await checkControl())) {
                return { success: false, stopped: true, error: 'Restore stopped by user.', stats };
            }
            try {
                await channel.delete('Server backup restore');
                if (channel.type === 4) {
                    stats.categoriesDeleted++;
                } else {
                    stats.channelsDeleted++;
                }
            } catch (error) {
                log.error(`Error deleting channel ${channel.name}:`, error);
            }
            progressDone++;
            emitProgress('Deleting Channels', `${stats.channelsDeleted + stats.categoriesDeleted}/${channelsToDelete.size}`);
        }
        
        const roleMap = new Map();
        emitProgress('Creating Roles', `0/${backupData.roles?.length || 0}`);
        for (const roleData of backupData.roles) {
            if (!(await checkControl())) {
                return { success: false, stopped: true, error: 'Restore stopped by user.', stats };
            }
            try {
                const role = await guild.roles.create({
                    name: roleData.name,
                    color: roleData.color,
                    hoist: roleData.hoist,
                    permissions: BigInt(roleData.permissions),
                    mentionable: roleData.mentionable
                });
                roleMap.set(roleData.name, role.id);
                stats.rolesCreated++;
            } catch (error) {
                log.error(`Error creating role ${roleData.name}:`, error);
            }
            progressDone++;
            emitProgress('Creating Roles', `${stats.rolesCreated}/${backupData.roles?.length || 0}`);
        }
        
        const categoryMap = new Map();
        emitProgress('Creating Categories', `0/${backupData.categories?.length || 0}`);
        for (const categoryData of backupData.categories) {
            if (!(await checkControl())) {
                return { success: false, stopped: true, error: 'Restore stopped by user.', stats };
            }
            try {
                const category = await guild.channels.create({
                    name: categoryData.name,
                    type: 4,
                    position: categoryData.position
                });
                categoryMap.set(categoryData.name, category.id);
                stats.categoriesCreated++;
                
                // Apply permission overwrites if present
                if (categoryData.permissionOverwrites && categoryData.permissionOverwrites.length > 0) {
                    try {
                        await applyPermissionOverwrites(category, categoryData.permissionOverwrites, roleMap, guild);
                    } catch (e) {
                        log.error(`Error applying perms to category ${categoryData.name}:`, e.message);
                    }
                }
            } catch (error) {
                log.error(`Error creating category ${categoryData.name}:`, error);
            }
            progressDone++;
            emitProgress('Creating Categories', `${stats.categoriesCreated}/${backupData.categories?.length || 0}`);
        }
        
        const channelMap = new Map();
        emitProgress('Creating Channels', `0/${backupData.channels?.length || 0}`);
        for (const channelData of backupData.channels) {
            if (!(await checkControl())) {
                return { success: false, stopped: true, error: 'Restore stopped by user.', stats };
            }
            try {
                const channelOptions = {
                    name: channelData.name,
                    type: channelData.type,
                    position: channelData.position,
                    parent: channelData.parentName ? categoryMap.get(channelData.parentName) : null
                };
                
                // Text-like channels (text, announcement, forum)
                if ([0, 5, 15].includes(channelData.type)) {
                    channelOptions.nsfw = channelData.nsfw || false;
                    channelOptions.topic = channelData.topic || null;
                    channelOptions.rateLimitPerUser = channelData.rateLimitPerUser || 0;
                } else if ([2, 13].includes(channelData.type)) {
                    // Voice and Stage channels
                    channelOptions.bitrate = channelData.bitrate || 64000;
                    channelOptions.userLimit = channelData.userLimit || 0;
                }
                
                const createdChannel = await guild.channels.create(channelOptions);
                channelMap.set(channelData.name, createdChannel);
                stats.channelsCreated++;
                
                // Apply permission overwrites if present
                if (channelData.permissionOverwrites && channelData.permissionOverwrites.length > 0) {
                    try {
                        await applyPermissionOverwrites(createdChannel, channelData.permissionOverwrites, roleMap, guild);
                    } catch (e) {
                        log.error(`Error applying perms to channel ${channelData.name}:`, e.message);
                    }
                }
                
                // Restore messages for text-like channels
                if ([0, 5].includes(channelData.type) && channelData.messages && channelData.messages.length > 0) {
                    try {
                        const webhook = await createdChannel.createWebhook({
                            name: 'Backup Restore',
                            reason: 'Restoring messages from backup'
                        });
                        
                        for (const msgData of channelData.messages) {
                            try {
                                const webhookPayload = {
                                    username: msgData.author.username,
                                    avatarURL: msgData.author.displayAvatarURL || `https://cdn.discordapp.com/embed/avatars/${(parseInt(msgData.author.discriminator) || msgData.author.id) % 5}.png`,
                                    embeds: msgData.embeds || [],
                                    files: []
                                };
                                
                                if (msgData.content && msgData.content.trim().length > 0) {
                                    webhookPayload.content = msgData.content;
                                }
                                
                                if (msgData.attachments && msgData.attachments.length > 0) {
                                    for (const att of msgData.attachments) {
                                        try {
                                            const fileUrl = att.proxyURL || att.url;
                                            const response = await axios.get(fileUrl, {
                                                responseType: 'arraybuffer',
                                                timeout: 10000,
                                                maxContentLength: 25 * 1024 * 1024
                                            });
                                            
                                            webhookPayload.files.push({
                                                attachment: Buffer.from(response.data),
                                                name: att.name
                                            });
                                        } catch (attError) {
                                            log.error(`Failed to fetch attachment ${att.name}:`, attError.message);
                                            const fallbackText = `<:Attach:1521228039135170722> **Attachment (unavailable):** ${att.name}`;
                                            if (webhookPayload.content) {
                                                webhookPayload.content += '\n' + fallbackText;
                                            } else {
                                                webhookPayload.content = fallbackText;
                                            }
                                        }
                                    }
                                }
                                
                                if (!webhookPayload.content && (!webhookPayload.embeds || webhookPayload.embeds.length === 0) && webhookPayload.files.length === 0) {
                                    continue;
                                }

                                if (!(await checkControl())) {
                                    try { await webhook.delete('Backup restore stopped'); } catch {}
                                    return { success: false, stopped: true, error: 'Restore stopped by user.', stats };
                                }
                                
                                await webhook.send(webhookPayload);
                                stats.messagesRestored++;

                                progressDone++;
                                if (stats.messagesRestored % 5 === 0 || stats.messagesRestored === totalMessagesToRestore) {
                                    emitProgress('Restoring Messages', `${stats.messagesRestored}/${totalMessagesToRestore}`);
                                }
                                
                                await new Promise(resolve => setTimeout(resolve, 800));
                            } catch (error) {
                                log.error(`Error restoring message in ${channelData.name}:`, error);
                            }
                        }
                        
                        await webhook.delete('Backup restore complete');
                    } catch (error) {
                        log.error(`Error creating webhook for ${channelData.name}:`, error);
                    }
                }
            } catch (error) {
                log.error(`Error creating channel ${channelData.name}:`, error);
            }

            progressDone++;
            emitProgress('Creating Channels', `${stats.channelsCreated}/${backupData.channels?.length || 0}`);
        }
        
        // ── Restore bot configs ──
        if (!(await checkControl())) {
            return { success: false, stopped: true, error: 'Restore stopped by user.', stats };
        }

        emitProgress('Restoring Configurations', 'Applying bot configuration files');
        if (backupData.botConfig && Object.keys(backupData.botConfig).length > 0) {
            stats.configsRestored = restoreGuildConfigs(guild.id, backupData.botConfig);
        }

        progressDone = Math.max(progressDone + 1, progressTotal);
        emitProgress('Completed', 'Restore finished successfully');

        return {
            success: true,
            backupId: backupId,
            backupName: backupId,
            originalServerName: backupData.server.name,
            includesMessages: backupData.includesMessages || false,
            stats: stats
        };
    } catch (error) {
        log.error('Error loading backup:', error);
        return { success: false, error: `Restore failed: ${error.message}` };
    }
}

async function deleteServerBackup(userId, backupId) {
    try {
        const backup = await models.ServerBackup.findOne({ backupId });
        
        if (!backup) {
            return { success: false, error: 'Backup not found' };
        }
        
        if (backup.createdBy !== userId) {
            return { success: false, error: 'Access denied. You can only delete backups you created.' };
        }
        
        await models.ServerBackup.deleteOne({ backupId });
        
        return {
            success: true,
            backupId: backupId
        };
    } catch (error) {
        log.error('Error deleting backup:', error);
        return { success: false, error: 'Failed to delete backup' };
    }
}

module.exports = {
    createServerBackup,
    listServerBackups,
    listAllServerBackups,
    loadServerBackup,
    deleteServerBackup
};
