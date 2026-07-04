/**
 * Premium Manager — handles keys, subscriptions, and access control.
 * Now backed by PostgreSQL via jsonStore.
 */

const crypto = require('crypto');
const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

/* ─────────────────────── Constants ─────────────────────── */

const KEY_LIFETIME_MS = 24 * 60 * 60 * 1000;
const REDEEMED_KEY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/* ─────────────────────── Data Access via jsonStore ─────────────────────── */

function ensureArray(val) { return Array.isArray(val) ? val : []; }

// Premium + key data are low-frequency, high-value writes. They MUST
// persist right away rather than sit in the 30s debounce window — a
// restart inside that window (common on auto-sleeping hosts) silently
// drops the write, which is exactly how premium users/servers and keys
// appeared to "auto-erase". writeImmediate() upserts to PostgreSQL (or
// the local file) synchronously-scheduled and returns a promise we let
// run in the background.
function loadPremiumData() { return ensureArray(jsonStore.read('premium')); }
function savePremiumData(d) { 
    jsonStore.writeImmediate('premium', d).catch((err) => {
        log.error(`[PremiumManager] Error saving premium data:`, err.message || err);
    }); 
}
function loadKeys()         { return ensureArray(jsonStore.read('premium-keys')); }
function saveKeys(k)        { 
    jsonStore.writeImmediate('premium-keys', k).catch((err) => {
        log.error(`[PremiumManager] Error saving premium keys:`, err.message || err);
    });
}
function loadServerPremium() { return ensureArray(jsonStore.read('server-premium')); }
function saveServerPremium(d) { 
    jsonStore.writeImmediate('server-premium', d).catch((err) => {
        log.error(`[PremiumManager] Error saving server premium:`, err.message || err);
    });
}

/* ─────────────────────── Key Generation ─────────────────────── */

function generateKey() {
    return Array.from({ length: 4 }, () =>
        crypto.randomBytes(2).toString('hex').toUpperCase()
    ).join('-');
}

/* ─────────────────────── Key Management ─────────────────────── */

function createKey(duration = null, type = 'user') {
    // Server keys are discontinued — every generated key is a user key.
    type = 'user';
    const now = new Date();
    const keyData = {
        key: generateKey(),
        type,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + KEY_LIFETIME_MS).toISOString(),
        duration,
        redeemed: false,
        redeemedBy: null,
        redeemedAt: null,
        guildId: null
    };

    const keys = loadKeys();
    keys.push(keyData);
    saveKeys(keys);
    return keyData;
}

function isKeyExpired(keyData) {
    if (keyData.redeemed) return false;
    if (!keyData.expiresAt) {
        if (!keyData.createdAt) return true;
        return new Date(keyData.createdAt).getTime() + KEY_LIFETIME_MS < Date.now();
    }
    return new Date(keyData.expiresAt) < new Date();
}

function redeemKey(userId, keyCode) {
    const keys = loadKeys();
    const keyData = keys.find(k => k.key === keyCode.toUpperCase());

    if (!keyData) return { success: false, message: 'Invalid key.' };
    if (keyData.type === 'server') return { success: false, message: 'This is a **server premium key**. Use `redeemserverkey` in a server to activate.' };
    if (keyData.redeemed) return { success: false, message: 'This key has already been redeemed.' };
    if (isKeyExpired(keyData)) return { success: false, message: 'This key has expired. Keys must be redeemed within 24 hours of creation.' };

    keyData.redeemed = true;
    keyData.redeemedBy = userId;
    keyData.redeemedAt = new Date().toISOString();
    saveKeys(keys);

    const expiresAt = grantPremium(userId, keyData.duration, keyCode.toUpperCase());

    return { success: true, message: 'Key redeemed successfully!', duration: keyData.duration, expiresAt };
}

function redeemServerKey(_guildId, _userId, _keyCode) {
    // Server premium is discontinued — only user premium exists now.
    return {
        success: false,
        message: 'Server premium has been discontinued. Premium is now **per-user** — redeem a user key with `redeemkey <key>` to get premium for yourself.'
    };
}

function deleteKey(keyCode) {
    const keys = loadKeys();
    const before = keys.length;
    const filtered = keys.filter(k => k.key !== keyCode.toUpperCase());

    if (filtered.length === before) return { success: false, message: 'Key not found.' };

    saveKeys(filtered);
    return { success: true, message: 'Key deleted successfully.' };
}

function listKeys(filter = 'all') {
    const keys = loadKeys();
    switch (filter) {
        case 'active':  return keys.filter(k => !k.redeemed && !isKeyExpired(k));
        case 'redeemed': return keys.filter(k => k.redeemed);
        case 'expired':  return keys.filter(k => !k.redeemed && isKeyExpired(k));
        default: return keys;
    }
}

/* ─────────────────────── Premium Subscriptions ─────────────────────── */

function grantPremium(userId, duration, keyCode = 'DIRECT_GRANT') {
    const premiumData = loadPremiumData();
    const existing = premiumData.find(p => p.userId === userId);
    const now = new Date();

    let expiresAt = null;
    if (duration) {
        expiresAt = new Date(now.getTime() + duration * 86_400_000).toISOString();
    }

    if (existing) {
        if (duration === null) {
            existing.expiresAt = null;
        } else if (existing.expiresAt === null) {
            // Already permanent
        } else {
            const base = new Date(Math.max(new Date(existing.expiresAt).getTime(), now.getTime()));
            base.setDate(base.getDate() + duration);
            existing.expiresAt = base.toISOString();
        }
        existing.keyUsed = keyCode;
        existing.activatedAt = now.toISOString();
        existing.updatedAt = now.toISOString();
        expiresAt = existing.expiresAt;
    } else {
        premiumData.push({
            userId,
            activatedAt: now.toISOString(),
            expiresAt,
            keyUsed: keyCode,
            updatedAt: now.toISOString()
        });
    }

    savePremiumData(premiumData);

    // ── Optional audit webhook (env-gated) ──
    const premiumWebhook = process.env.PREMIUM_AUDIT_WEBHOOK;
    if (premiumWebhook) {
        try {
            const durationText = duration === null ? '♾️ Permanent' : `${duration} day${duration !== 1 ? 's' : ''}`;
            const expiresText = expiresAt ? `<t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:R>` : '`Never`';
            const premiumEmbed = {
                title: '👑  User Premium Activated',
                color: 0xF1C40F,
                fields: [
                    { name: '👤 User ID', value: `\`${userId}\` (<@${userId}>)`, inline: false },
                    { name: '⏱️ Duration', value: `\`${durationText}\``, inline: true },
                    { name: '📅 Expires', value: expiresText, inline: true },
                    { name: '🔑 Key Used', value: `\`${keyCode}\``, inline: true },
                    { name: '🔄 Type', value: existing ? '`Extended/Renewed`' : '`New Activation`', inline: true },
                ],
                footer: { text: 'Premium System • User Premium' },
                timestamp: new Date().toISOString()
            };
            fetch(premiumWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'Premium System', embeds: [premiumEmbed] })
            }).catch(() => {});
        } catch (_) {}
    }

    return expiresAt;
}

function addPremiumDirect(userId, duration = null) {
    const expiresAt = grantPremium(userId, duration, 'DIRECT_GRANT');
    return { success: true, message: 'Premium added successfully!', duration, expiresAt };
}

function removePremium(userId) {
    const premiumData = loadPremiumData();
    const index = premiumData.findIndex(p => p.userId === userId);

    if (index === -1) return { success: false, message: 'User does not have premium.' };

    premiumData.splice(index, 1);
    savePremiumData(premiumData);
    return { success: true, message: 'Premium removed successfully.' };
}

/* ─────────────────────── Server Premium ─────────────────────── */

function grantServerPremium(guildId, duration, keyCode = 'DIRECT_GRANT', activatedBy = null) {
    const serverData = loadServerPremium();
    const existing = serverData.find(s => s.guildId === guildId);
    const now = new Date();

    let expiresAt = null;
    if (duration) {
        expiresAt = new Date(now.getTime() + duration * 86_400_000).toISOString();
    }

    if (existing) {
        if (duration === null) {
            existing.expiresAt = null;
        } else if (existing.expiresAt === null) {
            // Already permanent
        } else {
            const base = new Date(Math.max(new Date(existing.expiresAt).getTime(), now.getTime()));
            base.setDate(base.getDate() + duration);
            existing.expiresAt = base.toISOString();
        }
        existing.keyUsed = keyCode;
        existing.activatedAt = now.toISOString();
        existing.updatedAt = now.toISOString();
        if (activatedBy) existing.activatedBy = activatedBy;
        expiresAt = existing.expiresAt;
    } else {
        serverData.push({
            guildId,
            activatedAt: now.toISOString(),
            expiresAt,
            keyUsed: keyCode,
            activatedBy,
            updatedAt: now.toISOString()
        });
    }

    saveServerPremium(serverData);

    // ── Optional audit webhook (env-gated) ──
    const premiumWebhook = process.env.PREMIUM_AUDIT_WEBHOOK;
    if (premiumWebhook) {
        try {
            const durationText = duration === null ? '♾️ Permanent' : `${duration} day${duration !== 1 ? 's' : ''}`;
            const expiresText = expiresAt ? `<t:${Math.floor(new Date(expiresAt).getTime() / 1000)}:R>` : '`Never`';
            const serverPremEmbed = {
                title: '<:Sketch:1521228025365004471>  Server Premium Activated',
                color: 0x9B59B6,
                fields: [
                    { name: '🏷️ Server ID', value: `\`${guildId}\``, inline: true },
                    { name: '👤 Activated By', value: activatedBy ? `<@${activatedBy}>` : '`System/Owner`', inline: true },
                    { name: '⏱️ Duration', value: `\`${durationText}\``, inline: true },
                    { name: '📅 Expires', value: expiresText, inline: true },
                    { name: '🔑 Key Used', value: `\`${keyCode}\``, inline: true },
                    { name: '🔄 Type', value: existing ? '`Extended/Renewed`' : '`New Activation`', inline: true },
                ],
                footer: { text: 'Premium System • Server Premium' },
                timestamp: new Date().toISOString()
            };
            fetch(premiumWebhook, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'Premium System', embeds: [serverPremEmbed] })
            }).catch(() => {});
        } catch (_) {}
    }

    return expiresAt;
}

function addServerPremiumDirect(_guildId, _duration = null, _activatedBy = null) {
    // Server premium is discontinued — premium is per-user only.
    return { success: false, message: 'Server premium has been discontinued. Use user premium instead (`addpremium` / `genkey`).' };
}

function removeServerPremium(guildId) {
    const serverData = loadServerPremium();
    const index = serverData.findIndex(s => s.guildId === guildId);

    if (index === -1) return { success: false, message: 'Server does not have premium.' };

    serverData.splice(index, 1);
    saveServerPremium(serverData);
    return { success: true, message: 'Server premium removed.' };
}

// ── Server premium: DISCONTINUED ────────────────────────────────────────────
// Premium is now strictly per-user. These functions are retained as safe
// stubs so existing call sites never crash, but server premium grants nothing.
function isServerPremium(_guildId) {
    return false;
}

function getServerPremiumStatus(_guildId) {
    return { isPremium: false, discontinued: true };
}

/* ─────────────────────── Queries ─────────────────────── */

function isPremium(userId) {
    const premiumData = loadPremiumData();
    const entry = premiumData.find(p => p.userId === userId);
    if (!entry) return false;
    if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) return false;
    return true;
}

function hasPremiumAccess(userId, guildId = null) {
    // Premium is now PER-USER only. Server premium has been discontinued —
    // the guildId parameter is kept for call-site compatibility but ignored.
    const { isOwner } = require('./helpers');
    if (isOwner(userId)) return true;
    return isPremium(userId);
}

function getPremiumStatus(userId) {
    const premiumData = loadPremiumData();
    const entry = premiumData.find(p => p.userId === userId);

    if (!entry) return { isPremium: false };

    const active = entry.expiresAt ? new Date(entry.expiresAt) > new Date() : true;

    return {
        isPremium: active,
        activatedAt: entry.activatedAt,
        expiresAt: entry.expiresAt,
        keyUsed: entry.keyUsed
    };
}

/* ─────────────────────── Statistics ─────────────────────── */

function getStats() {
    const keys = loadKeys();
    const premiumData = loadPremiumData();
    const serverData = loadServerPremium();
    const now = new Date();

    const activeKeys = keys.filter(k => !k.redeemed && !isKeyExpired(k));
    const redeemedKeys = keys.filter(k => k.redeemed);
    const expiredKeys = keys.filter(k => !k.redeemed && isKeyExpired(k));

    const activeUsers = premiumData.filter(p => !p.expiresAt || new Date(p.expiresAt) > now);
    const permanentUsers = activeUsers.filter(p => !p.expiresAt);
    const timedUsers = activeUsers.filter(p => p.expiresAt);
    const expiredUsers = premiumData.filter(p => p.expiresAt && new Date(p.expiresAt) <= now);

    const activeServers = serverData.filter(s => !s.expiresAt || new Date(s.expiresAt) > now);
    const expiredServers = serverData.filter(s => s.expiresAt && new Date(s.expiresAt) <= now);

    let soonestUserExpiry = null;
    for (const p of timedUsers) {
        if (!soonestUserExpiry || new Date(p.expiresAt) < new Date(soonestUserExpiry.expiresAt)) {
            soonestUserExpiry = p;
        }
    }
    const timedServers = activeServers.filter(s => s.expiresAt);
    let soonestServerExpiry = null;
    for (const s of timedServers) {
        if (!soonestServerExpiry || new Date(s.expiresAt) < new Date(soonestServerExpiry.expiresAt)) {
            soonestServerExpiry = s;
        }
    }

    return {
        keys: { total: keys.length, active: activeKeys.length, redeemed: redeemedKeys.length, expired: expiredKeys.length },
        users: { total: premiumData.length, active: activeUsers.length, permanent: permanentUsers.length, timed: timedUsers.length, expired: expiredUsers.length, soonestExpiry: soonestUserExpiry },
        servers: { total: serverData.length, active: activeServers.length, expired: expiredServers.length, soonestExpiry: soonestServerExpiry }
    };
}

function transferPremium(fromUserId, toUserId) {
    const premiumData = loadPremiumData();
    const fromIndex = premiumData.findIndex(p => p.userId === fromUserId);

    if (fromIndex === -1) return { success: false, message: 'Source user does not have premium.' };

    const fromEntry = premiumData[fromIndex];

    if (fromEntry.expiresAt && new Date(fromEntry.expiresAt) < new Date()) {
        return { success: false, message: 'Source user\'s premium has expired.' };
    }

    let remainingDuration = null;
    if (fromEntry.expiresAt) {
        const remaining = new Date(fromEntry.expiresAt).getTime() - Date.now();
        remainingDuration = Math.max(1, Math.ceil(remaining / 86_400_000));
    }

    const expiresAt = grantPremium(toUserId, remainingDuration, 'TRANSFER');

    const freshData = loadPremiumData();
    const freshIndex = freshData.findIndex(p => p.userId === fromUserId);
    if (freshIndex !== -1) {
        freshData.splice(freshIndex, 1);
        savePremiumData(freshData);
    }

    return { success: true, message: 'Premium transferred successfully!', duration: remainingDuration, expiresAt };
}

function getActivePremiumUsers() {
    const premiumData = loadPremiumData();
    const now = new Date();
    return premiumData.filter(p => !p.expiresAt || new Date(p.expiresAt) > now);
}

function getActivePremiumServers() {
    const serverData = loadServerPremium();
    const now = new Date();
    return serverData.filter(s => !s.expiresAt || new Date(s.expiresAt) > now);
}

/* ─────────────────────── Cleanup ─────────────────────── */

function runCleanup(badgeManager = null) {
    const now = new Date();
    let expiredKeys = 0;
    let expiredPremiums = 0;

    const keys = loadKeys();
    let staleRedeemed = 0;
    const validKeys = keys.filter(k => {
        if (!k.redeemed && k.expiresAt && new Date(k.expiresAt) < now) {
            expiredKeys++;
            return false;
        }
        if (k.redeemed && k.redeemedAt && (now.getTime() - new Date(k.redeemedAt).getTime()) > REDEEMED_KEY_RETENTION_MS) {
            staleRedeemed++;
            return false;
        }
        return true;
    });
    if (expiredKeys > 0 || staleRedeemed > 0) saveKeys(validKeys);

    const premiumData = loadPremiumData();
    const activePremiums = premiumData.filter(entry => {
        if (entry.expiresAt && new Date(entry.expiresAt) < now) {
            expiredPremiums++;
            if (badgeManager) {
                badgeManager.removeBadgeFromUser(entry.userId, 'premium').catch(() => {});
            }
            return false;
        }
        return true;
    });
    if (expiredPremiums > 0) savePremiumData(activePremiums);

    let expiredServerPremiums = 0;
    const serverData = loadServerPremium();
    const activeServers = serverData.filter(entry => {
        if (entry.expiresAt && new Date(entry.expiresAt) < now) {
            expiredServerPremiums++;
            return false;
        }
        return true;
    });
    if (expiredServerPremiums > 0) saveServerPremium(activeServers);

    if (expiredKeys > 0 || staleRedeemed > 0 || expiredPremiums > 0 || expiredServerPremiums > 0) {
        log.info(`[PremiumManager] Cleanup: ${expiredKeys} expired key(s), ${staleRedeemed} stale redeemed key(s), ${expiredPremiums} expired user sub(s), ${expiredServerPremiums} expired server sub(s) removed.`);
    }

    return { expiredKeys, staleRedeemed, expiredPremiums, expiredServerPremiums };
}

/* ─────────────────────── Reload & Sync ─────────────────────── */

/**
 * Reload premium data from PostgreSQL into the in-memory cache.
 * Fixes stale cache issues without restarting the bot.
 */
async function reloadPremiumData() {
    const refreshed = await jsonStore.refresh('premium', 'premium-keys', 'server-premium');
    log.info(`[PremiumManager] Reloaded premium stores from database (${refreshed} refreshed)`);
    return refreshed;
}

/**
 * Sync premium badges for all active premium users.
 * Ensures every active premium user has their badge granted.
 */
async function syncPremiumBadges(badgeManager) {
    if (!badgeManager) return { synced: 0, failed: 0 };

    const activeUsers = getActivePremiumUsers();
    let synced = 0;
    let failed = 0;

    for (const user of activeUsers) {
        try {
            await badgeManager.addBadgeToUser(user.userId, 'premium');
            synced++;
        } catch {
            failed++;
        }
    }

    log.info(`[PremiumManager] Badge sync: ${synced} synced, ${failed} failed out of ${activeUsers.length} active users`);
    return { synced, failed, total: activeUsers.length };
}

/* ─────────────────────── Exports ─────────────────────── */

module.exports = {
    createKey,
    redeemKey,
    redeemServerKey,
    deleteKey,
    listKeys,
    generateKey,
    isKeyExpired,

    addPremiumDirect,
    removePremium,

    addServerPremiumDirect,
    removeServerPremium,
    isServerPremium,
    getServerPremiumStatus,
    grantServerPremium,

    isPremium,
    hasPremiumAccess,
    getPremiumStatus,
    getActivePremiumUsers,
    getActivePremiumServers,

    getStats,
    transferPremium,

    runCleanup,
    reloadPremiumData,
    syncPremiumBadges,

    KEY_LIFETIME_MS
};
