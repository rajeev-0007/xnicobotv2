/**
 * musicHelpers.js — Shared, side-effect-free helpers used by every command
 * in commands/music/. Centralizes the half-dozen "must be in same VC as bot",
 * "is DJ?", "format time", "platform string for voice status" patterns that
 * were copy-pasted (and slightly inconsistent) across 40+ files.
 */

const jsonStore = require('./jsonStore');

/**
 * Voice channel guard. Returns one of:
 *   { ok: true }                                   — caller may proceed
 *   { ok: false, reason: 'no-voice'  | 'wrong-vc' } — caller must reply
 *
 * Caller is responsible for sending the appropriate error response so the
 * helper stays decoupled from discord.js and the response builder.
 */
function checkVoice(member, player) {
    if (!member?.voice?.channel) return { ok: false, reason: 'no-voice' };
    if (player && player.voiceChannelId && member.voice.channelId !== player.voiceChannelId) {
        return { ok: false, reason: 'wrong-vc' };
    }
    return { ok: true };
}

/** Convenience wrapper: returns null if everything is OK, otherwise a message. */
function voiceErrorMessage(member, player) {
    const v = checkVoice(member, player);
    if (v.ok) return null;
    if (v.reason === 'no-voice') return 'You need to be in a voice channel.';
    if (v.reason === 'wrong-vc') return 'You need to be in the same voice channel as the bot.';
    return null;
}

/**
 * DJ permission check. A user is "DJ" if any of these is true:
 *   - guild owner
 *   - has Administrator
 *   - has the configured DJ role (music.djRoleId)
 *   - is alone in the voice channel with the bot
 *   - voteSkip is disabled and DJ enforcement is off
 */
function isDJ(member, player) {
    if (!member) return false;
    try {
        if (member.guild.ownerId === member.id) return true;
        // Administrator perm — discord.js v14
        if (member.permissions?.has?.('Administrator')) return true;

        const settings = readMusicSettings(member.guild.id);
        const djRoleId = settings.djRoleId;
        if (!djRoleId) return true; // No DJ role configured — everyone is a DJ
        if (member.roles?.cache?.has(djRoleId)) return true;

        // Alone with the bot? lock-step DJ.
        if (player) {
            const vc = member.guild.channels.cache.get(player.voiceChannelId);
            const human = vc?.members?.filter(m => !m.user.bot)?.size || 0;
            if (human <= 1) return true;
        }
    } catch {}
    return false;
}

function readMusicSettings(guildId) {
    try {
        if (!jsonStore.has('music')) return {};
        const all = jsonStore.read('music');
        return all?.[guildId] || {};
    } catch { return {}; }
}

/**
 * Format milliseconds as h:mm:ss or m:ss. Same output as helpers.formatTime
 * but exposed here so command files don't need to import from two places.
 */
function formatTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / 60000) % 60);
    const hours   = Math.floor(ms / 3600000);
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Parse a human time string into milliseconds.
 *   "90"        →  90 000   (plain seconds)
 *   "1:30"      →  90 000   (m:ss)
 *   "1:02:30"   →  3 750 000 (h:mm:ss)
 *   "1m30s"     →  90 000
 *   "2h"        →  7 200 000
 * Returns `null` for anything unparseable.
 */
function parseTime(input) {
    if (input == null) return null;
    const s = String(input).trim();
    if (!s) return null;

    // Plain numeric — interpret as seconds.
    if (/^\d+$/.test(s)) return Number(s) * 1000;

    // Colon-delimited h:m:s / m:s.
    if (s.includes(':')) {
        const parts = s.split(':').map(p => p.trim());
        if (parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return null;
        const nums = parts.map(Number);
        if (nums.length === 2) return (nums[0] * 60 + nums[1]) * 1000;
        if (nums.length === 3) return (nums[0] * 3600 + nums[1] * 60 + nums[2]) * 1000;
        return null;
    }

    // Suffix form: 1h2m3s
    const re = /(\d+(?:\.\d+)?)([hms])/gi;
    let total = 0;
    let matched = false;
    let m;
    while ((m = re.exec(s)) !== null) {
        matched = true;
        const value = Number(m[1]);
        const unit = m[2].toLowerCase();
        if (unit === 'h') total += value * 3600;
        else if (unit === 'm') total += value * 60;
        else if (unit === 's') total += value;
    }
    if (matched) return Math.round(total * 1000);

    return null;
}

/**
 * Voice-channel-status (/channels/:id/voice-status) cannot render custom
 * guild emoji. Map our internal platform key to a Unicode glyph that
 * actually shows up in the VC sidebar.
 */
function voiceStatusGlyph(sourceName) {
    const s = (sourceName || '').toLowerCase();
    if (s.includes('youtube'))    return '▶️';
    if (s.includes('spotify'))    return '🟢';
    if (s.includes('soundcloud')) return '🟠';
    if (s.includes('apple'))      return '🍎';
    if (s.includes('deezer'))     return '🎵';
    return '🎶';
}

/**
 * Cycle through repeat modes used by the panel + /loop with no args.
 * Returns the next mode in the cycle.
 */
function nextLoopMode(current) {
    const order = ['off', 'track', 'queue'];
    const i = order.indexOf(current);
    return order[(i + 1) % order.length];
}

/**
 * Toggle a lavalink-client filter cleanly. Returns the new state (true=on).
 * For filters that take an object (rotation, karaoke, tremolo, vibrato,
 * distortion), pass the desired payload as `enableData`. The function
 * inspects `player.filterManager.filters[name]` to decide whether to
 * enable or disable.
 *
 * Disable path uses lavalink-client's built-in setters with `null` /
 * empty object which clear the filter cleanly.
 */
async function toggleFilter(player, name, enableData) {
    if (!player?.filterManager) return false;
    const fm = player.filterManager;
    const isOn = !!fm.filters?.[name];
    if (isOn) {
        // Disable
        if (typeof fm[`set${capitalize(name)}`] === 'function') {
            await fm[`set${capitalize(name)}`](null).catch(() => {});
        } else {
            fm.filters[name] = false;
            if (fm.data && name in fm.data) delete fm.data[name];
            await fm.applyPlayerFilters().catch(() => {});
        }
        return false;
    }
    // Enable
    if (typeof fm[`set${capitalize(name)}`] === 'function') {
        await fm[`set${capitalize(name)}`](enableData).catch(() => {});
    } else {
        fm.data = fm.data || {};
        fm.data[name] = enableData;
        fm.filters[name] = true;
        await fm.applyPlayerFilters().catch(() => {});
    }
    return true;
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * Build an EQ payload that always covers all 15 bands. Lavalink/Lavalink-client
 * leaves untouched bands at their previous gain — passing only 5 bands left
 * stale gain on the other 10. Always send all 15.
 */
function buildEQ(presetMap) {
    const bands = [];
    for (let i = 0; i < 15; i++) {
        bands.push({ band: i, gain: presetMap[i] || 0 });
    }
    return bands;
}

/**
 * Reset every timescale-affecting filter (nightcore, vaporwave, china, etc.)
 * back to 1.0/1.0/1.0. Use before applying a new timescale preset so they
 * don't stack.
 */
async function resetTimescale(player) {
    try {
        await player?.filterManager?.setTimescale?.({ speed: 1.0, pitch: 1.0, rate: 1.0 });
    } catch {}
}

module.exports = {
    checkVoice,
    voiceErrorMessage,
    isDJ,
    readMusicSettings,
    formatTime,
    parseTime,
    voiceStatusGlyph,
    nextLoopMode,
    toggleFilter,
    buildEQ,
    resetTimescale,
};
