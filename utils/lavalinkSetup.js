const fs = require('fs');
const path = require('path');
const { LavalinkManager } = require('lavalink-client');
const { ContainerBuilder, TextDisplayBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { formatTime } = require('./helpers');
const { updateMusicPanel, updateVoiceChannelStatus, is247Enabled } = require('./musicPanel');
const { stopLiveCard } = require('./liveMusicCard');
const log = require('./logger-styled');
const jsonStore = require('./jsonStore');
const { getMusicSettings } = require('./musicSettings');

// Shared state maps for music features
const autoplayStatus = new Map();
const lastPlayedTracks = new Map();
const autoplayHistory = new Map();
const panelUpdateIntervals = new Map();
const panelUpdateInProgress = new Map();
const previousVolume = new Map();
const nowPlayingMessages = new Map();
const musicPanelCache = new Map();
const musicPanelChannelCache = new Map();
const inactivityTimers = new Map();

global.musicPanelCache = musicPanelCache;
global.musicPanelChannelCache = musicPanelChannelCache;

// Throttle tracking — prevent log spam from repeated disconnect/reconnect cycles
const nodeDisconnectThrottle = new Map();

// Per-guild cooldowns to prevent rapid reconnect cycling
const socketReconnectCooldown = new Map(); // guildId → ms timestamp of last reconnect

const SOCKET_RECONNECT_COOLDOWN_MS   = 5_000;  // max 1 socket-reconnect per 5s per guild
const NODE_THROTTLE_WINDOW_MS        = 300_000; // 5 minutes for node log throttling

/**
 * Load Lavalink nodes from config/lavalink-nodes.json and create the manager.
 * @returns {LavalinkManager}
 */
function createLavalinkManager(client) {
    const lavalinkConfigPath = path.join(__dirname, '../config/lavalink-nodes.json');
    let lavalinkNodes = [];
    try {
        const config = JSON.parse(fs.readFileSync(lavalinkConfigPath, 'utf8'));
        if (config.nodes && Array.isArray(config.nodes) && config.nodes.length > 0) {
            lavalinkNodes = config.nodes.map(node => ({
                // Retry effectively forever so a node NEVER permanently gives
                // up on its own — the library's single-timer reconnect keeps
                // reviving it (no stacking), so music self-heals without the
                // user ever seeing an error or interruption.
                retryAmount: 100000,
                retryDelay: 10000,
                ...node
            }));
            log.info(`Loaded ${config.nodes.length} Lavalink node(s) from config`);
        } else {
            log.warning('No Lavalink nodes found in config/lavalink-nodes.json');
        }
    } catch (error) {
        log.error('Failed to load config/lavalink-nodes.json:', error.message);
    }

    // ── Self-hosted / private node from env (most reliable) ──
    // Public Lavalink nodes are flaky and come and go. If you run your OWN
    // Lavalink (recommended — same host as the bot), set these env vars and
    // it gets PREPENDED so it's the primary node, with the public list as
    // fallback:
    //   LAVALINK_HOST, LAVALINK_PORT, LAVALINK_PASSWORD,
    //   LAVALINK_SECURE ("true"/"false"), LAVALINK_ID (optional)
    if (process.env.LAVALINK_HOST && process.env.LAVALINK_PASSWORD) {
        const envNode = {
            id: process.env.LAVALINK_ID || 'env-primary',
            host: process.env.LAVALINK_HOST.trim(),
            port: parseInt(process.env.LAVALINK_PORT || '2333', 10),
            authorization: process.env.LAVALINK_PASSWORD,
            secure: /^true$/i.test(process.env.LAVALINK_SECURE || 'false'),
            retryAmount: 100000,
            retryDelay: 10000,
        };
        // De-dupe if the same host:port already exists in the config list.
        lavalinkNodes = lavalinkNodes.filter(n => !(n.host === envNode.host && n.port === envNode.port));
        lavalinkNodes.unshift(envNode);
        log.info(`Using env Lavalink node ${envNode.host}:${envNode.port} (secure=${envNode.secure}) as primary`);
    }

    if (lavalinkNodes.length === 0) {
        log.error('No Lavalink nodes available — music will not work. Set LAVALINK_HOST/PORT/PASSWORD or fix config/lavalink-nodes.json');
    }

    const lavalinkManager = new LavalinkManager({
        nodes: lavalinkNodes,
        sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
        client: {
            id: process.env.CLIENT_ID || client.user?.id,
            username: 'Nico'
        },
        autoSkip: true,
        // IMPORTANT: false — we handle resolve errors in our trackError handler.
        // When true, the library internally auto-skips AND emits trackError,
        // causing our handler to ALSO skip/play, creating a double-action race.
        autoSkipOnResolveError: false,
        emitNewSongsOnly: true,
        playerOptions: {
            applyVolumeAsFilter: false,
            clientBasedPositionUpdateInterval: 250,
            defaultSearchPlatform: "ytsearch",
            volumeDecrementer: 0.75,
            requesterTransformer: (requester) => {
                return {
                    id: requester.id,
                    username: requester.username,
                    avatar: requester.displayAvatarURL()
                };
            },
            onDisconnect: {
                autoReconnect: true,
                destroyPlayer: false
            }
        },
        advancedOptions: {
            debugOptions: {
                noAudio: false,
                playerDestroy: {
                    dontThrowError: true,
                    debugLog: false
                }
            }
        }
    });

    client.lavalinkManager = lavalinkManager;

    // Patch all existing and future nodes to prevent unhandled rejections from fetchInfo failures.
    // The library's open() method is async and bound to a WebSocket 'open' event — if fetchInfo
    // returns a non-JSON response (e.g. proxy error), the thrown error becomes an unhandled rejection.
    // We wrap each node's connect() to safely catch open() errors.
    function patchNodeConnect(node) {
        const origConnect = node.connect.bind(node);
        node.connect = function(sessionId) {
            origConnect(sessionId);
            // After connect() creates the socket, replace the 'open' listener with a safe wrapper
            if (this.socket) {
                const listeners = this.socket.listeners('open');
                if (listeners.length > 0) {
                    const origOpenHandler = listeners[0];
                    this.socket.removeAllListeners('open');
                    this.socket.on('open', async () => {
                        // The library internally does: console.error(e, "ON-OPEN-FETCH") for fetchInfo failures.
                        // Intercept console.error during open() to suppress raw SyntaxError stack traces
                        // from proxy errors and log them cleanly instead.
                        const origConsoleError = console.error;
                        const nodeId = this.id || this.options?.host;
                        console.error = (...args) => {
                            const msg = args.map(a => String(a?.message || a || '')).join(' ');
                            if (msg.includes('ON-OPEN-FETCH') || msg.includes('is not valid JSON') || msg.includes('Proxy erro')) {
                                log.warning(`Lavalink node ${nodeId} failed to fetch /v4/info — will retry`);
                                return;
                            }
                            origConsoleError.apply(console, args);
                        };
                        try {
                            await origOpenHandler.call(this);
                        } catch (err) {
                            log.warning(`Lavalink node ${nodeId} connection error: ${(err.message || '').substring(0, 100)} — will retry`);
                            this.NodeManager.emit('error', this, err);
                            try { this.socket?.close(1000, 'Open-Failed'); } catch(e) {}
                        } finally {
                            console.error = origConsoleError;
                        }
                    });
                }
            }
        };
    }

    // Patch all nodes already created by the constructor
    for (const node of lavalinkManager.nodeManager.nodes.values()) {
        patchNodeConnect(node);
    }

    // Patch future nodes created via createNode
    const origCreateNode = lavalinkManager.nodeManager.createNode.bind(lavalinkManager.nodeManager);
    lavalinkManager.nodeManager.createNode = function(options) {
        const node = origCreateNode(options);
        patchNodeConnect(node);
        return node;
    };

    return lavalinkManager;
}

/**
 * Register all Lavalink event handlers.
 */
function setupLavalinkEvents(client, lavalinkManager) {
    // ── trackStart ──
    lavalinkManager.on('trackStart', async (player, track) => {
        if (!track.isSpeakCmd) {
            log.music(`Playing: ${track.info.title.substring(0, 40)}...`);
        }

        // Clear inactivity disconnect timer since music is playing again
        if (inactivityTimers.has(player.guildId)) {
            clearTimeout(inactivityTimers.get(player.guildId));
            inactivityTimers.delete(player.guildId);
        }

        await updateMusicPanel(client, player, autoplayStatus).catch(err => log.error(`Panel update: ${err.message}`, err));
        await updateVoiceChannelStatus(client, player, 'auto', track);

        if (track.isSpeakCmd) return;

        // Check if there's a music panel for this guild (use cache for performance)
        let hasMusicPanel = musicPanelCache.get(player.guildId);
        if (hasMusicPanel === undefined) {
            hasMusicPanel = false;
            if (jsonStore.has('musicpanel')) {
                try {
                    const panelConfig = jsonStore.read('musicpanel');
                    hasMusicPanel = !!(panelConfig[player.guildId]?.channelId && panelConfig[player.guildId]?.messageId);
                } catch (e) {}
            }
            musicPanelCache.set(player.guildId, hasMusicPanel);
        }

        // Only send separate "Now Playing" message if there's no music panel
        // AND the per-guild "announce" toggle from the dashboard is on.
        const announceEnabled = getMusicSettings(player.guildId).announce;
        if (!hasMusicPanel && announceEnabled) {
            const channel = client.channels.cache.get(player.textChannelId);
            if (channel) {
                const oldData = nowPlayingMessages.get(player.guildId);
                if (oldData) {
                    try {
                        const oldChannel = client.channels.cache.get(oldData.channelId);
                        if (oldChannel) {
                            const oldMessage = await oldChannel.messages.fetch(oldData.messageId).catch(() => null);
                            if (oldMessage && oldMessage.deletable) {
                                await oldMessage.delete().catch(() => {});
                            }
                        }
                    } catch (e) {}
                    nowPlayingMessages.delete(player.guildId);
                }

                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder()
                            .setContent(`# <:Music:1521228141543165982> Now Playing\n\n**[${track.info.title}](${track.info.uri})**\n\n> <:User:1521227714227343380> **Requester:** <@${track.requester.id}>\n> <:Timer:1521227971590095070> **Duration:** ${formatTime(track.info.duration)}`)
                    );
                
                const sentMessage = await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
                if (sentMessage) {
                    nowPlayingMessages.set(player.guildId, { channelId: channel.id, messageId: sentMessage.id });
                }
            }
        }

        // Clear any existing interval for this guild
        if (panelUpdateIntervals.has(player.guildId)) {
            clearInterval(panelUpdateIntervals.get(player.guildId));
            panelUpdateIntervals.delete(player.guildId);
        }

        // Set up auto-update interval (every 5 seconds for panel progress bar)
        const updateInterval = setInterval(async () => {
            if (panelUpdateInProgress.get(player.guildId)) return;
            try {
                panelUpdateInProgress.set(player.guildId, true);
                await updateMusicPanel(client, player, autoplayStatus);
            } catch (err) {
                log.error(`Panel auto-update: ${err.message}`, err);
            } finally {
                panelUpdateInProgress.set(player.guildId, false);
            }
        }, 5000);

        panelUpdateIntervals.set(player.guildId, updateInterval);
    });

    // ── trackEnd ──
    lavalinkManager.on('trackEnd', async (player, track, payload) => {
        if (track) {
            lastPlayedTracks.set(player.guildId, track);

            if (!autoplayHistory.has(player.guildId)) {
                autoplayHistory.set(player.guildId, []);
            }
            const history = autoplayHistory.get(player.guildId);
            history.push({
                identifier: track.info.identifier,
                uri: track.info.uri,
                title: track.info.title,
                timestamp: Date.now()
            });
            if (history.length > 50) {
                history.shift();
            }
        }

        setTimeout(async () => {
            try {
                if (player && !player.destroyed) {
                    await updateMusicPanel(client, player, autoplayStatus);
                }
            } catch (err) {
                log.error(`Panel update in trackEnd: ${err.message}`, err);
            }
        }, 500);
    });

    // ── playerCreate ──
    lavalinkManager.on('playerCreate', (player) => {
        // Apply per-guild "Default Volume" from the dashboard music
        // module. Without this, every freshly-created player ignored
        // the saved volume and started at the lavalink-client default.
        try {
            const settings = getMusicSettings(player.guildId);
            if (typeof player.setVolume === 'function') {
                player.setVolume(settings.defaultVolume).catch(() => {});
            } else {
                player.volume = settings.defaultVolume;
            }
        } catch {}
    });

    // ── playerDestroy ──
    lavalinkManager.on('playerDestroy', async (player) => {
        const guildId = player.guildId;
        const voiceChannelId = player.voiceChannelId;

        // Halt any live "Now Playing" card updates for this guild.
        stopLiveCard(guildId);

        if (inactivityTimers.has(guildId)) {
            clearTimeout(inactivityTimers.get(guildId));
            inactivityTimers.delete(guildId);
        }

        if (panelUpdateIntervals.has(guildId)) {
            clearInterval(panelUpdateIntervals.get(guildId));
            panelUpdateIntervals.delete(guildId);
            panelUpdateInProgress.delete(guildId);
        }

        await updateVoiceChannelStatus(client, { guildId, voiceChannelId }, 'clear');

        try {
            await updateMusicPanel(client, null, autoplayStatus, guildId);
        } catch (err) {
            log.error(`Panel update on playerDestroy: ${err.message}`, err);
        }

        previousVolume.delete(player.guildId);
        lastPlayedTracks.delete(player.guildId);
        autoplayHistory.delete(player.guildId);
        nowPlayingMessages.delete(player.guildId);
        stuckWatchdog.delete(player.guildId);
    });

    // ── trackError ──
    //
    // Since autoSkipOnResolveError is FALSE, the library does NOT auto-skip.
    // We silently advance to the next queued track or stop if the queue is empty.
    //
    // ZERO retries, ZERO fallbacks, ZERO source switching.
    // If a track fails, it fails. We move on. No user-facing messages.
    lavalinkManager.on('trackError', async (player, track, error) => {
        if (!player || player.destroyed) return;

        const errorMsg = (() => {
            if (!error) return 'Unknown error';
            if (typeof error === 'string') return error;
            if (error.message) return error.message;
            if (error.reason) return error.reason;
            return String(error);
        })();
        log.error(`Track error in guild ${player.guildId}: ${errorMsg}`);

        // Silently advance to next track or stop
        if (player.destroyed) return;

        if (player.queue?.tracks?.length > 0) {
            try { await player.skip(); } catch {
                try { if (!player.destroyed) await player.stopPlaying(); } catch {}
            }
        } else {
            try { if (!player.destroyed) await player.stopPlaying(); } catch {}
        }
    });

    // ── trackStuck ──
    //
    // Fired when Lavalink receives no audio frames for `thresholdMs`.
    // Recovery: one seek-restart attempt, then silently skip.
    // No user-facing messages — completely transparent.
    lavalinkManager.on('trackStuck', async (player, track, thresholdMs) => {
        const title = (track?.info?.title || 'Unknown').substring(0, 35);
        log.warning(`Track stuck: "${title}" (threshold ${thresholdMs}ms)`);

        if (!player || player.destroyed) return;

        // Step A: seek-restart — only once, only if we've played > 3s.
        try {
            const pos = player.position || 0;
            if (pos > 3000 && !track?._stuckSeekAttempted) {
                if (track) track._stuckSeekAttempted = true;
                log.info(`trackStuck: seek-restart for "${title}"`);
                await player.seek(Math.max(0, pos - 2000));
                return; // give Lavalink a chance to recover
            }
        } catch {
            // seek failed — fall through to skip
        }

        if (player.destroyed) return;

        // Step B: silently skip to next track or stop.
        if (player.queue?.tracks?.length > 0) {
            try { await player.skip(); } catch {
                try { if (!player.destroyed) await player.stopPlaying(); } catch {}
            }
        } else {
            try { if (!player.destroyed) await player.stopPlaying(); } catch {}
        }
    });

    // ── playerSocketClosed ──
    // Fired when the Lavalink ↔ Discord voice WebSocket drops mid-playback.
    // Silently reconnect and resume — no user-facing messages.
    lavalinkManager.on('playerSocketClosed', async (player, payload) => {
        if (!player || player.destroyed) return;

        const code = payload?.code ?? '?';
        const reason = payload?.reason ?? 'unknown';
        const guildId = player.guildId;

        // Per-guild reconnect cooldown — prevent rapid reconnect cycling
        const now = Date.now();
        const lastReconnect = socketReconnectCooldown.get(guildId) || 0;
        if (now - lastReconnect < SOCKET_RECONNECT_COOLDOWN_MS) {
            return;
        }
        socketReconnectCooldown.set(guildId, now);

        log.warning(`Voice socket closed for guild ${guildId} — code ${code} (${reason})`);

        // Code 4014 means we were disconnected by Discord (kicked/moved) — destroy the player
        if (code === 4014) {
            log.info(`Voice socket: code 4014 (disconnected by Discord) — destroying player`);
            try {
                if (!player.destroyed) await player.destroy();
            } catch (e) {
                log.error(`Voice socket: failed to destroy player after 4014: ${e.message}`);
            }
            return;
        }

        // Give Discord a moment to propagate the new voice state before reconnecting
        await new Promise(r => setTimeout(r, 2000));

        if (player.destroyed) return;

        // Snapshot what was playing *before* reconnecting
        const hadCurrentTrack = !!player.queue?.current;
        const wasPaused = player.paused;
        const resumePos = Math.max(0, (player.position || 0) - 500);

        try {
            if (player.voiceChannelId) {
                await player.connect();
                log.info(`Voice socket: reconnected in guild ${guildId}`);

                // Wait for Lavalink to sync state after reconnect
                await new Promise(r => setTimeout(r, 1500));

                if (player.destroyed) return;

                // Only manually resume if:
                // 1. A track was loaded before disconnect
                // 2. Player is NOT already playing (autoSkip may have resumed it)
                // 3. Player was not paused by the user
                if (hadCurrentTrack && !player.playing && !player.paused && !wasPaused) {
                    await player.play({ position: resumePos, noReplace: true });
                    log.success(`Voice socket: resumed playback in guild ${guildId}`);
                }
            }
        } catch (err) {
            log.error(`Voice socket reconnect failed (${guildId}): ${err.message}`);

            // Silently try to advance — no messages to users
            try {
                if (!player.destroyed && player.queue?.tracks?.length > 0) {
                    try { await player.skip(); } catch { if (!player.destroyed) await player.stopPlaying().catch(() => {}); }
                } else if (!player.destroyed) {
                    await player.stopPlaying().catch(() => {});
                }
            } catch {}
        }
    });

    // ── Client-side position watchdog ──
    // Catches the case where Lavalink believes it's still playing (so trackStuck never fires)
    // but the client-side position has completely frozen — e.g. after a silent node hiccup.
    // Recovery is silent — no user-facing messages, no aggressive actions.
    const stuckWatchdog = new Map(); // guildId → { lastPos, lastPosTime, warnedAt, recovering }

    lavalinkManager.on('playerUpdate', (player, payload) => {
        if (!player || player.destroyed || !player.playing || player.paused) {
            stuckWatchdog.delete(player?.guildId);
            return;
        }

        const guildId = player.guildId;
        const now     = Date.now();
        const pos     = player.position || 0;
        const entry   = stuckWatchdog.get(guildId);

        if (!entry) {
            stuckWatchdog.set(guildId, { lastPos: pos, lastPosTime: now, warnedAt: 0, recovering: false });
            return;
        }

        if (pos !== entry.lastPos) {
            // Position is advancing — healthy
            entry.lastPos     = pos;
            entry.lastPosTime = now;
            entry.warnedAt    = 0;
            entry.recovering  = false;
            return;
        }

        const frozenMs = now - entry.lastPosTime;

        // If frozen for >30s and we haven't tried to recover in the last 90s
        // and no recovery is currently in progress
        if (frozenMs > 30_000 && now - entry.warnedAt > 90_000 && !entry.recovering) {
            entry.warnedAt = now;
            entry.recovering = true;
            log.warning(`Watchdog: player frozen for ${Math.round(frozenMs/1000)}s in guild ${guildId}`);

            // Async recovery (don't block the event)
            (async () => {
                try {
                    if (player.destroyed) return;

                    // Step 1: try seek to nudge Lavalink
                    try {
                        await player.seek(Math.max(0, pos - 1000));
                        log.info(`Watchdog: seek recovery sent for guild ${guildId}`);
                        // Give it time to recover before marking as done
                        await new Promise(r => setTimeout(r, 3000));
                        // Check if position advanced after seek
                        if (!player.destroyed && player.position !== pos) {
                            log.info(`Watchdog: seek recovery successful for guild ${guildId}`);
                            return; // recovered!
                        }
                    } catch {}

                    if (player.destroyed) return;

                    // Step 2: seek didn't work — try reconnect
                    try {
                        if (player.voiceChannelId) {
                            await player.connect();
                            await new Promise(r => setTimeout(r, 1500));
                        }
                        if (player.destroyed) return;
                        // Only resume if not already playing after reconnect
                        if (!player.playing && !player.paused && player.queue?.current) {
                            await player.play({ position: Math.max(0, pos - 500), noReplace: true });
                            log.info(`Watchdog: reconnect recovery for guild ${guildId}`);
                        }
                    } catch {
                        log.warning(`Watchdog: all recovery failed for guild ${guildId}`);
                    }
                } finally {
                    // Reset state regardless of outcome
                    const updated = stuckWatchdog.get(guildId);
                    if (updated) {
                        updated.lastPosTime = Date.now();
                        updated.lastPos = player.position || pos;
                        updated.recovering = false;
                    }
                }
            })();
        }
    });

    // ── queueEnd ──
    lavalinkManager.on('queueEnd', async (player) => {
        log.info(`Queue ended in guild ${player.guildId}`);

        if (panelUpdateIntervals.has(player.guildId)) {
            clearInterval(panelUpdateIntervals.get(player.guildId));
            panelUpdateIntervals.delete(player.guildId);
            panelUpdateInProgress.delete(player.guildId);
        }

        const is247Active = is247Enabled(player.guildId);

        const isAutoplayEnabled = autoplayStatus.get(player.guildId) || false;
        const lastTrack = lastPlayedTracks.get(player.guildId);

        if (isAutoplayEnabled && lastTrack) {
            try {
                log.info(`Autoplay (queueEnd): Searching for related songs to "${lastTrack.info.title}"`);

                const history = autoplayHistory.get(player.guildId) || [];
                const recentIdentifiers = new Set(history.map(h => h.identifier));
                const recentUris = new Set(history.map(h => h.uri).filter(Boolean));
                const recentTitleKeys = new Set(history.map(h => {
                    return (h.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 4).join(' ');
                }).filter(k => k.length > 3));

                recentIdentifiers.add(lastTrack.info.identifier);
                if (lastTrack.info.uri) recentUris.add(lastTrack.info.uri);
                const lastTitleKey = (lastTrack.info.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 4).join(' ');
                if (lastTitleKey.length > 3) recentTitleKeys.add(lastTitleKey);

                const cleanAuthor = (lastTrack.info.author || 'Unknown')
                    .replace(/VEVO$/i, '')
                    .replace(/ - Topic$/i, '')
                    .replace(/Official$/i, '')
                    .replace(/Music$/i, '')
                    .trim();
                
                const cleanTitle = (lastTrack.info.title || '')
                    .replace(/\(Official.*?\)/gi, '')
                    .replace(/\[Official.*?\]/gi, '')
                    .replace(/\(Lyrics.*?\)/gi, '')
                    .replace(/\[Lyrics.*?\]/gi, '')
                    .replace(/\(Audio.*?\)/gi, '')
                    .replace(/\(Music Video\)/gi, '')
                    .replace(/\[MV\]/gi, '')
                    .replace(/\|.*$/g, '')
                    .replace(/ft\..*$/gi, '')
                    .replace(/feat\..*$/gi, '')
                    .trim();
                
                const titleWords = cleanTitle.split(/\s+/).filter(w => w.length > 2);
                
                const searchStrategies = [
                    `${cleanAuthor} ${titleWords.slice(0, 2).join(' ')}`,
                    `${cleanAuthor} top songs`,
                    `${cleanAuthor} popular`,
                    `songs like ${titleWords.slice(0, 3).join(' ')}`,
                    `${titleWords.slice(0, 2).join(' ')} mix`,
                    `${cleanAuthor} best hits`,
                    `${cleanAuthor} ${titleWords[titleWords.length - 1] || ''} similar`,
                ];
                
                for (let i = searchStrategies.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [searchStrategies[i], searchStrategies[j]] = [searchStrategies[j], searchStrategies[i]];
                }

                let relatedTrack = null;

                for (const searchQuery of searchStrategies) {
                    if (relatedTrack || player.destroyed) break;

                    try {
                        log.info(`Autoplay: Trying search "${searchQuery}"`);
                        
                        // Timeout to prevent hanging if node is flaky
                        const result = await Promise.race([
                            player.search({ query: searchQuery }, lastTrack.requester),
                            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
                        ]);

                        if (!result?.tracks || result.tracks.length === 0) {
                            continue;
                        }

                        const availableTracks = result.tracks.filter(t => {
                            if (t.info.identifier === lastTrack.info.identifier) return false;
                            if (recentIdentifiers.has(t.info.identifier)) return false;
                            if (t.info.uri && recentUris.has(t.info.uri)) return false;
                            const candidateTitleKey = (t.info.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).slice(0, 4).join(' ');
                            if (candidateTitleKey.length > 3 && recentTitleKeys.has(candidateTitleKey)) return false;
                            if (t.info.duration > 0 && (t.info.duration < 30000 || t.info.duration > 900000)) return false;
                            return true;
                        });

                        if (availableTracks.length > 0) {
                            const selectionPool = availableTracks.slice(0, 15);
                            const randomIndex = Math.floor(Math.random() * selectionPool.length);
                            relatedTrack = selectionPool[randomIndex];
                            log.success(`Autoplay: Found track "${relatedTrack.info.title}"`);
                            break;
                        }
                    } catch (searchError) {
                        log.warning(`Autoplay search failed: ${searchError.message}`);
                        continue;
                    }
                }

                if (relatedTrack) {
                    relatedTrack.requester = lastTrack.requester;

                    try {
                        if (player.destroyed) return;

                        await player.queue.add(relatedTrack);
                        log.info(`Autoplay: Added to queue`);
                        
                        // Wait for autoSkip to potentially start playback.
                        await new Promise(r => setTimeout(r, 600));

                        if (player.destroyed) return;

                        // Only call play() if autoSkip didn't already start it.
                        // Use noReplace to avoid interrupting if autoSkip won.
                        if (!player.playing && !player.paused) {
                            await player.play({ noReplace: true });
                            log.success(`Autoplay: Now playing "${relatedTrack.info.title}"`);
                        } else {
                            log.info(`Autoplay: autoSkip handled playback`);
                        }
                    } catch (playError) {
                        log.warning(`Autoplay play error: ${playError.message}`);
                    }

                    return;
                } else {
                    log.info(`Autoplay: Could not find any new tracks after trying all strategies`);
                }
            } catch (error) {
                log.error(`Autoplay (queueEnd) error: ${error.message}`, error);
            }
        }

        try {
            await updateMusicPanel(client, player, autoplayStatus);
        } catch (err) {
            log.error(`Panel update failed in queueEnd: ${err.message}`, err);
        }

        await updateVoiceChannelStatus(client, player, is247Active ? 'waiting' : 'clear');

        if (!is247Active) {
            if (inactivityTimers.has(player.guildId)) {
                clearTimeout(inactivityTimers.get(player.guildId));
            }
            
            const guildIdForTimer = player.guildId;
            const disconnectTimer = setTimeout(async () => {
                inactivityTimers.delete(guildIdForTimer);
                try {
                    const currentPlayer = client.lavalinkManager?.getPlayer(guildIdForTimer);
                    if (currentPlayer && !currentPlayer.queue.current && !currentPlayer.playing && (!currentPlayer.queue.tracks || currentPlayer.queue.tracks.length === 0)) {
                        log.info(`Inactivity disconnect: Destroying player in guild ${guildIdForTimer} after 10 minutes of idle`);
                        await currentPlayer.destroy();
                    }
                } catch (err) {
                    log.error(`Inactivity disconnect error: ${err.message}`);
                }
            }, 10 * 60 * 1000);
            
            inactivityTimers.set(player.guildId, disconnectTimer);
            log.info(`Inactivity timer started for guild ${player.guildId} (10 minutes)`);
        }
    });

    // ── Node: disconnect (with failover) ──
    lavalinkManager.nodeManager.on('disconnect', async (node, reason) => {
        const now = Date.now();
        const lastLog = nodeDisconnectThrottle.get(node.id) || 0;
        const shouldLog = now - lastLog > NODE_THROTTLE_WINDOW_MS;

        if (shouldLog) {
            nodeDisconnectThrottle.set(node.id, now);
            log.warning(`Lavalink disconnected: ${node.id} — code ${reason?.code || 'unknown'}`);
        }

        // Only consider nodes that have been connected for at least 10s
        // to avoid bouncing players between two flaky nodes.
        const availableNodes = [...lavalinkManager.nodeManager.nodes.values()].filter(
            n => n.connected && n.id !== node.id
        );

        if (availableNodes.length === 0) {
            if (shouldLog) log.warning('No healthy Lavalink nodes available — waiting for reconnect...');
            return;
        }

        const fallbackNode = availableNodes[0];

        const playersToMigrate = [...lavalinkManager.players.values()].filter(
            p => p.node?.id === node.id
        );

        if (playersToMigrate.length === 0) return;

        if (shouldLog) log.info(`Failing over ${playersToMigrate.length} player(s) → ${fallbackNode.id}`);

        for (const player of playersToMigrate) {
            try {
                player.node = fallbackNode;
                if (player.voiceChannelId && !player.destroyed) {
                    await player.connect();
                    // Wait for connection to settle before attempting resume
                    await new Promise(r => setTimeout(r, 1000));
                    if (!player.destroyed && player.queue.current && !player.playing && !player.paused) {
                        await player.play({ noReplace: false });
                    }
                }
            } catch (err) {
                log.error(`Failed to migrate player ${player.guildId}: ${err.message}`);
            }
        }

        if (shouldLog) log.success(`Failover complete: ${playersToMigrate.length} player(s) moved to ${fallbackNode.id}`);
    });

    // ── Node: reconnecting ──
    lavalinkManager.nodeManager.on('reconnecting', (node) => {
        const now = Date.now();
        const lastLog = nodeDisconnectThrottle.get(`reconn_${node.id}`) || 0;
        if (now - lastLog > NODE_THROTTLE_WINDOW_MS) {
            nodeDisconnectThrottle.set(`reconn_${node.id}`, now);
            log.info(`Reconnecting to ${node.id}...`);
        }
    });

    // ── Node: connect ──
    lavalinkManager.nodeManager.on('connect', (node) => {
        nodeDisconnectThrottle.delete(node.id);
        nodeDisconnectThrottle.delete(`reconn_${node.id}`);
        nodeDisconnectThrottle.delete(`err_${node.id}`);

        const totalNodes = lavalinkManager.nodeManager.nodes.size;
        const connectedNodes = [...lavalinkManager.nodeManager.nodes.values()].filter(n => n.connected).length;
        log.success(`Lavalink: ${node.id} (${connectedNodes}/${totalNodes} nodes online)`);
    });

    // ── Node: error ──
    lavalinkManager.nodeManager.on('error', (node, error) => {
        const now = Date.now();
        const lastLog = nodeDisconnectThrottle.get(`err_${node.id}`) || 0;
        if (now - lastLog > NODE_THROTTLE_WINDOW_MS) {
            nodeDisconnectThrottle.set(`err_${node.id}`, now);
            const errMsg = error?.message || 'Connection failed';
            // Detect proxy/non-JSON response errors from fetchInfo
            if (errMsg.includes('does not provide any /v4/info') || errMsg.includes('is not valid JSON')) {
                log.warning(`Lavalink node ${node.id} unreachable (proxy/API error) — will retry automatically`);
            } else {
                log.error(`Lavalink node error (${node.id}): ${errMsg}`);
            }
        }

        const availableNodes = [...lavalinkManager.nodeManager.nodes.values()].filter(
            n => n.connected && n.id !== node.id
        );

        if (availableNodes.length > 0) {
            const affectedPlayers = [...lavalinkManager.players.values()].filter(
                p => p.node?.id === node.id
            );
            for (const player of affectedPlayers) {
                try { player.node = availableNodes[0]; } catch (e) {}
            }
        }
    });

    // ── Raw event forwarding ──
    client.on('raw', (d) => lavalinkManager.sendRawData(d));
}

/**
 * Initialize Lavalink (call in client ready event) and reconnect 24/7 channels.
 */
async function initLavalink(client, lavalinkManager) {
    try {
        await lavalinkManager.init({ id: client.user.id, username: client.user.username });
        
        // Wait for nodes to attempt connection, tolerating individual node failures
        await new Promise(resolve => setTimeout(resolve, 5000));
        const connectedNodes = [...lavalinkManager.nodeManager.nodes.values()].filter(n => n.connected);
        const totalNodes = lavalinkManager.nodeManager.nodes.size;
        
        if (connectedNodes.length > 0) {
            log.success(`Lavalink • ${connectedNodes.length}/${totalNodes} nodes online • YouTube, Spotify, SoundCloud`);
            if (connectedNodes.length < totalNodes) {
                const offlineNodes = [...lavalinkManager.nodeManager.nodes.values()]
                    .filter(n => !n.connected)
                    .map(n => n.id);
                log.warning(`Offline nodes (will auto-reconnect): ${offlineNodes.join(', ')}`);
            }
        } else {
            log.warning('Lavalink • No nodes connected yet — will retry automatically');
        }

        // Auto-reconnect to 24/7 voice channels (premium-only)
        if (jsonStore.has('musicpanel-247')) {
            let config247;
            try {
                config247 = jsonStore.read('musicpanel-247');
            } catch (error) {
                log.error(`24/7 config parse failed: ${error.message}`, error);
                config247 = {};
            }

            let reconnected = 0;
            let configChanged = false;

            for (const [guildId, data] of Object.entries(config247)) {
                if (data.enabled && data.voiceChannelId) {
                    // 24/7 is gated at enable time; honour the saved
                    // config strictly so channels rejoin after a restart.
                    // (The old isServerPremium() re-check always returned
                    // false since server premium was discontinued, which
                    // silently disabled all 24/7 reconnects.)
                    try {
                        const guild = client.guilds.cache.get(guildId);
                        if (!guild) {
                            delete config247[guildId];
                            configChanged = true;
                            continue;
                        }

                        const voiceChannel = guild.channels.cache.get(data.voiceChannelId);
                        if (!voiceChannel) {
                            delete config247[guildId];
                            configChanged = true;
                            continue;
                        }

                        let textChannelId = data.textChannelId;

                        if (!textChannelId) {
                            if (jsonStore.has('musicpanel')) {
                                const panelConfig = jsonStore.read('musicpanel');
                                textChannelId = panelConfig[guildId]?.channelId;
                            }
                        }

                        if (!textChannelId) {
                            const firstTextChannel = guild.channels.cache.find(ch => ch.type === 0);
                            textChannelId = firstTextChannel?.id;
                        }

                        if (!textChannelId) continue;

                        const availableNodes = lavalinkManager.nodeManager.leastUsedNodes();
                        if (!availableNodes || availableNodes.length === 0) continue;

                        const player = await lavalinkManager.createPlayer({
                            guildId: guildId,
                            voiceChannelId: data.voiceChannelId,
                            textChannelId: textChannelId,
                            selfDeaf: true,
                            selfMute: false,
                            volume: 100
                        });

                        await player.connect();
                        reconnected++;
                        log.debug(`24/7: ${guild.name}`);
                    } catch (error) {
                        log.error(`24/7 reconnect failed: ${guildId}`, error);
                    }
                }
            }

            if (configChanged) {
                jsonStore.write('musicpanel-247', config247);
            }

            if (reconnected > 0) {
                log.success(`${reconnected} 24/7 channels reconnected`);
            }
        }
    } catch (error) {
        const errMsg = error?.message || String(error);
        // Suppress noisy proxy/JSON parse errors from unhealthy nodes
        if (errMsg.includes('does not provide any /v4/info') || errMsg.includes('is not valid JSON') || errMsg.includes('Proxy erro')) {
            log.warning(`Lavalink init: some nodes unreachable (${errMsg.substring(0, 80)}) — retrying...`);
        } else {
            log.error(`Lavalink init failed: ${errMsg}`, error);
        }
        log.warning('Music limited - retrying...');

        setTimeout(async () => {
            try {
                await lavalinkManager.init({ id: client.user.id, username: client.user.username });
            } catch (retryError) {
                const retryMsg = retryError?.message || String(retryError);
                if (retryMsg.includes('does not provide any /v4/info') || retryMsg.includes('is not valid JSON')) {
                    log.warning(`Lavalink retry: nodes still unreachable — will keep retrying automatically`);
                } else {
                    log.error(`Retry failed: ${retryMsg}`, retryError);
                }
            }
        }, 5000);
    }
}

/**
 * Force an immediate reconnect of every Lavalink node that isn't currently
 * connected. Used by the `fix` command so users can self-heal music when a
 * node has dropped offline (instead of waiting for the passive retry loop).
 *
 * For each offline node we close any lingering half-open socket, then call
 * the node's (patched) connect(). After a short settle window we re-count
 * the online nodes and return a summary the command can render.
 *
 * @param {import('lavalink-client').LavalinkManager} lavalinkManager
 * @param {object}  [opts]
 * @param {number}  [opts.waitMs=4500]  How long to wait for sockets to open.
 * @returns {Promise<{total:number, onlineBefore:number, online:number, reconnected:number, attempted:number, nodes:{id:string, connected:boolean}[]}>}
 */
async function reconnectAllNodes(lavalinkManager, { waitMs = 4500 } = {}) {
    const empty = { total: 0, onlineBefore: 0, online: 0, reconnected: 0, attempted: 0, nodes: [] };
    if (!lavalinkManager?.nodeManager?.nodes) return empty;

    const nodes = [...lavalinkManager.nodeManager.nodes.values()];
    const onlineBefore = nodes.filter(n => n.connected).length;
    let attempted = 0;

    for (const node of nodes) {
        if (node.connected) continue;
        attempted++;
        try {
            // Close any stale/half-open socket so connect() starts clean.
            try { node.socket?.close?.(1000, 'manual-fix-reconnect'); } catch { /* ignore */ }
            await node.connect();
        } catch (err) {
            log.warning(`[fix] reconnect attempt failed for node ${node.id}: ${(err?.message || err || '').toString().substring(0, 100)}`);
        }
    }

    // Give the sockets time to open + fetch /v4/info before re-counting.
    if (attempted > 0) await new Promise(r => setTimeout(r, waitMs));

    const online = nodes.filter(n => n.connected).length;
    return {
        total: nodes.length,
        onlineBefore,
        online,
        reconnected: Math.max(0, online - onlineBefore),
        attempted,
        nodes: nodes.map(n => ({ id: n.id, connected: !!n.connected })),
    };
}

module.exports = {
    createLavalinkManager,
    setupLavalinkEvents,
    initLavalink,
    reconnectAllNodes,
    // Expose shared state so index.js and commands can still access them
    autoplayStatus,
    lastPlayedTracks,
    autoplayHistory,
    panelUpdateIntervals,
    panelUpdateInProgress,
    previousVolume,
    nowPlayingMessages,
    musicPanelCache,
    musicPanelChannelCache,
    inactivityTimers,
};
