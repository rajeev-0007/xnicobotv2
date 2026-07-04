/**
 * BadgeManager — single source of truth for the bot's badge catalog.
 *
 * ──────────────────────────────────────────────────────────────────
 * Architecture (post v2)
 * ──────────────────────────────────────────────────────────────────
 *  - The badge catalog is hardcoded in `DEFAULT_BADGES` below. There
 *    is no longer a `custom-badges` store; users cannot create new
 *    badges. This keeps the catalog consistent across restarts and
 *    avoids the "I edited the badge but it didn't update" bug — the
 *    old code seeded defaults into a JSON store, then never
 *    overwrote them on subsequent boots.
 *  - Each default has a `position` integer. `getUserBadges` returns
 *    badges sorted by `position` ascending so the display order is
 *    deterministic for both `/badges` and the profile panel.
 *  - User-to-badge assignments live in `jsonStore`'s `user-badges`
 *    store: `{ [userId]: badgeId[] }`. We sweep orphaned ids
 *    (badges that no longer exist in DEFAULT_BADGES) on startup so
 *    the user view never shows ghosts.
 *
 * ──────────────────────────────────────────────────────────────────
 * Migration on startup
 * ──────────────────────────────────────────────────────────────────
 * `initializeDefaultBadges()` is the one-shot called by index.js and
 * by the top.gg vote webhook. It:
 *   1. Deletes the legacy `custom-badges` store if it exists. The
 *      data was never the source of truth post-refactor — the new
 *      catalog lives in code.
 *   2. Walks `user-badges` and removes any badge ID no longer in
 *      DEFAULT_BADGES. This silently cleans up after badges that
 *      used to exist (e.g. user-created ones from the old system).
 *
 * ──────────────────────────────────────────────────────────────────
 * Adding / editing badges
 * ──────────────────────────────────────────────────────────────────
 * Edit DEFAULT_BADGES below. Restart the bot. That's it. No JSON
 * stores to clear, no migrations to run.
 */

'use strict';

const jsonStore = require('./jsonStore');
const fs = require('fs');
const path = require('path');
const log = require('./logger-styled');

/**
 * The badge catalog. Order in this array is the display order — but
 * we also stamp explicit `position` numbers (10, 20, 30…) so
 * `getUserBadges` can sort even if the array gets reordered later.
 *
 * To add a badge: insert it at the desired position and update the
 * surrounding positions. The 10-spaced layout leaves room to slot
 * new entries without renumbering everything.
 */
const DEFAULT_BADGES = Object.freeze([
    {
        position:    10,
        badgeId:     'owner',
        name:        'Owner',
        emoji:       '<:Crown:1521227739988889764>',
        description: 'Bot owner',
        color:       '#bcf1e4',
        imageUrl:    null
    },
    {
        position:    20,
        badgeId:     'dev',
        name:        'Developer',
        emoji:       '<:developer:1521228209096622202>',
        description: 'Development team',
        color:       '#bcf1e4',
        imageUrl:    null
    },
    {
        position:    30,
        badgeId:     'staff',
        name:        'Staff',
        emoji:       '<:gmod:1521228397194379439>',
        description: 'Staff team',
        color:       '#bcf1e4',
        imageUrl:    null
    },
    {
        position:    40,
        badgeId:     'partner',
        name:        'Partnership',
        emoji:       '<:PartnerServer:1521228403414667325>',
        description: 'Partnered member',
        color:       '#bcf1e4',
        imageUrl:    null
    },
    {
        position:    50,
        badgeId:     'premium',
        name:        'Premium',
        emoji:       '<:Sketch:1521228025365004471>',
        description: 'Premium supporter',
        color:       '#00ffff',
        imageUrl:    null
    },
    {
        position:    60,
        badgeId:     'verifieduser',
        name:        'Verified',
        emoji:       '<:Checkedbox:1521227734943269077>',
        description: 'Verified member',
        color:       '#bcf1e4',
        imageUrl:    null
    },
    {
        position:    70,
        badgeId:     'contributor',
        name:        'Contributor',
        emoji:       '<:Bookmark:1521227835526742066>',
        description: 'Contributed to the community',
        color:       '#06ffa5',
        imageUrl:    null
    },
    {
        position:    80,
        badgeId:     'goldenbug',
        name:        'Golden Bug Hunter',
        emoji:       '<:bug2_golden:1521228408745365504>',
        description: 'Found a critical bug',
        color:       '#bcf1e4',
        imageUrl:    null
    },
    {
        position:    90,
        badgeId:     'bug',
        name:        'Bug Hunter',
        emoji:       '<:bug1_rookie:1521228414349217913>',
        description: 'Reported a bug',
        color:       '#bcf1e4',
        imageUrl:    null
    },
    {
        position:    100,
        badgeId:     'nico',
        name:        'OG xNico User',
        emoji:       '<:xnico:1521228240440660180>',
        description: 'An OG regular user',
        color:       '#bcf1e4',
        imageUrl:    null
    },
    {
        position:    110,
        badgeId:     'voter',
        name:        'Voter',
        emoji:       '<:Award:1521228119640375336>',
        description: 'Voted for the bot on top.gg',
        color:       '#3ba55d',
        imageUrl:    null
    }
]);

const BADGE_BY_ID = new Map(DEFAULT_BADGES.map(b => [b.badgeId, b]));

const CUSTOM_BADGE_STORE = 'custom-badges';

function readCustomBadges() {
    try {
        if (!jsonStore.has(CUSTOM_BADGE_STORE)) return [];
        const raw = jsonStore.read(CUSTOM_BADGE_STORE);
        if (Array.isArray(raw)) return raw;
        if (raw && typeof raw === 'object') return Object.values(raw);
        return [];
    } catch { return []; }
}

function writeCustomBadges(arr) {
    try { jsonStore.write(CUSTOM_BADGE_STORE, Array.isArray(arr) ? arr : []); }
    catch (e) { log.error('[Badges] failed to write custom-badges:', e?.message); }
}

class BadgeManager {
    constructor() {
        this.badgesPath = path.join(__dirname, '../assets/badges');
        this.ensureFiles();
    }

    ensureFiles() {
        if (!fs.existsSync(this.badgesPath)) {
            fs.mkdirSync(this.badgesPath, { recursive: true });
        }
    }

    // ── Catalog access ──────────────────────────────────────────────

    /**
     * Build the in-memory catalog as defaults + persisted custom
     * badges. Custom badges are positioned after defaults but each
     * entry's stored `position` is honored when sorting.
     */
    _fullCatalog() {
        const customs = readCustomBadges()
            .filter(b => b && typeof b === 'object' && typeof b.badgeId === 'string')
            // drop overrides of default badge ids; defaults always win
            .filter(b => !BADGE_BY_ID.has(b.badgeId.toLowerCase()))
            .map(b => ({
                position:    Number.isFinite(b.position) ? b.position : 1000,
                badgeId:     b.badgeId.toLowerCase(),
                name:        String(b.name || b.badgeId),
                emoji:       b.emoji || '<:Award:1521228119640375336>',
                description: String(b.description || ''),
                color:       b.color || '#bcf1e4',
                imageUrl:    b.imageUrl || null,
                custom:      true,
            }));
        const all = [...DEFAULT_BADGES.map(b => ({ ...b })), ...customs];
        all.sort((a, b) => a.position - b.position);
        return all;
    }

    _lookupAny(badgeId) {
        if (typeof badgeId !== 'string') return null;
        const id = badgeId.toLowerCase();
        const def = BADGE_BY_ID.get(id);
        if (def) return { ...def };
        const c = readCustomBadges().find(b => b?.badgeId?.toLowerCase() === id);
        if (c) return { ...c, custom: true };
        return null;
    }

    /**
     * Whole catalog, sorted by position ascending.
     */
    getCatalog() {
        return this._fullCatalog();
    }

    /**
     * Look up a single badge definition by ID. Returns a clone so
     * callers can't accidentally mutate the frozen catalog.
     */
    getBadge(badgeId) {
        return this._lookupAny(badgeId);
    }

    /**
     * Returns true if the given badgeId exists in the catalog (default
     * or custom).
     */
    isDefaultBadge(badgeId) {
        if (typeof badgeId !== 'string') return false;
        const id = badgeId.toLowerCase();
        if (BADGE_BY_ID.has(id)) return true;
        return readCustomBadges().some(b => b?.badgeId?.toLowerCase() === id);
    }

    // ── User-badge store ────────────────────────────────────────────

    readUserBadges() {
        const data = jsonStore.read('user-badges');
        if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
        return data;
    }

    writeUserBadges(userBadges) {
        jsonStore.write('user-badges', userBadges);
    }

    /**
     * Boot-time housekeeping:
     *   1. Sweep `user-badges` for orphan ids that aren't in the
     *      current catalog (defaults + custom) and persist the
     *      cleanup if anything changed.
     *   2. Custom badges are loaded from the `custom-badges` store
     *      lazily via `_lookupAny` / `_fullCatalog`, so we just need
     *      to keep that store healthy here (drop entries with
     *      missing/invalid fields).
     */
    async initializeDefaultBadges() {
        try {
            // 1. Tidy custom-badges store: drop malformed rows.
            const customs = readCustomBadges();
            const cleaned = customs.filter(b =>
                b && typeof b === 'object' &&
                typeof b.badgeId === 'string' && b.badgeId.length > 0 &&
                !BADGE_BY_ID.has(b.badgeId.toLowerCase()) // never shadow defaults
            );
            if (cleaned.length !== customs.length) {
                writeCustomBadges(cleaned);
                log.info(`[Badges] Removed ${customs.length - cleaned.length} malformed custom badge row(s).`);
            }

            // 2. Sweep orphan user-badge entries.
            const validIds = new Set([
                ...BADGE_BY_ID.keys(),
                ...cleaned.map(b => b.badgeId.toLowerCase())
            ]);

            const userBadges = this.readUserBadges();
            let dirty = false;
            let orphaned = 0;
            for (const userId of Object.keys(userBadges)) {
                const list = Array.isArray(userBadges[userId]) ? userBadges[userId] : [];
                const filtered = list.filter(id => validIds.has(id));
                const deduped = [...new Set(filtered)];
                if (deduped.length !== list.length) {
                    orphaned += list.length - deduped.length;
                    userBadges[userId] = deduped;
                    dirty = true;
                }
            }
            if (dirty) {
                this.writeUserBadges(userBadges);
                log.info(`[Badges] Cleaned ${orphaned} orphan/duplicate badge id(s) from user-badges store.`);
            }
            return true;
        } catch (error) {
            log.error('Error initializing badges:', error);
            return false;
        }
    }

    /**
     * Returns the user's owned badge definitions, sorted by `position`
     * ascending. Unknown ids in storage are silently dropped so the UI
     * never renders ghost badges.
     */
    async getUserBadges(userId) {
        try {
            if (!userId) return [];
            const userBadges = this.readUserBadges();
            const ids = Array.isArray(userBadges[userId]) ? userBadges[userId] : [];
            if (ids.length === 0) return [];

            const customMap = new Map(readCustomBadges()
                .filter(b => b && typeof b === 'object' && typeof b.badgeId === 'string')
                .map(b => [b.badgeId.toLowerCase(), b]));

            const badges = [];
            for (const id of ids) {
                const def = BADGE_BY_ID.get(id);
                if (def) { badges.push({ ...def }); continue; }
                const c = customMap.get(id);
                if (c) badges.push({ ...c, custom: true });
            }
            badges.sort((a, b) => (a.position ?? 1000) - (b.position ?? 1000));
            return badges;
        } catch (error) {
            log.error('Error getting user badges:', error);
            return [];
        }
    }

    async addBadgeToUser(userId, badgeId) {
        try {
            if (!userId || typeof userId !== 'string') {
                return { success: false, message: 'A valid user ID is required.' };
            }
            if (!badgeId || typeof badgeId !== 'string') {
                return { success: false, message: 'A valid badge ID is required.' };
            }

            const id = badgeId.toLowerCase();
            const badge = this._lookupAny(id);
            if (!badge) {
                return { success: false, message: 'Badge not found' };
            }

            const userBadges = this.readUserBadges();
            if (!userBadges[userId]) userBadges[userId] = [];

            if (userBadges[userId].includes(id)) {
                return { success: false, message: 'User already has this badge' };
            }

            userBadges[userId].push(id);
            this.writeUserBadges(userBadges);

            return { success: true, badge: { ...badge }, totalBadges: userBadges[userId].length };
        } catch (error) {
            log.error('Error adding badge to user:', error);
            return { success: false, message: 'Error adding badge' };
        }
    }

    async removeBadgeFromUser(userId, badgeId) {
        try {
            if (!userId || typeof userId !== 'string') {
                return { success: false, message: 'A valid user ID is required.' };
            }
            const id = String(badgeId || '').toLowerCase();
            const userBadges = this.readUserBadges();
            if (!userBadges[userId] || !userBadges[userId].includes(id)) {
                return { success: false, message: 'User does not have this badge' };
            }

            userBadges[userId] = userBadges[userId].filter(b => b !== id);
            this.writeUserBadges(userBadges);

            const badge = this._lookupAny(id);
            return { success: true, badge: badge ? { ...badge } : null, totalBadges: userBadges[userId].length };
        } catch (error) {
            log.error('Error removing badge from user:', error);
            return { success: false, message: 'Error removing badge' };
        }
    }

    // ── Custom-badge writes (owner only) ───────────────────────────
    //
    // Owners can create / edit / delete custom badges through the
    // `badge-create`, `badge-edit`, `badge-remove` commands. Default
    // badges are immutable — the catalog edit + restart workflow is
    // still the recommended way to change anything in DEFAULT_BADGES.

    async createCustomBadge(payload) {
        try {
            if (!payload || typeof payload !== 'object') {
                return { success: false, message: 'Badge data is required.' };
            }
            const badgeId = String(payload.badgeId || '').trim().toLowerCase();
            if (!/^[a-z0-9_-]{2,32}$/.test(badgeId)) {
                return { success: false, message: 'Badge ID must be 2-32 chars: letters, digits, dash or underscore.' };
            }
            if (BADGE_BY_ID.has(badgeId)) {
                return { success: false, message: 'That badge ID is reserved by a default badge.' };
            }

            const customs = readCustomBadges();
            if (customs.some(b => b?.badgeId?.toLowerCase() === badgeId)) {
                return { success: false, message: 'A custom badge with that ID already exists.' };
            }

            const name = String(payload.name || badgeId).trim().slice(0, 50);
            const emoji = String(payload.emoji || '<:Award:1521228119640375336>').slice(0, 80);
            const description = String(payload.description || '').slice(0, 200);
            const color = typeof payload.color === 'string' && /^#?[0-9a-fA-F]{6}$/.test(payload.color)
                ? (payload.color.startsWith('#') ? payload.color : `#${payload.color}`)
                : '#bcf1e4';
            const imageUrl = typeof payload.imageUrl === 'string' && /^https?:\/\//.test(payload.imageUrl)
                ? payload.imageUrl
                : null;

            // Position custom badges after defaults; preserve insertion order.
            const maxDefault = DEFAULT_BADGES.reduce((m, b) => Math.max(m, b.position || 0), 0);
            const maxCustom  = customs.reduce((m, b) => Math.max(m, b?.position || 0), maxDefault + 100);
            const position   = Number.isFinite(payload.position) ? Number(payload.position) : (maxCustom + 10);

            const badge = { position, badgeId, name, emoji, description, color, imageUrl, custom: true, createdAt: Date.now() };
            customs.push(badge);
            writeCustomBadges(customs);

            return { success: true, badge: { ...badge } };
        } catch (error) {
            log.error('Error creating custom badge:', error);
            return { success: false, message: 'Error creating badge' };
        }
    }

    async editBadge(badgeId, patch) {
        try {
            const id = String(badgeId || '').toLowerCase();
            if (BADGE_BY_ID.has(id)) {
                return { success: false, message: 'Default badges are immutable. Edit `utils/badgeManager.js` and restart.' };
            }
            const customs = readCustomBadges();
            const idx = customs.findIndex(b => b?.badgeId?.toLowerCase() === id);
            if (idx < 0) return { success: false, message: 'Badge not found.' };

            const allowed = ['name', 'emoji', 'description', 'color', 'imageUrl', 'position'];
            for (const key of allowed) {
                if (patch && key in patch) customs[idx][key] = patch[key];
            }
            writeCustomBadges(customs);
            return { success: true, badge: { ...customs[idx], custom: true } };
        } catch (error) {
            log.error('Error editing badge:', error);
            return { success: false, message: 'Error editing badge' };
        }
    }

    async deleteBadge(badgeId) {
        try {
            const id = String(badgeId || '').toLowerCase();
            if (BADGE_BY_ID.has(id)) {
                return { success: false, message: 'Default badges cannot be deleted at runtime.' };
            }
            const customs = readCustomBadges();
            const before = customs.length;
            const filtered = customs.filter(b => b?.badgeId?.toLowerCase() !== id);
            if (filtered.length === before) {
                return { success: false, message: 'Badge not found.' };
            }
            writeCustomBadges(filtered);

            // Also strip from any user that owned it.
            const userBadges = this.readUserBadges();
            let users = 0;
            for (const userId of Object.keys(userBadges)) {
                const list = Array.isArray(userBadges[userId]) ? userBadges[userId] : [];
                if (list.includes(id)) {
                    userBadges[userId] = list.filter(b => b !== id);
                    users++;
                }
            }
            if (users > 0) this.writeUserBadges(userBadges);

            return { success: true, usersAffected: users };
        } catch (error) {
            log.error('Error deleting badge:', error);
            return { success: false, message: 'Error deleting badge' };
        }
    }

    /**
     * Whole catalog accessor for callers that previously walked
     * `custom-badges`. Returns the same shape (clones, sorted by
     * position).
     */
    async getAllBadges() {
        return this.getCatalog();
    }

    async purgeBadgeFromAllUsers(badgeId) {
        try {
            const id = String(badgeId || '').toLowerCase();
            if (!id) {
                return { success: false, usersAffected: 0, message: 'A valid badge ID is required.' };
            }
            const userBadges = this.readUserBadges();
            let affected = 0;
            for (const userId of Object.keys(userBadges)) {
                const list = Array.isArray(userBadges[userId]) ? userBadges[userId] : [];
                if (list.includes(id)) {
                    userBadges[userId] = list.filter(b => b !== id);
                    affected++;
                }
            }
            if (affected > 0) {
                this.writeUserBadges(userBadges);
            }
            return { success: true, usersAffected: affected };
        } catch (error) {
            log.error('Error purging badge from users:', error);
            return { success: false, usersAffected: 0, message: 'Error purging badge.' };
        }
    }
}

module.exports = new BadgeManager();
