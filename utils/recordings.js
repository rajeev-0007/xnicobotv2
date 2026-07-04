const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
    AttachmentBuilder,
    PermissionFlagsBits,
} = require('discord.js');
const {
    EndBehaviorType,
    VoiceConnectionStatus,
    entersState,
    getVoiceConnection,
    joinVoiceChannel,
} = require('@discordjs/voice');
let OpusScript;
try {
    OpusScript = require('opusscript');
} catch {
    OpusScript = null;
}
let ffmpegPath;
try {
    ffmpegPath = require('ffmpeg-static');
} catch (error) {
    console.warn('[Record] ffmpeg-static not found. MP3 conversion will be unavailable.');
    ffmpegPath = null;
}
const { componentPayload } = require('./hybrid');

const recordingsRoot = path.join(__dirname, '..', 'recordings');
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BIT_DEPTH = 16;
const FRAME_SIZE = 960;
const FRAME_DURATION_MS = 20;
const HEADER_BYTES = 44;
const MIX_FRAME_BYTES = SAMPLE_RATE * CHANNELS * (BIT_DEPTH / 8) * FRAME_DURATION_MS / 1000;
const MAX_MIX_QUEUE_BYTES = MIX_FRAME_BYTES * 250;
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const MAX_UPLOAD_FILES = 10;
const DEFAULT_MAX_MINUTES = 60;
const RECORDING_CLEANUP_HOURS = 24; // Delete recordings after 24 hours
const RECORDING_MODES = {
    GLOBAL: 'global',
    SEPARATE: 'separate',
};

const sessions = new Map();
let cleanupInterval = null;

/**
 * Start the automatic cleanup of old recordings
 * Runs every hour and deletes recordings older than 24 hours
 */
function startCleanupTask() {
    if (cleanupInterval) return;
    
    // Run cleanup immediately on start
    cleanOldRecordings().catch((error) => {
        console.error('[Record] Initial cleanup failed:', error);
    });
    
    // Run cleanup every hour
    cleanupInterval = setInterval(() => {
        cleanOldRecordings().catch((error) => {
            console.error('[Record] Cleanup task failed:', error);
        });
    }, 60 * 60 * 1000); // 1 hour
    
    if (cleanupInterval.unref) cleanupInterval.unref();
    console.log('[Record] Cleanup task started (runs every hour, deletes recordings older than 24 hours)');
}

/**
 * Stop the automatic cleanup task
 */
function stopCleanupTask() {
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        console.log('[Record] Cleanup task stopped');
    }
}

/**
 * Delete recordings older than RECORDING_CLEANUP_HOURS
 */
async function cleanOldRecordings() {
    try {
        if (!fs.existsSync(recordingsRoot)) {
            return;
        }

        const now = Date.now();
        const maxAge = RECORDING_CLEANUP_HOURS * 60 * 60 * 1000;
        let deletedCount = 0;
        let deletedSize = 0;

        const guildDirs = await fs.promises.readdir(recordingsRoot).catch(() => []);
        
        for (const guildId of guildDirs) {
            const guildPath = path.join(recordingsRoot, guildId);
            const stat = await fs.promises.stat(guildPath).catch(() => null);
            
            if (!stat?.isDirectory()) continue;

            const sessionDirs = await fs.promises.readdir(guildPath).catch(() => []);
            
            for (const sessionDir of sessionDirs) {
                const sessionPath = path.join(guildPath, sessionDir);
                const sessionStat = await fs.promises.stat(sessionPath).catch(() => null);
                
                if (!sessionStat?.isDirectory()) continue;

                const age = now - sessionStat.mtimeMs;
                
                if (age > maxAge) {
                    // Calculate size before deletion
                    const size = await getDirectorySize(sessionPath).catch(() => 0);
                    
                    // Delete the session directory
                    await fs.promises.rm(sessionPath, { recursive: true, force: true }).catch(() => null);
                    
                    deletedCount++;
                    deletedSize += size;
                    console.log(`[Record] Deleted old recording: ${sessionDir} (${formatBytes(size)}, ${Math.floor(age / 3600000)}h old)`);
                }
            }
            
            // Clean up empty guild directories
            const remainingSessions = await fs.promises.readdir(guildPath).catch(() => []);
            if (remainingSessions.length === 0) {
                await fs.promises.rmdir(guildPath).catch(() => null);
            }
        }

        if (deletedCount > 0) {
            console.log(`[Record] Cleanup complete: ${deletedCount} recording(s) deleted (${formatBytes(deletedSize)} freed)`);
        }
    } catch (error) {
        console.error('[Record] Error during cleanup:', error);
    }
}

/**
 * Calculate total size of a directory
 */
async function getDirectorySize(dirPath) {
    let totalSize = 0;
    
    try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            
            if (entry.isDirectory()) {
                totalSize += await getDirectorySize(fullPath);
            } else {
                const stat = await fs.promises.stat(fullPath).catch(() => null);
                if (stat) totalSize += stat.size;
            }
        }
    } catch (error) {
        // Ignore errors
    }
    
    return totalSize;
}

async function startRecording({
    actor,
    client,
    guild,
    maxMinutes = DEFAULT_MAX_MINUTES,
    mode = RECORDING_MODES.SEPARATE,
    textChannel,
    voiceChannel,
}) {
    if (sessions.has(guild.id)) {
        const session = sessions.get(guild.id);
        return {
            ok: false,
            message: `A recording is already running in <#${session.channelId}>.`,
        };
    }

    const blocked = getStartBlock(guild, voiceChannel);
    if (blocked) return { ok: false, message: blocked };

    const oldConnection = getVoiceConnection(guild.id);
    if (oldConnection) oldConnection.destroy();

    const startedAt = new Date();
    const outputDir = path.join(
        recordingsRoot,
        guild.id,
        `${formatTimestampForPath(startedAt)}-${actor.id}`,
    );
    
    try {
        fs.mkdirSync(outputDir, { recursive: true });
    } catch (error) {
        return {
            ok: false,
            message: `Failed to create recording directory: ${formatError(error)}`,
        };
    }

    let connection;
    try {
        connection = joinVoiceChannel({
            adapterCreator: guild.voiceAdapterCreator,
            channelId: voiceChannel.id,
            guildId: guild.id,
            selfDeaf: false,
            selfMute: true,
        });

        await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch (error) {
        if (connection) connection.destroy();
        return {
            ok: false,
            message: `I could not join ${voiceChannel}: ${formatError(error)}`,
        };
    }

    const session = {
        actorId: actor.id,
        channelId: voiceChannel.id,
        client,
        connection,
        guildId: guild.id,
        maxMinutes,
        mode: normalizeRecordingMode(mode),
        outputDir,
        pendingUserIds: new Set(),
        participants: new Map(),
        receiver: connection.receiver,
        startedAt,
        textChannelId: textChannel?.id || null,
    };

    if (session.mode === RECORDING_MODES.GLOBAL) {
        session.mix = createGlobalMixTrack(session);
        session.mix.interval = setInterval(() => {
            try {
                writeGlobalMixFrame(session, false);
            } catch (error) {
                console.error('[Record] Mix frame write error:', error);
            }
        }, FRAME_DURATION_MS);
    }

    session.onSpeakingStart = (userId) => {
        beginUserTrack(session, userId).catch((error) => {
            console.error('[Record] Failed to record speaker:', error);
        });
    };
    
    // Handle connection errors
    connection.on('error', (error) => {
        console.error('[Record] Voice connection error:', error);
        stopRecording(guild.id, { reason: 'connection error' }).catch(() => {});
    });
    
    connection.on('stateChange', (oldState, newState) => {
        if (newState.status === VoiceConnectionStatus.Disconnected) {
            console.warn('[Record] Voice connection disconnected');
            stopRecording(guild.id, { reason: 'disconnected' }).catch(() => {});
        }
    });
    
    session.receiver.speaking.on('start', session.onSpeakingStart);
    session.stopTimer = setTimeout(() => {
        stopRecording(guild.id, { reason: 'time limit reached' })
            .then((result) => notifyRecordingStopped(client, result))
            .catch((error) => console.error('[Record] Auto-stop failed:', error));
    }, Math.max(1, maxMinutes) * 60 * 1000);

    sessions.set(guild.id, session);

    return {
        ok: true,
        message: [
            `Recording started in ${voiceChannel}.`,
            session.mode === RECORDING_MODES.GLOBAL
                ? 'Global mix is on. Everyone will be recorded into one MP3.'
                : 'Each speaker will be saved as a separate MP3 track.',
            `Use \`/record stop\` when you are done.`,
            `Auto-stop: ${maxMinutes} minute(s).`,
        ].join('\n'),
        session,
    };
}

async function beginUserTrack(session, userId) {
    if (
        !sessions.has(session.guildId)
        || session.participants.has(userId)
        || session.pendingUserIds.has(userId)
    ) {
        return;
    }

    session.pendingUserIds.add(userId);

    try {
        const guild = session.client.guilds.cache.get(session.guildId);
        const member = guild
            ? await guild.members.fetch(userId).catch(() => null)
            : null;
        if (!sessions.has(session.guildId) || session.participants.has(userId)) {
            return;
        }

        const displayName = member?.displayName || member?.user?.username || `user-${userId}`;
        const fileName = session.mode === RECORDING_MODES.GLOBAL
            ? null
            : `${safeFileName(displayName)}-${userId}.wav`;
        const filePath = fileName ? path.join(session.outputDir, fileName) : null;
        if (filePath) fs.writeFileSync(filePath, createWavHeader(0));

        const fileStream = filePath ? fs.createWriteStream(filePath, { flags: 'a' }) : null;
        const decoder = new OpusScript(SAMPLE_RATE, CHANNELS, OpusScript.Application.AUDIO);
        const subscription = session.receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.Manual,
            },
        });

        const participant = {
            decoder,
            displayName,
            droppedFrames: 0,
            fileName,
            filePath,
            fileStream,
            invalidPackets: 0,
            mode: session.mode,
            packetCount: 0,
            pcmBytes: 0,
            queue: [],
            queuedBytes: 0,
            startedAt: new Date(),
            subscription,
            userId,
        };
        session.participants.set(userId, participant);

        subscription.on('data', (packet) => {
            participant.packetCount += 1;
            writeDecodedPacket(participant, packet);
        });
        subscription.on('error', (error) => {
            console.warn(`[Record] Receive stream failed for ${userId}:`, error?.message || error);
        });
        fileStream?.on('error', (error) => {
            console.warn(`[Record] File write failed for ${userId}:`, error?.message || error);
        });
    } finally {
        session.pendingUserIds.delete(userId);
    }
}

function writeDecodedPacket(participant, packet) {
    if (!packet?.length || packet.length > OpusScript.MAX_PACKET_SIZE) {
        participant.invalidPackets += 1;
        return;
    }

    try {
        const pcm = participant.decoder.decode(packet);
        if (!pcm?.length) return;

        participant.pcmBytes += pcm.length;
        if (participant.mode === RECORDING_MODES.GLOBAL) {
            participant.queue.push(pcm);
            participant.queuedBytes += pcm.length;
            trimParticipantQueue(participant);
            return;
        }

        if (participant.fileStream && !participant.fileStream.destroyed) {
            participant.fileStream.write(pcm);
        }
    } catch (error) {
        participant.invalidPackets += 1;
        console.warn(`[Record] Decode error for ${participant.userId}:`, error?.message);
    }
}

async function stopRecording(guildId, { reason = 'manual stop' } = {}) {
    const session = sessions.get(guildId);
    if (!session) {
        return {
            ok: false,
            message: 'No recording is running in this server.',
        };
    }

    // Remove session immediately to prevent double-stop
    sessions.delete(guildId);
    
    // Clean up timers and listeners
    if (session.stopTimer) clearTimeout(session.stopTimer);
    if (session.receiver && session.onSpeakingStart) {
        session.receiver.speaking.off('start', session.onSpeakingStart);
    }
    if (session.mix?.interval) clearInterval(session.mix.interval);

    const durationMs = Date.now() - session.startedAt.getTime();
    const files = [];

    // Finalize all participants
    for (const participant of session.participants.values()) {
        try {
            const finalized = await finalizeParticipant(participant);
            if (finalized) files.push(finalized);
        } catch (error) {
            console.error(`[Record] Failed to finalize participant ${participant.userId}:`, error);
        }
    }

    // Finalize global mix if applicable
    if (session.mode === RECORDING_MODES.GLOBAL) {
        try {
            const finalizedMix = await finalizeGlobalMix(session);
            if (finalizedMix) files.push(finalizedMix);
        } catch (error) {
            console.error('[Record] Failed to finalize global mix:', error);
        }
    }

    // Destroy connection
    try {
        if (session.connection) session.connection.destroy();
    } catch (error) {
        console.error('[Record] Error destroying connection:', error);
    }

    return {
        ok: true,
        durationMs,
        files,
        outputDir: session.outputDir,
        reason,
        session,
    };
}

async function finalizeParticipant(participant) {
    try {
        if (participant.subscription) {
            participant.subscription.destroy();
        }
    } catch (error) {
        console.warn(`[Record] Error destroying subscription for ${participant.userId}:`, error);
    }
    
    try {
        if (participant.decoder?.delete) {
            participant.decoder.delete();
        }
    } catch (error) {
        console.warn(`[Record] Error deleting decoder for ${participant.userId}:`, error);
    }

    if (participant.mode === RECORDING_MODES.GLOBAL) return null;

    await wait(250);
    
    try {
        await endWritable(participant.fileStream);
    } catch (error) {
        console.warn(`[Record] Error ending file stream for ${participant.userId}:`, error);
    }

    if (participant.pcmBytes <= 0) {
        await fs.promises.rm(participant.filePath, { force: true }).catch(() => null);
        return null;
    }

    try {
        await patchWavHeader(participant.filePath, participant.pcmBytes);
    } catch (error) {
        console.error(`[Record] Failed to patch WAV header for ${participant.userId}:`, error);
        return null;
    }
    
    const playable = await createPlayableAudio(participant.filePath).catch((error) => {
        console.warn(`[Record] MP3 conversion failed for ${participant.userId}:`, error?.message || error);
        return null;
    });
    
    const attachmentPath = playable?.filePath || participant.filePath;
    const attachmentName = playable?.fileName || participant.fileName;
    
    let stat;
    try {
        stat = await fs.promises.stat(attachmentPath);
    } catch (error) {
        console.error(`[Record] Failed to stat file for ${participant.userId}:`, error);
        return null;
    }

    return {
        attachmentName,
        attachmentPath,
        displayName: participant.displayName,
        fileName: participant.fileName,
        filePath: participant.filePath,
        invalidPackets: participant.invalidPackets,
        packetCount: participant.packetCount,
        size: stat.size,
        userId: participant.userId,
    };
}

function getRecording(guildId) {
    return sessions.get(guildId) || null;
}

function formatRecordingStatus(session) {
    if (!session) return 'No recording is running in this server.';

    return [
        `Voice channel: <#${session.channelId}>`,
        `Mode: **${session.mode === RECORDING_MODES.GLOBAL ? 'global mix' : 'separate tracks'}**`,
        `Started by: <@${session.actorId}>`,
        `Started: <t:${Math.floor(session.startedAt.getTime() / 1000)}:R>`,
        `Auto-stop: **${session.maxMinutes}m**`,
        `Tracks active: **${session.participants.size}**`,
    ].join('\n');
}

function getUploadPlan(result) {
    const uploadable = [];
    const omitted = [];
    let uploadBytes = 0;

    for (const file of result.files || []) {
        const nextBytes = uploadBytes + file.size;
        if (
            uploadable.length < MAX_UPLOAD_FILES
            && file.size <= MAX_UPLOAD_BYTES
            && nextBytes <= MAX_UPLOAD_BYTES
        ) {
            uploadable.push(file);
            uploadBytes = nextBytes;
        } else {
            omitted.push(file);
        }
    }

    return { omitted, uploadable };
}

function recordingSummaryPayload(result, title = 'Recording stopped') {
    const { omitted, uploadable } = getUploadPlan(result);
    const lines = [
        result.session?.mode ? `Mode: **${result.session.mode === RECORDING_MODES.GLOBAL ? 'global mix' : 'separate tracks'}**` : null,
        `Reason: **${result.reason || 'manual stop'}**`,
        result.durationMs ? `Duration: **${formatDuration(result.durationMs)}**` : null,
        `Tracks recorded: **${result.files?.length || 0}**`,
        uploadable.length ? `Playable tracks: **${uploadable.length}** - posted below` : null,
        omitted.length ? `Not uploaded: **${omitted.length}** track(s) were too large or over the attachment limit.` : null,
        result.files?.length ? '' : 'No voice was captured. Someone needs to speak after recording starts.',
        result.files?.length ? formatTrackList(result.files) : null,
    ].filter((line) => line !== null);

    return componentPayload(title, lines.join('\n'));
}

function recordingAudioPayload(result) {
    const { uploadable } = getUploadPlan(result);
    if (!uploadable.length) return null;

    const payload = {
        allowedMentions: { parse: [], repliedUser: false },
        files: uploadable.map((file) =>
            new AttachmentBuilder(file.attachmentPath || file.filePath, {
                name: file.attachmentName || file.fileName,
            }),
        ),
    };

    return payload;
}

function recordingResultPayload(result, title = 'Recording stopped') {
    return recordingSummaryPayload(result, title);
}

async function notifyRecordingStopped(client, result) {
    const textChannelId = result.session?.textChannelId;
    if (!textChannelId) return;

    const channel = await client.channels.fetch(textChannelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;

    await channel.send(recordingSummaryPayload(result, 'Recording auto-stopped')).catch((error) => {
        console.warn('[Record] Could not send auto-stop notice:', error?.message || error);
    });

    const audioPayload = recordingAudioPayload(result);
    if (audioPayload) {
        await channel.send(audioPayload).catch((error) => {
            console.warn('[Record] Could not send auto-stop audio:', error?.message || error);
        });
    }
}

function getStartBlock(guild, voiceChannel) {
    if (!voiceChannel?.isVoiceBased?.()) return 'Join a voice channel first, or choose one with `/record start channel:#voice`.';

    const me = guild.members.me;
    const permissions = voiceChannel.permissionsFor?.(me);
    if (permissions) {
        const missing = [];
        if (!permissions.has(PermissionFlagsBits.ViewChannel)) missing.push('View Channel');
        if (!permissions.has(PermissionFlagsBits.Connect)) missing.push('Connect');
        if (missing.length) return `I need ${missing.join(', ')} in ${voiceChannel}.`;
    }

    return null;
}

function createWavHeader(dataLength) {
    const header = Buffer.alloc(HEADER_BYTES);
    const byteRate = SAMPLE_RATE * CHANNELS * (BIT_DEPTH / 8);
    const blockAlign = CHANNELS * (BIT_DEPTH / 8);
    const safeLength = Math.min(dataLength, 0xffffffff - 36);

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + safeLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(CHANNELS, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(BIT_DEPTH, 34);
    header.write('data', 36);
    header.writeUInt32LE(safeLength, 40);

    return header;
}

async function patchWavHeader(filePath, dataLength) {
    const handle = await fs.promises.open(filePath, 'r+');
    try {
        await handle.write(createWavHeader(dataLength), 0, HEADER_BYTES, 0);
    } finally {
        await handle.close();
    }
}

function formatTrackList(files) {
    return files
        .slice(0, 12)
        .map((file, index) => {
            const skipped = file.invalidPackets ? `, skipped ${file.invalidPackets} bad packet(s)` : '';
            const speakers = file.speakerCount ? `, ${file.speakerCount} speaker(s)` : '';
            return `${index + 1}. ${file.displayName} - ${formatBytes(file.size)}${speakers}${skipped}`;
        })
        .join('\n');
}

function createGlobalMixTrack(session) {
    const fileName = 'global-mix.wav';
    const filePath = path.join(session.outputDir, fileName);
    fs.writeFileSync(filePath, createWavHeader(0));

    const fileStream = fs.createWriteStream(filePath, { flags: 'a' });
    fileStream.on('error', (error) => {
        console.warn('[Record] Global mix write failed:', error?.message || error);
    });

    return {
        displayName: 'Global mix',
        fileName,
        filePath,
        fileStream,
        hasAudio: false,
        pcmBytes: 0,
    };
}

function writeGlobalMixFrame(session, allowPartial) {
    if (!session.mix) return false;
    if (!session.mix.fileStream || session.mix.fileStream.destroyed) return false;

    const frames = [...session.participants.values()]
        .filter((participant) => participant.mode === RECORDING_MODES.GLOBAL)
        .map((participant) => takePcmFrame(participant, allowPartial))
        .filter(Boolean);

    if (!frames.length && !allowPartial) return false;

    const frame = frames.length ? mixPcmFrames(frames) : Buffer.alloc(MIX_FRAME_BYTES);
    if (frames.length) session.mix.hasAudio = true;

    session.mix.pcmBytes += frame.length;
    try {
        session.mix.fileStream.write(frame);
    } catch (error) {
        console.error('[Record] Mix frame write error:', error);
        return false;
    }
    return true;
}

function mixPcmFrames(frames) {
    if (frames.length === 1) return frames[0];

    const mixed = Buffer.alloc(MIX_FRAME_BYTES);
    const gain = Math.max(1, Math.sqrt(frames.length));

    for (let offset = 0; offset < MIX_FRAME_BYTES; offset += 2) {
        let sample = 0;
        for (const frame of frames) {
            sample += frame.readInt16LE(offset);
        }

        mixed.writeInt16LE(clampSample(Math.round(sample / gain)), offset);
    }

    return mixed;
}

function takePcmFrame(participant, allowPartial) {
    if (!participant.queuedBytes) return null;
    if (!allowPartial && participant.queuedBytes < MIX_FRAME_BYTES) return null;

    const frame = Buffer.alloc(MIX_FRAME_BYTES);
    let frameOffset = 0;

    while (frameOffset < MIX_FRAME_BYTES && participant.queue.length) {
        const chunk = participant.queue[0];
        const bytesToCopy = Math.min(chunk.length, MIX_FRAME_BYTES - frameOffset);
        chunk.copy(frame, frameOffset, 0, bytesToCopy);
        frameOffset += bytesToCopy;
        participant.queuedBytes -= bytesToCopy;

        if (bytesToCopy === chunk.length) {
            participant.queue.shift();
        } else {
            participant.queue[0] = chunk.subarray(bytesToCopy);
        }
    }

    return frame;
}

function trimParticipantQueue(participant) {
    while (participant.queuedBytes > MAX_MIX_QUEUE_BYTES && participant.queue.length) {
        const dropped = participant.queue.shift();
        participant.queuedBytes -= dropped.length;
        participant.droppedFrames += Math.ceil(dropped.length / MIX_FRAME_BYTES);
    }
}

async function finalizeGlobalMix(session) {
    let drainCount = 0;
    const maxDrainAttempts = 1000; // Prevent infinite loop
    
    while (writeGlobalMixFrame(session, true) && drainCount < maxDrainAttempts) {
        drainCount++;
    }
    
    if (drainCount >= maxDrainAttempts) {
        console.warn('[Record] Hit max drain attempts for global mix');
    }

    try {
        await endWritable(session.mix.fileStream);
    } catch (error) {
        console.error('[Record] Error ending mix file stream:', error);
    }

    if (!session.mix.hasAudio || session.mix.pcmBytes <= 0) {
        await fs.promises.rm(session.mix.filePath, { force: true }).catch(() => null);
        return null;
    }

    try {
        await patchWavHeader(session.mix.filePath, session.mix.pcmBytes);
    } catch (error) {
        console.error('[Record] Failed to patch mix WAV header:', error);
        return null;
    }
    
    const playable = await createPlayableAudio(session.mix.filePath).catch((error) => {
        console.warn('[Record] Global MP3 conversion failed:', error?.message || error);
        return null;
    });
    
    const attachmentPath = playable?.filePath || session.mix.filePath;
    const attachmentName = playable?.fileName || session.mix.fileName;
    
    let stat;
    try {
        stat = await fs.promises.stat(attachmentPath);
    } catch (error) {
        console.error('[Record] Failed to stat mix file:', error);
        return null;
    }
    
    const participants = [...session.participants.values()];

    return {
        attachmentName,
        attachmentPath,
        displayName: 'Global mix',
        fileName: session.mix.fileName,
        filePath: session.mix.filePath,
        invalidPackets: participants.reduce((total, participant) => total + participant.invalidPackets, 0),
        packetCount: participants.reduce((total, participant) => total + participant.packetCount, 0),
        size: stat.size,
        speakerCount: participants.length,
        userId: 'global',
    };
}

function clampSample(sample) {
    if (sample > 32767) return 32767;
    if (sample < -32768) return -32768;
    return sample;
}

function normalizeRecordingMode(mode) {
    return mode === RECORDING_MODES.GLOBAL ? RECORDING_MODES.GLOBAL : RECORDING_MODES.SEPARATE;
}

function formatTimestampForPath(date) {
    return date.toISOString().replace(/[:.]/g, '-');
}

function safeFileName(value) {
    return String(value || 'speaker')
        .toLowerCase()
        .replace(/[^a-z0-9-_]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'speaker';
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatError(error) {
    return String(error?.message || error || 'unknown error').slice(0, 180);
}

function createPlayableAudio(wavPath) {
    if (!ffmpegPath) return Promise.resolve(null);

    const mp3Path = wavPath.replace(/\.wav$/i, '.mp3');
    const mp3Name = path.basename(mp3Path);

    return new Promise((resolve, reject) => {
        const ffmpeg = spawn(ffmpegPath, [
            '-y',
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            wavPath,
            '-vn',
            '-codec:a',
            'libmp3lame',
            '-b:a',
            '128k',
            mp3Path,
        ]);

        let stderr = '';
        ffmpeg.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        ffmpeg.on('error', reject);
        ffmpeg.on('close', async (code) => {
            if (code !== 0) {
                reject(new Error(stderr.trim() || `ffmpeg exited with ${code}`));
                return;
            }

            const stat = await fs.promises.stat(mp3Path).catch(() => null);
            if (!stat?.size) {
                resolve(null);
                return;
            }

            resolve({
                fileName: mp3Name,
                filePath: mp3Path,
                size: stat.size,
            });
        });
    });
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function endWritable(stream) {
    return new Promise((resolve, reject) => {
        if (!stream || stream.destroyed || stream.closed) {
            resolve();
            return;
        }

        stream.once('error', reject);
        stream.end(() => {
            stream.removeListener('error', reject);
            resolve();
        });
    });
}

module.exports = {
    DEFAULT_MAX_MINUTES,
    RECORDING_MODES,
    formatRecordingStatus,
    getRecording,
    recordingAudioPayload,
    recordingResultPayload,
    recordingSummaryPayload,
    startRecording,
    stopRecording,
    startCleanupTask,
    stopCleanupTask,
    cleanOldRecordings,
};
