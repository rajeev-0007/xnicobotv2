require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Install emoji guard FIRST so all subsequent ButtonBuilder.setEmoji calls
// are sanitized against the bot's known-good emoji set.
const emojiGuard = require('./utils/emojiGuard');
emojiGuard.installPatches();

const { Client, GatewayIntentBits, Partials, Collection, REST, Routes, ActivityType, PresenceUpdateStatus, DefaultWebSocketManagerOptions, ContainerBuilder, TextDisplayBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { formatTime, isOwner } = require('./utils/helpers');
const { createLavalinkManager, setupLavalinkEvents, initLavalink, autoplayStatus, lastPlayedTracks, autoplayHistory, panelUpdateIntervals, panelUpdateInProgress, previousVolume, nowPlayingMessages, musicPanelCache, musicPanelChannelCache, inactivityTimers } = require('./utils/lavalinkSetup');
const premiumManager = require('./utils/premiumManager');
const { handleWelcomerButtons, handleAutoresponderButtons, handleAutoreactButtons, handleAutomodButtons, handleAutomodSelectMenus, handleStickyButtons, handleVerificationButtons, handleAntiNukeButtons, handleProfileButtons, handleModalSubmit, replacePlaceholders } = require('./utils/interactionHandlers');
const { preloadGuildInvites, refreshGuildInvite, handleMemberJoin, handleMemberLeave, isTrackingEnabled } = require('./utils/inviteManager');
const { logMessageDelete, logMessageUpdate, logMessageBulkDelete, logMemberJoin, logMemberLeave, logMemberUpdate, logUserUpdate, logVoiceStateUpdate, logChannelCreate, logChannelDelete, logChannelUpdate, logGuildUpdate, logRoleCreate, logRoleDelete, logRoleUpdate, logBan, logUnban, logMemberKick, logTimeout, logEmojiCreate, logEmojiDelete, logEmojiUpdate, logStickerCreate, logStickerDelete, logThreadCreate, logThreadDelete, logInviteCreate, logInviteDelete, logWebhookUpdate, logAntinukeTrigger, logAntinukeFailure, logAntiraidAction, logAntialtDetection, logVanityGuard, logThreatMode, logWhitelistChange, logSecurityConfigChange, logSoundboardCreate, logSoundboardDelete } = require('./utils/logger');
const { handleVoiceStateUpdate: handleJoin2Create, handleJ2CButtons, handleJ2CSelects, handleJ2CModals } = require('./utils/join2createHandler');
const { updateMusicPanel, buildIdlePanel, buildVoiceStatus, buildWaitingStatus, updateVoiceChannelStatus, is247Enabled: is247On, EMOJIS: MUSIC_EMOJIS } = require('./utils/musicPanel');
const { startLiveCard } = require('./utils/liveMusicCard');
const log = require('./utils/logger-styled');
const { connectDatabase, models, getGuildConfig: getGuildConfigDb } = require('./utils/database');
const jsonStore = require('./utils/jsonStore');

// Safe tickets config reader — migrates legacy [] to {} automatically
function readTicketsConfig() {
    if (!jsonStore.has('tickets')) {
        jsonStore.write('tickets', {});
        return {};
    }
    const data = jsonStore.read('tickets');
    if (Array.isArray(data)) {
        jsonStore.write('tickets', {});
        return {};
    }
    return data;
}

const { logError } = require('./utils/errorLogger');
const { buildErrorReply, buildErrorContainer, buildBugReportModal, handleBugReportSubmit, sendErrorReply, buildErrorActionRow, generateErrorId } = require('./utils/errorResponse');
const { checkBotPermissions, notifyMissingPermissions, notifyMissingPermissionsSlash, isPermissionError, inferPermissionsFromCommand } = require('./utils/permissionHandler');
const badgeManager = require('./utils/badgeManager');
const { updateStatsChannels: updateServerStats } = require('./utils/serverStatsManager');
const botCustomize = require('./utils/botCustomize');
const { generateAIResponse, clearHistory } = require('./utils/aiChatManager');
const { trackCommand } = require('./commands/owner/command-stats');

log.installConsoleInterceptors();

/**
 * Silent message-delete paths (music panel, antilink, automod, suggestion
 * channel, screenshot-verify, etc.) used to call `.delete().catch(() => {})`,
 * which hid every error AND every reason. When a user reported "messages
 * are vanishing in my server", there was nothing in the console to point
 * at the responsible feature.
 *
 * `safeDeleteMessage` keeps the same best-effort semantics (we still
 * never throw into messageCreate) but emits a single clear log line so
 * operators can identify which feature deleted which message in which
 * channel for which user. Set DEBUG_AUTO_DELETE=verbose in .env to also
 * log successful deletes; otherwise only failures are logged.
 *
 * @param {import('discord.js').Message} message  the message being deleted
 * @param {string} reason  short feature label, e.g. 'music-panel', 'antilink'
 * @returns {Promise<boolean>} true on success, false on failure
 */
async function safeDeleteMessage(message, reason) {
    if (!message || !message.deletable) {
        // Most likely already deleted by another listener — log at debug
        // so we don't spam the console with noise on every message.
        try {
            log.debug(`[auto-delete:${reason}] skipped (not deletable) guild=${message?.guild?.id || 'dm'} channel=#${message?.channel?.name || message?.channel?.id || '?'} user=${message?.author?.tag || message?.author?.id || '?'}`);
        } catch { }
        return false;
    }
    const verbose = process.env.DEBUG_AUTO_DELETE === 'verbose';
    const guildId = message.guild?.id || 'dm';
    const channelTag = message.channel?.name ? `#${message.channel.name}` : message.channel?.id;
    const userTag = message.author?.tag || message.author?.id || '?';
    const preview = (message.content || '').slice(0, 80).replace(/\n/g, ' ');
    try {
        await message.delete();
        if (verbose) {
            log.info(`[auto-delete:${reason}] ok guild=${guildId} channel=${channelTag} user=${userTag} content="${preview}"`);
        }
        return true;
    } catch (err) {
        log.warning(`[auto-delete:${reason}] FAILED guild=${guildId} channel=${channelTag} user=${userTag} content="${preview}" — ${err?.code || ''} ${err?.message || err}`);
        return false;
    }
}

const DEFAULT_PREFIX = process.env.PREFIX || '-';

// Default channel for vote notifications when a guild has no explicit
// `vote-config` entry. Used by the top.gg + DBL webhook handlers as a
// fallback so we never silently drop a vote event. User-configured
// guild channels still receive their notifications first; this is only
// posted when *no* configured channel pointed at this same channel id.
const DEFAULT_VOTE_CHANNEL_ID = '1465270250265251985';

// Per-guild prefix resolver — reads from PostgreSQL via jsonStore
function getGuildPrefix(guildId) {
    if (!guildId) return DEFAULT_PREFIX;
    try {
        const prefixes = jsonStore.read('prefixes');
        if (prefixes[guildId]) return prefixes[guildId];
    } catch (e) { }
    return DEFAULT_PREFIX;
}

/**
 * Inject a custom footer line into every Components V2 container in
 * `components`, and apply the guild's accent color when one isn't
 * already set.
 *
 * Discord's CV2 schema doesn't include a "footer" slot for containers,
 * so we add the footer text as the very last child — a TextDisplay
 * (component type 10) formatted like Discord's own quiet "small text"
 * convention (`-# …`). The line is only added once per container, so
 * re-patching the same payload is a no-op.
 *
 * Used by both the slash and prefix response patchers below.
 */
function _injectCv2Footer(components, accentColor, footerText) {
    if (!Array.isArray(components) || !footerText) return;
    const sentinel = '__xnicoFooterApplied';
    const footerLine = `-# ${String(footerText).slice(0, 100)}`;

    // Read the last TextDisplay (type 10) content from a container, handling
    // both builder instances (child.data.content) and plain JSON (child.content).
    const lastTextContent = (container) => {
        const kids = Array.isArray(container.components) ? container.components
            : (Array.isArray(container.data?.components) ? container.data.components : []);
        for (let i = kids.length - 1; i >= 0; i--) {
            const k = kids[i];
            const type = k?.data?.type ?? k?.type;
            const content = k?.data?.content ?? k?.content;
            if (type === 10 && typeof content === 'string') return content;
        }
        return null;
    };

    for (const c of components) {
        if (!c || typeof c !== 'object') continue;
        if (c?.data?.type !== 17) continue; // 17 = container
        if (accentColor === null) {
            // 'Colorless' mode — remove any accent color
            delete c.data.accent_color;
        } else if (Number.isFinite(accentColor)) {
            // Always force the guild's chosen color
            c.data.accent_color = accentColor;
        }
        if (c[sentinel]) continue; // already patched

        // Skip injection when the container ALREADY ends with a footer-style
        // line — either the brand footer OR any hand-rolled `-#` subtext line
        // (lots of commands add their own). Without this the patcher appends a
        // second divider + footer, producing the "double separator footer".
        const last = lastTextContent(c);
        if (last && (last.trimStart().startsWith('-#') || last.includes('<:xnico:1486755083390550036> [xNico </>](https://discord.gg/Zs35X7Umak) Development') || last.includes(String(footerText).slice(0, 100)))) {
            c[sentinel] = true;
            continue;
        }

        try {
            const TD = require('discord.js').TextDisplayBuilder;
            const SB = require('discord.js').SeparatorBuilder;
            const SS = require('discord.js').SeparatorSpacingSize;
            // Visually break from the previous content with a thin divider.
            if (typeof c.addSeparatorComponents === 'function') {
                c.addSeparatorComponents(new SB().setSpacing(SS.Small).setDivider(true));
            }
            if (typeof c.addTextDisplayComponents === 'function') {
                c.addTextDisplayComponents(new TD().setContent(footerLine));
            } else if (Array.isArray(c.data?.components)) {
                // Fallback for plain JSON containers: append a raw TextDisplay node.
                c.data.components.push({ type: 10, content: footerLine });
            }
            c[sentinel] = true;
        } catch (_) { }
    }
}

const autoresponderCache = new Map();
const autoreactCache = new Map();

/* ── Runtime emoji ID remapping ──────────────────────────────────────────────
 * Rewrites custom-emoji tags in outgoing payloads to the CURRENT application's
 * emoji ids (by name), so emojis still render after deploying with a new token
 * (the emoji-sync uploads them with the same names, new ids). No-op on the
 * current app and for unknown/guild emojis. */
function _remapComponentText(c, remap) {
    if (!c || typeof c !== 'object') return;
    const node = c.data || c;
    if (node && node.type === 10 && typeof node.content === 'string') {
        node.content = remap(node.content);
    }
    const kids = Array.isArray(c.components) ? c.components
        : (Array.isArray(node.components) ? node.components : null);
    if (kids) for (const k of kids) _remapComponentText(k, remap);
    if (node.accessory) _remapComponentText(node.accessory, remap);
}

function _remapPayloadEmojis(opts) {
    try {
        const remap = require('./utils/emojiGuard').remapText;
        if (typeof remap !== 'function' || !opts || typeof opts !== 'object') return opts;
        if (typeof opts.content === 'string') opts.content = remap(opts.content);
        if (Array.isArray(opts.components)) {
            for (const c of opts.components) _remapComponentText(c, remap);
        }
        if (Array.isArray(opts.embeds)) {
            for (const e of opts.embeds) {
                const d = e?.data ?? e;
                if (!d) continue;
                if (typeof d.title === 'string') d.title = remap(d.title);
                if (typeof d.description === 'string') d.description = remap(d.description);
                if (d.footer && typeof d.footer.text === 'string') d.footer.text = remap(d.footer.text);
                if (Array.isArray(d.fields)) for (const f of d.fields) {
                    if (typeof f.name === 'string') f.name = remap(f.name);
                    if (typeof f.value === 'string') f.value = remap(f.value);
                }
            }
        }
    } catch { }
    return opts;
}
const automodCache = new Map();
const antinukeCache = new Map();
const antinukeTracker = new Map();
const antialtCache = new Map();
const antiraidCache = new Map();
const spamTracker = new Map();
const voiceJoinTimes = new Map(); // Track when users join voice channels

// Activity rotation system
let activityRotationInterval = null;
let activityRotationIndex = 0;
let customStatusRotationInterval = null;
let customStatusRotationIndex = 0;

function startActivityRotation(client) {
    stopActivityRotation();
    const { getActivities, resolveVariables } = require('./commands/owner/botpanel');
    const activityData = getActivities();

    if (!activityData.activities || activityData.activities.length === 0) return;

    const intervalMs = (activityData.rotateInterval || 30) * 1000;

    activityRotationInterval = setInterval(() => {
        try {
            const data = getActivities();
            if (!data.rotating || data.activities.length === 0) {
                stopActivityRotation();
                return;
            }

            // Build list of included activity indices (respects rotation settings)
            const settings = data.rotationSettings || {};
            const includedIndices = data.activities
                .map((_, i) => i)
                .filter(i => settings[i] !== false);
            if (includedIndices.length === 0) return;

            activityRotationIndex = (activityRotationIndex + 1) % includedIndices.length;
            const activity = data.activities[includedIndices[activityRotationIndex]];
            if (!activity) return;

            const typeMap = { 'Playing': ActivityType.Playing, 'Watching': ActivityType.Watching, 'Listening': ActivityType.Listening, 'Competing': ActivityType.Competing, 'Streaming': ActivityType.Streaming };

            const resolvedText = resolveVariables(activity.text, client);
            const presenceOpts = {
                status: data.savedStatus || 'online',
                activities: [{ name: resolvedText, type: typeMap[activity.type] || ActivityType.Playing }]
            };
            if (activity.type === 'Streaming') presenceOpts.activities[0].url = 'https://www.twitch.tv/discord';
            client.user.setPresence(presenceOpts);
        } catch (e) {
            log.error('Activity rotation error: ' + e.message);
        }
    }, intervalMs);

    log.info(`Activity rotation started (${activityData.activities.length} activities, ${activityData.rotateInterval || 30}s interval)`);
}

function stopActivityRotation() {
    if (activityRotationInterval) {
        clearInterval(activityRotationInterval);
        activityRotationInterval = null;
        log.info('Activity rotation stopped');
    }
}

function startCustomStatusRotation(client) {
    stopCustomStatusRotation();
    const { getActivities, resolveVariables } = require('./commands/owner/botpanel');
    const activityData = getActivities();

    const statuses = activityData.customStatuses || [];
    if (statuses.length === 0) return;

    const intervalMs = (activityData.customRotateInterval || 30) * 1000;

    customStatusRotationInterval = setInterval(() => {
        const data = getActivities();
        const sts = data.customStatuses || [];
        if (!data.customRotating || sts.length === 0) {
            stopCustomStatusRotation();
            return;
        }

        customStatusRotationIndex = (customStatusRotationIndex + 1) % sts.length;
        const status = sts[customStatusRotationIndex];
        const resolvedText = resolveVariables(status.text, client);

        client.user.setPresence({
            status: data.savedStatus || 'online',
            activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: resolvedText }]
        });
    }, intervalMs);

    log.info(`Custom status rotation started (${statuses.length} statuses, ${activityData.customRotateInterval || 30}s interval)`);
}

function stopCustomStatusRotation() {
    if (customStatusRotationInterval) {
        clearInterval(customStatusRotationInterval);
        customStatusRotationInterval = null;
        log.info('Custom status rotation stopped');
    }
}

async function loadAutoresponderConfig() {
    try {
        const config = jsonStore.read('autoresponder');
        let count = 0;
        for (const [guildId, data] of Object.entries(config)) {
            if (data && data.enabled) {
                autoresponderCache.set(guildId, data);
                count++;
            }
        }
        if (count > 0) log.success(`AutoResponder: Loaded ${count} guild configurations`);
    } catch (error) {
        log.error('Error loading autoresponder config:', error);
    }
}

async function loadAutoreactConfig() {
    try {
        const config = jsonStore.read('autoreact');
        let count = 0;
        for (const [guildId, data] of Object.entries(config)) {
            if (data && data.enabled) {
                autoreactCache.set(guildId, data);
                count++;
            }
        }
        if (count > 0) log.success(`AutoReact: Loaded ${count} guild configurations`);
    } catch (error) {
        log.error('Error loading autoreact config:', error);
    }
}

async function loadAutomodConfig() {
    try {
        const config = jsonStore.read('automod');
        const { getGuildConfig } = require('./utils/panels/automodPanel');
        Object.entries(config).forEach(([guildId, data]) => {
            if (data && data.enabled) {
                // Merge with defaults so every sub-filter (including the
                // newer aiText / aiImage blocks) is always present in the
                // cached config the message pipeline reads.
                automodCache.set(guildId, getGuildConfig(guildId));
            }
        });
        log.success(`AutoMod: Loaded ${automodCache.size} guild configurations`);
    } catch (error) {
        log.error('Error loading automod config:', error);
    }
}

function updateAutoresponderCache(guildId, data) {
    if (data && data.enabled) {
        autoresponderCache.set(guildId, data);
    } else {
        autoresponderCache.delete(guildId);
    }
}

function updateAutoreactCache(guildId, data) {
    if (data && data.enabled) {
        autoreactCache.set(guildId, data);
    } else {
        autoreactCache.delete(guildId);
    }
}

function updateAutomodCache(guildId, data) {
    // Merge with defaults to ensure all sub-module fields exist for sync
    const { getGuildConfig } = require('./utils/panels/automodPanel');
    const mergedData = getGuildConfig(guildId);

    if (mergedData && mergedData.enabled) {
        automodCache.set(guildId, mergedData);
    } else {
        automodCache.delete(guildId);
    }

    // Sync to Discord's native AutoMod rules in the background
    try {
        const guild = client.guilds?.cache?.get(guildId);
        if (guild) {
            const { syncToDiscord, removeAllBotRules } = require('./utils/automodSync');
            if (mergedData && mergedData.enabled) {
                syncToDiscord(guild, mergedData).catch(e => log.error('[AutoMod Sync] Background sync error: ' + e.message));
            } else {
                removeAllBotRules(guild).catch(e => log.error('[AutoMod Sync] Background cleanup error: ' + e.message));
            }
        }
    } catch (e) { }
}

async function loadAntinukeConfig() {
    try {
        const config = jsonStore.read('antinuke');
        for (const [guildId, data] of Object.entries(config)) {
            if (data) antinukeCache.set(guildId, data);
        }
        const activeCount = [...antinukeCache.values()].filter(d => d.enabled).length;
        log.success(`AntiNuke: Loaded ${antinukeCache.size} configs (${activeCount} active)`);
    } catch (error) {
        log.error('Error loading antinuke config:', error);
    }
}

function updateAntinukeCache(guildId, data) {
    if (data) {
        antinukeCache.set(guildId, data);
    } else {
        antinukeCache.delete(guildId);
    }
}

function reloadAntinukeCache(config) {
    antinukeCache.clear();
    for (const [guildId, data] of Object.entries(config)) {
        if (data) antinukeCache.set(guildId, data);
    }
}

async function loadAntialtConfig() {
    try {
        const config = jsonStore.read('antialt');
        Object.entries(config).forEach(([guildId, data]) => {
            if (data && data.enabled) {
                antialtCache.set(guildId, data);
            }
        });
        log.success(`AntiAlt: Loaded ${antialtCache.size} guild configurations`);
    } catch (error) {
        log.error('Error loading antialt config:', error);
    }
}

function updateAntialtCache(guildId, data) {
    if (data && data.enabled) {
        antialtCache.set(guildId, data);
    } else {
        antialtCache.delete(guildId);
    }
}

async function loadAntiraidConfig() {
    try {
        const config = jsonStore.read('antiraid');
        Object.entries(config).forEach(([guildId, data]) => {
            if (data && data.enabled) {
                antiraidCache.set(guildId, data);
            }
        });
        log.success(`AntiRaid: Loaded ${antiraidCache.size} guild configurations`);
    } catch (error) {
        log.error('Error loading antiraid config:', error);
    }
}

function updateAntiraidCache(guildId, data) {
    if (data && data.enabled) {
        antiraidCache.set(guildId, data);
    } else {
        antiraidCache.delete(guildId);
    }
}

global.updateAutoresponderCache = updateAutoresponderCache;
global.updateAutoreactCache = updateAutoreactCache;
global.updateAutomodCache = updateAutomodCache;
global.updateAntinukeCache = updateAntinukeCache;
global.reloadAntinukeCache = reloadAntinukeCache;
global.updateAntialtCache = updateAntialtCache;
global.updateAntiraidCache = updateAntiraidCache;

// Expose the per-module cache Maps so utils/storeSync.js can clear()
// them before re-populating from a fresh snapshot. Without this, a
// guild row removed from the store entirely would stay cached.
global.automodCache = automodCache;
global.antinukeCache = antinukeCache;
global.antialtCache = antialtCache;
global.antiraidCache = antiraidCache;
global.autoreactCache = autoreactCache;
global.autoresponderCache = autoresponderCache;

// Install the shared dashboard <-> bot cache sync listener.
// Any jsonStore.write/writeImmediate (from this process or via PG poll
// from another process) will fan out to the matching global.update*Cache
// invalidator declared above. The listener `.clear()`s each per-guild
// Map before iterating the snapshot so stale rows are evicted.
//
// Historical note: a pre-existing inline `jsonStore.on('update', …)`
// switch block lived here and did the same per-guild cache rebuild.
// It was removed once installStoreSync became the single source of
// truth — keeping both caused every write to rebuild each cache twice.
try {
    const { installStoreSync } = require('./utils/storeSync');
    installStoreSync(jsonStore);
} catch (e) {
    log.error('Failed to install storeSync listener:', e?.message || e);
}

async function handleBotPanelButton(interaction, client) {
    if (!isOwner(interaction.user.id)) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> Only the bot owner can use this panel!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const customId = interaction.customId;
    const { buildBotPanel, buildImageModal, buildUsernameModal, buildNicknameModal } = require('./commands/owner/botpanel');

    // Status changes (online / idle / dnd / invisible / streaming)
    if (customId.startsWith('botpanel_status_')) {
        const status = customId.replace('botpanel_status_', '');
        const { getActivities, saveActivities } = require('./commands/owner/botpanel');
        const activityData = getActivities();

        if (status === 'streaming') {
            // Discord only shows the purple "streaming" indicator when the bot
            // has a Streaming activity (type 1) with a valid Twitch/YouTube URL —
            // there is no literal "streaming" status string.
            const currentActivities = client.user.presence?.activities || [];
            const existing = currentActivities.find(a => a.type !== ActivityType.Custom && a.type !== ActivityType.Streaming);
            const name = existing?.name || client.user.username;
            activityData.savedStatus = 'online';
            saveActivities(activityData);
            await client.user.setPresence({
                status: 'online',
                activities: [{ name, type: ActivityType.Streaming, url: 'https://www.twitch.tv/discord' }]
            });
            const panel = buildBotPanel(client);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (status === 'none') {
            // "Nothing" — clear the activity so nothing shows, keep current status.
            // Stop any rotation so it can't re-apply an activity afterwards.
            if (activityData.rotating || activityData.customRotating) {
                activityData.rotating = false;
                activityData.customRotating = false;
                saveActivities(activityData);
                stopActivityRotation();
                stopCustomStatusRotation();
            }
            await client.user.setPresence({ status: activityData.savedStatus || 'online', activities: [] });
            const panel = buildBotPanel(client);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        if (status === 'vr') {
            // The VR platform indicator is set at login via the gateway identify
            // (browser = 'Discord VR') and is already active bot-wide. This preset
            // puts the bot online with a clean (no-activity) presence on VR.
            if (activityData.rotating || activityData.customRotating) {
                activityData.rotating = false;
                activityData.customRotating = false;
                saveActivities(activityData);
                stopActivityRotation();
                stopCustomStatusRotation();
            }
            activityData.savedStatus = 'online';
            saveActivities(activityData);
            await client.user.setPresence({ status: 'online', activities: [] });
            const panel = buildBotPanel(client);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
            return true;
        }

        const statusMap = { online: 'online', idle: 'idle', dnd: 'dnd', invisible: 'invisible' };
        if (statusMap[status]) {
            activityData.savedStatus = statusMap[status];
            saveActivities(activityData);

            // Preserve current activity but drop any Streaming activity so the
            // purple indicator clears when switching to a normal status.
            const currentActivities = client.user.presence?.activities || [];
            const keep = currentActivities.filter(a => a.type !== ActivityType.Streaming);
            const presenceOpts = { status: statusMap[status] };
            if (keep.length > 0) {
                presenceOpts.activities = keep.map(a => ({
                    name: a.name, type: a.type, state: a.state, url: a.url
                }));
            }
            await client.user.setPresence(presenceOpts);
            const panel = buildBotPanel(client);
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        } else {
            // Unknown status — acknowledge so the interaction doesn't fail
            await interaction.deferUpdate().catch(() => { });
        }
        return true;
    }

    // Activity Manager button
    if (customId === 'botpanel_activity_manager') {
        const { buildActivityManagerPanel } = require('./commands/owner/botpanel');
        const panel = buildActivityManagerPanel(client, 0);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Rotation Settings button
    if (customId === 'botpanel_rotation_settings') {
        const { buildRotationSettingsPanel } = require('./commands/owner/botpanel');
        const panel = buildRotationSettingsPanel(client);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Rotation Delay button
    if (customId === 'botpanel_rotation_delay') {
        const { getActivities, buildRotationDelayModal } = require('./commands/owner/botpanel');
        const data = getActivities();
        const modal = buildRotationDelayModal(data.rotateInterval || 30);
        await interaction.showModal(modal);
        return true;
    }

    // Rotation Toggle All
    if (customId === 'botpanel_rotation_toggle_all') {
        const { getActivities, saveActivities, buildRotationSettingsPanel } = require('./commands/owner/botpanel');
        const data = getActivities();
        if (!data.rotationSettings) data.rotationSettings = {};

        const allOn = data.activities.every((_, i) => data.rotationSettings[i] !== false);
        data.activities.forEach((_, i) => {
            data.rotationSettings[i] = !allOn;
        });

        saveActivities(data);
        const panel = buildRotationSettingsPanel(client);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Activity Rotation toggle
    if (customId === 'botpanel_activity_rotate') {
        const { getActivities, saveActivities } = require('./commands/owner/botpanel');
        const activityData = getActivities();
        activityData.rotating = !activityData.rotating;
        saveActivities(activityData);

        if (activityData.rotating && activityData.activities.length > 0) {
            startActivityRotation(client);
        } else {
            stopActivityRotation();
        }

        const panel = buildBotPanel(client);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Activity clear
    if (customId === 'botpanel_activity_clear') {
        // Stop rotation so the clear actually persists
        const { getActivities, saveActivities } = require('./commands/owner/botpanel');
        const activityData = getActivities();
        if (activityData.rotating) {
            activityData.rotating = false;
            saveActivities(activityData);
            stopActivityRotation();
        }
        await client.user.setPresence({ activities: [], status: activityData.savedStatus || 'online' });
        const panel = buildBotPanel(client);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Activity select (from manager)
    if (customId.startsWith('activity_select_')) {
        const { getActivities, buildActivityManagerPanel, resolveVariables } = require('./commands/owner/botpanel');
        const idx = parseInt(customId.replace('activity_select_', ''));
        const activityData = getActivities();
        const activity = activityData.activities[idx];

        if (activity) {
            const typeMap = {
                'Playing': ActivityType.Playing,
                'Watching': ActivityType.Watching,
                'Listening': ActivityType.Listening,
                'Competing': ActivityType.Competing,
                'Streaming': ActivityType.Streaming
            };

            const resolvedText = resolveVariables(activity.text, client);
            const presenceOptions = {
                status: activityData.savedStatus || 'online',
                activities: [{
                    name: resolvedText,
                    type: typeMap[activity.type] || ActivityType.Playing
                }]
            };

            if (activity.type === 'Streaming') {
                presenceOptions.activities[0].url = 'https://www.twitch.tv/discord';
            }

            await client.user.setPresence(presenceOptions);
        }

        const panel = buildActivityManagerPanel(client, Math.floor(idx / 3));
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Activity remove
    if (customId.startsWith('activity_remove_')) {
        const { getActivities, saveActivities, buildActivityManagerPanel, resolveVariables } = require('./commands/owner/botpanel');
        const idx = parseInt(customId.replace('activity_remove_', ''));
        const activityData = getActivities();

        const removed = activityData.activities[idx];
        if (removed) {
            activityData.activities.splice(idx, 1);

            // If the removed activity is the one currently shown, clear it live
            // so it actually disappears instead of lingering on the bot.
            const cur = client.user.presence?.activities?.[0];
            if (cur && cur.type !== ActivityType.Custom && resolveVariables(removed.text, client) === cur.name) {
                await client.user.setPresence({ status: activityData.savedStatus || 'online', activities: [] });
            }

            // If the list is now empty, stop rotation so nothing re-applies it.
            if (activityData.activities.length === 0 && activityData.rotating) {
                activityData.rotating = false;
                stopActivityRotation();
            }
            saveActivities(activityData);
        }

        const panel = buildActivityManagerPanel(client, Math.floor(idx / 3));
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Activity add buttons
    if (customId.startsWith('activity_add_')) {
        const activityType = customId.replace('activity_add_', '');
        const { buildAddActivityModal } = require('./commands/owner/botpanel');
        const modal = buildAddActivityModal(activityType.charAt(0).toUpperCase() + activityType.slice(1));
        await interaction.showModal(modal);
        return true;
    }

    // Activity pagination
    if (customId.startsWith('activity_page_')) {
        const page = parseInt(customId.replace('activity_page_', ''));
        const { buildActivityManagerPanel } = require('./commands/owner/botpanel');
        const panel = buildActivityManagerPanel(client, page);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Back to main panel
    if (customId === 'activity_back' || customId === 'custom_back') {
        const panel = buildBotPanel(client);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Custom Status Manager button
    if (customId === 'botpanel_custom_manager') {
        const { buildCustomStatusManagerPanel } = require('./commands/owner/botpanel');
        const panel = buildCustomStatusManagerPanel(client, 0);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Custom Status Rotation toggle
    if (customId === 'botpanel_custom_rotate') {
        const { getActivities, saveActivities } = require('./commands/owner/botpanel');
        const activityData = getActivities();
        activityData.customRotating = !activityData.customRotating;
        saveActivities(activityData);

        if (activityData.customRotating && (activityData.customStatuses || []).length > 0) {
            startCustomStatusRotation(client);
        } else {
            stopCustomStatusRotation();
        }

        const panel = buildBotPanel(client);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Custom Status clear
    if (customId === 'botpanel_custom_clear') {
        // Stop custom rotation so the clear persists
        const { getActivities, saveActivities } = require('./commands/owner/botpanel');
        const activityData = getActivities();
        if (activityData.customRotating) {
            activityData.customRotating = false;
            saveActivities(activityData);
            stopCustomStatusRotation();
        }
        const currentActivities = client.user.presence?.activities || [];
        if (currentActivities.length > 0 && currentActivities[0].type === 4) {
            await client.user.setPresence({ activities: [], status: activityData.savedStatus || 'online' });
        }
        const panel = buildBotPanel(client);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Custom Status select
    if (customId.startsWith('custom_select_')) {
        const { getActivities, buildCustomStatusManagerPanel, resolveVariables } = require('./commands/owner/botpanel');
        const idx = parseInt(customId.replace('custom_select_', ''));
        const activityData = getActivities();
        const status = (activityData.customStatuses || [])[idx];

        if (status) {
            const resolvedText = resolveVariables(status.text, client);
            await client.user.setPresence({
                status: activityData.savedStatus || 'online',
                activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: resolvedText }]
            });
        }

        const panel = buildCustomStatusManagerPanel(client, Math.floor(idx / 3));
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Custom Status remove
    if (customId.startsWith('custom_remove_')) {
        const { getActivities, saveActivities, buildCustomStatusManagerPanel, resolveVariables } = require('./commands/owner/botpanel');
        const idx = parseInt(customId.replace('custom_remove_', ''));
        const activityData = getActivities();

        const removed = (activityData.customStatuses || [])[idx];
        if (removed) {
            activityData.customStatuses.splice(idx, 1);

            // If the removed custom status is the one currently displayed, clear
            // it from the live presence so it doesn't keep showing after delete.
            const cur = client.user.presence?.activities?.[0];
            const removedResolved = resolveVariables(removed.text, client);
            if (cur && cur.type === ActivityType.Custom && (cur.state === removedResolved || cur.name === removedResolved)) {
                await client.user.setPresence({ status: activityData.savedStatus || 'online', activities: [] });
            }

            // If the list is now empty, stop custom rotation so nothing re-applies.
            if ((activityData.customStatuses || []).length === 0 && activityData.customRotating) {
                activityData.customRotating = false;
                stopCustomStatusRotation();
            }
            saveActivities(activityData);
        }

        const panel = buildCustomStatusManagerPanel(client, Math.floor(idx / 3));
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Custom Status add button
    if (customId === 'custom_add') {
        const { buildAddCustomModal } = require('./commands/owner/botpanel');
        const modal = buildAddCustomModal();
        await interaction.showModal(modal);
        return true;
    }

    // Custom Status pagination
    if (customId.startsWith('custom_page_')) {
        const page = parseInt(customId.replace('custom_page_', ''));
        const { buildCustomStatusManagerPanel } = require('./commands/owner/botpanel');
        const panel = buildCustomStatusManagerPanel(client, page);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Image modals (avatar/banner)
    if (customId === 'botpanel_avatar' || customId === 'botpanel_banner') {
        const type = customId.replace('botpanel_', '');
        const modal = buildImageModal(type);
        await interaction.showModal(modal);
        return true;
    }

    // Username modal
    if (customId === 'botpanel_username') {
        const modal = buildUsernameModal();
        await interaction.showModal(modal);
        return true;
    }

    // Nickname modal
    if (customId === 'botpanel_nickname') {
        const modal = buildNicknameModal();
        await interaction.showModal(modal);
        return true;
    }

    // Refresh panel
    if (customId === 'botpanel_refresh') {
        const panel = buildBotPanel(client);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Variables panel
    if (customId === 'botpanel_variables') {
        const { buildVariablesPanel } = require('./commands/owner/botpanel');
        const panel = buildVariablesPanel(client);
        await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        return true;
    }

    // Stats
    if (customId === 'botpanel_stats') {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const minutes = Math.floor((uptime % 3600) / 60);
        const memUsage = process.memoryUsage();
        const memMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);

        const statsContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder()
                    .setContent(`# <:Invoice:1521227903956811836> Bot Statistics\n\n**Uptime:** ${hours}h ${minutes}m\n**Memory:** ${memMB} MB\n**Servers:** ${client.guilds.cache.size}\n**Users:** ${client.users.cache.size}\n**Channels:** ${client.channels.cache.size}\n**Commands:** ${client.commands.size}\n\n**Ping:** ${client.ws.ping}ms`)
            );

        await interaction.reply({ components: [statsContainer], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return true;
    }

    // Reset bot
    if (customId === 'botpanel_reset') {
        try {
            await interaction.reply({ content: '<a:Loading:1521227993995940032> Resetting bot configuration to default stage...', flags: MessageFlags.Ephemeral });

            // Stop all rotations
            stopActivityRotation();
            stopCustomStatusRotation();

            // Clear saved activity data
            const { saveActivities } = require('./commands/owner/botpanel');
            saveActivities({
                activities: [], customStatuses: [], savedStatus: 'online',
                current: null, rotating: false, customRotating: false,
                rotateInterval: 30, customRotateInterval: 30, rotationSettings: {}
            });

            // Reset Avatar
            await client.user.setAvatar(null).catch(() => { });

            // Reset Status and Activity to default
            await client.user.setPresence({
                status: PresenceUpdateStatus.Online,
                activities: [{ name: '-help | /help', type: ActivityType.Listening }]
            });

            await interaction.followUp({ content: '<:Checkedbox:1521227734943269077> Bot has been reset to default stage!', flags: MessageFlags.Ephemeral });

            const panel = buildBotPanel(client);
            await interaction.message.edit({ components: [panel], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
        } catch (error) {
            await interaction.followUp({ content: `<:Cancel:1521227723916181644> Failed to reset bot: ${error.message}`, flags: MessageFlags.Ephemeral }).catch(() => { });
        }
        return true;
    }

    // Close panel
    if (customId === 'botpanel_close') {
        await interaction.message.delete().catch(() => { });
        return true;
    }

    return false;
}

async function handleBotPanelModal(interaction, client) {
    if (!isOwner(interaction.user.id)) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> Only the bot owner can use this!', flags: MessageFlags.Ephemeral });
        return true;
    }

    const customId = interaction.customId;
    const { buildBotPanel, buildActivityManagerPanel, buildCustomStatusManagerPanel, getActivities, saveActivities } = require('./commands/owner/botpanel');

    // Add activity modal (saves to list)
    if (customId.startsWith('activity_add_modal_')) {
        const activityType = customId.replace('activity_add_modal_', '');
        const text = interaction.fields.getTextInputValue('activity_text');

        const activityData = getActivities();
        activityData.activities.push({ type: activityType, text: text });
        saveActivities(activityData);

        // Also set it as current activity
        const typeMap = {
            'Playing': ActivityType.Playing,
            'Watching': ActivityType.Watching,
            'Listening': ActivityType.Listening,
            'Competing': ActivityType.Competing,
            'Streaming': ActivityType.Streaming
        };

        const { resolveVariables } = require('./commands/owner/botpanel');
        const resolvedText = resolveVariables(text, client);
        const presenceOptions = {
            status: activityData.savedStatus || 'online',
            activities: [{
                name: resolvedText,
                type: typeMap[activityType] || ActivityType.Playing
            }]
        };

        if (activityType === 'Streaming') {
            presenceOptions.activities[0].url = 'https://www.twitch.tv/discord';
        }

        await client.user.setPresence(presenceOptions);

        // Update the panel in place (modal was opened from a message button).
        const panel = buildActivityManagerPanel(client, Math.floor((activityData.activities.length - 1) / 3));
        if (interaction.isFromMessage?.()) {
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        } else {
            await interaction.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        return true;
    }

    // Custom status add modal
    if (customId === 'custom_add_modal') {
        const text = interaction.fields.getTextInputValue('custom_text');

        const activityData = getActivities();
        if (!activityData.customStatuses) activityData.customStatuses = [];
        activityData.customStatuses.push({ text: text });
        saveActivities(activityData);

        // Set it as current custom status
        const { resolveVariables } = require('./commands/owner/botpanel');
        const resolvedText = resolveVariables(text, client);
        await client.user.setPresence({
            status: activityData.savedStatus || 'online',
            activities: [{ name: 'Custom Status', type: ActivityType.Custom, state: resolvedText }]
        });

        // Update the panel in place (modal was opened from a message button).
        const panel = buildCustomStatusManagerPanel(client, Math.floor((activityData.customStatuses.length - 1) / 3));
        if (interaction.isFromMessage?.()) {
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        } else {
            await interaction.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        return true;
    }

    // Activity modals (legacy)
    if (customId.startsWith('botpanel_activity_modal_')) {
        const activityType = customId.replace('botpanel_activity_modal_', '');
        const text = interaction.fields.getTextInputValue('activity_text');

        const typeMap = {
            'playing': ActivityType.Playing,
            'watching': ActivityType.Watching,
            'listening': ActivityType.Listening,
            'competing': ActivityType.Competing
        };

        await client.user.setPresence({
            activities: [{ name: text, type: typeMap[activityType] }]
        });

        // Update the panel in place (modal was opened from a message button).
        const panel = buildBotPanel(client);
        if (interaction.isFromMessage?.()) {
            await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
        } else {
            await interaction.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        return true;
    }

    // Avatar modal
    if (customId === 'botpanel_avatar_modal') {
        const url = interaction.fields.getTextInputValue('image_url');
        try {
            await client.user.setAvatar(url);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Avatar updated successfully!', flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: `<:Cancel:1521227723916181644> Failed to update avatar: ${error.message}`, flags: MessageFlags.Ephemeral });
            }
        }
        return true;
    }

    // Banner modal
    if (customId === 'botpanel_banner_modal') {
        await interaction.reply({ content: '# <:Cancel:1521227723916181644> Platform Limitation\n\nDiscord **does not allow bots to change their banner** through the API.\n\n### How to change it manually:\n1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)\n2. Select your bot: **' + client.user.username + '**\n3. Go to **"Bot"** settings\n4. Scroll down to **"Bot Banner"** and upload your image there.\n\n*Note: This is a restriction set by Discord, not the bot.*', flags: MessageFlags.Ephemeral });
        return true;
    }

    // Username modal
    if (customId === 'botpanel_username_modal') {
        const username = interaction.fields.getTextInputValue('username_text');
        try {
            await client.user.setUsername(username);
            await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Username changed to **${username}**!`, flags: MessageFlags.Ephemeral });
        } catch (error) {
            await interaction.reply({ content: `<:Cancel:1521227723916181644> Failed to change username: ${error.message}`, flags: MessageFlags.Ephemeral });
        }
        return true;
    }

    // Nickname modal
    if (customId === 'botpanel_nickname_modal') {
        const nickname = interaction.fields.getTextInputValue('nickname_text') || null;
        if (!interaction.guild) {
            await interaction.reply({ content: '<:Cancel:1521227723916181644> Nicknames can only be changed inside a server. Run the panel in a server channel.', flags: MessageFlags.Ephemeral });
            return true;
        }
        try {
            await interaction.guild.members.me.setNickname(nickname);
            await interaction.reply({ content: nickname ? `<:Checkedbox:1521227734943269077> Nickname changed to **${nickname}**!` : '<:Checkedbox:1521227734943269077> Nickname reset!', flags: MessageFlags.Ephemeral });
        } catch (error) {
            await interaction.reply({ content: `<:Cancel:1521227723916181644> Failed to change nickname: ${error.message}`, flags: MessageFlags.Ephemeral });
        }
        return true;
    }

    return false;
}

// Intent configuration
DefaultWebSocketManagerOptions.identifyProperties.browser = 'Discord VR';
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        // GuildPresences is a PRIVILEGED intent, only needed for Status Roles.
        // Gated behind ENABLE_PRESENCE_INTENT so the bot can start without it
        // (and without enabling the portal toggle). Set ENABLE_PRESENCE_INTENT=true
        // AND turn on "Presence Intent" in the Developer Portal to use it.
        ...(process.env.ENABLE_PRESENCE_INTENT === 'true' ? [GatewayIntentBits.GuildPresences] : []),
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.AutoModerationExecution,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.User, Partials.Channel, Partials.Message, Partials.Reaction, Partials.GuildMember],
    allowedMentions: { parse: [], repliedUser: false },
    presence: {
        status: PresenceUpdateStatus.Online,
        activities: [{
            name: '-help | /help',
            type: ActivityType.Listening
        }]
    }
});

client.on('error', error => log.error('Client error: ' + error.message));

client.commands = new Collection();
client.autoplayStatus = autoplayStatus;
client.systemLogs = log.store;

const commandFolders = ['music', 'voice', 'basic', 'fun', 'games', 'action', 'admin', 'automation', 'utility', 'owner', 'economy', 'leveling', 'image', 'social', 'backup', 'webhook', 'stats', 'anime'];
const commands = [];

// Single source of truth for commands kept as prefix-only.
const { isSlashBlocked } = require('./utils/slashBlocklist');

const categoryCount = {};
let prefixOnlyCount = 0;
let slashBlockedCount = 0;

for (const folder of commandFolders) {
    const commandsPath = path.join(__dirname, 'commands', folder);
    if (!fs.existsSync(commandsPath)) continue;
    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    if (!categoryCount[folder]) categoryCount[folder] = 0;

    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file);
        const command = require(filePath);

        if (command.data && command.data !== null) {
            const commandName = command.data.name;

            if (client.commands.has(commandName)) {
                log.warning(`Duplicate command detected: "${commandName}" in ${folder}/${file} (already exists)`);
                continue;
            }

            command.category = command.category || folder;
            client.commands.set(commandName, command);
            categoryCount[folder]++;

            // Register aliases for prefix commands
            if (command.aliases && Array.isArray(command.aliases)) {
                for (const alias of command.aliases) {
                    if (!client.commands.has(alias)) {
                        client.commands.set(alias, command);
                    }
                }
            }

            // Only register slash commands if not marked as prefix-only AND not blocklisted.
            if (!command.prefixOnly && 'execute' in command) {
                if (isSlashBlocked(commandName)) {
                    slashBlockedCount++;
                } else {
                    const commandData = command.data.toJSON();
                    commandData.category = folder; // Attach category for prioritization
                    commands.push(commandData);
                }
            } else if (command.prefixOnly) {
                prefixOnlyCount++;
            }
        } else if ('executePrefix' in command) {
            // Prefix-only commands without slash command data.
            // Honor `command.prefix` / `command.name` first, fall back to the filename.
            const commandName = command.prefix || command.name || file.replace('.js', '');

            if (client.commands.has(commandName)) {
                log.warning(`Duplicate command detected: "${commandName}" in ${folder}/${file} (already exists)`);
                continue;
            }

            command.category = command.category || folder;
            client.commands.set(commandName, command);
            categoryCount[folder]++;

            // Register aliases for prefix commands
            if (command.aliases && Array.isArray(command.aliases)) {
                for (const alias of command.aliases) {
                    if (!client.commands.has(alias)) {
                        client.commands.set(alias, command);
                    }
                }
            }

            prefixOnlyCount++;
        }
    }
}

// Display command loading summary
let totalLoaded = 0;
const commandItems = Object.entries(categoryCount).map(([cat, count]) => {
    totalLoaded += count;
    return [cat, count];
});

log.section('Commands', true);
log.compact(commandItems);
log.info(`Total commands: ${totalLoaded}`);
if (slashBlockedCount > 0) {
    log.info(`Slash-blocked (prefix-only by policy): ${slashBlockedCount}`);
}

// Lavalink — all setup consolidated in utils/lavalinkSetup.js
const lavalinkManager = createLavalinkManager(client);
setupLavalinkEvents(client, lavalinkManager);

// Add catch-all error handler to prevent crashes
process.on('unhandledRejection', (error) => {
    const errMsg = error?.message || String(error);
    // Gracefully handle Lavalink node connection failures (proxy errors, non-JSON responses)
    if (errMsg.includes('does not provide any /v4/info') || errMsg.includes('is not valid JSON') || errMsg.includes('Proxy erro')) {
        log.warning(`Lavalink node connection failed: ${errMsg.substring(0, 100)} — will retry automatically`);
        return;
    }
    log.critical(`Unhandled rejection: ${errMsg}`, error);
    if (client.systemLogs) client.systemLogs.push({ type: 'error', message: `Unhandled rejection: ${errMsg}`, timestamp: new Date().toISOString() });
});

process.on('uncaughtException', (error) => {
    log.critical(`Uncaught exception: ${error.message}`, error);
    if (client.systemLogs) client.systemLogs.push({ type: 'error', message: `Uncaught exception: ${error.message}`, timestamp: new Date().toISOString() });
});

// Graceful shutdown — flush all in-memory data to PostgreSQL before exiting
let isShuttingDown = false;
async function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log.warning(`Received ${signal}, flushing database before exit...`);
    try {
        await jsonStore.flush();
        log.success('Database flushed successfully');
    } catch (err) {
        log.error('Error flushing database on shutdown:', err);
    }
    process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

const { Events } = require('discord.js');
// Persist the authoritative list of guild IDs the bot is currently in to
// the shared `bot_guilds` store. The web dashboard reads this (over the
// shared database) to decide whether to show "Manage" vs "Invite Bot" for
// each server — so it stays correct even when the dashboard has no bot
// token of its own. Called on ready, guildCreate and guildDelete.
function syncBotGuildsList() {
    try {
        const ids = client.guilds.cache.map(g => g.id);
        jsonStore.write('bot_guilds', ids);
    } catch (e) {
        try { log.debug(`[bot_guilds] sync failed: ${e?.message || e}`); } catch { }
    }
}

client.on(Events.ClientReady, async () => {
    log.startup();
    log.bot(`${client.user.username}`);

    // Wire client into emoji guard so unknown IDs get sanitized against
    // the live emoji cache.
    emojiGuard.attachClient(client);

    // ── Application emoji auto-sync ──    // Ensures THIS application has the full bundled emoji set
    // (assets/emojis/). On a NEW bot token the application starts with no
    // emojis; this uploads them automatically so the bot no longer depends
    // on any external emoji server. Runs in the background — non-blocking.
    try {
        const { ensureEmojisSynced } = require('./utils/emojiAutoSync');
        ensureEmojisSynced(client).catch(e => log.warning('[EmojiSync] ' + (e?.message || e)));
    } catch (e) {
        log.warning('[EmojiSync] Skipped: ' + (e?.message || e));
    }

    // ── Minecraft server monitor ──
    // Starts the live status poller for any guild that configured one via
    // /minecraft monitor. Non-blocking; safe no-op when none are configured.
    try {
        require('./utils/minecraftMonitor').startMonitor(client);
    } catch (e) {
        log.warning('[MC] Monitor start skipped: ' + (e?.message || e));
    }

    // ── Dashboard → bot panel deployment runner ──
    // Consumes the shared `dash_actions` queue so the dashboard can actually
    // POST verification/ticket/music panels into Discord (not just save
    // config). Requires a ready client, so it lives here rather than at
    // module load. Safe no-op if nothing is queued.
    try {
        const { installDashActionRunner } = require('./utils/dashActionRunner');
        installDashActionRunner(client);
    } catch (e) {
        log.warning('[DashActions] install skipped: ' + (e?.message || e));
    }

    // ── Minecraft chat bridges ──
    // Reconnect any configured Discord ↔ Minecraft chat bridges.
    try {
        require('./utils/minecraftBridge').startAllBridges(client);
    } catch (e) {
        log.warning('[MC Bridge] Start skipped: ' + (e?.message || e));
    }

    const totalMembers = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
    log.info(`${client.guilds.cache.size} servers • ${totalMembers.toLocaleString()} users`);

    try {
        await connectDatabase();
        // Now that the store is initialized, publish the current guild list
        // so the dashboard's bot-presence detection is accurate immediately.
        syncBotGuildsList();
        await loadAutoresponderConfig();
        await loadAutoreactConfig();
        await loadAutomodConfig();
        await loadAntinukeConfig();
        await loadAntialtConfig();
        await loadAntiraidConfig();
        await badgeManager.initializeDefaultBadges();
        log.success('Database & configs loaded');
    } catch (error) {
        log.error('Database offline', error);
        log.warning('Continuing without database');
    }

    // ── Canvas asset warmup ──
    // Pre-fetch the most common emoji glyphs (medals, faces, animals,
    // money/fire/lightning custom emojis, …) so the very first
    // welcome / level / profile / economy card render after a fresh
    // deploy doesn't pay multiple round-trips of CDN latency.
    // Runs in the background — failures are silent and non-blocking.
    try {
        const { warmupCanvasEmojis } = require('./utils/canvasWarmup');
        warmupCanvasEmojis().then(count => {
            log.info(`[Canvas] Warmed up ${count} emoji assets`);
        }).catch(() => { });
    } catch (e) {
        log.warning('[Canvas] Warmup skipped: ' + (e?.message || e));
    }

    // ── Top.gg stats auto-poster ──
    // Pushes the live server count to top.gg every 30 minutes (and on
    // every guildCreate/guildDelete with a 5s debounce) so the bot's
    // listing always shows the correct number of servers. Silently
    // skips if TOPGG_TOKEN is not set in .env.
    try {
        const topggPoster = require('./utils/topggPoster');
        topggPoster.start(client);
        topggPoster.bindGuildEvents(client);
    } catch (e) {
        log.warning('[Top.gg] Failed to start stats poster: ' + (e?.message || e));
    }

    // ── Voice Recording Cleanup Task ──
    // Automatically deletes recordings older than 24 hours to save disk space
    // Runs every hour and cleans up the recordings/ directory
    try {
        const { startCleanupTask } = require('./utils/recordings');
        startCleanupTask();
    } catch (e) {
        log.warning('[Record] Failed to start cleanup task: ' + (e?.message || e));
    }

    // ── Periodic database flush (safety net — every 5 minutes) ──
    // Only flushes *dirty* stores. The full-cache `flush()` is reserved
    // for shutdown and the manual /flush endpoint — running it every
    // 5 min upserted ~100 rows on every cycle for no reason and was a
    // measurable source of background PG load + event-loop work.
    setInterval(() => {
        jsonStore.flushDirty().catch(err => log.error('Periodic dirty flush failed:', err));
    }, 5 * 60 * 1000);

    // ── Automatic data snapshots (recovery points for the json_store) ──
    // Hourly gzipped snapshots of every store to store_snapshots/, so a
    // bad write / accidental wipe is recoverable via `datasnapshot restore`.
    try {
        require('./utils/storeSnapshot').startAuto();
    } catch (err) {
        log.warning('[StoreSnapshot] Failed to start auto-snapshot: ' + (err?.message || err));
    }

    // ── Premium system cleanup (runs once on startup, then every 30 minutes) ──
    premiumManager.runCleanup(badgeManager);
    setInterval(() => premiumManager.runCleanup(badgeManager), 30 * 60 * 1000);

    // ── Premium badge sync (ensure all active premium users have their badges) ──
    premiumManager.syncPremiumBadges(badgeManager).catch(() => { });

    // ── Lottery draw scheduler ──
    // Runs the draw automatically when the timer expires and gives the
    // single AI participant ("xNico AI") a chance to buy a ticket each
    // tick. Survives across restarts because state lives in the JSON
    // store; if a draw was due while the bot was offline, the next tick
    // picks winners and persists the history immediately.
    try {
        const lotteryScheduler = require('./utils/lotteryScheduler');
        lotteryScheduler.start({
            onWinners: async (history) => {
                // Quiet by default — the panel surfaces the most recent
                // draw on its own. We only log here for ops visibility.
                try {
                    const ids = (history?.winners || []).map(w => w.id).join(', ');
                    log.info(`[Lottery] Draw complete · pot=${history?.totalPot || 0} · winners=${ids || 'none'}`);
                } catch (_) { }
            },
        });
        log.success('[Lottery] Scheduler started');
    } catch (err) {
        log.warning('[Lottery] Scheduler failed to start: ' + (err?.message || err));
    }

    // ── Periodic premium data refresh from database (every 10 minutes) ──
    setInterval(() => {
        premiumManager.reloadPremiumData().catch(err => log.error('Premium reload failed:', err));
    }, 10 * 60 * 1000);

    // ── Restore giveaway timers ──
    try {
        const { restoreGiveawayTimers } = require('./commands/automation/giveaway');
        restoreGiveawayTimers(client);
    } catch (e) { }

    // ── Start panel expiration cleanup ──
    try {
        const { startCleanup } = require('./utils/panelExpiration');
        startCleanup(client);
    } catch (e) { }

    // ── Restore poll timers ──
    try {
        const { recoverPollTimers } = require('./commands/automation/poll');
        recoverPollTimers(client);
    } catch (e) { }

    // ── Start birthday scheduler ──
    try {
        const birthdayManager = require('./utils/birthdayManager');
        birthdayManager.startScheduler(client);
    } catch (e) {
        log.warning('[Birthday] Failed to start scheduler: ' + (e?.message || e));
    }

    // ── Guild Tag streak rewards checker (runs every hour) ──
    try {
        const { processStreakRewards } = require('./commands/admin/guildtag');
        setInterval(() => {
            processStreakRewards(client).catch(() => { });
        }, 60 * 60 * 1000); // Every hour
    } catch (e) { }

    // Periodic cleanup of antinukeTracker and spamTracker to prevent memory leaks
    setInterval(() => {
        const now = Date.now();
        // Clean antinukeTracker — remove entries older than 2 minutes
        for (const [key, actions] of antinukeTracker.entries()) {
            const recent = actions.filter(time => now - time < 120000);
            if (recent.length === 0) {
                antinukeTracker.delete(key);
            } else {
                antinukeTracker.set(key, recent);
            }
        }
        // Clean spamTracker — remove entries older than 30 seconds
        for (const [key, timestamps] of spamTracker.entries()) {
            if (!Array.isArray(timestamps)) { spamTracker.delete(key); continue; }
            const recent = timestamps.filter(entry => {
                const t = typeof entry === 'object' && entry !== null ? entry.time : entry;
                return typeof t === 'number' && now - t < 30000;
            });
            if (recent.length === 0) {
                spamTracker.delete(key);
            } else {
                spamTracker.set(key, recent);
            }
        }
    }, 60000); // Run every 60 seconds

    // Check for custom activity rotation first
    try {
        const { getActivities } = require('./commands/owner/botpanel');
        const activityData = getActivities();
        const savedStatus = activityData.savedStatus || 'online';

        if (activityData.rotating && activityData.activities && activityData.activities.length > 0) {
            startActivityRotation(client);
            log.info('Activity rotation enabled');
        } else if (activityData.activities && activityData.activities.length > 0) {
            const activity = activityData.activities[0];
            const typeMap = { 'Playing': ActivityType.Playing, 'Watching': ActivityType.Watching, 'Listening': ActivityType.Listening, 'Competing': ActivityType.Competing };
            client.user.setPresence({
                activities: [{ name: activity.text, type: typeMap[activity.type] || ActivityType.Playing }],
                status: savedStatus
            });
        } else {
            client.user.setPresence({
                activities: [{ name: '-help | /help', type: ActivityType.Listening }],
                status: savedStatus
            });
        }

        if (activityData.customRotating && activityData.customStatuses && activityData.customStatuses.length > 0) {
            startCustomStatusRotation(client);
            log.info('Custom status rotation enabled');
        }
    } catch (e) {
        client.user.setPresence({
            activities: [{ name: '-help | /help', type: ActivityType.Listening }],
            status: 'online'
        });
    }

    // ── Persistent Vote Reminder Scheduler ──────────────────────────────────
    // Runs every 5 minutes. Sends a DM to users who opted in and can vote again.
    const { SeparatorBuilder: _SepB, SeparatorSpacingSize: _SepSS } = require('discord.js');
    setInterval(async () => {
        try {
            const uv = jsonStore.has('user-votes') ? jsonStore.read('user-votes') : {};
            const nowTs = Date.now();
            let changed = false;
            for (const [uid, udata] of Object.entries(uv)) {
                if (udata.remindersEnabled === false) continue; // Only skip if explicitly disabled
                if (udata.reminderSent) continue;
                if (!udata.nextVoteAvailable || nowTs < udata.nextVoteAvailable) continue;
                try {
                    const ru = await client.users.fetch(uid).catch(() => null);
                    if (!ru) continue;
                    const streak = udata.streak || 0;
                    const clientId = process.env.CLIENT_ID || client.user.id;

                    let rc = `## <:Fire:1521227907647668374> Vote Available!\n\n`;
                    rc += `You can vote for **${client.user.username}** again.`;
                    if (streak >= 3) rc += `\n<:Fire:1521227907647668374> **${streak}-vote streak** — keep it going!`;
                    rc += `\n\n-# Use \`/myvotes\` to disable reminders`;

                    const remContainer = new ContainerBuilder()
                        .setAccentColor(0xFF3366)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(rc));
                    const remBtn = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Top.gg')
                            .setURL(`https://top.gg/bot/${clientId}/vote`)
                            .setStyle(ButtonStyle.Link)
                            .setEmoji('<:topgg:1521228219066482790>'),
                        new ButtonBuilder()
                            .setLabel('DBL')
                            .setURL('https://discordbotlist.com/bots/xnico')
                            .setStyle(ButtonStyle.Link)
                            .setEmoji('<:Cursor:1521228147071127732>')
                    );
                    await ru.send({ components: [remContainer, remBtn], flags: MessageFlags.IsComponentsV2 });
                    udata.reminderSent = true;
                    changed = true;
                    log.debug(`[VoteReminder] Sent to ${ru.username}`);
                } catch {
                    // DMs closed or other error — mark sent to prevent loop
                    udata.reminderSent = true;
                    changed = true;
                }
            }
            if (changed) jsonStore.write('user-votes', uv);
        } catch (err) {
            log.error(`[VoteReminder] Scheduler error: ${err.message}`);
        }
    }, 5 * 60 * 1000);
    log.info('Vote reminder scheduler started (5-min interval)');
    // ─────────────────────────────────────────────────────────────────────────

    // ── Vote No-Prefix Expiry Scheduler ──────────────────────────────────────
    // Runs every 5 minutes. DMs users whose 12h vote-granted no-prefix has
    // expired ("your np expired, vote again") and clears the entry.
    setInterval(async () => {
        try {
            const npCmd = client.commands.get('noprefix');
            if (npCmd && typeof npCmd.expireVoteNoPrefix === 'function') {
                const n = await npCmd.expireVoteNoPrefix(client);
                if (n > 0) log.debug(`[VoteNoPrefix] Notified ${n} user(s) of expiry`);
            }
        } catch (err) {
            log.error(`[VoteNoPrefix] Expiry scheduler error: ${err.message}`);
        }
    }, 5 * 60 * 1000);
    log.info('Vote no-prefix expiry scheduler started (5-min interval)');
    // ─────────────────────────────────────────────────────────────────────────

    // ── Uptime Heartbeat Writer ─────────────────────────────────────────────
    // Writes a heartbeat file every 5s. The shard manager (parent process)
    // watches this file and posts offline/online notices to the owner's
    // configured webhook. See utils/uptimeMonitor.js.
    try {
        const uptimeMonitor = require('./utils/uptimeMonitor');
        const botStartTime = Date.now();
        const beat = () => uptimeMonitor.writeHeartbeat({
            startTime: botStartTime,
            botName: client.user?.username,
            avatarUrl: client.user?.displayAvatarURL?.({ size: 256 }),
        });
        beat();
        const hbTimer = setInterval(beat, 5000);
        if (hbTimer.unref) hbTimer.unref();
        log.info('Uptime heartbeat writer started (5s interval)');
    } catch (e) {
        log.warning('[UptimeMonitor] Heartbeat writer failed: ' + (e?.message || e));
    }
    // ─────────────────────────────────────────────────────────────────────────

    await initLavalink(client, lavalinkManager);

    // ── Slash command auto-registration ──
    // Single source of truth: re-registers only when TOKEN, CLIENT_ID, or
    // the slash-command set changes (hash-based). Otherwise it's a no-op.
    // To force a re-register: delete data/.slash-cache.json and restart.
    try {
        const { autoRegister } = require('./utils/slashRegistrar');
        const result = await autoRegister({
            client,
            token: process.env.TOKEN,
            clientId: process.env.CLIENT_ID || client.user.id,
            commands,
            // Set FORCE_SLASH_REGISTER=true in .env to force a clean re-register
            // on the next boot (useful after a fresh deploy or command changes).
            force: /^(1|true|yes)$/i.test(process.env.FORCE_SLASH_REGISTER || ''),
        });
        if (result.registered) {
            log.success(`[Slash] Auto-registered (${result.reason}) → ${result.global} global + ${result.guild} guild commands.`);
            if (result.dropped > 0) {
                log.error(`[Slash] ${result.dropped} command(s) exceeded Discord's 200-per-guild limit and were NOT registered. Check the warnings above.`);
            }
        } else {
            log.info(`[Slash] ${commands.length} commands loaded — no registration needed (${result.reason}).`);
        }
    } catch (e) {
        log.error(`[Slash] Auto-registration failed: ${e.message}`);
        log.warning('[Slash] Delete data/.slash-cache.json and restart to retry.');
    }

    const guilds = Array.from(client.guilds.cache.values());
    const totalGuilds = guilds.length;
    let loadedCount = 0;

    for (const guild of guilds) {
        await preloadGuildInvites(guild);
        loadedCount++;
    }
    log.success(`Invite tracking ready (${loadedCount}/${totalGuilds} guilds)`);

    // Resume live leaderboards
    try {
        const llbCmd = client.commands.get('liveleaderboard');
        if (llbCmd && llbCmd.resumeAll) await llbCmd.resumeAll(client);
    } catch (e) { log.warning(`[LiveLeaderboard] Resume failed: ${e.message}`); }

    // Warm the anime character pool (AniList API) in the background
    try {
        require('./utils/animeManager').ensurePool()
            .then(pool => log.success(`[Anime] Character pool ready (${pool.length} characters)`))
            .catch(() => { });
    } catch { }

    // Refresh all music panels to idle state on startup and preload cache
    try {
        if (jsonStore.has('musicpanel')) {
            const panelConfig = jsonStore.read('musicpanel');
            let refreshed = 0;
            let cleaned = 0;

            for (const guildId of Object.keys(panelConfig)) {
                const hasValidPanel = !!(panelConfig[guildId]?.channelId && panelConfig[guildId]?.messageId);
                musicPanelCache.set(guildId, hasValidPanel);

                if (hasValidPanel) {
                    const { channelId, messageId } = panelConfig[guildId];
                    musicPanelChannelCache.set(guildId, channelId);

                    try {
                        const guild = client.guilds.cache.get(guildId);
                        if (!guild) continue;

                        const channel = guild.channels.cache.get(channelId);
                        if (!channel || !channel.isTextBased()) continue;

                        // Clean up messages sent while bot was offline (keep only panel message)
                        try {
                            const messages = await channel.messages.fetch({ limit: 100 });
                            const messagesToDelete = messages.filter(msg =>
                                msg.id !== messageId &&
                                !msg.pinned &&
                                Date.now() - msg.createdTimestamp < 14 * 24 * 60 * 60 * 1000 // < 14 days old
                            );

                            if (messagesToDelete.size > 0) {
                                if (messagesToDelete.size === 1) {
                                    await messagesToDelete.first().delete().catch(() => { });
                                } else {
                                    await channel.bulkDelete(messagesToDelete, true).catch(() => { });
                                }
                                cleaned += messagesToDelete.size;
                            }
                        } catch (e) { }

                        await updateMusicPanel(client, null, autoplayStatus, guildId);
                        refreshed++;
                    } catch (e) { }
                }
            }

            if (cleaned > 0) {
                log.success(`${cleaned} old message(s) cleaned from music panel channels`);
            }
            if (refreshed > 0) {
                log.success(`${refreshed} music panel(s) refreshed`);
            }
        }
    } catch (e) {
        log.error(`Music panel refresh failed: ${e.message}`);
    }

    // Auto-reconnect to voice channels with 24/7 mode enabled (premium-only)
    if (jsonStore.has('musicpanel-247')) {
        try {
            const config247 = jsonStore.read('musicpanel-247');
            let reconnected = 0;

            for (const [guildId, config] of Object.entries(config247)) {
                if (!config.enabled) continue;

                // 24/7 is gated at ENABLE time (the `247` command is
                // premiumOnly). Once enabled it must survive restarts —
                // the old `isServerPremium()` re-check always returned
                // false (server premium was discontinued), so 24/7
                // channels NEVER rejoined after a restart. Honour the
                // saved config strictly instead.

                try {
                    const guild = client.guilds.cache.get(guildId);
                    if (!guild) {
                        continue;
                    }

                    const voiceChannel = guild.channels.cache.get(config.voiceChannelId);
                    if (!voiceChannel) {
                        continue;
                    }

                    // Check if bot is already in this voice channel
                    const existingPlayer = lavalinkManager.getPlayer(guildId);
                    if (existingPlayer && existingPlayer.voiceChannelId === config.voiceChannelId) {
                        continue;
                    }

                    // Create or get player and join voice channel
                    const player = lavalinkManager.createPlayer({
                        guildId: guildId,
                        voiceChannelId: config.voiceChannelId,
                        textChannelId: config.textChannelId,
                        selfDeaf: true,
                        selfMute: false,
                        volume: 100
                    });

                    await player.connect();

                    // Set waiting status on 24/7 reconnect
                    await updateVoiceChannelStatus(client, { guildId, voiceChannelId: config.voiceChannelId }, 'waiting');

                    reconnected++;
                    log.debug(`24/7: Reconnected to ${guild.name} (${voiceChannel.name})`);
                } catch (error) {
                    log.error(`24/7 reconnect failed for ${guildId}:`, error.message);
                }
            }

            if (reconnected > 0) {
                log.success(`24/7 auto-reconnect: ${reconnected} server(s)`);
            }
        } catch (error) {
            log.error('24/7 auto-reconnect failed:', error);
        }
    }

    // Refresh music panels on startup using unified buildIdlePanel
    if (jsonStore.has('musicpanel')) {
        const panelConfig = jsonStore.read('musicpanel');
        let panelsRefreshed = 0;
        let configChanged = false;

        for (const [guildId, panelData] of Object.entries(panelConfig)) {
            try {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) continue;

                const channel = guild.channels.cache.get(panelData.channelId);
                if (!channel) {
                    delete panelConfig[guildId];
                    configChanged = true;
                    continue;
                }

                // Try to edit the existing panel message instead of deleting it
                const idlePanel = buildIdlePanel(guildId);

                try {
                    const existingMessage = await channel.messages.fetch(panelData.messageId).catch(() => null);
                    if (existingMessage) {
                        // Edit in place - don't delete!
                        await existingMessage.edit({
                            components: [idlePanel],
                            flags: MessageFlags.IsComponentsV2
                        });
                        panelsRefreshed++;
                    } else {
                        // Only create new message if old one is missing
                        const newPanelMessage = await channel.send({
                            components: [idlePanel],
                            flags: MessageFlags.IsComponentsV2
                        });
                        panelConfig[guildId].messageId = newPanelMessage.id;
                        configChanged = true;
                        panelsRefreshed++;
                    }
                } catch (err) {
                    // If edit fails, create new message
                    const newPanelMessage = await channel.send({
                        components: [idlePanel],
                        flags: MessageFlags.IsComponentsV2
                    });
                    panelConfig[guildId].messageId = newPanelMessage.id;
                    configChanged = true;
                    panelsRefreshed++;
                }

            } catch (error) {
                log.error(`Panel refresh failed: ${guildId}`, error);
            }
        }

        if (configChanged) {
            jsonStore.write('musicpanel', panelConfig);
        }
        if (panelsRefreshed > 0) {
            log.success(`${panelsRefreshed} music panel(s) refreshed`);
        }
    }

    // ── Social Media Notification Polling (YouTube) ──
    try {
        const socialPoller = require('./utils/socialNotifyPoller');
        socialPoller.startPolling(client, log);
    } catch (e) {
        log.error(`Social notify poller failed to start: ${e.message}`);
    }

    // ── AutoMeme scheduler ──
    try {
        const autoMemePoster = require('./utils/autoMemePoster');
        autoMemePoster.startScheduler(client);
    } catch (e) {
        log.error(`AutoMeme scheduler failed to start: ${e.message}`);
    }

    // ── Nameplate re-apply on startup ──
    try {
        const namestyleCmd = require('./commands/admin/namestyle');
        await namestyleCmd.reapplyAll(client, log);
    } catch (e) {
        log.error(`Nameplate re-apply failed: ${e.message}`);
    }
});

// Auto-nickname system
client.on('guildMemberAdd', async (member) => {
    // NOTE: Welcomer is handled in the main guildMemberAdd handler below (with anti-nuke, anti-raid, autorole, etc.)
    // Do NOT add welcomer logic here — it would cause duplicate welcome messages.

    // Auto-nickname feature (premium-only)
    try {
        // Re-validate server premium at runtime — `/autonick setup` is
        // gated by the dispatcher, but the saved config keeps working
        // forever otherwise. If the server lost premium, skip.
        if (premiumManager.isServerPremium(member.guild.id)) {
            if (jsonStore.has('autonick')) {
                const config = jsonStore.read('autonick');
                const guildConfig = config[member.guild.id];

                if (guildConfig && guildConfig.enabled && guildConfig.format) {
                    const nickname = guildConfig.format.replace(/{user}/g, member.user.username);

                    if (nickname && member.manageable) {
                        await member.setNickname(nickname, 'Auto-nickname system');
                    }
                }
            }
        }
    } catch (error) {
        log.error('AutoNick error', error);
    }

    // DM on Join feature from bot customization (premium-only)
    try {
        // `/bot-customize` is premium-gated, but the persisted dmOnJoin
        // setting keeps firing for free servers after premium lapsed.
        if (premiumManager.isServerPremium(member.guild.id)) {
            const guildCfg = botCustomize.getConfig(member.guild.id);
            if (guildCfg.dmOnJoin && guildCfg.dmMessage) {
                // Route through the canonical message-builder placeholder
                // table so admins can use any of the documented tokens
                // ({user}, {username}, {servername}, {membercount}, …)
                // case-insensitively. Previously this only swapped three
                // tokens with case-sensitive matching, which broke
                // {memberCount} typed with a different casing than the
                // hard-coded variant and ignored every other token.
                const { replacePlaceholders: dmReplace } = require('./utils/actionMessageBuilder');
                const dmContent = dmReplace(guildCfg.dmMessage, member.user, member.guild, member.guild.systemChannel);
                await member.send(dmContent).catch(() => { });
            }
        }
    } catch (error) {
        log.error('DM on Join error', error);
    }
});

client.on('interactionCreate', async (interaction) => {
    // ═══════ Bot Ignore Module (Dashboard Integration) ═══════
    if (interaction.guild) {
        try {
            const biCfg = jsonStore.peekGuild('botignore-config', interaction.guild.id);
            if (biCfg && biCfg.enabled && !biCfg.ignorePrefix) {
                const isCh = (biCfg.ignoredChannels || []).includes(interaction.channelId);
                const isUser = (biCfg.ignoredUsers || []).includes(interaction.user.id);
                const isRole = interaction.member && (biCfg.ignoredRoles || []).some(r => interaction.member.roles.cache.has(r));

                // Allow admins/owner to bypass
                const isBypassed = interaction.member?.permissions.has(PermissionFlagsBits.Administrator) || interaction.user.id === process.env.OWNER_ID;

                if ((isCh || isUser || isRole) && !isBypassed) {
                    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: "<:Cancel:1521227723916181644> The bot is configured to ignore you or this channel.", flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                    return;
                }
            }
        } catch (e) { }
    }

    // Handle autocomplete interactions FIRST. They are not chat-input,
    // not buttons, and not modals; without this branch they fall into
    // the `!isChatInputCommand()` block, walk through every button
    // route (no customId match), and Discord shows the user the default
    // 3-second-deadline error. Several long-standing commands rely on
    // this path: badge-edit / badge-give / badge-remove (added in this
    // task) plus older autocomplete users in commands/utility/,
    // commands/backup/, and commands/music/.
    if (interaction.isAutocomplete()) {
        const cmd = client.commands.get(interaction.commandName);
        if (cmd && typeof cmd.autocomplete === 'function') {
            try {
                await cmd.autocomplete(interaction);
            } catch (e) {
                log.error('autocomplete error: ' + (e?.message || e));
            }
        }
        return;
    }

    // Handle modal submissions
    if (interaction.isModalSubmit()) {
        const customId = interaction.customId;

        // ── Bug Report modal handler ──
        if (customId.startsWith('bug_report_modal')) {
            try {
                await handleBugReportSubmit(interaction, client);
            } catch (error) {
                log.error('Bug report modal error:', error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to process the bug report.', flags: MessageFlags.Ephemeral }).catch(() => { });
                }
            }
            return;
        }

        if (customId.startsWith('rrsetup_modal_')) {
            const rrCmd = client.commands.get('reactionroles');
            if (rrCmd && rrCmd.handleSetupModal) {
                try {
                    await rrCmd.handleSetupModal(interaction);
                } catch (error) {
                    log.error(`RR Setup Modal: ${error.message}`, error);
                }
            }
            return;
        }

        if (customId === 'botpanel_rotation_delay_modal') {
            if (!isOwner(interaction.user.id)) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Only the bot owner can use this!', flags: MessageFlags.Ephemeral });
                return;
            }

            const delayText = interaction.fields.getTextInputValue('delay_text');
            const delay = parseInt(delayText);

            if (isNaN(delay) || delay < 10) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid delay! Must be at least 10 seconds.', flags: MessageFlags.Ephemeral });
                return;
            }

            const { getActivities, saveActivities, buildRotationSettingsPanel } = require('./commands/owner/botpanel');
            const data = getActivities();
            data.rotateInterval = delay;
            saveActivities(data);

            if (data.rotating) {
                startActivityRotation(client);
            }

            // Update the panel in place when opened from a message button.
            const panel = buildRotationSettingsPanel(client);
            if (interaction.isFromMessage?.()) {
                await interaction.update({ components: [panel], flags: MessageFlags.IsComponentsV2 });
            } else {
                await interaction.reply({ components: [panel], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            return;
        }

        const antinukeCmd = client.commands.get('antinuke');
        if (antinukeCmd && antinukeCmd.handleModal && interaction.customId.startsWith('antinuke_modal_')) {
            try {
                await antinukeCmd.handleModal(interaction);
            } catch (error) {
                log.error(`Anti-Nuke Modal: ${error.message}`, error);
            }
            return;
        }

        if (interaction.customId.startsWith('app_modal_')) {
            const appCmd = client.commands.get('application');
            if (appCmd && appCmd.handleModalSubmit) {
                try {
                    await appCmd.handleModalSubmit(interaction);
                } catch (error) {
                    log.error(`Application Modal: ${error.message}`, error);
                }
            }
            return;
        }

        // Screenshot Verification modals
        if (interaction.customId.startsWith('sshot_modal_')) {
            const sshotCmd = client.commands.get('screenshot-verify');
            if (sshotCmd && sshotCmd.handleModalSubmit) {
                try {
                    await sshotCmd.handleModalSubmit(interaction);
                } catch (error) {
                    log.error(`Screenshot Verify Modal: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error processing your submission!', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
            }
            return;
        }

        // Handle quicksetup log channel modal
        if (interaction.customId.startsWith('quicksetup_modal_')) {
            const quicksetupCmd = client.commands.get('quicksetup');
            if (quicksetupCmd && quicksetupCmd.handleInteraction) {
                try {
                    const handled = await quicksetupCmd.handleInteraction(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Quick Setup Modal: ${error.message}`, error);
                }
            }
            return;
        }

        // Handle AI Chat modals
        if (interaction.customId.startsWith('aichat_')) {
            const aichatCmd = client.commands.get('aichat-setup');
            if (aichatCmd && aichatCmd.handleInteraction) {
                try {
                    const handled = await aichatCmd.handleInteraction(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`AI Chat Modal: ${error.message}`, error);
                }
            }
            return;
        }

        // Handle antispam configure modals
        if (interaction.customId.startsWith('antispam_configure_modal_')) {
            const antispamCmd = client.commands.get('antispam');
            if (antispamCmd && antispamCmd.handleInteraction) {
                try {
                    await antispamCmd.handleInteraction(interaction);
                } catch (error) {
                    log.error(`AntiSpam Modal: ${error.message}`, error);
                }
            }
            return;
        }

        // Handle confession modals (per-confession card actions: anon, public, reply, report)
        if (interaction.customId.startsWith('confess_modal_')) {
            const confCmd = client.commands.get('confess');
            if (confCmd?.handleModal) {
                try { const h = await confCmd.handleModal(interaction); if (h) return; } catch (e) { log.error(`Confession Modal: ${e.message}`); }
            }
            return;
        }
        // Handle confession-setup admin modals (banadd, banremove, wordedit, lookup)
        if (interaction.customId.startsWith('confsetup_modal_')) {
            const confSetupCmd = client.commands.get('confession-setup');
            if (confSetupCmd?.handleInteraction) {
                try { const h = await confSetupCmd.handleInteraction(interaction); if (h) return; } catch (e) { log.error(`Confession Setup Modal: ${e.message}`, e); }
            }
            return;
        }

        // Handle birthday public-panel modal (bdaypanel_modal_set / bdaycmd_modal_set)
        if (interaction.customId === 'bdaypanel_modal_set' || interaction.customId === 'bdaycmd_modal_set') {
            const bdayUserCmd = client.commands.get('birthday');
            if (bdayUserCmd?.handlePanelModal) {
                try { const h = await bdayUserCmd.handlePanelModal(interaction); if (h) return; } catch (e) { log.error(`Birthday Modal: ${e.message}`, e); }
            }
            return;
        }
        // Handle birthday message-builder modals (bdaymsg_modal_*)
        if (interaction.customId.startsWith('bdaymsg_modal_')) {
            const bdaySetupCmd = client.commands.get('birthday-setup');
            if (bdaySetupCmd?.handleInteraction) {
                try { const h = await bdaySetupCmd.handleInteraction(interaction); if (h) return; } catch (e) { log.error(`Birthday Builder Modal: ${e.message}`, e); }
            }
            return;
        }

        // Handle join2create modals
        if (interaction.customId.startsWith('j2c_')) {
            try {
                await handleJ2CModals(interaction);
            } catch (error) {
                log.error(`Join2Create Modal: ${error.message}`, error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error!', flags: MessageFlags.Ephemeral }).catch(() => { });
                } else if (interaction.deferred && !interaction.replied) {
                    await interaction.editReply({ content: '<:Cancel:1521227723916181644> There was an error!' }).catch(() => { });
                }
            }
            return;
        }

        // Handle join2create-setup admin modals (interface create/edit)
        if (interaction.customId.startsWith('j2cset_modal_')) {
            const j2cCmd = client.commands.get('join2create-setup');
            if (j2cCmd?.handleModalSubmit) {
                try {
                    const handled = await j2cCmd.handleModalSubmit(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`J2C Setup Modal: ${error.message}`, error);
                }
            }
            return;
        }

        // Handle botpanel modals
        if ((interaction.customId.startsWith('botpanel_') && interaction.customId.includes('_modal')) || interaction.customId.startsWith('activity_add_modal_') || interaction.customId === 'custom_add_modal') {
            try {
                const handled = await handleBotPanelModal(interaction, client);
                if (handled) return;
            } catch (error) {
                log.error(`Bot Panel Modal: ${error.message}`, error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred while processing the bot panel action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                }
                return;
            }
        }

        const welcomerCmd = client.commands.get('welcomer');
        if (welcomerCmd && welcomerCmd.handleModalSubmit && (interaction.customId.startsWith('welcomer_modal_') || interaction.customId.startsWith('welcomer_template_') || interaction.customId.startsWith('leave_modal_') || interaction.customId.startsWith('leave_canvas_') || interaction.customId.startsWith('canvas_'))) {
            try {
                const handled = await welcomerCmd.handleModalSubmit(interaction);
                if (handled) return;
            } catch (error) {
                log.error(`Welcomer Modal: ${error.message}`, error);
            }
        }

        // Custom Font URL modal
        if (interaction.customId === 'custom_font_modal_rankcard' || interaction.customId === 'custom_font_modal_profile') {
            // ── Premium gate ─────────────────────────────────────
            // Custom font upload is a premium-only customization
            // surface (matches /rank-customize and /profile-customize).
            if (!premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild?.id)) {
                const { buildPremiumGate } = require('./utils/responseBuilder');
                const which = interaction.customId === 'custom_font_modal_rankcard'
                    ? '/rank-customize'
                    : '/profile-customize';
                return interaction.reply({
                    components: [buildPremiumGate(which)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                }).catch(() => { });
            }
            try {
                await interaction.deferReply({ flags: MessageFlags.Ephemeral });
                const { registerCustomFontFromUrl } = require('./utils/fontRegistry');
                const { updateUserData } = require('./utils/dataManager');
                const isRankCard = interaction.customId === 'custom_font_modal_rankcard';
                const url = interaction.fields.getTextInputValue('font_url').trim();

                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    return interaction.editReply({ content: '<:Cancel:1521227723916181644> Invalid URL — must start with `http://` or `https://`' });
                }

                await interaction.editReply({ content: '⏳ Downloading your font… this may take a moment.' });

                let entry;
                try {
                    entry = await registerCustomFontFromUrl(url);
                } catch (err) {
                    return interaction.editReply({ content: `<:Cancel:1521227723916181644> Failed to load font: **${err.message}**\n-# Make sure the URL points directly to a .ttf, .otf, .woff, or .woff2 file.` });
                }

                const dataPath = isRankCard ? 'profile.rankCard.fontFamily' : 'profile.profileCard.fontFamily';
                await updateUserData(interaction.user.id, { [dataPath]: entry.key });

                await interaction.editReply({
                    content: `<:Checkedbox:1521227734943269077> Custom font **${entry.name}** set successfully!\n-# Use **Preview** to see how it looks on your ${isRankCard ? 'rank card' : 'profile card'}.`
                });
            } catch (error) {
                log.error(`Custom Font Modal Error: ${error.message}`, error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> Something went wrong loading the font.', flags: MessageFlags.Ephemeral }).catch(() => { });
                } else {
                    await interaction.editReply({ content: '<:Cancel:1521227723916181644> Something went wrong loading the font.' }).catch(() => { });
                }
            }
            return;
        }

        // Help search modal
        if (interaction.customId === 'help_search_modal') {
            const helpCmd = client.commands.get('help');
            if (helpCmd && helpCmd.handleModalSubmit) {
                try {
                    const handled = await helpCmd.handleModalSubmit(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Help Search Modal: ${error.message}`, error);
                }
            }
        }

        const myMusicCmd = client.commands.get('my-music');
        if (myMusicCmd && myMusicCmd.handleModalSubmit && interaction.customId.startsWith('mymusic_modal_')) {
            try {
                const handled = await myMusicCmd.handleModalSubmit(interaction, lavalinkManager);
                if (handled) return;
            } catch (error) {
                log.error(`My Music Modal: ${error.message}`, error);
            }
        }

        const msgBuilderCmd = client.commands.get('message-builder');
        if (msgBuilderCmd && msgBuilderCmd.handleModalSubmit && interaction.customId.startsWith('msgbuilder_modal_')) {
            try {
                const handled = await msgBuilderCmd.handleModalSubmit(interaction);
                if (handled) return;
            } catch (error) {
                log.error(`Message Builder Modal: ${error.message}`, error);
            }
        }

        // Suggestion edit modal
        if (interaction.customId.startsWith('sug_edit_modal_')) {
            try {
                const suggestionCmd = client.commands.get('suggestion');
                if (suggestionCmd?.handleInteraction) {
                    await suggestionCmd.handleInteraction(interaction);
                }
            } catch (error) {
                log.error(`Suggestion Edit Modal: ${error.message}`, error);
            }
            return;
        }
        // Route economy game modals (hangman letter, numguess number).
        // Each game owns its modal id prefix and dispatches via handleModal.
        const ECONOMY_GAME_MODALS = [
            { prefix: 'hangmanmodal_', cmd: 'hangman' },
            { prefix: 'numguessmodal_', cmd: 'numguess' }
        ];
        const ecoModal = ECONOMY_GAME_MODALS.find(m => interaction.customId.startsWith(m.prefix));
        if (ecoModal) {
            const cmd = client.commands.get(ecoModal.cmd);
            if (cmd?.handleModal) {
                try {
                    const handled = await cmd.handleModal(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`${ecoModal.cmd} Modal Error: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
            }
            return;
        }

        // Feedback modal
        if (interaction.customId === 'fb_submit_modal') {
            const feedbackCmd = client.commands.get('feedback');
            if (feedbackCmd?.handleInteraction) {
                try {
                    await feedbackCmd.handleInteraction(interaction);
                } catch (error) {
                    log.error(`Feedback Modal Error: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred submitting your feedback.', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
            }
            return;
        }

        const inviteCmd = client.commands.get('invite-setup');
        if (inviteCmd && inviteCmd.handleInteraction && interaction.customId.startsWith('invite_modal_')) {
            try {
                const handled = await inviteCmd.handleInteraction(interaction);
                if (handled) return;
            } catch (error) {
                log.error(`Invite Setup Modal: ${error.message}`, error);
            }
        }

        const levelingCmd = client.commands.get('leveling-setup');
        if (levelingCmd && levelingCmd.handleInteraction && interaction.customId.startsWith('leveling_modal_')) {
            try {
                const handled = await levelingCmd.handleInteraction(interaction);
                if (handled) return;
            } catch (error) {
                log.error(`Leveling Setup Modal: ${error.message}`, error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                }
                return;
            }
        }

        const antiraidCmd = client.commands.get('antiraid');
        if (antiraidCmd && antiraidCmd.handleInteraction && interaction.customId.startsWith('antiraid_modal_')) {
            try {
                const handled = await antiraidCmd.handleInteraction(interaction);
                if (handled) return;
            } catch (error) {
                log.error(`Antiraid Modal: ${error.message}`, error);
            }
        }

        // Anti-Alt modal submissions (set age / action / log channel)
        const antialtCmd = client.commands.get('antialt');
        if (antialtCmd && antialtCmd.handleInteraction && interaction.customId.startsWith('antialt_modal_')) {
            try {
                const handled = await antialtCmd.handleInteraction(interaction);
                if (handled) return;
            } catch (error) {
                log.error(`AntiAlt Modal: ${error.message}`, error);
            }
        }

        // Handle anti limit modals
        if (interaction.customId.startsWith('anti_modal_')) {
            const antiCmd = client.commands.get('anti');
            if (antiCmd && antiCmd.handleInteraction) {
                try {
                    await antiCmd.handleInteraction(interaction);
                    return;
                } catch (error) {
                    log.error(`Anti Limit Modal: ${error.message}`, error);
                }
            }
        }

        if (interaction.customId.startsWith('spotlink_')) {
            const spotlinkCmd = client.commands.get('spotify-link');
            if (spotlinkCmd && spotlinkCmd.handleInteraction) {
                try {
                    const handled = await spotlinkCmd.handleInteraction(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Spotify Link Modal: ${error.message}`, error);
                }
            }
        }

        if (interaction.customId.startsWith('social_')) {
            const socialCmd = client.commands.get('social-notify');
            if (socialCmd && socialCmd.handleInteraction) {
                try {
                    const handled = await socialCmd.handleInteraction(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Social Notify Modal: ${error.message}`, error);
                }
            }
        }

        if (interaction.customId.startsWith('booster_')) {
            const boosterCmd = client.commands.get('booster-notify');
            if (boosterCmd && boosterCmd.handleInteraction) {
                try {
                    const handled = await boosterCmd.handleInteraction(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Booster Notify Modal: ${error.message}`, error);
                }
            }
        }

        // Handle select-menu-maker modals
        if (interaction.customId.startsWith('select_modal_')) {
            const selectMenuCmd = client.commands.get('select-menu-maker');
            if (selectMenuCmd && selectMenuCmd.handleModalSubmit) {
                try {
                    const handled = await selectMenuCmd.handleModalSubmit(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Select Menu Maker Modal: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Error saving action!', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }
        }

        // Handle button-maker modals (including message builder)
        if (interaction.customId.startsWith('btn_modal_') || interaction.customId.startsWith('btnmsg:')) {
            const buttonMakerCmd = client.commands.get('button-maker');
            if (buttonMakerCmd && buttonMakerCmd.handleModalSubmit) {
                try {
                    const handled = await buttonMakerCmd.handleModalSubmit(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Button Maker Modal: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Error saving action!', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }
        }

        // Handle select-menu-maker message builder modals
        if (interaction.customId.startsWith('selmsg:')) {
            const selectMenuCmd = client.commands.get('select-menu-maker');
            if (selectMenuCmd && selectMenuCmd.handleModalSubmit) {
                try {
                    const handled = await selectMenuCmd.handleModalSubmit(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Select Menu Message Builder Modal: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Error saving action!', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }
        }

        // Handle ticket-setup message builder modals
        if (interaction.customId.startsWith('ticketmsg:') || interaction.customId.startsWith('ticketpanel:')) {
            const ticketSetupCmd = client.commands.get('ticket-setup');
            if (ticketSetupCmd && ticketSetupCmd.handleModalSubmit) {
                try {
                    const handled = await ticketSetupCmd.handleModalSubmit(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Ticket Message Builder Modal: ${error.message}`, error);
                }
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> Could not process that action. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => { });
                }
                return;
            }
        }

        // Handle verification panel builder modals
        if (interaction.customId.startsWith('verifypanel:')) {
            const verifySetupCmd = client.commands.get('verification-setup');
            if (verifySetupCmd && verifySetupCmd.handleModalSubmit) {
                try {
                    const handled = await verifySetupCmd.handleModalSubmit(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Verification Panel Builder Modal: ${error.message}`, error);
                }
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> Could not process that action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                }
                return;
            }
        }

        if (interaction.customId.startsWith('apikeys_')) {
            const apikeysCmd = client.commands.get('apikeys');
            if (apikeysCmd && apikeysCmd.handleInteraction) {
                try {
                    const handled = await apikeysCmd.handleInteraction(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`API Keys Modal: ${error.message}`, error);
                }
            }
        }

        if (interaction.customId.startsWith('botcustom_')) {
            const botCustomCmd = client.commands.get('bot-customize');
            if (botCustomCmd && botCustomCmd.handleInteraction) {
                try {
                    const handled = await botCustomCmd.handleInteraction(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Bot Customize Modal: ${error.message}`, error);
                }
            }
        }

        // Handle webhook rename modals
        if (interaction.customId.startsWith('wh_modal_rename:')) {
            const whRenameCmd = client.commands.get('webhook-rename');
            if (whRenameCmd && whRenameCmd.handleModalSubmit) {
                try {
                    const handled = await whRenameCmd.handleModalSubmit(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Webhook Rename Modal: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Error renaming webhook!', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }
        }

        // Handle webhook send modals
        if (interaction.customId.startsWith('wh_modal_send:')) {
            const whSendCmd = client.commands.get('webhook-send');
            if (whSendCmd && whSendCmd.handleModalSubmit) {
                try {
                    const handled = await whSendCmd.handleModalSubmit(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Webhook Send Modal: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Error sending webhook message!', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }
        }

        if (interaction.customId.startsWith('giveaway_')) {
            const giveawayCmd = client.commands.get('giveaway');
            if (giveawayCmd && giveawayCmd.handleInteraction) {
                try {
                    const handled = await giveawayCmd.handleInteraction(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Giveaway Modal: ${error.message}`, error);
                }
            }
        }

        if (interaction.customId.startsWith('vote_')) {
            const voteCmd = client.commands.get('vote-notify');
            if (voteCmd && voteCmd.handleModalSubmit) {
                try {
                    const handled = await voteCmd.handleModalSubmit(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Vote Modal: ${error.message}`, error);
                }
            }
        }

        // Route badge-edit modal submissions
        if (interaction.customId.startsWith('badge_modal_')) {
            const badgeEditCmd = client.commands.get('badge-edit');
            if (badgeEditCmd && badgeEditCmd.handleInteraction) {
                try {
                    const handled = await badgeEditCmd.handleInteraction(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`Badge Edit Modal Error: ${error.message}`, error);
                }
            }
        }

        try {
            await handleModalSubmit(interaction);
        } catch (error) {
            log.error(`Modal: ${error.message}`, error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error processing your submission!', flags: MessageFlags.Ephemeral }).catch(() => { });
            } else if (interaction.deferred && !interaction.replied) {
                await interaction.editReply({ content: '<:Cancel:1521227723916181644> There was an error processing your submission!' }).catch(() => { });
            }
        }
        return;
    }

    if (!interaction.isChatInputCommand()) {
        // Handle button interactions
        if (interaction.isButton()) {
            const { handleWelcomerButtons, handleAutoresponderButtons, handleAutoreactButtons, handleAutomodButtons, handleVerificationButtons, handleProfileButtons } = require('./utils/interactionHandlers');

            // ── Moderation confirmation buttons (ban/kick/etc.) ──
            // Owned by a per-message collector in utils/confirmAction.js — the
            // global handler must NOT touch them or it would double-acknowledge.
            if (interaction.customId.startsWith('modconfirm:')) return;

            // ── User stats card refresh ──
            if (interaction.customId.startsWith('userstats_refresh_')) {
                const usCmd = client.commands.get('userstats');
                if (usCmd && usCmd.handleInteraction) {
                    try {
                        await usCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Userstats refresh: ${error.message}`, error);
                    }
                }
                return;
            }

            // ── Bug Report button handler ──
            if (interaction.customId.startsWith('bug_report')) {
                try {
                    const parts = interaction.customId.split(':');
                    const errorId = parts.length > 1 ? parts[1] : null;
                    const modal = buildBugReportModal(errorId);
                    await interaction.showModal(modal);
                } catch (error) {
                    log.error('Bug report button error:', error);
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> Could not open the bug report form. Please use `/report` instead.', flags: MessageFlags.Ephemeral }).catch(() => { });
                }
                return;
            }

            if (interaction.customId.startsWith('rrsetup_')) {
                const rrCmd = client.commands.get('reactionroles');
                if (rrCmd && rrCmd.handleSetupInteraction) {
                    try {
                        await rrCmd.handleSetupInteraction(interaction);
                    } catch (error) {
                        log.error(`RR Setup Button: ${error.message}`, error);
                    }
                }
                return;
            }

            if (interaction.customId.startsWith('rr_role_')) {
                try {
                    const roleId = interaction.customId.replace('rr_role_', '');
                    if (!jsonStore.has('reactionroles')) return interaction.reply({ content: '<:Cancel:1521227723916181644> No reaction role config found.', flags: 64 });
                    const rrConfig = jsonStore.read('reactionroles');
                    const guildId = interaction.guild?.id;
                    if (!guildId || !rrConfig[guildId]) return interaction.reply({ content: '<:Cancel:1521227723916181644> No panels found for this server.', flags: 64 });

                    const msgId = interaction.message.id;
                    const panel = rrConfig[guildId][msgId];
                    if (!panel) return interaction.reply({ content: '<:Cancel:1521227723916181644> This panel no longer exists in config.', flags: 64 });

                    const matchedRole = panel.roles.find(r => r.roleId === roleId);
                    if (!matchedRole) return interaction.reply({ content: '<:Cancel:1521227723916181644> This role is no longer on this panel.', flags: 64 });

                    const role = interaction.guild.roles.cache.get(roleId);
                    if (!role) return interaction.reply({ content: '<:Cancel:1521227723916181644> Role not found.', flags: 64 });
                    if (role.managed || role.position >= interaction.guild.members.me.roles.highest.position) {
                        return interaction.reply({ content: '<:Cancel:1521227723916181644> I cannot manage this role.', flags: 64 });
                    }

                    const member = interaction.member;
                    if (member.roles.cache.has(roleId)) {
                        await member.roles.remove(role);
                        return interaction.reply({ content: `<:Cancel:1521227723916181644> Removed **${role.name}**`, flags: 64 });
                    } else {
                        await member.roles.add(role);
                        return interaction.reply({ content: `<:Checkedbox:1521227734943269077> Added **${role.name}**`, flags: 64 });
                    }
                } catch (error) {
                    log.error(`RR Button Role: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        return interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to toggle role.', flags: 64 });
                    }
                }
                return;
            }

            if (interaction.customId.startsWith('welcomer_') || interaction.customId.startsWith('leave_') || interaction.customId.startsWith('canvas_')) {
                const welcomerCmd = client.commands.get('welcomer');
                if (welcomerCmd && welcomerCmd.handleInteraction) {
                    try {
                        const handled = await welcomerCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Welcomer Button: ${error.message}`, error);
                        if (interaction.replied || interaction.deferred) return;
                    }
                }
                if (interaction.customId.startsWith('welcomer_') || interaction.customId.startsWith('leave_') || interaction.customId.startsWith('canvas_')) {
                    return handleWelcomerButtons(interaction);
                }
            }
            if (interaction.customId.startsWith('msgbuilder_')) {
                const msgBuilderCmd = client.commands.get('message-builder');
                if (msgBuilderCmd && msgBuilderCmd.handleInteraction) {
                    const handled = await msgBuilderCmd.handleInteraction(interaction);
                    if (handled) return;
                }
            }
            if (interaction.customId.startsWith('spotlink_')) {
                const spotlinkCmd = client.commands.get('spotify-link');
                if (spotlinkCmd && spotlinkCmd.handleInteraction) {
                    try {
                        const handled = await spotlinkCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Spotify Link Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('social_')) {
                const socialCmd = client.commands.get('social-notify');
                if (socialCmd && socialCmd.handleInteraction) {
                    try {
                        const handled = await socialCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Social Notify Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('booster_')) {
                const boosterCmd = client.commands.get('booster-notify');
                if (boosterCmd && boosterCmd.handleInteraction) {
                    try {
                        const handled = await boosterCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Booster Notify Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('apikeys_')) {
                const apikeysCmd = client.commands.get('apikeys');
                if (apikeysCmd && apikeysCmd.handleInteraction) {
                    try {
                        const handled = await apikeysCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`API Keys Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('help_')) {
                const helpCmd = client.commands.get('help');
                if (helpCmd && helpCmd.handleButton) {
                    try {
                        const handled = await helpCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Help Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('var_')) {
                const varCmd = client.commands.get('variables');
                if (varCmd && varCmd.handleButton) {
                    try {
                        const handled = await varCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Variables Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route avatar toggle buttons
            if (interaction.customId.startsWith('avatar_')) {
                const avatarCmd = client.commands.get('avatar');
                if (avatarCmd && avatarCmd.handleButton) {
                    try {
                        await avatarCmd.handleButton(interaction);
                        return;
                    } catch (error) {
                        log.error(`Avatar Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route fun game buttons
            if (interaction.customId.startsWith('hangman_')) {
                const hangmanCmd = client.commands.get('hangman');
                if (hangmanCmd && hangmanCmd.handleButton) {
                    try {
                        const handled = await hangmanCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Hangman Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('bj_')) {
                const bjCmd = client.commands.get('blackjack');
                if (bjCmd && bjCmd.handleButton) {
                    try {
                        const handled = await bjCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Blackjack Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('ttt_')) {
                const tttCmd = client.commands.get('tictactoe');
                if (tttCmd && tttCmd.handleButton) {
                    try {
                        const handled = await tttCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`TicTacToe Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('wyr_')) {
                const wyrCmd = client.commands.get('wouldyourather');
                if (wyrCmd && wyrCmd.handleButton) {
                    try {
                        const handled = await wyrCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`WouldYouRather Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('afk_')) {
                const afkCmd = client.commands.get('afk');
                if (afkCmd?.handleButton) {
                    try {
                        const handled = await afkCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`AFK Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('automeme_')) {
                const automemeCmd = client.commands.get('automeme');
                if (automemeCmd?.handleButton) {
                    try {
                        const handled = await automemeCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`AutoMeme Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('akinator_')) {
                const akinatorCmd = client.commands.get('akinator');
                if (akinatorCmd && akinatorCmd.handleButton) {
                    try {
                        const handled = await akinatorCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Akinator Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('reaction_')) {
                const reactionCmd = client.commands.get('reactionspeed');
                if (reactionCmd && reactionCmd.handleButton) {
                    try {
                        const handled = await reactionCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`ReactionSpeed Button Error: ${error.message}`, error);
                    }
                }
            }
            // Meme next button
            if (interaction.customId.startsWith('meme_')) {
                const memeCmd = client.commands.get('meme');
                if (memeCmd?.handleButton) {
                    try { const h = await memeCmd.handleButton(interaction); if (h) return; } catch { }
                }
            }
            // Truth or Dare buttons
            if (interaction.customId.startsWith('tod_')) {
                const todCmd = client.commands.get('truthdare');
                if (todCmd?.handleButton) {
                    try { const h = await todCmd.handleButton(interaction); if (h) return; } catch { }
                }
            }
            // Confession system — admin setup panel buttons (use handleInteraction)
            if (interaction.customId.startsWith('confsetup_')) {
                const confSetupCmd = client.commands.get('confession-setup');
                if (confSetupCmd?.handleInteraction) {
                    try { const h = await confSetupCmd.handleInteraction(interaction); if (h) return; } catch (e) {
                        log.error(`Confession Setup Button: ${e.message}`, e);
                    }
                }
            }
            // Confession system — per-confession card buttons (confess_new, confess_reply_*, etc.)
            if (interaction.customId.startsWith('confess_')) {
                const confCmd = client.commands.get('confess');
                if (confCmd?.handleButton) {
                    try { const h = await confCmd.handleButton(interaction); if (h) return; } catch (e) {
                        log.error(`Confession Button: ${e.message}`, e);
                    }
                }
            }
            // Confession system — public Submit panel buttons
            if (interaction.customId.startsWith('confpanel_')) {
                const confCmd = client.commands.get('confess');
                if (confCmd?.handleButton) {
                    try { const h = await confCmd.handleButton(interaction); if (h) return; } catch (e) {
                        log.error(`Confession Panel Button: ${e.message}`, e);
                    }
                }
            }
            // Birthday system — admin setup panel + message-builder bridge
            if (interaction.customId.startsWith('bdaysetup_') || interaction.customId.startsWith('bdaymsg_')) {
                const bdayCmd = client.commands.get('birthday-setup');
                if (bdayCmd?.handleInteraction) {
                    try { const h = await bdayCmd.handleInteraction(interaction); if (h) return; } catch (e) {
                        log.error(`Birthday Setup Button: ${e.message}`, e);
                    }
                }
            }
            // Birthday system — public Set-Birthday panel buttons
            if (interaction.customId.startsWith('bdaypanel_')) {
                const bdayUserCmd = client.commands.get('birthday');
                if (bdayUserCmd?.handlePanelButton) {
                    try { const h = await bdayUserCmd.handlePanelButton(interaction); if (h) return; } catch (e) {
                        log.error(`Birthday Panel Button: ${e.message}`, e);
                    }
                }
            }
            // Joke & Fact next buttons
            if (interaction.customId === 'joke_next') {
                const jokeCmd = client.commands.get('joke');
                if (jokeCmd?.handleButton) { try { const h = await jokeCmd.handleButton(interaction); if (h) return; } catch { } }
            }
            if (interaction.customId === 'fact_next') {
                const factCmd = client.commands.get('fact');
                if (factCmd?.handleButton) { try { const h = await factCmd.handleButton(interaction); if (h) return; } catch { } }
            }
            if (interaction.customId.startsWith('botcustom_')) {
                const botCustomCmd = client.commands.get('bot-customize');
                if (botCustomCmd && botCustomCmd.handleInteraction) {
                    try {
                        const handled = await botCustomCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error('Bot Customize error', error);
                    }
                }
            }
            if (interaction.customId === 'check_ping' || interaction.customId === 'check_botinfo') {
                try {
                    if (interaction.customId === 'check_ping') {
                        const { buildPing } = require('./commands/basic/ping');
                        const { container, utilRow } = buildPing(client, null);
                        await interaction.reply({ components: [container, utilRow], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    } else {
                        const { buildBotInfo } = require('./commands/basic/botinfo');
                        const { container, linkRow } = buildBotInfo(client, interaction.guild);
                        await interaction.reply({ components: [container, linkRow], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    }
                    return;
                } catch (error) {
                    log.error(`Check Utility Error: ${error.message}`, error);
                }
            }
            if (interaction.customId.startsWith('botpanel_') || interaction.customId.startsWith('activity_') || interaction.customId.startsWith('custom_')) {
                try {
                    const handled = await handleBotPanelButton(interaction, client);
                    if (handled) return;
                } catch (error) {
                    log.error(`Bot Panel Error: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred while processing the bot panel action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                    return;
                }
            }
            if (interaction.customId.startsWith('mymusic_')) {
                const myMusicCmd = client.commands.get('my-music');
                if (myMusicCmd && myMusicCmd.handleButton) {
                    try {
                        const handled = await myMusicCmd.handleButton(interaction, lavalinkManager);
                        if (handled) return;
                    } catch (error) {
                        log.error(`My Music Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('clrhist_')) {
                const clearCmd = client.commands.get('clear');
                if (clearCmd && clearCmd.handleButton) {
                    try {
                        const handled = await clearCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Clear History Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('snipenav_')) {
                const snipeCmd = client.commands.get('snipe');
                if (snipeCmd && snipeCmd.handleButton) {
                    try {
                        const handled = await snipeCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Snipe Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('esnipenav_')) {
                const editsnipeCmd = client.commands.get('editsnipe');
                if (editsnipeCmd && editsnipeCmd.handleButton) {
                    try {
                        const handled = await editsnipeCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`EditSnipe Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('ghostnav_')) {
                const ghostCmd = client.commands.get('ghostping');
                if (ghostCmd && ghostCmd.handleButton) {
                    try {
                        const handled = await ghostCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`GhostPing Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('listkeys_')) {
                const listkeysCmd = client.commands.get('listkeys');
                if (listkeysCmd && listkeysCmd.handleButton) {
                    try {
                        const handled = await listkeysCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`List Keys Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route premiums pagination & view switch buttons
            if (interaction.customId.startsWith('premiums_')) {
                const premiumsCmd = client.commands.get('premiums');
                if (premiumsCmd && premiumsCmd.handleButton) {
                    try {
                        const handled = await premiumsCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Premiums Button Error: ${error.message}`, error);
                    }
                }
            }
            // Shop category tabs are now a StringSelectMenu (routed in isStringSelectMenu block)
            // Route highlow game buttons (hl_high_ / hl_low_ / hl_equal_)
            if (interaction.customId.startsWith('hl_')) {
                const hlCmd = client.commands.get('highlow');
                if (hlCmd && hlCmd.handleButton) {
                    try {
                        const handled = await hlCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`High-Low Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route emojis pagination buttons.
            if (interaction.customId.startsWith('emojis:')) {
                const emojisCmd = client.commands.get('emojis');
                if (emojisCmd && emojisCmd.handleInteraction) {
                    try {
                        const handled = await emojisCmd.handleInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Emojis Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route mines game button clicks (tile reveals + cashout).
            // The select menus for grid/risk are handled in the
            // isStringSelectMenu block below — both paths share the
            // same handleMinesInteraction entry point.
            if (interaction.customId.startsWith('mines_')) {
                const minesCmd = client.commands.get('mines');
                if (minesCmd && minesCmd.handleMinesInteraction) {
                    try {
                        const handled = await minesCmd.handleMinesInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Mines Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route crash game buttons (start, cashout, cancel). Setup
            // select menus are routed in the isStringSelectMenu block.
            if (interaction.customId.startsWith('crash_')) {
                const crashCmd = client.commands.get('crash');
                if (crashCmd && crashCmd.handleCrashInteraction) {
                    try {
                        const handled = await crashCmd.handleCrashInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Crash Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route plinko game buttons (start, cancel). Setup select
            // menus are routed in the isStringSelectMenu block.
            if (interaction.customId.startsWith('plinko_')) {
                const plinkoCmd = client.commands.get('plinko');
                if (plinkoCmd && plinkoCmd.handlePlinkoInteraction) {
                    try {
                        const handled = await plinkoCmd.handlePlinkoInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Plinko Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route wheel game buttons (start, cancel). Setup select
            // menus are routed in the isStringSelectMenu block.
            if (interaction.customId.startsWith('wheel_')) {
                const wheelCmd = client.commands.get('wheel');
                if (wheelCmd && wheelCmd.handleWheelInteraction) {
                    try {
                        const handled = await wheelCmd.handleWheelInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Wheel Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route limbo game buttons (start, cancel).
            if (interaction.customId.startsWith('limbo_')) {
                const limboCmd = client.commands.get('limbo');
                if (limboCmd && limboCmd.handleLimboInteraction) {
                    try {
                        const handled = await limboCmd.handleLimboInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Limbo Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route tower game buttons (start, pick, cashout, cancel).
            if (interaction.customId.startsWith('tower_')) {
                const towerCmd = client.commands.get('tower');
                if (towerCmd && towerCmd.handleTowerInteraction) {
                    try {
                        const handled = await towerCmd.handleTowerInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Tower Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route keno game buttons (number toggles, start, clear, cancel).
            if (interaction.customId.startsWith('keno_')) {
                const kenoCmd = client.commands.get('keno');
                if (kenoCmd && kenoCmd.handleKenoInteraction) {
                    try {
                        const handled = await kenoCmd.handleKenoInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Keno Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route inventory pagination buttons
            if (interaction.customId.startsWith('inv_page_')) {
                const invCmd = client.commands.get('inventory');
                if (invCmd && invCmd.handleInteraction) {
                    try {
                        const handled = await invCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Inventory Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route economy leaderboard buttons (sort, scope, page)
            if (interaction.customId.startsWith('elb_')) {
                const lbCmd = client.commands.get('economy-leaderboard');
                if (lbCmd && lbCmd.handleButton) {
                    try {
                        const handled = await lbCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Leaderboard Button Error: ${error.message}`, error);
                    }
                }
            }
            // Route stats card buttons (server/global toggle)
            if (interaction.customId.startsWith('sc_')) {
                const statsCmd = client.commands.get('stats');
                if (statsCmd && statsCmd.handleButton) {
                    try {
                        const handled = await statsCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Stats Card Button Error: ${error.message}`, error);
                    }
                }
            }
            // Legacy stats leaderboard buttons (slb_*) — `statboard` now
            // delegates to the unified `ulb_*` handler, so old in-flight
            // messages with `slb_` ids just defer cleanly. New `statboard`
            // sessions emit `ulb_*` so they hit the unified handler below.
            if (interaction.customId.startsWith('slb_')) {
                try { await interaction.deferUpdate(); } catch { }
                return;
            }
            if (interaction.customId.startsWith('ulb_')) {
                const ulbCmd = client.commands.get('leaderboard');
                if (ulbCmd && ulbCmd.handleButton) {
                    try {
                        const handled = await ulbCmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Unified Leaderboard Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('vote_')) {
                const voteCmd = client.commands.get('vote-notify');
                if (voteCmd && voteCmd.handleInteraction) {
                    try {
                        const handled = await voteCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Vote Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('voterem_')) {
                const myVotesCmd = client.commands.get('myvotes');
                if (myVotesCmd && myVotesCmd.handleInteraction) {
                    try {
                        const handled = await myVotesCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`VoteRem Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('llb_')) {
                const llbCmd = client.commands.get('liveleaderboard');
                if (llbCmd && llbCmd.handleInteraction) {
                    try {
                        const handled = await llbCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`LiveLeaderboard Interaction Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId === 'adrop_claim') {
                try {
                    const handled = await require('./utils/animeDrops').handleClaim(interaction);
                    if (handled) return;
                } catch (error) {
                    log.error(`AnimeDrop Claim Error: ${error.message}`, error);
                }
            }
            if (interaction.customId.startsWith('ignorech_')) {
                const ignoreCmd = client.commands.get('ignore-channels');
                if (ignoreCmd && ignoreCmd.handleInteraction) {
                    try {
                        const handled = await ignoreCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Ignore Channels Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('botblock_')) {
                const bbCmd = client.commands.get('botblock');
                if (bbCmd && bbCmd.handleInteraction) {
                    try {
                        const handled = await bbCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Bot Block Button Error: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('invite_')) {
                const inviteCmd = client.commands.get('invite-setup');
                if (inviteCmd && inviteCmd.handleInteraction) {
                    try {
                        const handled = await inviteCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Invite Button Error: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                        return;
                    }
                }
            }
            // Route pets interactions (select menus / buttons)
            if (interaction.customId.startsWith('pets:') || interaction.customId.startsWith('pets_')) {
                const petsCmd = client.commands.get('pets');
                if (petsCmd && petsCmd.handleInteraction) {
                    try {
                        const handled = await petsCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Pets Interaction Error: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred processing this pets action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                        return;
                    }
                }
            }
            // Route suggestion system interactions (vote buttons + setup buttons)
            if (interaction.customId.startsWith('sug_')) {
                const suggestionCmd = client.commands.get('suggestion');
                if (suggestionCmd && suggestionCmd.handleInteraction) {
                    try {
                        const handled = await suggestionCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Suggestion Interaction Error: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                        return;
                    }
                }
            }
            // Route feedback system buttons
            if (interaction.customId.startsWith('fb_')) {
                const feedbackCmd = client.commands.get('feedback');
                if (feedbackCmd && feedbackCmd.handleInteraction) {
                    try {
                        await feedbackCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Feedback Interaction Error: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
                return;
            }
            // Route YouTube search pagination buttons
            if (interaction.customId.startsWith('yts_prev_') || interaction.customId.startsWith('yts_next_')) {
                const ytCmd = client.commands.get('yt');
                if (ytCmd && ytCmd.handlePageButton) {
                    try {
                        await ytCmd.handlePageButton(interaction);
                    } catch (error) {
                        log.error(`YouTube Search Pagination Error: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred. Try searching again.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
                return;
            }
            // Route games buttons. All 8 games now live in commands/economy/
            // as bet-based commands, each handling its own button prefix.
            // Each entry: { prefix, command name }.
            //
            // Challenge prefixes (tttch_, c4ch_, rpsch_, btlch_) and
            // game-specific prefixes (rps_, ttt_, c4_, …) are routed to
            // the same module that owns the game. Each module's
            // handleButton dispatches internally between challenge and
            // game-state buttons.
            const ECONOMY_GAME_BUTTONS = [
                { prefix: 'tttch_', cmd: 'tictactoe' },
                { prefix: 'ttt_', cmd: 'tictactoe' },
                { prefix: 'hangman_', cmd: 'hangman' },
                { prefix: 'numguess_', cmd: 'numguess' },
                { prefix: 'memory_', cmd: 'memory' },
                { prefix: 'g2048_', cmd: '2048' },
                { prefix: 'battleship_', cmd: 'battleship' },
                { prefix: 'c4ch_', cmd: 'connect4' },
                { prefix: 'c4_', cmd: 'connect4' },
                { prefix: 'rpsch_', cmd: 'rps' },
                { prefix: 'rps_', cmd: 'rps' },
                { prefix: 'btlch_', cmd: 'battle' }
            ];
            const ecoGame = ECONOMY_GAME_BUTTONS.find(g => interaction.customId.startsWith(g.prefix));
            if (ecoGame) {
                const cmd = client.commands.get(ecoGame.cmd);
                if (cmd?.handleButton) {
                    try {
                        const handled = await cmd.handleButton(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`${ecoGame.cmd} Button Error: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
                return;
            }
            // Route badge-edit interactions (buttons)
            if (interaction.customId.startsWith('badge_edit_') || interaction.customId.startsWith('badge_confirm_') || interaction.customId === 'badge_cancel_delete') {
                const badgeEditCmd = client.commands.get('badge-edit');
                if (badgeEditCmd && badgeEditCmd.handleInteraction) {
                    try {
                        const handled = await badgeEditCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Badge Edit Button Error: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                        return;
                    }
                }
            }
            // Route owner-badges umbrella help buttons (badges.js)
            if (interaction.customId.startsWith('badge_help_')) {
                const ownerBadgesCmd = client.commands.get('ownerbadges');
                if (ownerBadgesCmd && ownerBadgesCmd.handleInteraction) {
                    try {
                        const handled = await ownerBadgesCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Badge Help Button Error: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                        return;
                    }
                }
            }
            if (interaction.customId.startsWith('leveling_')) {
                const levelingCmd = client.commands.get('leveling-setup');
                if (levelingCmd && levelingCmd.handleInteraction) {
                    try {
                        const handled = await levelingCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Leveling Button Error: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                        return;
                    }
                }
            }
            if (interaction.customId.startsWith('autoresponder_')) {
                try {
                    return await handleAutoresponderButtons(interaction);
                } catch (error) {
                    log.error(`Autoresponder Button Error: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                    return;
                }
            }
            if (interaction.customId.startsWith('autoreact_')) {
                try {
                    return await handleAutoreactButtons(interaction);
                } catch (error) {
                    log.error(`Autoreact Button Error: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                    return;
                }
            }
            if (interaction.customId.startsWith('automod_')) {
                try {
                    return await handleAutomodButtons(interaction);
                } catch (error) {
                    log.error(`Automod Button Error: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                    return;
                }
            }
            if (interaction.customId.startsWith('antiraid_')) {
                const antiraidCmd = client.commands.get('antiraid');
                if (antiraidCmd && antiraidCmd.handleInteraction) {
                    try {
                        const handled = await antiraidCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Antiraid Interaction: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('antialt_')) {
                const antialtCmd = client.commands.get('antialt');
                if (antialtCmd && antialtCmd.handleInteraction) {
                    try {
                        const handled = await antialtCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`AntiAlt Interaction: ${error.message}`, error);
                    }
                }
                return;
            }
            // Handle verification panel builder buttons
            if (interaction.customId.startsWith('verifypanel:')) {
                const verifySetupCmd = client.commands.get('verification-setup');
                if (verifySetupCmd && verifySetupCmd.handleInteraction) {
                    try {
                        const handled = await verifySetupCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Verification Panel Builder: ${error.message}`, error);
                    }
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Could not process that action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }

            if (interaction.customId.startsWith('verification_') || interaction.customId.startsWith('captcha_')) {
                try {
                    return await handleVerificationButtons(interaction);
                } catch (error) {
                    log.error(`Verification: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error processing verification!', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('profile_') || interaction.customId.startsWith('rankcard_')) {
                return handleProfileButtons(interaction);
            }

            // Handle music filter buttons — delegate to commands/music/filters.js
            if (interaction.customId.startsWith('filter_')) {
                const player = client.lavalinkManager.getPlayer(interaction.guild.id);
                if (!player || !player.queue.current) return interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing!', flags: MessageFlags.Ephemeral });

                if (!interaction.member.voice.channel) {
                    return interaction.reply({ content: '<:Cancel:1521227723916181644> You need to be in a voice channel!', flags: MessageFlags.Ephemeral });
                }
                if (player.voiceChannelId && interaction.member.voice.channel.id !== player.voiceChannelId) {
                    return interaction.reply({ content: '<:Cancel:1521227723916181644> You need to be in the same voice channel as the bot!', flags: MessageFlags.Ephemeral });
                }

                const filter = interaction.customId.replace('filter_', '');
                try {
                    const filtersModule = require('./commands/music/filters.js');
                    const label = await filtersModule._applyFilter(player, filter);
                    if (!label) {
                        return interaction.reply({ content: `<:Cancel:1521227723916181644> Unknown filter \`${filter}\`.`, flags: MessageFlags.Ephemeral });
                    }
                    const container = filtersModule._buildAppliedContainer(label, filter);
                    return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                } catch (error) {
                    log.error('Filter apply error', error);
                    return interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to apply filter.', flags: MessageFlags.Ephemeral }).catch(() => { });
                }
            }

            // Handle join2create-setup admin dashboard buttons (must come BEFORE j2c_*)
            if (interaction.customId.startsWith('j2cset_')) {
                const j2cCmd = client.commands.get('join2create-setup');
                if (j2cCmd?.handleInteraction) {
                    try {
                        const handled = await j2cCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`J2C Setup Button: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error!', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
                return;
            }
            // Handle join2create interactive buttons
            if (interaction.customId.startsWith('j2c_')) {
                try {
                    await handleJ2CButtons(interaction);
                } catch (error) {
                    log.error(`Join2Create: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error!', flags: MessageFlags.Ephemeral }).catch(() => { });
                    } else if (interaction.deferred && !interaction.replied) {
                        await interaction.editReply({ content: '<:Cancel:1521227723916181644> There was an error!' }).catch(() => { });
                    }
                }
                return;
            }

            if (interaction.customId.startsWith('quicksetup_')) {
                const quicksetupCmd = client.commands.get('quicksetup');
                if (quicksetupCmd && quicksetupCmd.handleInteraction) {
                    try {
                        const handled = await quicksetupCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Quick Setup Button: ${error.message}`, error);
                    }
                }
                return;
            }

            if (interaction.customId.startsWith('roletemplate_')) {
                const rtCmd = client.commands.get('roletemplate');
                if (rtCmd && rtCmd.handleInteraction) {
                    try {
                        const handled = await rtCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Role Template Button: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('aichat_')) {
                const aichatCmd = client.commands.get('aichat-setup');
                if (aichatCmd && aichatCmd.handleInteraction) {
                    try {
                        const handled = await aichatCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`AI Chat Button: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('antinuke_')) {
                const { handleAntiNukeButtons } = require('./utils/interactionHandlers');
                return handleAntiNukeButtons(interaction);
            }
            if (interaction.customId.startsWith('app_')) {
                const appCmd = client.commands.get('application');
                if (appCmd && appCmd.handleInteraction) {
                    try {
                        await appCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Application Button: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('sshot_')) {
                const sshotCmd = client.commands.get('screenshot-verify');
                if (sshotCmd && sshotCmd.handleInteraction) {
                    try {
                        await sshotCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Screenshot Verify Button: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('anti_')) {
                const antiCmd = client.commands.get('anti');
                if (antiCmd && antiCmd.handleInteraction) {
                    try {
                        await antiCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Anti Limit Button: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('threat_')) {
                const threatCmd = client.commands.get('threatmode');
                if (threatCmd && threatCmd.handleInteraction) {
                    try {
                        await threatCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Threat Mode Button: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('superthreat_')) {
                const superThreatCmd = client.commands.get('superthreatmode');
                if (superThreatCmd && superThreatCmd.handleInteraction) {
                    try {
                        await superThreatCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Super Threat Mode Button: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('emergency_')) {
                const emergencyCmd = client.commands.get('emergency');
                if (emergencyCmd && emergencyCmd.handleInteraction) {
                    try {
                        await emergencyCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Emergency Button: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
                return;
            }

            // Handle button maker action editor buttons
            if (interaction.customId.startsWith('btn_action_') || interaction.customId.startsWith('btnmsg:') || interaction.customId.startsWith('btn_edit_action:') || interaction.customId.startsWith('btn_del_action:')) {
                const buttonMakerCmd = client.commands.get('button-maker');
                if (buttonMakerCmd && buttonMakerCmd.handleInteraction) {
                    try {
                        const handled = await buttonMakerCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Button Maker: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error!', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
                return;
            }

            // Handle select menu message builder buttons
            if (interaction.customId.startsWith('selmsg:')) {
                const selectMenuCmd = client.commands.get('select-menu-maker');
                if (selectMenuCmd && selectMenuCmd.handleInteraction) {
                    try {
                        const handled = await selectMenuCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Select Menu Message Builder: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error!', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
                return;
            }

            // Handle ticket-setup message builder buttons
            if (interaction.customId.startsWith('ticketmsg:') || interaction.customId.startsWith('ticketpanel:')) {
                const ticketSetupCmd = client.commands.get('ticket-setup');
                if (ticketSetupCmd && ticketSetupCmd.handleInteraction) {
                    try {
                        const handled = await ticketSetupCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Ticket Message Builder: ${error.message}`, error);
                    }
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Could not process that action. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }

            // Handle button command executions
            if (interaction.customId.startsWith('btn_cmd_')) {
                // Parse button data BEFORE try block so isEphemeral is in scope for catch
                let isEphemeral = true;
                try {
                    // Parse: btn_cmd_<guildId>_<buttonId>
                    // buttonId can contain underscores, so we can't use simple split
                    const prefixLength = 'btn_cmd_'.length;
                    const afterPrefix = interaction.customId.substring(prefixLength);
                    const firstUnderscorePos = afterPrefix.indexOf('_');

                    if (firstUnderscorePos === -1) {
                        const container = new ContainerBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder()
                                    .setContent('# <:Cancel:1521227723916181644> Invalid Button\n\nThis button has an invalid configuration.')
                            );
                        return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    }

                    const guildId = afterPrefix.substring(0, firstUnderscorePos);
                    const buttonId = afterPrefix.substring(firstUnderscorePos + 1);

                    const buttonsConfig = jsonStore.peek('button-commands') || {};
                    const btnData = buttonsConfig[guildId]?.[buttonId];

                    if (!btnData || !btnData.actions || btnData.actions.length === 0) {
                        const container = new ContainerBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder()
                                    .setContent('# <:Cancel:1521227723916181644> No Actions\n\nThis button has no actions configured!\n\nAdministrators can add actions with `/button-maker edit-actions`.')
                            );
                        return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    }

                    // Bump the usage counter (best-effort, fire-and-forget so a
                    // stuck write never blocks the action chain).
                    try {
                        btnData.uses = (btnData.uses || 0) + 1;
                        btnData.lastUsedAt = Date.now();
                        jsonStore.markDirty('button-commands');
                    } catch { /* non-fatal */ }

                    // Check ephemeral setting (default to true for backwards compatibility)
                    isEphemeral = btnData.ephemeral !== false;

                    // Build the ephemeral flags for editReply (must include Ephemeral to preserve it)
                    const replyFlags = MessageFlags.IsComponentsV2 | (isEphemeral ? MessageFlags.Ephemeral : 0);

                    // Defer reply for slow operations
                    await interaction.deferReply(isEphemeral ? { flags: MessageFlags.Ephemeral } : {});

                    // Execute all actions
                    let responseMsg = [];
                    let successCount = 0;
                    let errorCount = 0;

                    // Helper function to replace placeholders.
                    // Delegates to the canonical implementation in
                    // utils/actionMessageBuilder so the runtime supports
                    // EVERY token the builder UI documents — {user},
                    // {username}, {displayname}, {userid}, {useravatar},
                    // {server}, {servername}, {serverid}, {servericon},
                    // {membercount}, {channel}, {channelname},
                    // {boostcount}, {boostlevel}, {date}, {time},
                    // {timestamp} — and is case-insensitive. Previously
                    // the local copy only handled six tokens with
                    // case-sensitive matching, so anything else the
                    // user typed (e.g. {username} or {servername}) came
                    // through unreplaced.
                    const { replacePlaceholders: amBuilderReplace, buildComponentsV2Message } = require('./utils/actionMessageBuilder');
                    const replacePlaceholders = (text) =>
                        amBuilderReplace(text, interaction.user, interaction.guild, interaction.channel);

                    // Collect ephemeral message content (used when button is ephemeral)
                    let ephemeralContent = [];
                    let responseEmbeds = [];
                    let responseV2 = [];

                    /**
                     * Build a Components V2 container from an action config.
                     * Routes through the shared `buildComponentsV2Message`
                     * so we get fields, thumbnails, banners and footer
                     * formatting consistent with the slash /message-builder
                     * preview, then layers the action's accent color and
                     * placeholder substitution on top via a synthetic
                     * data object.
                     */
                    const buildActionV2Container = (action) => {
                        const data = {
                            content: action.content || '',
                            color: action.color || '#5865F2',
                            image: action.image || '',
                            thumbnail: action.thumbnail || '',
                            footer: action.footer || '',
                            fields: Array.isArray(action.fields) ? action.fields : [],
                        };
                        return buildComponentsV2Message(data, interaction.user, interaction.guild, interaction.channel);
                    };

                    for (const action of btnData.actions) {
                        try {
                            // Role actions
                            if (action.type === 'add_role') {
                                const role = interaction.guild.roles.cache.get(action.roleId);
                                if (!role) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> Role not found (deleted?)`);
                                    errorCount++;
                                } else if (role.position >= interaction.guild.members.me.roles.highest.position) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> Can't add ${role.name} - role is higher than bot's role`);
                                    errorCount++;
                                } else if (role.managed) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> Can't add ${role.name} - managed by integration`);
                                    errorCount++;
                                } else {
                                    await interaction.member.roles.add(role);
                                    responseMsg.push(`<:Checkedbox:1521227734943269077> Added role **${role.name}**`);
                                    successCount++;
                                }
                            } else if (action.type === 'remove_role') {
                                const role = interaction.guild.roles.cache.get(action.roleId);
                                if (!role) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> Role not found (deleted?)`);
                                    errorCount++;
                                } else if (!interaction.member.roles.cache.has(role.id)) {
                                    responseMsg.push(`ℹ️ You don't have ${role.name}`);
                                    successCount++;
                                } else if (role.position >= interaction.guild.members.me.roles.highest.position) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> Can't remove ${role.name} - role is higher than bot's role`);
                                    errorCount++;
                                } else {
                                    await interaction.member.roles.remove(role);
                                    responseMsg.push(`<:Checkedbox:1521227734943269077> Removed role **${role.name}**`);
                                    successCount++;
                                }
                            } else if (action.type === 'toggle_role') {
                                const role = interaction.guild.roles.cache.get(action.roleId);
                                if (!role) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> Role not found (deleted?)`);
                                    errorCount++;
                                } else if (role.position >= interaction.guild.members.me.roles.highest.position) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> Can't toggle ${role.name} - role is higher than bot's role`);
                                    errorCount++;
                                } else if (role.managed) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> Can't toggle ${role.name} - managed by integration`);
                                    errorCount++;
                                } else {
                                    if (interaction.member.roles.cache.has(action.roleId)) {
                                        await interaction.member.roles.remove(role);
                                        responseMsg.push(`<:Checkedbox:1521227734943269077> Removed role **${role.name}**`);
                                    } else {
                                        await interaction.member.roles.add(role);
                                        responseMsg.push(`<:Checkedbox:1521227734943269077> Added role **${role.name}**`);
                                    }
                                    successCount++;
                                }
                            }
                            // Message actions
                            else if (action.type === 'send_message') {
                                // When ephemeral is enabled and no specific target channel is set,
                                // deliver the message as part of the ephemeral reply instead of sending publicly
                                const hasExplicitChannel = action.channelId && action.channelId !== interaction.channel.id;

                                if (isEphemeral && !hasExplicitChannel) {
                                    // Ephemeral mode: collect message content to show in the ephemeral reply
                                    if (action.mode === 'embed' && action.embed) {
                                        // Store embed to attach in the final ephemeral reply
                                        if (!responseEmbeds) responseEmbeds = [];
                                        const embed = new EmbedBuilder();
                                        if (action.embed.title) embed.setTitle(replacePlaceholders(action.embed.title));
                                        if (action.embed.description) embed.setDescription(replacePlaceholders(action.embed.description));
                                        if (action.embed.color) embed.setColor(action.embed.color);
                                        if (action.embed.image) embed.setImage(action.embed.image);
                                        if (action.embed.thumbnail) embed.setThumbnail(action.embed.thumbnail);
                                        if (action.embed.author) embed.setAuthor({ name: replacePlaceholders(action.embed.author), iconURL: action.embed.authorIcon || undefined });
                                        if (action.embed.footer) embed.setFooter({ text: replacePlaceholders(action.embed.footer), iconURL: action.embed.footerIcon || undefined });
                                        if (action.embed.fields?.length > 0) {
                                            embed.addFields(action.embed.fields.map(f => ({ name: replacePlaceholders(f.name), value: replacePlaceholders(f.value), inline: f.inline })));
                                        }
                                        responseEmbeds.push(embed);
                                    } else if (action.mode === 'components' && action.content) {
                                        // Components V2 ephemeral: reuse the shared builder
                                        if (!responseV2) responseV2 = [];
                                        responseV2.push(buildActionV2Container(action));
                                    } else if (action.message) {
                                        if (!ephemeralContent) ephemeralContent = [];
                                        ephemeralContent.push(replacePlaceholders(action.message));
                                    } else {
                                        responseMsg.push(`<:Cancel:1521227723916181644> No message content configured`);
                                        errorCount++;
                                        continue;
                                    }
                                    successCount++;
                                } else {
                                    // Public mode or explicit channel: send to the target channel normally
                                    const targetChannel = hasExplicitChannel ? interaction.guild.channels.cache.get(action.channelId) : interaction.channel;
                                    if (!targetChannel) {
                                        responseMsg.push(`<:Cancel:1521227723916181644> Channel not found`);
                                        errorCount++;
                                    } else if (!targetChannel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
                                        responseMsg.push(`<:Cancel:1521227723916181644> No permission to send messages in ${targetChannel}`);
                                        errorCount++;
                                    } else {
                                        if (action.mode === 'components' && action.content) {
                                            // Components V2 public send
                                            const v2Container = buildActionV2Container(action);
                                            await targetChannel.send({ components: [v2Container], flags: MessageFlags.IsComponentsV2 });
                                        } else if (action.mode === 'embed' && action.embed) {
                                            const embed = new EmbedBuilder();
                                            if (action.embed.title) embed.setTitle(replacePlaceholders(action.embed.title));
                                            if (action.embed.description) embed.setDescription(replacePlaceholders(action.embed.description));
                                            if (action.embed.color) embed.setColor(action.embed.color);
                                            if (action.embed.image) embed.setImage(action.embed.image);
                                            if (action.embed.thumbnail) embed.setThumbnail(action.embed.thumbnail);
                                            if (action.embed.author) embed.setAuthor({ name: replacePlaceholders(action.embed.author), iconURL: action.embed.authorIcon || undefined });
                                            if (action.embed.footer) embed.setFooter({ text: replacePlaceholders(action.embed.footer), iconURL: action.embed.footerIcon || undefined });
                                            if (action.embed.fields?.length > 0) {
                                                embed.addFields(action.embed.fields.map(f => ({ name: replacePlaceholders(f.name), value: replacePlaceholders(f.value), inline: f.inline })));
                                            }
                                            await targetChannel.send({ embeds: [embed] });
                                        } else if (action.message) {
                                            await targetChannel.send(replacePlaceholders(action.message));
                                        } else {
                                            responseMsg.push(`<:Cancel:1521227723916181644> No message content configured`);
                                            errorCount++;
                                            continue;
                                        }
                                        responseMsg.push(`<:Checkedbox:1521227734943269077> Message sent to ${targetChannel}`);
                                        successCount++;
                                    }
                                }
                            } else if (action.type === 'send_dm') {
                                try {
                                    const message = replacePlaceholders(action.message);
                                    await interaction.user.send(message);
                                    responseMsg.push(`<:Checkedbox:1521227734943269077> DM sent`);
                                    successCount++;
                                } catch (dmError) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> Could not send DM (DMs disabled?)`);
                                    errorCount++;
                                }
                            }
                            // Ticket action
                            else if (action.type === 'create_ticket') {
                                if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> Bot needs Manage Channels permission`);
                                    errorCount++;
                                } else {
                                    const ticketName = replacePlaceholders(action.ticketName || 'ticket-{user}');
                                    const category = action.categoryId ? interaction.guild.channels.cache.get(action.categoryId) : null;

                                    // Reliable existing ticket check via tickets.json
                                    let ticketsConfig = {};
                                    if (jsonStore.has('tickets')) {
                                        ticketsConfig = jsonStore.read('tickets');
                                    }
                                    const guildTickets = ticketsConfig[interaction.guild.id]?.tickets || {};
                                    const existingEntry = Object.entries(guildTickets).find(([_, t]) => t.userId === interaction.user.id);
                                    const existingChannel = existingEntry ? interaction.guild.channels.cache.get(existingEntry[0]) : null;

                                    if (existingChannel) {
                                        responseMsg.push(`<:Cancel:1521227723916181644> You already have an open ticket: ${existingChannel}`);
                                        errorCount++;
                                    } else {
                                        // Clean stale entry if channel was deleted
                                        if (existingEntry) {
                                            delete guildTickets[existingEntry[0]];
                                        }

                                        // Get support role from ticket config if available
                                        const btnSupportRoleId = ticketsConfig[interaction.guild.id]?.supportRoleId;
                                        const btnPermOverwrites = [
                                            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                                            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                                            { id: interaction.guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
                                        ];
                                        if (btnSupportRoleId) {
                                            btnPermOverwrites.push({ id: btnSupportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
                                        }

                                        const ticketChannel = await interaction.guild.channels.create({
                                            name: ticketName,
                                            type: ChannelType.GuildText,
                                            parent: category,
                                            permissionOverwrites: btnPermOverwrites
                                        });

                                        // Persist ticket to tickets.json (reuse already-loaded config)
                                        if (!ticketsConfig[interaction.guild.id]) {
                                            ticketsConfig[interaction.guild.id] = { tickets: {} };
                                        }
                                        if (!ticketsConfig[interaction.guild.id].tickets) {
                                            ticketsConfig[interaction.guild.id].tickets = {};
                                        }
                                        ticketsConfig[interaction.guild.id].tickets[ticketChannel.id] = {
                                            userId: interaction.user.id,
                                            category: 'button-maker',
                                            categoryLabel: 'Button Maker Ticket',
                                            createdAt: Date.now()
                                        };
                                        jsonStore.write('tickets', ticketsConfig);

                                        // Send professional welcome message with buttons
                                        const ticketButtons = new ActionRowBuilder()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('ticket_claim')
                                                    .setLabel('Claim Ticket')
                                                    .setStyle(ButtonStyle.Primary)
                                                    .setEmoji('🎫'),
                                                new ButtonBuilder()
                                                    .setCustomId('ticket_close_btn')
                                                    .setLabel('Close Ticket')
                                                    .setStyle(ButtonStyle.Danger)
                                                    .setEmoji('<:Lock:1521227892770734120>'),
                                                new ButtonBuilder()
                                                    .setCustomId('ticket_transcript')
                                                    .setLabel('Save Transcript')
                                                    .setStyle(ButtonStyle.Secondary)
                                                    .setEmoji('<:Clipboardalt:1521228169753923755>')
                                            );

                                        const welcomeContainer = new ContainerBuilder()
                                            .addTextDisplayComponents(
                                                new TextDisplayBuilder()
                                                    .setContent(
                                                        `# 🎫 Support Ticket\n\n` +
                                                        `Welcome ${interaction.user}! Thank you for reaching out.\n\n` +
                                                        `**Created:** <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                                                        `Please describe your issue in detail and a team member will assist you shortly.`
                                                    )
                                            )
                                            .addActionRowComponents(ticketButtons);

                                        await ticketChannel.send({
                                            components: [welcomeContainer],
                                            flags: MessageFlags.IsComponentsV2
                                        });

                                        // Send ping message so role + user actually get notified
                                        const btnPingParts = [];
                                        if (btnSupportRoleId) btnPingParts.push(`<@&${btnSupportRoleId}>`);
                                        btnPingParts.push(`${interaction.user}`);
                                        await ticketChannel.send(`${btnPingParts.join(' ')} — A new ticket has been opened!`).catch(() => { });

                                        responseMsg.push(`<:Checkedbox:1521227734943269077> Ticket created: ${ticketChannel}`);
                                        successCount++;
                                    }
                                }
                            }
                            // Moderation actions - these require admin configuration and should not auto-execute on clicker
                            else if (action.type === 'kick' || action.type === 'ban' || action.type === 'timeout') {
                                responseMsg.push(`<:Inforect:1521228008285929532> Moderation action (${action.type}) configured but requires admin setup to specify target user`);
                                successCount++;
                            }
                            // Channel creation
                            else if (action.type === 'create_channel') {
                                if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> Bot needs Manage Channels permission`);
                                    errorCount++;
                                } else {
                                    const channelName = replacePlaceholders(action.channelName);
                                    const channelType = action.channelType === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
                                    const parent = action.categoryId ? interaction.guild.channels.cache.get(action.categoryId) : null;

                                    const newChannel = await interaction.guild.channels.create({
                                        name: channelName,
                                        type: channelType,
                                        parent: parent
                                    });
                                    responseMsg.push(`<:Checkedbox:1521227734943269077> Channel created: ${newChannel}`);
                                    successCount++;
                                }
                            }
                            // Embed action
                            else if (action.type === 'send_embed') {
                                const targetChannel = action.channelId ? interaction.guild.channels.cache.get(action.channelId) : interaction.channel;
                                if (!targetChannel) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> Channel not found`);
                                    errorCount++;
                                } else if (!targetChannel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> No permission to send messages in ${targetChannel}`);
                                    errorCount++;
                                } else if (!targetChannel.permissionsFor(interaction.guild.members.me).has(PermissionFlagsBits.EmbedLinks)) {
                                    responseMsg.push(`<:Cancel:1521227723916181644> No permission to send embeds in ${targetChannel}`);
                                    errorCount++;
                                } else {
                                    const hexColor = action.color?.replace('#', '') || '5865F2';
                                    const color = parseInt(hexColor, 16) || 0x5865F2;

                                    const title = replacePlaceholders(action.title);
                                    const description = replacePlaceholders(action.description);

                                    const embed = new EmbedBuilder()
                                        .setTitle(title)
                                        .setDescription(description)
                                        .setColor(color);

                                    await targetChannel.send({ embeds: [embed] });
                                    responseMsg.push(`<:Checkedbox:1521227734943269077> Embed sent to ${targetChannel}`);
                                    successCount++;
                                }
                            }
                        } catch (actionError) {
                            log.error(`Action error (${action.type}): ${actionError.message}`, actionError);
                            responseMsg.push(`<:Cancel:1521227723916181644> **${action.type}** failed: ${actionError.message.substring(0, 50)}`);
                            errorCount++;
                        }
                    }

                    // If we have ephemeral content from send_message actions, show them directly
                    // instead of the generic "Actions Complete" summary
                    if (isEphemeral && (ephemeralContent.length > 0 || responseEmbeds.length > 0 || responseV2.length > 0) && errorCount === 0) {
                        // Check if there are ONLY send_message actions (no role/ticket/etc status to show)
                        const hasNonMessageActions = responseMsg.length > 0;

                        // Components V2 cannot be combined with embeds or content in the same
                        // reply, so when V2 containers are present we send them first as the
                        // primary reply and any text/embeds as a follow-up.
                        if (responseV2.length > 0 && !hasNonMessageActions) {
                            await interaction.editReply({
                                components: responseV2,
                                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                            });
                            // Optional follow-ups for any plain content/embeds collected too
                            if (ephemeralContent.length > 0) {
                                await interaction.followUp({
                                    content: ephemeralContent.join('\n'),
                                    flags: MessageFlags.Ephemeral
                                }).catch(() => { });
                            }
                            if (responseEmbeds.length > 0) {
                                await interaction.followUp({
                                    embeds: responseEmbeds.slice(0, 10),
                                    flags: MessageFlags.Ephemeral
                                }).catch(() => { });
                            }
                        } else if (!hasNonMessageActions && ephemeralContent.length > 0 && responseEmbeds.length === 0) {
                            // Pure text message(s) — show them cleanly as ephemeral
                            await interaction.editReply({
                                content: ephemeralContent.join('\n'),
                                components: [],
                                flags: MessageFlags.Ephemeral
                            });
                        } else if (!hasNonMessageActions && responseEmbeds.length > 0 && ephemeralContent.length === 0) {
                            // Pure embed(s) — show them as ephemeral
                            await interaction.editReply({
                                embeds: responseEmbeds.slice(0, 10),
                                components: [],
                                flags: MessageFlags.Ephemeral
                            });
                        } else if (!hasNonMessageActions && responseEmbeds.length > 0 && ephemeralContent.length > 0) {
                            // Mixed text + embeds
                            await interaction.editReply({
                                content: ephemeralContent.join('\n'),
                                embeds: responseEmbeds.slice(0, 10),
                                components: [],
                                flags: MessageFlags.Ephemeral
                            });
                        } else {
                            // Has other action results too — show combined
                            let content = ephemeralContent.length > 0 ? ephemeralContent.join('\n') : '';
                            if (responseMsg.length > 0) {
                                content += (content ? '\n\n' : '') + responseMsg.join('\n');
                            }
                            const replyPayload = { flags: MessageFlags.Ephemeral };
                            if (content) replyPayload.content = content;
                            if (responseEmbeds.length > 0) replyPayload.embeds = responseEmbeds.slice(0, 10);
                            replyPayload.components = [];
                            await interaction.editReply(replyPayload);
                            // V2 containers go as a follow-up since they can't share a payload
                            if (responseV2.length > 0) {
                                await interaction.followUp({
                                    components: responseV2,
                                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                                }).catch(() => { });
                            }
                        }
                    } else {
                        // Build standard response with Components V2 summary
                        let statusEmoji = successCount > 0 ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';
                        let content = `# ${statusEmoji} Button Actions Complete\n\n`;

                        if (btnData.actions.length > 0) {
                            content += `**Summary:** ${successCount} successful, ${errorCount} failed\n\n`;
                        }

                        // Include any ephemeral content that couldn't be shown alone due to errors
                        if (ephemeralContent.length > 0) {
                            content += ephemeralContent.join('\n') + '\n\n';
                        }

                        if (responseMsg.length > 0) {
                            content += responseMsg.join('\n');
                        } else if (ephemeralContent.length === 0) {
                            content += '*No actions configured*';
                        }

                        const container = new ContainerBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder()
                                    .setContent(content)
                            );

                        const editPayload = { components: [container], flags: replyFlags };
                        if (responseEmbeds.length > 0) editPayload.embeds = responseEmbeds.slice(0, 10);
                        await interaction.editReply(editPayload);
                    }
                } catch (error) {
                    log.error(`Button Command: ${error.message}`, error);
                    const errFlags = MessageFlags.IsComponentsV2 | (isEphemeral ? MessageFlags.Ephemeral : 0);
                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder()
                                .setContent(`# <:Cancel:1521227723916181644> Execution Error\n\nThere was an error executing button actions!\n\n**Error:** ${error.message}\n\nPlease contact an administrator if this persists.`)
                        );

                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ components: [container], flags: errFlags });
                    } else {
                        await interaction.editReply({ components: [container], flags: errFlags });
                    }
                }
                return;
            }

            // Handle giveaway buttons
            if (interaction.customId.startsWith('giveaway_')) {
                const giveawayCmd = client.commands.get('giveaway');
                if (giveawayCmd && giveawayCmd.handleInteraction) {
                    try {
                        const handled = await giveawayCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Giveaway: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred!', flags: MessageFlags.Ephemeral });
                        }
                        return;
                    }
                }
            }

            // Handle poll buttons
            if (interaction.customId.startsWith('poll_vote_') || interaction.customId === 'poll_results' || interaction.customId === 'poll_end') {
                try {
                    let config = jsonStore.read('polls');
                    if (Array.isArray(config)) { config = {}; jsonStore.write('polls', config); }
                    const poll = config[interaction.guild.id]?.[interaction.message.id];

                    if (!poll) {
                        return interaction.reply({ content: '<:Cancel:1521227723916181644> Poll not found!', flags: MessageFlags.Ephemeral });
                    }

                    if (interaction.customId.startsWith('poll_vote_')) {
                        if (poll.ended) {
                            return interaction.reply({ content: '<:Cancel:1521227723916181644> This poll has ended!', flags: MessageFlags.Ephemeral });
                        }

                        const optionIndex = parseInt(interaction.customId.replace('poll_vote_', ''));

                        // Remove previous vote
                        poll.options.forEach(opt => {
                            const voteIndex = opt.votes.indexOf(interaction.user.id);
                            if (voteIndex > -1) opt.votes.splice(voteIndex, 1);
                        });

                        // Add new vote
                        poll.options[optionIndex].votes.push(interaction.user.id);
                        jsonStore.write('polls', config);

                        await interaction.reply({ content: `<:Checkedbox:1521227734943269077> Voted for **${poll.options[optionIndex].text}**!`, flags: MessageFlags.Ephemeral });
                    }

                    else if (interaction.customId === 'poll_results') {
                        const totalVotes = poll.options.reduce((sum, opt) => sum + opt.votes.length, 0);
                        const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

                        let resultsText = `# <:Bookopen:1521227911137595605>Poll Results\n\n**${poll.question}**\n\n`;
                        poll.options.forEach((opt, i) => {
                            const percentage = totalVotes > 0 ? ((opt.votes.length / totalVotes) * 100).toFixed(1) : 0;
                            resultsText += `${emojis[i]} **${opt.text}** - ${percentage}% (${opt.votes.length} votes)\n`;
                        });
                        resultsText += `\n**Total Votes:** ${totalVotes}`;

                        const container = new ContainerBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder()
                                    .setContent(resultsText)
                            );

                        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    }

                    else if (interaction.customId === 'poll_end') {
                        if (interaction.user.id !== poll.hostId && !interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                            return interaction.reply({ content: '<:Cancel:1521227723916181644> Only the poll host or moderators can end this poll!', flags: MessageFlags.Ephemeral });
                        }

                        const { endPoll } = require('./commands/automation/poll');
                        await endPoll(client, interaction.guild.id, interaction.message.id);
                        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Poll ended!', flags: MessageFlags.Ephemeral });
                    }
                } catch (error) {
                    log.error(`Poll: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error!', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }

            // ═══════ ToS Accept/Decline Buttons ═══════
            if (interaction.customId === 'tos_accept') {
                try {
                    const tosManager = require('./utils/tosManager');

                    // Acknowledge the button IMMEDIATELY so Discord doesn't show
                    // "This interaction failed" while we do async work (DM send, DB write).
                    await interaction.deferUpdate();

                    // Guard: if user already accepted (e.g. double-click while first
                    // response was in-flight), skip the DM to prevent duplicates.
                    const alreadyAccepted = tosManager.hasAcceptedTos(interaction.user.id);

                    let dmSent = false;
                    if (!alreadyAccepted) {
                        // Accept ToS (async — must await for data durability)
                        const saved = await tosManager.acceptTos(interaction.user.id);
                        if (!saved) {
                            return interaction.editReply({
                                content: '<:Cancel:1521227723916181644> Failed to save your acceptance. Please try again.',
                                components: []
                            }).catch(() => { });
                        }
                        // Send acceptance DM only on first acceptance
                        dmSent = await tosManager.sendAcceptanceDM(interaction.user);
                    }

                    const username = interaction.user.username || interaction.user.tag || 'User';

                    const container = new ContainerBuilder()
                        .setAccentColor(0x57F287)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# Terms of Service Accepted\n\n` +
                            `Thank you, **${username}**! You now have full access to all bot commands and features.`
                        ))
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `### <:Bookmark:1521227835526742066> Quick Start Guide\n` +
                            `<:Caretright:1521227704953864202> Type \`/help\` or \`-help\` to see all available commands\n` +
                            `<:Caretright:1521227704953864202> Check out \`/profile\` to view your user profile\n` +
                            `<:Caretright:1521227704953864202> Try music commands with \`/play <song>\`\n` +
                            `<:Caretright:1521227704953864202> Explore economy features with \`/daily\` and \`/balance\`\n\n` +
                            (dmSent
                                ? `<:Checkedbox:1521227734943269077> A detailed welcome message has been sent to your DMs.`
                                : (alreadyAccepted
                                    ? `<:Checkedbox:1521227734943269077> You have already accepted the Terms of Service.`
                                    : `⚠️ Couldn't send a DM (your DMs may be disabled). Enable DMs to receive bot notifications.`))
                        ))
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `-# Enjoy using xNico Bot! Need help? Join our support server.`
                        ));

                    await interaction.editReply({
                        components: [container],
                        flags: MessageFlags.IsComponentsV2
                    }).catch((error) => {
                        log.error(`[ToS] Failed to update accept interaction: ${error.message}`);
                    });
                } catch (error) {
                    log.error(`[ToS] Accept button error: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({
                            content: '<:Cancel:1521227723916181644> An error occurred processing your acceptance. Please try again.',
                            flags: MessageFlags.Ephemeral
                        }).catch(() => { });
                    } else {
                        await interaction.editReply({
                            content: '<:Cancel:1521227723916181644> An error occurred processing your acceptance. Please try again.',
                            components: []
                        }).catch(() => { });
                    }
                }
                return;
            }

            if (interaction.customId === 'tos_decline') {
                try {
                    const tosManager = require('./utils/tosManager');

                    // Acknowledge the button IMMEDIATELY
                    await interaction.deferUpdate();

                    // Guard: if user already declined, skip the DM to prevent duplicates
                    const alreadyDeclined = tosManager.hasDeclinedTos(interaction.user.id);

                    if (!alreadyDeclined) {
                        // Decline ToS (async — must await for data durability)
                        const saved = await tosManager.declineTos(interaction.user.id);
                        if (!saved) {
                            return interaction.editReply({
                                content: '<:Cancel:1521227723916181644> Failed to save your response. Please try again.',
                                components: []
                            }).catch(() => { });
                        }
                        // Send decline DM only on first decline
                        await tosManager.sendDeclineDM(interaction.user);
                    }

                    const username = interaction.user.username || interaction.user.tag || 'User';

                    const container = new ContainerBuilder()
                        .setAccentColor(0xED4245)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# Terms of Service Declined\n\n` +
                            `You have declined the Terms of Service, **${username}**.`
                        ))
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `### Access Restricted\n` +
                            `You cannot use bot commands until you accept the terms.\n\n` +
                            `### Changed Your Mind?\n` +
                            `You can accept the Terms of Service anytime by trying to use any bot command. You'll see the acceptance prompt again where you can click "Accept & Continue".`
                        ))
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `-# Have questions? Join our support server: <:xnico:1521228240440660180> [xNico Support](https://discord.gg/Zs35X7Umak)`
                        ));

                    await interaction.editReply({
                        components: [container],
                        flags: MessageFlags.IsComponentsV2
                    }).catch((error) => {
                        log.error(`[ToS] Failed to update decline interaction: ${error.message}`);
                    });
                } catch (error) {
                    log.error(`[ToS] Decline button error: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({
                            content: '<:Cancel:1521227723916181644> An error occurred processing your response. Please try again.',
                            flags: MessageFlags.Ephemeral
                        }).catch(() => { });
                    } else {
                        await interaction.editReply({
                            content: '<:Cancel:1521227723916181644> An error occurred processing your response. Please try again.',
                            components: []
                        }).catch(() => { });
                    }
                }
                return;
            }

            // ═══════ Recording Stop Button ═══════
            if (interaction.customId.startsWith('record_stop_')) {
                try {
                    const { stopRecording } = require('./utils/recordings');

                    // Permission check: only the recording actor or ManageGuild users can stop
                    const parts = interaction.customId.split('_');
                    const authorizedUserId = parts[3]; // record_stop_{guildId}_{userId}
                    if (authorizedUserId && interaction.user.id !== authorizedUserId) {
                        const member = interaction.member;
                        if (!member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
                            return interaction.reply({
                                content: '<:Cancel:1521227723916181644> Only the person who started the recording or a server manager can stop it.',
                                flags: MessageFlags.Ephemeral
                            });
                        }
                    }

                    // Helper function
                    const formatDuration = (ms) => {
                        const totalSeconds = Math.max(0, Math.round(ms / 1000));
                        const hours = Math.floor(totalSeconds / 3600);
                        const minutes = Math.floor((totalSeconds % 3600) / 60);
                        const seconds = totalSeconds % 60;
                        if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
                        return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
                    };

                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                    const result = await stopRecording(interaction.guild.id, { reason: 'manual stop via button' });

                    if (!result.ok) {
                        const errorContainer = new ContainerBuilder()
                            .setAccentColor(0xFEE75C)
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                                `# No Recording Found\n\n` +
                                `${result.message}`
                            ));

                        return interaction.editReply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
                    }

                    // Notify that recording stopped
                    const successContainer = new ContainerBuilder()
                        .setAccentColor(0x57F287)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# 🎙️ Recording Stopped\n\n` +
                            `Voice recording has been stopped successfully. Audio files are being processed and will be posted in the channel.`
                        ));

                    await interaction.editReply({ components: [successContainer], flags: MessageFlags.IsComponentsV2 });

                    // Post the recording result to the channel
                    const { recordingAudioPayload } = require('./utils/recordings');

                    const container = new ContainerBuilder()
                        .setAccentColor(0x57F287)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# 🎙️ Recording Complete\n\n` +
                            `Recording stopped by <@${interaction.user.id}>.`
                        ))
                        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `**Duration:** ${formatDuration(result.durationMs)}\n` +
                            `**Files:** ${result.files?.length || 0} track(s) recorded`
                        ));

                    await interaction.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });

                    // Send audio files
                    const audioPayload = recordingAudioPayload(result);
                    if (audioPayload) {
                        await interaction.channel.send(audioPayload).catch(() => { });
                    }
                } catch (error) {
                    log.error(`Recording stop button error: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to stop recording.', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }

            // Handle sticky message interactive buttons
            if (interaction.customId.startsWith('sticky_')) {
                try {
                    await handleStickyButtons(interaction);
                } catch (error) {
                    log.error(`Sticky: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error!', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }

            // Handle verification buttons
            if (interaction.customId.startsWith('verification_') || interaction.customId.startsWith('captcha_')) {
                try {
                    await handleVerificationButtons(interaction);
                } catch (error) {
                    log.error(`Verification: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error!', flags: MessageFlags.Ephemeral });
                    }
                }
                return;
            }

            // Handle profile customization buttons
            if (interaction.customId.startsWith('profile_')) {
                try {
                    await handleProfileButtons(interaction);
                } catch (error) {
                    log.error(`Profile: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error!', flags: MessageFlags.Ephemeral });
                    }
                }
                return;
            }

            // Handle help menu button from bot mention
            if (interaction.customId === 'show_help_menu') {
                const helpCommand = client.commands.get('help');
                if (helpCommand && helpCommand.execute) {
                    try {
                        await helpCommand.execute(interaction);
                    } catch (error) {
                        log.error(`Help button: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error showing the help menu!', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
                return;
            }

            // Handle serverlist pagination buttons (slist_first/prev/next/last)
            if (interaction.customId.startsWith('slist_')) {
                if (!isOwner(interaction.user.id)) {
                    return interaction.reply({ content: '<:Cancel:1521227723916181644> This command is only available to the bot owner!', flags: MessageFlags.Ephemeral });
                }

                await interaction.deferUpdate();

                const action = interaction.customId.split('_')[1]; // first|prev|next|last
                // Read current page from the disabled info button label "page/total"
                const infoBtn = interaction.message.components
                    ?.find(r => r.components?.some(c => c.customId === 'slist_info'))
                    ?.components?.find(c => c.customId === 'slist_info');
                const [curStr, totalStr] = (infoBtn?.label || '1/1').split('/');
                const currentPage = parseInt(curStr) || 1;
                const currentTotal = parseInt(totalStr) || 1;

                let page;
                if (action === 'first') page = 1;
                else if (action === 'prev') page = currentPage - 1;
                else if (action === 'next') page = currentPage + 1;
                else if (action === 'last') page = currentTotal;
                else page = currentPage;

                const serverlistCmd = client.commands.get('serverlist');
                const { container, row } = await serverlistCmd.renderPage(interaction.client, page);

                await interaction.editReply({ components: [container, row], flags: MessageFlags.IsComponentsV2 });
                return;
            }

            // Handle favorites buttons
            if (interaction.customId.startsWith('favorites_')) {
                const [_, action, pageStr] = interaction.customId.split('_');
                const page = parseInt(pageStr) || 1;

                const favorites = await models.FavoriteSong.find({ userId: interaction.user.id });
                if (!favorites || favorites.length === 0) {
                    return interaction.reply({ content: '<:Cancel:1521227723916181644> You have no favorites saved!', flags: MessageFlags.Ephemeral });
                }

                if (action === 'play' || action === 'shuffle') {
                    if (!interaction.member.voice.channel) {
                        return interaction.reply({ content: '<:Cancel:1521227723916181644> You need to be in a voice channel to play!', flags: MessageFlags.Ephemeral });
                    }
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                    let player = lavalinkManager.getPlayer(interaction.guild.id);
                    if (!player) {
                        player = await lavalinkManager.createPlayer({
                            guildId: interaction.guild.id,
                            voiceChannelId: interaction.member.voice.channel.id,
                            textChannelId: interaction.channel.id,
                            selfDeaf: true,
                            volume: 100
                        });
                    }
                    if (!player.connected) await player.connect();

                    let tracksToPlay = [...favorites];
                    if (action === 'shuffle') {
                        for (let i = tracksToPlay.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [tracksToPlay[i], tracksToPlay[j]] = [tracksToPlay[j], tracksToPlay[i]];
                        }
                    }

                    let added = 0;
                    for (const fav of tracksToPlay) {
                        try {
                            const result = await player.search({ query: fav.url }, interaction.user);
                            if (result && result.tracks && result.tracks[0]) {
                                player.queue.add(result.tracks[0]);
                                added++;
                            }
                        } catch (e) { }
                    }

                    if (!player.playing && !player.paused && player.queue.tracks.length > 0) {
                        await player.play();
                    }

                    return interaction.editReply({ content: `<:Checkedbox:1521227734943269077> Added **${added}** favorites to queue${action === 'shuffle' ? ' (shuffled)' : ''}!` });
                }

                if (action === 'prev' || action === 'next') {
                    const totalPages = Math.ceil(favorites.length / 10);
                    const newPage = action === 'prev' ? Math.max(1, page - 1) : Math.min(totalPages, page + 1);

                    const start = (newPage - 1) * 10;
                    const pageSongs = favorites.slice(start, start + 10);

                    let content = `# <:Heart:1521228100652765247> Your Favorites\n\n`;
                    content += `-# ${favorites.length} songs saved\n\n`;
                    pageSongs.forEach((song, i) => {
                        const title = (song.title || 'Unknown').substring(0, 40);
                        content += `**${start + i + 1}.** ${title}\n`;
                        content += `-# by ${song.author || 'Unknown'}\n\n`;
                    });
                    content += `-# Page ${newPage}/${totalPages}`;

                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`favorites_prev_${newPage}`).setEmoji('<:Caretleft:1521227977495543838>').setStyle(ButtonStyle.Secondary).setDisabled(newPage === 1),
                        new ButtonBuilder().setCustomId(`favorites_play_${newPage}`).setEmoji({ id: '1521228437711225126', name: 'Skipnext' }).setLabel('Play All').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`favorites_shuffle_${newPage}`).setEmoji({ id: '1521228321403437228', name: 'Shuffle' }).setLabel('Shuffle').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId(`favorites_next_${newPage}`).setEmoji('<:Caretright:1521227704953864202>').setStyle(ButtonStyle.Secondary).setDisabled(newPage === totalPages)
                    );
                    container.addActionRowComponents(row);

                    await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
                return;
            }

            // Handle premium info buttons (premium_view_status / features / pricing)
            if (interaction.customId.startsWith('premium_view_')) {
                try {
                    const premiumCmd = client.commands.get('premium');
                    if (premiumCmd?.handleButton) {
                        const handled = await premiumCmd.handleButton(interaction);
                        if (handled) return;
                    }
                } catch (e) {
                    log.error(`Premium button handler: ${e.message}`, e);
                }
            }

            // Handle recommendations buttons
            if (interaction.customId.startsWith('rec_')) {
                const cache = interaction.client.recommendationCache?.get(interaction.message.id);

                if (!cache || Date.now() > cache.expires) {
                    return interaction.reply({ content: '<:Cancel:1521227723916181644> Recommendations expired. Use `/recommendations` again!', flags: MessageFlags.Ephemeral });
                }

                if (interaction.user.id !== cache.userId) {
                    return interaction.reply({ content: '<:Cancel:1521227723916181644> These recommendations are for someone else!', flags: MessageFlags.Ephemeral });
                }

                if (!interaction.member.voice.channel) {
                    return interaction.reply({ content: '<:Cancel:1521227723916181644> You need to be in a voice channel!', flags: MessageFlags.Ephemeral });
                }

                let player = lavalinkManager.getPlayer(interaction.guild.id);
                if (!player) {
                    player = await lavalinkManager.createPlayer({
                        guildId: interaction.guild.id,
                        voiceChannelId: interaction.member.voice.channel.id,
                        textChannelId: interaction.channel.id,
                        selfDeaf: true,
                        volume: 100
                    });
                }
                if (!player.connected) await player.connect();

                const [__, action, indexStr] = interaction.customId.split('_');

                if (action === 'add' && indexStr === 'all') {
                    for (const track of cache.tracks) {
                        player.queue.add(track);
                    }
                    if (!player.playing && !player.paused) await player.play();
                    return interaction.reply({ content: `<:Checkedbox:1521227734943269077> Added **${cache.tracks.length}** recommendations to queue!`, flags: MessageFlags.Ephemeral });
                }

                const index = parseInt(indexStr);
                if (!isNaN(index) && cache.tracks[index]) {
                    const track = cache.tracks[index];
                    player.queue.add(track);
                    if (!player.playing && !player.paused) await player.play();
                    return interaction.reply({ content: `<:Checkedbox:1521227734943269077> Added **${track.info.title.substring(0, 40)}** to queue!`, flags: MessageFlags.Ephemeral });
                }

                return;
            }

            // ────────────────── Ticket Categories Picker ──────────────────
            // The select-menu / button handler that runs when an admin
            // adds a category and then chooses which panels should show
            // it. Routes to ticket-categories.handleInteraction.
            if (interaction.customId?.startsWith('tcat_pick')) {
                const ticketCatCmd = client.commands.get('ticket-categories');
                if (ticketCatCmd?.handleInteraction) {
                    try {
                        const handled = await ticketCatCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (err) {
                        log.error(`[ticket-categories picker] ${err.message}`, err);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({
                                content: '<:Cancel:1521227723916181644> Failed to apply panel scoping.',
                                flags: MessageFlags.Ephemeral,
                            }).catch(() => { });
                        }
                        return;
                    }
                }
            }

            // ─────────────────────────── Ticket Buttons ───────────────────────────
            // Centralized helpers for all ticket-channel button interactions.
            // Keeps permission checks, copy and styling consistent across the
            // claim / close / transcript flow.
            if (
                interaction.customId === 'ticket_claim' ||
                interaction.customId === 'ticket_close_btn' ||
                interaction.customId === 'ticket_close_confirm' ||
                interaction.customId === 'ticket_close_cancel' ||
                interaction.customId === 'ticket_transcript'
            ) {
                const ticketUI = require('./utils/ticketUI');
                const { ensureMigrated } = require('./utils/ticketPanels');
                const ticketCloseCmd = require('./commands/automation/ticket-close');

                /* ─────────────── Ticket Claim ─────────────── */
                if (interaction.customId === 'ticket_claim') {
                    try {
                        const config = readTicketsConfig();
                        const guildConfig = ensureMigrated(config[interaction.guild.id]);
                        const ticket = guildConfig?.tickets?.[interaction.channel.id];

                        if (!guildConfig || !ticket) {
                            return interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.errorContainer('This is not a ticket channel.'), true),
                            });
                        }
                        if (ticket.claimedBy) {
                            const claimer = await interaction.guild.members.fetch(ticket.claimedBy).catch(() => null);
                            return interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.warnContainer(
                                    `This ticket is already claimed by **${claimer ? claimer.user.username : 'someone'}**.`
                                ), true),
                            });
                        }
                        if (!ticketUI.canManageTicket(interaction.member, guildConfig, ticket, { level: 'staff' })) {
                            return interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.errorContainer('Only support team members or admins can claim tickets.'), true),
                            });
                        }

                        ticket.claimedBy = interaction.user.id;
                        ticket.claimedAt = Date.now();
                        jsonStore.write('tickets', config);

                        // Note: we don't try to disable the original welcome's
                        // Claim button — V2 containers don't allow surgical
                        // edits of an inline action row, and re-sending a new
                        // welcome would lose user context. The duplicate-claim
                        // guard above is what actually prevents double-claims.

                        const container = ticketUI.buildContainer(
                            `# ${ticketUI.E.ok} Ticket Claimed\n\n` +
                            `${interaction.user} has claimed this ticket and will assist you shortly.\n\n` +
                            `${ticketUI.E.right} **Claimed at:** <t:${Math.floor(Date.now() / 1000)}:F>`,
                            ticketUI.COLOR.SUCCESS
                        );
                        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    } catch (error) {
                        log.error(`[ticket_claim] ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.errorContainer('Failed to claim ticket.'), true),
                            }).catch(() => { });
                        }
                    }
                    return;
                }

                /* ─────────────── Ticket Close (open confirm) ─────────────── */
                if (interaction.customId === 'ticket_close_btn') {
                    try {
                        const config = readTicketsConfig();
                        const guildConfig = ensureMigrated(config[interaction.guild.id]);
                        const ticket = guildConfig?.tickets?.[interaction.channel.id];

                        if (!guildConfig || !ticket) {
                            return interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.errorContainer('This is not a ticket channel.'), true),
                            });
                        }
                        if (!ticketUI.canManageTicket(interaction.member, guildConfig, ticket)) {
                            return interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.errorContainer('Only the ticket owner, claimer, support team or admins can close this ticket.'), true),
                            });
                        }

                        const confirmRow = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('ticket_close_confirm')
                                .setLabel('Confirm Close')
                                .setStyle(ButtonStyle.Danger)
                                .setEmoji(ticketUI.E.lock),
                            new ButtonBuilder()
                                .setCustomId('ticket_close_cancel')
                                .setLabel('Cancel')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji(ticketUI.E.cancel),
                        );

                        const container = new ContainerBuilder()
                            .setAccentColor(ticketUI.COLOR.WARNING)
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                                `# ${ticketUI.E.warn} Confirm Ticket Close\n\n` +
                                `${interaction.user}, please confirm you want to close this ticket.\n\n` +
                                `${ticketUI.E.right} **Channel:** ${interaction.channel}\n` +
                                `${ticketUI.E.right} **Opened by:** <@${ticket.userId}>\n` +
                                `${ticketUI.E.right} **Category:** ${ticket.categoryLabel || 'N/A'}\n\n` +
                                `*This will delete the channel after a brief delay. Transcripts (if enabled) are sent before deletion.*`
                            ))
                            .addActionRowComponents(confirmRow);

                        // Ephemeral so the dialog doesn't clutter the ticket channel
                        await interaction.reply({
                            components: [container],
                            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                        });
                    } catch (error) {
                        log.error(`[ticket_close_btn] ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.errorContainer('Failed to open close dialog.'), true),
                            }).catch(() => { });
                        }
                    }
                    return;
                }

                /* ─────────────── Ticket Close (confirm) ─────────────── */
                if (interaction.customId === 'ticket_close_confirm') {
                    try {
                        const config = readTicketsConfig();
                        const guildConfig = ensureMigrated(config[interaction.guild.id]);
                        const ticket = guildConfig?.tickets?.[interaction.channel.id];

                        if (!guildConfig || !ticket) {
                            return interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.errorContainer('Ticket data not found — it may have already been closed.'), true),
                            });
                        }
                        if (!ticketUI.canManageTicket(interaction.member, guildConfig, ticket)) {
                            return interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.errorContainer('Only the ticket owner, claimer, support team or admins can close this ticket.'), true),
                            });
                        }

                        const closingChannel = interaction.channel;
                        const closingGuild = interaction.guild;
                        const tMode = guildConfig.transcriptMode || 'manual';
                        const wantsAuto = (tMode === 'auto' || tMode === 'both') && !!guildConfig.transcriptChannelId;

                        // Acknowledge the (ephemeral) confirm button. We do this
                        // *before* mutating the store so a network glitch on the
                        // ack doesn't leave us with a deleted ticket entry but
                        // a still-open channel.
                        try {
                            await interaction.update({
                                components: [ticketUI.successContainer('Closing ticket and saving transcript…')],
                            });
                        } catch (ackErr) {
                            log.error(`[ticket_close_confirm] ack failed, ticket left intact: ${ackErr.message}`);
                            return;
                        }

                        // Now safe to remove from store
                        delete guildConfig.tickets[closingChannel.id];
                        jsonStore.write('tickets', config);

                        const opened = ticket.createdAt ? `<t:${Math.floor(ticket.createdAt / 1000)}:R>` : 'unknown';
                        const dur = ticket.createdAt ? ticketUI.formatDuration(Date.now() - ticket.createdAt) : 'unknown';
                        const closingContainer = new ContainerBuilder()
                            .setAccentColor(ticketUI.COLOR.DANGER)
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                                `# ${ticketUI.E.lock} Ticket Closed\n\n` +
                                `Closed by ${interaction.user}.\n\n` +
                                `### ${ticketUI.E.clipboard} Summary\n` +
                                `${ticketUI.E.right} **Channel:** ${closingChannel.name}\n` +
                                `${ticketUI.E.right} **Category:** ${ticket.categoryLabel || 'N/A'}\n` +
                                `${ticketUI.E.right} **Opened:** ${opened}\n` +
                                `${ticketUI.E.right} **Duration:** ${dur}\n\n` +
                                (wantsAuto
                                    ? `${ticketUI.E.transcript} *Saving transcript and deleting in **8 seconds**…*`
                                    : `${ticketUI.E.warn} *This channel will be deleted in **5 seconds**…*`)
                            ));
                        await closingChannel.send({
                            components: [closingContainer],
                            flags: MessageFlags.IsComponentsV2,
                        }).catch(() => { });

                        await ticketCloseCmd.performClose({
                            client,
                            channel: closingChannel,
                            guild: closingGuild,
                            ticket,
                            byTag: `${interaction.user.tag} (button close)`,
                            guildConfig,
                        });
                    } catch (error) {
                        log.error(`[ticket_close_confirm] ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.errorContainer('Failed to close ticket.'), true),
                            }).catch(() => { });
                        }
                    }
                    return;
                }

                /* ─────────────── Ticket Close (cancel) ─────────────── */
                if (interaction.customId === 'ticket_close_cancel') {
                    await interaction.update({
                        components: [ticketUI.infoContainer('Close cancelled.')],
                    }).catch(() => { });
                    return;
                }

                /* ─────────────── Ticket Transcript ─────────────── */
                if (interaction.customId === 'ticket_transcript') {
                    try {
                        const config = readTicketsConfig();
                        const guildConfig = ensureMigrated(config[interaction.guild.id]);
                        const ticket = guildConfig?.tickets?.[interaction.channel.id];

                        if (!guildConfig || !ticket) {
                            return interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.errorContainer('This is not a ticket channel.'), true),
                            });
                        }
                        if (!ticketUI.canManageTicket(interaction.member, guildConfig, ticket)) {
                            return interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.errorContainer('Only the ticket owner, claimer or support team can save transcripts.'), true),
                            });
                        }

                        const tMode = guildConfig.transcriptMode || 'manual';
                        if (tMode === 'off') {
                            return interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.errorContainer('Transcripts are disabled on this server. Ask an admin to run `/ticket-setup transcript`.'), true),
                            });
                        }
                        if (tMode === 'auto') {
                            return interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.infoContainer('This server uses **auto** transcripts — the transcript will be posted to the log channel when the ticket closes.'), true),
                            });
                        }

                        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

                        const { fetchAllMessages, buildTranscriptAttachments, postTranscriptToLogChannel } = require('./utils/ticketTranscript');
                        const messages = await fetchAllMessages(interaction.channel, { limit: 2000 });

                        const opener = ticket.userId ? await interaction.client.users.fetch(ticket.userId).catch(() => null) : null;
                        const claimer = ticket.claimedBy ? await interaction.client.users.fetch(ticket.claimedBy).catch(() => null) : null;

                        const meta = {
                            channelId: interaction.channel.id,
                            channelName: interaction.channel.name,
                            guildName: interaction.guild.name,
                            openerTag: opener?.tag || ticket.userId,
                            openerId: ticket.userId,
                            categoryLabel: ticket.categoryLabel || 'N/A',
                            createdAt: ticket.createdAt,
                            closedAt: Date.now(),
                            closedBy: `${interaction.user.tag} (manual save)`,
                            claimedByTag: claimer?.tag,
                            addedMembers: (ticket.members || []).map(id => ({ id })),
                            messageCount: messages.length,
                        };

                        const attachments = buildTranscriptAttachments(messages, meta);
                        if (guildConfig.transcriptChannelId) {
                            await postTranscriptToLogChannel(interaction.guild, guildConfig.transcriptChannelId, attachments, meta).catch(() => null);
                        }

                        await interaction.editReply({
                            content: `${ticketUI.E.ok} Transcript generated with **${messages.length}** message(s).`,
                            files: attachments,
                        });
                    } catch (error) {
                        log.error(`[ticket_transcript] ${error.message}`, error);
                        if (interaction.deferred) {
                            await interaction.editReply({ content: `${require('./utils/ticketUI').E.cancel} Failed to generate transcript.` }).catch(() => { });
                        } else if (!interaction.replied) {
                            await interaction.reply({
                                ...ticketUI.v2Reply(ticketUI.errorContainer('Failed to generate transcript.'), true),
                            }).catch(() => { });
                        }
                    }
                    return;
                }
            }

            // Legacy create_ticket button (keep for backwards compatibility)
            if (interaction.customId === 'create_ticket') {
                const ticketUI = require('./utils/ticketUI');
                const lockedNow = ticketUI.lockCreation(interaction.guild.id, interaction.user.id);
                if (!lockedNow) {
                    return interaction.reply({
                        ...ticketUI.v2Reply(ticketUI.warnContainer('You already have a ticket being created — please wait a moment.'), true),
                    });
                }

                try {
                    const config = readTicketsConfig();
                    const guildConfig = config[interaction.guild.id];
                    if (!guildConfig) {
                        return interaction.reply({ content: '<:Cancel:1521227723916181644> Ticket system is not configured!', flags: MessageFlags.Ephemeral });
                    }

                    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);

                    const existingTicket = Object.entries(guildConfig.tickets || {}).find(([_, ticket]) => ticket.userId === interaction.user.id);
                    if (existingTicket) {
                        const existingChannel = interaction.guild.channels.cache.get(existingTicket[0]);
                        if (existingChannel) {
                            return interaction.editReply({ content: `<:Inforect:1521228008285929532> You already have an open ticket: ${existingChannel}` });
                        } else {
                            delete guildConfig.tickets[existingTicket[0]];
                            jsonStore.write('tickets', config);
                        }
                    }

                    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
                        return interaction.editReply({ content: '<:Cancel:1521227723916181644> I don\'t have permission to create channels! Please contact an administrator.' });
                    }

                    // Atomic-ish ticket number bump (re-read live config)
                    const liveConfig = readTicketsConfig();
                    const liveGuildConfig = liveConfig[interaction.guild.id] || guildConfig;
                    const ticketCount = Object.keys(liveGuildConfig.tickets || {}).length;
                    liveGuildConfig.nextTicketNumber = Math.max(
                        (liveGuildConfig.nextTicketNumber || 0) + 1,
                        ticketCount + 1
                    );
                    const ticketNumber = liveGuildConfig.nextTicketNumber;
                    jsonStore.write('tickets', liveConfig);

                    const { buildTicketChannelName: buildLegacyName } = require('./utils/ticketTranscript');
                    const ticketChannelName = buildLegacyName('ticket', interaction.user.username, ticketNumber);

                    const category = interaction.guild.channels.cache.get(liveGuildConfig.categoryId);
                    if (!category) {
                        // Roll back the number bump so the next user
                        // doesn't see a phantom gap.
                        const rollback = readTicketsConfig();
                        const rgc = rollback[interaction.guild.id];
                        if (rgc?.nextTicketNumber === ticketNumber) {
                            rgc.nextTicketNumber = Math.max(0, ticketNumber - 1);
                            jsonStore.write('tickets', rollback);
                        }
                        return interaction.editReply({ content: '<:Cancel:1521227723916181644> Ticket category not found!' });
                    }

                    let ticketChannel;
                    try {
                        ticketChannel = await interaction.guild.channels.create({
                            name: ticketChannelName,
                            parent: category.id,
                            topic: `🎫 Support Ticket • Opened by ${interaction.user.tag} • #${ticketNumber}`,
                            permissionOverwrites: [
                                { id: interaction.guild.id, deny: ['ViewChannel'] },
                                { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks'] },
                                { id: liveGuildConfig.supportRoleId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks', 'ManageMessages'] },
                                { id: interaction.client.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks', 'ManageChannels'] }
                            ]
                        });
                    } catch (createErr) {
                        // Channel creation failed — roll back the number
                        // bump so the next ticket doesn't skip a digit.
                        const rollback = readTicketsConfig();
                        const rgc = rollback[interaction.guild.id];
                        if (rgc?.nextTicketNumber === ticketNumber) {
                            rgc.nextTicketNumber = Math.max(0, ticketNumber - 1);
                            jsonStore.write('tickets', rollback);
                        }
                        throw createErr;
                    }

                    liveGuildConfig.tickets = liveGuildConfig.tickets || {};
                    liveGuildConfig.tickets[ticketChannel.id] = {
                        userId: interaction.user.id,
                        category: 'general',
                        categoryLabel: 'General',
                        ticketNumber,
                        createdAt: Date.now()
                    };
                    jsonStore.write('tickets', liveConfig);

                    const ticketButtons = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId('ticket_claim')
                                .setLabel('Claim Ticket')
                                .setStyle(ButtonStyle.Primary)
                                .setEmoji('<:Inforect:1521228008285929532>'),
                            new ButtonBuilder()
                                .setCustomId('ticket_close_btn')
                                .setLabel('Close Ticket')
                                .setStyle(ButtonStyle.Danger)
                                .setEmoji('<:Lock:1521227892770734120>'),
                            new ButtonBuilder()
                                .setCustomId('ticket_transcript')
                                .setLabel('Save Transcript')
                                .setStyle(ButtonStyle.Secondary)
                                .setEmoji('<:Clipboardalt:1521228169753923755>')
                        );

                    // Build welcome message - use custom if configured, otherwise default
                    const legacyWelcome = guildConfig.welcomeMessage;
                    const legacyWelcomeConfigured = legacyWelcome && (
                        (legacyWelcome.mode === 'embed' && (legacyWelcome.title || legacyWelcome.description)) ||
                        (legacyWelcome.mode === 'simple' && legacyWelcome.content) ||
                        (legacyWelcome.mode === 'components' && legacyWelcome.content)
                    );
                    if (legacyWelcomeConfigured) {
                        const { replacePlaceholders: legReplace, buildComponentsV2Message: buildLegacyV2 } = require('./utils/actionMessageBuilder');
                        if (legacyWelcome.mode === 'components') {
                            // Components V2 mode: route through the shared
                            // builder so the saved layout (sections,
                            // thumbnail, banner, fields, footer) renders
                            // exactly like the message-builder preview.
                            const headerLine = `# <:Document:1521227875016114266> Support Ticket\n` +
                                `**Ticket #${ticketNumber}** • **Created:** <t:${Math.floor(Date.now() / 1000)}:R>`;
                            const v2 = buildLegacyV2(legacyWelcome, interaction.user, interaction.guild, ticketChannel);
                            try {
                                v2.spliceComponents(0, 0, new TextDisplayBuilder().setContent(headerLine));
                            } catch {
                                v2.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerLine));
                            }
                            v2.addActionRowComponents(ticketButtons);
                            await ticketChannel.send({ components: [v2], flags: MessageFlags.IsComponentsV2 }).catch(err => {
                                log.error(`Error sending ticket message: ${err.message}`, err);
                            });
                        } else if (legacyWelcome.mode === 'embed') {
                            // embeds + IsComponentsV2 cannot coexist — flatten the embed into V2 text
                            let embedText = `# <:Document:1521227875016114266> Support Ticket\n`;
                            embedText += `**Ticket #${ticketNumber}** • **Created:** <t:${Math.floor(Date.now() / 1000)}:R>\n\n`;
                            if (legacyWelcome.author) embedText += `*${legReplace(legacyWelcome.author, interaction.user, interaction.guild, ticketChannel)}*\n`;
                            if (legacyWelcome.title) embedText += `### ${legReplace(legacyWelcome.title, interaction.user, interaction.guild, ticketChannel)}\n`;
                            if (legacyWelcome.description) embedText += `${legReplace(legacyWelcome.description, interaction.user, interaction.guild, ticketChannel)}\n`;
                            if (legacyWelcome.fields?.length) {
                                embedText += '\n';
                                for (const field of legacyWelcome.fields.slice(0, 25)) {
                                    embedText += `**${legReplace(field.name, interaction.user, interaction.guild, ticketChannel)}**\n${legReplace(field.value, interaction.user, interaction.guild, ticketChannel)}\n\n`;
                                }
                            }
                            if (legacyWelcome.footer) embedText += `\n-# ${legReplace(legacyWelcome.footer, interaction.user, interaction.guild, ticketChannel)}`;

                            const container = new ContainerBuilder()
                                .setAccentColor(parseInt((legacyWelcome.color || '#5865F2').replace('#', ''), 16))
                                .addTextDisplayComponents(new TextDisplayBuilder().setContent(embedText))
                                .addActionRowComponents(ticketButtons);
                            await ticketChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(err => {
                                log.error(`Error sending ticket message: ${err.message}`, err);
                            });
                        } else {
                            const customContent = legReplace(legacyWelcome.content, interaction.user, interaction.guild, ticketChannel);
                            const container = new ContainerBuilder()
                                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                                    `# <:Document:1521227875016114266> Support Ticket\n**Ticket #${ticketNumber}** • **Created:** <t:${Math.floor(Date.now() / 1000)}:R>\n\n${customContent}`
                                ))
                                .addActionRowComponents(ticketButtons);
                            await ticketChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(err => {
                                log.error(`Error sending ticket message: ${err.message}`, err);
                            });
                        }
                    } else {
                        const container = new ContainerBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder()
                                    .setContent(
                                        `# <:Document:1521227875016114266> Support Ticket\n\n` +
                                        `Welcome ${interaction.user} — thanks for reaching out.\n\n` +
                                        `### <:Clipboard:1521228175298920448> Ticket Details\n` +
                                        `<:Caretright:1521227704953864202> **Ticket Number:** \`#${ticketNumber}\`\n` +
                                        `<:Caretright:1521227704953864202> **Opened:** <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                                        `### <:Lightbulbalt:1521227880703463675> What to do next\n` +
                                        `Please describe your issue in detail. A support team member will assist you shortly.\n\n` +
                                        `### <:Settings:1521227767780343879> Useful Commands\n` +
                                        `\`/ticket-add @user\` — invite someone\n` +
                                        `\`/ticket-remove @user\` — remove someone\n` +
                                        `\`/ticket-close\` — close this ticket`
                                    )
                            )
                            .addActionRowComponents(ticketButtons);
                        await ticketChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(err => {
                            log.error(`Error sending ticket message: ${err.message}`, err);
                        });
                    }

                    // Separate ping message — role and user mentioned with explicit allowedMentions
                    const legacyPingParts = [];
                    if (liveGuildConfig.supportRoleId) legacyPingParts.push(`<@&${liveGuildConfig.supportRoleId}>`);
                    legacyPingParts.push(`${interaction.user}`);
                    await ticketChannel.send({
                        content: `${legacyPingParts.join(' ')}`,
                        allowedMentions: { roles: liveGuildConfig.supportRoleId ? [liveGuildConfig.supportRoleId] : [], users: [interaction.user.id] }
                    }).catch(() => { });

                    interaction.user.send({
                        content: `<:Checkedbox:1521227734943269077> Your support ticket has been opened in **${interaction.guild.name}**.\n` +
                            `Jump to it: ${ticketChannel.url}`
                    }).catch(() => { });

                    const successContainer = new ContainerBuilder()
                        .setAccentColor(0x57F287)
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                            `# <:Checkedbox:1521227734943269077> Ticket Created\n\n` +
                            `Your ticket is ready: ${ticketChannel}\n` +
                            `Ticket Number: \`#${ticketNumber}\``
                        ));
                    await interaction.editReply({ components: [successContainer], flags: MessageFlags.IsComponentsV2 });
                } catch (error) {
                    log.error(`Legacy ticket creation: ${error.message}`, error);
                    const errMsg = '<:Cancel:1521227723916181644> There was an error creating the ticket!';
                    if (interaction.deferred) {
                        await interaction.editReply({ content: errMsg }).catch(() => { });
                    } else if (!interaction.replied) {
                        await interaction.reply({ content: errMsg, flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                } finally {
                    require('./utils/ticketUI').unlockCreation(interaction.guild.id, interaction.user.id);
                }
                return;
            }

            // Handle music control buttons (panel_, music_, filter_, queue_, search_)
            if (interaction.customId.startsWith('music_') || interaction.customId.startsWith('panel_') || interaction.customId.startsWith('filter_') || interaction.customId.startsWith('queue_') || interaction.customId.startsWith('search_') || interaction.customId === 'pause_resume' || interaction.customId === 'skip' || interaction.customId === 'stop') {
                // Compatibility layer: redirect music_* to panel_* for unified handling
                const buttonIdMap = {
                    'music_previous': 'panel_previous',
                    'music_pause_resume': 'panel_pause_resume',
                    'music_skip': 'panel_skip',
                    'music_stop': 'panel_stop',
                    'music_loop': 'panel_loop',
                    'music_shuffle': 'panel_shuffle',
                    'music_autoplay': 'panel_autoplay',
                    'music_filters': 'panel_filters',
                    'music_volume_down': 'panel_volume_down',
                    'music_volume_up': 'panel_volume_up',
                    'music_queue': 'panel_queue',
                    'music_refresh': 'panel_refresh',
                    'music_mute': 'panel_mute',
                    'music_247': 'panel_247'
                };

                const customId = buttonIdMap[interaction.customId] ?? interaction.customId;

                // For search buttons, we don't need player check
                if (customId.startsWith('search_')) {
                    if (interaction.customId === 'search_cancel') {
                        interaction.client.searchResults?.delete(interaction.user.id);
                        return interaction.update({ content: '<:Cancel:1521227723916181644> Search cancelled.', components: [], flags: MessageFlags.Ephemeral });
                    }

                    const searchData = interaction.client.searchResults?.get(interaction.user.id);
                    if (!searchData) {
                        return interaction.reply({ content: '<:Cancel:1521227723916181644> Search results expired! Please search again.', flags: MessageFlags.Ephemeral });
                    }

                    const index = parseInt(interaction.customId.split('_')[2]);
                    const track = searchData.tracks[index];

                    if (!track) {
                        return interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid selection!', flags: MessageFlags.Ephemeral });
                    }

                    await searchData.player.queue.add(track);

                    const container = new ContainerBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder()
                                .setContent(`# <:Music:1521228141543165982> Added to Queue\n**${track.info.title}**\nDuration: ${formatTime(track.info.duration)} | Position: ${searchData.player.queue.tracks.length}`)
                        );

                    if (!searchData.player.playing && !searchData.player.paused) {
                        await searchData.player.play();
                    }

                    interaction.client.searchResults.delete(interaction.user.id);
                    return interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }

                // Handle music panel buttons
                if (customId.startsWith('panel_')) {
                    try {
                        const player = lavalinkManager.getPlayer(interaction.guild.id);
                        const musicPanel = require('./utils/musicPanel');

                        let isMusicPanelMessage = false;
                        if (jsonStore.has('musicpanel')) {
                            try {
                                const panelConfig = jsonStore.read('musicpanel');
                                const guildPanel = panelConfig[interaction.guild.id];
                                if (guildPanel && guildPanel.messageId === interaction.message.id) {
                                    isMusicPanelMessage = true;
                                }
                            } catch (e) { }
                        }

                        const isBotMessage = interaction.message.author?.id === client.user.id;

                        const updateUI = async () => {
                            if (player && player.queue.current) {
                                if (isMusicPanelMessage) {
                                    await updateMusicPanel(client, player, autoplayStatus).catch(() => { });
                                } else if (isBotMessage && interaction.message.editable) {
                                    const container = musicPanel.buildNowPlayingContainer(player, autoplayStatus);
                                    if (container) {
                                        await interaction.message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch((err) => {
                                            log.warning(`Music UI update failed: ${err.message}`);
                                        });
                                    }
                                }
                            } else if (isMusicPanelMessage) {
                                await updateMusicPanel(client, player, autoplayStatus).catch(() => { });
                            }
                        };

                        // These buttons don't require voice channel
                        const noVoiceRequiredButtons = ['panel_247', 'panel_favorites', 'panel_history', 'panel_queue', 'panel_lyrics', 'panel_grab', 'panel_like'];

                        if (!noVoiceRequiredButtons.includes(customId)) {
                            if (!interaction.member.voice.channel) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> You need to be in a voice channel!', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }

                            if (player && player.voiceChannelId && interaction.member.voice.channel.id !== player.voiceChannelId) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> You need to be in the same voice channel as the bot!', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }
                        }

                        if (customId === 'panel_pause_resume') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing! Join a voice channel and type a song name.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }
                            await interaction.deferUpdate().catch(() => { });
                            if (player.paused) {
                                await player.resume();
                            } else {
                                await player.pause();
                            }

                            await updateVoiceChannelStatus(client, player);
                            await updateUI();
                            return;
                        }

                        if (customId === 'panel_skip') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing! Join a voice channel and type a song name.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }

                            await interaction.deferUpdate().catch(() => { });

                            // Check if there are more tracks in the queue
                            if (!player.queue.tracks || player.queue.tracks.length === 0) {
                                // Check 24/7 mode before destroying player.
                                // Strict: if 24/7 is on, NEVER destroy — just stop the track.
                                const shouldStay = is247On(interaction.guild.id);

                                if (shouldStay) {
                                    // Just stop the current track without destroying
                                    await player.stopPlaying();
                                    await updateVoiceChannelStatus(client, player, 'waiting');
                                    await updateMusicPanel(client, null, autoplayStatus, interaction.guild.id).catch(() => { });
                                } else {
                                    await player.destroy();
                                }
                                return;
                            }

                            await player.skip();
                            return;
                        }

                        if (customId === 'panel_stop') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing! Join a voice channel and type a song name.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }

                            await interaction.deferUpdate().catch(() => { });

                            const is247Enabled = is247On(interaction.guild.id);

                            const guildIdForPanel = interaction.guild.id;

                            if (is247Enabled) {
                                // Clear all tracks from queue
                                player.queue.tracks.splice(0, player.queue.tracks.length);
                                // Stop current track
                                await player.stopPlaying();

                                // Set waiting status for 24/7 mode
                                await updateVoiceChannelStatus(client, player, 'waiting');

                                // Update panel to idle state after a short delay
                                setTimeout(async () => {
                                    try {
                                        await updateMusicPanel(client, null, autoplayStatus, guildIdForPanel);
                                    } catch (err) {
                                        log.error(`Panel update after stop: ${err.message}`, err);
                                    }
                                }, 500);
                            } else {
                                await player.destroy();
                                // Panel will auto-update via playerDestroy event
                            }
                            return;
                        }

                        if (customId === 'panel_previous') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing! Join a voice channel and type a song name.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }
                            const previousTrack = player.queue.previous[0];
                            if (!previousTrack) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> No previous track available!', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }
                            await interaction.deferUpdate().catch(() => { });
                            await player.queue.add(previousTrack, 0);
                            await player.skip();
                            return;
                        }

                        if (customId === 'panel_loop') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing! Join a voice channel and type a song name.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }
                            await interaction.deferUpdate().catch(() => { });
                            const modes = ['off', 'track', 'queue'];
                            const currentIndex = modes.indexOf(player.repeatMode || 'off');
                            const nextMode = modes[(currentIndex + 1) % modes.length];
                            player.setRepeatMode(nextMode);
                            await updateUI();
                            return;
                        }

                        if (customId === 'panel_shuffle') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing! Join a voice channel and type a song name.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }
                            if (player.queue.tracks.length < 2) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Not enough tracks to shuffle!', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }
                            await interaction.deferUpdate().catch(() => { });
                            player.queue.shuffle();
                            await updateUI();
                            return;
                        }

                        if (customId === 'panel_autoplay') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing! Join a voice channel and type a song name.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }
                            await interaction.deferUpdate().catch(() => { });
                            const currentStatus = autoplayStatus.get(player.guildId) || false;
                            autoplayStatus.set(player.guildId, !currentStatus);
                            await updateUI();
                            return;
                        }

                        if (customId === 'panel_volume_down') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing! Join a voice channel and type a song name.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }
                            await interaction.deferUpdate().catch(() => { });
                            const newVolume = Math.max(0, player.volume - 10);
                            await player.setVolume(newVolume);
                            await updateUI();
                            return;
                        }

                        if (customId === 'panel_volume_up') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing! Join a voice channel and type a song name.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }
                            await interaction.deferUpdate().catch(() => { });
                            const newVolume = Math.min(200, player.volume + 10);
                            await player.setVolume(newVolume);
                            await updateUI();
                            return;
                        }

                        if (customId === 'panel_mute') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing! Join a voice channel and type a song name.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }
                            await interaction.deferUpdate().catch(() => { });

                            if (player.volume === 0) {
                                const restoreVolume = previousVolume.get(player.guildId) || 100;
                                await player.setVolume(restoreVolume);
                                previousVolume.delete(player.guildId);
                            } else {
                                previousVolume.set(player.guildId, player.volume);
                                await player.setVolume(0);
                            }

                            await updateUI();
                            return;
                        }

                        if (customId === 'panel_queue') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing! Join a voice channel and type a song name.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }

                            try {
                                const { buildQueueContainer } = require('./utils/musicPanel');
                                const container = buildQueueContainer(player, 0);
                                return await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => { });
                            } catch (err) {
                                log.error(`Panel queue error: ${err.message}`, err);
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to load queue.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }
                        }

                        if (customId === 'panel_filters') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing! Join a voice channel and type a song name.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }

                            const row1 = new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('filter_bassboost')
                                        .setLabel('Bass Boost')
                                        .setStyle(ButtonStyle.Primary)
                                        .setEmoji('<:Volumeup:1521228004502536272>'),
                                    new ButtonBuilder()
                                        .setCustomId('filter_nightcore')
                                        .setLabel('Nightcore')
                                        .setStyle(ButtonStyle.Primary)
                                        .setEmoji('<:Lightningalt:1521227851796447472>'),
                                    new ButtonBuilder()
                                        .setCustomId('filter_vaporwave')
                                        .setLabel('Vaporwave')
                                        .setStyle(ButtonStyle.Primary)
                                        .setEmoji('🌊'),
                                    new ButtonBuilder()
                                        .setCustomId('filter_8d')
                                        .setLabel('8D Audio')
                                        .setStyle(ButtonStyle.Primary)
                                        .setEmoji('<:Fire:1521227907647668374>')
                                );

                            const row2 = new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('filter_karaoke')
                                        .setLabel('Karaoke')
                                        .setStyle(ButtonStyle.Primary)
                                        .setEmoji('<:Microphone:1521227746376683590>'),
                                    new ButtonBuilder()
                                        .setCustomId('filter_tremolo')
                                        .setLabel('Tremolo')
                                        .setStyle(ButtonStyle.Primary)
                                        .setEmoji('<:Music:1521228141543165982>'),
                                    new ButtonBuilder()
                                        .setCustomId('filter_vibrato')
                                        .setLabel('Vibrato')
                                        .setStyle(ButtonStyle.Primary)
                                        .setEmoji('〰️'),
                                    new ButtonBuilder()
                                        .setCustomId('filter_distortion')
                                        .setLabel('Distortion')
                                        .setStyle(ButtonStyle.Primary)
                                        .setEmoji('<:Bullhorn:1521227936575914016>')
                                );

                            const row3 = new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('filter_soft')
                                        .setLabel('Soft')
                                        .setStyle(ButtonStyle.Secondary)
                                        .setEmoji('🎹'),
                                    new ButtonBuilder()
                                        .setCustomId('filter_pop')
                                        .setLabel('Pop')
                                        .setStyle(ButtonStyle.Secondary)
                                        .setEmoji('<:Music:1521228141543165982>'),
                                    new ButtonBuilder()
                                        .setCustomId('filter_party')
                                        .setLabel('Party')
                                        .setStyle(ButtonStyle.Secondary)
                                        .setEmoji('<:Money:1521228266957045900>'),
                                    new ButtonBuilder()
                                        .setCustomId('filter_electronic')
                                        .setLabel('Electronic')
                                        .setStyle(ButtonStyle.Secondary)
                                        .setEmoji('<:bots:1521227848101396610>')
                                );

                            const row4 = new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('filter_chipmunk')
                                        .setLabel('Chipmunk')
                                        .setStyle(ButtonStyle.Secondary)
                                        .setEmoji('🐿️'),
                                    new ButtonBuilder()
                                        .setCustomId('filter_daycore')
                                        .setLabel('Daycore')
                                        .setStyle(ButtonStyle.Secondary)
                                        .setEmoji('☁️'),
                                    new ButtonBuilder()
                                        .setCustomId('filter_china')
                                        .setLabel('China')
                                        .setStyle(ButtonStyle.Secondary)
                                        .setEmoji('🎎'),
                                    new ButtonBuilder()
                                        .setCustomId('filter_clear')
                                        .setLabel('Clear All')
                                        .setStyle(ButtonStyle.Danger)
                                        .setEmoji('<:Trash:1521227750420254820>')
                                );

                            const container = new ContainerBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder()
                                        .setContent(`# <:Fire:1521227907647668374> Audio Filters\n\nSelect a filter to apply to the current track:\n\n**Available Filters:**\n<:Volumeup:1521228004502536272> Bass Boost - Enhanced bass\n<:Lightningalt:1521227851796447472> Nightcore - Sped up and higher pitched\n🌊 Vaporwave - Slowed down and lower pitched\n<:Fire:1521227907647668374> 8D Audio - Surround sound effect\n<:Microphone:1521227746376683590> Karaoke - Reduced vocals\n<:Music:1521228141543165982> Tremolo - Trembling effect\n〰️ Vibrato - Vibrating effect\n<:Bullhorn:1521227936575914016> Distortion - Heavy distortion\n🎹 Soft - Soft sound\n<:Music:1521228141543165982> Pop - Pop music EQ\n<:Money:1521228266957045900> Party - Party bass boost\n<:bots:1521227848101396610> Electronic - Electronic music EQ\n🐿️ Chipmunk - High pitched\n☁️ Daycore - Slow & deep\n🎎 China - Chinese style`)
                                )
                                .addActionRowComponents(row1)
                                .addActionRowComponents(row2)
                                .addActionRowComponents(row3)
                                .addActionRowComponents(row4);

                            return await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                        }

                        if (customId === 'panel_247') {
                            // ── Premium gate ─────────────────────────
                            // 24/7 mode is gated on `/247` at the slash
                            // dispatcher, but the music-panel button
                            // routes here directly. Re-validate so non-
                            // premium servers can't enable 24/7 via the
                            // panel and bypass the slash gate.
                            if (!premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild?.id)) {
                                const { buildPremiumGate } = require('./utils/responseBuilder');
                                return await interaction.reply({
                                    components: [buildPremiumGate('/247')],
                                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                                }).catch(() => { });
                            }

                            let config247 = {};
                            if (jsonStore.has('musicpanel-247')) {
                                config247 = jsonStore.read('musicpanel-247');
                            }

                            const guildId = interaction.guild.id;
                            const isEnabled = config247[guildId]?.enabled || false;

                            if (isEnabled) {
                                await interaction.reply({ content: '<:Refresh:1521227946441052420> 24/7 Mode disabled! Bot will leave when queue is empty.', flags: MessageFlags.Ephemeral });
                                delete config247[guildId];
                                jsonStore.write('musicpanel-247', config247);
                                if (player) await updateUI();
                                return;
                            } else {
                                if (!player || !player.queue.current) {
                                    return await interaction.reply({ content: '<:Cancel:1521227723916181644> Start playing music first, then enable 24/7 mode!', flags: MessageFlags.Ephemeral });
                                }
                                if (!interaction.member.voice.channel) {
                                    return await interaction.reply({ content: '<:Cancel:1521227723916181644> Join a voice channel first to enable 24/7 mode!', flags: MessageFlags.Ephemeral });
                                }
                                await interaction.reply({ content: '<:Refresh:1521227946441052420> 24/7 Mode enabled! Bot will stay in voice channel.', flags: MessageFlags.Ephemeral });
                                config247[guildId] = {
                                    enabled: true,
                                    voiceChannelId: interaction.member.voice.channel.id,
                                    textChannelId: interaction.channel.id,
                                    enabledAt: Date.now()
                                };
                                jsonStore.write('musicpanel-247', config247);
                                await updateUI();
                                return;
                            }
                        }

                        if (customId === 'panel_join') {
                            if (!interaction.member.voice.channel) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Join a voice channel first!', flags: MessageFlags.Ephemeral });
                            }
                            return await interaction.reply({ content: '<:Music:1521228141543165982> Ready! Type a song name in this channel to play music.', flags: MessageFlags.Ephemeral });
                        }

                        if (customId === 'panel_favorites') {
                            const favoritesCmd = interaction.client.commands.get('favorites');
                            if (favoritesCmd) {
                                return await favoritesCmd.execute(interaction, lavalinkManager);
                            }
                            return await interaction.reply({ content: '<:Heart:1521228100652765247> Use `/favorites` to view your saved songs.', flags: MessageFlags.Ephemeral });
                        }

                        if (customId === 'panel_history') {
                            if (!player) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> No active player.', flags: MessageFlags.Ephemeral });
                            }
                            const history = (player.queue?.previous || []).slice().reverse().slice(0, 10);
                            if (!history.length) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> No play history yet.', flags: MessageFlags.Ephemeral });
                            }
                            const list = history.map((t, i) => {
                                const p = require('./utils/musicPanel').getPlatformInfo(t.info?.sourceName);
                                const title = (t.info?.title || 'Unknown').slice(0, 50);
                                return `\`${(i + 1).toString().padStart(2, ' ')}.\` ${p.icon} **${title}**`;
                            }).join('\n');
                            const container = new ContainerBuilder()
                                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                                    `# <:History:1521227863079256278> Recent Plays\n\n${list}\n\n-# Showing last ${history.length} tracks (newest first)`
                                ));
                            return await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                        }

                        if (customId === 'panel_like') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing!', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }

                            const track = player.queue.current;
                            try {
                                const existing = await models.FavoriteSong.findOne({
                                    userId: interaction.user.id,
                                    url: track.info.uri
                                });

                                if (existing) {
                                    return await interaction.reply({ content: '<:Heart:1521228100652765247> This song is already in your favorites!', flags: MessageFlags.Ephemeral });
                                }

                                await models.FavoriteSong.create({
                                    userId: interaction.user.id,
                                    url: track.info.uri,
                                    title: track.info.title,
                                    author: track.info.author,
                                    duration: track.info.duration,
                                    artworkUrl: track.info.artworkUrl || track.info.thumbnail,
                                    sourceName: track.info.sourceName,
                                    addedAt: new Date().toISOString()
                                });

                                return await interaction.reply({ content: `<:Heart:1521228100652765247> **${track.info.title}** added to favorites!`, flags: MessageFlags.Ephemeral });
                            } catch (err) {
                                log.error(`Like button error: ${err.message}`, err);
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to save to favorites!', flags: MessageFlags.Ephemeral });
                            }
                        }

                        if (customId === 'panel_lyrics') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing!', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }

                            const track = player.queue.current;

                            try {
                                await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => { });

                                // Use the lyrics command's fetchLyrics function
                                const lyricsCommand = interaction.client.commands.get('lyrics');
                                if (!lyricsCommand) {
                                    return await interaction.editReply({ content: '<:Cancel:1521227723916181644> Lyrics command not available.' }).catch(() => { });
                                }

                                // Build the query from track info
                                const query = track.info.author
                                    ? `${track.info.author} - ${track.info.title}`
                                    : track.info.title;

                                // Call the lyrics command's run function by simulating a slash interaction
                                // Instead, we'll directly fetch lyrics using the same approach
                                const axios = require('axios');

                                // Clean up the query for better results
                                const cleanTitle = (track.info.title || '')
                                    .replace(/\([^)]*\)|\[[^\]]*\]/g, '')
                                    .replace(/\|.*$/g, '')
                                    .replace(/ft\..*$/gi, '')
                                    .replace(/feat\..*$/gi, '')
                                    .replace(/official\s*(video|audio|music\s*video|lyric\s*video|visualizer)/gi, '')
                                    .trim();
                                const cleanAuthor = (track.info.author || '')
                                    .replace(/VEVO$/i, '')
                                    .replace(/ - Topic$/i, '')
                                    .replace(/Official$/i, '')
                                    .trim();

                                let lyrics = null;

                                // Try LRCLIB first (modern, reliable)
                                try {
                                    const searchQuery = cleanAuthor ? `${cleanAuthor} ${cleanTitle}` : cleanTitle;
                                    const lrcRes = await axios.get(`https://lrclib.net/api/search`, {
                                        params: { q: searchQuery },
                                        timeout: 8000,
                                        headers: { 'User-Agent': 'xNico/2.0.0 (https://thenico.vercel.app)' },
                                        validateStatus: s => s < 500,
                                    });
                                    if (lrcRes.status === 200 && Array.isArray(lrcRes.data) && lrcRes.data.length > 0) {
                                        // Find the best match — prefer one with plainLyrics
                                        const match = lrcRes.data.find(r => r.plainLyrics) || lrcRes.data[0];
                                        if (match.plainLyrics) {
                                            lyrics = {
                                                title: match.trackName || cleanTitle,
                                                artist: match.artistName || cleanAuthor || 'Unknown',
                                                text: match.plainLyrics,
                                            };
                                        }
                                    }
                                } catch { }

                                // Fallback: lyrics.ovh (legacy, may work for some tracks)
                                if (!lyrics && cleanAuthor) {
                                    try {
                                        const ovhRes = await axios.get(
                                            `https://api.lyrics.ovh/v1/${encodeURIComponent(cleanAuthor)}/${encodeURIComponent(cleanTitle)}`,
                                            { timeout: 6000, validateStatus: s => s < 500 }
                                        );
                                        if (ovhRes.status === 200 && ovhRes.data?.lyrics?.trim()) {
                                            lyrics = {
                                                title: cleanTitle,
                                                artist: cleanAuthor,
                                                text: ovhRes.data.lyrics,
                                            };
                                        }
                                    } catch { }
                                }

                                if (!lyrics) {
                                    const errContainer = new ContainerBuilder()
                                        .setAccentColor(0xED4245)
                                        .addTextDisplayComponents(
                                            new TextDisplayBuilder()
                                                .setContent(
                                                    `# <:Cancel:1521227723916181644> Lyrics Not Found\n\n` +
                                                    `Couldn't find lyrics for **${track.info.title}**.\n\n` +
                                                    `-# Try \`/lyrics Artist - Song Title\` for a custom search`
                                                )
                                        );
                                    return await interaction.editReply({ components: [errContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
                                }

                                // Truncate lyrics to fit Discord's limits
                                let lyricsText = lyrics.text;
                                if (lyricsText.length > 1800) {
                                    lyricsText = lyricsText.substring(0, 1800).trimEnd() + '\n\n*... truncated*';
                                }

                                const lyricsContainer = new ContainerBuilder()
                                    .setAccentColor(0xCAD7E6)
                                    .addTextDisplayComponents(
                                        new TextDisplayBuilder()
                                            .setContent(
                                                `# <:Edit:1521227886634205298> Lyrics\n\n` +
                                                `**${lyrics.title}**\n-# by ${lyrics.artist}\n\n` +
                                                `${lyricsText}\n\n` +
                                                `-# Source: lrclib.net`
                                            )
                                    );

                                return await interaction.editReply({ components: [lyricsContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
                            } catch (err) {
                                log.error(`Panel lyrics error: ${err.message}`, err);
                                if (interaction.deferred) {
                                    return await interaction.editReply({ content: '<:Cancel:1521227723916181644> Failed to fetch lyrics.' }).catch(() => { });
                                }
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to fetch lyrics.', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }
                        }

                        if (customId === 'panel_seek_back') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing!', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }

                            if (player.queue.current.info.duration === 0) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Cannot seek in a live stream!', flags: MessageFlags.Ephemeral });
                            }

                            await interaction.deferUpdate().catch(() => { });
                            const newPosition = Math.max(0, player.position - 10000);
                            await player.seek(newPosition);
                            await updateUI();
                            return;
                        }

                        if (customId === 'panel_seek_forward') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing!', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }

                            if (player.queue.current.info.duration === 0) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Cannot seek in a live stream!', flags: MessageFlags.Ephemeral });
                            }

                            await interaction.deferUpdate().catch(() => { });
                            const duration = player.queue.current.info.duration;
                            const newPosition = Math.min(duration - 1000, player.position + 10000);
                            await player.seek(newPosition);
                            await updateUI();
                            return;
                        }

                        if (customId === 'panel_replay') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing!', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }

                            await interaction.deferUpdate().catch(() => { });
                            await player.seek(0);
                            await updateUI();
                            return;
                        }

                        if (customId === 'panel_grab') {
                            if (!player || !player.queue.current) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing!', flags: MessageFlags.Ephemeral }).catch(() => { });
                            }

                            const track = player.queue.current;
                            try {
                                const container = new ContainerBuilder()
                                    .addTextDisplayComponents(
                                        new TextDisplayBuilder()
                                            .setContent(
                                                `# <:Download:1521228191899975810> Song Info\n\n` +
                                                `**${track.info.title}**\n` +
                                                `by ${track.info.author}\n\n` +
                                                `**Duration:** ${formatTime(track.info.duration)}\n` +
                                                `**Platform:** ${track.info.sourceName || 'Unknown'}\n` +
                                                `**URL:** ${track.info.uri}\n\n` +
                                                `-# Requested by <@${track.requester?.id || 'Unknown'}>`
                                            )
                                    );

                                await interaction.user.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {
                                    throw new Error('DM failed');
                                });

                                return await interaction.reply({ content: '<:Download:1521228191899975810> Song info sent to your DMs!', flags: MessageFlags.Ephemeral });
                            } catch (err) {
                                return await interaction.reply({ content: '<:Cancel:1521227723916181644> Could not send DM. Make sure your DMs are open!', flags: MessageFlags.Ephemeral });
                            }
                        }
                    } catch (error) {
                        log.error(`Panel: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            return interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred!', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                    return;
                }

                // Handle Leveling System Buttons
                if (interaction.customId.startsWith('levelroles_')) {
                    const lui = require('./utils/levelingUI');
                    let levelRoles = {};
                    if (jsonStore.has('levelroles')) {
                        levelRoles = jsonStore.read('levelroles');
                    }
                    const guildRoles = levelRoles[interaction.guild.id] || [];

                    if (interaction.customId === 'levelroles_list') {
                        const lines = guildRoles.map(lr => {
                            const role = interaction.guild.roles.cache.get(lr.roleId);
                            return `**Level ${lr.level}** → ${role || '`Deleted Role`'}`;
                        });
                        const panel = lui.list(interaction.guild.id, 'Level Role Rewards', lines, {
                            emoji: lui.E.bookmark, empty: 'No level roles configured yet.',
                        });
                        return await interaction.reply({ ...lui.payload(panel), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    }

                    if (interaction.customId === 'levelroles_help') {
                        const panel = lui.usage(interaction.guild.id, 'Level Roles Help', [
                            '`-levelroles add <level> @role` — Add level role reward',
                            '`-levelroles remove <level>` — Remove level role reward',
                            '`-levelroles list` — View all level roles',
                        ], { emoji: lui.E.bookmark, examples: ['-levelroles add 10 @VIP'] });
                        return await interaction.reply({ ...lui.payload(panel), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    }
                }

                if (interaction.customId.startsWith('levelmultiplier_')) {
                    const lui = require('./utils/levelingUI');
                    let multipliers = {};
                    if (jsonStore.has('levelmultiplier')) {
                        multipliers = jsonStore.read('levelmultiplier');
                    }
                    const guildMultipliers = multipliers[interaction.guild.id] || {};

                    if (interaction.customId === 'levelmultiplier_list') {
                        const lines = Object.entries(guildMultipliers).map(([roleId, mult]) => {
                            const role = interaction.guild.roles.cache.get(roleId);
                            return `${role || '`Deleted Role`'} — **${mult}x** XP`;
                        });
                        const panel = lui.list(interaction.guild.id, 'XP Multipliers', lines, {
                            emoji: lui.E.xp, empty: 'No XP multipliers configured yet.',
                        });
                        return await interaction.reply({ ...lui.payload(panel), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    }

                    if (interaction.customId === 'levelmultiplier_help') {
                        const panel = lui.usage(interaction.guild.id, 'XP Multiplier Help', [
                            '`-levelmultiplier set @role <multiplier>` — Set XP multiplier',
                            '`-levelmultiplier remove @role` — Remove multiplier',
                            '`-levelmultiplier list` — View multipliers',
                        ], { emoji: lui.E.xp, examples: ['-levelmultiplier set @Booster 2.0'] });
                        return await interaction.reply({ ...lui.payload(panel), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    }
                }

                if (interaction.customId.startsWith('levelchannel_')) {
                    const lui = require('./utils/levelingUI');

                    if (interaction.customId === 'levelchannel_disable') {
                        if (!interaction.member.permissions.has('Administrator')) {
                            return await interaction.reply({ ...lui.payload(lui.permError(interaction.guild.id)), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                        }

                        let levelChannels = {};
                        if (jsonStore.has('levelchannel')) {
                            levelChannels = jsonStore.read('levelchannel');
                        }

                        delete levelChannels[interaction.guild.id];
                        jsonStore.write('levelchannel', levelChannels);

                        // Also update database so the XP handler uses same-channel
                        const { updateGuildConfig: updateGC } = require('./utils/database');
                        await updateGC(interaction.guild.id, {
                            'leveling.announcements.channel': 'same',
                            'leveling.announcements.customChannelId': null,
                            'leveling.announcementChannel': null
                        }).catch(() => { });

                        const panel = lui.ok(interaction.guild.id, 'Level Channel Disabled', 'Level-up announcements will now appear where users level up.', { Mode: 'Same Channel' });
                        return await interaction.update(lui.payload(panel));
                    }

                    if (interaction.customId === 'levelchannel_help') {
                        const panel = lui.usage(interaction.guild.id, 'Level Channel Help', [
                            '`-levelchannel set #channel` — Set announcement channel',
                            '`-levelchannel disable` — Use same channel',
                        ], { emoji: lui.E.bullhorn, examples: ['-levelchannel set #level-ups'] });
                        return await interaction.reply({ ...lui.payload(panel), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    }
                }

                if (interaction.customId.startsWith('toggleleveling_')) {
                    const lui = require('./utils/levelingUI');
                    let toggle = {};
                    if (jsonStore.has('levelingtoggle')) {
                        toggle = jsonStore.read('levelingtoggle');
                    }
                    const guildToggle = toggle[interaction.guild.id];

                    if (interaction.customId === 'toggleleveling_list') {
                        const disabled = guildToggle?.disabledChannels || [];
                        const isEnabled = guildToggle?.enabled !== false;
                        const lines = [`**System Status:** ${isEnabled ? `${lui.E.on} Enabled` : `${lui.E.off} Disabled`}`];
                        if (disabled.length === 0) {
                            lines.push('**Disabled Channels:** none — XP is active everywhere');
                        } else {
                            lines.push(`**Disabled Channels (${disabled.length}):**`);
                            for (const channelId of disabled) {
                                const channel = interaction.guild.channels.cache.get(channelId);
                                lines.push(`${channel || `\`${channelId}\` (deleted)`}`);
                            }
                        }
                        const panel = lui.list(interaction.guild.id, 'Leveling Toggle Status', lines, { emoji: lui.E.gear });
                        return await interaction.reply({ ...lui.payload(panel), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    }

                    if (interaction.customId === 'toggleleveling_help') {
                        const panel = lui.usage(interaction.guild.id, 'Leveling Toggle Help', [
                            '`-toggleleveling disable #channel` — Disable XP in channel',
                            '`-toggleleveling enable #channel` — Enable XP in channel',
                            '`-toggleleveling list` — View disabled channels',
                        ], { emoji: lui.E.gear, examples: ['-toggleleveling disable #bots'] });
                        return await interaction.reply({ ...lui.payload(panel), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                    }

                    if (interaction.customId === 'toggleleveling_toggle') {
                        if (!interaction.member.permissions.has('Administrator')) {
                            return await interaction.reply({ ...lui.payload(lui.permError(interaction.guild.id)), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
                        }

                        if (!toggle[interaction.guild.id]) {
                            toggle[interaction.guild.id] = { enabled: false, disabledChannels: [] };
                        }

                        const wasEnabled = toggle[interaction.guild.id].enabled === true;
                        toggle[interaction.guild.id].enabled = !wasEnabled;
                        jsonStore.write('levelingtoggle', toggle);

                        const { updateGuildConfig: updateGC } = require('./utils/database');
                        await updateGC(interaction.guild.id, { leveling: { ...(await getGuildConfigDb(interaction.guild.id))?.leveling, enabled: !wasEnabled } }).catch(() => { });

                        const newState = !wasEnabled;
                        const container = new ContainerBuilder()
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                                `# ${lui.E.fire} Leveling System\n\n**Status:** ${newState ? `${lui.E.on} Enabled` : `${lui.E.off} Disabled`}`
                            ))
                            .addSeparatorComponents(lui.divider())
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                                `### ${lui.E.doc} Available Commands\n${lui.rows([
                                    '`-toggleleveling on` — Enable leveling system',
                                    '`-toggleleveling off` — Disable leveling system',
                                    '`-toggleleveling enable #channel` — Re-enable XP in a channel',
                                    '`-toggleleveling disable #channel` — Disable XP in a channel',
                                    '`-toggleleveling list` — View disabled channels',
                                ])}`
                            ))
                            .addActionRowComponents(
                                new ActionRowBuilder().addComponents(
                                    new ButtonBuilder()
                                        .setCustomId('toggleleveling_list')
                                        .setLabel('View Disabled Channels')
                                        .setStyle(ButtonStyle.Primary)
                                        .setEmoji(lui.E.doc),
                                    new ButtonBuilder()
                                        .setCustomId('toggleleveling_toggle')
                                        .setLabel(newState ? 'Disable' : 'Enable')
                                        .setStyle(newState ? ButtonStyle.Danger : ButtonStyle.Success)
                                        .setEmoji(newState ? lui.E.off : lui.E.on)
                                )
                            );

                        return await interaction.update(lui.payload(lui.applyStyle(container, interaction.guild.id)));
                    }
                }

                if (interaction.customId.startsWith('queue_page_')) {
                    const page = parseInt(interaction.customId.split('_')[2]);
                    const queueCommand = interaction.client.commands.get('queue');
                    if (queueCommand) {
                        interaction.options = {
                            getInteger: () => page
                        };
                        await queueCommand.execute(interaction, lavalinkManager);
                    }
                    return;
                }

                if (interaction.customId === 'queue_clear') {
                    if (!player) {
                        return interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing!', flags: MessageFlags.Ephemeral });
                    }
                    player.queue.tracks.splice(0, player.queue.tracks.length);
                    await interaction.reply({ content: '<:Trash:1521227750420254820> Queue cleared!', flags: MessageFlags.Ephemeral });
                    return;
                }

                if (interaction.customId === 'queue_shuffle') {
                    if (!player || player.queue.tracks.length < 2) {
                        return interaction.reply({ content: '<:Cancel:1521227723916181644> Not enough tracks to shuffle!', flags: MessageFlags.Ephemeral });
                    }
                    player.queue.shuffle();
                    const { buildQueueContainer } = require('./utils/musicPanel');
                    const container = buildQueueContainer(player, 0);
                    await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    return;
                }

                if (interaction.customId.startsWith('queue_prev_') || interaction.customId.startsWith('queue_next_')) {
                    if (!player) {
                        return interaction.reply({ content: '<:Cancel:1521227723916181644> Nothing is playing!', flags: MessageFlags.Ephemeral });
                    }
                    const parts = interaction.customId.split('_');
                    const currentPage = parseInt(parts[2]) || 0;
                    const newPage = interaction.customId.startsWith('queue_prev_') ? currentPage - 1 : currentPage + 1;
                    const { buildQueueContainer } = require('./utils/musicPanel');
                    const container = buildQueueContainer(player, newPage);
                    await interaction.update({ components: [container], flags: MessageFlags.IsComponentsV2 });
                    return;
                }

                return;
            }
        }

        if (interaction.isStringSelectMenu()) {
            // Live Leaderboard string selects: multi-period picker, legacy
            // single period, and entry-count. (llb_periods/llb_count were added
            // to the command but weren't routed here — that unrouted select was
            // the "interaction failed" error when choosing multiple periods.)
            if (interaction.customId === 'llb_periods' || interaction.customId === 'llb_period' || interaction.customId === 'llb_count') {
                const llbCmd = client.commands.get('liveleaderboard');
                if (llbCmd?.handleInteraction) {
                    try { const h = await llbCmd.handleInteraction(interaction); if (h) return; } catch (e) { log.error(`LLB Select: ${e.message}`, e); }
                }
                return;
            }
            // Birthday system string-selects (ping mode, hour, msgstyle)
            if (interaction.customId === 'bdaysetup_pingpick'
                || interaction.customId === 'bdaysetup_hourpick'
                || interaction.customId === 'bdaysetup_msgstylepick') {
                const bdayCmd = client.commands.get('birthday-setup');
                if (bdayCmd?.handleInteraction) {
                    try {
                        const handled = await bdayCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Birthday String Select: ${error.message}`, error);
                    }
                }
                return;
            }
            // Birthday message-builder string-selects (mode/style selectors inside builder panel)
            if (interaction.customId.startsWith('bdaymsg_')) {
                const bdaySetupCmd = client.commands.get('birthday-setup');
                if (bdaySetupCmd?.handleInteraction) {
                    try {
                        const handled = await bdaySetupCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Birthday Builder Select: ${error.message}`, error);
                    }
                }
                return;
            }

            // Ticket categories picker — finalize panel scoping after a
            // category was added with `/ticket-categories add` (no panel-id).
            if (interaction.customId?.startsWith('tcat_pick')) {
                const ticketCatCmd = client.commands.get('ticket-categories');
                if (ticketCatCmd?.handleInteraction) {
                    try {
                        const handled = await ticketCatCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (err) {
                        log.error(`[ticket-categories picker select] ${err.message}`, err);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({
                                content: '<:Cancel:1521227723916181644> Failed to apply panel scoping.',
                                flags: MessageFlags.Ephemeral,
                            }).catch(() => { });
                        }
                        return;
                    }
                }
            }

            // Invite tracking message-type picker
            if (interaction.customId.startsWith('invite_')) {
                const inviteCmd = client.commands.get('invite-setup');
                if (inviteCmd?.handleInteraction) {
                    try {
                        const handled = await inviteCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Invite Select Error: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                        return;
                    }
                }
            }
            // Join-to-Create admin dashboard interface picker
            if (interaction.customId === 'j2cset_select_iface_pick') {
                const j2cCmd = client.commands.get('join2create-setup');
                if (j2cCmd?.handleInteraction) {
                    try {
                        const handled = await j2cCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`J2C Setup String Select: ${error.message}`, error);
                    }
                }
                return;
            }
            // Screenshot Verification string selects
            if (interaction.customId.startsWith('sshot_')) {
                const sshotCmd = client.commands.get('screenshot-verify');
                if (sshotCmd && sshotCmd.handleInteraction) {
                    try {
                        await sshotCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Screenshot Verify String Select: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
                return;
            }
            // Route custom shop buy select menu
            if (interaction.customId === 'cshop_buy_select') {
                const cshopCmd = client.commands.get('customshop');
                if (cshopCmd?.handleSelectMenu) {
                    try { const h = await cshopCmd.handleSelectMenu(interaction); if (h) return; } catch { }
                }
                return;
            }

            // Route shop category select menu
            if (interaction.customId === 'shop_cat_select') {
                const shopCmd = client.commands.get('shop');
                if (shopCmd && shopCmd.handleStringSelect) {
                    try {
                        const handled = await shopCmd.handleStringSelect(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Shop Select Error: ${error.message}`, error);
                    }
                }
                return;
            }
            // Route economy leaderboard sort select menu
            if (interaction.customId.startsWith('elb_sort_select_')) {
                const lbCmd = client.commands.get('economy-leaderboard');
                if (lbCmd && lbCmd.handleStringSelect) {
                    try {
                        const handled = await lbCmd.handleStringSelect(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Leaderboard Sort Select Error: ${error.message}`, error);
                    }
                }
                return;
            }
            // Route mines setup select menus (grid size + risk level).
            // Same handler is used for the button click path above.
            if (interaction.customId.startsWith('mines_setup_')) {
                const minesCmd = client.commands.get('mines');
                if (minesCmd && minesCmd.handleMinesInteraction) {
                    try {
                        const handled = await minesCmd.handleMinesInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Mines Setup Select Error: ${error.message}`, error);
                    }
                }
                return;
            }
            // Route crash setup select menus (risk + auto-cashout).
            if (interaction.customId.startsWith('crash_setup_')) {
                const crashCmd = client.commands.get('crash');
                if (crashCmd && crashCmd.handleCrashInteraction) {
                    try {
                        const handled = await crashCmd.handleCrashInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Crash Setup Select Error: ${error.message}`, error);
                    }
                }
                return;
            }
            // Route plinko setup select menus (rows + risk).
            if (interaction.customId.startsWith('plinko_setup_')) {
                const plinkoCmd = client.commands.get('plinko');
                if (plinkoCmd && plinkoCmd.handlePlinkoInteraction) {
                    try {
                        const handled = await plinkoCmd.handlePlinkoInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Plinko Setup Select Error: ${error.message}`, error);
                    }
                }
                return;
            }
            // Route wheel setup select menus (preset).
            if (interaction.customId.startsWith('wheel_setup_')) {
                const wheelCmd = client.commands.get('wheel');
                if (wheelCmd && wheelCmd.handleWheelInteraction) {
                    try {
                        const handled = await wheelCmd.handleWheelInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Wheel Setup Select Error: ${error.message}`, error);
                    }
                }
                return;
            }
            // Route limbo setup select menus (target multiplier).
            if (interaction.customId.startsWith('limbo_setup_')) {
                const limboCmd = client.commands.get('limbo');
                if (limboCmd && limboCmd.handleLimboInteraction) {
                    try {
                        const handled = await limboCmd.handleLimboInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Limbo Setup Select Error: ${error.message}`, error);
                    }
                }
                return;
            }
            // Route tower setup select menus (difficulty).
            if (interaction.customId.startsWith('tower_setup_')) {
                const towerCmd = client.commands.get('tower');
                if (towerCmd && towerCmd.handleTowerInteraction) {
                    try {
                        const handled = await towerCmd.handleTowerInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Tower Setup Select Error: ${error.message}`, error);
                    }
                }
                return;
            }
            // Route keno setup + picker select menus
            // (`keno_setup_count_*`, `keno_pick_low_*`, `keno_pick_high_*`).
            if (interaction.customId.startsWith('keno_')) {
                const kenoCmd = client.commands.get('keno');
                if (kenoCmd && kenoCmd.handleKenoInteraction) {
                    try {
                        const handled = await kenoCmd.handleKenoInteraction(interaction);
                        if (handled !== false) return;
                    } catch (error) {
                        log.error(`Keno Setup Select Error: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('sug_select_')) {
                const suggestionCmd = client.commands.get('suggestion');
                if (suggestionCmd && suggestionCmd.handleInteraction) {
                    try {
                        const handled = await suggestionCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Suggestion Select Error: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('automod_')) {
                try {
                    return await handleAutomodSelectMenus(interaction);
                } catch (error) {
                    log.error(`Automod Select Error: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred processing this action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                    return;
                }
            }
            if (interaction.customId.startsWith('aichat_')) {
                const aichatCmd = client.commands.get('aichat-setup');
                if (aichatCmd && aichatCmd.handleInteraction) {
                    try {
                        const handled = await aichatCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`AI Chat Select: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId === 'rrsetup_select_template') {
                const rrCmd = client.commands.get('reactionroles');
                if (rrCmd && rrCmd.handleSetupInteraction) {
                    try {
                        await rrCmd.handleSetupInteraction(interaction);
                    } catch (error) {
                        log.error(`RR Template Select: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId === 'rrsetup_select_removerole') {
                const rrCmd = client.commands.get('reactionroles');
                if (rrCmd && rrCmd.handleSetupSelect) {
                    try {
                        await rrCmd.handleSetupSelect(interaction);
                    } catch (error) {
                        log.error(`RR Setup Select: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('ulb_type_')) {
                const ulbCmd = client.commands.get('leaderboard');
                if (ulbCmd && ulbCmd.handleSelectMenu) {
                    try {
                        const handled = await ulbCmd.handleSelectMenu(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Unified Leaderboard Select Error: ${error.message}`, error);
                    }
                }
                return;
            }

            if (interaction.customId === 'rankcard_font_select' || interaction.customId === 'profile_font_select') {
                // ── Premium gate ─────────────────────────────────────
                // Select-menu interactions don't pass through the slash
                // dispatcher's `premiumOnly` check. If a customize panel
                // was opened before premium expired, fail closed here.
                if (!premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild?.id)) {
                    const { buildPremiumGate } = require('./utils/responseBuilder');
                    const which = interaction.customId.startsWith('rankcard_')
                        ? '/rank-customize'
                        : '/profile-customize';
                    return interaction.reply({
                        components: [buildPremiumGate(which)],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    }).catch(() => { });
                }
                try {
                    const { isValidFont, FONT_FAMILIES, getCustomFontName } = require('./utils/fontRegistry');
                    const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
                    const { updateUserData } = require('./utils/dataManager');
                    const selectedFont = interaction.values[0];
                    const isRankCard = interaction.customId === 'rankcard_font_select';

                    if (selectedFont === '__custom_url__') {
                        const modal = new ModalBuilder()
                            .setCustomId(isRankCard ? 'custom_font_modal_rankcard' : 'custom_font_modal_profile')
                            .setTitle('Custom Font URL');

                        const urlInput = new TextInputBuilder()
                            .setCustomId('font_url')
                            .setLabel('Font URL (.ttf, .otf, .woff, .woff2)')
                            .setStyle(TextInputStyle.Short)
                            .setPlaceholder('https://example.com/fonts/MyFont-Regular.ttf')
                            .setRequired(true)
                            .setMinLength(10)
                            .setMaxLength(500);

                        modal.addComponents(new ActionRowBuilder().addComponents(urlInput));
                        return interaction.showModal(modal);
                    }

                    if (!isValidFont(selectedFont)) {
                        return interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid font selection!', flags: MessageFlags.Ephemeral });
                    }

                    const dataPath = isRankCard ? 'profile.rankCard.fontFamily' : 'profile.profileCard.fontFamily';
                    await updateUserData(interaction.user.id, { [dataPath]: selectedFont });

                    const fontInfo = FONT_FAMILIES[selectedFont];
                    await interaction.update({
                        content: `<:Checkedbox:1521227734943269077> Font changed to **${fontInfo.emoji} ${fontInfo.name}**!\n-# ${fontInfo.description} • Use **Preview** to see how it looks.`,
                        components: []
                    });
                } catch (error) {
                    log.error(`Font Select Error: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to save font selection.', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }

            // Route card style selection for rank card and profile card
            if (interaction.customId === 'rankcard_style_select' || interaction.customId === 'profile_style_select') {
                if (!premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild?.id)) {
                    const { buildPremiumGate } = require('./utils/responseBuilder');
                    const which = interaction.customId.startsWith('rankcard_')
                        ? '/rank-customize'
                        : '/profile-customize';
                    return interaction.reply({
                        components: [buildPremiumGate(which)],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    }).catch(() => { });
                }
                try {
                    const { updateUserData } = require('./utils/dataManager');
                    const selectedStyle = interaction.values[0];

                    const validStyles = ['Default', 'Minimal', 'Neon', 'Classic', 'Modern'];
                    if (!validStyles.includes(selectedStyle)) {
                        return interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid style selection!', flags: MessageFlags.Ephemeral });
                    }

                    const styleEmojis = { Default: '🎴', Minimal: '◻️', Neon: '💫', Classic: '🏛️', Modern: '🔷' };
                    const dataPath = interaction.customId === 'rankcard_style_select'
                        ? 'profile.rankCard.cardStyle'
                        : 'profile.profileCard.cardStyle';

                    await updateUserData(interaction.user.id, { [dataPath]: selectedStyle });

                    await interaction.update({
                        content: `<:Checkedbox:1521227734943269077> Card style changed to **${styleEmojis[selectedStyle]} ${selectedStyle}**!\n-# Use **Preview** to see how it looks. Custom colors will override theme colors.`,
                        components: []
                    });
                } catch (error) {
                    log.error(`Style Select Error: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to save style selection.', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }

            // Route badge style selection for profile card
            if (interaction.customId === 'profile_badge_select') {
                if (!premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild?.id)) {
                    const { buildPremiumGate } = require('./utils/responseBuilder');
                    return interaction.reply({
                        components: [buildPremiumGate('/profile-customize')],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    }).catch(() => { });
                }
                try {
                    const { updateUserData } = require('./utils/dataManager');
                    const selectedBadge = interaction.values[0];

                    const validBadges = ['Default', 'Compact', 'Detailed', 'Hidden'];
                    if (!validBadges.includes(selectedBadge)) {
                        return interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid badge style!', flags: MessageFlags.Ephemeral });
                    }

                    const badgeEmojis = { Default: '🏅', Compact: '<:Box:1521228152414666833>', Detailed: '📋', Hidden: '🚫' };
                    await updateUserData(interaction.user.id, { 'profile.profileCard.badgeStyle': selectedBadge });

                    await interaction.update({
                        content: `<:Checkedbox:1521227734943269077> Badge style changed to **${badgeEmojis[selectedBadge]} ${selectedBadge}**!\n-# Use **Preview** to see how badges will appear.`,
                        components: []
                    });
                } catch (error) {
                    log.error(`Badge Select Error: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Failed to save badge style.', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }

            // Route inventory quick-use select menu
            if (interaction.customId === 'inv_use') {
                const invCmd = client.commands.get('inventory');
                if (invCmd && invCmd.handleInteraction) {
                    try {
                        const handled = await invCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Inventory Use Error: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred using that item.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                        return;
                    }
                }
            }
            // Route pets select menus (rarity, group, individual, weapon equip)
            if (interaction.customId.startsWith('pets:')) {
                const petsCmd = client.commands.get('pets');
                if (petsCmd && petsCmd.handleInteraction) {
                    try {
                        const handled = await petsCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Pets Select Error: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred processing this pets action.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                        return;
                    }
                }
            }

            // ─────────────── Handle ticket category selection (multi-panel + legacy) ───────────────
            // The full create-ticket flow: dedupe existing tickets, atomic
            // ticket-number bump, channel creation, welcome message + ping,
            // and a graceful "creation lock" so a spamming user can't open
            // multiple channels in parallel.
            if (interaction.customId === 'ticket_category_select' || interaction.customId.startsWith('ticket_select:')) {
                const ticketUI = require('./utils/ticketUI');
                const lockedNow = ticketUI.lockCreation(interaction.guild.id, interaction.user.id);
                if (!lockedNow) {
                    return interaction.reply({
                        ...ticketUI.v2Reply(ticketUI.warnContainer('You already have a ticket being created — please wait a moment.'), true),
                    });
                }

                try {
                    const { ensureMigrated, resolvePanelCategories, resolveSupportRoleId, resolveChannelCategoryId, findPanelByMessageId } = require('./utils/ticketPanels');

                    const config = readTicketsConfig();
                    const guildConfig = ensureMigrated(config[interaction.guild.id]);

                    if (!guildConfig) {
                        ticketUI.unlockCreation(interaction.guild.id, interaction.user.id);
                        return interaction.reply({
                            ...ticketUI.v2Reply(ticketUI.errorContainer('Ticket system is not configured for this server. Ask an admin to run `/ticket-setup create`.'), true),
                        });
                    }

                    // Resolve which panel emitted this interaction
                    let panelId = null;
                    if (interaction.customId.startsWith('ticket_select:')) {
                        panelId = interaction.customId.split(':')[1];
                    } else {
                        // Legacy customId — look up panel by the message we replied to
                        const found = findPanelByMessageId(guildConfig, interaction.message?.id);
                        if (found) panelId = found.panelId;
                        if (!panelId && guildConfig.panels?.default) panelId = 'default';
                    }
                    const panel = panelId ? guildConfig.panels?.[panelId] : null;

                    const selectedCategory = interaction.values[0];
                    if (selectedCategory === '__none__') {
                        ticketUI.unlockCreation(interaction.guild.id, interaction.user.id);
                        return interaction.reply({
                            ...ticketUI.v2Reply(ticketUI.infoContainer('No categories are available yet. Ask an admin to add some via `/ticket-categories add`.'), true),
                        });
                    }

                    // Restrict to the panel's whitelist when present
                    const allowedCats = panel ? resolvePanelCategories(guildConfig, panel) : (guildConfig.categories || []);
                    const categoryInfo = allowedCats.find(c => c.id === selectedCategory);

                    if (!categoryInfo) {
                        ticketUI.unlockCreation(interaction.guild.id, interaction.user.id);
                        return interaction.reply({
                            ...ticketUI.v2Reply(ticketUI.errorContainer('Invalid category selected. The panel may have been updated — try again.'), true),
                        });
                    }

                    // Defer immediately — channel creation can take >3s on slow guilds
                    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);

                    // Reset the dropdown so the user can re-open another ticket later
                    // without needing to re-click the same row. Editing with the same
                    // components is enough to reset the visual selection state.
                    if (interaction.message?.editable) {
                        interaction.message.edit({ components: interaction.message.components }).catch(() => null);
                    }

                    const existingTicket = Object.entries(guildConfig.tickets || {}).find(([_, ticket]) => ticket.userId === interaction.user.id);
                    if (existingTicket) {
                        const existingChannel = interaction.guild.channels.cache.get(existingTicket[0]);
                        if (existingChannel) {
                            ticketUI.unlockCreation(interaction.guild.id, interaction.user.id);
                            return interaction.editReply({
                                components: [ticketUI.warnContainer(`You already have an open ticket: ${existingChannel}`)],
                                flags: MessageFlags.IsComponentsV2,
                            });
                        }
                        // Clean up stale ticket entry for deleted channel
                        delete guildConfig.tickets[existingTicket[0]];
                        jsonStore.write('tickets', config);
                    }

                    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
                        ticketUI.unlockCreation(interaction.guild.id, interaction.user.id);
                        return interaction.editReply({
                            components: [ticketUI.errorContainer('I don\'t have permission to create channels. Please contact an administrator.')],
                            flags: MessageFlags.IsComponentsV2,
                        });
                    }

                    // Atomic-ish ticket number bump (re-read the live store so two
                    // concurrent opens don't get the same number).
                    const liveConfig = readTicketsConfig();
                    const liveGuildConfig = ensureMigrated(liveConfig[interaction.guild.id]) || guildConfig;
                    const ticketCount = Object.keys(liveGuildConfig.tickets || {}).length;
                    liveGuildConfig.nextTicketNumber = Math.max(
                        (liveGuildConfig.nextTicketNumber || 0) + 1,
                        ticketCount + 1
                    );
                    const ticketNumber = liveGuildConfig.nextTicketNumber;
                    jsonStore.write('tickets', liveConfig);

                    // Channel name: `<categoryId>-<username>-<n>` (e.g. `general-rajeev-1`)
                    const { buildTicketChannelName } = require('./utils/ticketTranscript');
                    const ticketChannelName = buildTicketChannelName(categoryInfo.id, interaction.user.username, ticketNumber);

                    // Resolve effective overrides (panel-level wins, guild-level fallback)
                    const effectiveCategoryId = resolveChannelCategoryId(liveGuildConfig, panel);
                    const effectiveSupportRole = resolveSupportRoleId(liveGuildConfig, panel);

                    const category = effectiveCategoryId ? interaction.guild.channels.cache.get(effectiveCategoryId) : null;
                    if (!category) {
                        ticketUI.unlockCreation(interaction.guild.id, interaction.user.id);
                        return interaction.editReply({
                            components: [ticketUI.errorContainer('Ticket category not found — the Discord category may have been deleted. Ask an admin to re-run `/ticket-setup create`.')],
                            flags: MessageFlags.IsComponentsV2,
                        });
                    }

                    const overwrites = [
                        { id: interaction.guild.id, deny: ['ViewChannel'] },
                        { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks'] },
                        { id: interaction.client.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks', 'ManageChannels'] },
                    ];
                    if (effectiveSupportRole) {
                        overwrites.push({
                            id: effectiveSupportRole,
                            allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks', 'ManageMessages']
                        });
                    }

                    let ticketChannel;
                    try {
                        ticketChannel = await interaction.guild.channels.create({
                            name: ticketChannelName,
                            parent: category.id,
                            topic: `${categoryInfo.label} • Opened by ${interaction.user.tag} • #${ticketNumber}${panel ? ` • Panel: ${panel.label}` : ''}`,
                            permissionOverwrites: overwrites,
                        });
                    } catch (createErr) {
                        // Roll back the ticket-number bump so the next user
                        // doesn't see an unexplained gap in numbering.
                        const rollback = readTicketsConfig();
                        const rgc = ensureMigrated(rollback[interaction.guild.id]);
                        if (rgc?.nextTicketNumber === ticketNumber) {
                            rgc.nextTicketNumber = Math.max(0, ticketNumber - 1);
                            jsonStore.write('tickets', rollback);
                        }
                        throw createErr;
                    }

                    liveGuildConfig.tickets = liveGuildConfig.tickets || {};
                    liveGuildConfig.tickets[ticketChannel.id] = {
                        userId: interaction.user.id,
                        category: selectedCategory,
                        categoryLabel: categoryInfo.label,
                        ticketNumber,
                        panelId,                          // remember which panel opened this ticket
                        supportRoleId: effectiveSupportRole, // pin so close-perm checks survive role rotation
                        members: [],
                        createdAt: Date.now()
                    };
                    jsonStore.write('tickets', liveConfig);

                    // Use the category's emoji prefix only when it's unicode — custom
                    // emoji shortcodes display fine inline and don't need duplication.
                    const emojiDisplay = categoryInfo.emoji && !categoryInfo.emoji.startsWith('<') ? `${categoryInfo.emoji} ` : '';
                    const labelClean = categoryInfo.label.replace(/<:[^>]+>/g, '').trim();

                    const ticketButtons = ticketUI.buildTicketButtons();

                    const headerLine =
                        `# ${ticketUI.E.document} ${emojiDisplay}${labelClean}\n` +
                        `${ticketUI.E.right} **Category:** ${labelClean} ` +
                        `${ticketUI.E.right} **Ticket:** \`#${ticketNumber}\` ` +
                        `${ticketUI.E.right} **Opened:** <t:${Math.floor(Date.now() / 1000)}:R>\n\n`;

                    // Build the welcome container once, then send it. If sending
                    // fails we post a minimal fallback so the channel always has
                    // working ticket buttons (otherwise it'd be a "ghost" channel
                    // with no way for the user or staff to close it).
                    const welcomeMsg = liveGuildConfig.welcomeMessage;
                    let welcomeContainer;
                    const welcomeIsConfigured = welcomeMsg && (
                        (welcomeMsg.mode === 'embed' && (welcomeMsg.title || welcomeMsg.description)) ||
                        (welcomeMsg.mode === 'simple' && welcomeMsg.content) ||
                        (welcomeMsg.mode === 'components' && welcomeMsg.content)
                    );
                    if (welcomeIsConfigured) {
                        const { replacePlaceholders: ticketReplace, buildComponentsV2Message: buildTicketV2 } = require('./utils/actionMessageBuilder');

                        if (welcomeMsg.mode === 'components') {
                            // Honour the Components V2 mode the admin picked
                            // in the message-builder. We build a fresh container
                            // through the shared helper so thumbnail, banner
                            // image, fields and footer all render the way the
                            // preview shows them, then prepend the ticket
                            // header line and append the ticket action buttons.
                            const headerDisplay = new TextDisplayBuilder().setContent(headerLine.trimEnd());
                            const v2 = buildTicketV2(welcomeMsg, interaction.user, interaction.guild, ticketChannel);
                            // Prepend the ticket header at the start. ContainerBuilder
                            // exposes .spliceComponents which we use to insert the
                            // header above whatever buildComponentsV2Message produced.
                            try {
                                v2.spliceComponents(0, 0, headerDisplay);
                            } catch {
                                // Older discord.js shim — just add at the end if
                                // splice isn't available; the header still shows.
                                v2.addTextDisplayComponents(headerDisplay);
                            }
                            v2.addActionRowComponents(ticketButtons);
                            welcomeContainer = v2;
                        } else {
                            let body = headerLine;
                            if (welcomeMsg.mode === 'embed') {
                                if (welcomeMsg.author) body += `*${ticketReplace(welcomeMsg.author, interaction.user, interaction.guild, ticketChannel)}*\n`;
                                if (welcomeMsg.title) body += `### ${ticketReplace(welcomeMsg.title, interaction.user, interaction.guild, ticketChannel)}\n`;
                                if (welcomeMsg.description) body += `${ticketReplace(welcomeMsg.description, interaction.user, interaction.guild, ticketChannel)}\n`;
                                if (welcomeMsg.fields?.length) {
                                    body += '\n';
                                    for (const field of welcomeMsg.fields.slice(0, 25)) {
                                        body += `**${ticketReplace(field.name, interaction.user, interaction.guild, ticketChannel)}**\n${ticketReplace(field.value, interaction.user, interaction.guild, ticketChannel)}\n\n`;
                                    }
                                }
                                if (welcomeMsg.footer) body += `\n-# ${ticketReplace(welcomeMsg.footer, interaction.user, interaction.guild, ticketChannel)}`;
                            } else {
                                body += ticketReplace(welcomeMsg.content, interaction.user, interaction.guild, ticketChannel);
                            }
                            const accent = welcomeMsg.mode === 'embed'
                                ? (parseInt((welcomeMsg.color || '#5865F2').replace('#', ''), 16) || ticketUI.COLOR.BRAND)
                                : ticketUI.COLOR.BRAND;
                            welcomeContainer = new ContainerBuilder()
                                .setAccentColor(accent)
                                .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
                                .addActionRowComponents(ticketButtons);
                        }
                    } else {
                        welcomeContainer = new ContainerBuilder()
                            .setAccentColor(ticketUI.COLOR.BRAND)
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                                headerLine +
                                `Welcome ${interaction.user} — thanks for reaching out.\n\n` +
                                `### ${ticketUI.E.bulb} What to do next\n` +
                                `Describe your issue in detail. Include screenshots, error messages or links if you have them — the more context, the faster we can help.\n\n` +
                                `### ${ticketUI.E.settings} Useful Commands\n` +
                                `${ticketUI.E.right} \`/ticket-add @user\` — invite someone into the ticket\n` +
                                `${ticketUI.E.right} \`/ticket-remove @user\` — remove someone\n` +
                                `${ticketUI.E.right} \`/ticket-close [reason]\` — close this ticket\n\n` +
                                (effectiveSupportRole ? `${ticketUI.E.right} **Support Team:** <@&${effectiveSupportRole}>` : '')
                            ))
                            .addActionRowComponents(ticketButtons);
                    }

                    let welcomeSent = true;
                    await ticketChannel.send({
                        components: [welcomeContainer],
                        flags: MessageFlags.IsComponentsV2,
                    }).catch(err => {
                        welcomeSent = false;
                        log.error(`[ticket_select] welcome send failed: ${err.message}`, err);
                    });

                    // Fallback: if the welcome couldn't be posted (rare — channel
                    // perms got revoked between create + send), post a minimal
                    // close button row so the channel isn't a black hole.
                    if (!welcomeSent) {
                        await ticketChannel.send({
                            content: `${ticketUI.E.warn} Welcome message couldn't be rendered. Use the buttons below.`,
                            components: [ticketUI.buildTicketButtons()],
                        }).catch(() => { });
                    }

                    // Send a separate plain message so role + user actually get pinged
                    const pingParts = [];
                    if (effectiveSupportRole) pingParts.push(`<@&${effectiveSupportRole}>`);
                    pingParts.push(`${interaction.user}`);
                    await ticketChannel.send({
                        content: pingParts.join(' '),
                        allowedMentions: {
                            roles: effectiveSupportRole ? [effectiveSupportRole] : [],
                            users: [interaction.user.id],
                        },
                    }).catch(() => { });

                    // Best-effort DM to the opener with a jump link
                    interaction.user.send({
                        content:
                            `${ticketUI.E.ok} Your **${labelClean}** ticket has been opened in **${interaction.guild.name}**.\n` +
                            `Jump to it: ${ticketChannel.url}`,
                    }).catch(() => { /* DMs closed */ });

                    await interaction.editReply({
                        components: [new ContainerBuilder()
                            .setAccentColor(ticketUI.COLOR.SUCCESS)
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                                `# ${ticketUI.E.ok} Ticket Created\n\n` +
                                `Your **${labelClean}** ticket is ready: ${ticketChannel}\n` +
                                `${ticketUI.E.right} **Ticket Number:** \`#${ticketNumber}\``
                            ))],
                        flags: MessageFlags.IsComponentsV2,
                    });
                } catch (error) {
                    log.error(`[ticket_select] creation failed: ${error.message}`, error);
                    const ticketUI = require('./utils/ticketUI');
                    const errPayload = ticketUI.v2Reply(ticketUI.errorContainer(`There was an error creating the ticket: ${error.message?.slice(0, 200) || 'unknown'}`), true);
                    if (interaction.deferred) {
                        await interaction.editReply({ components: errPayload.components, flags: MessageFlags.IsComponentsV2 }).catch(() => { });
                    } else if (!interaction.replied) {
                        await interaction.reply(errPayload).catch(() => { });
                    }
                } finally {
                    require('./utils/ticketUI').unlockCreation(interaction.guild.id, interaction.user.id);
                }
                return;
            }

            // Handle my-music select menu
            if (interaction.customId.startsWith('mymusic_')) {
                const myMusicCmd = client.commands.get('my-music');
                if (myMusicCmd && myMusicCmd.handleSelectMenu) {
                    try {
                        const handled = await myMusicCmd.handleSelectMenu(interaction, lavalinkManager);
                        if (handled) return;
                    } catch (error) {
                        log.error(`My Music Select: ${error.message}`, error);
                    }
                }
            }

            // Handle message-builder template select menus
            if (interaction.customId.startsWith('msgbuilder_select_')) {
                const msgBuilderCmd = client.commands.get('message-builder');
                if (msgBuilderCmd && msgBuilderCmd.handleSelectMenu) {
                    try {
                        const handled = await msgBuilderCmd.handleSelectMenu(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Message Builder Select: ${error.message} — ${JSON.stringify(error.rawError?.errors || error.errors || {})}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> Something went wrong loading that template. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
            }

            // Handle welcomer template select menus
            if (interaction.customId.startsWith('welcomer_template_') || interaction.customId.startsWith('welcomer_select_') || interaction.customId.startsWith('leave_template_')) {
                const welcomerCmd = client.commands.get('welcomer');
                if (welcomerCmd && welcomerCmd.handleInteraction) {
                    try {
                        const handled = await welcomerCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Welcomer Select: ${error.message}`, error);
                    }
                }
            }

            // Handle ignore-channels select menu
            if (interaction.customId.startsWith('ignorech_')) {
                const ignoreCmd = client.commands.get('ignore-channels');
                if (ignoreCmd && ignoreCmd.handleInteraction) {
                    try {
                        const handled = await ignoreCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Ignore Channels Select: ${error.message}`, error);
                    }
                }
            }

            // Handle botblock select menu
            if (interaction.customId.startsWith('botblock_')) {
                const bbCmd = client.commands.get('botblock');
                if (bbCmd && bbCmd.handleInteraction) {
                    try {
                        const handled = await bbCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Bot Block Select: ${error.message}`, error);
                    }
                }
            }

            // Handle spotify-link select menu
            if (interaction.customId.startsWith('spotlink_')) {
                const spotlinkCmd = client.commands.get('spotify-link');
                if (spotlinkCmd && spotlinkCmd.handleInteraction) {
                    try {
                        const handled = await spotlinkCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Spotify Link Select: ${error.message}`, error);
                    }
                }
            }

            // Handle social-notify select menu
            if (interaction.customId.startsWith('social_')) {
                const socialCmd = client.commands.get('social-notify');
                if (socialCmd && socialCmd.handleInteraction) {
                    try {
                        const handled = await socialCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Social Notify Select: ${error.message}`, error);
                    }
                }
            }

            // Handle booster-notify select menu
            if (interaction.customId.startsWith('booster_')) {
                const boosterCmd = client.commands.get('booster-notify');
                if (boosterCmd && boosterCmd.handleInteraction) {
                    try {
                        const handled = await boosterCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Booster Notify Select: ${error.message}`, error);
                    }
                }
            }

            // Handle apikeys select menu
            if (interaction.customId.startsWith('apikeys_')) {
                const apikeysCmd = client.commands.get('apikeys');
                if (apikeysCmd && apikeysCmd.handleInteraction) {
                    try {
                        const handled = await apikeysCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`API Keys Select: ${error.message}`, error);
                    }
                }
            }

            // Handle bot-customize select menu
            if (interaction.customId.startsWith('botcustom_')) {
                const botCustomCmd = client.commands.get('bot-customize');
                if (botCustomCmd && botCustomCmd.handleInteraction) {
                    try {
                        const handled = await botCustomCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Bot Customize Select: ${error.message}`, error);
                    }
                }
            }

            // Handle giveaway select menu
            if (interaction.customId.startsWith('giveaway_')) {
                const giveawayCmd = client.commands.get('giveaway');
                if (giveawayCmd && giveawayCmd.handleInteraction) {
                    try {
                        const handled = await giveawayCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Giveaway Select: ${error.message}`, error);
                    }
                }
            }

            // Handle select menu command executions (deployed select menus)
            if (interaction.customId.startsWith('select_cmd_')) {
                let isSelectEphemeral = true;
                try {
                    const prefixLength = 'select_cmd_'.length;
                    const afterPrefix = interaction.customId.substring(prefixLength);
                    const firstUnderscorePos = afterPrefix.indexOf('_');

                    if (firstUnderscorePos === -1) {
                        return interaction.reply({
                            content: '<:Cancel:1521227723916181644> Invalid select menu configuration!',
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    const guildId = afterPrefix.substring(0, firstUnderscorePos);
                    const menuId = afterPrefix.substring(firstUnderscorePos + 1);

                    if (!jsonStore.has('select-menus')) {
                        return interaction.reply({
                            content: '<:Cancel:1521227723916181644> Select menu configuration not found!',
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    const menusConfig = jsonStore.peek('select-menus') || {};
                    const menuData = menusConfig[guildId]?.[menuId];

                    if (!menuData || !menuData.options) {
                        return interaction.reply({
                            content: '<:Cancel:1521227723916181644> This select menu is no longer configured!',
                            flags: MessageFlags.Ephemeral
                        });
                    }

                    // Bump usage counter (best-effort)
                    try {
                        menuData.uses = (menuData.uses || 0) + 1;
                        menuData.lastUsedAt = Date.now();
                        jsonStore.markDirty('select-menus');
                    } catch { /* non-fatal */ }

                    const selectedValues = interaction.values;
                    isSelectEphemeral = menuData.ephemeral !== false;

                    await interaction.deferReply(isSelectEphemeral ? { flags: MessageFlags.Ephemeral } : {});

                    let responseMsg = [];
                    let successCount = 0;
                    let errorCount = 0;

                    // Collect ephemeral message content (used when menu is ephemeral)
                    let ephemeralContent = [];
                    let responseEmbeds = [];
                    let responseV2 = [];

                    /**
                     * Build a Components V2 container from an action config.
                     * Mirrors the button-maker implementation so both paths
                     * render identical V2 layouts (including fields,
                     * thumbnails, and footer) by routing through the
                     * shared `buildComponentsV2Message` helper.
                     */
                    const { replacePlaceholders: amSelectReplace, buildComponentsV2Message: buildSelectV2 } = require('./utils/actionMessageBuilder');

                    const buildActionV2Container = (action) => {
                        const data = {
                            content: action.content || '',
                            color: action.color || '#5865F2',
                            image: action.image || '',
                            thumbnail: action.thumbnail || '',
                            footer: action.footer || '',
                            fields: Array.isArray(action.fields) ? action.fields : [],
                        };
                        return buildSelectV2(data, interaction.user, interaction.guild, interaction.channel);
                    };

                    // Delegate to the canonical placeholder resolver so
                    // every token documented in the builder UI works
                    // here too — and case-insensitively, matching the
                    // builder's preview behaviour. The previous local
                    // copy had a similar token list but used `g` (case
                    // sensitive), which silently broke "{userid}" vs
                    // "{userId}" mismatches between docs and runtime.
                    const replacePlaceholders = (text) =>
                        amSelectReplace(text, interaction.user, interaction.guild, interaction.channel);

                    for (const selectedValue of selectedValues) {
                        const option = menuData.options.find(o => o.value === selectedValue);
                        if (!option || !option.actions || option.actions.length === 0) {
                            responseMsg.push(`ℹ️ **${option?.label || selectedValue}** - No actions configured`);
                            continue;
                        }

                        for (const action of option.actions) {
                            try {
                                if (action.type === 'add_role') {
                                    const role = interaction.guild.roles.cache.get(action.roleId);
                                    if (!role) {
                                        responseMsg.push(`<:Cancel:1521227723916181644> Role not found`);
                                        errorCount++;
                                    } else if (role.position >= interaction.guild.members.me.roles.highest.position) {
                                        responseMsg.push(`<:Cancel:1521227723916181644> Can't add ${role.name} - too high`);
                                        errorCount++;
                                    } else {
                                        await interaction.member.roles.add(role);
                                        responseMsg.push(`<:Checkedbox:1521227734943269077> Added **${role.name}**`);
                                        successCount++;
                                    }
                                } else if (action.type === 'remove_role') {
                                    const role = interaction.guild.roles.cache.get(action.roleId);
                                    if (!role) {
                                        responseMsg.push(`<:Cancel:1521227723916181644> Role not found`);
                                        errorCount++;
                                    } else if (!interaction.member.roles.cache.has(role.id)) {
                                        responseMsg.push(`ℹ️ You don't have ${role.name}`);
                                        successCount++;
                                    } else {
                                        await interaction.member.roles.remove(role);
                                        responseMsg.push(`<:Checkedbox:1521227734943269077> Removed **${role.name}**`);
                                        successCount++;
                                    }
                                } else if (action.type === 'toggle_role') {
                                    const role = interaction.guild.roles.cache.get(action.roleId);
                                    if (!role) {
                                        responseMsg.push(`<:Cancel:1521227723916181644> Role not found`);
                                        errorCount++;
                                    } else if (role.position >= interaction.guild.members.me.roles.highest.position) {
                                        responseMsg.push(`<:Cancel:1521227723916181644> Can't toggle ${role.name} - too high`);
                                        errorCount++;
                                    } else {
                                        if (interaction.member.roles.cache.has(role.id)) {
                                            await interaction.member.roles.remove(role);
                                            responseMsg.push(`<:Checkedbox:1521227734943269077> Removed **${role.name}**`);
                                        } else {
                                            await interaction.member.roles.add(role);
                                            responseMsg.push(`<:Checkedbox:1521227734943269077> Added **${role.name}**`);
                                        }
                                        successCount++;
                                    }
                                } else if (action.type === 'send_message') {
                                    const hasExplicitChannel = action.channelId && action.channelId !== interaction.channel.id;

                                    if (isSelectEphemeral && !hasExplicitChannel) {
                                        // Ephemeral mode: collect message content to show in the ephemeral reply
                                        if (action.mode === 'embed' && action.embed) {
                                            const embed = new EmbedBuilder();
                                            if (action.embed.title) embed.setTitle(replacePlaceholders(action.embed.title));
                                            if (action.embed.description) embed.setDescription(replacePlaceholders(action.embed.description));
                                            if (action.embed.color) embed.setColor(action.embed.color);
                                            if (action.embed.image) embed.setImage(action.embed.image);
                                            if (action.embed.thumbnail) embed.setThumbnail(action.embed.thumbnail);
                                            if (action.embed.author) embed.setAuthor({ name: replacePlaceholders(action.embed.author), iconURL: action.embed.authorIcon || undefined });
                                            if (action.embed.footer) embed.setFooter({ text: replacePlaceholders(action.embed.footer), iconURL: action.embed.footerIcon || undefined });
                                            if (action.embed.fields?.length > 0) {
                                                embed.addFields(action.embed.fields.map(f => ({ name: replacePlaceholders(f.name), value: replacePlaceholders(f.value), inline: f.inline })));
                                            }
                                            responseEmbeds.push(embed);
                                        } else if (action.message) {
                                            ephemeralContent.push(replacePlaceholders(action.message));
                                        } else if (action.mode === 'components' && action.content) {
                                            // Components V2 ephemeral: build a real container instead
                                            // of flattening to plain text — preserves headings,
                                            // sections, thumbnail, image, and footer.
                                            responseV2.push(buildActionV2Container(action));
                                        } else {
                                            responseMsg.push(`<:Cancel:1521227723916181644> No message content configured`);
                                            errorCount++;
                                            continue;
                                        }
                                        successCount++;
                                    } else {
                                        // Public mode or explicit channel: send to the target channel normally
                                        const targetChannel = hasExplicitChannel ? interaction.guild.channels.cache.get(action.channelId) : interaction.channel;
                                        if (!targetChannel) {
                                            responseMsg.push(`<:Cancel:1521227723916181644> Channel not found`);
                                            errorCount++;
                                        } else {
                                            if (action.mode === 'components' && action.content) {
                                                const v2Container = buildActionV2Container(action);
                                                await targetChannel.send({ components: [v2Container], flags: MessageFlags.IsComponentsV2 });
                                            } else if (action.mode === 'embed' && action.embed) {
                                                const embed = new EmbedBuilder();
                                                if (action.embed.title) embed.setTitle(replacePlaceholders(action.embed.title));
                                                if (action.embed.description) embed.setDescription(replacePlaceholders(action.embed.description));
                                                if (action.embed.color) embed.setColor(action.embed.color);
                                                if (action.embed.image) embed.setImage(action.embed.image);
                                                if (action.embed.thumbnail) embed.setThumbnail(action.embed.thumbnail);
                                                if (action.embed.author) embed.setAuthor({ name: replacePlaceholders(action.embed.author), iconURL: action.embed.authorIcon || undefined });
                                                if (action.embed.footer) embed.setFooter({ text: replacePlaceholders(action.embed.footer), iconURL: action.embed.footerIcon || undefined });
                                                if (action.embed.fields?.length > 0) {
                                                    embed.addFields(action.embed.fields.map(f => ({ name: replacePlaceholders(f.name), value: replacePlaceholders(f.value), inline: f.inline })));
                                                }
                                                await targetChannel.send({ embeds: [embed] });
                                            } else if (action.message) {
                                                await targetChannel.send(replacePlaceholders(action.message));
                                            } else {
                                                responseMsg.push(`<:Cancel:1521227723916181644> No message content configured`);
                                                errorCount++;
                                                continue;
                                            }
                                            responseMsg.push(`<:Checkedbox:1521227734943269077> Message sent to ${targetChannel}`);
                                            successCount++;
                                        }
                                    }
                                } else if (action.type === 'send_dm') {
                                    try {
                                        const dmContent = replacePlaceholders(action.message);
                                        if (!dmContent) throw new Error('No DM content');
                                        await interaction.user.send(dmContent);
                                        responseMsg.push(`<:Checkedbox:1521227734943269077> DM sent`);
                                        successCount++;
                                    } catch {
                                        responseMsg.push(`<:Cancel:1521227723916181644> Could not send DM`);
                                        errorCount++;
                                    }
                                } else if (action.type === 'create_ticket') {
                                    const ticketName = replacePlaceholders(action.ticketName || 'ticket-{user}');
                                    const category = action.categoryId ?
                                        interaction.guild.channels.cache.get(action.categoryId) : null;

                                    // Check tickets.json for existing ticket (reliable check)
                                    let ticketsConfig2 = {};
                                    if (jsonStore.has('tickets')) {
                                        ticketsConfig2 = jsonStore.read('tickets');
                                    }
                                    const guildTickets2 = ticketsConfig2[interaction.guild.id]?.tickets || {};
                                    const existingEntry = Object.entries(guildTickets2).find(([_, t]) => t.userId === interaction.user.id);
                                    const existingChannel = existingEntry ? interaction.guild.channels.cache.get(existingEntry[0]) : null;

                                    if (existingChannel) {
                                        responseMsg.push(`ℹ️ You already have a ticket: ${existingChannel}`);
                                    } else {
                                        // Clean stale entry if channel was deleted
                                        if (existingEntry) {
                                            delete guildTickets2[existingEntry[0]];
                                        }

                                        // Get support role from ticket config if available
                                        const selSupportRoleId = ticketsConfig2[interaction.guild.id]?.supportRoleId;
                                        const selPermOverwrites = [
                                            { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                                            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                                            { id: interaction.guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }
                                        ];
                                        if (selSupportRoleId) {
                                            selPermOverwrites.push({ id: selSupportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
                                        }

                                        const ticketChannel = await interaction.guild.channels.create({
                                            name: ticketName,
                                            type: ChannelType.GuildText,
                                            parent: category,
                                            permissionOverwrites: selPermOverwrites
                                        });

                                        // Persist ticket to tickets.json
                                        if (!ticketsConfig2[interaction.guild.id]) {
                                            ticketsConfig2[interaction.guild.id] = { tickets: {} };
                                        }
                                        if (!ticketsConfig2[interaction.guild.id].tickets) {
                                            ticketsConfig2[interaction.guild.id].tickets = {};
                                        }
                                        ticketsConfig2[interaction.guild.id].tickets[ticketChannel.id] = {
                                            userId: interaction.user.id,
                                            category: 'select-menu-maker',
                                            categoryLabel: 'Select Menu Ticket',
                                            createdAt: Date.now()
                                        };
                                        jsonStore.write('tickets', ticketsConfig2);

                                        // Send welcome message with buttons
                                        const smTicketButtons = new ActionRowBuilder()
                                            .addComponents(
                                                new ButtonBuilder()
                                                    .setCustomId('ticket_claim')
                                                    .setLabel('Claim Ticket')
                                                    .setStyle(ButtonStyle.Primary)
                                                    .setEmoji('🎫'),
                                                new ButtonBuilder()
                                                    .setCustomId('ticket_close_btn')
                                                    .setLabel('Close Ticket')
                                                    .setStyle(ButtonStyle.Danger)
                                                    .setEmoji('<:Lock:1521227892770734120>'),
                                                new ButtonBuilder()
                                                    .setCustomId('ticket_transcript')
                                                    .setLabel('Save Transcript')
                                                    .setStyle(ButtonStyle.Secondary)
                                                    .setEmoji('<:Clipboardalt:1521228169753923755>')
                                            );

                                        const smWelcomeContainer = new ContainerBuilder()
                                            .addTextDisplayComponents(
                                                new TextDisplayBuilder()
                                                    .setContent(
                                                        `# 🎫 Support Ticket\n\n` +
                                                        `Welcome ${interaction.user}! Thank you for reaching out.\n\n` +
                                                        `**Created:** <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                                                        `Please describe your issue in detail and a team member will assist you shortly.`
                                                    )
                                            )
                                            .addActionRowComponents(smTicketButtons);

                                        await ticketChannel.send({
                                            components: [smWelcomeContainer],
                                            flags: MessageFlags.IsComponentsV2
                                        }).catch(() => { });

                                        // Send ping message so role + user actually get notified
                                        const selPingParts = [];
                                        if (selSupportRoleId) selPingParts.push(`<@&${selSupportRoleId}>`);
                                        selPingParts.push(`${interaction.user}`);
                                        await ticketChannel.send(`${selPingParts.join(' ')} — A new ticket has been opened!`).catch(() => { });

                                        responseMsg.push(`<:Checkedbox:1521227734943269077> Ticket created: ${ticketChannel}`);
                                        successCount++;
                                    }
                                } else if (action.type === 'send_embed') {
                                    const targetChannel = action.channelId ?
                                        interaction.guild.channels.cache.get(action.channelId) :
                                        interaction.channel;
                                    if (targetChannel) {
                                        const embed = new EmbedBuilder()
                                            .setTitle(replacePlaceholders(action.title))
                                            .setDescription(replacePlaceholders(action.description))
                                            .setColor(action.color || '#bcf1e4');
                                        await targetChannel.send({ embeds: [embed] });
                                        responseMsg.push(`<:Checkedbox:1521227734943269077> Embed sent`);
                                        successCount++;
                                    } else {
                                        responseMsg.push(`<:Cancel:1521227723916181644> Channel not found`);
                                        errorCount++;
                                    }
                                } else if (action.type === 'create_channel') {
                                    const channelName = replacePlaceholders(action.channelName);
                                    const category = action.categoryId ?
                                        interaction.guild.channels.cache.get(action.categoryId) : null;

                                    const newChannel = await interaction.guild.channels.create({
                                        name: channelName,
                                        type: ChannelType.GuildText,
                                        parent: category
                                    });
                                    responseMsg.push(`<:Checkedbox:1521227734943269077> Created ${newChannel}`);
                                    successCount++;
                                }
                            } catch (actionError) {
                                responseMsg.push(`<:Cancel:1521227723916181644> Action failed: ${actionError.message}`);
                                errorCount++;
                            }
                        }
                    }

                    // If we have ephemeral content from send_message actions, show them directly
                    // instead of the generic "Selection Complete" summary
                    if (isSelectEphemeral && (ephemeralContent.length > 0 || responseEmbeds.length > 0 || responseV2.length > 0) && errorCount === 0) {
                        const hasNonMessageActions = responseMsg.length > 0;

                        // Components V2 cannot share a payload with embeds or content,
                        // so when V2 containers are present we send them as the primary
                        // reply and any text/embeds as a follow-up.
                        if (responseV2.length > 0 && !hasNonMessageActions) {
                            await interaction.editReply({
                                components: responseV2,
                                flags: MessageFlags.IsComponentsV2
                            });
                            if (ephemeralContent.length > 0) {
                                await interaction.followUp({
                                    content: ephemeralContent.join('\n'),
                                    flags: MessageFlags.Ephemeral
                                }).catch(() => { });
                            }
                            if (responseEmbeds.length > 0) {
                                await interaction.followUp({
                                    embeds: responseEmbeds.slice(0, 10),
                                    flags: MessageFlags.Ephemeral
                                }).catch(() => { });
                            }
                        } else if (!hasNonMessageActions && ephemeralContent.length > 0 && responseEmbeds.length === 0) {
                            // Pure text message(s) — show cleanly as ephemeral
                            await interaction.editReply({
                                content: ephemeralContent.join('\n'),
                                components: []
                            });
                        } else if (!hasNonMessageActions && responseEmbeds.length > 0 && ephemeralContent.length === 0) {
                            // Pure embed(s) — show as ephemeral
                            await interaction.editReply({
                                embeds: responseEmbeds.slice(0, 10),
                                components: []
                            });
                        } else if (!hasNonMessageActions && responseEmbeds.length > 0 && ephemeralContent.length > 0) {
                            // Mixed text + embeds
                            await interaction.editReply({
                                content: ephemeralContent.join('\n'),
                                embeds: responseEmbeds.slice(0, 10),
                                components: []
                            });
                        } else {
                            // Has other action results too — show combined
                            let content = ephemeralContent.length > 0 ? ephemeralContent.join('\n') : '';
                            if (responseMsg.length > 0) {
                                content += (content ? '\n\n' : '') + responseMsg.join('\n');
                            }
                            const replyPayload = {};
                            if (content) replyPayload.content = content;
                            if (responseEmbeds.length > 0) replyPayload.embeds = responseEmbeds.slice(0, 10);
                            replyPayload.components = [];
                            await interaction.editReply(replyPayload);
                            if (responseV2.length > 0) {
                                await interaction.followUp({
                                    components: responseV2,
                                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                                }).catch(() => { });
                            }
                        }
                    } else {
                        // Build standard response with Components V2 summary
                        let statusEmoji = successCount > 0 ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';
                        let content = `# ${statusEmoji} Selection Complete\n\n`;
                        content += `**Selected:** ${selectedValues.join(', ')}\n`;
                        content += `**Results:** ${successCount} successful, ${errorCount} failed\n\n`;

                        // Include any ephemeral content that couldn't be shown alone due to errors
                        if (ephemeralContent.length > 0) {
                            content += ephemeralContent.join('\n') + '\n\n';
                        }

                        if (responseMsg.length > 0) {
                            content += responseMsg.join('\n');
                        }

                        const container = new ContainerBuilder()
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

                        const editPayload = { components: [container], flags: MessageFlags.IsComponentsV2 };
                        if (responseEmbeds.length > 0) editPayload.embeds = responseEmbeds.slice(0, 10);
                        await interaction.editReply(editPayload);
                    }
                } catch (error) {
                    log.error(`Select Menu Command: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> Error executing menu actions!', flags: isSelectEphemeral ? MessageFlags.Ephemeral : 0 });
                    } else {
                        await interaction.editReply({ content: '<:Cancel:1521227723916181644> Error executing menu actions!' });
                    }
                }
                return;
            }

            // Handle select-menu-maker action select (edit-actions dropdown)
            if (interaction.customId.startsWith('select_action_add:')) {
                const selectMenuCmd = client.commands.get('select-menu-maker');
                if (selectMenuCmd && selectMenuCmd.handleInteraction) {
                    try {
                        const handled = await selectMenuCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Select Menu Maker: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> Error configuring action!', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
                return;
            }

            // Handle quicksetup toggle select menu
            if (interaction.customId === 'quicksetup_toggle') {
                const quicksetupCmd = client.commands.get('quicksetup');
                if (quicksetupCmd && quicksetupCmd.handleInteraction) {
                    try {
                        const handled = await quicksetupCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Quick Setup Select: ${error.message}`, error);
                    }
                }
                return;
            }

            // Handle roletemplate toggle select menu and role select panels
            if (interaction.customId === 'roletemplate_toggle' || interaction.customId.startsWith('rt_select_')) {
                const rtCmd = client.commands.get('roletemplate');
                if (rtCmd && rtCmd.handleInteraction) {
                    try {
                        const handled = await rtCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Role Template Select: ${error.message}`, error);
                    }
                }
                return;
            }

            // Handle anti limit select menu
            if (interaction.customId === 'anti_select_category') {
                const antiCmd = client.commands.get('anti');
                if (antiCmd && antiCmd.handleInteraction) {
                    try {
                        await antiCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Anti Limit Select: ${error.message}`, error);
                    }
                }
                return;
            }

            // Handle antinuke select menus
            if (interaction.customId === 'antinuke_protection_select' || interaction.customId === 'antinuke_action_select' || interaction.customId === 'antinuke_power_select') {
                try {
                    await handleAntiNukeButtons(interaction);
                } catch (error) {
                    log.error(`Anti-Nuke select: ${error.message}`, error);
                    if (!interaction.replied) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error!', flags: MessageFlags.Ephemeral });
                    }
                }
                return;
            }

            if (interaction.customId === 'help_category' || interaction.customId === 'help_category2') {
                const helpCommand = client.commands.get('help');
                if (helpCommand && helpCommand.handleSelectMenu) {
                    try {
                        await helpCommand.handleSelectMenu(interaction);
                    } catch (error) {
                        log.error(`Help select: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred. Please try using the command again.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
                return;
            }

            if (interaction.customId === 'help_more_options') {
                const helpCommand = client.commands.get('help');
                if (helpCommand && helpCommand.handleMoreOptions) {
                    try {
                        await helpCommand.handleMoreOptions(interaction);
                    } catch (error) {
                        log.error(`Help more options: ${error.message}`, error);
                        if (!interaction.replied && !interaction.deferred) {
                            await interaction.reply({ content: '<:Cancel:1521227723916181644> An error occurred. Please try using the command again.', flags: MessageFlags.Ephemeral }).catch(() => { });
                        }
                    }
                }
                return;
            }
        }

        if (interaction.isChannelSelectMenu()) {
            // Live Leaderboard channel selects
            if (interaction.customId === 'llb_channels' || interaction.customId === 'llb_target') {
                const llbCmd = client.commands.get('liveleaderboard');
                if (llbCmd?.handleInteraction) {
                    try { const h = await llbCmd.handleInteraction(interaction); if (h) return; } catch (e) { log.error(`LLB Channel Select: ${e.message}`, e); }
                }
                return;
            }
            // J2C admin channel pickers (trigger VC, panel text channel, spawn category)
            if (interaction.customId.startsWith('j2cset_select_trigger_')
                || interaction.customId.startsWith('j2cset_select_panel_')
                || interaction.customId.startsWith('j2cset_select_category_')) {
                const j2cCmd = client.commands.get('join2create-setup');
                if (j2cCmd?.handleInteraction) {
                    try {
                        const handled = await j2cCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`J2C Setup Channel Select: ${error.message}`, error);
                    }
                }
                return;
            }
            // Quick-setup log channel picker
            if (interaction.customId === 'quicksetup_logchannel') {
                const quicksetupCmd = client.commands.get('quicksetup');
                if (quicksetupCmd && quicksetupCmd.handleInteraction) {
                    try {
                        const handled = await quicksetupCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Quick Setup Channel Select: ${error.message}`, error);
                    }
                }
                return;
            }
            // Feedback system channel selects
            if (interaction.customId === 'fb_select_channel' || interaction.customId === 'fb_select_logs') {
                const feedbackCmd = client.commands.get('feedback');
                if (feedbackCmd && feedbackCmd.handleInteraction) {
                    try {
                        await feedbackCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Feedback Channel Select Error: ${error.message}`, error);
                    }
                }
                return;
            }
            // Suggestion system channel selects
            if (interaction.customId === 'sug_select_channel' || interaction.customId === 'sug_select_logs') {
                const suggestionCmd = client.commands.get('suggestion');
                if (suggestionCmd && suggestionCmd.handleInteraction) {
                    try {
                        const handled = await suggestionCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Suggestion Channel Select Error: ${error.message}`, error);
                    }
                }
                return;
            }
            // Anti-Nuke channel select menus
            if (interaction.customId.startsWith('antinuke_select_')) {
                const antinukeCmd = client.commands.get('antinuke');
                if (antinukeCmd && antinukeCmd.handleInteraction) {
                    try {
                        const handled = await antinukeCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Anti-Nuke Channel Select: ${error.message}`, error);
                    }
                }
                return;
            }
            // Welcomer / Leave channel select menus — unified handlers in welcomer.js
            if (interaction.customId === 'welcomer_select_channel_unified' || interaction.customId === 'leave_select_channel_unified') {
                const welcomerCmd = client.commands.get('welcomer');
                if (welcomerCmd && welcomerCmd.handleInteraction) {
                    try {
                        const handled = await welcomerCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Welcomer/Leave Channel Select (unified): ${error.message}`, error);
                    }
                }
                return;
            }
            // Welcomer/Leave channel select menus — legacy handlers in interactionHandlers
            if (interaction.customId === 'welcomer_comp_select_channel' || interaction.customId === 'welcomer_select_channel' || interaction.customId === 'leave_select_channel') {
                try {
                    await handleModalSubmit(interaction);
                } catch (error) {
                    log.error(`Welcomer/Leave Channel Select (handlers): ${error.message}`, error);
                }
                return;
            }
            // AutoMod channel select menus (interactionHandlers)
            if (interaction.customId === 'automod_select_log_channel' || interaction.customId === 'automod_select_ignore_channels') {
                try {
                    await handleModalSubmit(interaction);
                } catch (error) {
                    log.error(`AutoMod Channel Select: ${error.message}`, error);
                }
                return;
            }
            if (interaction.customId.startsWith('aichat_')) {
                const aichatCmd = client.commands.get('aichat-setup');
                if (aichatCmd && aichatCmd.handleInteraction) {
                    try {
                        const handled = await aichatCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`AI Chat Channel Select: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId === 'rrsetup_select_channel') {
                const rrCmd = client.commands.get('reactionroles');
                if (rrCmd && rrCmd.handleSetupSelect) {
                    try {
                        await rrCmd.handleSetupSelect(interaction);
                    } catch (error) {
                        log.error(`RR Setup Channel Select: ${error.message}`, error);
                    }
                }
                return;
            }

            if (interaction.customId.startsWith('ignorech_')) {
                const ignoreCmd = client.commands.get('ignore-channels');
                if (ignoreCmd && ignoreCmd.handleInteraction) {
                    try {
                        const handled = await ignoreCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Ignore Channels Channel Select: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('botblock_')) {
                const bbCmd = client.commands.get('botblock');
                if (bbCmd && bbCmd.handleInteraction) {
                    try {
                        const handled = await bbCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Bot Block Channel Select: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('app_select_')) {
                const appCmd = client.commands.get('application');
                if (appCmd && appCmd.handleInteraction) {
                    try {
                        await appCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Application Channel Select: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('sshot_select_')) {
                const sshotCmd = client.commands.get('screenshot-verify');
                if (sshotCmd && sshotCmd.handleInteraction) {
                    try {
                        await sshotCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Screenshot Verify Channel Select: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('social_')) {
                const socialCmd = client.commands.get('social-notify');
                if (socialCmd && socialCmd.handleInteraction) {
                    try {
                        const handled = await socialCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Social Notify Channel Select: ${error.message}`, error);
                    }
                }
            }
            // Birthday system channel selects (announce + public panel pickers)
            if (interaction.customId === 'bdaysetup_channelpick' || interaction.customId === 'bdaysetup_panelpick') {
                const bdayCmd = client.commands.get('birthday-setup');
                if (bdayCmd?.handleInteraction) {
                    try {
                        const handled = await bdayCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Birthday Channel Select: ${error.message}`, error);
                    }
                }
                return;
            }
            // Confession setup channel selects (channel, log channel, public panel)
            if (interaction.customId === 'confsetup_channelpick'
                || interaction.customId === 'confsetup_logpick'
                || interaction.customId === 'confsetup_panelpick') {
                const confSetupCmd = client.commands.get('confession-setup');
                if (confSetupCmd?.handleInteraction) {
                    try {
                        const handled = await confSetupCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Confession Setup Channel Select: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('booster_')) {
                const boosterCmd = client.commands.get('booster-notify');
                if (boosterCmd && boosterCmd.handleInteraction) {
                    try {
                        const handled = await boosterCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Booster Notify Channel Select: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('sticky_')) {
                try {
                    await handleStickyButtons(interaction);
                } catch (error) {
                    log.error(`Sticky Channel Select: ${error.message}`, error);
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error!', flags: MessageFlags.Ephemeral }).catch(() => { });
                    }
                }
                return;
            }
        }

        if (interaction.isRoleSelectMenu()) {
            // J2C allowed-roles picker (premium-only feature)
            if (interaction.customId.startsWith('j2cset_select_roles_')) {
                const j2cCmd = client.commands.get('join2create-setup');
                if (j2cCmd?.handleInteraction) {
                    try {
                        const handled = await j2cCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`J2C Setup Role Select: ${error.message}`, error);
                    }
                }
                return;
            }
            // Anti-Nuke role select menus
            if (interaction.customId.startsWith('antinuke_select_')) {
                const antinukeCmd = client.commands.get('antinuke');
                if (antinukeCmd && antinukeCmd.handleInteraction) {
                    try {
                        const handled = await antinukeCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Anti-Nuke Role Select: ${error.message}`, error);
                    }
                }
                return;
            }
            // Birthday role picker
            if (interaction.customId === 'bdaysetup_rolepick') {
                const bdayCmd = client.commands.get('birthday-setup');
                if (bdayCmd?.handleInteraction) {
                    try {
                        const handled = await bdayCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Birthday Role Select: ${error.message}`, error);
                    }
                }
                return;
            }
            // Welcomer autorole select menus — unified handlers in welcomer.js
            if (interaction.customId === 'welcomer_select_autorole_humans_unified' || interaction.customId === 'welcomer_select_autorole_bots_unified') {
                const welcomerCmd = client.commands.get('welcomer');
                if (welcomerCmd && welcomerCmd.handleInteraction) {
                    try {
                        const handled = await welcomerCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Welcomer AutoRole Select (unified): ${error.message}`, error);
                    }
                }
                return;
            }
            // Welcomer autorole select menus — legacy handlers in handleWelcomerButtons
            if (interaction.customId === 'welcomer_select_autorole_humans' || interaction.customId === 'welcomer_select_autorole_bots') {
                try {
                    await handleWelcomerButtons(interaction);
                } catch (error) {
                    log.error(`Welcomer AutoRole Select (handlers): ${error.message}`, error);
                }
                return;
            }
            // AutoMod role select menus (interactionHandlers)
            if (interaction.customId === 'automod_select_bypass_role' || interaction.customId === 'automod_select_ignore_roles') {
                try {
                    await handleModalSubmit(interaction);
                } catch (error) {
                    log.error(`AutoMod Role Select: ${error.message}`, error);
                }
                return;
            }
            if (interaction.customId.startsWith('app_select_')) {
                const appCmd = client.commands.get('application');
                if (appCmd && appCmd.handleInteraction) {
                    try {
                        await appCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Application Role Select: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('sshot_select_')) {
                const sshotCmd = client.commands.get('screenshot-verify');
                if (sshotCmd && sshotCmd.handleInteraction) {
                    try {
                        await sshotCmd.handleInteraction(interaction);
                    } catch (error) {
                        log.error(`Screenshot Verify Role Select: ${error.message}`, error);
                    }
                }
                return;
            }
            if (interaction.customId.startsWith('ignorech_')) {
                const ignoreCmd = client.commands.get('ignore-channels');
                if (ignoreCmd && ignoreCmd.handleInteraction) {
                    try {
                        const handled = await ignoreCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Ignore Channels Role Select: ${error.message}`, error);
                    }
                }
            }
            if (interaction.customId.startsWith('social_')) {
                const socialCmd = client.commands.get('social-notify');
                if (socialCmd && socialCmd.handleInteraction) {
                    try {
                        const handled = await socialCmd.handleInteraction(interaction);
                        if (handled) return;
                    } catch (error) {
                        log.error(`Social Notify Role Select: ${error.message}`, error);
                    }
                }
            }
        }
        return;
    }

    // ───────── User Select Menus ─────────
    if (interaction.isUserSelectMenu && interaction.isUserSelectMenu()) {
        // J2C member-target actions (kick / block / unblock / permit / trust / untrust / transfer)
        if (interaction.customId.startsWith('j2c_select_')) {
            try {
                const handled = await handleJ2CSelects(interaction);
                if (handled) return;
            } catch (error) {
                log.error(`J2C User Select: ${error.message}`, error);
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: '<:Cancel:1521227723916181644> There was an error!', flags: MessageFlags.Ephemeral }).catch(() => { });
                }
            }
            return;
        }
        return;
    }

    // Block slash commands in music panel channel (only panel buttons allowed there)
    if (interaction.guild) {
        if (jsonStore.has('musicpanel')) {
            try {
                const panelConfig = jsonStore.read('musicpanel');
                const guildPanel = panelConfig[interaction.guild.id];
                if (guildPanel && interaction.channel.id === guildPanel.channelId) {
                    return interaction.reply({
                        content: '<:Cancel:1521227723916181644> Commands are disabled in the music panel channel. Just type a song name or URL to play music!',
                        flags: MessageFlags.Ephemeral
                    }).catch(() => { });
                }
            } catch (e) { }
        }
    }

    // Check if channel is ignored for slash commands
    if (interaction.guild) {
        const ignoreChannelsCmd = client.commands.get('ignore-channels');
        if (ignoreChannelsCmd) {
            const ignoreConfig = ignoreChannelsCmd.getGuildConfig(interaction.guild.id);
            const categoryId = interaction.channel?.parentId || null;

            if (ignoreChannelsCmd.isChannelIgnored(interaction.guild.id, interaction.channel.id, categoryId)) {
                if (!ignoreChannelsCmd.canBypass(interaction.member, ignoreConfig)) {
                    return interaction.reply({
                        content: '<:Commentblock:1521227898101432331> **Commands Disabled**\n\nBot commands are disabled in this channel.',
                        flags: MessageFlags.Ephemeral
                    }).catch(() => { });
                }
            }
        }
    }

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    // Block all slash commands in DMs — bot is server-only
    if (!interaction.guild) {
        return interaction.reply({ content: '<:Cancel:1521227723916181644> This bot only works in servers. Please use commands in a server, not in DMs.', flags: MessageFlags.Ephemeral }).catch(() => { });
    }

    if (command.premiumOnly && !premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild?.id)) {
        try {
            const { buildPremiumGate } = require('./utils/responseBuilder');
            return interaction.reply({
                components: [buildPremiumGate(`/${interaction.commandName}`)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            }).catch(() => { });
        } catch {
            return interaction.reply({ content: '<:Cancel:1521227723916181644> This feature requires **Premium**. Use `/redeemkey` to activate or ask an admin to activate server premium.', flags: MessageFlags.Ephemeral }).catch(() => { });
        }
    }

    // ── Bot Permission Pre-Check ──
    if (interaction.guild) {
        const cmdName = interaction.commandName;
        const permCheck = checkBotPermissions(interaction.guild, interaction.channel, cmdName);
        if (!permCheck.allowed) {
            return notifyMissingPermissionsSlash(interaction, cmdName, permCheck.missing);
        }
    }

    // ── Slash Command Cooldown Check (Premium users bypass) ──
    if (interaction.guild && !premiumManager.hasPremiumAccess(interaction.user.id, interaction.guild.id)) {
        const slashCooldown = botCustomize.getCooldown(interaction.guild.id);
        if (slashCooldown > 0) {
            const cdKey = `${interaction.guild.id}_${interaction.user.id}_${interaction.commandName}`;
            const now = Date.now();
            if (!client._cmdCooldowns) client._cmdCooldowns = new Map();
            const lastUsed = client._cmdCooldowns.get(cdKey) || 0;
            if (now - lastUsed < slashCooldown * 1000) {
                const remaining = ((slashCooldown * 1000 - (now - lastUsed)) / 1000).toFixed(1);
                return interaction.reply({ content: `<:Timer:1521227971590095070> Please wait **${remaining}s** before using \`/${interaction.commandName}\` again.`, flags: MessageFlags.Ephemeral }).catch(() => { });
            }
            client._cmdCooldowns.set(cdKey, now);
        }
    }

    // ── Apply Guild Customization to Slash Responses ──
    if (interaction.guild) {
        const _gCfg = botCustomize.getConfig(interaction.guild.id);
        const _gColor = botCustomize.getEmbedColor(interaction.guild.id);

        // Attach for commands that want direct access
        interaction._guildAccentColor = _gColor;
        interaction._guildFooterText = _gCfg.footerText;
        interaction._guildFooterIcon = _gCfg.footerIcon;

        const _patchOpts = (opts) => {
            if (typeof opts === 'string') opts = { content: opts };
            if (!opts) opts = {};
            // Ephemeral injection
            if (_gCfg.ephemeralResponses) {
                opts.flags = (opts.flags || 0) | MessageFlags.Ephemeral;
            }
            // Accent color on Components V2 containers (type 17) and
            // append footer text as a small TextDisplay (type 10) at
            // the end of every container. Uses the guild's custom
            // footerText when set, otherwise falls back to the default
            // BRANDING line. This centralises branding so individual
            // commands never need to hardcode it.
            if (opts.components && Array.isArray(opts.components)) {
                const _footerText = _gCfg.footerText || '<:xnico:1486755083390550036> [xNico </>](https://discord.gg/Zs35X7Umak) Development';
                _injectCv2Footer(opts.components, _gColor, _footerText);
            }
            // Embed color + footer
            if (opts.embeds && Array.isArray(opts.embeds)) {
                for (const e of opts.embeds) {
                    const d = e?.data ?? e;
                    if (!d) continue;
                    // Always force guild color (colorless = remove, else override)
                    if (_gColor === null) {
                        delete d.color;
                    } else if (Number.isFinite(_gColor)) {
                        d.color = _gColor;
                    }
                    // Always inject footer (custom or default)
                    if (!d.footer) {
                        const _ft = _gCfg.footerText || '<:xnico:1486755083390550036> [xNico </>](https://discord.gg/Zs35X7Umak) Development';
                        d.footer = { text: _ft };
                        if (_gCfg.footerIcon) d.footer.icon_url = _gCfg.footerIcon;
                    }
                }
            }
            return _remapPayloadEmojis(opts);
        };

        const _origReply = interaction.reply.bind(interaction);
        const _origFollowUp = interaction.followUp.bind(interaction);
        const _origEditReply = interaction.editReply.bind(interaction);
        const _origDeferReply = interaction.deferReply.bind(interaction);
        interaction.reply = (o) => _origReply(_patchOpts(o));
        interaction.followUp = (o) => _origFollowUp(_patchOpts(o));
        interaction.editReply = (o) => _origEditReply(_patchOpts(o));
        interaction.deferReply = (o) => {
            o = o || {};
            if (_gCfg.ephemeralResponses) o.flags = (o.flags || 0) | MessageFlags.Ephemeral;
            return _origDeferReply(o);
        };
    }

    try {
        // ═══════ ToS Acceptance Check ═══════
        const tosManager = require('./utils/tosManager');
        if (!tosManager.hasAcceptedTos(interaction.user.id)) {
            const container = tosManager.buildTosPanel(interaction.user);

            return interaction.reply({
                components: [container],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        trackCommand(interaction.commandName, interaction.user.id, interaction.guildId);

        // ═══════ Owner "temporarily disabled" gate ═══════
        const _disabledRec = require('./utils/disabledCommands').isDisabled(command.data?.name || interaction.commandName);
        if (_disabledRec && !isOwner(interaction.user.id)) {
            return interaction.reply({
                components: [require('./utils/disabledCommands').buildNotice('/' + (command.data?.name || interaction.commandName), _disabledRec)],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        // ═══════ Vote Lock Gate ═══════
        {
            const voteLock = require('./utils/voteLock');
            const slashCmdName = command.data?.name || interaction.commandName;
            if (voteLock.isVoteLocked(slashCmdName) && !premiumManager.hasPremiumAccess(interaction.user.id, interaction.guildId) && !voteLock.hasActiveVote(interaction.user.id)) {
                return interaction.reply({
                    components: [voteLock.buildVoteGate(slashCmdName)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                });
            }
        }

        await command.execute(interaction, client.lavalinkManager);
    } catch (error) {
        // ── Handle permission errors specifically ──
        if (isPermissionError(error)) {
            const perms = inferPermissionsFromCommand(interaction.commandName, command.category);
            await notifyMissingPermissionsSlash(interaction, interaction.commandName, perms);
            return;
        }

        // ── Non-actionable interaction token errors ──
        // 10062 Unknown interaction (command replied too slowly, >3s without defer)
        // 40060 Interaction already acknowledged
        // 50027 Invalid Webhook Token (interaction token expired)
        // These can't be answered and aren't bugs — log quietly and stop, don't
        // attempt another reply (which would just fail again) or spam the console.
        const TOKEN_ERROR_CODES = [10062, 40060, 50027];
        if (TOKEN_ERROR_CODES.includes(error?.code)) {
            log.debug(`Interaction token expired on /${interaction.commandName} (code ${error.code}) — skipped response`);
            return;
        }

        log.error(`Command error (${interaction.commandName}): ${error.message}`, error);

        // Log error to designated channel
        await logError(client, error, {
            type: 'Slash Command Error',
            command: `/${interaction.commandName}`,
            user: interaction.user,
            guild: interaction.guild,
            channel: interaction.channel
        });

        try {
            const errorId = generateErrorId();
            await sendErrorReply(interaction, 'There was an error executing this command!', errorId);
        } catch (replyError) {
            // Reply error
        }
    }
});

// Voice Greeting System
client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        if (!oldState.member || oldState.member.user?.bot) return;

        const isJoin = !oldState.channelId && newState.channelId;
        const isLeave = oldState.channelId && !newState.channelId;
        const isSwitch = oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId;

        if (!isJoin && !isLeave && !isSwitch) return;

        if (!jsonStore.has('voiceautorole')) return;
        const config = jsonStore.read('voiceautorole');
        const guildId = newState.guild.id || oldState.guild.id;
        const guildConfig = config[guildId];

        if (!guildConfig || !guildConfig.enabled || !guildConfig.voiceChannelId) return;

        const targetChannelId = guildConfig.voiceChannelId;

        // Only trigger for the configured voice channel
        const isTargetJoin = (isJoin || isSwitch) && newState.channelId === targetChannelId;
        const isTargetLeave = (isLeave || isSwitch) && oldState.channelId === targetChannelId;
        if (!isTargetJoin && !isTargetLeave) return;

        // Auto-reconnect: create player if it doesn't exist
        let player = client.lavalinkManager.getPlayer(guildId);
        if (!player || !player.connected) {
            try {
                player = client.lavalinkManager.createPlayer({
                    guildId: guildId,
                    voiceChannelId: targetChannelId,
                    textChannelId: guildConfig.textChannelId || targetChannelId,
                    selfDeaf: true
                });
                if (!player.connected) await player.connect();
            } catch (err) {
                log.debug(`Voice greet auto-reconnect failed: ${err.message}`);
                return;
            }
        }

        // Read guild language config
        let lang = 'en';
        if (jsonStore.has('guilds')) {
            try {
                const guilds = jsonStore.read('guilds');
                const g = guilds.find(x => x.guild_id === guildId);
                if (g?.speak?.default_lang) lang = g.speak.default_lang;
            } catch { }
        }

        const memberName = newState.member?.displayName || oldState.member?.displayName || 'Someone';
        const leaveName = oldState.member?.displayName || 'Someone';

        const welcomeTexts = {
            'en': `Welcome, ${memberName}. Nice to see you.`,
            'hi': `${memberName} जी, आपका स्वागत है।`,
            'es': `Bienvenido, ${memberName}. Qué gusto verte.`,
            'fr': `Bienvenue, ${memberName}. Ravi de vous voir.`,
            'de': `Willkommen, ${memberName}. Schön dich zu sehen.`,
            'ja': `${memberName}さん、いらっしゃいませ。`,
            'ko': `${memberName}님, 환영합니다.`,
            'pt': `Bem-vindo, ${memberName}. Bom te ver.`,
            'ru': `Добро пожаловать, ${memberName}.`,
            'ar': `مرحبا ${memberName}. سعيد برؤيتك.`,
            'bn': `স্বাগতম, ${memberName}।`,
            'ta': `வரவேற்கிறோம், ${memberName}.`,
            'te': `స్వాగతం, ${memberName}.`,
            'mr': `स्वागत, ${memberName}.`,
            'gu': `આવકાર, ${memberName}.`,
            'pa': `ਜੀ ਆਇਆ ਨੂੰ, ${memberName}.`,
            'ur': `${memberName} جی، خوش آمدید۔`
        };
        const leaveTexts = {
            'en': `Goodbye, ${leaveName}. Have a great day.`,
            'hi': `अलविदा, ${leaveName} जी। आपका दिन शुभ हो।`,
            'es': `Adiós, ${leaveName}. Que tengas un gran día.`,
            'fr': `Au revoir, ${leaveName}. Bonne journée.`,
            'de': `Tschüss, ${leaveName}. Schönen Tag noch.`,
            'ja': `${leaveName}さん、さようなら。`,
            'ko': `${leaveName}님, 안녕히 가세요.`,
            'pt': `Tchau, ${leaveName}. Tenha um bom dia.`,
            'ru': `До свидания, ${leaveName}. Хорошего дня.`,
            'ar': `مع السلامة ${leaveName}. يوم سعيد.`,
            'bn': `বিদায়, ${leaveName}। ভালো থাকবেন।`,
            'ta': `பிரியாவிடை, ${leaveName}.`,
            'te': `వీడ్కోలు, ${leaveName}.`,
            'mr': `निरोप, ${leaveName}.`,
            'gu': `આવજો, ${leaveName}.`,
            'pa': `ਅਲਵਿਦਾ, ${leaveName}.`,
            'ur': `خدا حافظ، ${leaveName} جی۔`
        };

        let text = '';
        // Use the correct text for the configured language, fallback to English
        if (isTargetJoin) {
            text = welcomeTexts[lang] || welcomeTexts['en'];
        } else if (isTargetLeave) {
            text = leaveTexts[lang] || leaveTexts['en'];
        }

        if (!text) return;

        // Determine TTS language code - must match the language of the text
        const textLang = welcomeTexts[lang] ? lang : 'en';
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${textLang}&client=gtx`;

        // Try to play TTS through Lavalink
        async function tryPlay(url) {
            try {
                const res = await player.search({ query: url }, client.user);
                if (res.tracks?.length) {
                    const track = res.tracks[0];
                    track.isSpeakCmd = true;
                    await player.queue.add(track);
                    if (!player.playing && !player.paused) await player.play();
                    return true;
                }
            } catch { }
            try {
                const res = await player.search({ query: url, source: 'http' }, client.user);
                if (res.tracks?.length) {
                    const track = res.tracks[0];
                    track.isSpeakCmd = true;
                    await player.queue.add(track);
                    if (!player.playing && !player.paused) await player.play();
                    return true;
                }
            } catch { }
            return false;
        }

        let played = await tryPlay(ttsUrl);

        // Fallback to StreamElements TTS (English-only but very reliable with Lavalink)
        if (!played) {
            const fallbackUrl = `https://api.streamelements.com/kappa/v2/speech?voice=Brian&text=${encodeURIComponent(text.substring(0, 200))}`;
            played = await tryPlay(fallbackUrl);
        }

        if (!played) {
            log.debug(`VoiceGreet: All TTS providers failed for guild ${guildId}`);
        }
    } catch (e) {
        log.debug(`VoiceGreet handler error: ${e.message}`);
    }
});

client.on('messageCreate', async (message) => {
    // Handle Bot-Blocked Channels (auto-delete all bot messages including xNico)
    if (message.author.bot && message.guild) {
        try {
            const guildBlock = jsonStore.peekGuild('botblock', message.guild.id);
            if (guildBlock?.enabled !== false) {
                const blockedChannels = guildBlock?.channels || [];
                if (guildBlock && blockedChannels.includes(message.channel.id)) {
                    await safeDeleteMessage(message, 'botblock');
                    return;
                }
            }
        } catch (e) { }
        return; // All other bot messages — ignore
    }
    if (message.author.bot) return;

    // ═══════ Minecraft chat bridge ═══════
    // If this channel is linked to a Minecraft server, relay the message
    // in-game and stop further processing (the bridge channel is chat-only).
    try {
        const mcBridge = require('./utils/minecraftBridge');
        if (mcBridge.handleDiscordMessage(message)) return;
    } catch (e) { }

    // ═══════ Honeypot trap channels ═══════
    // Auto-punish non-staff who post in a configured trap channel (catches
    // compromised/spam accounts). Returns true if this was a trap channel.
    try {
        const trapManager = require('./utils/trapManager');
        if (await trapManager.handleMessage(message)) return;
    } catch (e) { }

    // ═══════ Bot Ignore Module (Dashboard Integration) ═══════
    if (message.guild) {
        try {
            const biCfg = jsonStore.peekGuild('botignore-config', message.guild.id);
            if (biCfg && biCfg.enabled) {
                const isCh = (biCfg.ignoredChannels || []).includes(message.channel.id);
                const isUser = (biCfg.ignoredUsers || []).includes(message.author.id);
                const isRole = message.member && (biCfg.ignoredRoles || []).some(r => message.member.roles.cache.has(r));

                // Allow admins/owner to bypass
                const isBypassed = message.member?.permissions.has(PermissionFlagsBits.Administrator) || message.author.id === process.env.OWNER_ID;

                if ((isCh || isUser || isRole) && !isBypassed) {
                    if (!biCfg.ignorePrefix) {
                        return; // Ignore entirely (automod, leveling, events, everything)
                    } else {
                        // Ignore prefix only
                        const guildPrefix = getGuildPrefix(message.guild.id);
                        if (message.content.startsWith(guildPrefix)) {
                            return; // Ignore the command
                        }
                    }
                }
            }
        } catch (e) { }
    }
    // Handle DMs — only allow commands that explicitly support DMs
    if (!message.guild) {
        const dmPrefix = process.env.PREFIX || '-';
        if (!message.content.startsWith(dmPrefix)) return;
        const dmArgs = message.content.slice(dmPrefix.length).trim().split(/\s+/);
        const dmCmdName = dmArgs.shift()?.toLowerCase();
        if (!dmCmdName) return;
        const dmCmd = client.commands.get(dmCmdName);
        if (!dmCmd || !dmCmd.dmAllowed || typeof dmCmd.executePrefix !== 'function') return;
        try {
            dmCmd._guildPrefix = dmPrefix;
            await dmCmd.executePrefix(message, dmArgs, lavalinkManager, client);
        } catch (e) {
            log.error('[DM Prefix]', e.message);
        }
        return;
    }

    // Save the ORIGINAL channel.send before any patches so fallbacks never include a message_reference.
    const _safeFallbackSend = message.channel.send.bind(message.channel);

    // Helper: strip discord.js reply-reference fields and fall back to a plain channel.send.
    const _sendWithoutRef = async (options) => {
        try {
            if (typeof options === 'string') return await _safeFallbackSend({ content: options });
            // Remove any fields that discord.js or callers might add that create a message_reference
            const { nonce: _n, tts: _t, reply: _r, messageReference: _mr, ...rest } = (options || {});
            return await _safeFallbackSend(rest);
        } catch (_) { /* suppress — nothing more we can do */ }
    };

    // Patch message.reply to gracefully handle deleted messages (MESSAGE_REFERENCE_UNKNOWN_MESSAGE).
    // If the original message was deleted before the bot replies, fall back to a plain channel.send.
    const _originalReply = message.reply.bind(message);
    message.reply = async function safeReply(options) {
        try {
            return await _originalReply(options);
        } catch (err) {
            // Discord error 10008 = Unknown Message; 50035 = Invalid Form Body with message_reference
            const isUnknownRef =
                err?.code === 10008 ||
                (err?.code === 50035 && err?.message?.includes('message_reference'));
            if (isUnknownRef) {
                return await _sendWithoutRef(options); // always return, never re-throw ref errors
            }
            throw err;
        }
    };

    // Debug: show listener count and process id to detect duplicate instances
    try {
        // console.log(`[DEBUG] messageCreate invoked. pid=${process.pid} listeners=${client.listenerCount('messageCreate')}`);
    } catch (e) { }

    // Auto-delete messages in music panel channels (keep channel clean)
    const panelChannelId = musicPanelChannelCache.get(message.guild.id);
    if (panelChannelId && message.channel.id === panelChannelId) {
        setTimeout(() => {
            safeDeleteMessage(message, 'music-panel');
        }, 3000); // Delete after 3 seconds so user can see their message briefly
    }

    // Suggestion channel — intercept plain messages and start confirmation flow
    try {
        const suggestionCmd = client.commands.get('suggestion');
        if (suggestionCmd?.handleMessage) {
            const handled = await suggestionCmd.handleMessage(message);
            if (handled) return; // Message consumed — stop further processing
        }
    } catch (sugErr) {
        log.error('Suggestion handleMessage error:', sugErr);
    }

    // Command Ignoring System
    try {
        const guildIgnored = jsonStore.peekGuild('ignored-channels', message.guild.id);
        if (guildIgnored) {
            const isIgnored = guildIgnored.channels?.includes(message.channel.id) ||
                (message.channel.parentId && guildIgnored.categories?.includes(message.channel.parentId));

            if (isIgnored) {
                // COMPLETELY STOP ALL BOT PROCESSING IN IGNORED CHANNELS
                return;
            }
        }
    } catch (e) { }

    const guildId = message.guild?.id;

    // ═══════ Screenshot Verification — submission channel handler ═══════
    // Three responsibilities in this block:
    //   1. Auto-detect screenshots posted in the submission channel and
    //      forward them to the review pipeline (manager.submitScreenshot).
    //   2. Keep the submission channel clean — delete any non-screenshot
    //      message from non-staff so the channel stays "screenshots only".
    //   3. Re-float the user panel to the bottom after each successful
    //      submission so members always see the panel + task picker.
    //
    // Best-effort throughout — never throws into messageCreate's pipeline.
    if (guildId) {
        try {
            const sshotCfg = jsonStore.peekGuild('screenshot-verify', guildId);

            // Support BOTH legacy `channelId` and the new `submissionChannelId`
            // so this block keeps working across the v1 → v2 schema migration.
            const submissionChId = sshotCfg?.submissionChannelId || sshotCfg?.channelId;

            if (sshotCfg?.enabled && submissionChId === message.channel.id) {
                const sshotCmd = client.commands.get('screenshot-verify');

                // Staff bypass — admins and reviewers can post freely
                const memberPerms = message.member?.permissions;
                const isStaff = !!memberPerms && (
                    memberPerms.has(PermissionFlagsBits.ManageGuild) ||
                    memberPerms.has(PermissionFlagsBits.ManageRoles) ||
                    memberPerms.has(PermissionFlagsBits.Administrator)
                );

                // Find the first attached image. Discord sets `contentType`
                // for most uploads but mobile clients occasionally drop it,
                // so we also accept by file extension.
                const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i;
                const imageAttachment = message.attachments.find(a =>
                    (a.contentType && a.contentType.startsWith('image/'))
                    || IMAGE_EXT.test(a.name || '')
                );

                if (imageAttachment) {
                    // ── Path A: a screenshot was posted ────────────────
                    if (sshotCmd?.submitScreenshot) {
                        imageAttachment.sourceMessageId = message.id;
                        imageAttachment.sourceChannelId = message.channel.id;

                        const note = (message.content || '').trim().slice(0, 500) || null;

                        // Pre-selected task (if user picked one via the panel)
                        const session = sshotCmd.getUserSession?.(guildId, message.author.id) || null;

                        const result = await sshotCmd.submitScreenshot({
                            client,
                            guild: message.guild,
                            user: message.author,
                            attachment: imageAttachment,
                            note,
                            taskId: session?.taskId || null
                        }).catch(err => {
                            log.error(`Screenshot Verify Auto-Submit: ${err.message}`, err);
                            return { ok: false, error: 'Internal error.' };
                        });

                        if (session && result?.ok) sshotCmd.clearUserSession?.(guildId, message.author.id);

                        // Acknowledgement (auto-deleted) — tells the user what happened
                        let ack;
                        if (!result?.ok) {
                            ack = `<:Cancel:1521227723916181644> <@${message.author.id}> ${result?.error || 'Could not submit your screenshot.'}`;
                        } else if (result.decision === 'auto-approved') {
                            ack = `<:Checkedbox:1521227734943269077> <@${message.author.id}> verified automatically · \`${result.submission.id}\``;
                        } else if (result.decision === 'auto-rejected') {
                            ack = `<:Cancel:1521227723916181644> <@${message.author.id}> ${result.ai?.reasoning || 'auto-rejected'} · \`${result.submission.id}\``;
                        } else {
                            ack = `<:Lightning:1521227915537285150> <@${message.author.id}> queued for staff review · \`${result.submission.id}\``;
                        }
                        message.channel.send({
                            content: ack,
                            allowedMentions: { users: [message.author.id] }
                        }).then(notice => setTimeout(() => notice.delete().catch(() => { }), 10_000)).catch(() => { });

                        // Auto-delete source message (keeps the channel clean)
                        if (result?.ok && (sshotCfg.autoDelete !== false)) {
                            safeDeleteMessage(message, 'screenshot-verify:autoDelete');
                        }

                        // Re-float the user panel so it's always at the bottom
                        if (sshotCmd?.refloatUserPanel) {
                            sshotCmd.refloatUserPanel(message.guild, message.channel).catch(() => { });
                        }
                        return; // consumed
                    }
                } else if (!isStaff) {
                    // ── Path B: non-staff member posted chatter / non-image ──
                    // Submission channel is "screenshots only". Delete the
                    // message and post a short tip that auto-deletes.
                    safeDeleteMessage(message, 'screenshot-verify:non-image');
                    message.channel.send({
                        content: `<:Infotriangle:1521227710381428926> <@${message.author.id}> this channel is for verification screenshots only. Post a screenshot or use \`/screenshot-verify submit\`.`,
                        allowedMentions: { users: [message.author.id] }
                    }).then(notice => setTimeout(() => notice.delete().catch(() => { }), 8000)).catch(() => { });
                    return; // consumed
                }
            }
        } catch (e) {
            log.error(`Screenshot Verify watcher: ${e.message}`, e);
        }
    }

    // ═══════ AI Chat — responds in configured channel (skip if message is a prefix command) ═══════
    try {
        const aiChatConfig = jsonStore.peekGuild('aichat', guildId);

        if (aiChatConfig?.enabled && aiChatConfig.channelId === message.channel.id) {
            // ── Premium re-validation ─────────────────────────────
            // `/aichat-setup` is premium-gated, but the persisted
            // config keeps producing AI replies forever otherwise.
            // If the server lost premium, silently stop responding.
            if (!premiumManager.isServerPremium(guildId)) {
                return;
            }

            // ── Allowed Roles validation ──────────────────────────────
            if (aiChatConfig.allowedRoles && aiChatConfig.allowedRoles.length > 0) {
                const hasRole = message.member && message.member.roles.cache.some(r => aiChatConfig.allowedRoles.includes(r.id));
                if (!hasRole) {
                    return; // Ignore if user doesn't have an allowed role
                }
            }

            // Only process AI chat if it's NOT a prefix command
            const aiChatPrefix = getGuildPrefix(guildId);
            const isAiChatPrefixCommand = message.content.startsWith(aiChatPrefix);

            if (!isAiChatPrefixCommand && message.content.trim().length > 0) {
                try {
                    if (aiChatConfig.typingIndicator !== false) {
                        await message.channel.sendTyping();
                    }

                    const response = await generateAIResponse(message.content, message.channel.id, {
                        model: aiChatConfig.model || 'llama-3.3-70b-versatile',
                        maxTokens: aiChatConfig.maxTokens || 1024,
                        systemPrompt: aiChatConfig.systemPrompt || '',
                        metadata: {
                            botName: message.client.user?.username || 'xNico',
                            guildName: message.guild?.name || 'this server',
                            prefix: aiChatPrefix,
                            ownerId: process.env.OWNER_ID,
                            supportServer: process.env.SUPPORT_SERVER || 'https://discord.gg/Zs35X7Umak',
                            websiteUrl: process.env.BOT_WEBSITE || 'https://thenico.vercel.app'
                        }
                    });

                    if (response) {
                        // Split long responses
                        const chunks = response.match(/[\s\S]{1,2000}/g) || [response];
                        for (const chunk of chunks) {
                            await message.reply({
                                content: chunk,
                                allowedMentions: { repliedUser: false }
                            });
                        }
                    }
                } catch (e) {
                    log.error(`AI chat error in ${guildId}: ${e.message}`);
                    await message.reply({ content: '<:Cancel:1521227723916181644> AI is temporarily unavailable. Please try again later.', allowedMentions: { repliedUser: false } }).catch(() => { });
                }
                return; // Don't process further if AI channel
            }
        }
    } catch (e) {
        log.error(`Error loading AI chat config: ${e.message}`);
    }

    // ═══════ AutoMod — runs FIRST before any other handler (like Discord's native AutoMod) ═══════
    const automodConfig = automodCache.get(guildId);
    let automodBlocked = false;

    // Scan when there's text content OR an attachment to inspect (the AI
    // image filter needs to see attachment-only messages too).
    const hasScannableAttachment = automodConfig?.aiImage?.enabled && message.attachments?.size > 0;
    if (automodConfig?.enabled && (message.content || hasScannableAttachment)) {
        const isIgnored = automodConfig.ignoredRoles?.some(roleId => message.member?.roles.cache.has(roleId)) ||
            automodConfig.ignoredChannels?.includes(message.channel.id) ||
            message.member?.permissions.has('Administrator') ||
            (automodConfig.bypassRoleId && message.member?.roles.cache.has(automodConfig.bypassRoleId));

        if (!isIgnored) {
            const content = message.content;
            const contentLower = content.toLowerCase();

            // Collect ALL violations (don't short-circuit — check every filter like Discord AutoMod)
            const violations = [];

            // ── Bad Words Filter ──
            if (automodConfig.badWords?.enabled && automodConfig.badWords.words?.length > 0) {
                // Normalized form folds leetspeak / diacritics / in-word
                // separators ("f.u.c.k", "fück", "ｆｕｃｋ" → "fuck") so
                // obfuscated bad words still match.
                let contentNorm = '';
                try { contentNorm = require('./utils/aiModeration').normalizeText(content); } catch { }
                for (const word of automodConfig.badWords.words) {
                    const wordLower = word.toLowerCase().trim();
                    if (!wordLower) continue;

                    // Use word-boundary matching: match whole words, or phrases if the word contains spaces
                    // Also match words embedded with leetspeak-style separators
                    try {
                        const escaped = wordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const regex = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:[^a-zA-Z0-9]|$)`, 'i');
                        const wordNorm = (() => { try { return require('./utils/aiModeration').normalizeText(wordLower); } catch { return ''; } })();
                        const normHit = wordNorm && contentNorm && (contentNorm.includes(wordNorm));
                        if (regex.test(contentLower) || contentLower === wordLower || normHit) {
                            violations.push({
                                filter: 'badWords',
                                action: automodConfig.badWords.action || 'delete',
                                reason: `Bad word detected: ||${wordLower}||`
                            });
                            break; // One bad word is enough
                        }
                    } catch (e) {
                        // Fallback for invalid regex: exact substring match for multi-word phrases
                        if (contentLower.includes(wordLower)) {
                            violations.push({
                                filter: 'badWords',
                                action: automodConfig.badWords.action || 'delete',
                                reason: `Bad word detected`
                            });
                            break;
                        }
                    }
                }
            }

            // ── Spam Filter ──
            if (automodConfig.spam?.enabled) {
                const userId = message.author.id;
                const key = `${guildId}-${userId}`;
                const now = Date.now();
                const timeWindow = automodConfig.spam.timeWindow || 5000;
                const messageLimit = automodConfig.spam.messageLimit || 5;

                if (!spamTracker.has(key)) {
                    spamTracker.set(key, []);
                }

                const userMessages = spamTracker.get(key);
                userMessages.push(now);

                // Clean old entries inline
                const recentMessages = userMessages.filter(time => now - time < timeWindow);
                spamTracker.set(key, recentMessages);

                if (recentMessages.length >= messageLimit) {
                    violations.push({
                        filter: 'spam',
                        action: automodConfig.spam.action || 'timeout',
                        reason: `Spam detected (${recentMessages.length} msgs in ${timeWindow / 1000}s)`
                    });
                }

                // Periodic spamTracker cleanup to prevent memory leaks
                if (spamTracker.size > 500) {
                    const cleanupNow = Date.now();
                    for (const [trackerKey, msgs] of spamTracker.entries()) {
                        const recent = msgs.filter(t => cleanupNow - t < 30000);
                        if (recent.length === 0) spamTracker.delete(trackerKey);
                        else spamTracker.set(trackerKey, recent);
                    }
                }
            }

            // ── Link Filter ──
            if (automodConfig.links?.enabled) {
                const urlRegex = /https?:\/\/[^\s<]+|www\.[^\s<]+|[a-zA-Z0-9][-a-zA-Z0-9]*\.(com|net|org|io|gg|tv|me|co|xyz|info|online|site|tech|dev|app|live|pro|cc|ru|cn|tk|ml|ga|cf|gq|pw|top|club|vip|ws|link|click|download|stream|fun|icu|buzz|monster|rest|hair|sbs|cfd)(?:[\/\?#][^\s]*)?/gi;
                const urls = content.match(urlRegex);

                if (urls && urls.length > 0) {
                    const whitelist = automodConfig.links.whitelist || [];
                    let hasBlockedLink = false;

                    if (whitelist.length === 0) {
                        // No whitelist = block all links
                        hasBlockedLink = true;
                    } else {
                        // Check each URL against whitelist
                        for (const url of urls) {
                            const urlLower = url.toLowerCase();
                            const isAllowed = whitelist.some(domain => {
                                const domainLower = domain.toLowerCase().trim();
                                // Match the domain anywhere in the URL
                                return urlLower.includes(domainLower);
                            });
                            if (!isAllowed) {
                                hasBlockedLink = true;
                                break;
                            }
                        }
                    }

                    if (hasBlockedLink) {
                        violations.push({
                            filter: 'links',
                            action: automodConfig.links.action || 'delete',
                            reason: 'Unauthorized link detected'
                        });
                    }
                }
            }

            // ── Discord Invite Filter ──
            if (automodConfig.invites?.enabled) {
                // Comprehensive invite regex: covers discord.gg, discord.com/invite, discordapp.com/invite, dsc.gg, invite.gg
                const inviteRegex = /(discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg|invite\.gg|discord\.me)\/[a-zA-Z0-9-]+/gi;
                if (inviteRegex.test(content)) {
                    violations.push({
                        filter: 'invites',
                        action: automodConfig.invites.action || 'delete',
                        reason: 'Discord invite link detected'
                    });
                }
            }

            // ── Mass Mention Filter ──
            if (automodConfig.massMention?.enabled) {
                const mentionLimit = automodConfig.massMention.limit || 5;
                // Count user mentions + role mentions + @everyone/@here
                const userMentions = message.mentions.users.size;
                const roleMentions = message.mentions.roles.size;
                const everyoneMention = message.mentions.everyone ? 1 : 0;
                const totalMentions = userMentions + roleMentions + everyoneMention;

                if (totalMentions >= mentionLimit) {
                    violations.push({
                        filter: 'massMention',
                        action: automodConfig.massMention.action || 'delete',
                        reason: `Mass mention detected (${totalMentions} mentions)`
                    });
                }
            }

            // ── Excessive Caps Filter ──
            if (automodConfig.caps?.enabled) {
                const minLength = automodConfig.caps.minLength || 10;
                const capsPercentage = automodConfig.caps.percentage || 70;
                // Only check letters (ignore numbers, spaces, symbols)
                const letters = content.replace(/[^a-zA-Z]/g, '');

                if (letters.length >= minLength) {
                    const upperCount = (content.match(/[A-Z]/g) || []).length;
                    const ratio = (upperCount / letters.length) * 100;

                    if (ratio >= capsPercentage) {
                        violations.push({
                            filter: 'caps',
                            action: automodConfig.caps.action || 'delete',
                            reason: `Excessive caps (${Math.round(ratio)}%)`
                        });
                    }
                }
            }

            // ── AI Text Scan (multilingual NSFW / slurs / hate / harassment) ──
            // Only call the API when the cheaper filters above haven't already
            // decided to remove the message, to save quota & latency.
            if (automodConfig.aiText?.enabled && content && content.trim().length >= 3) {
                try {
                    const aiMod = require('./utils/aiModeration');
                    if (aiMod.hasApiKey()) {
                        const result = await aiMod.analyzeText(content, { guildId });
                        if (result.flagged) {
                            const rank = { low: 1, medium: 2, high: 3 };
                            const minSev = automodConfig.aiText.minSeverity || 'medium';
                            if ((rank[result.severity] || 2) >= (rank[minSev] || 2)) {
                                const cats = result.categories?.length ? result.categories.join(', ') : 'inappropriate content';
                                violations.push({
                                    filter: 'aiText',
                                    action: automodConfig.aiText.action || 'delete',
                                    reason: `AI flagged ${cats} (${result.severity})${result.reason ? ': ' + result.reason : ''}`
                                });
                            }
                        }
                    }
                } catch (e) {
                    log.debug?.('[AutoMod] AI text scan error: ' + e.message);
                }
            }

            // ── AI Image Scan (NSFW / explicit / gore image detection) ──
            if (automodConfig.aiImage?.enabled && message.attachments?.size > 0) {
                try {
                    const aiMod = require('./utils/aiModeration');
                    if (aiMod.hasApiKey()) {
                        const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i;
                        const images = [...message.attachments.values()].filter(a =>
                            (a.contentType && a.contentType.startsWith('image/')) || IMAGE_EXT.test(a.name || '')
                        ).slice(0, 3); // cap per-message API calls
                        for (const img of images) {
                            const result = await aiMod.analyzeImage(img.url, { guildId });
                            if (result.flagged) {
                                violations.push({
                                    filter: 'aiImage',
                                    action: automodConfig.aiImage.action || 'delete',
                                    reason: `AI flagged ${result.category} image (${result.confidence}%)${result.reason ? ': ' + result.reason : ''}`
                                });
                                break; // one bad image is enough
                            }
                        }
                    }
                } catch (e) {
                    log.debug?.('[AutoMod] AI image scan error: ' + e.message);
                }
            }

            // ═══════ Process violations ═══════
            if (violations.length > 0) {
                // Use the most severe action from all violations
                const severityOrder = { 'warn': 0, 'delete': 1, 'timeout': 2, 'kick': 3, 'ban': 4 };
                violations.sort((a, b) => (severityOrder[b.action] || 0) - (severityOrder[a.action] || 0));
                const primary = violations[0];
                const action = primary.action;
                const allReasons = violations.map(v => v.reason).join(' | ');

                // Preserve message data before destructive actions
                const savedContent = content.substring(0, 1000);
                const savedAuthorTag = message.author.username;
                const savedAuthorId = message.author.id;
                const savedAuthor = message.author;
                const savedChannel = message.channel;
                const savedMember = message.member;
                const savedGuild = message.guild;

                try {
                    // Delete message for all destructive actions
                    if (action === 'delete' || action === 'timeout' || action === 'kick' || action === 'ban') {
                        await safeDeleteMessage(message, `automod:${action}:${violations.map(v => v.filter).join(',')}`);
                        automodBlocked = true; // Block further message processing
                    }

                    // Execute action
                    if (action === 'warn') {
                        const warnMsg = await savedChannel.send({
                            content: `<:Infotriangle:1521227710381428926> <@${savedAuthorId}>, your message was flagged by AutoMod. Reason: ${allReasons}`,
                        }).catch(() => null);
                        if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => { }), 8000);
                    } else if (action === 'delete') {
                        const delMsg = await savedChannel.send({
                            content: `<:Shield:1521227694677692467> <@${savedAuthorId}>, your message was removed by AutoMod. Reason: ${allReasons}`,
                        }).catch(() => null);
                        if (delMsg) setTimeout(() => delMsg.delete().catch(() => { }), 5000);
                    } else if (action === 'timeout' && savedMember) {
                        await savedMember.timeout(5 * 60 * 1000, allReasons).catch(e => log.error('AutoMod timeout: ' + e.message));
                        const timeoutMsg = await savedChannel.send({
                            content: `<:Shield:1521227694677692467> <@${savedAuthorId}> has been timed out for 5 minutes. Reason: ${allReasons}`,
                        }).catch(() => null);
                        if (timeoutMsg) setTimeout(() => timeoutMsg.delete().catch(() => { }), 10000);
                    } else if (action === 'kick' && savedMember) {
                        await savedMember.kick(allReasons).catch(e => log.error('AutoMod kick: ' + e.message));
                        await savedChannel.send(`<:Shield:1521227694677692467> **${savedAuthorTag}** has been kicked by AutoMod. Reason: ${allReasons}`).catch(() => { });
                    } else if (action === 'ban' && savedMember) {
                        await savedMember.ban({ reason: allReasons, deleteMessageSeconds: 60 }).catch(e => log.error('AutoMod ban: ' + e.message));
                        await savedChannel.send(`<:Shield:1521227694677692467> **${savedAuthorTag}** has been banned by AutoMod. Reason: ${allReasons}`).catch(() => { });
                    }

                    // ── Mirror to central automod logger so the dedicated
                    //    /logging set-automod channel receives a webhook-aware,
                    //    mention-suppressed copy.
                    try {
                        await logAutomodAction(savedGuild, {
                            user: { id: savedAuthorId, username: savedAuthorTag },
                            action,
                            reason: violations.map(v => `${v.filter}: ${v.reason}`).join(' · '),
                            rule: violations.map(v => v.filter).join(', '),
                            channelId: savedChannel.id,
                            content: savedContent,
                        });
                    } catch (_) { }

                    // ── Log to legacy automod-config logChannel ──
                    if (automodConfig.logChannel) {
                        const logCh = savedGuild.channels.cache.get(automodConfig.logChannel);
                        if (logCh) {
                            const violationList = violations.map(v => `• **${v.filter}** — ${v.reason}`).join('\n');
                            const logContainer = new ContainerBuilder()
                                .setAccentColor(action === 'ban' ? 0xFF0000 : action === 'kick' ? 0xFF6600 : action === 'timeout' ? 0xFFA500 : 0xFFCC00)
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder()
                                        .setContent(
                                            `# <:Shield:1521227694677692467> AutoMod Action\n\n` +
                                            `**User:** ${savedAuthorTag} (<@${savedAuthorId}>)\n` +
                                            `**Channel:** <#${savedChannel.id}>\n` +
                                            `**Action:** \`${action.toUpperCase()}\`\n\n` +
                                            `### Violations\n${violationList}\n\n` +
                                            `### Message Content\n\`\`\`\n${savedContent.substring(0, 500)}${savedContent.length > 500 ? '...' : ''}\n\`\`\`\n` +
                                            `-# <t:${Math.floor(Date.now() / 1000)}:R>`
                                        )
                                );
                            await logCh.send({
                                components: [logContainer],
                                allowedMentions: { parse: [] },
                                flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
                            }).catch(() => { });
                        }
                    }

                    // ── Optional external audit webhook (gated by env var) ──
                    // Only fires when MODERATION_AUDIT_WEBHOOK is explicitly configured;
                    // never embed a hardcoded URL again.
                    const moderationAuditWebhook = process.env.MODERATION_AUDIT_WEBHOOK;
                    if (moderationAuditWebhook) {
                        try {
                            const violationListWh = violations.map(v => `• **${v.filter}** — ${v.reason}`).join('\n');
                            const actionColors = { ban: 0xFF0000, kick: 0xFF6600, timeout: 0xFFA500, delete: 0xFFCC00, warn: 0xFFEE00 };
                            const automodWhEmbed = {
                                title: '🛡️  AutoMod Triggered',
                                color: actionColors[action] || 0xFFCC00,
                                thumbnail: { url: savedAuthor.displayAvatarURL?.({ dynamic: true, size: 256 }) || '' },
                                fields: [
                                    { name: '🏷️ Server', value: `\`${savedGuild.name}\` (\`${savedGuild.id}\`)`, inline: false },
                                    { name: '👤 User', value: `${savedAuthorTag} (<@${savedAuthorId}>)`, inline: true },
                                    { name: '📌 Channel', value: `<#${savedChannel.id}>`, inline: true },
                                    { name: '⚡ Action Taken', value: `\`${action.toUpperCase()}\``, inline: true },
                                    { name: '📋 Violations', value: violationListWh || 'N/A', inline: false },
                                    { name: '💬 Message Content', value: `\`\`\`\n${savedContent.substring(0, 300)}${savedContent.length > 300 ? '...' : ''}\n\`\`\``, inline: false },
                                ],
                                footer: { text: `Server Members: ${savedGuild.memberCount.toLocaleString()}` },
                                timestamp: new Date().toISOString()
                            };
                            fetch(moderationAuditWebhook, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ username: client.user.username, avatar_url: client.user.displayAvatarURL({ size: 256 }), embeds: [automodWhEmbed] })
                            }).catch(err => log.error(`AutoMod webhook failed: ${err.message}`));
                        } catch (_) { /* never let webhook failures break automod */ }
                    }
                } catch (error) {
                    log.error(`AutoMod action error (${action}): ${error.message}`);
                }

                // If message was deleted, stop all further processing
                if (automodBlocked) return;
            }
        }
    }

    // ═══════ Standalone Anti-Spam (antispam.json) — separate from AutoMod ═══════
    if (!automodBlocked) {
        try {
            const spamCfg = jsonStore.peekGuild('antispam', guildId);

            if (spamCfg?.enabled && !message.member?.permissions.has('Administrator')) {
                const isSpamWhitelisted = (spamCfg.whitelistedRoles || []).some(roleId => message.member?.roles.cache.has(roleId)) ||
                    (spamCfg.whitelistedChannels || []).includes(message.channel.id);

                if (!isSpamWhitelisted) {
                    const userId = message.author.id;
                    const now = Date.now();
                    const filters = spamCfg.filters || {};
                    let triggered = null;
                    let reason = '';

                    // --- Message Spam (rate-based) ---
                    if (!triggered && filters.messageSpam?.enabled) {
                        const key = `antispam-msg-${guildId}-${userId}`;
                        const timeWindow = filters.messageSpam.interval || 5000;
                        const limit = filters.messageSpam.maxMessages || 5;
                        if (!spamTracker.has(key)) spamTracker.set(key, []);
                        const arr = spamTracker.get(key);
                        arr.push(now);
                        const recent = arr.filter(t => now - t < timeWindow);
                        spamTracker.set(key, recent);
                        if (recent.length >= limit) { triggered = 'Message Spam'; reason = `${recent.length} messages in ${timeWindow / 1000}s`; spamTracker.delete(key); }
                    }

                    // --- Emoji Spam ---
                    if (!triggered && filters.emojiSpam?.enabled && message.content) {
                        const emojiRegex = /(\p{Emoji_Presentation}|\p{Extended_Pictographic}|<a?:\w+:\d+>)/gu;
                        const emojis = message.content.match(emojiRegex);
                        if (emojis && emojis.length > (filters.emojiSpam.maxEmojis || 10)) {
                            triggered = 'Emoji Spam'; reason = `${emojis.length} emojis (max: ${filters.emojiSpam.maxEmojis || 10})`;
                        }
                    }

                    // --- CAPS Spam ---
                    if (!triggered && filters.capsSpam?.enabled && message.content) {
                        const text = message.content.replace(/[^a-zA-Z]/g, '');
                        const minLen = filters.capsSpam.minLength || 10;
                        const maxPct = filters.capsSpam.maxPercent || 70;
                        if (text.length >= minLen) {
                            const upper = text.replace(/[^A-Z]/g, '').length;
                            const pct = (upper / text.length) * 100;
                            if (pct > maxPct) { triggered = 'CAPS Spam'; reason = `${Math.round(pct)}% uppercase (max: ${maxPct}%)`; }
                        }
                    }

                    // --- Link Spam ---
                    if (!triggered && filters.linkSpam?.enabled && message.content) {
                        const urlRegex = /https?:\/\/[^\s<]+/gi;
                        const links = message.content.match(urlRegex) || [];
                        const whitelist = (filters.linkSpam.whitelistedDomains || []).map(d => d.toLowerCase());
                        const nonWhitelisted = links.filter(url => {
                            try { const host = new URL(url).hostname.toLowerCase(); return !whitelist.some(d => host === d || host.endsWith('.' + d)); } catch { return true; }
                        });
                        if (nonWhitelisted.length > (filters.linkSpam.maxLinks || 3)) {
                            triggered = 'Link Spam'; reason = `${nonWhitelisted.length} links (max: ${filters.linkSpam.maxLinks || 3})`;
                        }
                    }

                    // --- Image Spam (rate-based) ---
                    if (!triggered && filters.imageSpam?.enabled) {
                        const imageCount = message.attachments.filter(a => a.contentType?.startsWith('image/')).size + (message.embeds?.filter(e => e.image || e.thumbnail).length || 0);
                        if (imageCount > 0) {
                            const key = `antispam-img-${guildId}-${userId}`;
                            const tw = filters.imageSpam.interval || 10000;
                            if (!spamTracker.has(key)) spamTracker.set(key, []);
                            const arr = spamTracker.get(key);
                            for (let i = 0; i < imageCount; i++) arr.push(now);
                            const recent = arr.filter(t => now - t < tw);
                            spamTracker.set(key, recent);
                            if (recent.length > (filters.imageSpam.maxImages || 3)) { triggered = 'Image Spam'; reason = `${recent.length} images in ${tw / 1000}s`; spamTracker.delete(key); }
                        }
                    }

                    // --- Sticker Spam (rate-based) ---
                    if (!triggered && filters.stickerSpam?.enabled && message.stickers?.size > 0) {
                        const key = `antispam-stk-${guildId}-${userId}`;
                        const tw = filters.stickerSpam.interval || 10000;
                        if (!spamTracker.has(key)) spamTracker.set(key, []);
                        const arr = spamTracker.get(key);
                        for (let i = 0; i < message.stickers.size; i++) arr.push(now);
                        const recent = arr.filter(t => now - t < tw);
                        spamTracker.set(key, recent);
                        if (recent.length > (filters.stickerSpam.maxStickers || 3)) { triggered = 'Sticker Spam'; reason = `${recent.length} stickers in ${tw / 1000}s`; spamTracker.delete(key); }
                    }

                    // --- Mention Spam ---
                    if (!triggered && filters.mentionSpam?.enabled) {
                        const mentionCount = (message.mentions.users?.size || 0) + (message.mentions.roles?.size || 0);
                        if (mentionCount > (filters.mentionSpam.maxMentions || 5)) {
                            triggered = 'Mention Spam'; reason = `${mentionCount} mentions (max: ${filters.mentionSpam.maxMentions || 5})`;
                        }
                    }

                    // --- Duplicate Spam (rate-based) ---
                    if (!triggered && filters.duplicateSpam?.enabled && message.content) {
                        const key = `antispam-dup-${guildId}-${userId}`;
                        const tw = filters.duplicateSpam.interval || 30000;
                        if (!spamTracker.has(key)) spamTracker.set(key, []);
                        const arr = spamTracker.get(key);
                        arr.push({ time: now, content: message.content.toLowerCase().trim() });
                        const recent = arr.filter(e => now - e.time < tw);
                        spamTracker.set(key, recent);
                        const dupes = recent.filter(e => e.content === message.content.toLowerCase().trim()).length;
                        if (dupes > (filters.duplicateSpam.maxDuplicates || 3)) { triggered = 'Duplicate Spam'; reason = `${dupes} identical messages in ${tw / 1000}s`; spamTracker.delete(key); }
                    }

                    // --- Invite Spam ---
                    if (!triggered && filters.inviteSpam?.enabled && message.content) {
                        const inviteRegex = /(discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\//i;
                        if (inviteRegex.test(message.content)) {
                            triggered = 'Invite Spam'; reason = 'Discord invite link detected';
                        }
                    }

                    // --- Newline Spam ---
                    if (!triggered && filters.newlineSpam?.enabled && message.content) {
                        const newlines = (message.content.match(/\n/g) || []).length;
                        if (newlines > (filters.newlineSpam.maxNewlines || 15)) {
                            triggered = 'Newline Spam'; reason = `${newlines} newlines (max: ${filters.newlineSpam.maxNewlines || 15})`;
                        }
                    }

                    // --- Execute punishment if any filter triggered ---
                    if (triggered) {
                        const action = (spamCfg.action || 'timeout').toLowerCase();
                        const fullReason = `Anti-Spam [${triggered}]: ${reason}`;
                        await safeDeleteMessage(message, `antispam:${triggered}`);

                        // Track whether we successfully applied the
                        // configured action so the log can show
                        // pass/fail rather than always claiming the
                        // action was applied.
                        let acted = false;
                        let failureReason = null;

                        try {
                            if (action === 'timeout' && message.member) {
                                if (!message.member.moderatable) {
                                    failureReason = 'bot lacks Timeout permission or member outranks bot';
                                } else {
                                    const duration = spamCfg.timeoutDuration || 60000;
                                    await message.member.timeout(duration, fullReason);
                                    acted = true;
                                    const msg = await message.channel.send(`<:Shield:1521227694677692467> <@${userId}> has been timed out for **${Math.round(duration / 1000)}s** — ${triggered.toLowerCase()} detected.`).catch(() => null);
                                    if (msg) setTimeout(() => msg.delete().catch(() => { }), 8000);
                                }
                            } else if (action === 'kick' && message.member) {
                                if (!message.member.kickable) {
                                    failureReason = 'bot cannot kick this member';
                                } else {
                                    await message.member.kick(fullReason);
                                    acted = true;
                                    await message.channel.send(`<:Shield:1521227694677692467> **${message.author.username}** has been kicked — ${triggered.toLowerCase()} detected.`).catch(() => { });
                                }
                            } else if (action === 'ban' && message.member) {
                                if (!message.member.bannable) {
                                    failureReason = 'bot cannot ban this member';
                                } else {
                                    await message.member.ban({ reason: fullReason, deleteMessageSeconds: 60 });
                                    acted = true;
                                    await message.channel.send(`<:Shield:1521227694677692467> **${message.author.username}** has been banned — ${triggered.toLowerCase()} detected.`).catch(() => { });
                                }
                            } else if (action === 'warn') {
                                // Warn is "delete + public reminder" —
                                // never modifies member state, so
                                // it's always considered successful.
                                const msg = await message.channel.send(`<:Infotriangle:1521227710381428926> <@${userId}>, stop! ${triggered} detected: ${reason}`).catch(() => null);
                                if (msg) setTimeout(() => msg.delete().catch(() => { }), 8000);
                                acted = true;
                            } else if (action === 'delete') {
                                // Pure delete — message was already
                                // removed above by safeDeleteMessage.
                                acted = true;
                            } else {
                                failureReason = `unknown action "${action}"`;
                                log.error(`[AntiSpam] Unknown action "${action}" for guild ${guildId}`);
                            }
                        } catch (err) {
                            failureReason = err.message || 'API error';
                            log.error(`AntiSpam ${action} failed: ${err.message}`);
                        }

                        if (spamCfg.logChannel) {
                            const logCh = message.guild.channels.cache.get(spamCfg.logChannel);
                            if (logCh) {
                                const statusLine = acted
                                    ? `<:Checkedbox:1521227734943269077> **Status:** Action applied (\`${action.toUpperCase()}\`)`
                                    : `<:Cancel:1521227723916181644> **Status:** Action **failed** — ${failureReason || 'unknown'}`;
                                const logContainer = new ContainerBuilder()
                                    .setAccentColor(acted
                                        ? (action === 'ban' ? 0xFF0000 : action === 'kick' ? 0xFF6600 : 0xFFA500)
                                        : 0xFEE75C)
                                    .addTextDisplayComponents(
                                        new TextDisplayBuilder().setContent(
                                            `# <:Shield:1521227694677692467> Anti-Spam Detection\n\n` +
                                            `**User:** ${message.author.username} (<@${userId}>)\n` +
                                            `**Channel:** <#${message.channel.id}>\n` +
                                            `**Action:** \`${action.toUpperCase()}\`\n` +
                                            `**Filter:** ${triggered}\n` +
                                            `**Reason:** ${reason}\n` +
                                            `${statusLine}\n` +
                                            `-# <t:${Math.floor(Date.now() / 1000)}:R>`
                                        )
                                    );
                                await logCh.send({ components: [logContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
                            }
                        }
                        return;
                    }
                }
            }
        } catch (e) {
            // Silently ignore antispam errors
        }
    }

    // Counting Game Handler
    try {
        const { db } = require('./utils/database');
        const countingData = await db.get(`counting_${guildId}`);

        if (countingData && message.channel.id === countingData.channelId) {
            const content = message.content.trim();
            const num = parseInt(content);

            if (!isNaN(num) && content === num.toString()) {
                const expectedNum = countingData.currentCount + 1;
                const previousUserId = countingData.lastUserId;
                const sameUser = message.author.id === previousUserId;

                if (num === expectedNum && !sameUser) {
                    countingData.currentCount = num;
                    countingData.lastUserId = message.author.id;
                    countingData.lastMessageId = message.id; // Track message ID for delete detection
                    countingData.totalCounts++;
                    if (num > countingData.highScore) countingData.highScore = num;
                    await db.set(`counting_${guildId}`, countingData);
                    await message.react('<:Checkedbox:1521227734943269077>');
                } else {
                    let failReason = '';
                    if (sameUser) {
                        failReason = 'You can\'t count twice in a row!';
                    } else if (num !== expectedNum) {
                        failReason = `Wrong number! Expected **${expectedNum}**`;
                    }

                    countingData.fails++;
                    const oldCount = countingData.currentCount;
                    countingData.currentCount = 0;
                    countingData.lastUserId = null;
                    countingData.lastMessageId = null;
                    await db.set(`counting_${guildId}`, countingData);

                    await message.react('<:Cancel:1521227723916181644>');
                    const container = new ContainerBuilder()
                        .setAccentColor(0xED4245)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <:Cancel:1521227723916181644> Count Reset!\n\n` +
                                `${failReason}\n\n` +
                                `**Previous count:** ${oldCount}\n` +
                                `**High score:** ${countingData.highScore}\n\n` +
                                `Start again from **1**!`
                            )
                        );
                    await message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
            }
        }
    } catch (e) { }

    // Bot mention response — minimal professional panel
    if (message.content === `<@${client.user.id}>` || message.content === `<@!${client.user.id}>`) {
        const uniqueCommands = new Set(client.commands?.values() || []);
        const totalCommands = uniqueCommands.size;

        const uptimeSec = Math.floor(client.uptime / 1000);
        const days = Math.floor(uptimeSec / 86400);
        const hours = Math.floor((uptimeSec % 86400) / 3600);
        const mins = Math.floor((uptimeSec % 3600) / 60);
        const uptimeStr = days > 0 ? `${days}d ${hours}h ${mins}m` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
        const apiPing = Math.round(client.ws.ping);
        const gPrefix = getGuildPrefix(guildId);
        const accentColor = botCustomize.getEmbedColor(guildId) || 0x5865F2;

        const container = new ContainerBuilder()
            .setAccentColor(accentColor)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `## <:xnico:1521228240440660180> ${client.user.username}\n` +
                `> All-in-one Discord toolkit — Music, Moderation, Economy, Levels & more.\n\n` +
                `<:Edit:1521227886634205298> **Prefix** \`${gPrefix}\` <:Caretright:1521227704953864202> **Slash** \`/\` <:Caretright:1521227704953864202> **Commands** \`${totalCommands}\`\n` +
                `<:Heartbeat:1521228203665129664> **Ping** \`${apiPing}ms\` <:Caretright:1521227704953864202> **Uptime** \`${uptimeStr}\`\n\n` +
                `-# Try \`${gPrefix}help\` or \`/help\` for the full command catalog.`
            ))
            .addActionRowComponents(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('show_help_menu')
                        .setLabel('Commands')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('<:Bookopen:1521227911137595605>'),
                    new ButtonBuilder()
                        .setLabel('Invite')
                        .setStyle(ButtonStyle.Link)
                        .setURL(`https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`)
                        .setEmoji('<:Add:1521227828199293152>'),
                    new ButtonBuilder()
                        .setLabel('Support')
                        .setStyle(ButtonStyle.Link)
                        .setURL(process.env.SUPPORT_SERVER || 'https://discord.gg/Zs35X7Umak')
                        .setEmoji('<:Envelope:1521228013910626426>'),
                    new ButtonBuilder()
                        .setLabel('Vote')
                        .setStyle(ButtonStyle.Link)
                        .setURL(`https://top.gg/bot/${client.user.id}/vote`)
                        .setEmoji('<:topgg:1521228219066482790>'),
                )
            );

        return message.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
            allowedMentions: { users: [], roles: [], repliedUser: false },
        }).catch(() => { });
    }

    if (guildId) {
        // Track message count for guild members (skip blacklisted channels)
        try {
            const { db: _msgDb } = require('./utils/database');
            const _blList = (await _msgDb.get(`msg_blacklist_${guildId}`)) || [];
            if (!_blList.includes(message.channel.id)) {
                // Use $inc which auto-creates member if needed via incrementGuildMemberField
                await models.GuildMember.findOneAndUpdate(
                    { guildId, userId: message.author.id },
                    {
                        $inc: {
                            'leveling.messageCount': 1,
                            'analytics.totalMessages': 1
                        }
                    }
                );
            }
        } catch (error) {
            // Ignore message counting errors
        }

        // Daily / per-channel activity tracking for /userstats (Statbot-style)
        try {
            require('./utils/activityTracker').recordMessage(guildId, message.author.id, message.channel.id);
        } catch { /* non-fatal */ }

        // Automated anime character drops (Mudae-style)
        try {
            require('./utils/animeDrops').onMessage(message);
        } catch { /* non-fatal */ }

        // Handle sticky messages (with cooldown to prevent rate limits)
        {
            const guildStickyConfig = jsonStore.peekGuild('sticky', guildId);

            if (guildStickyConfig?.enabled && guildStickyConfig.messages?.[message.channel.id]) {
                const stickyData = guildStickyConfig.messages[message.channel.id];

                // Cooldown: only re-send if at least 3 seconds have passed since last re-send
                if (!global.stickyCooldowns) global.stickyCooldowns = new Map();
                const cooldownKey = `${guildId}_${message.channel.id}`;
                const lastSent = global.stickyCooldowns.get(cooldownKey) || 0;
                const now = Date.now();

                if (now - lastSent < 3000) {
                    // Skip — too soon, avoid rate limits
                } else {
                    global.stickyCooldowns.set(cooldownKey, now);

                    // Delete old sticky message if it exists
                    if (stickyData.messageId) {
                        try {
                            const oldMsg = await message.channel.messages.fetch(stickyData.messageId).catch(() => null);
                            if (oldMsg) await oldMsg.delete().catch(() => { });
                        } catch (error) {
                            // Sticky delete error
                        }
                    }

                    // Send new sticky message based on display type
                    try {
                        let newSticky;
                        const displayType = stickyData.displayType || 'container';
                        const { replacePlaceholders } = require('./utils/interactionHandlers');

                        if (displayType === 'embed') {
                            const processedTitle = replacePlaceholders(stickyData.embedTitle || 'Sticky Message', message.author, message.guild, message.channel);
                            const processedContent = replacePlaceholders(stickyData.content, message.author, message.guild, message.channel);
                            const processedFooter = replacePlaceholders(stickyData.embedFooter || '', message.author, message.guild, message.channel);
                            const processedAuthor = replacePlaceholders(stickyData.embedAuthor || '', message.author, message.guild, message.channel);

                            const embed = new EmbedBuilder()
                                .setTitle(processedTitle)
                                .setDescription(processedContent)
                                .setColor(parseInt(stickyData.embedColor, 16) || 0x5865F2);

                            if (stickyData.embedFooter) embed.setFooter({ text: processedFooter });
                            if (stickyData.embedAuthor) embed.setAuthor({ name: processedAuthor });
                            if (stickyData.embedThumbnail) embed.setThumbnail(stickyData.embedThumbnail);
                            if (stickyData.embedImage) embed.setImage(stickyData.embedImage);

                            newSticky = await message.channel.send({ embeds: [embed] });
                        } else if (displayType === 'container') {
                            const processedContent = replacePlaceholders(stickyData.content, message.author, message.guild, message.channel);
                            const container = new ContainerBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder()
                                        .setContent(processedContent)
                                );

                            newSticky = await message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
                        } else if (displayType === 'content') {
                            const processedContent = replacePlaceholders(stickyData.content, message.author, message.guild, message.channel);
                            newSticky = await message.channel.send({ content: processedContent });
                        }

                        if (newSticky) {
                            // Update the sticky data with new message ID and ensure channel ID is saved.
                            // We pulled `guildStickyConfig` via peekGuild (no clone) so to write
                            // back we need a fresh `stickyConfig` snapshot.
                            const stickyConfig = jsonStore.read('sticky');
                            if (!stickyConfig[guildId]) stickyConfig[guildId] = { enabled: true, messages: {} };
                            if (!stickyConfig[guildId].messages) stickyConfig[guildId].messages = {};
                            if (!stickyConfig[guildId].messages[message.channel.id]) {
                                stickyConfig[guildId].messages[message.channel.id] = {};
                            }
                            stickyConfig[guildId].messages[message.channel.id].messageId = newSticky.id;
                            stickyConfig[guildId].messages[message.channel.id].channelId = message.channel.id;
                            jsonStore.write('sticky', stickyConfig);
                        }
                    } catch (error) {
                        log.error('Sticky send error', error);
                    }
                } // end cooldown else
            }
        }

        // Handle Media-Only Channels
        {
            try {
                const mediaOnlyCfg = jsonStore.peekGuild('media-only', guildId);
                const mediaOnlyChannels = mediaOnlyCfg?.channels || [];

                if (mediaOnlyChannels.includes(message.channel.id)) {
                    // Check if user is moderator/admin (exempt from rule)
                    const isModerator = message.member.permissions.has('ManageMessages') ||
                        message.member.permissions.has('Administrator');

                    // Check if message has any attachments (images, videos, files, etc.)
                    const hasAttachments = message.attachments.size > 0;

                    if (!hasAttachments && !isModerator) {
                        try {
                            await safeDeleteMessage(message, 'media-only');
                            const warningMsg = await message.channel.send(
                                `**${message.author.username}**, this is a media-only channel. Please only post messages with images, videos, or files.`
                            );

                            // Auto-delete warning after 5 seconds
                            setTimeout(() => {
                                warningMsg.delete().catch(() => { });
                            }, 5000);
                        } catch (error) {
                            // Ignore if bot doesn't have permissions
                        }
                        return; // Stop processing this message
                    }
                }
            } catch (error) {
                // Ignore media-only errors
            }
        }

        // Handle Simple Sticky Messages
        {
            const simpleStickyGuild = jsonStore.peekGuild('simple-sticky', guildId);
            const channelSticky = simpleStickyGuild?.[message.channel.id];

            if (channelSticky) {
                // Delete old sticky message
                if (channelSticky.messageId) {
                    try {
                        const oldMsg = await message.channel.messages.fetch(channelSticky.messageId).catch(() => null);
                        if (oldMsg) await oldMsg.delete().catch(() => { });
                    } catch (error) {
                        // Ignore deletion errors
                    }
                }

                // Send new sticky message
                try {
                    // Resolve placeholders in the stored content so {user},
                    // {channel}, {servername} and friends actually expand
                    // in simple-sticky messages — the rich sticky path
                    // already does this; this branch was missing it.
                    const { replacePlaceholders: simpleStickyReplace } = require('./utils/actionMessageBuilder');
                    const resolvedSticky = simpleStickyReplace(channelSticky.content, message.author, message.guild, message.channel);
                    const newSticky = await message.channel.send(resolvedSticky);
                    // Re-read full store only when we actually need to write back.
                    const simpleStickyConfig = jsonStore.read('simple-sticky');
                    if (!simpleStickyConfig[guildId]) simpleStickyConfig[guildId] = {};
                    if (!simpleStickyConfig[guildId][message.channel.id]) simpleStickyConfig[guildId][message.channel.id] = {};
                    simpleStickyConfig[guildId][message.channel.id].messageId = newSticky.id;
                    jsonStore.write('simple-sticky', simpleStickyConfig);
                } catch (error) {
                    // Ignore send errors
                }
            }
        }

        // Handle AFK System
        {
            const afkPeek = jsonStore.peek('afk');
            const userId = message.author.id;
            // Read the full store once — needed by both the "remove AFK"
            // branch and the "mentioned user is AFK" branch below.
            let afkConfig = null;

            // Check if user is AFK and remove them
            if (afkPeek && afkPeek[userId]) {
                afkConfig = jsonStore.read('afk');
                const afkData = afkConfig[userId];
                const afkDuration = Date.now() - afkData.timestamp;
                const hours = Math.floor(afkDuration / 3600000);
                const minutes = Math.floor((afkDuration % 3600000) / 60000);
                const seconds = Math.floor((afkDuration % 60000) / 1000);

                let durationText = '';
                if (hours > 0) durationText += `${hours}h `;
                if (minutes > 0) durationText += `${minutes}m `;
                durationText += `${seconds}s`;

                // Load stats to update total time
                let afkStats = {};
                if (jsonStore.has('afk-stats')) {
                    afkStats = jsonStore.read('afk-stats');
                }
                if (!afkStats[userId]) {
                    afkStats[userId] = { count: 0, totalTime: 0 };
                }
                afkStats[userId].totalTime += afkDuration;
                // count is incremented at AFK ENTRY in commands/utility/afk.js
                // (one count per session). Do NOT bump it again here or
                // each session counts as two.
                jsonStore.write('afk-stats', afkStats);

                delete afkConfig[userId];
                jsonStore.write('afk', afkConfig);

                // Format total time
                const totalMs = afkStats[userId].totalTime;
                const totalHours = Math.floor(totalMs / 3600000);
                const totalMinutes = Math.floor((totalMs % 3600000) / 60000);
                const totalSeconds = Math.floor((totalMs % 60000) / 1000);

                let totalTimeText = '';
                if (totalHours > 0) totalTimeText += `${totalHours}h `;
                if (totalMinutes > 0) totalTimeText += `${totalMinutes}m `;
                totalTimeText += `${totalSeconds}s`;

                let welcomeBackText = `# <:Checkedbox:1521227734943269077> Welcome Back!\n\nYour AFK status has been removed.\n\n<:Timer:1521227971590095070> **You were AFK for:** ${durationText}\n<:Bookopen:1521227911137595605>**Total AFK Times:** ${afkStats[userId].count}\n<:Lightning:1521227915537285150> **Total AFK Duration:** ${totalTimeText}`;

                if (afkData.mentions && afkData.mentions.length > 0) {
                    const uniqueMentions = [...new Set(afkData.mentions)];
                    const mentionList = uniqueMentions.slice(0, 10).map(id => `<@${id}>`).join(', ');
                    welcomeBackText += `\n\n<:Hashtag:1521227771957870604> **You were mentioned by:**\n${uniqueMentions.length > 10 ? `${mentionList} and ${uniqueMentions.length - 10} more` : mentionList}`;
                }

                const welcomeBackContainer = new ContainerBuilder()
                    .setAccentColor(0x57F287)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(welcomeBackText)
                    );

                await message.reply({ components: [welcomeBackContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => { });

                try {
                    if (message.member && message.member.manageable && message.member.nickname?.startsWith('[AFK] ')) {
                        const restoredNick = afkData.previousNickname;
                        await message.member.setNickname(restoredNick).catch(() => { });
                    }
                } catch (error) {
                    // AFK nick remove error
                }
            }

            // Check if any mentioned users are AFK
            if (message.mentions.users.size > 0) {
                if (!afkConfig) afkConfig = jsonStore.read('afk');
                if (!afkConfig || typeof afkConfig !== 'object') afkConfig = {};
                const mentionedAfkUsers = [];

                for (const [mentionedUserId, user] of message.mentions.users) {
                    if (mentionedUserId === userId) continue;

                    if (afkConfig[mentionedUserId]) {
                        const afkData = afkConfig[mentionedUserId];
                        const afkDuration = Date.now() - afkData.timestamp;
                        const hours = Math.floor(afkDuration / 3600000);
                        const minutes = Math.floor((afkDuration % 3600000) / 60000);

                        let durationText = '';
                        if (hours > 0) durationText = `${hours}h ${minutes}m ago`;
                        else if (minutes > 0) durationText = `${minutes}m ago`;
                        else durationText = 'Just now';

                        mentionedAfkUsers.push({
                            user: user,
                            message: afkData.message,
                            duration: durationText,
                            timestamp: afkData.timestamp,
                        });

                        if (!afkData.mentions) afkData.mentions = [];
                        if (!afkData.mentions.includes(userId)) {
                            afkData.mentions.push(userId);
                            jsonStore.write('afk', afkConfig);
                        }

                        // Send DM notification if enabled
                        if (afkData.dmNotifications) {
                            try {
                                const dmContainer = new ContainerBuilder()
                                    .addTextDisplayComponents(
                                        new TextDisplayBuilder()
                                            .setContent(`# 📬 AFK Mention Notification\n\n**${message.author.username}** mentioned you in **${message.guild.name}**\n\n<:Pin:1521227932625014916> **Channel:** <#${message.channel.id}>\n<:Hashtag:1521227771957870604> **Message:** ${message.content.substring(0, 100)}${message.content.length > 100 ? '...' : ''}\n\n<:Attach:1521228039135170722> [Jump to Message](${message.url})`)
                                    );
                                await user.send({ components: [dmContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
                            } catch (error) {
                                // AFK DM error
                            }
                        }
                    }
                }

                if (mentionedAfkUsers.length > 0) {
                    // Render an accented, professional mention-reply
                    // panel with timestamps. Multiple mentioned AFK
                    // users are shown as separate quote-blocks so the
                    // layout stays readable.
                    const afkLines = mentionedAfkUsers.map(data => {
                        const sinceTs = Math.floor((data.timestamp || Date.now()) / 1000);
                        return [
                            `### 💤 ${data.user.username}`,
                            `> ${data.message}`,
                            `-# <:Timer:1521227971590095070> AFK since <t:${sinceTs}:R>  ·  <:Sandwatch:1521228272426418367> away for **${data.duration}**`,
                        ].join('\n');
                    }).join('\n\n');

                    const afkContainer = new ContainerBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <:Inforect:1521228008285929532> Mentioned User${mentionedAfkUsers.length > 1 ? 's' : ''} Are AFK\n` +
                                `-# They will see your message when they return.`
                            )
                        )
                        .addSeparatorComponents(
                            new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
                        )
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(afkLines)
                        );

                    await message.reply({ components: [afkContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
                }
            }

            const autoresponderConfig = autoresponderCache.get(guildId);
            if (autoresponderConfig?.enabled && autoresponderConfig.responses) {
                const content = message.content.toLowerCase();
                for (const item of autoresponderConfig.responses) {
                    if (content.includes(item.trigger)) {
                        try {
                            // Resolve placeholders so admins can use {user},
                            // {username}, {servername}, {membercount}, etc.
                            // in their stored response. Without this the
                            // raw `{user}` / `{server}` template tokens
                            // were posted verbatim.
                            const { replacePlaceholders: arReplace } = require('./utils/actionMessageBuilder');
                            const resolvedResponse = arReplace(item.response, message.author, message.guild, message.channel);
                            const container = new ContainerBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder()
                                        .setContent(resolvedResponse)
                                );
                            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                        } catch (error) {
                            log.error('Autoresponder error', error);
                        }
                        break;
                    }
                }
            }

            const autoreactConfig = autoreactCache.get(guildId);
            if (autoreactConfig?.enabled && autoreactConfig.reactions) {
                const content = message.content.toLowerCase();
                for (const item of autoreactConfig.reactions) {
                    if (content.includes(item.trigger)) {
                        for (const emoji of item.emojis) {
                            try {
                                await message.react(emoji).catch(() => { });
                            } catch (error) {
                                // Skip invalid emoji, continue with remaining
                            }
                        }
                        break;
                    }
                }
            }

            // Handle Antilink Protection
            {
                const antilinkGuild = jsonStore.peekGuild('antilink', guildId);
                if (antilinkGuild) {
                    const isAdmin = message.member?.permissions.has('Administrator');
                    if (!isAdmin) {
                        const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|([a-zA-Z0-9-]+\.(com|net|org|io|gg|tv|me|co|xyz|info|online|site|tech)[^\s]*)/gi;
                        if (urlRegex.test(message.content)) {
                            try {
                                await safeDeleteMessage(message, 'antilink');
                                const warnMsg = await message.channel.send(`<:Cancel:1521227723916181644> **${message.author.username}**, links are not allowed in this server!`).catch(() => null);
                                if (warnMsg) {
                                    setTimeout(() => warnMsg.delete().catch(() => { }), 5000);
                                }
                                return;
                            } catch (error) {
                                log.error('Antilink delete error', error);
                            }
                        }
                    }
                }
            }

            // Handle Leveling/XP System

            if (!message.author.bot && !message.content.startsWith(getGuildPrefix(guildId))) {
                // Check if leveling is disabled for this guild
                const toggleGuild = jsonStore.peekGuild('levelingtoggle', guildId) || null;

                // Process leveling only when explicitly enabled for this guild
                const isLevelingEnabled = toggleGuild?.enabled === true;

                if (isLevelingEnabled) {
                    // Check if channel is disabled
                    const isChannelDisabled = toggleGuild?.disabledChannels?.includes(message.channel.id);

                    if (!isChannelDisabled) {
                        const guildConfig = await getGuildConfigDb(guildId);
                        const levelingConfig = guildConfig?.leveling || {};

                        // Check if channel or user's roles are in the ignore list
                        const ignoreChannels = levelingConfig.ignoreChannels || [];
                        const ignoreRoles = levelingConfig.ignoreRoles || [];
                        const isChannelIgnored = ignoreChannels.includes(message.channel.id);
                        const isRoleIgnored = ignoreRoles.length > 0 && message.member.roles.cache.some(r => ignoreRoles.includes(r.id));

                        if (!isChannelIgnored && !isRoleIgnored) {
                            const xpSettings = levelingConfig.xpSettings || { minXp: 15, maxXp: 25, cooldown: 60 };

                            let leveling = {};
                            if (jsonStore.has('leveling')) {
                                leveling = jsonStore.read('leveling');
                            }

                            if (!leveling[guildId]) {
                                leveling[guildId] = {};
                            }

                            if (!leveling[guildId][message.author.id]) {
                                leveling[guildId][message.author.id] = { xp: 0, level: 0, lastXpGain: 0, messages: 0 };
                            }

                            const userData = leveling[guildId][message.author.id];
                            // Track total messages regardless of XP cooldown
                            userData.messages = (userData.messages || 0) + 1;
                            // Track messages sent *today* (UTC). Resets automatically
                            // when the calendar date rolls over, so `daily.count` is
                            // always "messages today" — surfaced by the Daily Messages
                            // leaderboard / stats category.
                            const todayKey = new Date().toISOString().slice(0, 10);
                            if (!userData.daily || userData.daily.date !== todayKey) {
                                userData.daily = { date: todayKey, count: 0 };
                            }
                            userData.daily.count += 1;
                            const now = Date.now();
                            const xpCooldown = (xpSettings.cooldown || 60) * 1000;

                            if (now - userData.lastXpGain >= xpCooldown) {
                                const minXp = xpSettings.minXp || 15;
                                const maxXp = xpSettings.maxXp || 25;
                                let multiplier = levelingConfig.multiplier || 1;

                                // Check per-role multipliers from levelmultiplier store
                                try {
                                    const guildMultipliers = jsonStore.peekGuild('levelmultiplier', guildId) || {};
                                    for (const [roleId, mult] of Object.entries(guildMultipliers)) {
                                        if (message.member.roles.cache.has(roleId) && mult > multiplier) {
                                            multiplier = mult;
                                        }
                                    }
                                } catch { }

                                const xpGain = Math.floor((Math.floor(Math.random() * (maxXp - minXp + 1)) + minXp) * multiplier);
                                userData.xp += xpGain;
                                userData.lastXpGain = now;

                                const oldLevel = Math.floor(0.1 * Math.sqrt(userData.xp - xpGain));
                                const newLevel = Math.floor(0.1 * Math.sqrt(userData.xp));

                                if (newLevel > oldLevel || userData.forceRoleSync) {
                                    userData.level = newLevel;
                                    userData.forceRoleSync = false;

                                    // Handle roles - check database first, then fall back to levelroles store
                                    let rolesConfig = levelingConfig.roles;
                                    if ((!rolesConfig || !Array.isArray(rolesConfig) || rolesConfig.length === 0)) {
                                        try {
                                            const fileRoles = jsonStore.peekGuild('levelroles', guildId);
                                            if (Array.isArray(fileRoles) && fileRoles.length > 0) {
                                                rolesConfig = fileRoles;
                                            }
                                        } catch { }
                                    }
                                    if (rolesConfig && Array.isArray(rolesConfig) && rolesConfig.length > 0) {
                                        const rolesToAdd = rolesConfig
                                            .filter(r => newLevel >= r.level)
                                            .map(r => r.roleId);

                                        if (rolesToAdd.length > 0) {
                                            try {
                                                if (levelingConfig.stackRoles) {
                                                    await message.member.roles.add(rolesToAdd).catch(() => { });
                                                } else {
                                                    const highestRole = rolesConfig
                                                        .filter(r => newLevel >= r.level)
                                                        .sort((a, b) => b.level - a.level)[0];

                                                    const rolesToRemove = rolesConfig
                                                        .filter(r => r.roleId !== highestRole.roleId)
                                                        .map(r => r.roleId);

                                                    await message.member.roles.remove(rolesToRemove).catch(() => { });
                                                    await message.member.roles.add(highestRole.roleId).catch(() => { });
                                                }
                                            } catch (e) { }
                                        }
                                    }

                                    // Handle announcement - check announcements config, announcementChannel, and levelchannel.json fallback
                                    const announceConfig = levelingConfig.announcements || {};
                                    if (announceConfig.enabled !== false) {
                                        let announceChannel = message.channel;

                                        if (announceConfig.channel === 'custom' && announceConfig.customChannelId) {
                                            announceChannel = message.guild.channels.cache.get(announceConfig.customChannelId) || message.channel;
                                        } else if (announceConfig.channel === 'dm') {
                                            announceChannel = message.author;
                                        } else if (levelingConfig.announcementChannel) {
                                            // Fallback: check announcementChannel set via leveling-setup panel
                                            const panelChannel = message.guild.channels.cache.get(levelingConfig.announcementChannel);
                                            if (panelChannel) announceChannel = panelChannel;
                                        } else {
                                            // Fallback: check levelchannel store
                                            try {
                                                const lcGuild = jsonStore.peekGuild('levelchannel', guildId);
                                                if (lcGuild) {
                                                    const fallbackChannel = message.guild.channels.cache.get(lcGuild);
                                                    if (fallbackChannel) announceChannel = fallbackChannel;
                                                }
                                            } catch { }
                                        }

                                        // Generate professional canvas level-up card
                                        try {
                                            const { generateLevelUpCard } = require('./utils/levelUpCard');
                                            const { AttachmentBuilder } = require('discord.js');

                                            const sorted = Object.entries(leveling[guildId] || {})
                                                .map(([uid, d]) => ({ uid, xp: d.xp }))
                                                .sort((a, b) => b.xp - a.xp);
                                            const userRank = sorted.findIndex(u => u.uid === message.author.id) + 1;

                                            let levelUpFontFamily = 'Poppins';
                                            let levelUpBackground = null;
                                            try {
                                                const { getUserData: _getUD } = require('./utils/dataManager');
                                                const _ud = await _getUD(message.author.id);
                                                levelUpFontFamily = _ud?.profile?.rankCard?.fontFamily || _ud?.profile?.profileCard?.fontFamily || 'Poppins';
                                                // Level-up card is only customizable via background image —
                                                // reuse the user's rank card background (or profile card).
                                                levelUpBackground = _ud?.profile?.rankCard?.customBackground
                                                    || _ud?.profile?.profileCard?.customBackground
                                                    || _ud?.profile?.customBackground
                                                    || null;
                                            } catch { }
                                            // Custom level-up message + placement (set via /leveling-setup).
                                            // {user} resolves to a mention outside the card, or the
                                            // display name when rendered on the card.
                                            const lvlMode = announceConfig.messageMode === 'inside' ? 'inside' : 'outside';
                                            const lvlTpl = (announceConfig.message && announceConfig.message.trim()) ? announceConfig.message : null;
                                            const fillLvlTpl = (uVal) => lvlTpl
                                                ? lvlTpl
                                                    .replace(/{user}/g, uVal)
                                                    .replace(/{level}/g, String(newLevel))
                                                    .replace(/{oldlevel}/g, String(oldLevel))
                                                    .replace(/{xp}/g, userData.xp.toLocaleString())
                                                    .replace(/{rank}/g, String(userRank))
                                                    .replace(/{xpgain}/g, String(xpGain))
                                                    .replace(/{server}/g, message.guild.name)
                                                : null;

                                            const insideLine = (lvlMode === 'inside' && lvlTpl)
                                                ? fillLvlTpl(message.author.globalName || message.author.username)
                                                : null;

                                            const cardBuffer = await generateLevelUpCard(message.author, {
                                                oldLevel: oldLevel,
                                                newLevel: newLevel,
                                                totalXp: userData.xp,
                                                rank: userRank,
                                                xpGain: xpGain,
                                                fontFamily: levelUpFontFamily,
                                                backgroundImage: levelUpBackground,
                                                style: announceConfig.cardStyle || 'default',
                                                customLine: insideLine
                                            });

                                            // Message text shown above the card (outside placement).
                                            let announceContent = `${message.author}`;
                                            if (lvlMode === 'outside' && lvlTpl) {
                                                const filled = fillLvlTpl(message.author.toString());
                                                if (filled) announceContent = filled;
                                            }

                                            const attachment = new AttachmentBuilder(cardBuffer, { name: 'level-up.png' });
                                            await announceChannel.send({
                                                content: announceContent,
                                                files: [attachment],
                                                allowedMentions: { users: [message.author.id] }
                                            }).catch(() => { });
                                        } catch (cardErr) {
                                            // Fallback to text if card generation fails
                                            const msgTemplate = announceConfig.message || '# <:Money:1521228266957045900> Level Up!\n\n{user} reached **Level {level}**!\n\n**Total XP:** {xp}';
                                            const finalMsg = msgTemplate
                                                .replace(/{user}/g, message.author.toString())
                                                .replace(/{level}/g, newLevel.toString())
                                                .replace(/{xp}/g, userData.xp.toLocaleString());

                                            const levelUpContainer = new ContainerBuilder()
                                                .addTextDisplayComponents(
                                                    new TextDisplayBuilder()
                                                        .setContent(finalMsg)
                                                );

                                            await announceChannel.send({ components: [levelUpContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
                                        }
                                    }
                                }

                                jsonStore.write('leveling', leveling);
                            } else {
                                // Save message count even when XP is on cooldown
                                jsonStore.write('leveling', leveling);
                            }
                        } // end ignoreChannels/ignoreRoles check
                    }
                }
            }
        }

        // Handle Music Panel Song Requests
        {
            const guildPanel = jsonStore.peekGuild('musicpanel', guildId);

            // Check if this channel is the music panel
            if (guildPanel && message.channel.id === guildPanel.channelId) {
                // Block all bot messages except from this bot (music panel bot)
                if (message.author.bot && message.author.id !== client.user.id) {
                    try {
                        await message.delete();
                        log.info(`[auto-delete:music-panel:other-bot] removed bot=${message.author.tag} guild=${message.guild.id} channel=#${message.channel.name || message.channel.id}`);
                    } catch (err) {
                        log.error('Failed to delete bot message in music panel: ' + err.message);
                    }
                    return; // Don't process bot messages further
                }

                // Always delete user messages in music panel channel with retry
                const deleteUserMessage = async (delayMs = 300) => {
                    setTimeout(async () => {
                        let retries = 3;
                        while (retries > 0) {
                            try {
                                // Check if message still exists and is deletable
                                if (!message.deletable) {
                                    return; // Message not deletable, exit early
                                }

                                await message.delete();
                                if (process.env.DEBUG_AUTO_DELETE === 'verbose') {
                                    log.info(`[auto-delete:music-panel] ok user=${message.author.tag} guild=${message.guild.id} channel=#${message.channel.name || message.channel.id}`);
                                }
                                return; // Success
                            } catch (err) {
                                retries--;
                                if (retries === 0) {
                                    log.warning(`[auto-delete:music-panel] FAILED user=${message.author.tag} guild=${message.guild.id} channel=#${message.channel.name || message.channel.id} — ${err?.code || ''} ${err.message}`);
                                } else {
                                    // Wait before retry
                                    await new Promise(resolve => setTimeout(resolve, 200));
                                }
                            }
                        }
                    }, delayMs);
                };

                const query = message.content.trim();

                // Delete empty messages or commands (block all bot commands in music panel)
                if (!query || message.content.startsWith(getGuildPrefix(guildId))) {
                    await deleteUserMessage(100);
                    return;
                }

                // Delete message after short delay (Hydra-style)
                await deleteUserMessage(300);

                // Check if user is in a voice channel
                if (!message.member.voice.channel) {
                    return; // Silently ignore if not in voice
                }

                try {
                    let player = lavalinkManager.getPlayer(message.guild.id);

                    // If player exists, check if user is in the same voice channel as bot
                    if (player && player.voiceChannelId) {
                        if (message.member.voice.channel.id !== player.voiceChannelId) {
                            // User is not in the same VC as bot - silently ignore
                            return;
                        }
                    }

                    // Create player if it doesn't exist
                    if (!player) {
                        player = await lavalinkManager.createPlayer({
                            guildId: message.guild.id,
                            voiceChannelId: message.member.voice.channel.id,
                            textChannelId: message.channel.id,
                            selfDeaf: true,
                            selfMute: false,
                            volume: 100
                        });

                        await player.connect();
                    }

                    // Detect if query is a URL or needs search prefix
                    let searchQuery = query;
                    const isUrl = /^https?:\/\//.test(query);
                    const isSpotify = query.includes('spotify.com');
                    const isYouTube = query.includes('youtube.com') || query.includes('youtu.be');
                    const isSoundCloud = query.includes('soundcloud.com');

                    // If it's not a URL, add search prefix
                    if (!isUrl) {
                        searchQuery = `ytsearch:${query}`;
                    }

                    // Add timeout handling for search with longer timeout for playlists
                    const doSearch = (q) => Promise.race([
                        player.search({ query: q }, message.author),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Search timeout')), 20000))
                    ]);

                    let res = await doSearch(searchQuery).catch(err => {
                        log.error('Music Panel search error: ' + err.message);
                        throw err;
                    });

                    // Fallback to SoundCloud if YouTube search returned no results
                    if (!isUrl && (res.loadType === 'empty' || res.loadType === 'error' || !res.tracks || res.tracks.length === 0)) {
                        res = await doSearch(`scsearch:${query}`).catch(err => {
                            log.error('Music Panel SoundCloud fallback error: ' + err.message);
                            throw err;
                        });
                    }

                    if (res.loadType === 'error') {
                        log.error('Lavalink load error: ' + (res.exception?.message || 'Unknown'));
                        return; // Silently fail for errors
                    }

                    if (res.loadType === 'empty' || !res.tracks || res.tracks.length === 0) {
                        return; // Silently fail for no results
                    }

                    // Handle playlists
                    if (res.loadType === 'playlist') {
                        for (const track of res.tracks) {
                            track.requester = message.author;
                            await player.queue.add(track);
                        }
                    } else {
                        // Handle single track or search results
                        const track = res.tracks[0];
                        track.requester = message.author;
                        await player.queue.add(track);
                    }

                    if (!player.playing && !player.paused) {
                        await player.play();
                    }

                    // Update panel after adding song
                    await updateMusicPanel(client, player, autoplayStatus).catch(err => log.error(`Panel update: ${err.message}`, err));
                } catch (error) {
                    log.error('Music Panel request error', error);
                    // Silently fail - don't send error messages in music panel
                }
                return;
            }
        }
    }

    // No-prefix resolution — premium/owner validated inside the noprefix module
    const noPrefixCommand = client.commands.get('noprefix');
    let noPrefixEnabled = false;
    const PREFIX = getGuildPrefix(guildId);
    let hasPrefix = message.content.startsWith(PREFIX);
    const isPremiumUser = premiumManager.hasPremiumAccess(message.author.id, message.guild?.id);
    const isOwnerUser = isOwner(message.author.id);

    if (noPrefixCommand) {
        noPrefixEnabled = noPrefixCommand.isGlobalNoPrefixEnabled(message.author.id)
            || (message.guild && noPrefixCommand.isNoPrefixEnabled(message.guild.id, message.author.id))
            || noPrefixCommand.hasVoteNoPrefix(message.author.id);
    }

    // Check if user is bot banned
    {
        const botBans = jsonStore.peek('botbans');
        if (botBans && botBans[message.author.id]) {
            const banData = botBans[message.author.id];
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Commentblock:1521227898101432331> You are banned from using this bot!\n\n**Reason:** ${banData.reason}\n**Banned:** <t:${Math.floor(banData.timestamp / 1000)}:R>`)
                );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
        }
    }

    // Check if channel is ignored for commands
    const ignoreChannelsCmd = client.commands.get('ignore-channels');
    if (ignoreChannelsCmd && message.guild) {
        const ignoreConfig = ignoreChannelsCmd.getGuildConfig(message.guild.id);
        const categoryId = message.channel.parentId || null;

        if (ignoreChannelsCmd.isChannelIgnored(message.guild.id, message.channel.id, categoryId)) {
            if (!ignoreChannelsCmd.canBypass(message.member, ignoreConfig)) {
                if (ignoreConfig.notifyUser) {
                    const container = new ContainerBuilder()
                        .setAccentColor(0xED4245)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder()
                                .setContent(`# <:Commentblock:1521227898101432331> Commands Disabled\n\nBot commands are disabled in this channel.`)
                        );
                    message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).then(msg => {
                        setTimeout(() => msg.delete().catch(() => { }), 5000);
                    }).catch(() => { });
                }
                return;
            }
        }
    }

    // Process commands if prefix is used or no-prefix mode is enabled
    if (hasPrefix || noPrefixEnabled) {
        const args = hasPrefix
            ? message.content.slice(PREFIX.length).trim().split(/ +/)
            : message.content.trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        // console.log(`Prefix command received: ${commandName} by ${message.author.username}`);

        // Check for custom commands first (premium-only at runtime).
        // `customcmd` / `delcustomcmd` are premium-gated for creation,
        // but using a previously-created custom command is dispatched
        // here BEFORE the regular `premiumOnly` check on built-in
        // commands. Re-validate server premium so a guild that lost
        // premium can no longer trigger their custom commands.
        if (guildId && premiumManager.isServerPremium(guildId)) {
            const customCmdsGuild = jsonStore.peekGuild('customcmds', guildId);
            if (customCmdsGuild && customCmdsGuild[commandName]) {
                const response = customCmdsGuild[commandName];
                // Resolve placeholders so admins can write responses
                // like "-greet" → "Hi {user}, welcome to {servername}!"
                // and have the tokens expand at reply time. Without this
                // the raw template string was being sent verbatim.
                const { replacePlaceholders: ccReplace } = require('./utils/actionMessageBuilder');
                const resolvedResponse = typeof response === 'string'
                    ? ccReplace(response, message.author, message.guild, message.channel)
                    : response;
                return message.reply(resolvedResponse).catch(() => { });
            }
        }

        const command = client.commands.get(commandName) ||
            client.commands.get(commandName === 'np' ? 'nowplaying' : commandName);

        if (!command) {
            return;
        }

        if (!command.executePrefix) {
            return;
        }

        if (command.premiumOnly && !premiumManager.hasPremiumAccess(message.author.id, message.guild?.id)) {
            try {
                const { buildPremiumGate } = require('./utils/responseBuilder');
                const prefixHint = `${getGuildPrefix(message.guild?.id)}${commandName}`;
                return message.reply({
                    components: [buildPremiumGate(prefixHint)],
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => { });
            } catch {
                return message.reply('<:Cancel:1521227723916181644> This feature requires **Premium**. Use `redeemkey` to activate or ask an admin to activate server premium.').catch(() => { });
            }
        }

        // ── Vote Lock Check ──
        {
            const voteLock = require('./utils/voteLock');
            if (voteLock.isVoteLocked(commandName) && !premiumManager.hasPremiumAccess(message.author.id, message.guild?.id) && !voteLock.hasActiveVote(message.author.id)) {
                return message.reply({
                    components: [voteLock.buildVoteGate(commandName)],
                    flags: MessageFlags.IsComponentsV2,
                }).catch(() => { });
            }
        }

        // ── Bot Permission Pre-Check ──
        if (message.guild) {
            const permCheck = checkBotPermissions(message.guild, message.channel, commandName);
            if (!permCheck.allowed) {
                await notifyMissingPermissions(message.author, message.channel, commandName, permCheck.missing, message.guild);
                return;
            }
        }

        let botCustomConfig = botCustomize.getConfig(guildId);

        // Delete command message if enabled
        if (botCustomConfig.deleteCommands && message.deletable) {
            safeDeleteMessage(message, 'bot-customize:deleteCommands');
            // Message will be deleted — replace reply with channel.send to avoid MESSAGE_REFERENCE_UNKNOWN_MESSAGE
            message.reply = _sendWithoutRef;
        }

        // ── Command Cooldown Check (Premium users bypass) ──
        const cooldownSec = botCustomConfig.commandCooldown || 0;
        if (cooldownSec > 0 && !premiumManager.hasPremiumAccess(message.author.id, guildId)) {
            const cdKey = `${guildId}_${message.author.id}_${commandName}`;
            const now = Date.now();
            if (!client._cmdCooldowns) client._cmdCooldowns = new Map();
            const lastUsed = client._cmdCooldowns.get(cdKey) || 0;
            if (now - lastUsed < cooldownSec * 1000) {
                const remaining = ((cooldownSec * 1000 - (now - lastUsed)) / 1000).toFixed(1);
                const cdContainer = new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(`<:Timer:1521227971590095070> Please wait **${remaining}s** before using \`${commandName}\` again.`)
                    );
                return message.reply({ components: [cdContainer], flags: MessageFlags.IsComponentsV2 }).then(m => {
                    setTimeout(() => m.delete().catch(() => { }), 3000);
                }).catch(() => { });
            }
            client._cmdCooldowns.set(cdKey, now);
            // Auto-cleanup old entries every 1000 commands
            if (client._cmdCooldowns.size > 5000) {
                const threshold = now - 120000;
                for (const [k, v] of client._cmdCooldowns) {
                    if (v < threshold) client._cmdCooldowns.delete(k);
                }
            }
        }

        // ── Apply Guild Customization to Prefix Responses ──
        if (message.guild) {
            const _gColor = botCustomize.getEmbedColor(guildId);
            const _gFoot = botCustomConfig.footerText;
            const _gFootIcon = botCustomConfig.footerIcon;

            // Attach for commands that want direct access
            message._guildPrefix = PREFIX;
            message._guildAccentColor = _gColor;
            message._guildFooterText = _gFoot;
            message._guildFooterIcon = _gFootIcon;

            const _patchMsgOpts = (opts) => {
                if (typeof opts === 'string') opts = { content: opts };
                if (!opts) opts = {};
                // Accent color + footer on Components V2 containers.
                // Always injects a footer line — either the guild's
                // custom text or the default BRANDING.
                if (opts.components && Array.isArray(opts.components)) {
                    const _footerLine = _gFoot || '<:xnico:1486755083390550036> [xNico </>](https://discord.gg/Zs35X7Umak) Development';
                    _injectCv2Footer(opts.components, _gColor, _footerLine);
                }
                // Embed color + footer
                if (opts.embeds && Array.isArray(opts.embeds)) {
                    for (const e of opts.embeds) {
                        const d = e?.data ?? e;
                        if (d && d.color === undefined && _gColor != null) d.color = _gColor;
                        if (d && !d.footer && _gFoot) {
                            d.footer = { text: _gFoot };
                            if (_gFootIcon) d.footer.icon_url = _gFootIcon;
                        }
                    }
                }
                return _remapPayloadEmojis(opts);
            };

            const _origMsgReply = message.reply.bind(message);
            message.reply = (o) => _origMsgReply(_patchMsgOpts(o));
            const _origChannelSend = message.channel.send.bind(message.channel);
            message.channel.send = (o) => _origChannelSend(_patchMsgOpts(o));
        }

        try {
            // ═══════ ToS Acceptance Check ═══════
            const tosManager = require('./utils/tosManager');
            if (!tosManager.hasAcceptedTos(message.author.id)) {
                const container = tosManager.buildTosPanel(message.author);

                return message.reply({
                    components: [container],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            trackCommand(commandName, message.author.id, message.guild?.id);

            // ═══════ Owner "temporarily disabled" gate ═══════
            const _disabledRec = require('./utils/disabledCommands').isDisabled(command.data?.name || command.prefix || commandName);
            if (_disabledRec && !isOwnerUser) {
                return message.reply({
                    components: [require('./utils/disabledCommands').buildNotice((command.data?.name || command.prefix || commandName), _disabledRec)],
                    flags: MessageFlags.IsComponentsV2
                });
            }

            await command.executePrefix(message, args, lavalinkManager, client);
        } catch (error) {
            // ── Handle permission errors specifically ──
            if (isPermissionError(error)) {
                const perms = inferPermissionsFromCommand(commandName, command.category);
                await notifyMissingPermissions(message.author, message.channel, commandName, perms, message.guild);
                return;
            }

            log.error(`Prefix command (${commandName}): ${error.message}`, error);

            // Log error to designated channel
            await logError(client, error, {
                type: 'Prefix Command Error',
                command: `${PREFIX}${commandName}`,
                user: message.author,
                guild: message.guild,
                channel: message.channel,
                additionalInfo: `Args: ${args.join(' ')}`
            });

            const errorId = generateErrorId();
            const { container, row } = buildErrorContainer('Command Error', `There was an error executing **${commandName}**!\n\n\`\`\`\n${error.message}\n\`\`\``, errorId);
            message.reply({ components: [container, row], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
        }
    }
});

// ═══════ Anti-Nuke Core Engine ═══════

function isAntiNukeExempt(guild, config, executorId) {
    // Always exempt the bot itself
    const botId = guild.members.me?.id || client.user?.id;
    if (executorId === botId) return true;
    // Always exempt the guild owner
    if (executorId === guild.ownerId) return true;
    // Check whitelisted users
    if (config.whitelistedUsers?.includes(executorId)) return true;
    // Check bypass role
    if (config.bypassRoleId) {
        const member = guild.members.cache.get(executorId);
        if (member?.roles.cache.has(config.bypassRoleId)) return true;
    }
    return false;
}

async function executeAntiNukePunishment(guild, member, actionType, action, executor) {
    const botMember = guild.members.me;
    if (!botMember) return false;

    // Server owners are untouchable (Discord won't let us kick/ban them
    // anyway). Skip early so the call doesn't waste an API request and
    // log a misleading "Cannot punish" line.
    if (member.id === guild.ownerId) {
        log.warning(`Anti-Nuke: Skipping ${member.user?.username || member.id} — guild owner`);
        return false;
    }

    // Hierarchy check — cannot punish members with equal or higher roles
    if (member.roles?.highest?.position >= botMember.roles.highest.position) {
        log.warning(`Anti-Nuke: Cannot punish ${executor.username || executor.id} — role hierarchy too high`);
        return false;
    }

    const reason = `Anti-Nuke: Exceeded ${action} limit`;

    try {
        if (actionType === 'remove_roles') {
            const rolesToRemove = member.roles.cache.filter(role =>
                role.id !== guild.id &&
                !role.managed &&
                role.position < botMember.roles.highest.position
            );
            if (rolesToRemove.size === 0) {
                // Nothing to strip — report failure instead of pretending
                // we acted, otherwise the log channel shows "Stripped
                // roles" with zero actually removed.
                log.warning(`Anti-Nuke: ${executor.username || executor.id} has no removable roles`);
                return false;
            }
            await member.roles.remove(rolesToRemove, reason);
            log.warning(`Anti-Nuke: Removed ${rolesToRemove.size} role(s) from ${executor.username || executor.id} for ${action}`);
        } else if (actionType === 'kick') {
            if (!member.kickable) {
                log.warning(`Anti-Nuke: Cannot kick ${executor.username || executor.id}`);
                return false;
            }
            await member.kick(reason);
            log.warning(`Anti-Nuke: Kicked ${executor.username || executor.id} for ${action}`);
        } else if (actionType === 'ban') {
            if (!member.bannable) {
                log.warning(`Anti-Nuke: Cannot ban ${executor.username || executor.id}`);
                return false;
            }
            await member.ban({ reason, deleteMessageSeconds: 0 });
            log.warning(`Anti-Nuke: Banned ${executor.username || executor.id} for ${action}`);
        } else if (actionType === 'timeout') {
            if (!member.moderatable) {
                log.warning(`Anti-Nuke: Cannot timeout ${executor.username || executor.id}`);
                return false;
            }
            // 1 hour default timeout
            await member.timeout(3600000, reason);
            log.warning(`Anti-Nuke: Timed out ${executor.username || executor.id} for ${action}`);
        } else {
            // Unknown action — log loud rather than silently no-op
            log.error(`Anti-Nuke: Unknown actionType "${actionType}" for ${action}`);
            return false;
        }
        return true;
    } catch (err) {
        // Wrapping each branch's API call inside this catch ensures a
        // single permission/rate-limit error doesn't bubble out and
        // crash the caller's flow. The outer try{} in checkAntiNuke also
        // catches, but doing it here keeps the success bookkeeping
        // (`success = false`) accurate.
        log.error(`Anti-Nuke ${actionType} failed for ${executor.username || executor.id}: ${err.message}`);
        return false;
    }
}

const ANTINUKE_ACTION_LABELS = {
    banProtection: { label: 'Ban Protection', emoji: '<:banhammer:1521227777083314529>' },
    kickProtection: { label: 'Kick Protection', emoji: '<:Userblock:1521227822641975366>' },
    channelDelete: { label: 'Channel Delete', emoji: '<:Trash:1521227750420254820>' },
    channelCreate: { label: 'Channel Create', emoji: '<:Add:1521227828199293152>' },
    roleDelete: { label: 'Role Delete', emoji: '<:Trash:1521227750420254820>' },
    roleCreate: { label: 'Role Create', emoji: '<:Add:1521227828199293152>' },
    webhookCreate: { label: 'Webhook Protection', emoji: '<:Bookmark:1521227835526742066>' },
    botAdd: { label: 'Bot Add Protection', emoji: '<:bots:1521227848101396610>' }
};

const ANTINUKE_PUNISH_LABELS = {
    remove_roles: 'Strip Roles',
    kick: 'Kick',
    ban: 'Ban',
    timeout: 'Timeout',
    kick_bot: 'Kick Bot',
    kick_both: 'Kick Bot & User',
    ban_bot: 'Ban Bot'
};

const ANTINUKE_PUNISH_COLORS = { ban: 0xFF0000, kick: 0xFF6600, remove_roles: 0xFFA500, timeout: 0xFFCC00, kick_bot: 0xFF6600, kick_both: 0xFF0000, ban_bot: 0xFF0000 };

function sendAntiNukeLog(guild, config, executor, action, limit, timeWindow, recentCount, actionType, target) {
    // Always route through the central logger so the dedicated 'security'
    // log channel (configured via /logging set-security) receives a properly
    // formatted, webhook-aware message with mentions suppressed.
    try {
        logAntinukeTrigger(guild, {
            executor,
            action,
            punishment: actionType,
            limit,
            timeWindow,
            violations: recentCount,
            target,
        }).catch(() => { });
    } catch (_) { }

    // Backward compat: also send to the legacy `config.logChannel` set in
    // /antinuke if it's configured. Allows guilds who haven't migrated to
    // the per-category logging-setup channels yet to keep working.
    if (!config.logChannel) return;
    const logChannel = guild.channels.cache.get(config.logChannel);
    if (!logChannel) return;

    const meta = ANTINUKE_ACTION_LABELS[action] || { label: action, emoji: '<:Shield:1521227694677692467>' };
    const punishLabel = ANTINUKE_PUNISH_LABELS[actionType] || actionType;
    const accentColor = ANTINUKE_PUNISH_COLORS[actionType] || 0xED4245;
    const nowTs = Math.floor(Date.now() / 1000);

    const container = new ContainerBuilder()
        .setAccentColor(accentColor)
        .addTextDisplayComponents(
            new TextDisplayBuilder()
                .setContent(
                    `# ${meta.emoji} Anti-Nuke Triggered\n\n` +
                    `${meta.emoji} **Protection:** ${meta.label}\n` +
                    `<:User:1521227714227343380> **Offender:** <@${executor.id}> (\`${executor.id}\`)\n` +
                    `<:Lightningalt:1521227851796447472> **Violations:** \`${recentCount}\` / \`${limit}\` in \`${timeWindow / 1000}s\`\n` +
                    `<:Shield:1521227694677692467> **Punishment:** \`${punishLabel}\`\n` +
                    (target ? `<:Bookmark:1521227835526742066> **Target:** \`${target}\`\n` : '') +
                    `<:Timer:1521227971590095070> **Time:** <t:${nowTs}:f> (<t:${nowTs}:R>)\n\n` +
                    `-# xNico Anti-Nuke Engine`
                )
        );

    logChannel.send({
        components: [container],
        allowedMentions: { parse: [] },
        flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
    }).catch(() => { });
}

/**
 * Instant quarantine — strip a nuker's removable roles right away so they
 * can't do further damage while the configured punishment is applied.
 */
async function instantQuarantineMember(guild, member) {
    const me = guild.members.me;
    if (!me || !member) return false;
    if (member.roles.highest.position >= me.roles.highest.position) return false;
    const removable = member.roles.cache.filter(r =>
        r.id !== guild.id && !r.managed && r.position < me.roles.highest.position
    );
    if (removable.size === 0) return false;
    await member.roles.remove(removable, 'Anti-Nuke: instant quarantine').catch(() => { });
    log.warning(`Anti-Nuke: instant-quarantined ${member.user?.username || member.id} (stripped ${removable.size} role[s])`);
    return true;
}

/**
 * Auto-restore a channel or role that a nuker just deleted. Best-effort —
 * recreates with the cached properties from the delete event. Only called
 * when antinuke autoRestore is on and the deleter is non-exempt.
 */
async function antiNukeRestore(guild, kind, resource) {
    const me = guild.members.me;
    if (!me || !resource) return;
    try {
        if (kind === 'channel') {
            if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) return;
            const opts = {
                name: resource.name,
                type: resource.type,
                reason: 'Anti-Nuke: auto-restore deleted channel',
            };
            if (resource.parentId) opts.parent = resource.parentId;
            if (typeof resource.position === 'number') opts.position = resource.position;
            if (resource.topic) opts.topic = resource.topic;
            if (typeof resource.nsfw === 'boolean') opts.nsfw = resource.nsfw;
            if (resource.rateLimitPerUser) opts.rateLimitPerUser = resource.rateLimitPerUser;
            if (resource.bitrate) opts.bitrate = resource.bitrate;
            if (resource.userLimit) opts.userLimit = resource.userLimit;
            try { if (resource.permissionOverwrites?.cache) opts.permissionOverwrites = [...resource.permissionOverwrites.cache.values()].map(o => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny })); } catch { }
            await guild.channels.create(opts);
            log.warning(`Anti-Nuke: auto-restored channel #${resource.name}`);
        } else if (kind === 'role') {
            if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return;
            if (resource.managed || resource.id === guild.id) return;
            const created = await guild.roles.create({
                name: resource.name,
                color: resource.color,
                hoist: resource.hoist,
                permissions: resource.permissions,
                mentionable: resource.mentionable,
                reason: 'Anti-Nuke: auto-restore deleted role',
            });
            try { if (typeof resource.position === 'number' && resource.position < me.roles.highest.position) await created.setPosition(resource.position); } catch { }
            log.warning(`Anti-Nuke: auto-restored role @${resource.name}`);
        }
    } catch (e) {
        log.warning(`Anti-Nuke: auto-restore failed for ${kind} ${resource?.name}: ${e.message}`);
    }
}

async function checkAntiNuke(guild, action, executor, target = null) {
    if (!guild || !executor?.id) return;

    const config = antinukeCache.get(guild.id);
    if (!config?.enabled) return;

    const protectionConfig = config[action];
    if (!protectionConfig?.enabled) return;

    if (executor.bot) return;
    if (isAntiNukeExempt(guild, config, executor.id)) return;

    const key = `${guild.id}-${executor.id}-${action}`;
    const now = Date.now();
    const timeWindow = protectionConfig.timeWindow || 60000;
    const zeroTolerance = !!config.zeroTolerance;
    // Zero-tolerance mode punishes on the FIRST destructive action.
    const limit = zeroTolerance ? 1 : (protectionConfig.limit || 3);

    let actions = antinukeTracker.get(key);
    if (!actions) {
        actions = [];
        antinukeTracker.set(key, actions);
    }
    actions.push(now);

    const cutoff = now - timeWindow;
    let startIdx = 0;
    while (startIdx < actions.length && actions[startIdx] < cutoff) startIdx++;
    if (startIdx > 0) actions.splice(0, startIdx);

    // Trigger: zero-tolerance fires on the first action; otherwise only once
    // the configured limit is exceeded.
    if (zeroTolerance ? (actions.length < 1) : (actions.length <= limit)) return;

    /* ── In-flight guard ──
     * If the executor is rapid-firing dangerous actions, multiple
     * checkAntiNuke calls can land here simultaneously. Without a
     * lock, each one fetches the member, runs the punishment, and
     * sends a duplicate log entry. We piggy-back a flag on the
     * tracked actions array (it's per-key so already isolated). */
    if (actions._punishing) return;
    actions._punishing = true;

    const member = guild.members.cache.get(executor.id) || await guild.members.fetch(executor.id).catch(() => null);
    if (!member) {
        actions._punishing = false;
        return;
    }

    const actionType = protectionConfig.action || 'remove_roles';
    const violationCount = actions.length;

    // ── Instant quarantine ──
    // Neutralize the offender's power IMMEDIATELY by stripping their
    // removable roles before the (possibly slower or failable) configured
    // punishment runs. Stops further damage even if the ban/kick is delayed
    // or blocked by hierarchy/permissions.
    if (config.instantQuarantine) {
        try { await instantQuarantineMember(guild, member); } catch { /* best-effort */ }
    }

    try {
        const success = await executeAntiNukePunishment(guild, member, actionType, action, executor);

        /* Reset tracking ONLY on successful punishment. The previous
         * implementation deleted the key whether or not the action
         * landed — so an offender the bot couldn't punish (role
         * hierarchy, no permission, owner exempt) would have their
         * counter reset and could resume nuking immediately.
         * Keeping the array around lets the next dangerous action
         * trigger another punishment attempt. */
        if (success) {
            antinukeTracker.delete(key);

            sendAntiNukeLog(guild, config, executor, action, limit, timeWindow, violationCount, actionType, target);

            // ── Optional external audit webhook (gated by env var) ──
            const antinukeAuditWebhook = process.env.MODERATION_AUDIT_WEBHOOK;
            if (antinukeAuditWebhook) {
                try {
                    const antinukeWhEmbed = {
                        title: '🔐  Anti-Nuke Protection Triggered',
                        color: ANTINUKE_PUNISH_COLORS[actionType] || 0xFF0000,
                        thumbnail: { url: guild.iconURL({ dynamic: true, size: 512 }) || '' },
                        fields: [
                            { name: '🏷️ Server', value: `\`${guild.name}\` (\`${guild.id}\`)`, inline: false },
                            { name: '👤 Offender', value: `${executor.username || 'Unknown'} (<@${executor.id}>)`, inline: true },
                            { name: '⚡ Threat Action', value: `\`${action}\``, inline: true },
                            { name: '🛡️ Response', value: `\`${actionType.toUpperCase()}\``, inline: true },
                            { name: '🔁 Violations', value: `\`${violationCount}\` actions in \`${(timeWindow / 1000)}s\` (limit: \`${limit}\`)`, inline: false },
                            { name: '🎯 Target', value: target ? `\`${target}\`` : 'N/A', inline: true },
                            { name: '👥 Server Members', value: `\`${guild.memberCount.toLocaleString()}\``, inline: true },
                        ],
                        footer: { text: `Anti-Nuke • Protection Active` },
                        timestamp: new Date().toISOString()
                    };
                    fetch(antinukeAuditWebhook, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: client.user?.username || 'Bot', avatar_url: client.user?.displayAvatarURL({ size: 256 }) || '', embeds: [antinukeWhEmbed] })
                    }).catch(() => { });
                } catch (_) { /* never let webhook failures break antinuke */ }
            }
        } else {
            // Punishment failed — log it once per cycle so admins know
            // their config is unenforceable, but don't spam the log on
            // every subsequent dangerous action. We mark the array so
            // the warn fires only when violations cross the limit
            // again from a fresh batch.
            log.warning(`Anti-Nuke: Punishment FAILED for ${executor.username || executor.id} on ${action} — counter retained`);

            // Surface the unenforceable trigger to the guild's security
            // log channel so admins actually notice (console warnings are
            // invisible to them). Throttled to once per 5 min per
            // (guild, executor, action) so a rapid-fire nuker doesn't
            // flood the channel, and fully guarded so a logging failure
            // can never break the antinuke flow.
            try {
                const FAIL_NOTICE_TTL = 5 * 60 * 1000;
                const lastNotified = actions._failureNotifiedAt || 0;
                if (now - lastNotified >= FAIL_NOTICE_TTL) {
                    actions._failureNotifiedAt = now;
                    logAntinukeFailure(guild, {
                        executor,
                        action,
                        punishment: actionType,
                        limit,
                        timeWindow,
                        violations: violationCount,
                    }).catch(() => { });
                }
            } catch (_) { /* never let the failure notice break antinuke */ }
        }
    } catch (error) {
        log.error(`Anti-Nuke punishment error (${action}):`, error);
    } finally {
        // Always release the in-flight flag, even on success/failure/
        // exception — otherwise the executor's tracker is permanently
        // wedged and future violations are silently ignored.
        if (actions) actions._punishing = false;
    }
}

async function checkAuditLogAntiNuke(guild, auditType, action, targetId, targetName, maxAge = 5000, deletedResource = null, restoreKind = null) {
    if (!guild) return;

    const config = antinukeCache.get(guild.id);
    if (!config?.enabled) return;
    if (!config[action]?.enabled) return;

    const botMember = guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;

    try {
        const auditLogs = await guild.fetchAuditLogs({ type: auditType, limit: 1 });
        const entry = auditLogs.entries.first();
        if (!entry) return;
        if (targetId && entry.target?.id !== targetId) return;
        if (Date.now() - entry.createdTimestamp > maxAge) return;

        const executor = entry.executor;
        if (!executor?.id) return;

        const botId = botMember.id || client.user?.id;
        if (executor.id === botId) return;
        if (executor.bot) return;

        // Auto-restore: if a non-exempt user deleted the resource and the guild
        // enabled autoRestore, recreate it immediately (runs alongside the
        // normal punishment below).
        if (config.autoRestore && deletedResource && restoreKind && !isAntiNukeExempt(guild, config, executor.id)) {
            antiNukeRestore(guild, restoreKind, deletedResource).catch(() => { });
        }

        await checkAntiNuke(guild, action, executor, targetName);
    } catch (error) {
        if (error.code !== 10004 && error.code !== 50013) {
            log.error(`Anti-Nuke ${action} audit error:`, error);
        }
    }
}

client.on('guildMemberAdd', async (member) => {
    try {
        await logMemberJoin(member);

        // Update server stats channels
        try { await updateServerStats(member.guild); } catch { }

        if (member.user.bot) {
            const config = antinukeCache.get(member.guild.id);
            if (config?.enabled && config.botAdd?.enabled) {
                try {
                    const botMember = member.guild.members.me;
                    if (botMember?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
                        const auditLogs = await member.guild.fetchAuditLogs({
                            type: 28,
                            limit: 1
                        });
                        const botAddLog = auditLogs.entries.first();
                        if (botAddLog && botAddLog.target?.id === member.id) {
                            const executor = botAddLog.executor;
                            if (executor?.id && !isAntiNukeExempt(member.guild, config, executor.id)) {
                                const action = config.botAdd.action || 'kick_bot';
                                const reason = 'Anti-Nuke: Unauthorized bot addition';
                                let acted = false;

                                try {
                                    if (action === 'kick_bot') {
                                        if (member.kickable) {
                                            await member.kick(reason);
                                            acted = true;
                                            log.warning(`Anti-Nuke: Kicked bot ${member.user.username} added by ${executor.username || executor.id}`);
                                        } else {
                                            log.warning(`Anti-Nuke: Cannot kick bot ${member.user.username} — bot lacks permission`);
                                        }
                                    } else if (action === 'kick_both') {
                                        let botKicked = false, execKicked = false;
                                        if (member.kickable) {
                                            await member.kick(reason);
                                            botKicked = true;
                                        }
                                        const executorMember = await member.guild.members.fetch(executor.id).catch(() => null);
                                        if (executorMember && executorMember.id !== member.guild.ownerId && executorMember.kickable) {
                                            await executorMember.kick(reason);
                                            execKicked = true;
                                        }
                                        acted = botKicked || execKicked;
                                        log.warning(`Anti-Nuke: kick_both — bot=${botKicked} executor=${execKicked} (${member.user.username} + ${executor.username || executor.id})`);
                                    } else if (action === 'ban_bot') {
                                        if (member.bannable) {
                                            await member.ban({ reason, deleteMessageSeconds: 0 });
                                            acted = true;
                                            log.warning(`Anti-Nuke: Banned bot ${member.user.username} added by ${executor.username || executor.id}`);
                                        } else {
                                            log.warning(`Anti-Nuke: Cannot ban bot ${member.user.username} — bot lacks permission`);
                                        }
                                    } else {
                                        log.error(`Anti-Nuke: Unknown botAdd action "${action}"`);
                                    }
                                } catch (err) {
                                    // Don't let a permission/rate-limit error stop us from
                                    // logging the detection — admins still need to know
                                    // an unauthorised bot was added.
                                    log.error(`Anti-Nuke botAdd action ${action} failed:`, err);
                                }

                                // Send log
                                if (config.logChannel) {
                                    const logChannel = member.guild.channels.cache.get(config.logChannel);
                                    if (logChannel) {
                                        const actionLabels = { kick_bot: 'Kicked Bot', kick_both: 'Kicked Bot & Executor', ban_bot: 'Banned Bot' };
                                        const nowTs = Math.floor(Date.now() / 1000);
                                        const statusLine = acted
                                            ? `<:Checkedbox:1521227734943269077> **Status:** Action applied`
                                            : `<:Cancel:1521227723916181644> **Status:** Action **failed** — bot lacked permission to apply \`${action}\``;
                                        const container = new ContainerBuilder()
                                            .setAccentColor(acted ? (ANTINUKE_PUNISH_COLORS[action] || 0xED4245) : 0xFEE75C)
                                            .addTextDisplayComponents(
                                                new TextDisplayBuilder()
                                                    .setContent(
                                                        `# <:bots:1521227848101396610> Anti-Nuke: Bot Add Protection\n\n` +
                                                        `<:Userblock:1521227822641975366> **Added by:** <@${executor.id}> (\`${executor.id}\`)\n` +
                                                        `<:bots:1521227848101396610> **Bot:** <@${member.id}> (\`${member.id}\`)\n` +
                                                        `<:Shield:1521227694677692467> **Action:** \`${actionLabels[action] || action}\`\n` +
                                                        `<:Timer:1521227971590095070> **Time:** <t:${nowTs}:f> (<t:${nowTs}:R>)\n` +
                                                        `${statusLine}\n\n` +
                                                        `-# xNico Anti-Nuke Engine`
                                                    )
                                            );
                                        logChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications }).catch(() => { });
                                    }
                                }
                            }
                        }
                    }
                } catch (error) {
                    if (error.code !== 10004 && error.code !== 50013) {
                        log.error('Anti-Nuke bot add error', error);
                    }
                }
            }
        }

        if (isTrackingEnabled(member.guild.id)) {
            await handleMemberJoin(member);
        }

        // Anti-Alt Protection — kick accounts younger than configured minimum age
        if (!member.user.bot) {
            const antialtConfig = antialtCache.get(member.guild.id);
            if (antialtConfig?.enabled) {
                const accountAgeMs = Date.now() - member.user.createdTimestamp;
                const minAgeDays = antialtConfig.minAge || 7;
                const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;

                if (accountAgeMs < minAgeMs) {
                    // Honour the configured action — old code always
                    // kicked even when the admin set 'ban' or 'log_only',
                    // making the per-action setting silently useless.
                    const action = (antialtConfig.action || 'kick').toLowerCase();
                    const accountAgeDays = Math.floor(accountAgeMs / (24 * 60 * 60 * 1000));
                    const reason = `Anti-Alt: Account too new (${accountAgeDays} days old, min: ${minAgeDays} days)`;

                    let acted = false;
                    let actLabel = action;
                    try {
                        if (action === 'kick') {
                            if (member.kickable) { await member.kick(reason); acted = true; }
                            else log.warning(`Anti-Alt: Cannot kick ${member.user.username} — bot lacks permission`);
                        } else if (action === 'ban') {
                            if (member.bannable) { await member.ban({ reason }); acted = true; }
                            else log.warning(`Anti-Alt: Cannot ban ${member.user.username} — bot lacks permission`);
                        } else if (action === 'log_only') {
                            // Detection-only mode — never touch the member,
                            // just write to the log channel below.
                            actLabel = 'log_only';
                            acted = true;
                        } else {
                            log.error(`Anti-Alt: Unknown action "${action}" for ${member.user.username}`);
                        }

                        if (acted) {
                            log.warning(`Anti-Alt: ${actLabel} on ${member.user.username} (account age: ${accountAgeDays}d, required: ${minAgeDays}d)`);
                        }
                    } catch (err) {
                        log.error('Anti-Alt action error', err);
                    }

                    // Always log the detection (even when acted=false) so
                    // the admin can see the bot couldn't apply the action
                    // and adjust role hierarchy.
                    if (antialtConfig.logChannel) {
                        try {
                            const logChannel = member.guild.channels.cache.get(antialtConfig.logChannel);
                            if (logChannel) {
                                const status = acted
                                    ? `<:Checkedbox:1521227734943269077> Action applied: \`${actLabel}\``
                                    : `<:Cancel:1521227723916181644> Action **failed** — bot couldn't \`${actLabel}\` (check role hierarchy)`;
                                const container = new ContainerBuilder()
                                    .setAccentColor(acted ? 0xED4245 : 0xFEE75C)
                                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                                        `# <:Shield:1521227694677692467> Anti-Alt Detection\n\n` +
                                        `**User:** ${member.user.username} (\`${member.id}\`)\n` +
                                        `**Account Age:** ${accountAgeDays} day${accountAgeDays === 1 ? '' : 's'}\n` +
                                        `**Required:** ${minAgeDays} day${minAgeDays === 1 ? '' : 's'}\n` +
                                        `${status}`
                                    ));
                                await logChannel.send({
                                    components: [container],
                                    flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
                                }).catch(() => { });
                            }
                        } catch (e) {
                            log.error('Anti-Alt log error', e);
                        }
                    }
                    // Only return early when we actually acted on the
                    // user — otherwise (e.g. log_only or failed kick) we
                    // let downstream join handlers (anti-raid, welcome,
                    // autoroles) still process the join normally.
                    if (acted && action !== 'log_only') return;
                }
            }
        }

        // Anti-Raid Protection (using in-memory cache)
        try {
            const guildAntiraidConfig = antiraidCache.get(member.guild.id);
            if (guildAntiraidConfig?.enabled) {
                // Check bypass role
                const bypassRole = guildAntiraidConfig.bypassRoleId;
                const hasBypass = bypassRole && member.roles?.cache?.has(bypassRole);

                if (!hasBypass && !member.user.bot) {
                    // Account age check
                    if (guildAntiraidConfig.accountAge?.enabled) {
                        const accountAgeMs = Date.now() - member.user.createdTimestamp;
                        const minAgeDays = guildAntiraidConfig.accountAge.minDays || 7;
                        const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;

                        if (accountAgeMs < minAgeMs) {
                            const action = (guildAntiraidConfig.accountAge.action || 'kick').toLowerCase();
                            const accountAgeDays = Math.floor(accountAgeMs / (24 * 60 * 60 * 1000));
                            const reason = `Anti-Raid: Account too new (${accountAgeDays} days old, min: ${minAgeDays} days)`;

                            // Apply the configured action with proper
                            // kickable/bannable/moderatable checks so a
                            // failed API call doesn't leave the user in
                            // the server with no log of the failure.
                            let acted = false;
                            let actLabel = action;
                            try {
                                if (action === 'kick') {
                                    if (member.kickable) { await member.kick(reason); acted = true; }
                                } else if (action === 'ban') {
                                    if (member.bannable) { await member.ban({ reason }); acted = true; }
                                } else if (action === 'timeout') {
                                    // 1 hour default — surfaces the
                                    // alt-likeness without removing them
                                    // from the server.
                                    if (member.moderatable) { await member.timeout(60 * 60 * 1000, reason); acted = true; }
                                } else if (action === 'log_only') {
                                    actLabel = 'log_only';
                                    acted = true;
                                }
                            } catch (err) {
                                log.error('Anti-Raid account age action error', err);
                            }

                            if (guildAntiraidConfig.logChannel) {
                                const logChannel = member.guild.channels.cache.get(guildAntiraidConfig.logChannel);
                                if (logChannel) {
                                    const status = acted
                                        ? `<:Checkedbox:1521227734943269077> Action applied: \`${actLabel}\``
                                        : `<:Cancel:1521227723916181644> Action **failed** — bot couldn't \`${actLabel}\``;
                                    const container = new ContainerBuilder()
                                        .setAccentColor(acted ? 0xED4245 : 0xFEE75C)
                                        .addTextDisplayComponents(
                                            new TextDisplayBuilder()
                                                .setContent(`# <:Shield:1521227694677692467> Anti-Raid: Account Age Protection\n\n**User:** ${member.user.username} (\`${member.id}\`)\n**Account Age:** ${accountAgeDays} day${accountAgeDays === 1 ? '' : 's'}\n**Required:** ${minAgeDays} day${minAgeDays === 1 ? '' : 's'}\n${status}`)
                                        );
                                    await logChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications }).catch(() => { });
                                }
                            }

                            // Only short-circuit downstream join handlers
                            // when we actually removed/timed-out the user.
                            // log_only or failed actions should still let
                            // other systems run.
                            if (acted && action !== 'log_only' && action !== 'timeout') return;
                        }
                    }

                    // Join rate tracking
                    if (guildAntiraidConfig.joinRate?.enabled) {
                        const joinRateKey = `joinrate-${member.guild.id}`;
                        if (!global.joinRateTracker) global.joinRateTracker = new Map();

                        if (!global.joinRateTracker.has(joinRateKey)) {
                            global.joinRateTracker.set(joinRateKey, []);
                        }

                        const joins = global.joinRateTracker.get(joinRateKey);
                        const now = Date.now();
                        joins.push({ time: now, memberId: member.id });

                        const timeWindow = guildAntiraidConfig.joinRate.timeWindow || 10000;
                        const recentJoins = joins.filter(j => now - j.time < timeWindow);
                        global.joinRateTracker.set(joinRateKey, recentJoins);

                        const limit = guildAntiraidConfig.joinRate.limit || 10;
                        if (recentJoins.length > limit) {
                            const action = (guildAntiraidConfig.joinRate.action || 'kick').toLowerCase();
                            const reason = `Anti-Raid: Join rate limit exceeded (${recentJoins.length}/${limit} joins in ${(timeWindow / 1000)}s)`;
                            let acted = false;
                            let actLabel = action;
                            try {
                                if (action === 'kick') {
                                    if (member.kickable) { await member.kick(reason); acted = true; }
                                } else if (action === 'ban') {
                                    if (member.bannable) { await member.ban({ reason }); acted = true; }
                                } else if (action === 'timeout') {
                                    if (member.moderatable) { await member.timeout(60 * 60 * 1000, reason); acted = true; }
                                } else if (action === 'log_only') {
                                    actLabel = 'log_only';
                                    acted = true;
                                }

                                // Auto lockdown if threshold reached
                                if (guildAntiraidConfig.autoLockdown?.enabled) {
                                    const lockdownKey = `lockdown-${member.guild.id}`;
                                    if (!global.lockdownTracker) global.lockdownTracker = new Map();
                                    if (!global.lockdownActive) global.lockdownActive = new Map();

                                    // Skip everything while a lockdown is already in flight —
                                    // otherwise every subsequent join during the duration
                                    // re-locks already-locked channels AND schedules another
                                    // setTimeout to "restore" them, which would unlock the
                                    // server before the original lockdown duration elapses.
                                    if (global.lockdownActive.get(lockdownKey)) {
                                        // already locked — skip
                                    } else {
                                        const lockdownCount = (global.lockdownTracker.get(lockdownKey) || 0) + 1;
                                        global.lockdownTracker.set(lockdownKey, lockdownCount);

                                        if (lockdownCount >= (guildAntiraidConfig.autoLockdown.threshold || 15)) {
                                            // Mark active so concurrent joinRate violations
                                            // during the duration are no-ops above.
                                            global.lockdownActive.set(lockdownKey, true);
                                            // Trigger auto lockdown
                                            const textChannels = member.guild.channels.cache.filter(ch => ch.type === 0);
                                            for (const [, channel] of textChannels) {
                                                try {
                                                    await channel.permissionOverwrites.edit(member.guild.roles.everyone, {
                                                        SendMessages: false
                                                    });
                                                } catch (e) { }
                                            }

                                            if (guildAntiraidConfig.logChannel) {
                                                const logChannel = member.guild.channels.cache.get(guildAntiraidConfig.logChannel);
                                                if (logChannel) {
                                                    const container = new ContainerBuilder()
                                                        .addTextDisplayComponents(
                                                            new TextDisplayBuilder()
                                                                .setContent(`# <:Lock:1521227892770734120> Anti-Raid: Auto Lockdown Triggered\n\n**Reason:** Join rate exceeded threshold (${lockdownCount} incidents)\n**Action:** All text channels locked`)
                                                        );
                                                    await logChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications }).catch(() => { });
                                                }
                                            }

                                            // Restore permissions after lockdown duration
                                            const duration = guildAntiraidConfig.autoLockdown.duration || 300000;
                                            setTimeout(async () => {
                                                try {
                                                    global.lockdownTracker.set(lockdownKey, 0);
                                                    global.lockdownActive.set(lockdownKey, false);
                                                    // Restore channel permissions
                                                    const textChannelsRestore = member.guild.channels.cache.filter(ch => ch.type === 0);
                                                    for (const [, channel] of textChannelsRestore) {
                                                        try {
                                                            await channel.permissionOverwrites.edit(member.guild.roles.everyone, {
                                                                SendMessages: null
                                                            });
                                                        } catch (e) { }
                                                    }

                                                    if (guildAntiraidConfig.logChannel) {
                                                        const logCh = member.guild.channels.cache.get(guildAntiraidConfig.logChannel);
                                                        if (logCh) {
                                                            const restoreContainer = new ContainerBuilder()
                                                                .addTextDisplayComponents(
                                                                    new TextDisplayBuilder()
                                                                        .setContent(`# <:Checkedbox:1521227734943269077> Anti-Raid: Lockdown Lifted\n\n**Duration:** ${duration / 1000} seconds\n**Action:** All text channels unlocked`)
                                                                );
                                                            await logCh.send({ components: [restoreContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
                                                        }
                                                    }
                                                } catch (e) {
                                                    log.error('Anti-Raid lockdown restore error', e);
                                                }
                                            }, duration);

                                            // Cleanup old join rate entries to prevent memory growth
                                            if (global.joinRateTracker && global.joinRateTracker.size > 100) {
                                                const now = Date.now();
                                                for (const [key, joins] of global.joinRateTracker.entries()) {
                                                    const recentJoins = joins.filter(j => now - j.time < 60000);
                                                    if (recentJoins.length === 0) {
                                                        global.joinRateTracker.delete(key);
                                                    } else {
                                                        global.joinRateTracker.set(key, recentJoins);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }

                                if (guildAntiraidConfig.logChannel) {
                                    const logChannel = member.guild.channels.cache.get(guildAntiraidConfig.logChannel);
                                    if (logChannel) {
                                        const status = acted
                                            ? `<:Checkedbox:1521227734943269077> Action applied: \`${actLabel}\``
                                            : `<:Cancel:1521227723916181644> Action **failed** — bot couldn't \`${actLabel}\``;
                                        const container = new ContainerBuilder()
                                            .setAccentColor(acted ? 0xED4245 : 0xFEE75C)
                                            .addTextDisplayComponents(
                                                new TextDisplayBuilder()
                                                    .setContent(`# <:Shield:1521227694677692467> Anti-Raid: Join Rate Protection\n\n**User:** ${member.user.username} (\`${member.id}\`)\n**Joins in window:** ${recentJoins.length}/${limit}\n${status}`)
                                            );
                                        await logChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications }).catch(() => { });
                                    }
                                }
                            } catch (err) {
                                log.error('Anti-Raid join rate error', err);
                            }
                            // Only short-circuit downstream join handlers
                            // when we actually removed/timed-out the user.
                            if (acted && action !== 'log_only' && action !== 'timeout') return;
                        }
                    }

                    // Suspicious patterns check
                    if (guildAntiraidConfig.suspiciousPatterns?.enabled) {
                        const username = member.user.username.toLowerCase();
                        const suspiciousPatterns = [
                            /^[a-z]{8}[0-9]{4}$/i,
                            /discord.*nitro/i,
                            /free.*nitro/i,
                            /^user[0-9]+$/i,
                            /admin.*official/i
                        ];

                        const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(username));
                        if (isSuspicious) {
                            const action = (guildAntiraidConfig.suspiciousPatterns.action || 'kick').toLowerCase();
                            const reason = `Anti-Raid: Suspicious username pattern matched`;
                            let acted = false;
                            let actLabel = action;
                            try {
                                if (action === 'kick') {
                                    if (member.kickable) { await member.kick(reason); acted = true; }
                                } else if (action === 'ban') {
                                    if (member.bannable) { await member.ban({ reason }); acted = true; }
                                } else if (action === 'timeout') {
                                    if (member.moderatable) { await member.timeout(60 * 60 * 1000, reason); acted = true; }
                                } else if (action === 'log_only') {
                                    actLabel = 'log_only';
                                    acted = true;
                                }

                                if (guildAntiraidConfig.logChannel) {
                                    const logChannel = member.guild.channels.cache.get(guildAntiraidConfig.logChannel);
                                    if (logChannel) {
                                        const status = acted
                                            ? `<:Checkedbox:1521227734943269077> Action applied: \`${actLabel}\``
                                            : `<:Cancel:1521227723916181644> Action **failed** — bot couldn't \`${actLabel}\``;
                                        const container = new ContainerBuilder()
                                            .setAccentColor(acted ? 0xED4245 : 0xFEE75C)
                                            .addTextDisplayComponents(
                                                new TextDisplayBuilder()
                                                    .setContent(`# <:Shield:1521227694677692467> Anti-Raid: Suspicious Pattern Detected\n\n**User:** ${member.user.username} (\`${member.id}\`)\n**Pattern:** Username matched suspicious criteria\n${status}`)
                                            );
                                        await logChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications }).catch(() => { });
                                    }
                                }
                            } catch (err) {
                                log.error('Anti-Raid suspicious pattern error', err);
                            }
                            if (acted && action !== 'log_only' && action !== 'timeout') return;
                        }
                    }
                }
            }
        } catch (error) {
            log.error('Anti-Raid error', error);
        }

        // Handle AutoRole Assignment (runs independently of welcomer)
        try {
            if (jsonStore.has('autorole')) {
                const autoroleConfig = jsonStore.peek('autorole') || {};
                const guildAutorole = autoroleConfig[member.guild.id];

                if (guildAutorole) {
                    let roleIds;
                    if (typeof guildAutorole === 'string') {
                        roleIds = member.user.bot ? [] : [guildAutorole];
                    } else {
                        roleIds = member.user.bot ? guildAutorole.bots : guildAutorole.humans;
                    }

                    if (Array.isArray(roleIds) && roleIds.length > 0) {
                        const rolesToAdd = [];

                        for (const roleId of roleIds) {
                            const role = member.guild.roles.cache.get(roleId);
                            if (role && !role.managed && role.position < member.guild.members.me.roles.highest.position) {
                                rolesToAdd.push(roleId);
                            }
                        }

                        if (rolesToAdd.length > 0) {
                            await member.roles.add(rolesToAdd, 'AutoRole assignment').catch(err => {
                                log.error(`AutoRole: Failed to assign roles to ${member.user.username}: ${err.message}`);
                            });
                            const assignedRoles = rolesToAdd.map(id => member.guild.roles.cache.get(id)?.name).filter(Boolean).join(', ');
                            log.info(`AutoRole: Assigned [${assignedRoles}] to ${member.user.username}`);
                        }
                    }
                }
            }
        } catch (error) {
            log.error('AutoRole error', error);
        }

        if (!jsonStore.has('welcomer')) return;

        const config = jsonStore.peek('welcomer') || {};
        const guildConfig = config[member.guild.id];

        if (!guildConfig || !guildConfig.enabled) {
            return;
        }

        const channel = member.guild.channels.cache.get(guildConfig.channelId);
        if (!channel) {
            log.error(`Welcomer: Channel ${guildConfig.channelId} not found in guild ${member.guild.id}`);
            return;
        }

        if (!channel.permissionsFor(member.guild.members.me).has(PermissionFlagsBits.SendMessages)) {
            log.error(`Welcomer: Missing permissions in channel ${channel.name}`);
            return;
        }

        const mode = guildConfig.mode || guildConfig.displayType || 'components';
        const rawContent = guildConfig.content || guildConfig.message || `Welcome {user} to {server}!`;
        const processedContent = replacePlaceholders(rawContent, member.user, member.guild, channel) || 'Welcome!';
        const safeStr = (s, fb = '\u200b') => (!s || typeof s !== 'string') ? fb : (s.length > 4096 ? s.substring(0, 4093) + '...' : s);
        const colorStr = typeof guildConfig.color === 'string' ? guildConfig.color : (guildConfig.containerColor ? `#${guildConfig.containerColor.toString(16)}` : '#bcf1e4');
        const colorValue = colorStr ? parseInt(colorStr.replace('#', ''), 16) : 0x5865F2;

        if (mode === 'embed') {
            const embed = new EmbedBuilder()
                .setColor(isNaN(colorValue) ? 0x5865F2 : colorValue)
                .setDescription(processedContent)
                .setTimestamp();

            if (guildConfig.title) {
                embed.setTitle(replacePlaceholders(guildConfig.title, member.user, member.guild, channel));
            }

            if (guildConfig.image) {
                const imgVal = typeof guildConfig.image === 'string' ? guildConfig.image : guildConfig.image?.url;
                const processedImage = imgVal ? replacePlaceholders(imgVal, member.user, member.guild, channel) : null;
                if (processedImage && (processedImage.startsWith('http://') || processedImage.startsWith('https://'))) {
                    embed.setImage(processedImage);
                }
            }

            if (guildConfig.thumbnail) {
                const thumbVal = typeof guildConfig.thumbnail === 'string' ? guildConfig.thumbnail : guildConfig.thumbnail?.url;
                const processedThumb = thumbVal ? replacePlaceholders(thumbVal, member.user, member.guild, channel) : null;
                if (processedThumb && (processedThumb.startsWith('http://') || processedThumb.startsWith('https://'))) {
                    embed.setThumbnail(processedThumb);
                }
            }

            if (guildConfig.footer) {
                embed.setFooter({ text: replacePlaceholders(guildConfig.footer, member.user, member.guild, channel) });
            }

            if (guildConfig.author) {
                embed.setAuthor({
                    name: replacePlaceholders(guildConfig.author, member.user, member.guild, channel),
                    iconURL: member.user.displayAvatarURL({ size: 64 })
                });
            }

            const pingContent = guildConfig.pingUser ? `<@${member.id}>` : undefined;
            channel.send({ content: pingContent, embeds: [embed] }).then(sentMsg => {
                if (guildConfig.autoDelete > 0) {
                    setTimeout(() => sentMsg.delete().catch(() => { }), guildConfig.autoDelete * 1000);
                }
            }).catch(err => {
                log.error('Welcomer: Error sending embed message', err);
            });
        } else {
            const { MediaGalleryBuilder, MediaGalleryItemBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
            const container = new ContainerBuilder();

            // Only set accent color if not colorless mode
            if (!guildConfig.colorless && !isNaN(colorValue)) {
                container.setAccentColor(colorValue);
            }

            const thumbValue = typeof guildConfig.thumbnail === 'string' ? guildConfig.thumbnail : (guildConfig.thumbnail?.url || null);
            const imageValue = typeof (guildConfig.mediaUrl || guildConfig.image) === 'string' ? (guildConfig.mediaUrl || guildConfig.image) : (guildConfig.mediaGallery?.url || guildConfig.image?.url || null);
            const processedThumb = thumbValue ? replacePlaceholders(thumbValue, member.user, member.guild, channel) : null;
            const processedImage = imageValue ? replacePlaceholders(imageValue, member.user, member.guild, channel) : null;

            const imgPos = guildConfig.imagePosition || 'bottom';

            // Build image gallery if image exists (not used for 'side' mode)
            let imageGallery = null;
            if (processedImage && imgPos !== 'side' && (processedImage.startsWith('http://') || processedImage.startsWith('https://'))) {
                imageGallery = new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(processedImage)
                );
            }

            // For 'side' mode, image becomes thumbnail accessory alongside text
            const sideImageUrl = (imgPos === 'side' && processedImage && processedImage.startsWith('http')) ? processedImage : null;
            const effectiveThumb = sideImageUrl || processedThumb;
            const hasValidThumb = effectiveThumb && (effectiveThumb.startsWith('http://') || effectiveThumb.startsWith('https://'));

            // Add image gallery at top if position is 'top'
            if (imageGallery && imgPos === 'top') {
                container.addMediaGalleryComponents(imageGallery);
            }

            const welcomeBtnPos = guildConfig.buttonPosition || 'bottom';
            function renderWelcomeBtns() {
                if (guildConfig.buttons?.length > 0) {
                    const urlButtons = guildConfig.buttons
                        .filter(b => b.label && b.url && (b.url.startsWith('http://') || b.url.startsWith('https://')))
                        .slice(0, 5)
                        .map(b => {
                            const btn = new ButtonBuilder()
                                .setLabel(typeof b.label === 'string' ? b.label.substring(0, 80) : 'Link')
                                .setURL(b.url)
                                .setStyle(ButtonStyle.Link);
                            if (b.emoji) btn.setEmoji(b.emoji);
                            return btn;
                        });
                    if (urlButtons.length > 0) container.addActionRowComponents(new ActionRowBuilder().addComponents(...urlButtons));
                }
                if (guildConfig.actionButtons?.length > 0) {
                    try {
                        if (jsonStore.has('button-commands')) {
                            const btnConfig = jsonStore.peek('button-commands') || {};
                            const gId = member.guild.id;
                            if (btnConfig[gId]) {
                                const styleMap = { 'primary': ButtonStyle.Primary, 'secondary': ButtonStyle.Secondary, 'success': ButtonStyle.Success, 'danger': ButtonStyle.Danger, 'link': ButtonStyle.Link };
                                let actionRow = new ActionRowBuilder();
                                let count = 0;
                                for (const buttonId of guildConfig.actionButtons.slice(0, 25)) {
                                    const bd = btnConfig[gId][buttonId];
                                    if (!bd) continue;
                                    const ab = new ButtonBuilder().setLabel(bd.label).setStyle(styleMap[bd.style] || ButtonStyle.Primary);
                                    if (bd.style === 'link') { if (bd.url) ab.setURL(bd.url); else continue; }
                                    else ab.setCustomId(`btn_cmd_${gId}_${buttonId}`);
                                    if (bd.emoji) ab.setEmoji(bd.emoji);
                                    actionRow.addComponents(ab);
                                    count++;
                                    if (count >= 5) { container.addActionRowComponents(actionRow); actionRow = new ActionRowBuilder(); count = 0; }
                                }
                                if (count > 0) container.addActionRowComponents(actionRow);
                            }
                        }
                    } catch (e) { log.error('Welcome action buttons: ' + e.message); }
                }
            }

            function renderWelcomeMenus() {
                if (guildConfig.actionMenus?.length > 0) {
                    try {
                        if (jsonStore.has('select-menus')) {
                            const menuConfig = jsonStore.peek('select-menus') || {};
                            const gId = member.guild.id;
                            if (menuConfig[gId]) {
                                for (const menuId of guildConfig.actionMenus.slice(0, 5)) {
                                    const md = menuConfig[gId][menuId];
                                    if (!md) continue;
                                    const sm = new StringSelectMenuBuilder()
                                        .setCustomId(`sm_cmd_${gId}_${menuId}`)
                                        .setPlaceholder(md.placeholder || 'Select an option...')
                                        .setMinValues(md.minValues || 1)
                                        .setMaxValues(md.maxValues || 1);

                                    if (md.options?.length > 0) {
                                        sm.addOptions(md.options.slice(0, 25).map(o => ({
                                            label: o.label,
                                            value: o.value,
                                            description: o.description || undefined,
                                            emoji: o.emoji || undefined
                                        })));
                                        container.addActionRowComponents(new ActionRowBuilder().addComponents(sm));
                                    }
                                }
                            }
                        }
                    } catch (e) { log.error('Welcome action menus: ' + e.message); }
                }
            }

            // Components at top — before content
            if (welcomeBtnPos === 'top') {
                renderWelcomeBtns();
                renderWelcomeMenus();
            }

            const hasSeparators = /\{separator(:(small|medium|large))?\}/gi.test(rawContent);

            // Count how many extra components we'll need after content
            const extraComponents = (imageGallery && imgPos === 'bottom' ? 1 : 0) + (guildConfig.footer ? 2 : 0) + (guildConfig.buttons?.length > 0 ? 1 : 0) + (guildConfig.canvas?.enabled ? 1 : 0);
            const maxContentComponents = 10 - (imageGallery && imgPos === 'top' ? 1 : 0) - extraComponents;
            let componentCount = imageGallery && imgPos === 'top' ? 1 : 0;

            if (hasSeparators) {
                // Split on raw separators FIRST, then replace placeholders on each text part
                const markedContent = rawContent
                    .replace(/\{separator:small\}/gi, '---SEPARATOR:SMALL---')
                    .replace(/\{separator:medium\}/gi, '---SEPARATOR:MEDIUM---')
                    .replace(/\{separator:large\}/gi, '---SEPARATOR:LARGE---')
                    .replace(/\{separator\}/gi, '---SEPARATOR:SMALL---');
                const parts = markedContent.split(/---SEPARATOR:(SMALL|MEDIUM|LARGE)---/);
                let isFirst = true;

                for (let i = 0; i < parts.length; i++) {
                    if (componentCount >= maxContentComponents) break;
                    const part = parts[i];
                    if (part === 'SMALL' || part === 'MEDIUM' || part === 'LARGE') {
                        const spacing = part === 'LARGE' ? SeparatorSpacingSize.Large :
                            part === 'MEDIUM' ? SeparatorSpacingSize.Medium : SeparatorSpacingSize.Small;
                        container.addSeparatorComponents(
                            new SeparatorBuilder().setSpacing(spacing).setDivider(true)
                        );
                        componentCount++;
                    } else if (part.trim()) {
                        const processedPart = replacePlaceholders(part, member.user, member.guild, channel) || '\u200b';
                        if (isFirst && hasValidThumb) {
                            const section = new SectionBuilder()
                                .addTextDisplayComponents(new TextDisplayBuilder().setContent(safeStr(processedPart)))
                                .setThumbnailAccessory(new ThumbnailBuilder().setURL(effectiveThumb));
                            container.addSectionComponents(section);
                            isFirst = false;
                        } else {
                            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(safeStr(processedPart)));
                        }
                        componentCount++;
                    }
                }
            } else {
                if (hasValidThumb) {
                    const section = new SectionBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(safeStr(processedContent)))
                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(effectiveThumb));
                    container.addSectionComponents(section);
                } else {
                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(safeStr(processedContent)));
                }
                componentCount++;
            }

            // Add image gallery at bottom if position is 'bottom' (default)
            if (imageGallery && imgPos === 'bottom') {
                container.addMediaGalleryComponents(imageGallery);
            }

            if (guildConfig.footer) {
                container.addSeparatorComponents(
                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                );
                container.addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(safeStr(`-# ${replacePlaceholders(guildConfig.footer, member.user, member.guild, channel)}`))
                );
            }

            // Components at bottom (default)
            if (welcomeBtnPos !== 'top') {
                renderWelcomeBtns();
                renderWelcomeMenus();
            }

            // Check if canvas mode is enabled
            if (guildConfig.canvas?.enabled) {
                try {
                    const WelcomeCard = require('./utils/welcomeCard');
                    const { AttachmentBuilder } = require('discord.js');

                    const card = new WelcomeCard();
                    if (guildConfig.canvas.backgroundColor) card.setBackground(guildConfig.canvas.backgroundColor);
                    if (guildConfig.canvas.accentColor) card.setAccentColor(guildConfig.canvas.accentColor);
                    if (guildConfig.canvas.textColor) card.setTextColor(guildConfig.canvas.textColor);
                    if (guildConfig.canvas.backgroundImage) card.setBackgroundImage(guildConfig.canvas.backgroundImage);
                    if (guildConfig.canvas.fontFamily) card.setFont(guildConfig.canvas.fontFamily);

                    const customMsg = guildConfig.canvas.customMessage?.replace('{membercount}', member.guild.memberCount.toLocaleString()) || null;
                    const buffer = await card.generate(member.user, member.guild, member.guild.memberCount, customMsg);
                    const attachment = new AttachmentBuilder(buffer, { name: 'welcome.png' });

                    // Add canvas image to media gallery
                    container.addMediaGalleryComponents(
                        new MediaGalleryBuilder().addItems(
                            new MediaGalleryItemBuilder().setURL('attachment://welcome.png')
                        )
                    );

                    let pingMsg = null;
                    if (guildConfig.pingUser) {
                        pingMsg = await channel.send({ content: `<@${member.id}>` }).catch(() => null);
                    }
                    channel.send({ components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 }).then(sentMsg => {
                        if (guildConfig.autoDelete > 0) {
                            if (pingMsg) setTimeout(() => pingMsg.delete().catch(() => { }), guildConfig.autoDelete * 1000);
                            setTimeout(() => sentMsg.delete().catch(() => { }), guildConfig.autoDelete * 1000);
                        }
                    }).catch(err => {
                        log.error('Welcomer: Error sending canvas message', err);
                    });
                    return;
                } catch (canvasError) {
                    log.error('Welcomer: Canvas error, falling back', canvasError);
                }
            }

            let pingMsg = null;
            if (guildConfig.pingUser) {
                pingMsg = await channel.send({ content: `<@${member.id}>` }).catch(() => null);
            }
            channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).then(sentMsg => {
                if (guildConfig.autoDelete > 0) {
                    if (pingMsg) setTimeout(() => pingMsg.delete().catch(() => { }), guildConfig.autoDelete * 1000);
                    setTimeout(() => sentMsg.delete().catch(() => { }), guildConfig.autoDelete * 1000);
                }
            }).catch(err => {
                log.error('Welcomer: Error sending message', err);
            });
        }

        // Send DM Welcome if enabled
        if (guildConfig.dmWelcome?.enabled && guildConfig.dmWelcome?.content) {
            try {
                const dmContent = replacePlaceholders(guildConfig.dmWelcome.content, member.user, member.guild, channel);
                await member.send({ content: dmContent }).catch(() => { });
            } catch (e) { }
        }

    } catch (error) {
        log.error('Error in guildMemberAdd handler', error);
    }
});

client.on('inviteCreate', async (invite) => {
    await refreshGuildInvite(invite.guild);
    await logInviteCreate(invite);
});

client.on('inviteDelete', async (invite) => {
    await refreshGuildInvite(invite.guild);
    await logInviteDelete(invite);
});

client.on('guildCreate', async (guild) => {
    log.info(`Joined new guild: ${guild.name}`);
    // Keep the dashboard's bot-presence list in sync (cache already includes
    // the new guild at guildCreate time).
    syncBotGuildsList();
    await preloadGuildInvites(guild);

    // Register guild-specific slash commands for the new server so it gets the
    // full command set immediately (fresh-deploy behaviour) instead of only the
    // 100 global commands. The overflow commands won't fit globally otherwise.
    try {
        const { registerForGuild } = require('./utils/slashRegistrar');
        const ok = await registerForGuild({
            token: process.env.TOKEN,
            clientId: process.env.CLIENT_ID || client.user.id,
            commands,
            guildId: guild.id,
        });
        if (ok) log.success(`[Slash] Registered guild commands for new guild ${guild.name}`);
    } catch (err) {
        log.debug(`[Slash] guildCreate registration failed: ${err.message}`);
    }

    // Auto-create and store a permanent invite for the bot owner
    try {
        const serverlistCmd = client.commands.get('serverlist');
        if (serverlistCmd?.createAndStorePermanentInvite) {
            const inviteUrl = await serverlistCmd.createAndStorePermanentInvite(guild);
            if (inviteUrl) {
                log.debug(`Auto-created invite for ${guild.name}`);
            } else {
                log.debug(`Could not create invite for ${guild.name} (missing permissions)`);
            }
        }
    } catch (err) {
        log.error(`Failed to auto-create invite for ${guild.name}: ${err.message}`);
    }

    // Blacklist check
    if (jsonStore.has('blacklist')) {
        const blacklist = jsonStore.peek('blacklist') || {};
        if (blacklist.guilds?.find(g => g.id === guild.id)) {
            log.warning(`Guild ${guild.name} is blacklisted. Leaving...`);
            await guild.leave();
            return;
        }
    }

    // --- Thank the user who invited the bot ---
    try {
        // Find who added the bot via audit logs
        let inviterUser = null;
        try {
            const auditLogs = await guild.fetchAuditLogs({ type: 28, limit: 5 }); // BotAdd
            const addEntry = auditLogs.entries.find(e => e.target?.id === client.user.id);
            if (addEntry) {
                inviterUser = addEntry.executor;
            }
        } catch (e) {
            // No audit log perms, try guild owner as fallback
        }

        const botName = client.user.username;
        const prefix = getGuildPrefix(guild.id);
        const totalServers = client.guilds.cache.size;
        const totalMembers = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);

        // 1. DM the inviter
        if (inviterUser) {
            try {
                const dmContainer = new ContainerBuilder()
                    ;

                let dmContent = `# <:Checkedbox:1521227734943269077> Thank You for Inviting ${botName}!\n\n`;
                dmContent += `Hey **${inviterUser.username}**! Thanks for adding me to **${guild.name}**! <:Present:1521228115655917659>\n\n`;
                dmContent += `### <:Fire:1521227907647668374> Quick Start\n`;
                dmContent += `<:Caretright:1521227704953864202> Use \`${prefix}help\` or \`/help\` to see all commands\n`;
                dmContent += `<:Caretright:1521227704953864202> Use \`${prefix}musicpanel\` to create a music panel\n`;
                dmContent += `<:Caretright:1521227704953864202> Use \`/invite-setup\` to configure invite tracking\n`;
                dmContent += `<:Caretright:1521227704953864202> Use \`/welcomer\` to set up welcome messages\n\n`;
                dmContent += `### <:Bookopen:1521227911137595605> Bot Stats\n`;
                dmContent += `<:Caretright:1521227704953864202> **${totalServers}** servers • **${totalMembers.toLocaleString()}** users\n\n`;
                dmContent += `-# Need help? Join our support server! 💜`;

                dmContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(dmContent));

                const { ActionRowBuilder: AR, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');
                const clientId = process.env.CLIENT_ID || client.user.id;
                const supportRow = new AR().addComponents(
                    new BB().setLabel('Support Server').setURL(process.env.SUPPORT_SERVER || 'https://discord.gg/Zs35X7Umak').setStyle(BS.Link).setEmoji('<:Hashtag:1521227771957870604>'),
                    new BB().setLabel('Vote').setURL(`https://top.gg/bot/${clientId}/vote`).setStyle(BS.Link).setEmoji('<:Star:1521227981685526568>')
                );

                await inviterUser.send({ components: [dmContainer, supportRow], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
            } catch (e) {
                // DMs disabled — fine
            }
        }

        // 2. Drop a thank-you message in the server
        try {
            const { ChannelType: CT } = require('discord.js');

            // Find best channel: announcements > system > general > first writable
            let targetChannel = guild.channels.cache.find(ch =>
                ch.type === CT.GuildAnnouncement &&
                ch.permissionsFor(guild.members.me)?.has(['SendMessages', 'ViewChannel'])
            );

            if (!targetChannel && guild.systemChannel) {
                const perms = guild.systemChannel.permissionsFor(guild.members.me);
                if (perms?.has(['SendMessages', 'ViewChannel'])) {
                    targetChannel = guild.systemChannel;
                }
            }

            if (!targetChannel) {
                targetChannel = guild.channels.cache.find(ch =>
                    ch.type === CT.GuildText &&
                    /^(general|chat|main|lobby|welcome)$/i.test(ch.name) &&
                    ch.permissionsFor(guild.members.me)?.has(['SendMessages', 'ViewChannel'])
                );
            }

            if (!targetChannel) {
                targetChannel = guild.channels.cache.find(ch =>
                    ch.type === CT.GuildText &&
                    ch.permissionsFor(guild.members.me)?.has(['SendMessages', 'ViewChannel'])
                );
            }

            if (targetChannel) {
                const welcomeContainer = new ContainerBuilder()
                    ;

                let wcContent = `# <:Lightningalt:1521227851796447472> ${botName} has arrived!\n\n`;
                wcContent += `Thanks for adding me to **${guild.name}**! <:Present:1521228115655917659>\n\n`;
                wcContent += `### <:Fire:1521227907647668374> What I Can Do\n`;
                wcContent += `<:Music:1521228141543165982> **Music** — YouTube, Spotify, SoundCloud & more\n`;
                wcContent += `<:Shield:1521227694677692467> **Moderation** — AutoMod, Anti-Nuke, Anti-Raid\n`;
                wcContent += `<:Lightning:1521227915537285150> **Leveling** — XP system with rank cards\n`;
                wcContent += `<:Money:1521228266957045900> **Economy** — Currency, shop, games\n`;
                wcContent += `<:banhammer:1521227777083314529> **Utility** — Tickets, giveaways, builders\n\n`;
                wcContent += `### <:Settings:1521227767780343879> Get Started\n`;
                wcContent += `Use \`${prefix}help\` or \`/help\` to explore all commands!\n\n`;
                if (inviterUser) {
                    wcContent += `-# Added by ${inviterUser.username} • ${botName} </>`;
                } else {
                    wcContent += `-# ${botName} </>`;
                }

                welcomeContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(wcContent));

                await targetChannel.send({ components: [welcomeContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
            }
        } catch (e) {
            // Non-critical
        }
    } catch (e) {
        log.error(`Failed to send thank-you for ${guild.name}: ${e.message}`);
    }

    // ── Webhook notification: Bot joined a server ──
    try {
        const GUILD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1485129013197275166/wabz1wW6nsBMNEfLs_d0njuq1LOf5pipNxqj07UjBpJYrmv1uhyaCoEcpP42yYkBtRdf';
        const totalServersNow = client.guilds.cache.size;
        const totalMembersNow = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
        const owner = await guild.fetchOwner().catch(() => null);
        const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);

        // Try to generate a server invite link
        let serverInvite = 'No invite permission';
        try {
            const inviteChannel = guild.systemChannel ||
                guild.channels.cache.find(ch => ch.type === ChannelType.GuildText && ch.permissionsFor(guild.members.me)?.has('CreateInstantInvite'));
            if (inviteChannel) {
                const invite = await inviteChannel.createInvite({ maxAge: 0, maxUses: 0, unique: false }).catch(() => null);
                if (invite) serverInvite = invite.url;
            }
        } catch (e) { }

        const joinEmbed = {
            title: '📥  Joined a New Server',
            color: 0x57F287,
            thumbnail: { url: guild.iconURL({ dynamic: true, size: 512 }) || '' },
            fields: [
                { name: '🏷️ Server Name', value: `\`${guild.name}\``, inline: true },
                { name: '🆔 Server ID', value: `\`${guild.id}\``, inline: true },
                { name: '👑 Owner', value: owner ? `${owner.user.tag} (\`${owner.id}\`)` : 'Unknown', inline: false },
                { name: '👥 Members', value: `\`${guild.memberCount.toLocaleString()}\``, inline: true },
                { name: '💬 Channels', value: `\`${guild.channels.cache.size}\``, inline: true },
                { name: '🎭 Roles', value: `\`${guild.roles.cache.size}\``, inline: true },
                { name: '📅 Server Created', value: `<t:${createdTimestamp}:R>`, inline: true },
                { name: '🔢 Boost Level', value: `\`Level ${guild.premiumTier}\` (${guild.premiumSubscriptionCount || 0} boosts)`, inline: true },
                { name: '🔗 Server Invite', value: serverInvite !== 'No invite permission' ? `[Click to Join](${serverInvite})` : '`No invite permission`', inline: false },
            ],
            footer: { text: `Total Servers: ${totalServersNow} • Total Users: ${totalMembersNow.toLocaleString()}` },
            timestamp: new Date().toISOString()
        };

        await fetch(GUILD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: client.user.username,
                avatar_url: client.user.displayAvatarURL({ size: 256 }),
                embeds: [joinEmbed]
            })
        }).catch(err => log.error(`Guild join webhook failed: ${err.message}`));
    } catch (e) {
        log.error(`Guild join webhook error: ${e.message}`);
    }
});

// ── Guild Delete (Bot removed/left a server) ──
client.on('guildDelete', async (guild) => {
    log.info(`Left guild: ${guild.name} (${guild.id})`);
    // Cache has already removed the guild at guildDelete time, so this
    // publishes the post-leave list for the dashboard.
    syncBotGuildsList();

    try {
        const GUILD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1485129013197275166/wabz1wW6nsBMNEfLs_d0njuq1LOf5pipNxqj07UjBpJYrmv1uhyaCoEcpP42yYkBtRdf';
        const totalServersNow = client.guilds.cache.size;
        const totalMembersNow = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
        const createdTimestamp = Math.floor(guild.createdTimestamp / 1000);

        const leaveEmbed = {
            title: '📤  Left a Server',
            color: 0xED4245,
            thumbnail: { url: guild.iconURL({ dynamic: true, size: 512 }) || '' },
            fields: [
                { name: '🏷️ Server Name', value: `\`${guild.name}\``, inline: true },
                { name: '🆔 Server ID', value: `\`${guild.id}\``, inline: true },
                { name: '👥 Members', value: `\`${guild.memberCount?.toLocaleString() || 'N/A'}\``, inline: true },
                { name: '📅 Server Created', value: `<t:${createdTimestamp}:R>`, inline: true },
                { name: '🔢 Boost Level', value: `\`Level ${guild.premiumTier || 0}\` (${guild.premiumSubscriptionCount || 0} boosts)`, inline: true },
            ],
            footer: { text: `Total Servers: ${totalServersNow} • Total Users: ${totalMembersNow.toLocaleString()}` },
            timestamp: new Date().toISOString()
        };

        await fetch(GUILD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username: client.user.username,
                avatar_url: client.user.displayAvatarURL({ size: 256 }),
                embeds: [leaveEmbed]
            })
        }).catch(err => log.error(`Guild leave webhook failed: ${err.message}`));
    } catch (e) {
        log.error(`Guild leave webhook error: ${e.message}`);
    }
});

client.on('messageDelete', async (message) => {
    await logMessageDelete(message);

    const snipeCommand = client.commands.get('snipe');
    if (snipeCommand && snipeCommand.saveDeletedMessage) {
        snipeCommand.saveDeletedMessage(message);
    }


    // ═══════════════════════════════════════════════════════════════════
    //  COUNTING GAME — DELETE ANTI-CHEAT
    //
    //  If the most-recent valid count is deleted, the game does NOT reset.
    //  The bot re-posts that number officially so the chain stays intact,
    //  then warns the channel. The cheater is kept as lastUserId so they
    //  can't immediately count the next number after cheating.
    // ═══════════════════════════════════════════════════════════════════
    if (message.guild && message.author && !message.author.bot) {
        try {
            const { db } = require('./utils/database');
            const countingData = await db.get(`counting_${message.guild.id}`);

            if (countingData && message.channel.id === countingData.channelId
                && countingData.lastMessageId === message.id) {

                const deletedNumber = countingData.currentCount;
                const deleterId = message.author.id;
                const deleterTag = message.author.tag || message.author.username;

                // ── Re-post the deleted number so the chain is unbroken ──
                const repostedMsg = await message.channel.send(
                    `**${deletedNumber}** ✅ *(restored after deletion)*`
                ).catch(() => null);

                if (repostedMsg) {
                    await repostedMsg.react('<:Checkedbox:1521227734943269077>').catch(() => { });
                }

                // ── Update state: count stays the same, track new message ──
                countingData.lastMessageId = repostedMsg?.id ?? null;
                // Keep lastUserId as the cheater so they can't immediately
                // count the next number too.
                countingData.lastUserId = deleterId;
                countingData.anticheatWarnings = (countingData.anticheatWarnings || 0) + 1;
                await db.set(`counting_${message.guild.id}`, countingData);

                // ── Warn the channel ──
                const warnContainer = new ContainerBuilder()
                    .setAccentColor(0xFEE75C)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `## ⚠️ Anti-Cheat: Number Deleted\n` +
                            `<@${deleterId}> (\`${deleterTag}\`) deleted their count **${deletedNumber}**.\n\n` +
                            `The number has been **restored** — the game continues from **${deletedNumber + 1}**.\n` +
                            `-# <@${deleterId}> cannot count the next number.`
                        )
                    );

                await message.channel.send({
                    components: [warnContainer],
                    flags: MessageFlags.IsComponentsV2
                }).catch(() => { });
            }
        } catch (e) {
            // Silently handle errors
        }
    }
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
    await logMessageUpdate(oldMessage, newMessage);

    // Pin / Unpin detection
    try {
        if (oldMessage && newMessage && oldMessage.pinned !== newMessage.pinned) {
            const { logMessagePinChange } = require('./utils/logger');
            await logMessagePinChange(newMessage, !!newMessage.pinned);
        }
    } catch (e) {
        log.debug('logMessagePinChange: ' + e.message);
    }

    // ═══════════════════════════════════════════════════════════════════
    //  COUNTING GAME — EDIT ANTI-CHEAT
    //
    //  If someone edits their valid counting message to a different number
    //  (or any non-number text), the bot deletes the tampered message,
    //  re-posts the correct number, and warns the channel. Count stays intact.
    // ═══════════════════════════════════════════════════════════════════
    if (newMessage.guild && newMessage.author && !newMessage.author.bot
        && oldMessage.content !== newMessage.content) {
        try {
            const { db } = require('./utils/database');
            const countingData = await db.get(`counting_${newMessage.guild.id}`);

            if (countingData && newMessage.channel.id === countingData.channelId
                && countingData.lastMessageId === newMessage.id) {

                const correctNumber = countingData.currentCount;
                const newContent = newMessage.content?.trim();
                const editedToNum = parseInt(newContent);
                const isStillCorrect = !isNaN(editedToNum)
                    && newContent === editedToNum.toString()
                    && editedToNum === correctNumber;

                if (!isStillCorrect) {
                    const editorId = newMessage.author.id;
                    const editorTag = newMessage.author.tag || newMessage.author.username;

                    // Delete the tampered message
                    await newMessage.delete().catch(() => { });

                    // Re-post the correct number officially
                    const repostedMsg = await newMessage.channel.send(
                        `**${correctNumber}** ✅ *(restored after edit)*`
                    ).catch(() => null);

                    if (repostedMsg) {
                        await repostedMsg.react('<:Checkedbox:1521227734943269077>').catch(() => { });
                    }

                    // Update state — count unchanged, track new message
                    countingData.lastMessageId = repostedMsg?.id ?? null;
                    countingData.lastUserId = editorId;  // cheater can't count next
                    countingData.anticheatWarnings = (countingData.anticheatWarnings || 0) + 1;
                    await db.set(`counting_${newMessage.guild.id}`, countingData);

                    // Warn the channel
                    const warnContainer = new ContainerBuilder()
                        .setAccentColor(0xFEE75C)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `## ⚠️ Anti-Cheat: Number Edited\n` +
                                `<@${editorId}> (\`${editorTag}\`) edited their count **${correctNumber}**.\n\n` +
                                `The number has been **restored** — the game continues from **${correctNumber + 1}**.\n` +
                                `-# <@${editorId}> cannot count the next number.`
                            )
                        );

                    await newMessage.channel.send({
                        components: [warnContainer],
                        flags: MessageFlags.IsComponentsV2
                    }).catch(() => { });
                }
            }
        } catch (e) {
            // Silently handle errors
        }
    }



    const editsnipeCommand = client.commands.get('editsnipe');
    if (editsnipeCommand && editsnipeCommand.saveEditedMessage) {
        editsnipeCommand.saveEditedMessage(oldMessage, newMessage);
    }

    // AutoMod check on edited messages — users can bypass filters by editing
    if (!newMessage.author?.bot && newMessage.guild && newMessage.content) {
        const automodConfig = automodCache.get(newMessage.guild.id);
        if (automodConfig?.enabled) {
            const isIgnored = automodConfig.ignoredRoles?.some(roleId => newMessage.member?.roles.cache.has(roleId)) ||
                automodConfig.ignoredChannels?.includes(newMessage.channel.id) ||
                newMessage.member?.permissions.has('Administrator') ||
                (automodConfig.bypassRoleId && newMessage.member?.roles.cache.has(automodConfig.bypassRoleId));

            if (!isIgnored) {
                const content = newMessage.content;
                const contentLower = content.toLowerCase();
                const violations = [];

                // Bad words check
                if (automodConfig.badWords?.enabled && automodConfig.badWords.words?.length > 0) {
                    for (const word of automodConfig.badWords.words) {
                        const wordLower = word.toLowerCase().trim();
                        if (!wordLower) continue;
                        try {
                            const escaped = wordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const regex = new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?:[^a-zA-Z0-9]|$)`, 'i');
                            if (regex.test(contentLower) || contentLower === wordLower) {
                                violations.push({ filter: 'badWords', action: automodConfig.badWords.action || 'delete', reason: `Bad word detected (edited)` });
                                break;
                            }
                        } catch (e) {
                            if (contentLower.includes(wordLower)) {
                                violations.push({ filter: 'badWords', action: automodConfig.badWords.action || 'delete', reason: `Bad word detected (edited)` });
                                break;
                            }
                        }
                    }
                }

                // Links check
                if (automodConfig.links?.enabled) {
                    const urlRegex = /https?:\/\/[^\s<]+|www\.[^\s<]+|[a-zA-Z0-9][-a-zA-Z0-9]*\.(com|net|org|io|gg|tv|me|co|xyz|info|online|site|tech|dev|app|live|pro|cc|ru|cn|tk|ml|ga|cf|gq|pw|top|club|vip|ws|link|click|download|stream|fun|icu|buzz|monster|rest|hair|sbs|cfd)(?:[\/\?#][^\s]*)?/gi;
                    const urls = content.match(urlRegex);
                    if (urls && urls.length > 0) {
                        const whitelist = automodConfig.links.whitelist || [];
                        let hasBlockedLink = whitelist.length === 0;
                        if (!hasBlockedLink) {
                            for (const url of urls) {
                                const urlLower = url.toLowerCase();
                                if (!whitelist.some(d => urlLower.includes(d.toLowerCase().trim()))) { hasBlockedLink = true; break; }
                            }
                        }
                        if (hasBlockedLink) violations.push({ filter: 'links', action: automodConfig.links.action || 'delete', reason: 'Unauthorized link (edited)' });
                    }
                }

                // Invites check
                if (automodConfig.invites?.enabled) {
                    const inviteRegex = /(discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg|invite\.gg|discord\.me)\/[a-zA-Z0-9-]+/gi;
                    if (inviteRegex.test(content)) {
                        violations.push({ filter: 'invites', action: automodConfig.invites.action || 'delete', reason: 'Discord invite (edited)' });
                    }
                }

                // Mass mention check
                if (automodConfig.massMention?.enabled) {
                    const totalMentions = newMessage.mentions.users.size + newMessage.mentions.roles.size + (newMessage.mentions.everyone ? 1 : 0);
                    if (totalMentions >= (automodConfig.massMention.limit || 5)) {
                        violations.push({ filter: 'massMention', action: automodConfig.massMention.action || 'delete', reason: `Mass mention (${totalMentions} mentions, edited)` });
                    }
                }

                // Caps check
                if (automodConfig.caps?.enabled) {
                    const letters = content.replace(/[^a-zA-Z]/g, '');
                    if (letters.length >= (automodConfig.caps.minLength || 10)) {
                        const upperCount = (content.match(/[A-Z]/g) || []).length;
                        const ratio = (upperCount / letters.length) * 100;
                        if (ratio >= (automodConfig.caps.percentage || 70)) {
                            violations.push({ filter: 'caps', action: automodConfig.caps.action || 'delete', reason: `Excessive caps ${Math.round(ratio)}% (edited)` });
                        }
                    }
                }

                if (violations.length > 0) {
                    const severityOrder = { 'warn': 0, 'delete': 1, 'timeout': 2, 'kick': 3, 'ban': 4 };
                    violations.sort((a, b) => (severityOrder[b.action] || 0) - (severityOrder[a.action] || 0));
                    const action = violations[0].action;
                    const allReasons = violations.map(v => v.reason).join(' | ');

                    const savedContent = content.substring(0, 1000);
                    const savedAuthorTag = newMessage.author.username;
                    const savedAuthorId = newMessage.author.id;
                    const savedChannel = newMessage.channel;
                    const savedMember = newMessage.member;
                    const savedGuild = newMessage.guild;

                    try {
                        if (action === 'delete' || action === 'timeout' || action === 'kick' || action === 'ban') {
                            await safeDeleteMessage(newMessage, `automod:edit:${action}:${violations.map(v => v.filter).join(',')}`);
                        }

                        if (action === 'warn') {
                            const warnMsg = await savedChannel.send(`<:Infotriangle:1521227710381428926> <@${savedAuthorId}>, your edited message was flagged. Reason: ${allReasons}`).catch(() => null);
                            if (warnMsg) setTimeout(() => warnMsg.delete().catch(() => { }), 8000);
                        } else if (action === 'delete') {
                            const delMsg = await savedChannel.send(`<:Shield:1521227694677692467> <@${savedAuthorId}>, your edited message was removed. Reason: ${allReasons}`).catch(() => null);
                            if (delMsg) setTimeout(() => delMsg.delete().catch(() => { }), 5000);
                        } else if (action === 'timeout' && savedMember) {
                            await savedMember.timeout(5 * 60 * 1000, allReasons).catch(e => log.error('AutoMod edit timeout: ' + e.message));
                            const msg = await savedChannel.send(`<:Shield:1521227694677692467> <@${savedAuthorId}> timed out (5 min). Reason: ${allReasons}`).catch(() => null);
                            if (msg) setTimeout(() => msg.delete().catch(() => { }), 10000);
                        } else if (action === 'kick' && savedMember) {
                            await savedMember.kick(allReasons).catch(e => log.error('AutoMod edit kick: ' + e.message));
                            await savedChannel.send(`<:Shield:1521227694677692467> **${savedAuthorTag}** kicked by AutoMod. Reason: ${allReasons}`).catch(() => { });
                        } else if (action === 'ban' && savedMember) {
                            await savedMember.ban({ reason: allReasons, deleteMessageSeconds: 60 }).catch(e => log.error('AutoMod edit ban: ' + e.message));
                            await savedChannel.send(`<:Shield:1521227694677692467> **${savedAuthorTag}** banned by AutoMod. Reason: ${allReasons}`).catch(() => { });
                        }

                        if (automodConfig.logChannel) {
                            const logCh = savedGuild.channels.cache.get(automodConfig.logChannel);
                            if (logCh) {
                                const violationList = violations.map(v => `• **${v.filter}** — ${v.reason}`).join('\n');
                                const logContainer = new ContainerBuilder()
                                    .setAccentColor(action === 'ban' ? 0xFF0000 : action === 'kick' ? 0xFF6600 : action === 'timeout' ? 0xFFA500 : 0xFFCC00)
                                    .addTextDisplayComponents(
                                        new TextDisplayBuilder()
                                            .setContent(
                                                `# <:Shield:1521227694677692467> AutoMod Action (Edited Message)\n\n` +
                                                `**User:** ${savedAuthorTag} (<@${savedAuthorId}>)\n` +
                                                `**Channel:** <#${savedChannel.id}>\n` +
                                                `**Action:** \`${action.toUpperCase()}\`\n\n` +
                                                `### Violations\n${violationList}\n\n` +
                                                `### Message Content\n\`\`\`\n${savedContent.substring(0, 500)}${savedContent.length > 500 ? '...' : ''}\n\`\`\`\n` +
                                                `-# <t:${Math.floor(Date.now() / 1000)}:R>`
                                            )
                                    );
                                await logCh.send({ components: [logContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
                            }
                        }
                    } catch (error) {
                        log.error(`AutoMod edit error (${action}): ${error.message}`);
                    }
                }
            }
        }
    }
});

client.on('messageDeleteBulk', async (messages, channel) => {
    await logMessageBulkDelete(messages, channel);
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    await logMemberUpdate(oldMember, newMember);

    // Booster Notification System
    try {
        const wasBoosting = oldMember.premiumSince !== null;
        const isBoosting = newMember.premiumSince !== null;

        if (!wasBoosting && isBoosting) {
            // New boost!
            const boosterNotify = require('./commands/automation/booster-notify');
            const config = boosterNotify.loadConfig();
            const guildConfig = config[newMember.guild.id];

            if (guildConfig?.enabled && guildConfig?.channel) {
                const channel = newMember.guild.channels.cache.get(guildConfig.channel);
                if (channel) {
                    if (guildConfig.boostMessage.embed) {
                        const embed = boosterNotify.createBoostEmbed(guildConfig, newMember, newMember.guild);
                        await channel.send({ embeds: [embed] }).catch(() => { });
                    } else {
                        const content = boosterNotify.formatMessage(guildConfig.boostMessage.content, newMember, newMember.guild);
                        await channel.send({ content }).catch(() => { });
                    }
                }

                // DM Thank You
                if (guildConfig.dmThankYou?.enabled && guildConfig.dmThankYou?.message) {
                    const dmContent = boosterNotify.formatMessage(guildConfig.dmThankYou.message, newMember, newMember.guild);
                    await newMember.user.send({ content: dmContent }).catch(() => { });
                }
            }
        } else if (wasBoosting && !isBoosting) {
            // Stopped boosting
            const boosterNotify = require('./commands/automation/booster-notify');
            const config = boosterNotify.loadConfig();
            const guildConfig = config[newMember.guild.id];

            if (guildConfig?.enabled && guildConfig?.unboostMessage?.enabled) {
                const channel = newMember.guild.channels.cache.get(guildConfig.unboostMessage.channel || guildConfig.channel);
                if (channel) {
                    const content = boosterNotify.formatMessage(guildConfig.unboostMessage.content || '💔 {user} is no longer boosting the server.', newMember, newMember.guild);
                    await channel.send({ content }).catch(() => { });
                }
            }
        }
    } catch (error) {
        log.error(`Booster Notify: ${error.message}`);
    }

    // Update stats when boost status or member count changes
    try { await updateServerStats(newMember.guild); } catch { }

    // --- Server Tag System ---
    try {
        const oldName = (oldMember.nickname || oldMember.user.displayName || oldMember.user.username).toLowerCase();
        const newName = (newMember.nickname || newMember.user.displayName || newMember.user.username).toLowerCase();
        if (oldName !== newName) {
            const tagConfigPath = path.join(__dirname, 'datas', 'servertag.json');
            if (jsonStore.has('servertag')) {
                const tagConfig = jsonStore.peek('servertag') || {};
                const guildTagConfig = tagConfig[newMember.guild.id];
                if (guildTagConfig?.enabled && guildTagConfig?.roleId) {
                    const tag = guildTagConfig.tag.toLowerCase();
                    const hadTag = oldName.includes(tag);
                    const hasTag = newName.includes(tag);
                    const role = newMember.guild.roles.cache.get(guildTagConfig.roleId);
                    if (role) {
                        if (!hadTag && hasTag && !newMember.roles.cache.has(role.id)) {
                            await newMember.roles.add(role).catch(() => { });

                            // Track & reward
                            try {
                                const servertagModule = require('./commands/admin/servertag');
                                const tagUserData = servertagModule.trackTagEquip(newMember.guild.id, newMember.id);

                                // Give coin/XP rewards (one-time)
                                if (!tagUserData.rewarded && (guildTagConfig.coinReward > 0 || guildTagConfig.xpReward > 0)) {
                                    const economyManager = require('./utils/economyManager');
                                    const economy = economyManager.loadEconomy();
                                    const { userData } = economyManager.getUser(economy, newMember.id);
                                    let rewardText = '';
                                    if (guildTagConfig.coinReward > 0) {
                                        userData.coins = (userData.coins || 0) + guildTagConfig.coinReward;
                                        rewardText += `**+${guildTagConfig.coinReward.toLocaleString()}** coins`;
                                    }
                                    if (guildTagConfig.xpReward > 0) {
                                        economyManager.addXP(economy, newMember.id, guildTagConfig.xpReward);
                                        rewardText += `${rewardText ? ' & ' : ''}**+${guildTagConfig.xpReward}** XP`;
                                    }
                                    economyManager.saveEconomy(economy);

                                    // Mark as rewarded
                                    const users = servertagModule.loadTagUsers();
                                    if (users[newMember.guild.id]?.[newMember.id]) {
                                        users[newMember.guild.id][newMember.id].rewarded = true;
                                        servertagModule.saveTagUsers(users);
                                    }

                                    // DM notification
                                    if (guildTagConfig.dmNotify !== false) {
                                        const dmContent = `# 🎉 Server Tag Equipped!\n\n` +
                                            `Thanks for repping **${newMember.guild.name}** with the tag **${guildTagConfig.tag}**!\n\n` +
                                            `### Your Rewards\n` +
                                            `> **Role:** ${role.name}\n` +
                                            (rewardText ? `> **Bonus:** ${rewardText}\n` : '') +
                                            `\n-# Keep the tag to keep your rewards!`;
                                        await newMember.user.send({ content: dmContent }).catch(() => { });
                                    }

                                    // Channel announcement
                                    if (guildTagConfig.notifyChannel) {
                                        const notifChannel = newMember.guild.channels.cache.get(guildTagConfig.notifyChannel);
                                        if (notifChannel) {
                                            await notifChannel.send({
                                                content: `🏷️ ${newMember} equipped the server tag **${guildTagConfig.tag}** and received ${rewardText}!`
                                            }).catch(() => { });
                                        }
                                    }
                                } else {
                                    // No economy rewards, but still notify
                                    if (guildTagConfig.dmNotify !== false) {
                                        const dmContent = `# 🎉 Server Tag Equipped!\n\n` +
                                            `Thanks for repping **${newMember.guild.name}** with the tag **${guildTagConfig.tag}**!\n\n` +
                                            `> **Role:** ${role.name} has been given to you!` +
                                            `\n\n-# Keep the tag to keep your role!`;
                                        await newMember.user.send({ content: dmContent }).catch(() => { });
                                    }
                                    if (guildTagConfig.notifyChannel) {
                                        const notifChannel = newMember.guild.channels.cache.get(guildTagConfig.notifyChannel);
                                        if (notifChannel) {
                                            await notifChannel.send({
                                                content: `🏷️ ${newMember} equipped the server tag **${guildTagConfig.tag}**!`
                                            }).catch(() => { });
                                        }
                                    }
                                }
                            } catch (e) { log.error(`Server Tag Reward: ${e.message}`); }

                        } else if (hadTag && !hasTag && newMember.roles.cache.has(role.id)) {
                            await newMember.roles.remove(role).catch(() => { });

                            // Track unequip
                            try {
                                const servertagModule = require('./commands/admin/servertag');
                                servertagModule.trackTagUnequip(newMember.guild.id, newMember.id);

                                if (guildTagConfig.notifyChannel) {
                                    const notifChannel = newMember.guild.channels.cache.get(guildTagConfig.notifyChannel);
                                    if (notifChannel) {
                                        await notifChannel.send({
                                            content: `🏷️ ${newMember} removed the server tag **${guildTagConfig.tag}** — role has been revoked.`
                                        }).catch(() => { });
                                    }
                                }
                            } catch (e) { log.error(`Server Tag Unequip: ${e.message}`); }
                        }
                    }
                }
            }
        }
    } catch (error) {
        log.error(`Server Tag: ${error.message}`);
    }
});

// ── Voice XP ────────────────────────────────────────────────────────────────
// Awards leveling XP for time spent in voice channels. Configurable via
// /leveling-setup (enabled by DEFAULT — only an explicit `voiceXp === false`
// disables it). Writes to the same `leveling` jsonStore + level formula as the
// message-XP system so both feed one combined XP/level total.
async function awardVoiceXp(guild, member, channelId, durationSeconds) {
    try {
        if (!guild || !member || member.user?.bot) return;
        const guildId = guild.id;

        // Leveling must be enabled for the guild (same gate as message XP).
        const toggleGuild = jsonStore.peekGuild('levelingtoggle', guildId) || null;
        if (toggleGuild?.enabled !== true) return;

        const guildConfig = await getGuildConfigDb(guildId);
        const levelingConfig = guildConfig?.leveling || {};

        // Voice XP is ON by default; only an explicit false turns it off.
        if (levelingConfig.voiceXp === false) return;

        // Skip the AFK channel + excluded channels/roles.
        if (channelId && guild.afkChannelId && channelId === guild.afkChannelId) return;
        const ignoreChannels = levelingConfig.ignoreChannels || [];
        if (channelId && ignoreChannels.includes(channelId)) return;
        const ignoreRoles = levelingConfig.ignoreRoles || [];
        if (ignoreRoles.length && member.roles.cache.some(r => ignoreRoles.includes(r.id))) return;

        const minutes = Math.floor((Number(durationSeconds) || 0) / 60);
        if (minutes < 1) return;

        // XP per minute (default 10), times the same multipliers message XP uses.
        const rate = Number(levelingConfig.voiceXpRate) > 0 ? Number(levelingConfig.voiceXpRate) : 10;
        let multiplier = levelingConfig.multiplier || 1;
        try {
            const guildMultipliers = jsonStore.peekGuild('levelmultiplier', guildId) || {};
            for (const [roleId, mult] of Object.entries(guildMultipliers)) {
                if (member.roles.cache.has(roleId) && mult > multiplier) multiplier = mult;
            }
        } catch { }

        const xpGain = Math.floor(minutes * rate * multiplier);
        if (xpGain < 1) return;

        let leveling = jsonStore.has('leveling') ? jsonStore.read('leveling') : {};
        if (!leveling[guildId]) leveling[guildId] = {};
        if (!leveling[guildId][member.id]) leveling[guildId][member.id] = { xp: 0, level: 0, lastXpGain: 0, messages: 0 };
        const userData = leveling[guildId][member.id];

        const beforeXp = userData.xp || 0;
        userData.xp = beforeXp + xpGain;
        const oldLevel = Math.floor(0.1 * Math.sqrt(beforeXp));
        const newLevel = Math.floor(0.1 * Math.sqrt(userData.xp));
        userData.level = newLevel;

        jsonStore.write('leveling', leveling);

        if (newLevel <= oldLevel) return;

        // ── Level up: apply role rewards (same logic as message XP) ──
        let rolesConfig = levelingConfig.roles;
        if (!Array.isArray(rolesConfig) || rolesConfig.length === 0) {
            try {
                const fileRoles = jsonStore.peekGuild('levelroles', guildId);
                if (Array.isArray(fileRoles) && fileRoles.length > 0) rolesConfig = fileRoles;
            } catch { }
        }
        if (Array.isArray(rolesConfig) && rolesConfig.length > 0) {
            const eligible = rolesConfig.filter(r => newLevel >= r.level);
            if (eligible.length > 0) {
                try {
                    if (levelingConfig.stackRoles) {
                        await member.roles.add(eligible.map(r => r.roleId)).catch(() => { });
                    } else {
                        const highest = [...eligible].sort((a, b) => b.level - a.level)[0];
                        const remove = rolesConfig.filter(r => r.roleId !== highest.roleId).map(r => r.roleId);
                        await member.roles.remove(remove).catch(() => { });
                        await member.roles.add(highest.roleId).catch(() => { });
                    }
                } catch { }
            }
        }

        // ── Announcement (only when a channel is configured — voice has no
        // message context, so we never spam a fallback channel) ──
        const announceConfig = levelingConfig.announcements || {};
        if (announceConfig.enabled === false) return;

        let announceChannel = null;
        if (announceConfig.channel === 'dm') {
            announceChannel = member.user;
        } else if (announceConfig.channel === 'custom' && announceConfig.customChannelId) {
            announceChannel = guild.channels.cache.get(announceConfig.customChannelId) || null;
        } else if (levelingConfig.announcementChannel) {
            announceChannel = guild.channels.cache.get(levelingConfig.announcementChannel) || null;
        } else {
            try {
                const lcGuild = jsonStore.peekGuild('levelchannel', guildId);
                if (lcGuild) announceChannel = guild.channels.cache.get(lcGuild) || null;
            } catch { }
        }
        if (!announceChannel) return;

        try {
            const { generateLevelUpCard } = require('./utils/levelUpCard');
            const { AttachmentBuilder } = require('discord.js');

            const sorted = Object.entries(leveling[guildId] || {})
                .map(([uid, d]) => ({ uid, xp: d.xp }))
                .sort((a, b) => b.xp - a.xp);
            const userRank = sorted.findIndex(u => u.uid === member.id) + 1;

            // Apply the SAME custom message template as the message-XP path so
            // voice level-ups and chat level-ups look identical.
            const lvlMode = announceConfig.messageMode === 'inside' ? 'inside' : 'outside';
            const lvlTpl = (announceConfig.message && announceConfig.message.trim()) ? announceConfig.message : null;
            const fillLvlTpl = (uVal) => lvlTpl
                ? lvlTpl
                    .replace(/{user}/g, uVal)
                    .replace(/{level}/g, String(newLevel))
                    .replace(/{oldlevel}/g, String(oldLevel))
                    .replace(/{xp}/g, userData.xp.toLocaleString())
                    .replace(/{rank}/g, String(userRank))
                    .replace(/{xpgain}/g, String(xpGain))
                    .replace(/{server}/g, guild.name)
                : null;
            const insideLine = (lvlMode === 'inside' && lvlTpl)
                ? fillLvlTpl(member.user.globalName || member.user.username)
                : null;

            const cardBuffer = await generateLevelUpCard(member.user, {
                oldLevel, newLevel, totalXp: userData.xp, rank: userRank, xpGain,
                style: announceConfig.cardStyle || 'default',
                customLine: insideLine,
            });

            let announceContent = `${member}`;
            if (lvlMode === 'outside' && lvlTpl) {
                const filled = fillLvlTpl(member.toString());
                if (filled) announceContent = filled;
            }

            const attachment = new AttachmentBuilder(cardBuffer, { name: 'level-up.png' });
            await announceChannel.send({
                content: announceContent,
                files: [attachment],
                allowedMentions: { users: [member.id] }
            }).catch(() => { });
        } catch { }
    } catch (e) {
        // Never let XP accounting break voice tracking.
    }
}

client.on('voiceStateUpdate', async (oldState, newState) => {
    await logVoiceStateUpdate(oldState, newState);
    await handleJoin2Create(oldState, newState);

    // Update server stats channels (in voice count)
    const guild = newState.guild || oldState.guild;
    if (guild) { try { await updateServerStats(guild); } catch { } }

    // ── Re-apply persistent voice channel statuses ──
    // When a channel becomes empty, Discord clears the status after a
    // few seconds. We detect "user left" and if the channel is now
    // empty, schedule a re-apply after 5s (gives Discord time to clear).
    if (oldState.channelId && (!newState.channelId || newState.channelId !== oldState.channelId)) {
        const leftChannel = oldState.guild.channels.cache.get(oldState.channelId);
        if (leftChannel && leftChannel.members.filter(m => !m.user.bot).size === 0) {
            setTimeout(async () => {
                try {
                    const { reapplyPersistentStatus } = require('./commands/voice/vcstatus');
                    await reapplyPersistentStatus(client, oldState.channelId);
                } catch { }
            }, 6000); // 6s delay — Discord clears status ~3-5s after last user leaves
        }
    }

    // --- Bot alone in voice channel detection ---
    // When a user leaves a voice channel, check if the bot is now alone
    try {
        const voiceGuild = oldState.guild;
        if (voiceGuild && oldState.channelId && oldState.member?.id !== client.user.id) {
            const player = client.lavalinkManager?.getPlayer(voiceGuild.id);
            if (player && player.voiceChannelId === oldState.channelId) {
                const voiceChannel = voiceGuild.channels.cache.get(oldState.channelId);
                if (voiceChannel) {
                    // Count non-bot members in the channel
                    const humanMembers = voiceChannel.members.filter(m => !m.user.bot).size;

                    if (humanMembers === 0) {
                        // Bot is alone - check 24/7 mode.
                        // Strict: 24/7 on ⇒ pause & stay, never disconnect.
                        const is247Enabled = is247On(voiceGuild.id);

                        if (is247Enabled) {
                            // 24/7 mode: Pause if playing, update panel & voice status
                            if (player.playing && !player.paused) {
                                await player.pause();
                                log.info(`Bot alone in VC (24/7): Paused player in guild ${voiceGuild.id}`);
                            }
                            // Update voice status to show paused or waiting
                            await updateVoiceChannelStatus(client, player, player.queue.current ? 'auto' : 'waiting');
                            // Update the music panel
                            await updateMusicPanel(client, player, autoplayStatus).catch(() => { });
                        } else {
                            // Non-24/7: Start a 2-minute disconnect timer
                            if (inactivityTimers.has(voiceGuild.id)) {
                                clearTimeout(inactivityTimers.get(voiceGuild.id));
                            }
                            const guildIdForTimer = voiceGuild.id;
                            const aloneTimer = setTimeout(async () => {
                                inactivityTimers.delete(guildIdForTimer);
                                try {
                                    const currentPlayer = client.lavalinkManager?.getPlayer(guildIdForTimer);
                                    if (currentPlayer) {
                                        // Double-check bot is still alone
                                        const vc = voiceGuild.channels.cache.get(currentPlayer.voiceChannelId);
                                        const stillAlone = vc ? vc.members.filter(m => !m.user.bot).size === 0 : true;
                                        if (stillAlone) {
                                            log.info(`Bot alone disconnect: Destroying player in guild ${guildIdForTimer} after 2 minutes`);
                                            // Clear voice status before destroying (voiceChannelId may be null after destroy)
                                            if (currentPlayer.voiceChannelId) {
                                                await updateVoiceChannelStatus(client, { guildId: guildIdForTimer, voiceChannelId: currentPlayer.voiceChannelId }, 'clear');
                                            }
                                            await currentPlayer.destroy();
                                        }
                                    }
                                } catch (err) {
                                    log.error(`Bot alone disconnect error: ${err.message}`);
                                }
                            }, 2 * 60 * 1000); // 2 minutes
                            inactivityTimers.set(voiceGuild.id, aloneTimer);
                            log.info(`Bot alone timer started for guild ${voiceGuild.id} (2 minutes)`);
                        }
                    } else if (humanMembers > 0) {
                        // Someone is in the channel - always clear the alone timer
                        if (inactivityTimers.has(voiceGuild.id)) {
                            clearTimeout(inactivityTimers.get(voiceGuild.id));
                            inactivityTimers.delete(voiceGuild.id);
                            log.info(`Alone timer cleared for guild ${voiceGuild.id} - user present in channel`);
                        }
                    }
                }
            }
        }

        // When a user joins the bot's voice channel, resume if paused and clear alone timer
        if (newState.channelId && newState.member?.id !== client.user.id) {
            const voiceGuild2 = newState.guild;
            const player2 = client.lavalinkManager?.getPlayer(voiceGuild2.id);
            if (player2 && !player2.destroyed && player2.voiceChannelId === newState.channelId) {
                const voiceChannel2 = voiceGuild2.channels.cache.get(newState.channelId);
                if (voiceChannel2) {
                    const humanMembers2 = voiceChannel2.members.filter(m => !m.user.bot).size;
                    if (humanMembers2 > 0) {
                        // Clear any alone/inactivity timer
                        if (inactivityTimers.has(voiceGuild2.id)) {
                            clearTimeout(inactivityTimers.get(voiceGuild2.id));
                            inactivityTimers.delete(voiceGuild2.id);
                            log.info(`Timer cleared for guild ${voiceGuild2.id} - user joined voice`);
                        }

                        // Resume if player was paused (auto-pause from being alone)
                        if (!player2.destroyed && player2.paused && player2.queue.current) {
                            await player2.resume();
                            log.info(`Auto-resumed player in guild ${voiceGuild2.id} - user joined back`);
                            // Update voice status
                            await updateVoiceChannelStatus(client, player2);
                            await updateMusicPanel(client, player2, autoplayStatus).catch(() => { });
                        }
                    }
                }
            }
        }
    } catch (error) {
        log.error(`Voice alone detection: ${error.message}`);
    }

    // Handle Voice Autorole
    try {
        if (jsonStore.has('voiceautorole')) {
            const config = jsonStore.read('voiceautorole');
            const roleId = config[newState.guild.id];
            const member = newState.member;

            if (roleId && member) {
                const role = newState.guild.roles.cache.get(roleId);
                if (role) {
                    // User joined a voice channel
                    if (!oldState.channelId && newState.channelId) {
                        await member.roles.add(role).catch(() => { });
                    }
                    // User left all voice channels
                    else if (oldState.channelId && !newState.channelId) {
                        await member.roles.remove(role).catch(() => { });
                    }
                }
            }
        }
    } catch (error) {
        log.error(`Voice Autorole: ${error.message}`);
    }

    // Track voice time
    const userId = newState.id;
    const guildId = newState.guild.id;
    const trackingKey = `${guildId}-${userId}`;
    const voiceMember = newState.member || oldState.member;

    try {
        // User joined a voice channel
        if (!oldState.channelId && newState.channelId) {
            voiceJoinTimes.set(trackingKey, Date.now());
        }
        // User left a voice channel
        else if (oldState.channelId && !newState.channelId) {
            const joinTime = voiceJoinTimes.get(trackingKey);
            if (joinTime) {
                const duration = Math.floor((Date.now() - joinTime) / 1000); // duration in seconds

                try {
                    // Use $inc which auto-creates member if needed via incrementGuildMemberField
                    await models.GuildMember.findOneAndUpdate(
                        { guildId, userId },
                        {
                            $inc: {
                                'analytics.voiceTime': duration
                            }
                        }
                    );
                    try { require('./utils/activityTracker').recordVoice(guildId, userId, oldState.channelId, duration); } catch { }
                } finally {
                    voiceJoinTimes.delete(trackingKey);
                }

                // Award leveling XP for this voice session (config-gated, on by default).
                await awardVoiceXp(newState.guild, voiceMember, oldState.channelId, duration).catch(() => { });
            }
        }
        // User switched voice channels
        else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
            const joinTime = voiceJoinTimes.get(trackingKey);
            if (joinTime) {
                const duration = Math.floor((Date.now() - joinTime) / 1000);

                try {
                    // Use $inc which auto-creates member if needed via incrementGuildMemberField
                    await models.GuildMember.findOneAndUpdate(
                        { guildId, userId },
                        {
                            $inc: {
                                'analytics.voiceTime': duration
                            }
                        }
                    );
                    try { require('./utils/activityTracker').recordVoice(guildId, userId, oldState.channelId, duration); } catch { }
                } finally {
                    // Reset join time for new channel
                    voiceJoinTimes.set(trackingKey, Date.now());
                }

                // Award leveling XP for the time spent in the previous channel.
                await awardVoiceXp(newState.guild, voiceMember, oldState.channelId, duration).catch(() => { });
            } else {
                // No previous join time, just start tracking
                voiceJoinTimes.set(trackingKey, Date.now());
            }
        }
    } catch (error) {
        // Ignore voice time tracking errors, but clean up join times
        if (oldState.channelId && !newState.channelId) {
            voiceJoinTimes.delete(trackingKey);
        }
    }
});

client.on('channelCreate', async (channel) => {
    await logChannelCreate(channel);

    if (!channel.guild) return;

    // Update server stats channels
    try { await updateServerStats(channel.guild); } catch { }

    await checkAuditLogAntiNuke(channel.guild, 10, 'channelCreate', channel.id, channel.name);
});

client.on('channelDelete', async (channel) => {
    await logChannelDelete(channel);

    if (!channel.guild) return;

    // Update server stats channels
    try { await updateServerStats(channel.guild); } catch { }

    if (jsonStore.has('musicpanel')) {
        const panelConfig = jsonStore.read('musicpanel');
        const guildPanel = panelConfig[channel.guild.id];

        if (guildPanel && guildPanel.channelId === channel.id) {
            delete panelConfig[channel.guild.id];
            jsonStore.write('musicpanel', panelConfig);
            log.debug(`Removed music panel for channel ${channel.id} in guild ${channel.guild.id}`);
        }
    }

    await checkAuditLogAntiNuke(channel.guild, 12, 'channelDelete', channel.id, channel.name, 5000, channel, 'channel');
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    await logChannelUpdate(oldChannel, newChannel);
    // Update stats if channel type changed (text/voice/category counts)
    if (newChannel.guild && oldChannel.type !== newChannel.type) {
        try { await updateServerStats(newChannel.guild); } catch { }
    }
});

client.on('roleCreate', async (role) => {
    await logRoleCreate(role);

    // Update server stats channels
    try { await updateServerStats(role.guild); } catch { }

    await checkAuditLogAntiNuke(role.guild, 30, 'roleCreate', role.id, role.name);
});

client.on('roleDelete', async (role) => {
    await logRoleDelete(role);

    // Update server stats channels
    try { await updateServerStats(role.guild); } catch { }

    await checkAuditLogAntiNuke(role.guild, 32, 'roleDelete', role.id, role.name, 5000, role, 'role');
});

client.on('guildBanAdd', async ({ guild, user }) => {
    await logBan(guild, user);
    // Ban = member leaves → update member/human/bot counts
    try { await updateServerStats(guild); } catch { }

    await checkAuditLogAntiNuke(guild, 22, 'banProtection', user.id, user.username);
});

client.on('guildBanRemove', async ({ guild, user }) => {
    await logUnban(guild, user);
    // Unban doesn't change member count, but log it for completeness
});

client.on('webhookUpdate', async (channel) => {
    if (!channel.guild) return;
    await logWebhookUpdate(channel);

    // Check all webhook audit types: create(50), update(51), delete(52)
    for (const auditType of [50, 51, 52]) {
        await checkAuditLogAntiNuke(channel.guild, auditType, 'webhookCreate', null, channel.name);
    }
});

// ═══════ User Profile Update (avatar, username, display name, banner) ═══════
client.on('userUpdate', async (oldUser, newUser) => {
    await logUserUpdate(oldUser, newUser, client);
});

// ═══════ Status Roles (custom-status → role) ═══════
// Applies the `statusrole` config written by both the dashboard "Status
// Roles" module and the statusrole command. Requires the GuildPresences
// privileged intent — only registered when ENABLE_PRESENCE_INTENT=true
// (and the portal "Presence Intent" toggle is on). Without it the bot
// starts normally and Status Roles config simply persists without applying.
if (process.env.ENABLE_PRESENCE_INTENT === 'true') {
    client.on('presenceUpdate', async (oldPresence, newPresence) => {
        try {
            const statusRoleHandler = require('./utils/statusRoleHandler');
            await statusRoleHandler.handlePresenceUpdate(oldPresence, newPresence);
        } catch (error) {
            log.error(`Status Role presenceUpdate: ${error.message}`);
        }
    });
}

// ═══════ Guild/Server Settings Update ═══════
client.on('guildUpdate', async (oldGuild, newGuild) => {
    await logGuildUpdate(oldGuild, newGuild);
    // Update stats when boost tier or other server properties change
    try { await updateServerStats(newGuild); } catch { }

    // ── Vanity Guard Enforcement (premium-only) ──
    if (oldGuild.vanityURLCode !== newGuild.vanityURLCode) {
        try {
            // Re-validate server premium — `/vanityguard` is gated by
            // the dispatcher, but the saved config keeps enforcing
            // forever otherwise. If the server lost premium, skip.
            if (!premiumManager.isServerPremium(newGuild.id)) {
                // intentional no-op; vanityguard is inactive on
                // non-premium servers regardless of saved config.
            } else {
                const vgConfig = jsonStore.has('vanityguard') ? (jsonStore.read('vanityguard') || {}) : {};
                const guildVg = vgConfig[newGuild.id];
                if (guildVg?.enabled) {
                    // Audit log type 1 = GUILD_UPDATE. Vanity changes fall under
                    // this type with `changes[].key === 'vanity_url_code'`.
                    let executorId = null;
                    let executor = null;
                    try {
                        const auditLogs = await newGuild.fetchAuditLogs({ type: 1, limit: 6 });
                        const entry = auditLogs.entries.find(e => {
                            if (!e.changes) return false;
                            if (Date.now() - e.createdTimestamp > 15_000) return false;
                            return e.changes.some(c => c.key === 'vanity_url_code');
                        });
                        if (entry) {
                            executorId = entry.executor?.id || null;
                            executor = entry.executor || null;
                        }
                    } catch (auditErr) {
                        log.warning(`[VanityGuard] Could not fetch audit logs in ${newGuild.id}: ${auditErr.message}`);
                    }

                    // Trust check: server owner OR explicit whitelist OR antinuke whitelist
                    const trust = require('./utils/trustManager');
                    let isAllowed = false;
                    if (executorId) {
                        if (trust.isServerOwner(newGuild, executorId)) isAllowed = true;
                        if ((guildVg.whitelistedUsers || []).includes(executorId)) isAllowed = true;
                        // Also honor the antinuke whitelist if present.
                        try {
                            const antinukeData = jsonStore.has('antinuke') ? jsonStore.read('antinuke') : {};
                            const aw = antinukeData?.[newGuild.id]?.whitelist;
                            if (Array.isArray(aw) && aw.includes(executorId)) isAllowed = true;
                        } catch { }
                        // Bot itself is always allowed (e.g. boost-tier downgrade clears vanity)
                        if (executorId === client.user.id) isAllowed = true;
                    }

                    if (!isAllowed) {
                        // Restore the previous vanity. setVanityCode requires the
                        // boost tier to still be 3+; if not, just log and skip.
                        if (newGuild.premiumTier >= 3 && oldGuild.vanityURLCode) {
                            try {
                                await newGuild.setVanityCode(oldGuild.vanityURLCode, 'Vanity Guard — unauthorized change reverted');
                                log.warning(`[VanityGuard] Reverted vanity change in ${newGuild.name} (${newGuild.id}) by ${executor?.tag || executorId || 'unknown'}`);
                            } catch (revertErr) {
                                log.error(`[VanityGuard] Failed to revert vanity for ${newGuild.id}: ${revertErr.message}`);
                            }
                        } else {
                            log.warning(`[VanityGuard] Cannot revert vanity in ${newGuild.id} — boost tier ${newGuild.premiumTier} insufficient`);
                        }

                        // Punish executor if configured. The action is
                        // separate from "revert" — a successful revert
                        // happens regardless of whether we can punish the
                        // person who tried to change the vanity.
                        if (executorId && executorId !== client.user.id && guildVg.action && guildVg.action !== 'none') {
                            try {
                                const member = await newGuild.members.fetch(executorId).catch(() => null);
                                if (member) {
                                    if (guildVg.action === 'ban') {
                                        if (member.bannable) {
                                            await member.ban({ reason: 'Vanity Guard — unauthorized vanity change' });
                                            log.warning(`[VanityGuard] Banned ${member.user?.tag || executorId} in ${newGuild.id}`);
                                        } else {
                                            log.warning(`[VanityGuard] Cannot ban ${member.user?.tag || executorId} — bot lacks permission`);
                                        }
                                    } else if (guildVg.action === 'kick') {
                                        if (member.kickable) {
                                            await member.kick('Vanity Guard — unauthorized vanity change');
                                            log.warning(`[VanityGuard] Kicked ${member.user?.tag || executorId} in ${newGuild.id}`);
                                        } else {
                                            log.warning(`[VanityGuard] Cannot kick ${member.user?.tag || executorId} — bot lacks permission`);
                                        }
                                    }
                                }
                            } catch (e) {
                                log.error(`[VanityGuard] Punishment error: ${e.message}`);
                            }
                        }

                        // Send a guard alert via the central security logger so
                        // the configured /logging set-security channel receives a
                        // consistent, webhook-aware message with mentions
                        // suppressed.
                        try {
                            await logVanityGuard(newGuild, {
                                executor: executor ? { id: executorId, username: executor.username || executor.tag } : null,
                                oldVanity: oldGuild.vanityURLCode || null,
                                newVanity: newGuild.vanityURLCode || null,
                                reverted: newGuild.premiumTier >= 3 && Boolean(oldGuild.vanityURLCode),
                                punishment: guildVg.action || 'none',
                            });
                        } catch (_) { }

                        // Backward compat: also send to the legacy
                        // `vanityguard.logChannelId` if set on this guild.
                        try {
                            const logChId = guildVg.logChannelId;
                            if (logChId) {
                                const ch = newGuild.channels.cache.get(logChId);
                                if (ch?.isTextBased()) {
                                    const alert =
                                        `## <:Shield:1521227694677692467> Vanity Guard Triggered\n` +
                                        `> Vanity changed from \`${oldGuild.vanityURLCode || 'none'}\` to \`${newGuild.vanityURLCode || 'none'}\`\n` +
                                        `> Executor: ${executor ? `<@${executorId}> (${executor.tag})` : '*unknown*'}\n` +
                                        `> Result: ${newGuild.premiumTier >= 3 ? 'Reverted' : 'Could not revert (insufficient boost tier)'}`;
                                    const container = new ContainerBuilder()
                                        .setAccentColor(0xED4245)
                                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(alert));
                                    await ch.send({
                                        components: [container],
                                        allowedMentions: { parse: [] },
                                        flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
                                    }).catch(() => { });
                                }
                            }
                        } catch { }
                    }
                }
            } // end premium-gated else
        } catch (err) {
            log.error(`[VanityGuard] Error enforcing vanity guard: ${err.message}`);
        }
    }
});

// ═══════ Role Update ═══════
client.on('roleUpdate', async (oldRole, newRole) => {
    await logRoleUpdate(oldRole, newRole);
    // Role count doesn't change on update, but if a role is used in stats display, refresh
});

// ═══════ Emoji Logs ═══════
client.on('emojiCreate', async (emoji) => {
    await logEmojiCreate(emoji);
});

client.on('emojiDelete', async (emoji) => {
    await logEmojiDelete(emoji);
});

client.on('emojiUpdate', async (oldEmoji, newEmoji) => {
    await logEmojiUpdate(oldEmoji, newEmoji);
});

// ═══════ Sticker Logs ═══════
client.on('stickerCreate', async (sticker) => {
    await logStickerCreate(sticker);
});

client.on('stickerDelete', async (sticker) => {
    await logStickerDelete(sticker);
});

client.on('stickerUpdate', async (oldSticker, newSticker) => {
    try { await require('./utils/logger').logStickerUpdate(oldSticker, newSticker); }
    catch (e) { log.debug('logStickerUpdate: ' + e.message); }
});

// ═══════ Soundboard Logs ═══════
client.on('guildSoundboardSoundCreate', async (sound) => {
    try { await logSoundboardCreate(sound.guild, sound); } catch { }
});
client.on('guildSoundboardSoundDelete', async (sound) => {
    try { await logSoundboardDelete(sound.guild, sound); } catch { }
});

// ═══════ Thread Logs ═══════
client.on('threadCreate', async (thread) => {
    await logThreadCreate(thread);
    if (thread.guild) { try { await updateServerStats(thread.guild); } catch { } }
});

client.on('threadDelete', async (thread) => {
    await logThreadDelete(thread);
    if (thread.guild) { try { await updateServerStats(thread.guild); } catch { } }
});

client.on('threadUpdate', async (oldThread, newThread) => {
    try { await require('./utils/logger').logThreadUpdate(oldThread, newThread); }
    catch (e) { log.debug('logThreadUpdate: ' + e.message); }
});

client.on('guildMemberRemove', async (member) => {
    await logMemberLeave(member);

    // Update server stats channels
    try { await updateServerStats(member.guild); } catch { }

    if (isTrackingEnabled(member.guild.id)) {
        await handleMemberLeave(member);
    }

    // Leave Message System
    try {
        if (jsonStore.has('welcomer')) {
            const welcomerConfig = jsonStore.peek('welcomer') || {};
            const guildConfig = welcomerConfig[member.guild.id];
            const leaveConfig = guildConfig?.leave;

            if (leaveConfig && leaveConfig.enabled) {
                const channelId = leaveConfig.channelId || guildConfig.channelId;
                if (channelId) {
                    const channel = member.guild.channels.cache.get(channelId);
                    if (channel) {
                        const mode = leaveConfig.mode || 'components';
                        const rawContent = leaveConfig.content || 'Goodbye {username}!';
                        const processedContent = replacePlaceholders(rawContent, member.user, member.guild, channel) || 'Goodbye!';
                        const safeLeaveStr = (s, fb = '\u200b') => (!s || typeof s !== 'string') ? fb : (s.length > 4096 ? s.substring(0, 4093) + '...' : s);
                        const colorValue = leaveConfig.color ? parseInt(leaveConfig.color.replace('#', ''), 16) : 0xED4245;

                        if (mode === 'embed') {
                            const embed = new EmbedBuilder()
                                .setColor(isNaN(colorValue) ? 0xED4245 : colorValue)
                                .setDescription(processedContent)
                                .setTimestamp();

                            if (leaveConfig.title) {
                                embed.setTitle(replacePlaceholders(leaveConfig.title, member.user, member.guild, channel));
                            }

                            if (leaveConfig.image) {
                                const processedImage = replacePlaceholders(leaveConfig.image, member.user, member.guild, channel);
                                if (processedImage) embed.setImage(processedImage);
                            }

                            if (leaveConfig.thumbnail) {
                                const processedThumb = replacePlaceholders(leaveConfig.thumbnail, member.user, member.guild, channel);
                                if (processedThumb) embed.setThumbnail(processedThumb);
                            }

                            if (leaveConfig.footer) {
                                embed.setFooter({ text: replacePlaceholders(leaveConfig.footer, member.user, member.guild, channel) });
                            }

                            if (leaveConfig.author) {
                                embed.setAuthor({
                                    name: replacePlaceholders(leaveConfig.author, member.user, member.guild, channel),
                                    iconURL: member.user.displayAvatarURL({ size: 64 })
                                });
                            }

                            await channel.send({ embeds: [embed] }).catch(() => { });
                        } else {
                            const { MediaGalleryBuilder, MediaGalleryItemBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
                            const container = new ContainerBuilder();

                            // Only set accent color if not colorless mode
                            if (!leaveConfig.colorless && !isNaN(colorValue)) {
                                container.setAccentColor(colorValue);
                            }

                            const processedThumb = leaveConfig.thumbnail ? replacePlaceholders(leaveConfig.thumbnail, member.user, member.guild, channel) : null;
                            const processedImage = leaveConfig.image ? replacePlaceholders(leaveConfig.image, member.user, member.guild, channel) : null;

                            const imgPos = leaveConfig.imagePosition || 'bottom';

                            // Build image gallery if image exists (not used for 'side' mode)
                            let imageGallery = null;
                            if (processedImage && imgPos !== 'side') {
                                imageGallery = new MediaGalleryBuilder().addItems(
                                    new MediaGalleryItemBuilder().setURL(processedImage)
                                );
                            }

                            // For 'side' mode, image becomes thumbnail accessory
                            const sideImageUrl = (imgPos === 'side' && processedImage) ? processedImage : null;
                            const effectiveThumb = sideImageUrl || processedThumb;

                            // Add image gallery at top if position is 'top'
                            if (imageGallery && imgPos === 'top') {
                                container.addMediaGalleryComponents(imageGallery);
                            }

                            const leaveBtnPos = leaveConfig.buttonPosition || 'bottom';
                            function renderLeaveButtons() {
                                if (leaveConfig.buttons?.length > 0) {
                                    const urlButtons = leaveConfig.buttons
                                        .filter(b => b.label && b.url && (b.url.startsWith('http://') || b.url.startsWith('https://')))
                                        .slice(0, 5)
                                        .map(b => {
                                            const btn = new ButtonBuilder()
                                                .setLabel(typeof b.label === 'string' ? b.label.substring(0, 80) : 'Link')
                                                .setURL(b.url)
                                                .setStyle(ButtonStyle.Link);
                                            if (b.emoji) btn.setEmoji(b.emoji);
                                            return btn;
                                        });
                                    if (urlButtons.length > 0) container.addActionRowComponents(new ActionRowBuilder().addComponents(...urlButtons));
                                }
                                if (leaveConfig.actionButtons?.length > 0) {
                                    try {
                                        if (jsonStore.has('button-commands')) {
                                            const btnConfig = jsonStore.peek('button-commands') || {};
                                            const gId = member.guild.id;
                                            if (btnConfig[gId]) {
                                                const styleMap = { 'primary': ButtonStyle.Primary, 'secondary': ButtonStyle.Secondary, 'success': ButtonStyle.Success, 'danger': ButtonStyle.Danger, 'link': ButtonStyle.Link };
                                                let actionRow = new ActionRowBuilder();
                                                let count = 0;
                                                for (const buttonId of leaveConfig.actionButtons.slice(0, 25)) {
                                                    const bd = btnConfig[gId][buttonId];
                                                    if (!bd) continue;
                                                    const ab = new ButtonBuilder().setLabel(bd.label).setStyle(styleMap[bd.style] || ButtonStyle.Primary);
                                                    if (bd.style === 'link') { if (bd.url) ab.setURL(bd.url); else continue; }
                                                    else ab.setCustomId(`btn_cmd_${gId}_${buttonId}`);
                                                    if (bd.emoji) ab.setEmoji(bd.emoji);
                                                    actionRow.addComponents(ab);
                                                    count++;
                                                    if (count >= 5) { container.addActionRowComponents(actionRow); actionRow = new ActionRowBuilder(); count = 0; }
                                                }
                                                if (count > 0) container.addActionRowComponents(actionRow);
                                            }
                                        }
                                    } catch (e) { log.error('Leave action buttons: ' + e.message); }
                                }
                            }

                            // Buttons at top — placed before content
                            if (leaveBtnPos === 'top') renderLeaveButtons();

                            const hasSeparators = /\{separator(:(small|medium|large))?\}/gi.test(rawContent);

                            // Count extra components needed after content
                            const extraLeaveComponents = (imageGallery && imgPos === 'bottom' ? 1 : 0) + (leaveConfig.footer ? 2 : 0) + (leaveConfig.buttons?.length > 0 ? 1 : 0) + (leaveConfig.canvas?.enabled ? 1 : 0);
                            const maxLeaveContentComponents = 10 - (imageGallery && imgPos === 'top' ? 1 : 0) - extraLeaveComponents;
                            let leaveComponentCount = imageGallery && imgPos === 'top' ? 1 : 0;

                            if (hasSeparators) {
                                // Split on raw separators FIRST, then replace placeholders on each text part
                                const markedContent = rawContent
                                    .replace(/\{separator:small\}/gi, '---SEPARATOR:SMALL---')
                                    .replace(/\{separator:medium\}/gi, '---SEPARATOR:MEDIUM---')
                                    .replace(/\{separator:large\}/gi, '---SEPARATOR:LARGE---')
                                    .replace(/\{separator\}/gi, '---SEPARATOR:SMALL---');
                                const parts = markedContent.split(/---SEPARATOR:(SMALL|MEDIUM|LARGE)---/);
                                let isFirst = true;

                                for (let i = 0; i < parts.length; i++) {
                                    if (leaveComponentCount >= maxLeaveContentComponents) break;
                                    const part = parts[i];
                                    if (part === 'SMALL' || part === 'MEDIUM' || part === 'LARGE') {
                                        const spacing = part === 'LARGE' ? SeparatorSpacingSize.Large :
                                            part === 'MEDIUM' ? SeparatorSpacingSize.Medium : SeparatorSpacingSize.Small;
                                        container.addSeparatorComponents(
                                            new SeparatorBuilder().setSpacing(spacing).setDivider(true)
                                        );
                                        leaveComponentCount++;
                                    } else if (part.trim()) {
                                        const processedPart = replacePlaceholders(part, member.user, member.guild, channel) || '\u200b';
                                        if (isFirst && effectiveThumb) {
                                            const section = new SectionBuilder()
                                                .addTextDisplayComponents(new TextDisplayBuilder().setContent(safeLeaveStr(processedPart)))
                                                .setThumbnailAccessory(new ThumbnailBuilder().setURL(effectiveThumb));
                                            container.addSectionComponents(section);
                                            isFirst = false;
                                        } else {
                                            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(safeLeaveStr(processedPart)));
                                        }
                                        leaveComponentCount++;
                                    }
                                }
                            } else {
                                if (effectiveThumb) {
                                    const section = new SectionBuilder()
                                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(safeLeaveStr(processedContent)))
                                        .setThumbnailAccessory(new ThumbnailBuilder().setURL(effectiveThumb));
                                    container.addSectionComponents(section);
                                } else {
                                    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(safeLeaveStr(processedContent)));
                                }
                                leaveComponentCount++;
                            }

                            // Add image gallery at bottom if position is 'bottom' (default)
                            if (imageGallery && imgPos === 'bottom') {
                                container.addMediaGalleryComponents(imageGallery);
                            }

                            if (leaveConfig.footer) {
                                container.addSeparatorComponents(
                                    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true)
                                );
                                container.addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(safeLeaveStr(`-# ${replacePlaceholders(leaveConfig.footer, member.user, member.guild, channel)}`))
                                );
                            }

                            // Buttons at bottom (default)
                            if (leaveBtnPos !== 'top') renderLeaveButtons();

                            // Check if canvas mode is enabled for leave
                            if (leaveConfig.canvas?.enabled) {
                                try {
                                    const LeaveCard = require('./utils/leaveCard');
                                    const { AttachmentBuilder } = require('discord.js');

                                    const card = new LeaveCard();
                                    if (leaveConfig.canvas.backgroundColor) card.setBackground(leaveConfig.canvas.backgroundColor);
                                    if (leaveConfig.canvas.accentColor) card.setAccentColor(leaveConfig.canvas.accentColor);
                                    if (leaveConfig.canvas.textColor) card.setTextColor(leaveConfig.canvas.textColor);
                                    if (leaveConfig.canvas.backgroundImage) card.setBackgroundImage(leaveConfig.canvas.backgroundImage);
                                    if (leaveConfig.canvas.fontFamily) card.setFont(leaveConfig.canvas.fontFamily);

                                    const customMsg = leaveConfig.canvas.customMessage?.replace('{membercount}', member.guild.memberCount.toLocaleString()) || null;
                                    const buffer = await card.generate(member.user, member.guild, member.guild.memberCount, customMsg);
                                    const attachment = new AttachmentBuilder(buffer, { name: 'leave.png' });

                                    container.addMediaGalleryComponents(
                                        new MediaGalleryBuilder().addItems(
                                            new MediaGalleryItemBuilder().setURL('attachment://leave.png')
                                        )
                                    );

                                    await channel.send({ components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
                                    return;
                                } catch (canvasError) {
                                    log.error('Canvas leave error, falling back', canvasError);
                                }
                            }

                            await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => { });
                        }
                    }
                }
            }
        }
    } catch (error) {
        log.error('Leave message error', error);
    }

    await checkAuditLogAntiNuke(member.guild, 20, 'kickProtection', member.id, member.user?.username || member.id, 3000);
});

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;

    if (reaction.partial) {
        try {
            await reaction.fetch();
        } catch (error) {
            log.error('Error fetching reaction', error);
            return;
        }
    }

    // Log reaction add (best-effort, never throws)
    try { await require('./utils/logger').logReactionAdd(reaction, user); } catch (e) { log.debug('logReactionAdd: ' + e.message); }

    // Reaction Roles System
    try {
        if (reaction.message.partial) {
            try { await reaction.message.fetch(); } catch { /* skip if can't fetch */ }
        }

        if (jsonStore.has('reactionroles')) {
            const rrConfig = jsonStore.read('reactionroles');
            const guildId = reaction.message.guild?.id;
            if (guildId && rrConfig[guildId]) {
                const msgId = reaction.message.id;
                const panel = rrConfig[guildId][msgId];

                if (panel && panel.mode !== 'button') {
                    const emojiStr = reaction.emoji.id
                        ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>`
                        : reaction.emoji.name;

                    const matchedRole = panel.roles.find(r => {
                        if (r.emoji === emojiStr) return true;
                        if (reaction.emoji.id && r.emoji.includes(reaction.emoji.id)) return true;
                        if (!reaction.emoji.id && r.emoji === reaction.emoji.name) return true;
                        return false;
                    });

                    if (matchedRole) {
                        const guild = reaction.message.guild;
                        const member = await guild.members.fetch(user.id).catch(() => null);
                        if (member) {
                            const role = guild.roles.cache.get(matchedRole.roleId);
                            if (role && !role.managed && role.position < guild.members.me.roles.highest.position) {
                                if (!member.roles.cache.has(matchedRole.roleId)) {
                                    await member.roles.add(role).catch(() => { });
                                }
                            }
                        }
                    }
                }
            }
        }
    } catch (err) {
        log.error('Reaction role (add): ' + err.message);
    }

    // Starboard System
    if (jsonStore.has('starboard')) {
        const starboard = jsonStore.read('starboard');
        const guildStarboard = reaction.message.guild ? starboard[reaction.message.guild.id] : null;

        if (guildStarboard && guildStarboard.enabled) {
            const configuredEmojis = (guildStarboard.emojis && guildStarboard.emojis.length > 0) ? guildStarboard.emojis : ['⭐'];
            const rId = reaction.emoji.id;
            const rName = reaction.emoji.name;
            
            const matchedEmoji = configuredEmojis.find(e => {
                if (e === rId || e === rName) return true;
                if (rId && e.includes(rId)) return true;
                return false;
            });

            // Fallback for legacy configs that expect the hardcoded Fire emoji mapping
            const legacyMatch = (rId === '1521227907647668374' && configuredEmojis.includes('⭐'));

            if (matchedEmoji || legacyMatch) {
                const starCount = reaction.count;
                if (starCount >= guildStarboard.threshold) {
                    const starChannel = reaction.message.guild.channels.cache.get(guildStarboard.channelId);
                    if (starChannel) {
                        if (!guildStarboard.starredMessages) {
                            guildStarboard.starredMessages = {};
                        }

                        const displayEmoji = legacyMatch 
                            ? '<:Fire:1521227907647668374>' 
                            : (reaction.emoji.id ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name);

                        if (guildStarboard.starredMessages[reaction.message.id]) {
                            const starredMsg = await starChannel.messages.fetch(guildStarboard.starredMessages[reaction.message.id]).catch(() => null);
                            if (starredMsg) {
                                const container = new ContainerBuilder()
                                    .addTextDisplayComponents(
                                        new TextDisplayBuilder()
                                            .setContent(`# ${displayEmoji} Starboard (${starCount} stars)\n\n**Author:** ${reaction.message.author}\n**Channel:** ${reaction.message.channel}\n**[Jump to Message](${reaction.message.url})**\n\n${reaction.message.content || '*[No text content]*'}`)
                                    );
                                await starredMsg.edit({ components: [container] });
                            }
                        } else {
                            const container = new ContainerBuilder()
                                .addTextDisplayComponents(
                                    new TextDisplayBuilder()
                                        .setContent(`# ${displayEmoji} Starboard (${starCount} stars)\n\n**Author:** ${reaction.message.author}\n**Channel:** ${reaction.message.channel}\n**[Jump to Message](${reaction.message.url})**\n\n${reaction.message.content || '*[No text content]*'}`)
                                );

                            const starredMsg = await starChannel.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
                            guildStarboard.starredMessages[reaction.message.id] = starredMsg.id;
                            guildStarboard.starredCount = (guildStarboard.starredCount || 0) + 1;
                            jsonStore.write('starboard', starboard);
                        }
                    }
                }
            }
        }
    }
});

client.on('messageReactionRemove', async (reaction, user) => {
    if (user.bot) return;

    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }
    if (reaction.message.partial) {
        try { await reaction.message.fetch(); } catch { return; }
    }

    // Log reaction remove (best-effort)
    try { await require('./utils/logger').logReactionRemove(reaction, user); } catch (e) { log.debug('logReactionRemove: ' + e.message); }

    try {
        if (!jsonStore.has('reactionroles')) return;

        const rrConfig = jsonStore.read('reactionroles');
        const guildId = reaction.message.guild?.id;
        if (!guildId || !rrConfig[guildId]) return;

        const msgId = reaction.message.id;
        const panel = rrConfig[guildId][msgId];

        if (!panel || panel.mode === 'button') return;

        const emojiStr = reaction.emoji.id
            ? `<${reaction.emoji.animated ? 'a' : ''}:${reaction.emoji.name}:${reaction.emoji.id}>`
            : reaction.emoji.name;

        const matchedRole = panel.roles.find(r => {
            if (r.emoji === emojiStr) return true;
            if (reaction.emoji.id && r.emoji.includes(reaction.emoji.id)) return true;
            if (!reaction.emoji.id && r.emoji === reaction.emoji.name) return true;
            return false;
        });

        if (matchedRole) {
            const guild = reaction.message.guild;
            const member = await guild.members.fetch(user.id).catch(() => null);
            if (member) {
                const role = guild.roles.cache.get(matchedRole.roleId);
                if (role && !role.managed && role.position < guild.members.me.roles.highest.position) {
                    if (member.roles.cache.has(matchedRole.roleId)) {
                        await member.roles.remove(role).catch(() => { });
                    }
                }
            }
        }
    } catch (err) {
        log.error('Reaction role (remove): ' + err.message);
    }
});

// Top.gg Vote Webhook Server (only on shard 0)
const shardId = client.shard?.ids?.[0] ?? 0;
if (shardId === 0) {
    const express = require('express');
    const app = express();
    app.use(express.json());

    const { TTS_CACHE_DIR, ensureCacheDir } = require('./utils/ttsEngine');
    ensureCacheDir();
    app.get('/tts/:filename', (req, res) => {
        const filename = req.params.filename;
        // Only allow .mp3 files with hex names (md5 hashes)
        if (!/^[a-f0-9]{32}\.mp3$/.test(filename)) {
            return res.status(400).send('Invalid filename');
        }
        const filePath = path.join(TTS_CACHE_DIR, filename);
        if (!fs.existsSync(filePath)) {
            return res.status(404).send('Not found');
        }
        res.setHeader('Content-Type', 'audio/mpeg');
        fs.createReadStream(filePath).pipe(res);
    });

    app.post('/topgg-webhook', async (req, res) => {
        const auth = req.headers.authorization;
        if (auth !== process.env.TOPGG_WEBHOOK_SECRET) {
            log.warning('Top.gg webhook: Unauthorized request');
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const { user, type, isWeekend, query } = req.body;

        // Only process upvotes
        if (type !== 'upvote') {
            return res.status(200).json({ success: true, message: 'Not an upvote' });
        }

        // Respond immediately to prevent timeout
        res.status(200).json({ success: true });

        try {

            // Load configs
            const voteConfig = jsonStore.has('vote-config')
                ? jsonStore.read('vote-config')
                : {};

            // Load/create user votes tracking
            let userVotes = {};
            if (jsonStore.has('user-votes')) {
                userVotes = jsonStore.read('user-votes');
            }

            // Fetch Discord user
            const discordUser = await client.users.fetch(user).catch(() => null);
            if (!discordUser) {
                log.warning(`Top.gg vote: Could not fetch user ${user}`);
                return;
            }

            // Update user vote stats
            const now = Date.now();
            const TWELVE_HOURS = 12 * 60 * 60 * 1000;
            const STREAK_WINDOW = 13 * 60 * 60 * 1000; // 13 hours for streak (1 hour grace)

            if (!userVotes[user]) {
                userVotes[user] = { totalVotes: 0, streak: 0, lastVote: 0, firstVote: now };
            }

            const userData = userVotes[user];
            const timeSinceLastVote = now - (userData.lastVote || 0);

            // Calculate streak
            if (userData.lastVote && timeSinceLastVote <= STREAK_WINDOW) {
                userData.streak = (userData.streak || 0) + 1;
            } else if (timeSinceLastVote > STREAK_WINDOW) {
                userData.streak = 1; // Reset streak
            } else {
                userData.streak = (userData.streak || 0) + 1;
            }

            userData.totalVotes = (userData.totalVotes || 0) + 1;
            userData.lastVote = now;

            // Save user votes
            jsonStore.write('user-votes', userVotes);

            // Award voter badge
            const badgeManager = require('./utils/badgeManager');
            await badgeManager.initializeDefaultBadges();

            // Check if user already has voter badge
            const existingBadges = await badgeManager.getUserBadges(user);
            const hasVoterBadge = existingBadges.some(b => b.badgeId === 'voter');
            let isFirstVote = false;

            if (!hasVoterBadge) {
                const badgeResult = await badgeManager.addBadgeToUser(user, 'voter');
                if (badgeResult.success) {
                    isFirstVote = true;
                    log.debug(`Voter badge awarded to user ${user}`);
                } else {
                    log.debug(`Failed to award voter badge: ${badgeResult.message}`);
                }
            }

            // Calculate next vote time
            const voteHours = isWeekend ? 6 : 12;
            const nextVoteTime = Math.floor(now / 1000) + (voteHours * 3600);

            // Grant 12h temporary no-prefix access as a vote reward (no premium required)
            let voteNpExpiry = null;
            try {
                const npCmd = client.commands.get('noprefix');
                if (npCmd && typeof npCmd.grantVoteNoPrefix === 'function') {
                    voteNpExpiry = npCmd.grantVoteNoPrefix(user);
                    log.debug(`Granted 12h vote no-prefix to ${user}`);
                }
            } catch (npErr) {
                log.error(`Failed to grant vote no-prefix (top.gg): ${npErr.message}`);
            }

            // Get streak emoji and message
            const getStreakInfo = (streak) => {
                if (streak >= 30) return { emoji: '<:Fire:1521227907647668374>', title: 'LEGENDARY', color: 0xFF4500 };
                if (streak >= 14) return { emoji: '<:Lightningalt:1521227851796447472>', title: 'EPIC', color: 0x9B59B6 };
                if (streak >= 7) return { emoji: '<:Sketch:1521228025365004471>', title: 'AMAZING', color: 0x3498DB };
                if (streak >= 3) return { emoji: '<:Star:1521227981685526568>', title: 'GREAT', color: 0x2ECC71 };
                return { emoji: '🗳', title: '', color: 0xFF3366 };
            };

            const streakInfo = getStreakInfo(userData.streak);

            // Track whether the default vote channel is already covered
            // by an explicit guild config so we don't double-post the
            // same notification there.
            let defaultChannelCovered = false;

            // Send to all configured guild channels
            for (const [guildId, config] of Object.entries(voteConfig)) {
                if (!config.enabled || !config.channelId) continue;
                if (config.channelId === DEFAULT_VOTE_CHANNEL_ID) defaultChannelCovered = true;

                const guild = client.guilds.cache.get(guildId);
                if (!guild) continue;

                const channel = guild.channels.cache.get(config.channelId);
                if (!channel) continue;

                try {
                    // Build professional vote notification
                    const { SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');

                    const headerSection = new SectionBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <:Fire:1521227907647668374> New Vote Received!`
                            )
                        )
                        .setThumbnailAccessory(
                            new ThumbnailBuilder({ media: { url: discordUser.displayAvatarURL({ size: 256 }) } })
                        );

                    let statsContent = `### <:User:1521227714227343380> Voter\n`;
                    statsContent += `**${discordUser.globalName || discordUser.username}** (\`${discordUser.username}\`)\n\n`;

                    statsContent += `### <:Fire:1521227907647668374> Vote Statistics\n`;
                    statsContent += `${streakInfo.emoji} **Streak:** ${userData.streak} vote${userData.streak > 1 ? 's' : ''} in a row`;
                    if (streakInfo.title) statsContent += ` — *${streakInfo.title}!*`;
                    statsContent += `\n`;
                    statsContent += `<:Lightning:1521227915537285150> **Total Votes:** ${userData.totalVotes}\n`;

                    if (isWeekend) {
                        statsContent += `\n### <:Present:1521228115655917659> Weekend Bonus Active!\n`;
                        statsContent += `*Votes count double during weekends!*\n`;
                    }

                    if (isFirstVote) {
                        statsContent += `\n### 🏅 First Vote!\n`;
                        statsContent += `*${discordUser.username} earned the **Voter** badge!*\n`;
                    }

                    statsContent += `\n### <:Clock:1521228110408847623> Next Vote\n`;
                    statsContent += `Available <t:${nextVoteTime}:R> (<t:${nextVoteTime}:t>)\n`;

                    statsContent += `\n-# Thank you for supporting ${client.user.username}! Every vote helps us grow.`;

                    const voteContainer = new ContainerBuilder()
                        .setAccentColor(streakInfo.color)
                        .addSectionComponents(headerSection)
                        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(statsContent));

                    const voteBtn = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Vote on Top.gg')
                            .setURL(`https://top.gg/bot/${client.user.id}/vote`)
                            .setStyle(ButtonStyle.Link)
                            .setEmoji('<:topgg:1521228219066482790>'),
                        new ButtonBuilder()
                            .setLabel('Vote on DBL')
                            .setURL('https://discordbotlist.com/bots/xnico')
                            .setStyle(ButtonStyle.Link)
                            .setEmoji('<:Cursor:1521228147071127732>'),
                        new ButtonBuilder()
                            .setLabel('View Bot Page')
                            .setURL(`https://top.gg/bot/${client.user.id}`)
                            .setStyle(ButtonStyle.Link)
                            .setEmoji('<:Attach:1521228039135170722>')
                    );

                    if (config.pingRoleId) {
                        voteContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@&${config.pingRoleId}>`));
                    }
                    await channel.send({
                        components: [voteContainer, voteBtn],
                        flags: MessageFlags.IsComponentsV2
                    });

                    // Update guild stats
                    config.totalVotes = (config.totalVotes || 0) + 1;
                    config.lastVote = now;
                    config.lastVoterId = user;
                } catch (err) {
                    log.error(`Top.gg vote notification error for guild ${guildId}: ${err.message}`);
                }
            }

            // Default-channel fallback — always post a vote container to
            // DEFAULT_VOTE_CHANNEL_ID unless an explicit guild config
            // already pointed at it.
            if (!defaultChannelCovered) {
                try {
                    const fallbackChannel = client.channels.cache.get(DEFAULT_VOTE_CHANNEL_ID);
                    if (fallbackChannel && fallbackChannel.isTextBased && fallbackChannel.isTextBased()) {
                        const { SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');

                        const headerSection = new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`# <:Fire:1521227907647668374> New Vote Received!`)
                            )
                            .setThumbnailAccessory(
                                new ThumbnailBuilder({ media: { url: discordUser.displayAvatarURL({ size: 256 }) } })
                            );

                        let statsContent = `### <:User:1521227714227343380> Voter\n`;
                        statsContent += `**${discordUser.globalName || discordUser.username}** (\`${discordUser.username}\`)\n\n`;
                        statsContent += `### <:Fire:1521227907647668374> Vote Statistics\n`;
                        statsContent += `${streakInfo.emoji} **Streak:** ${userData.streak} vote${userData.streak > 1 ? 's' : ''} in a row`;
                        if (streakInfo.title) statsContent += ` — *${streakInfo.title}!*`;
                        statsContent += `\n<:Lightning:1521227915537285150> **Total Votes:** ${userData.totalVotes}\n`;
                        if (isWeekend) statsContent += `\n### <:Present:1521228115655917659> Weekend Bonus Active!\n*Votes count double during weekends!*\n`;
                        if (isFirstVote) statsContent += `\n### 🏅 First Vote!\n*${discordUser.username} earned the **Voter** badge!*\n`;
                        statsContent += `\n### <:Clock:1521228110408847623> Next Vote\nAvailable <t:${nextVoteTime}:R> (<t:${nextVoteTime}:t>)\n`;
                        statsContent += `\n-# Thank you for supporting ${client.user.username}! Every vote helps us grow.`;

                        const voteContainer = new ContainerBuilder()
                            .setAccentColor(streakInfo.color)
                            .addSectionComponents(headerSection)
                            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(statsContent));

                        const voteBtn = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setLabel('Vote on Top.gg')
                                .setURL(`https://top.gg/bot/${client.user.id}/vote`)
                                .setStyle(ButtonStyle.Link)
                                .setEmoji('<:topgg:1521228219066482790>'),
                            new ButtonBuilder()
                                .setLabel('Vote on DBL')
                                .setURL('https://discordbotlist.com/bots/xnico')
                                .setStyle(ButtonStyle.Link)
                                .setEmoji('<:Cursor:1521228147071127732>'),
                            new ButtonBuilder()
                                .setLabel('View Bot Page')
                                .setURL(`https://top.gg/bot/${client.user.id}`)
                                .setStyle(ButtonStyle.Link)
                                .setEmoji('<:Attach:1521228039135170722>')
                        );

                        await fallbackChannel.send({
                            components: [voteContainer, voteBtn],
                            flags: MessageFlags.IsComponentsV2
                        });
                    }
                } catch (fbErr) {
                    log.error(`Top.gg default-channel post failed: ${fbErr.message}`);
                }
            }

            // Save updated config
            jsonStore.write('vote-config', voteConfig);

            // Send DM thank you message
            try {
                const { SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');

                let dmContent = `# <:Fire:1521227907647668374> Thank You for Voting!\n\n`;
                dmContent += `Your vote for **${client.user.username}** has been received!\n\n`;

                dmContent += `### ${streakInfo.emoji} Your Stats\n`;
                dmContent += `**Current Streak:** ${userData.streak} vote${userData.streak > 1 ? 's' : ''} in a row\n`;
                dmContent += `**Total Votes:** ${userData.totalVotes}\n`;

                if (voteNpExpiry) {
                    dmContent += `\n### <:Lightning:1521227915537285150> 12h No-Prefix Activated!\n`;
                    dmContent += `You can now run commands **without the prefix** in all servers.\n`;
                    dmContent += `Expires <t:${Math.floor(voteNpExpiry / 1000)}:R> (<t:${Math.floor(voteNpExpiry / 1000)}:t>). Vote again to renew!\n`;
                }

                if (isWeekend) {
                    dmContent += `\n### <:Present:1521228115655917659> Weekend Bonus\n`;
                    dmContent += `You voted during a weekend — your vote counts double!\n`;
                }

                if (isFirstVote) {
                    dmContent += `\n### 🏅 Badge Earned!\n`;
                    dmContent += `You've earned the **Voter** badge! Check your profile to see it.\n`;
                }

                if (userData.streak >= 7) {
                    dmContent += `\n### <:Fire:1521227907647668374> Streak Bonus\n`;
                    dmContent += `Amazing dedication! Keep your streak going!\n`;
                }

                dmContent += `\n### <:Clock:1521228110408847623> Next Vote\n`;
                dmContent += `You can vote again <t:${nextVoteTime}:R>\n`;
                dmContent += `\n### <:Notificationon:1521227730304106680> Reminders\n`;
                dmContent += `Use \`/myvotes\` to enable vote reminders — I'll DM you when you can vote again!\n`;
                dmContent += `\n-# Your support means everything to us! 💜`;

                const dmContainer = new ContainerBuilder()
                    .setAccentColor(streakInfo.color)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dmContent));

                const dmBtn = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel(`Vote Again in ${voteHours}h`)
                        .setURL(`https://top.gg/bot/${client.user.id}/vote`)
                        .setStyle(ButtonStyle.Link)
                        .setEmoji('<:topgg:1521228219066482790>'),
                    new ButtonBuilder()
                        .setLabel('Vote on DBL too!')
                        .setURL('https://discordbotlist.com/bots/xnico')
                        .setStyle(ButtonStyle.Link)
                        .setEmoji('<:Cursor:1521228147071127732>'),
                    new ButtonBuilder()
                        .setLabel('Invite Bot')
                        .setURL(`https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`)
                        .setStyle(ButtonStyle.Link)
                        .setEmoji('<:Add:1521227828199293152>')
                );

                await discordUser.send({ components: [dmContainer, dmBtn], flags: MessageFlags.IsComponentsV2 });
            } catch (dmErr) {
                // User has DMs disabled, silently ignore
            }

            // Mark user as eligible for a reminder (handled by persistent scheduler)
            userData.nextVoteAvailable = now + (voteHours * 60 * 60 * 1000);
            userData.reminderSent = false;
            jsonStore.write('user-votes', userVotes);

            log.debug(`Top.gg vote from ${discordUser.username} (streak: ${userData.streak})`);

        } catch (error) {
            log.error('Top.gg webhook error', error);
        }
    });

    // DiscordBotList (DBL) Vote Webhook
    app.post('/dbl-webhook', async (req, res) => {
        const auth = req.headers.authorization;
        if (!process.env.DBL_WEBHOOK_SECRET || auth !== process.env.DBL_WEBHOOK_SECRET) {
            log.warning('DBL webhook: Unauthorized request');
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const userId = req.body.id;
        if (!userId) {
            return res.status(400).json({ error: 'Missing user id' });
        }

        // Respond immediately to prevent timeout
        res.status(200).json({ success: true });

        try {

            const voteConfig = jsonStore.has('vote-config')
                ? jsonStore.read('vote-config')
                : {};

            let userVotes = {};
            if (jsonStore.has('user-votes')) {
                userVotes = jsonStore.read('user-votes');
            }

            const discordUser = await client.users.fetch(userId).catch(() => null);
            if (!discordUser) {
                log.warning(`DBL vote: Could not fetch user ${userId}`);
                return;
            }

            const now = Date.now();
            const STREAK_WINDOW = 13 * 60 * 60 * 1000;

            if (!userVotes[userId]) {
                userVotes[userId] = { totalVotes: 0, streak: 0, lastVote: 0, firstVote: now };
            }

            const userData = userVotes[userId];
            const timeSinceLastVote = now - (userData.lastVote || 0);

            if (userData.lastVote && timeSinceLastVote <= STREAK_WINDOW) {
                userData.streak = (userData.streak || 0) + 1;
            } else if (timeSinceLastVote > STREAK_WINDOW) {
                userData.streak = 1;
            } else {
                userData.streak = (userData.streak || 0) + 1;
            }

            userData.totalVotes = (userData.totalVotes || 0) + 1;
            userData.lastVote = now;
            userData.lastPlatform = 'dbl';

            jsonStore.write('user-votes', userVotes);

            // Award voter badge
            const badgeManager = require('./utils/badgeManager');
            await badgeManager.initializeDefaultBadges();
            const existingBadges = await badgeManager.getUserBadges(userId);
            const hasVoterBadge = existingBadges.some(b => b.badgeId === 'voter');
            let isFirstVote = false;

            if (!hasVoterBadge) {
                const badgeResult = await badgeManager.addBadgeToUser(userId, 'voter');
                if (badgeResult.success) {
                    isFirstVote = true;
                    log.debug(`Voter badge awarded to user ${userId} (via DBL)`);
                }
            }

            const nextVoteTime = Math.floor(now / 1000) + 43200; // 12 hours

            // Grant 12h temporary no-prefix access as a vote reward (no premium required)
            let voteNpExpiry = null;
            try {
                const npCmd = client.commands.get('noprefix');
                if (npCmd && typeof npCmd.grantVoteNoPrefix === 'function') {
                    voteNpExpiry = npCmd.grantVoteNoPrefix(userId);
                    log.debug(`Granted 12h vote no-prefix to ${userId} (via DBL)`);
                }
            } catch (npErr) {
                log.error(`Failed to grant vote no-prefix (dbl): ${npErr.message}`);
            }

            const getStreakInfo = (streak) => {
                if (streak >= 30) return { emoji: '<:Fire:1521227907647668374>', title: 'LEGENDARY', color: 0xFF4500 };
                if (streak >= 14) return { emoji: '<:Lightningalt:1521227851796447472>', title: 'EPIC', color: 0x9B59B6 };
                if (streak >= 7) return { emoji: '<:Sketch:1521228025365004471>', title: 'AMAZING', color: 0x3498DB };
                if (streak >= 3) return { emoji: '<:Star:1521227981685526568>', title: 'GREAT', color: 0x2ECC71 };
                return { emoji: '🗳', title: '', color: 0x4F86EC };
            };

            const streakInfo = getStreakInfo(userData.streak);

            // Default-channel coverage tracker (see top.gg handler).
            let defaultChannelCovered = false;

            // Send to all configured guild channels
            for (const [guildId, config] of Object.entries(voteConfig)) {
                if (!config.enabled || !config.channelId) continue;
                if (config.channelId === DEFAULT_VOTE_CHANNEL_ID) defaultChannelCovered = true;

                const guild = client.guilds.cache.get(guildId);
                if (!guild) continue;

                const channel = guild.channels.cache.get(config.channelId);
                if (!channel) continue;

                try {
                    const { SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');

                    const headerSection = new SectionBuilder()
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <:Cursor:1521228147071127732> New Vote on DiscordBotList!`
                            )
                        )
                        .setThumbnailAccessory(
                            new ThumbnailBuilder({ media: { url: discordUser.displayAvatarURL({ size: 256 }) } })
                        );

                    let statsContent = `### <:User:1521227714227343380> Voter\n`;
                    statsContent += `**${discordUser.globalName || discordUser.username}** (\`${discordUser.username}\`)\n\n`;

                    statsContent += `### <:Fire:1521227907647668374> Vote Statistics\n`;
                    statsContent += `${streakInfo.emoji} **Streak:** ${userData.streak} vote${userData.streak > 1 ? 's' : ''} in a row`;
                    if (streakInfo.title) statsContent += ` — *${streakInfo.title}!*`;
                    statsContent += `\n`;
                    statsContent += `<:Lightning:1521227915537285150> **Total Votes:** ${userData.totalVotes}\n`;
                    statsContent += `<:Cursor:1521228147071127732> **Platform:** DiscordBotList\n`;

                    if (isFirstVote) {
                        statsContent += `\n### 🏅 First Vote!\n`;
                        statsContent += `*${discordUser.username} earned the **Voter** badge!*\n`;
                    }

                    statsContent += `\n### <:Clock:1521228110408847623> Next Vote\n`;
                    statsContent += `Available <t:${nextVoteTime}:R> (<t:${nextVoteTime}:t>)\n`;

                    statsContent += `\n-# Thank you for supporting ${client.user.username}! Every vote helps us grow.`;

                    const voteContainer = new ContainerBuilder()
                        .setAccentColor(streakInfo.color)
                        .addSectionComponents(headerSection)
                        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(statsContent));

                    const voteBtn = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Vote on Top.gg')
                            .setURL(`https://top.gg/bot/${client.user.id}/vote`)
                            .setStyle(ButtonStyle.Link)
                            .setEmoji('<:topgg:1521228219066482790>'),
                        new ButtonBuilder()
                            .setLabel('Vote on DBL')
                            .setURL('https://discordbotlist.com/bots/xnico')
                            .setStyle(ButtonStyle.Link)
                            .setEmoji('<:Cursor:1521228147071127732>')
                    );

                    if (config.pingRoleId) {
                        voteContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(`<@&${config.pingRoleId}>`));
                    }
                    await channel.send({
                        components: [voteContainer, voteBtn],
                        flags: MessageFlags.IsComponentsV2
                    });

                    config.totalVotes = (config.totalVotes || 0) + 1;
                    config.lastVote = now;
                    config.lastVoterId = userId;
                } catch (err) {
                    log.error(`DBL vote notification error for guild ${guildId}: ${err.message}`);
                }
            }

            // Default-channel fallback (DBL) — same shape as Top.gg.
            if (!defaultChannelCovered) {
                try {
                    const fallbackChannel = client.channels.cache.get(DEFAULT_VOTE_CHANNEL_ID);
                    if (fallbackChannel && fallbackChannel.isTextBased && fallbackChannel.isTextBased()) {
                        const { SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');

                        const headerSection = new SectionBuilder()
                            .addTextDisplayComponents(
                                new TextDisplayBuilder().setContent(`# <:Cursor:1521228147071127732> New Vote on DiscordBotList!`)
                            )
                            .setThumbnailAccessory(
                                new ThumbnailBuilder({ media: { url: discordUser.displayAvatarURL({ size: 256 }) } })
                            );

                        let statsContent = `### <:User:1521227714227343380> Voter\n`;
                        statsContent += `**${discordUser.globalName || discordUser.username}** (\`${discordUser.username}\`)\n\n`;
                        statsContent += `### <:Fire:1521227907647668374> Vote Statistics\n`;
                        statsContent += `${streakInfo.emoji} **Streak:** ${userData.streak} vote${userData.streak > 1 ? 's' : ''} in a row`;
                        if (streakInfo.title) statsContent += ` — *${streakInfo.title}!*`;
                        statsContent += `\n<:Lightning:1521227915537285150> **Total Votes:** ${userData.totalVotes}\n`;
                        statsContent += `<:Cursor:1521228147071127732> **Platform:** DiscordBotList\n`;
                        if (isFirstVote) statsContent += `\n### 🏅 First Vote!\n*${discordUser.username} earned the **Voter** badge!*\n`;
                        statsContent += `\n### <:Clock:1521228110408847623> Next Vote\nAvailable <t:${nextVoteTime}:R> (<t:${nextVoteTime}:t>)\n`;
                        statsContent += `\n-# Thank you for supporting ${client.user.username}! Every vote helps us grow.`;

                        const voteContainer = new ContainerBuilder()
                            .setAccentColor(streakInfo.color)
                            .addSectionComponents(headerSection)
                            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
                            .addTextDisplayComponents(new TextDisplayBuilder().setContent(statsContent));

                        const voteBtn = new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setLabel('Vote on Top.gg')
                                .setURL(`https://top.gg/bot/${client.user.id}/vote`)
                                .setStyle(ButtonStyle.Link)
                                .setEmoji('<:topgg:1521228219066482790>'),
                            new ButtonBuilder()
                                .setLabel('Vote on DBL')
                                .setURL('https://discordbotlist.com/bots/xnico')
                                .setStyle(ButtonStyle.Link)
                                .setEmoji('<:Cursor:1521228147071127732>')
                        );

                        await fallbackChannel.send({
                            components: [voteContainer, voteBtn],
                            flags: MessageFlags.IsComponentsV2
                        });
                    }
                } catch (fbErr) {
                    log.error(`DBL default-channel post failed: ${fbErr.message}`);
                }
            }

            jsonStore.write('vote-config', voteConfig);

            // Send DM thank you message
            try {
                const { SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');

                let dmContent = `# <:Cursor:1521228147071127732> Thank You for Voting!\n\n`;
                dmContent += `Your vote for **${client.user.username}** on **DiscordBotList** has been received!\n\n`;

                dmContent += `### ${streakInfo.emoji} Your Stats\n`;
                dmContent += `**Current Streak:** ${userData.streak} vote${userData.streak > 1 ? 's' : ''} in a row\n`;
                dmContent += `**Total Votes:** ${userData.totalVotes}\n`;

                if (voteNpExpiry) {
                    dmContent += `\n### <:Lightning:1521227915537285150> 12h No-Prefix Activated!\n`;
                    dmContent += `You can now run commands **without the prefix** in all servers.\n`;
                    dmContent += `Expires <t:${Math.floor(voteNpExpiry / 1000)}:R> (<t:${Math.floor(voteNpExpiry / 1000)}:t>). Vote again to renew!\n`;
                }

                if (isFirstVote) {
                    dmContent += `\n### 🏅 Badge Earned!\n`;
                    dmContent += `You've earned the **Voter** badge! Check your profile to see it.\n`;
                }

                if (userData.streak >= 7) {
                    dmContent += `\n### <:Fire:1521227907647668374> Streak Bonus\n`;
                    dmContent += `Amazing dedication! Keep your streak going!\n`;
                }

                dmContent += `\n### <:Clock:1521228110408847623> Next Vote\n`;
                dmContent += `You can vote again <t:${nextVoteTime}:R>\n`;
                dmContent += `\n### <:Notificationon:1521227730304106680> Reminders\n`;
                dmContent += `Use \`/myvotes\` to enable vote reminders — I'll DM you when you can vote again!\n`;
                dmContent += `\n-# Your support means everything to us! 💜`;

                const dmContainer = new ContainerBuilder()
                    .setAccentColor(streakInfo.color)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(dmContent));

                const dmBtn = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setLabel('Vote Again in 12h')
                        .setURL('https://discordbotlist.com/bots/xnico')
                        .setStyle(ButtonStyle.Link)
                        .setEmoji('<:Cursor:1521228147071127732>'),
                    new ButtonBuilder()
                        .setLabel('Vote on Top.gg too!')
                        .setURL(`https://top.gg/bot/${client.user.id}/vote`)
                        .setStyle(ButtonStyle.Link)
                        .setEmoji('<:topgg:1521228219066482790>')
                );

                await discordUser.send({ components: [dmContainer, dmBtn], flags: MessageFlags.IsComponentsV2 });
            } catch (dmErr) {
                // User has DMs disabled
            }

            // Schedule vote reminder
            setTimeout(async () => {
                try {
                    const reminderUser = await client.users.fetch(userId).catch(() => null);
                    if (!reminderUser) return;

                    const currentUserVotes = jsonStore.has('user-votes')
                        ? jsonStore.read('user-votes')
                        : {};

                    if (currentUserVotes[userId]?.lastVote > now) return;

                    const currentStreak = currentUserVotes[userId]?.streak || 0;

                    let reminderContent = `# <:Cursor:1521228147071127732> Vote Reminder\n\n`;
                    reminderContent += `Hey **${reminderUser.username}**!\n\n`;
                    reminderContent += `You can now vote for **${client.user.username}** again!\n\n`;

                    if (currentStreak > 0) {
                        reminderContent += `### <:Infotriangle:1521227710381428926> Streak Warning\n`;
                        reminderContent += `You have a **${currentStreak}-vote streak**! Vote soon to keep it.\n\n`;
                    }

                    reminderContent += `-# Click below to vote now!`;

                    const reminderContainer = new ContainerBuilder()
                        .addTextDisplayComponents(new TextDisplayBuilder().setContent(reminderContent));

                    const reminderBtn = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setLabel('Vote on DBL')
                            .setURL('https://discordbotlist.com/bots/xnico')
                            .setStyle(ButtonStyle.Link)
                            .setEmoji('<:Cursor:1521228147071127732>'),
                        new ButtonBuilder()
                            .setLabel('Vote on Top.gg')
                            .setURL(`https://top.gg/bot/${client.user.id}/vote`)
                            .setStyle(ButtonStyle.Link)
                            .setEmoji('<:topgg:1521228219066482790>')
                    );

                    await reminderUser.send({ components: [reminderContainer, reminderBtn], flags: MessageFlags.IsComponentsV2 });
                } catch (reminderErr) { }
            }, 12 * 60 * 60 * 1000);

            log.debug(`DBL vote from ${discordUser.username} (streak: ${userData.streak})`);

        } catch (error) {
            log.error('DBL webhook error', error);
        }
    });

    app.get('/health', (req, res) => {
        res.json({ status: 'ok', uptime: process.uptime() });
    });

    const PORT = process.env.WEBHOOK_PORT || 3000;
    app.listen(PORT, () => {
        log.info(`Webhook server on port ${PORT}`);
    });

    // Dashboard spawning removed from index.js as it is managed by shard.js
}

const token = process.env.TOKEN?.trim();
if (!token) {
    log.critical('TOKEN environment variable is not set!');
    process.exit(1);
}

async function checkRateLimit() {
    try {
        const https = require('https');
        return new Promise((resolve) => {
            const req = https.request({
                hostname: 'discord.com',
                path: '/api/v10/gateway',
                method: 'HEAD',
                timeout: 10000
            }, (res) => {
                if (res.statusCode === 429) {
                    const retryAfter = parseInt(res.headers['retry-after']) || 60;
                    resolve({ rateLimited: true, retryAfter });
                } else {
                    resolve({ rateLimited: false, retryAfter: 0 });
                }
            });
            req.on('error', () => resolve({ rateLimited: false, retryAfter: 0 }));
            req.on('timeout', () => { req.destroy(); resolve({ rateLimited: false, retryAfter: 0 }); });
            req.end();
        });
    } catch {
        return { rateLimited: false, retryAfter: 0 };
    }
}

async function loginWithRetry(maxRetries = 10) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Check for rate limit before attempting login
            const { rateLimited, retryAfter } = await checkRateLimit();
            if (rateLimited) {
                const waitTime = Math.min(retryAfter, 1200); // Cap at 20 minutes
                const mins = Math.floor(waitTime / 60);
                const secs = waitTime % 60;
                log.warning(`Rate limited by Discord. Waiting ${mins}m ${secs}s before login...`);
                await new Promise(r => setTimeout(r, waitTime * 1000));
            }

            log.info(`Logging into Discord... (attempt ${attempt}/${maxRetries})`);

            await client.login(token);
            log.success('Login successful!');
            return;
        } catch (error) {
            log.error(`Login attempt ${attempt} failed: ${error.message}`);

            if (error.message.includes('TOKEN_INVALID') || error.message.includes('invalid token') || error.code === 'TokenInvalid') {
                log.critical('Invalid bot token. Please update TOKEN in Secrets.');
                process.exit(1);
            }

            // Handle rate limit errors
            if (error.status === 429 || error.message.includes('rate limit') || error.message.includes('429')) {
                const waitTime = error.retry_after || 60;
                log.warning(`Rate limited. Waiting ${waitTime}s...`);
                await new Promise(r => setTimeout(r, waitTime * 1000));
                continue; // Don't count this as a failed attempt
            }

            if (attempt < maxRetries) {
                const delay = Math.min(attempt * 10000, 60000); // Exponential up to 60s
                log.info(`Waiting ${delay / 1000}s before retry...`);
                await new Promise(r => setTimeout(r, delay));
            } else {
                log.critical('All login attempts failed.');
                process.exit(1);
            }
        }
    }
}

// Load events
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        const filePath = path.join(eventsPath, file);
        const event = require(filePath);
        if (event.once) {
            client.once(event.name, (...args) => event.execute(...args, client));
        } else {
            client.on(event.name, (...args) => event.execute(...args, client));
        }
    }
}

loginWithRetry();