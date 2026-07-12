'use strict';

/**
 * discordAssets.js — resolve a user's REAL Discord banner + avatar
 * decoration URLs in a version-robust way.
 *
 * discord.js exposes `User#bannerURL()` and `User#avatarDecorationURL()`,
 * but the exact availability/behaviour varies between builds and the raw
 * `banner` / `avatarDecorationData` fields are only populated after a
 * force-fetch. These helpers try the built-in method first and fall back
 * to constructing the CDN URL from the raw hash, so a missing method or a
 * partially-populated user never means a silently-dropped banner/decoration.
 *
 * All helpers are defensive: they never throw and return `null` when the
 * user has no banner / decoration (or the data isn't available).
 */

const CDN = 'https://cdn.discordapp.com';

/**
 * Force-fetch the full user so `banner` + `avatarDecorationData` are
 * populated (partial users from interaction options / component
 * interactions don't include them). Falls back to the passed-in user.
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').User} user
 * @returns {Promise<import('discord.js').User>}
 */
async function fetchFullUser(client, user) {
    if (!client || !user) return user;
    try {
        return await client.users.fetch(user.id, { force: true });
    } catch {
        return user;
    }
}

/**
 * Resolve the user's Discord profile banner URL (static PNG, 1024px) or
 * null when they have no banner.
 * @param {import('discord.js').User} user
 * @returns {string|null}
 */
function getBannerURL(user) {
    if (!user) return null;
    try {
        if (typeof user.bannerURL === 'function') {
            const url = user.bannerURL({ size: 1024, extension: 'png' });
            if (url) return url;
        }
    } catch { /* fall through to manual build */ }
    try {
        if (user.banner) {
            return `${CDN}/banners/${user.id}/${user.banner}.png?size=1024`;
        }
    } catch { /* no banner */ }
    return null;
}

/**
 * Resolve the user's avatar-decoration asset URL (PNG, 256px) or null
 * when they have no decoration.
 * @param {import('discord.js').User} user
 * @returns {string|null}
 */
function getAvatarDecorationURL(user) {
    if (!user) return null;
    try {
        if (typeof user.avatarDecorationURL === 'function') {
            const url = user.avatarDecorationURL();
            if (url) return url;
        }
    } catch { /* fall through to manual build */ }
    try {
        const asset = user.avatarDecorationData?.asset;
        if (asset) {
            // Canonical decoration-preset URL (the CDN ignores size params on
            // this route, so keep it plain to avoid a 404 on some assets).
            return `${CDN}/avatar-decoration-presets/${asset}.png`;
        }
    } catch { /* no decoration */ }
    return null;
}

/**
 * Convenience: force-fetch the user then resolve both assets in one call.
 * @returns {Promise<{ fullUser: import('discord.js').User, banner: string|null, decoration: string|null }>}
 */
async function resolveProfileAssets(client, user) {
    const fullUser = await fetchFullUser(client, user);
    return {
        fullUser,
        banner: getBannerURL(fullUser),
        decoration: getAvatarDecorationURL(fullUser),
    };
}

module.exports = { fetchFullUser, getBannerURL, getAvatarDecorationURL, resolveProfileAssets };
