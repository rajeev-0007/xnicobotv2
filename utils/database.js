const path = require('path');
const log = require('./logger-styled');
const jsonStore = require('./jsonStore');
const { getPool } = require('./pgPool');
const { initializeSchema } = require('./pgSchema');

let isConnected = false;

const STORE_NAMES = {
    guilds: 'guilds',
    users: 'users',
    guildMembers: 'guild_members',
    autoresponders: 'autoresponders',
    autoreacts: 'autoreacts',
    giveaways: 'giveaways',
    reactionRoles: 'reaction_roles',
    polls: 'polls',
    tickets: 'tickets',
    serverBackups: 'server_backups',
    favoriteSongs: 'favorite_songs',
    likedSongs: 'liked_songs'
};

function loadStore(key, defaultValue = []) {
    const data = jsonStore.read(STORE_NAMES[key]);
    if (data && (Array.isArray(data) ? data.length > 0 : Object.keys(data).length > 0)) {
        return data;
    }
    return Array.isArray(defaultValue) ? [...defaultValue] : { ...defaultValue };
}

function saveStore(key, data, immediate = false) {
    // `immediate` bypasses the debounce and persists to PG/file right away.
    // Used for low-frequency, high-value writes (profile/rank customization)
    // so they aren't lost if the bot is restarted/killed before the debounced
    // flush — the root cause of customizations "not persisting after restart".
    if (immediate && typeof jsonStore.writeImmediate === 'function') {
        const p = jsonStore.writeImmediate(STORE_NAMES[key], data);
        if (p && typeof p.catch === 'function') p.catch(() => {});
        return p;
    }
    jsonStore.write(STORE_NAMES[key], data);
}

function snakeToCamel(str) {
    return str.replace(/_([a-z])/g, (match, letter) => letter.toUpperCase());
}

function camelToSnake(str) {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase();
}

function rowToCamelCase(row, documentType = null, originalData = null) {
    if (!row) return null;
    
    const camelRow = {};
    const originalRow = {};
    
    for (const [key, value] of Object.entries(row)) {
        const camelKey = snakeToCamel(key);
        camelRow[camelKey] = value;
        originalRow[camelKey] = JSON.parse(JSON.stringify(value));
    }
    
    camelRow.save = async function() {
        const updates = {};
        
        for (const [key, value] of Object.entries(camelRow)) {
            if (typeof value !== 'function') {
                const originalValue = originalRow[key];
                
                if (JSON.stringify(value) !== JSON.stringify(originalValue)) {
                    updates[key] = value;
                }
            }
        }
        
        if (Object.keys(updates).length === 0) {
            return camelRow;
        }
        
        let updated;
        if (documentType === 'guild' && camelRow.guildId) {
            updated = await updateGuildConfig(camelRow.guildId, updates);
        } else if (documentType === 'user' && camelRow.userId) {
            updated = await updateUserData(camelRow.userId, updates);
        } else if (documentType === 'guild_member' && camelRow.guildId && camelRow.userId) {
            updated = await updateGuildMember(camelRow.guildId, camelRow.userId, updates);
        }
        
        if (updated) {
            for (const [key, value] of Object.entries(updated)) {
                if (typeof value !== 'function') {
                    camelRow[key] = value;
                    originalRow[key] = JSON.parse(JSON.stringify(value));
                }
            }
        }
        
        return camelRow;
    };
    
    camelRow.toObject = function() {
        const obj = {};
        for (const [key, value] of Object.entries(camelRow)) {
            if (typeof value !== 'function') {
                obj[key] = value;
            }
        }
        return obj;
    };
    
    return camelRow;
}

function rowsToCamelCase(rows, documentType = null) {
    return rows.map(row => rowToCamelCase(row, documentType));
}

const ALLOWED_GUILD_COLUMNS = new Set([
    'prefix', 'welcomer', 'tickets', 'logging', 'automod', 'antinuke',
    'verification', 'musicPanel', 'inviteTracking', 'leveling', 'customCommands',
    'starboard', 'joinToCreate', 'muteRoleId', 'disabledCommands'
]);

const ALLOWED_USER_COLUMNS = new Set([
    'economy', 'social', 'profile', 'stats', 'afk', 'votes', 'botBanned', 'isOwner'
]);

const ALLOWED_GUILD_MEMBER_COLUMNS = new Set([
    'leveling', 'analytics', 'warnings', 'moderation', 'invites'
]);

const ALLOWED_LEADERBOARD_FIELDS = {
    'leveling.xp': { table: 'leveling', field: 'xp' },
    'leveling.level': { table: 'leveling', field: 'level' },
    'leveling.messageCount': { table: 'leveling', field: 'messageCount' },
    'leveling.commandsUsed': { table: 'leveling', field: 'commandsUsed' },
    'analytics.totalMessages': { table: 'analytics', field: 'totalMessages' },
    'analytics.voiceTime': { table: 'analytics', field: 'voiceTime' },
    'economy.balance': { table: 'economy', field: 'balance' },
    'economy.bank': { table: 'economy', field: 'bank' }
};

const ALLOWED_INCREMENT_FIELDS = {
    'leveling.xp': { table: 'leveling', field: 'xp' },
    'leveling.level': { table: 'leveling', field: 'level' },
    'leveling.messageCount': { table: 'leveling', field: 'messageCount' },
    'leveling.commandsUsed': { table: 'leveling', field: 'commandsUsed' },
    'analytics.totalMessages': { table: 'analytics', field: 'totalMessages' },
    'analytics.voiceTime': { table: 'analytics', field: 'voiceTime' },
    'invites.invites': { table: 'invites', field: 'invites' },
    'invites.left': { table: 'invites', field: 'left' },
    'invites.fake': { table: 'invites', field: 'fake' },
    'economy.balance': { table: 'economy', field: 'balance' },
    'economy.bank': { table: 'economy', field: 'bank' }
};

async function connectDatabase() {
    if (isConnected) {
        return;
    }

    try {
        // Initialize PostgreSQL schema
        await initializeSchema();

        // Load all JSON stores into memory
        await jsonStore.init();

        // Stores that need object {} default instead of array []
        const objectStores = new Set(['polls', 'tickets']);

        // Ensure default stores exist and have the correct format
        for (const [key, storeName] of Object.entries(STORE_NAMES)) {
            if (!jsonStore.has(storeName)) {
                await jsonStore.write(storeName, objectStores.has(storeName) ? {} : []);
            } else if (objectStores.has(storeName)) {
                // Migrate: if the store exists but is in the wrong format (array), reset it to {}
                const existing = jsonStore.read(storeName);
                if (Array.isArray(existing)) {
                    log.warning(`[JsonStore] Migrating ${storeName} from legacy array to object format`);
                    await jsonStore.write(storeName, {});
                }
            }
        }

        isConnected = true;
        log.success('PostgreSQL Database connected');
    } catch (error) {
        log.error('PostgreSQL Database connection failed:', error);
        throw error;
    }
}

async function getGuildConfig(guildId) {
    try {
        const guilds = loadStore('guilds', []);
        let guild = guilds.find(g => g.guild_id === guildId);
        
        if (!guild) {
            guild = {
                guild_id: guildId,
                prefix: '-',
                welcomer: { enabled: false },
                tickets: { enabled: false },
                logging: {},
                automod: { enabled: false },
                antinuke: { enabled: false },
                verification: { enabled: false },
                music_panel: { enabled: false },
                invite_tracking: { enabled: false },
                leveling: { enabled: false },
                custom_commands: [],
                starboard: { enabled: false },
                join_to_create: { enabled: false },
                mute_role_id: null,
                disabled_commands: [],
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            guilds.push(guild);
            saveStore('guilds', guilds);
        }
        
        return rowToCamelCase(guild, 'guild');
    } catch (error) {
        log.error(`Error fetching guild config for ${guildId}:`, error);
        throw error;
    }
}

async function updateGuildConfig(guildId, updates) {
    try {
        const guilds = loadStore('guilds', []);
        const guildIndex = guilds.findIndex(g => g.guild_id === guildId);
        
        if (guildIndex === -1) {
            await getGuildConfig(guildId);
            return await updateGuildConfig(guildId, updates);
        }
        
        for (const [key, value] of Object.entries(updates)) {
            // Support dot-notation keys like 'leveling.enabled' or 'leveling.announcements.channel'
            const topKey = key.split('.')[0];
            if (!ALLOWED_GUILD_COLUMNS.has(topKey)) {
                log.warning(`Attempt to update non-whitelisted guild column: ${topKey}`);
                continue;
            }
            
            const snakeTopKey = camelToSnake(topKey);
            if (key.includes('.')) {
                // Deep merge: e.g. 'leveling.announcements.channel' -> guilds[i].leveling.announcements.channel = value
                const parts = key.split('.');
                let target = guilds[guildIndex];
                // Ensure top-level key exists as object
                if (!target[snakeTopKey] || typeof target[snakeTopKey] !== 'object') {
                    target[snakeTopKey] = {};
                }
                target = target[snakeTopKey];
                // Walk the remaining path, creating intermediate objects
                for (let i = 1; i < parts.length - 1; i++) {
                    if (!target[parts[i]] || typeof target[parts[i]] !== 'object') {
                        target[parts[i]] = {};
                    }
                    target = target[parts[i]];
                }
                target[parts[parts.length - 1]] = value;
            } else {
                guilds[guildIndex][snakeTopKey] = value;
            }
        }
        
        guilds[guildIndex].updated_at = new Date().toISOString();
        saveStore('guilds', guilds);
        
        return rowToCamelCase(guilds[guildIndex], 'guild');
    } catch (error) {
        log.error(`Error updating guild config for ${guildId}:`, error);
        throw error;
    }
}

/**
 * Convert a legacy object-keyed users store ({ [userId]: row }) into the
 * array shape this module uses. Each row's user_id is backfilled from its key
 * so older customizations saved by the previous JSON path are recovered
 * rather than discarded.
 */
function normalizeUsersStore(obj) {
    if (Array.isArray(obj)) return obj;
    if (!obj || typeof obj !== 'object') return [];
    const out = [];
    for (const [key, row] of Object.entries(obj)) {
        if (!row || typeof row !== 'object') continue;
        const r = { ...row };
        if (!r.user_id) r.user_id = r.userId || key;
        delete r.userId;
        out.push(r);
    }
    return out;
}

async function getUserData(userId) {
    try {
        let users = loadStore('users', []);
        if (!Array.isArray(users)) {
            // Legacy object-keyed shape. Recover it into the array shape
            // instead of discarding it so saved customizations survive.
            users = normalizeUsersStore(users);
            saveStore('users', users);
        }
        let user = users.find(u => u.user_id === userId);
        
        if (!user) {
            user = {
                user_id: userId,
                economy: { balance: 0, bank: 0, inventory: [] },
                social: { reputation: 0, bio: null },
                profile: { 
                    backgroundColor: '#2f3136', 
                    progressBarColor: '#bcf1e4', 
                    cardStyle: 'default', 
                    textColor: '#ffffff',
                    // Nested structures for rank card and profile card customizations
                    rankCard: {
                        backgroundColor: '#2f3136',
                        progressBarColor: '#bcf1e4',
                        textColor: '#ffffff',
                        cardStyle: 'default',
                        customBackground: null,
                        fontFamily: 'Inter',
                        backgroundOpacity: 0.35
                    },
                    profileCard: {
                        backgroundColor: '#2f3136',
                        accentColor: '#bcf1e4',
                        textColor: '#ffffff',
                        cardStyle: 'default',
                        customBackground: null,
                        bannerImage: null,
                        fontFamily: 'Inter',
                        backgroundOpacity: 0.35,
                        badgeStyle: 'default'
                    }
                },
                stats: { commandsUsed: 0, botInteractions: 0 },
                afk: { isAfk: false, reason: '', since: null },
                votes: { total: 0, platforms: [] },
                bot_banned: { banned: false, reason: null, bannedAt: null },
                is_owner: false,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            users.push(user);
            saveStore('users', users);
        } else {
            // Migrate existing users to have nested profile structure
            let needsMigration = false;
            if (user.profile && !user.profile.rankCard) {
                needsMigration = true;
                user.profile.rankCard = {
                    backgroundColor: user.profile.backgroundColor || '#2f3136',
                    progressBarColor: user.profile.progressBarColor || '#bcf1e4',
                    textColor: user.profile.textColor || '#ffffff',
                    cardStyle: user.profile.cardStyle || 'default',
                    customBackground: user.profile.customBackground || null,
                    fontFamily: user.profile.fontFamily || 'Inter',
                    backgroundOpacity: user.profile.backgroundOpacity ?? 0.35
                };
            }
            if (user.profile && !user.profile.profileCard) {
                needsMigration = true;
                user.profile.profileCard = {
                    backgroundColor: user.profile.backgroundColor || '#2f3136',
                    accentColor: user.profile.accentColor || '#bcf1e4',
                    textColor: user.profile.textColor || '#ffffff',
                    cardStyle: user.profile.cardStyle || 'default',
                    customBackground: user.profile.customBackground || null,
                    bannerImage: user.profile.bannerImage || null,
                    fontFamily: user.profile.fontFamily || 'Inter',
                    backgroundOpacity: user.profile.backgroundOpacity ?? 0.35,
                    badgeStyle: user.profile.badgeStyle || 'default'
                };
            }
            // Ensure social.bio exists
            if (user.social && user.social.bio === undefined) {
                needsMigration = true;
                user.social.bio = null;
            }
            // Ensure afk structure is complete
            if (user.afk && (user.afk.reason === undefined || user.afk.since === undefined)) {
                needsMigration = true;
                user.afk = {
                    isAfk: user.afk.isAfk || false,
                    reason: user.afk.reason || '',
                    since: user.afk.since || null
                };
            }
            
            if (needsMigration) {
                user.updated_at = new Date().toISOString();
                saveStore('users', users);
            }
        }
        
        return rowToCamelCase(user, 'user');
    } catch (error) {
        if (isConnected) {
            log.error(`Error fetching user data for ${userId}:`, error);
        }
        throw error;
    }
}

/**
 * Apply a set of (possibly dot-notation) updates to a single user record,
 * honouring the ALLOWED_USER_COLUMNS whitelist and deep-merging nested keys
 * (e.g. 'profile.profileCard.customBackground'). Mutates `rec` in place.
 */
function _applyUserUpdates(rec, updates) {
    for (const [key, value] of Object.entries(updates)) {
        const topLevelKey = key.split('.')[0];
        if (!ALLOWED_USER_COLUMNS.has(topLevelKey)) {
            log.warning(`Attempt to update non-whitelisted user column: ${key}`);
            continue;
        }

        if (key.includes('.')) {
            const parts = key.split('.');
            const snakeTopKey = camelToSnake(parts[0]);
            if (!rec[snakeTopKey] || typeof rec[snakeTopKey] !== 'object') rec[snakeTopKey] = {};
            let current = rec[snakeTopKey];
            for (let i = 1; i < parts.length - 1; i++) {
                if (!current[parts[i]] || typeof current[parts[i]] !== 'object') current[parts[i]] = {};
                current = current[parts[i]];
            }
            current[parts[parts.length - 1]] = value;
        } else {
            const snakeKey = camelToSnake(key);
            rec[snakeKey] = value;
        }
    }
    return rec;
}

async function updateUserData(userId, updates) {
    try {
        // ── Race-safe write (the real fix for "customizations vanish after a
        // restart") ──
        // The old path cloned the ENTIRE cached `users` array, mutated one
        // record, then wrote the whole array back. If the in-memory cache was
        // even slightly stale (the dashboard, another shard, or the bot's own
        // frequent user writes had advanced the PG row in between), that whole
        // -array write silently clobbered the just-saved customization — which
        // then "disappeared" on the next restart/read.
        //
        // updateUserEntry re-fetches the freshest `users` row (from PostgreSQL
        // in multi-process setups), mutates ONLY this user, and persists
        // IMMEDIATELY. The dashboard already used it; the bot side never did —
        // that gap was the bug. Falls back to cached array in single-process
        // local mode where there's no cross-writer race.
        if (typeof jsonStore.updateUserEntry === 'function') {
            const rec = await jsonStore.updateUserEntry(userId, (user) => {
                _applyUserUpdates(user, updates);
                user.updated_at = new Date().toISOString();
            });
            return rowToCamelCase(rec, 'user');
        }

        // ── Legacy fallback (older jsonStore without updateUserEntry) ──
        let users = loadStore('users', []);
        if (!Array.isArray(users)) {
            users = normalizeUsersStore(users);
        }
        const userIndex = users.findIndex(u => u.user_id === userId);

        if (userIndex === -1) {
            await getUserData(userId);
            return await updateUserData(userId, updates);
        }

        _applyUserUpdates(users[userIndex], updates);
        users[userIndex].updated_at = new Date().toISOString();
        saveStore('users', users, true); // immediate — don't lose customizations on restart

        return rowToCamelCase(users[userIndex], 'user');
    } catch (error) {
        log.error(`Error updating user data for ${userId}:`, error);
        throw error;
    }
}

async function getGuildMember(guildId, userId) {
    try {
        const members = loadStore('guildMembers', []);
        let member = members.find(m => m.guild_id === guildId && m.user_id === userId);
        
        if (!member) {
            member = {
                guild_id: guildId,
                user_id: userId,
                leveling: { xp: 0, level: 0, messageCount: 0, commandsUsed: 0 },
                analytics: { totalMessages: 0, voiceTime: 0 },
                warnings: [],
                moderation: { muted: false, voiceBanned: false },
                invites: { invites: 0, left: 0, fake: 0 },
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            members.push(member);
            saveStore('guildMembers', members);
        }
        
        return rowToCamelCase(member, 'guild_member');
    } catch (error) {
        log.error(`Error fetching guild member for ${guildId}/${userId}:`, error);
        return null;
    }
}

async function updateGuildMember(guildId, userId, updates) {
    try {
        const members = loadStore('guildMembers', []);
        const memberIndex = members.findIndex(m => m.guild_id === guildId && m.user_id === userId);
        
        if (memberIndex === -1) {
            await getGuildMember(guildId, userId);
            return await updateGuildMember(guildId, userId, updates);
        }
        
        for (const [key, value] of Object.entries(updates)) {
            if (!ALLOWED_GUILD_MEMBER_COLUMNS.has(key)) {
                log.warning(`Attempt to update non-whitelisted guild member column: ${key}`);
                continue;
            }
            
            const snakeKey = camelToSnake(key);
            members[memberIndex][snakeKey] = value;
        }
        
        members[memberIndex].updated_at = new Date().toISOString();
        saveStore('guildMembers', members);
        
        return rowToCamelCase(members[memberIndex], 'guild_member');
    } catch (error) {
        log.error(`Error updating guild member for ${guildId}/${userId}:`, error);
        throw error;
    }
}

async function incrementGuildMemberField(guildId, userId, field, amount = 1) {
    try {
        if (!ALLOWED_INCREMENT_FIELDS[field]) {
            throw new Error(`Field ${field} is not allowed for increment operations`);
        }
        
        const { table, field: subField } = ALLOWED_INCREMENT_FIELDS[field];
        
        const members = loadStore('guildMembers', []);
        let memberIndex = members.findIndex(m => m.guild_id === guildId && m.user_id === userId);
        
        if (memberIndex === -1) {
            await getGuildMember(guildId, userId);
            return await incrementGuildMemberField(guildId, userId, field, amount);
        }
        
        if (!members[memberIndex][table]) {
            members[memberIndex][table] = {};
        }
        
        const currentValue = members[memberIndex][table][subField] || 0;
        members[memberIndex][table][subField] = currentValue + amount;
        members[memberIndex].updated_at = new Date().toISOString();
        
        saveStore('guildMembers', members);
        
        return rowToCamelCase(members[memberIndex], 'guild_member');
    } catch (error) {
        log.error(`Error incrementing field ${field} for ${guildId}/${userId}:`, error);
        throw error;
    }
}

async function getLeaderboard(guildId, field = 'leveling.xp', limit = 10) {
    try {
        if (!ALLOWED_LEADERBOARD_FIELDS[field]) {
            throw new Error(`Field ${field} is not allowed for leaderboard operations`);
        }
        
        const { table, field: subField } = ALLOWED_LEADERBOARD_FIELDS[field];
        
        const members = loadStore('guildMembers', []);
        const guildMembers = members.filter(m => m.guild_id === guildId);
        
        const sorted = guildMembers.sort((a, b) => {
            const aValue = (a[table] && a[table][subField]) || 0;
            const bValue = (b[table] && b[table][subField]) || 0;
            return bValue - aValue;
        });
        
        const limited = sorted.slice(0, limit);
        
        return rowsToCamelCase(limited, 'guild_member');
    } catch (error) {
        log.error(`Error fetching leaderboard for ${guildId}:`, error);
        throw error;
    }
}

// ── custom_data in-memory cache + debounced writes ──────────────────────────
// Reads are served from memory. Writes update memory immediately and are
// debounced 15 s before hitting PostgreSQL, cutting transfer dramatically.
const _cdCache   = new Map();   // key → value
const _cdDirty   = new Set();   // keys with unsaved changes
const _cdTimers  = new Map();   // debounce timers
const CD_DEBOUNCE = 15_000;     // 15 seconds

let _cdLoaded = false;

// custom_data is always backed by the local JSON store so the bot works WITH
// or WITHOUT PostgreSQL. When a database is configured it is mirrored there too.
function _pgConfigured() {
    return !!(process.env.DATABASE_URL || process.env.FALLBACK_DATABASE_URL);
}

async function _loadCustomDataCache() {
    if (_cdLoaded) return;

    // 1) Load from the local JSON store (always available, primary source)
    try {
        const stored = jsonStore.read('custom_data');
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
            for (const [k, v] of Object.entries(stored)) _cdCache.set(k, v);
        }
    } catch { /* ignore */ }

    // 2) If a database is configured, merge rows from it (non-fatal if it fails)
    if (_pgConfigured()) {
        try {
            const pool = getPool();
            const { rows } = await pool.query('SELECT key, value FROM custom_data');
            for (const row of rows) _cdCache.set(row.key, row.value);
        } catch { /* DB optional — local store already loaded */ }
    }

    _cdLoaded = true;
}

function _persistCustomDataToStore(key, value) {
    try {
        const all = jsonStore.read('custom_data');
        const obj = (all && typeof all === 'object' && !Array.isArray(all)) ? all : {};
        obj[key] = value;
        jsonStore.write('custom_data', obj);
    } catch { /* ignore */ }
}

function _cdScheduleWrite(key) {
    if (_cdTimers.has(key)) clearTimeout(_cdTimers.get(key));
    const t = setTimeout(async () => {
        _cdTimers.delete(key);
        const value = _cdCache.get(key);
        if (value === undefined) return;

        // Always persist locally so data survives without a database.
        _persistCustomDataToStore(key, value);

        // Mirror to PostgreSQL if one is configured (non-fatal on failure).
        if (_pgConfigured()) {
            try {
                const pool = getPool();
                await pool.query(
                    `INSERT INTO custom_data (key, value, updated_at) VALUES ($1, $2::jsonb, NOW())
                     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
                    [key, JSON.stringify(value)]
                );
            } catch { /* DB optional */ }
        }
        _cdDirty.delete(key);
    }, CD_DEBOUNCE);
    if (t.unref) t.unref();
    _cdTimers.set(key, t);
}

const db = {
    async get(key) {
        try {
            await _loadCustomDataCache();
            if (_cdCache.has(key)) return _cdCache.get(key);

            // Only query the database directly if one is actually configured.
            if (_pgConfigured()) {
                try {
                    const pool = getPool();
                    const { rows } = await pool.query('SELECT value FROM custom_data WHERE key = $1', [key]);
                    const val = rows.length > 0 ? rows[0].value : null;
                    if (val !== null) _cdCache.set(key, val);
                    return val;
                } catch { /* DB optional */ }
            }
            return null;
        } catch (error) {
            log.error(`[db.get] Error for key ${key}:`, error);
            return null;
        }
    },
    async set(key, value) {
        try {
            _cdCache.set(key, value);
            _cdDirty.add(key);
            _cdScheduleWrite(key);
            return value;
        } catch (error) {
            log.error(`[db.set] Error for key ${key}:`, error);
            return value;
        }
    },
    async delete(key) {
        try {
            _cdCache.delete(key);
            _cdDirty.delete(key);
            if (_cdTimers.has(key)) { clearTimeout(_cdTimers.get(key)); _cdTimers.delete(key); }

            // Remove from the local store.
            try {
                const all = jsonStore.read('custom_data');
                if (all && typeof all === 'object' && !Array.isArray(all) && (key in all)) {
                    delete all[key];
                    jsonStore.write('custom_data', all);
                }
            } catch { /* ignore */ }

            // Remove from the database if configured.
            if (_pgConfigured()) {
                try {
                    const pool = getPool();
                    await pool.query('DELETE FROM custom_data WHERE key = $1', [key]);
                } catch { /* DB optional */ }
            }
            return true;
        } catch (error) {
            log.error(`[db.delete] Error for key ${key}:`, error);
            return false;
        }
    },
    async list(prefix = '') {
        try {
            await _loadCustomDataCache();
            return [..._cdCache.keys()].filter(k => k.startsWith(prefix));
        } catch (error) {
            log.error(`[db.list] Error for prefix ${prefix}:`, error);
            return [];
        }
    }
};

module.exports = {
    connectDatabase,
    isConnected: () => isConnected,
    db,
    
    models: {
        Guild: {
            findOne: async (query) => {
                const guilds = loadStore('guilds', []);
                const guild = guilds.find(g => g.guild_id === query.guildId);
                return rowToCamelCase(guild, 'guild');
            },
            find: async (query = {}) => {
                const guilds = loadStore('guilds', []);
                if (query['automod.enabled']) {
                    return guilds
                        .filter(g => g.automod && g.automod.enabled === true)
                        .map(g => rowToCamelCase(g, 'guild'));
                }
                if (query['antinuke.enabled']) {
                    return guilds
                        .filter(g => g.antinuke && g.antinuke.enabled === true)
                        .map(g => rowToCamelCase(g, 'guild'));
                }
                return guilds.map(g => rowToCamelCase(g, 'guild'));
            },
            findOneAndUpdate: async (query, update, options = {}) => {
                const guild = await getGuildConfig(query.guildId);
                if (update.$set) {
                    return await updateGuildConfig(query.guildId, update.$set);
                }
                return guild;
            },
            deleteOne: async (query) => {
                const guilds = loadStore('guilds', []);
                const filtered = guilds.filter(g => g.guild_id !== query.guildId);
                saveStore('guilds', filtered);
            }
        },
        User: {
            findOne: async (query) => {
                const users = loadStore('users', []);
                const user = users.find(u => u.user_id === query.userId);
                return rowToCamelCase(user, 'user');
            },
            find: async (query = {}) => {
                const users = loadStore('users', []);
                return users.map(u => rowToCamelCase(u, 'user'));
            },
            findOneAndUpdate: async (query, update, options = {}) => {
                const user = await getUserData(query.userId);
                if (update.$set) {
                    return await updateUserData(query.userId, update.$set);
                }
                return user;
            }
        },
        GuildMember: {
            findOne: async (query) => {
                const members = loadStore('guildMembers', []);
                const member = members.find(m => m.guild_id === query.guildId && m.user_id === query.userId);
                return rowToCamelCase(member, 'guild_member');
            },
            find: async (query = {}) => {
                const members = loadStore('guildMembers', []);
                if (query.guildId) {
                    return members
                        .filter(m => m.guild_id === query.guildId)
                        .map(m => rowToCamelCase(m, 'guild_member'));
                }
                return members.map(m => rowToCamelCase(m, 'guild_member'));
            },
            findOneAndUpdate: async (query, update, options = {}) => {
                const member = await getGuildMember(query.guildId, query.userId);
                if (update.$set) {
                    return await updateGuildMember(query.guildId, query.userId, update.$set);
                }
                if (update.$inc) {
                    for (const [field, amount] of Object.entries(update.$inc)) {
                        await incrementGuildMemberField(query.guildId, query.userId, field, amount);
                    }
                    return await getGuildMember(query.guildId, query.userId);
                }
                return member;
            },
            deleteMany: async (query) => {
                const members = loadStore('guildMembers', []);
                const filtered = members.filter(m => m.guild_id !== query.guildId);
                saveStore('guildMembers', filtered);
            }
        },
        Autoresponder: {
            findOne: async (query) => {
                const autoresponders = loadStore('autoresponders', []);
                const autoresponder = autoresponders.find(a => a.guild_id === query.guildId);
                return rowToCamelCase(autoresponder, 'autoresponder');
            },
            find: async (query = {}) => {
                const autoresponders = loadStore('autoresponders', []);
                return autoresponders.map(a => rowToCamelCase(a, 'autoresponder'));
            },
            deleteOne: async (query) => {
                const autoresponders = loadStore('autoresponders', []);
                const filtered = autoresponders.filter(a => a.guild_id !== query.guildId);
                saveStore('autoresponders', filtered);
            }
        },
        Autoreact: {
            findOne: async (query) => {
                const autoreacts = loadStore('autoreacts', []);
                const autoreact = autoreacts.find(a => a.guild_id === query.guildId);
                return rowToCamelCase(autoreact, 'autoreact');
            },
            find: async (query = {}) => {
                const autoreacts = loadStore('autoreacts', []);
                return autoreacts.map(a => rowToCamelCase(a, 'autoreact'));
            },
            deleteOne: async (query) => {
                const autoreacts = loadStore('autoreacts', []);
                const filtered = autoreacts.filter(a => a.guild_id !== query.guildId);
                saveStore('autoreacts', filtered);
            }
        },
        Giveaway: {
            findOne: async (query) => {
                const giveaways = loadStore('giveaways', []);
                const giveaway = giveaways.find(g => g.message_id === query.messageId);
                return rowToCamelCase(giveaway, 'giveaway');
            },
            find: async (query = {}) => {
                const giveaways = loadStore('giveaways', []);
                if (query.guildId) {
                    return giveaways
                        .filter(g => g.guild_id === query.guildId)
                        .map(g => rowToCamelCase(g, 'giveaway'));
                }
                return giveaways.map(g => rowToCamelCase(g, 'giveaway'));
            },
            deleteMany: async (query) => {
                const giveaways = loadStore('giveaways', []);
                const filtered = giveaways.filter(g => g.guild_id !== query.guildId);
                saveStore('giveaways', filtered);
            }
        },
        ReactionRole: {
            findOne: async (query) => {
                const reactionRoles = loadStore('reactionRoles', []);
                const reactionRole = reactionRoles.find(r => r.message_id === query.messageId);
                return rowToCamelCase(reactionRole, 'reaction_role');
            },
            find: async (query = {}) => {
                const reactionRoles = loadStore('reactionRoles', []);
                if (query.guildId) {
                    return reactionRoles
                        .filter(r => r.guild_id === query.guildId)
                        .map(r => rowToCamelCase(r, 'reaction_role'));
                }
                return reactionRoles.map(r => rowToCamelCase(r, 'reaction_role'));
            },
            deleteMany: async (query) => {
                const reactionRoles = loadStore('reactionRoles', []);
                const filtered = reactionRoles.filter(r => r.guild_id !== query.guildId);
                saveStore('reactionRoles', filtered);
            }
        },
        Poll: {
            findOne: async (query) => {
                const polls = loadStore('polls', []);
                const poll = polls.find(p => p.message_id === query.messageId);
                return rowToCamelCase(poll, 'poll');
            },
            find: async (query = {}) => {
                const polls = loadStore('polls', []);
                if (query.guildId) {
                    return polls
                        .filter(p => p.guild_id === query.guildId)
                        .map(p => rowToCamelCase(p, 'poll'));
                }
                return polls.map(p => rowToCamelCase(p, 'poll'));
            },
            deleteMany: async (query) => {
                const polls = loadStore('polls', []);
                const filtered = polls.filter(p => p.guild_id !== query.guildId);
                saveStore('polls', filtered);
            }
        },
        Ticket: {
            findOne: async (query) => {
                const config = loadStore('tickets', {});
                if (Array.isArray(config)) return null;
                for (const guildCfg of Object.values(config)) {
                    const ticket = Object.entries(guildCfg.tickets || {}).find(([chId]) => chId === query.channelId);
                    if (ticket) return rowToCamelCase({ channel_id: ticket[0], ...ticket[1] }, 'ticket');
                }
                return null;
            },
            find: async (query = {}) => {
                const config = loadStore('tickets', {});
                if (Array.isArray(config)) return [];
                const results = [];
                for (const [gId, guildCfg] of Object.entries(config)) {
                    if (query.guildId && gId !== query.guildId) continue;
                    for (const [chId, t] of Object.entries(guildCfg.tickets || {})) {
                        results.push(rowToCamelCase({ guild_id: gId, channel_id: chId, ...t }, 'ticket'));
                    }
                }
                return results;
            },
            deleteMany: async (query) => {
                const config = loadStore('tickets', {});
                if (Array.isArray(config)) return;
                if (query.guildId && config[query.guildId]) {
                    delete config[query.guildId];
                    saveStore('tickets', config);
                }
            }
        },
        ServerBackup: {
            findOne: async (query) => {
                const backups = loadStore('serverBackups', []);
                let backup;
                if (query.backupId) {
                    backup = backups.find(b => b.backupId === query.backupId);
                } else if (query.backup_id) {
                    backup = backups.find(b => b.backupId === query.backup_id);
                }
                if (!backup) return null;
                const result = { ...backup };
                result.toObject = function() { return { ...this }; };
                return result;
            },
            find: (query = {}) => {
                const backups = loadStore('serverBackups', []);
                let filtered = backups;
                if (query.createdBy) {
                    filtered = backups.filter(b => b.createdBy === query.createdBy);
                }
                return {
                    sort: function(sortObj) {
                        const sortKey = Object.keys(sortObj)[0];
                        const sortDir = sortObj[sortKey];
                        filtered.sort((a, b) => {
                            if (sortDir === -1) return new Date(b[sortKey]) - new Date(a[sortKey]);
                            return new Date(a[sortKey]) - new Date(b[sortKey]);
                        });
                        return this;
                    },
                    select: function(selectFields) {
                        return filtered;
                    },
                    then: function(resolve) {
                        resolve(filtered);
                    }
                };
            },
            exists: async (query) => {
                const backups = loadStore('serverBackups', []);
                if (query.backupId) {
                    return backups.some(b => b.backupId === query.backupId);
                }
                return false;
            },
            create: async (data) => {
                const backups = loadStore('serverBackups', []);
                data.createdAt = new Date().toISOString();
                backups.push(data);
                saveStore('serverBackups', backups);
                return data;
            },
            deleteOne: async (query) => {
                const backups = loadStore('serverBackups', []);
                const filtered = backups.filter(b => b.backupId !== query.backupId);
                saveStore('serverBackups', filtered);
                return { deletedCount: backups.length - filtered.length };
            }
        },
        FavoriteSong: {
            findOne: async (query) => {
                const favoriteSongs = loadStore('favoriteSongs', []);
                const song = favoriteSongs.find(s => 
                    s.user_id === query.userId && s.url === query.url
                );
                return rowToCamelCase(song, 'favorite_song');
            },
            find: async (query = {}) => {
                const favoriteSongs = loadStore('favoriteSongs', []);
                if (query.userId) {
                    return favoriteSongs
                        .filter(s => s.user_id === query.userId)
                        .map(s => rowToCamelCase(s, 'favorite_song'));
                }
                return favoriteSongs.map(s => rowToCamelCase(s, 'favorite_song'));
            },
            create: async (data) => {
                const favoriteSongs = loadStore('favoriteSongs', []);
                const newSong = {
                    user_id: data.userId,
                    title: data.title || 'Unknown',
                    author: data.author || 'Unknown',
                    url: data.url,
                    duration: data.duration || 0,
                    thumbnail: data.thumbnail || null,
                    created_at: new Date().toISOString()
                };
                favoriteSongs.push(newSong);
                saveStore('favoriteSongs', favoriteSongs);
                return rowToCamelCase(newSong, 'favorite_song');
            },
            deleteOne: async (query) => {
                const favoriteSongs = loadStore('favoriteSongs', []);
                const filtered = favoriteSongs.filter(s => 
                    !(s.user_id === query.userId && s.url === query.url)
                );
                saveStore('favoriteSongs', filtered);
            },
            deleteMany: async (query) => {
                const favoriteSongs = loadStore('favoriteSongs', []);
                const filtered = favoriteSongs.filter(s => s.user_id !== query.userId);
                const deletedCount = favoriteSongs.length - filtered.length;
                saveStore('favoriteSongs', filtered);
                return { deletedCount };
            }
        },
        LikedSong: {
            findOne: async (query) => {
                const likedSongs = loadStore('likedSongs', []);
                const song = likedSongs.find(s => 
                    s.user_id === query.userId && s.url === query.url
                );
                return rowToCamelCase(song, 'liked_song');
            },
            find: async (query = {}) => {
                const likedSongs = loadStore('likedSongs', []);
                if (query.userId) {
                    return likedSongs
                        .filter(s => s.user_id === query.userId)
                        .map(s => rowToCamelCase(s, 'liked_song'));
                }
                return likedSongs.map(s => rowToCamelCase(s, 'liked_song'));
            },
            findOneAndUpdate: async (query, update, options = {}) => {
                const likedSongs = loadStore('likedSongs', []);
                let songIndex = likedSongs.findIndex(s => 
                    s.user_id === query.userId && s.url === query.url
                );
                
                if (songIndex === -1 && options.upsert) {
                    const newSong = {
                        user_id: query.userId,
                        song_title: update.$set?.songTitle || '',
                        artist: update.$set?.artist || '',
                        url: query.url,
                        play_count: 1,
                        last_played: new Date().toISOString()
                    };
                    likedSongs.push(newSong);
                    saveStore('likedSongs', likedSongs);
                    return rowToCamelCase(newSong, 'liked_song');
                }
                
                if (songIndex >= 0) {
                    if (update.$inc && update.$inc.playCount) {
                        likedSongs[songIndex].play_count = 
                            (likedSongs[songIndex].play_count || 0) + update.$inc.playCount;
                    }
                    
                    if (update.$set) {
                        for (const [key, value] of Object.entries(update.$set)) {
                            const snakeKey = camelToSnake(key);
                            likedSongs[songIndex][snakeKey] = value;
                        }
                    }
                    
                    likedSongs[songIndex].last_played = new Date().toISOString();
                    saveStore('likedSongs', likedSongs);
                    
                    return rowToCamelCase(likedSongs[songIndex], 'liked_song');
                }
                
                return null;
            }
        }
    },
    
    getGuildConfig,
    updateGuildConfig,
    getUserData,
    updateUserData,
    getGuildMember,
    updateGuildMember,
    incrementGuildMemberField,
    getLeaderboard,
    getGlobalUserStats,
    getGlobalLeaderboard
};

function getGlobalUserStats(userId) {
    const members = loadStore('guildMembers', []);
    const userEntries = members.filter(m => m.user_id === userId);

    let totalMessages = 0;
    let voiceTime = 0;
    let xp = 0;
    let level = 0;
    let messageCount = 0;
    let commandsUsed = 0;
    let invites = 0;
    let guildsActive = 0;

    for (const entry of userEntries) {
        totalMessages += Number(entry.analytics?.totalMessages || 0);
        voiceTime += Number(entry.analytics?.voiceTime || 0);
        xp += Number(entry.leveling?.xp || 0);
        messageCount += Number(entry.leveling?.messageCount || 0);
        commandsUsed += Number(entry.leveling?.commandsUsed || 0);
        invites += Number(entry.invites?.invites || 0);
        const entryLevel = Number(entry.leveling?.level || 0);
        if (entryLevel > level) level = entryLevel;
        if (Number(entry.analytics?.totalMessages || 0) > 0 || Number(entry.analytics?.voiceTime || 0) > 0) {
            guildsActive++;
        }
    }

    return {
        userId,
        totalMessages,
        voiceTime,
        xp,
        level,
        messageCount,
        commandsUsed,
        invites,
        guildsActive
    };
}

function getGlobalLeaderboard(field = 'totalMessages', limit = 10) {
    const members = loadStore('guildMembers', []);
    const userMap = new Map();

    const fieldMapping = {
        totalMessages: m => Number(m.analytics?.totalMessages || 0),
        voiceTime: m => Number(m.analytics?.voiceTime || 0),
        xp: m => Number(m.leveling?.xp || 0),
        invites: m => Number(m.invites?.invites || 0)
    };

    const getValue = fieldMapping[field];
    if (!getValue) return [];

    for (const entry of members) {
        const uid = entry.user_id;
        if (!uid) continue;
        const val = getValue(entry);
        userMap.set(uid, (userMap.get(uid) || 0) + val);
    }

    const sorted = [...userMap.entries()]
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);

    return sorted.map(([userId, value]) => ({ userId, value }));
}
