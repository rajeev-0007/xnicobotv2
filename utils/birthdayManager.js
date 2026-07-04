'use strict';

/**
 * Birthday Manager
 * ────────────────
 * Centralized helpers for the birthday system:
 *   • Per-guild settings (channel, role, ping mode, message templates)
 *   • Per-guild user birthdays (month / day / optional year)
 *   • Daily scheduler that fires birthday wishes at the configured hour
 *
 * Storage layout (jsonStore key: `birthdays`):
 * {
 *   "<guildId>": {
 *     channelId, roleId, pingMode, messageType, messageData{},
 *     hour, timezone, enabled,
 *     panel: { channelId, messageId },
 *     users: {
 *       "<userId>": {
 *         month, day, year, setAt,
 *         lastSentYear   // year the wish last fired (prevents double-wishes)
 *       }
 *     },
 *     lastTickDay        // YYYY-MM-DD, only reset on day change
 *   }
 * }
 */

const jsonStore = require('./jsonStore');
const log = require('./logger-styled');

const STORE_KEY = 'birthdays';

const DEFAULT_TEMPLATES = {
    simple: {
        mode: 'simple',
        content:
            '🎂  Happy Birthday {user}!  🎉\n' +
            '\n' +
            'Hope your day is packed with cake, good vibes, and zero lag.\n' +
            '— With love from **{server}**',
        title: '',
        description: '',
        color: '#FF6FA3',
        image: '',
        thumbnail: '',
        footer: '',
        footerIcon: '',
        author: '',
        authorIcon: '',
        fields: []
    },
    embed: {
        mode: 'embed',
        content: '{user}',
        title: '🎂  Happy Birthday, {displayname}!',
        description:
            'Today is **{displayname}**\'s birthday!\n' +
            'Drop your warmest wishes below and make their day a little brighter.\n\n' +
            '> Wishing you a year full of wins, laughter, and good people.\n' +
            '> — From everyone at **{server}**',
        color: '#FF6FA3',
        image: '',
        thumbnail: '{useravatar}',
        footer: '{server} • Birthday Celebration',
        footerIcon: '{servericon}',
        author: '',
        authorIcon: '',
        fields: []
    },
    components: {
        mode: 'components',
        content:
            '# 🎉 Happy Birthday, {displayname}!\n' +
            '\n' +
            'It\'s **{user}**\'s special day — give them a warm welcome to another trip around the sun.\n' +
            '\n' +
            '> *Wishing you health, happiness, and a year that outshines the last.*\n' +
            '\n' +
            '— With love from **{server}** ❤️',
        title: '',
        description: '',
        color: '#FF6FA3',
        image: '',
        thumbnail: '{useravatar}',
        footer: '{server} • Birthday Celebration',
        footerIcon: '',
        author: '',
        authorIcon: '',
        fields: []
    }
};

function cloneTemplate(type) {
    const tpl = DEFAULT_TEMPLATES[type] || DEFAULT_TEMPLATES.embed;
    return JSON.parse(JSON.stringify(tpl));
}

function getDefaultGuildConfig() {
    return {
        channelId: null,
        roleId: null,
        pingMode: 'user',
        messageType: 'embed',
        messageData: cloneTemplate('embed'),
        hour: 9,
        timezone: 'UTC',
        enabled: false,
        panel: null,
        users: {},
        lastTickDay: null
    };
}

function loadAll() {
    if (!jsonStore.has(STORE_KEY)) {
        jsonStore.write(STORE_KEY, {});
        return {};
    }
    const data = jsonStore.read(STORE_KEY);
    return (data && typeof data === 'object') ? data : {};
}

function saveAll(data) {
    jsonStore.write(STORE_KEY, data);
}

function getGuildConfig(guildId) {
    const all = loadAll();
    if (!all[guildId]) return getDefaultGuildConfig();
    const cfg = { ...getDefaultGuildConfig(), ...all[guildId] };
    if (!cfg.users || typeof cfg.users !== 'object') cfg.users = {};
    if (!cfg.messageData || typeof cfg.messageData !== 'object') {
        cfg.messageData = cloneTemplate(cfg.messageType || 'embed');
    }
    return cfg;
}

function saveGuildConfig(guildId, cfg) {
    const all = loadAll();
    all[guildId] = cfg;
    saveAll(all);
}

function setUserBirthday(guildId, userId, month, day, year = null) {
    const all = loadAll();
    if (!all[guildId]) all[guildId] = getDefaultGuildConfig();
    if (!all[guildId].users) all[guildId].users = {};
    // Preserve `lastSentYear` if the user is just updating their date so the
    // scheduler doesn't re-wish them on the same day after a small edit.
    const prior = all[guildId].users[userId] || {};
    all[guildId].users[userId] = {
        month: Number(month),
        day: Number(day),
        year: year ? Number(year) : null,
        setAt: Date.now(),
        lastSentYear: prior.lastSentYear || null
    };
    saveAll(all);
    return all[guildId].users[userId];
}

function getUserBirthday(guildId, userId) {
    const cfg = getGuildConfig(guildId);
    return cfg.users?.[userId] || null;
}

function removeUserBirthday(guildId, userId) {
    const all = loadAll();
    if (all[guildId]?.users?.[userId]) {
        delete all[guildId].users[userId];
        saveAll(all);
        return true;
    }
    return false;
}

function listBirthdaysForMonthDay(guildId, month, day) {
    const cfg = getGuildConfig(guildId);
    const out = [];
    for (const [userId, entry] of Object.entries(cfg.users || {})) {
        if (entry.month === month && entry.day === day) {
            out.push({ userId, ...entry });
        }
    }
    return out;
}

// ── Date validation ─────────────────────────────────────────────────────
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Returns true if the given year is a leap year. */
function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function validateDate(month, day, year) {
    const m = Number(month);
    const d = Number(day);
    // Guard NaN values (Number('') === 0, Number(undefined) === NaN)
    if (isNaN(m) || !Number.isInteger(m) || m < 1 || m > 12)
        return 'Month must be between 1 and 12.';
    const maxDay = DAYS_IN_MONTH[m - 1];
    if (isNaN(d) || !Number.isInteger(d) || d < 1 || d > maxDay) {
        return `Day must be between 1 and ${maxDay} for ${monthName(m)}.`;
    }
    if (year !== null && year !== undefined && year !== '') {
        const y = Number(year);
        const nowY = new Date().getUTCFullYear();
        if (isNaN(y) || !Number.isInteger(y) || y < 1900 || y > nowY) {
            return `Year must be between 1900 and ${nowY}.`;
        }
        // Extra check: Feb 29 is only valid in leap years when a year is supplied
        if (m === 2 && d === 29 && !isLeapYear(y)) {
            return `${y} is not a leap year — February only has 28 days that year.`;
        }
    }
    return null;
}

function monthName(m) {
    return ['January','February','March','April','May','June','July','August','September','October','November','December'][m - 1] || '?';
}

function parseBirthdayInput(raw) {
    if (!raw) return { error: 'Date is required.' };
    // Normalise separators: dots, slashes, commas and whitespace all → dash
    const cleaned = String(raw).trim().replace(/[/.,\s]+/g, '-');
    const parts = cleaned.split('-').filter(Boolean);
    if (parts.length < 2) return { error: 'Use format `DD-MM` or `DD-MM-YYYY` (e.g. `14-08-2003`).' };
    let day, month, year = null;
    // Detect ISO order YYYY-MM-DD — requires exactly 3 parts and first part is 4 digits
    if (parts.length >= 3 && parts[0].length === 4) {
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        day = parseInt(parts[2], 10);
    } else {
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        if (parts[2]) year = parseInt(parts[2], 10);
    }
    const err = validateDate(month, day, year);
    if (err) return { error: err };
    return { month, day, year };
}

function formatBirthday(entry) {
    if (!entry) return 'Not set';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const m = months[entry.month - 1] || '?';
    const day = entry.day;
    const suffix = day % 10 === 1 && day !== 11 ? 'st'
        : day % 10 === 2 && day !== 12 ? 'nd'
        : day % 10 === 3 && day !== 13 ? 'rd'
        : 'th';
    let txt = `${m} ${day}${suffix}`;
    if (entry.year) txt += `, ${entry.year}`;
    return txt;
}

function calculateAge(entry, now = new Date()) {
    if (!entry?.year) return null;
    let age = now.getUTCFullYear() - entry.year;
    const m = now.getUTCMonth() + 1;
    const d = now.getUTCDate();
    if (m < entry.month || (m === entry.month && d < entry.day)) age -= 1;
    return age;
}

function getNextBirthday(entry, now = new Date()) {
    if (!entry) return null;
    const yearNow = now.getUTCFullYear();
    // Treat "today" as upcoming until end of UTC day so the card doesn't say
    // "365 days" while we're literally celebrating the user.
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    // Special handling for Feb 29 birthdays: in non-leap years JavaScript
    // overflows Date.UTC(y, 1, 29) → March 1 of the same year, which is wrong.
    // Scan forward from this year until we find the next leap year.
    if (entry.month === 2 && entry.day === 29) {
        for (let y = yearNow; y <= yearNow + 5; y++) {
            if (!isLeapYear(y)) continue;
            const candidate = new Date(Date.UTC(y, 1, 29, 0, 0, 0));
            if (candidate.getTime() >= today.getTime()) return candidate;
        }
        // Fallback (should never be reached within 5 years)
        return new Date(Date.UTC(yearNow + 4, 1, 29, 0, 0, 0));
    }

    let next = new Date(Date.UTC(yearNow, entry.month - 1, entry.day, 0, 0, 0));
    if (next.getTime() < today.getTime()) {
        next = new Date(Date.UTC(yearNow + 1, entry.month - 1, entry.day, 0, 0, 0));
    }
    return next;
}

function todayKey(date = new Date()) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// ── Scheduler ───────────────────────────────────────────────────────────

let _schedulerHandle = null;
let _schedulerTimeout = null;

function startScheduler(client) {
    if (_schedulerHandle) return;
    const tick = () => runTick(client).catch(err => log.error('[Birthday] Scheduler tick failed:', err));
    _schedulerTimeout = setTimeout(tick, 30 * 1000);
    _schedulerHandle = setInterval(tick, 5 * 60 * 1000);
    log.success('[Birthday] Scheduler started — checking every 5 min');
}

function stopScheduler() {
    if (_schedulerHandle) { clearInterval(_schedulerHandle); _schedulerHandle = null; }
    if (_schedulerTimeout) { clearTimeout(_schedulerTimeout); _schedulerTimeout = null; }
}

async function runTick(client) {
    const all = loadAll();
    const now = new Date();
    const dayKey = todayKey(now);
    const utcHour = now.getUTCHours();
    const utcMonth = now.getUTCMonth() + 1;
    const utcDay = now.getUTCDate();
    const utcYear = now.getUTCFullYear();
    let mutated = false;

    for (const [guildId, cfg] of Object.entries(all)) {
        if (!cfg || !cfg.enabled) continue;
        if (!cfg.channelId) continue;
        const fireHour = Number.isInteger(cfg.hour) ? cfg.hour : 9;
        if (utcHour < fireHour) continue;

        const guild = client.guilds.cache.get(guildId);
        if (!guild) continue;

        const channel = guild.channels.cache.get(cfg.channelId)
            || await guild.channels.fetch(cfg.channelId).catch(() => null);
        if (!channel || !channel.isTextBased?.()) {
            // Channel is gone / invalid — log but do NOT mark lastTickDay so
            // birthdays are retried once the admin fixes the channel.
            log.warning(`[Birthday] Guild ${guildId}: configured channel ${cfg.channelId} is missing or not text-based. Skipping tick — re-set the channel to resolve.`);
            continue;
        }

        // Only process guilds that haven't already been fully handled today
        // (guards against rapid restarts replaying the same wishes).
        if (cfg.lastTickDay === dayKey) continue;

        const todayBdays = Object.entries(cfg.users || {}).filter(
            ([, e]) => e.month === utcMonth && e.day === utcDay && e.lastSentYear !== utcYear
        );

        for (const [userId, entry] of todayBdays) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) continue;
            try {
                await sendBirthdayMessage(client, guild, channel, member, entry, cfg);
                if (cfg.roleId) {
                    const role = guild.roles.cache.get(cfg.roleId);
                    const me = guild.members.me;
                    if (role && me && me.permissions.has('ManageRoles')
                        && me.roles.highest.comparePositionTo(role) > 0
                        && !member.roles.cache.has(role.id)) {
                        await member.roles.add(role, 'Birthday celebration').catch(() => {});
                    }
                }
                // Mark that we've wished this user this year so a same-day
                // hour-change or restart never re-fires the wish.
                cfg.users[userId].lastSentYear = utcYear;
                mutated = true;
            } catch (e) {
                log.warning(`[Birthday] Failed to wish ${userId} in ${guildId}: ${e.message || e}`);
            }
        }

        // Mark this guild's tick day only after successfully processing
        cfg.lastTickDay = dayKey;
        mutated = true;
    }

    if (mutated) saveAll(all);
}

async function sendBirthdayMessage(client, guild, channel, member, entry, cfg) {
    const {
        buildComponentsV2Message,
        buildPreviewEmbed,
        replacePlaceholders
    } = require('./actionMessageBuilder');
    const { MessageFlags } = require('discord.js');

    const data = cfg.messageData || cloneTemplate(cfg.messageType || 'embed');
    const age = calculateAge(entry);
    const user = member.user;

    const placeholdersExtra = {
        '{age}': age !== null ? String(age) : '',
        '{birthday}': formatBirthday(entry)
    };

    const applyExtras = (text) => {
        if (!text) return text;
        let out = text;
        for (const [k, v] of Object.entries(placeholdersExtra)) {
            out = out.split(k).join(v);
        }
        return out;
    };

    const expanded = JSON.parse(JSON.stringify(data));
    // Apply birthday-specific extras ({age}, {birthday}) to all text fields
    for (const k of ['content', 'title', 'description', 'footer', 'footerIcon', 'author', 'authorIcon']) {
        if (expanded[k]) expanded[k] = applyExtras(expanded[k]);
    }
    if (Array.isArray(expanded.fields)) {
        expanded.fields = expanded.fields.map(f => ({
            ...f,
            name: applyExtras(f.name),
            value: applyExtras(f.value)
        }));
    }

    const pingMode = cfg.pingMode || 'user';
    let pingPrefix = '';
    if (pingMode === 'everyone') pingPrefix = '@everyone ';
    else if (pingMode === 'here') pingPrefix = '@here ';
    else if (pingMode === 'role' && cfg.roleId) pingPrefix = `<@&${cfg.roleId}> `;
    else if (pingMode === 'user') pingPrefix = `<@${member.id}> `;

    // Build allowed-mentions strictly from pingMode so 'none' really means none,
    // even if `{user}` placeholders inserted a raw mention into the content.
    const allowedMentions = { parse: [], users: [], roles: [] };
    if (pingMode === 'user') allowedMentions.users = [member.id];
    if (pingMode === 'role' && cfg.roleId) allowedMentions.roles = [cfg.roleId];
    if (pingMode === 'everyone' || pingMode === 'here') allowedMentions.parse = ['everyone'];

    const mode = expanded.mode || cfg.messageType || 'embed';

    if (mode === 'components') {
        const container = buildComponentsV2Message(expanded, user, guild, channel);
        // Components V2 messages can't carry a separate `content`. Send the
        // ping (if any) as a small leading message so the role/user gets the
        // notification without bloating the celebration card.
        if (pingPrefix) {
            await channel.send({ content: pingPrefix.trim(), allowedMentions }).catch(() => {});
        }
        await channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions
        });
    } else if (mode === 'embed') {
        const embed = buildPreviewEmbed(expanded, user, guild, channel);
        const resolvedContent = replacePlaceholders(expanded.content || '', user, guild, channel);
        const finalContent = (pingPrefix + (resolvedContent || '')).trim();
        await channel.send({
            content: finalContent || undefined,
            embeds: [embed],
            allowedMentions
        });
    } else {
        const content = (pingPrefix + replacePlaceholders(expanded.content || '', user, guild, channel)).trim();
        await channel.send({ content: content || '🎂', allowedMentions });
    }
}

module.exports = {
    STORE_KEY,
    DEFAULT_TEMPLATES,
    cloneTemplate,
    getDefaultGuildConfig,
    loadAll,
    saveAll,
    getGuildConfig,
    saveGuildConfig,
    setUserBirthday,
    getUserBirthday,
    removeUserBirthday,
    listBirthdaysForMonthDay,
    validateDate,
    parseBirthdayInput,
    formatBirthday,
    monthName,
    calculateAge,
    getNextBirthday,
    isLeapYear,
    todayKey,
    startScheduler,
    stopScheduler,
    runTick,
    sendBirthdayMessage
};
