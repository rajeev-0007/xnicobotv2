'use strict';

/**
 * Screenshot Verification Manager
 * ──────────────────────────────────────────────────────────────────
 * Storage, task management, and action execution for the
 * screenshot verification system.
 *
 * Per-guild config (store: `screenshot-verify`)
 * {
 *   enabled: boolean,
 *   submissionChannelId: string | null,
 *   reviewChannelId:     string | null,
 *   logChannelId:        string | null,
 *   mode:                'auto' | 'review' | 'hybrid',
 *   confidenceThreshold: number  (0-100, used by hybrid)
 *   cooldown:            number  (ms, after rejection)
 *   autoDelete:          boolean (delete user's source message after queueing)
 *   color:               number  (hex)
 *   tasks: [
 *     {
 *       id:          string,
 *       name:        string,
 *       type:        'youtube_subscribe' | 'instagram_follow' | 'twitter_follow'
 *                  | 'tiktok_follow' | 'discord_join' | 'website_signup' | 'custom',
 *       target:      string,           // e.g. "@xNico", "discord.gg/abc"
 *       description: string,           // shown to users
 *       keywords:    string[],         // hints for the vision model
 *       actions:     ActionStep[]
 *     }
 *   ]
 * }
 *
 * Per-guild submissions (store: `screenshot-verify-submissions`)
 * {
 *   [submissionId]: {
 *     id, guildId, userId, taskId,
 *     status: 'pending' | 'approved' | 'rejected',
 *     decision: 'auto' | 'manual' | null,
 *     submittedAt, reviewedAt, reviewedBy,
 *     imageUrl, imageName, imageSize,
 *     sourceMessageId, sourceChannelId,
 *     reviewMessageId, reviewChannelId,
 *     reason, note,
 *     ai: { matched, confidence, taskId, reasoning, model } | null
 *   }
 * }
 */

const jsonStore = require('./jsonStore');
const log       = require('./logger-styled');
const { detectScreenshot: detectViaAI } = require('./screenshotVerifyVision');
const { detectScreenshot: detectViaOCR } = require('./screenshotVerifyOCR');
const {
    STORE_CONFIG, STORE_SUBS,
    TASK_PRESETS, ACTION_PRESETS,
    MAX_TASKS_PER_GUILD, MAX_ACTIONS_PER_TASK,
    MAX_IMAGE_BYTES, DEFAULT_CONFIDENCE,
    countByStatus
} = require('./screenshotVerifyManagerShared');

/* ═══════════════════════════════════════════════════════════════════
   STORAGE HELPERS
   ═══════════════════════════════════════════════════════════════════ */

function defaultGuildConfig() {
    return {
        enabled: false,
        submissionChannelId: null,
        reviewChannelId:     null,
        logChannelId:        null,
        mode: 'hybrid',
        // Detection engine:
        //   'ocr'    — local Tesseract only (free, deterministic, offline)
        //   'ai'     — Groq vision LLM only
        //   'hybrid' — OCR first; if it can't decide, escalate to AI (default)
        verifier: 'hybrid',
        confidenceThreshold: DEFAULT_CONFIDENCE,
        cooldown: 0,
        autoDelete: true,
        // When true, verified users (anyone who has the task's add_role
        // role) automatically lose `ViewChannel` on the submission
        // channel — they can't see it once they're done. Achieved via
        // a permission overwrite on the verified role, set up via
        // `applyChannelPrivacy()`.
        hideAfterVerify: true,
        color: 0x5865F2,
        rejectMessage: 'Your screenshot did not pass verification. You may try again.',
        approveMessage: 'Your screenshot was approved.',
        tasks: []
    };
}

function loadConfig() {
    if (!jsonStore.has(STORE_CONFIG)) {
        jsonStore.write(STORE_CONFIG, {});
        return {};
    }
    return jsonStore.read(STORE_CONFIG);
}

function saveConfig(all) {
    jsonStore.write(STORE_CONFIG, all);
}

function getGuildConfig(guildId) {
    const all = loadConfig();
    return { ...defaultGuildConfig(), ...(all[guildId] || {}) };
}

function setGuildConfig(guildId, partial) {
    const all = loadConfig();
    all[guildId] = { ...defaultGuildConfig(), ...(all[guildId] || {}), ...partial };
    saveConfig(all);
    return all[guildId];
}

function loadSubs() {
    if (!jsonStore.has(STORE_SUBS)) {
        jsonStore.write(STORE_SUBS, {});
        return {};
    }
    return jsonStore.read(STORE_SUBS);
}

function saveSubs(all) {
    jsonStore.write(STORE_SUBS, all);
}

/* ═══════════════════════════════════════════════════════════════════
   TASK / ACTION MANAGEMENT
   ═══════════════════════════════════════════════════════════════════ */

function generateId(len = 6) {
    return Date.now().toString(36).slice(-4)
        + Math.random().toString(36).slice(2, 2 + len).toUpperCase();
}

function getTask(cfg, taskId) {
    return (cfg.tasks || []).find(t => t.id === taskId) || null;
}

function addTask(guildId, task) {
    const all = loadConfig();
    if (!all[guildId]) all[guildId] = defaultGuildConfig();
    if ((all[guildId].tasks || []).length >= MAX_TASKS_PER_GUILD) {
        throw new Error(`Reached the maximum of ${MAX_TASKS_PER_GUILD} tasks per server.`);
    }
    if (!all[guildId].tasks) all[guildId].tasks = [];
    const created = {
        id:          generateId(),
        name:        (task.name || '').trim().slice(0, 60) || 'Untitled Task',
        type:        TASK_PRESETS[task.type] ? task.type : 'custom',
        target:      (task.target || '').trim().slice(0, 200),
        description: (task.description || '').trim().slice(0, 500),
        keywords:    Array.isArray(task.keywords) ? task.keywords.slice(0, 20) : [],
        actions:     []
    };
    all[guildId].tasks.push(created);
    saveConfig(all);
    return created;
}

function updateTask(guildId, taskId, partial) {
    const all = loadConfig();
    const tasks = all[guildId]?.tasks || [];
    const task  = tasks.find(t => t.id === taskId);
    if (!task) return null;

    if (partial.name        !== undefined) task.name        = String(partial.name).trim().slice(0, 60);
    if (partial.target      !== undefined) task.target      = String(partial.target).trim().slice(0, 200);
    if (partial.description !== undefined) task.description = String(partial.description).trim().slice(0, 500);
    if (partial.keywords    !== undefined) task.keywords    = Array.isArray(partial.keywords) ? partial.keywords.slice(0, 20) : [];
    if (partial.type        !== undefined) task.type        = TASK_PRESETS[partial.type] ? partial.type : task.type;

    saveConfig(all);
    return task;
}

function deleteTask(guildId, taskId) {
    const all = loadConfig();
    const tasks = all[guildId]?.tasks;
    if (!tasks) return false;
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return false;
    tasks.splice(idx, 1);
    saveConfig(all);
    return true;
}

function addAction(guildId, taskId, action) {
    const all = loadConfig();
    const task = all[guildId]?.tasks?.find(t => t.id === taskId);
    if (!task) return null;
    if (!ACTION_PRESETS[action.type]) return null;
    if ((task.actions || []).length >= MAX_ACTIONS_PER_TASK) {
        throw new Error(`Reached the maximum of ${MAX_ACTIONS_PER_TASK} actions per task.`);
    }
    const created = {
        id:        generateId(4),
        type:      action.type,
        roleId:    action.roleId    || null,
        channelId: action.channelId || null,
        content:   (action.content || '').slice(0, 1500)
    };
    if (!task.actions) task.actions = [];
    task.actions.push(created);
    saveConfig(all);
    return created;
}

function removeAction(guildId, taskId, actionId) {
    const all = loadConfig();
    const task = all[guildId]?.tasks?.find(t => t.id === taskId);
    if (!task?.actions) return false;
    const idx = task.actions.findIndex(a => a.id === actionId);
    if (idx === -1) return false;
    task.actions.splice(idx, 1);
    saveConfig(all);
    return true;
}

/* ═══════════════════════════════════════════════════════════════════
   SUBMISSION CRUD + GUARDS
   ═══════════════════════════════════════════════════════════════════ */

function findUserPending(guildId, userId) {
    const guildSubs = loadSubs()[guildId] || {};
    return Object.values(guildSubs).find(s => s.userId === userId && s.status === 'pending') || null;
}

function findUserMostRecent(guildId, userId, taskId = null) {
    const guildSubs = loadSubs()[guildId] || {};
    return Object.values(guildSubs)
        .filter(s => s.userId === userId && (!taskId || s.taskId === taskId))
        .sort((a, b) => b.submittedAt - a.submittedAt)[0] || null;
}

function createSubmission(guildId, userId, taskId, attachment, note, ai) {
    const sub = {
        id:                generateId(8),
        guildId,
        userId,
        taskId,
        status:            'pending',
        decision:          null,
        submittedAt:       Date.now(),
        reviewedAt:        null,
        reviewedBy:        null,
        imageUrl:          attachment.proxyURL || attachment.url,
        imageName:         attachment.name || 'screenshot',
        imageSize:         attachment.size || 0,
        sourceMessageId:   attachment.sourceMessageId || null,
        sourceChannelId:   attachment.sourceChannelId || null,
        reviewMessageId:   null,
        reviewChannelId:   null,
        reason:            null,
        note:              note || null,
        ai:                ai || null
    };
    const subs = loadSubs();
    if (!subs[guildId]) subs[guildId] = {};
    subs[guildId][sub.id] = sub;
    saveSubs(subs);
    return sub;
}

function updateSubmission(guildId, submissionId, partial) {
    const subs = loadSubs();
    const sub  = subs[guildId]?.[submissionId];
    if (!sub) return null;
    Object.assign(sub, partial);
    saveSubs(subs);
    return sub;
}

function deleteSubmission(guildId, submissionId) {
    const subs = loadSubs();
    if (!subs[guildId]?.[submissionId]) return false;
    delete subs[guildId][submissionId];
    saveSubs(subs);
    return true;
}

/* ═══════════════════════════════════════════════════════════════════
   ACTION EXECUTION ENGINE
   ═══════════════════════════════════════════════════════════════════ */

/**
 * Replace placeholders in action content with submission context.
 */
function applyPlaceholders(template, ctx) {
    if (!template) return '';
    return String(template)
        .replace(/{user}/g,     ctx.user ? `<@${ctx.user.id}>` : '')
        .replace(/{user\.id}/g, ctx.user?.id || '')
        .replace(/{user\.tag}/g, ctx.user?.tag || ctx.user?.username || '')
        .replace(/{task}/g,     ctx.task?.name || '')
        .replace(/{server}/g,   ctx.guild?.name || '')
        .replace(/{id}/g,       ctx.submission?.id || '')
        .replace(/{role}/g,     ctx.task?.actions?.find(a => a.type === 'add_role')?.roleId
                                    ? `<@&${ctx.task.actions.find(a => a.type === 'add_role').roleId}>`
                                    : '');
}

/**
 * Run a single action step. Returns { ok, message }.
 */
async function runAction(client, guild, member, action, ctx) {
    try {
        switch (action.type) {
            case 'add_role': {
                if (!action.roleId) return { ok: false, message: 'No role configured' };
                const role = guild.roles.cache.get(action.roleId);
                if (!role) return { ok: false, message: 'Role not found' };
                const me = guild.members.me;
                if (me && role.position >= me.roles.highest.position) {
                    return { ok: false, message: 'Role is above bot — cannot manage' };
                }
                if (member.roles.cache.has(action.roleId)) {
                    return { ok: true, message: 'Already had role' };
                }
                await member.roles.add(role, `Screenshot Verify: ${ctx.task?.name || 'task'} (${ctx.submission?.id || ''})`);
                return { ok: true, message: `Added <@&${action.roleId}>` };
            }
            case 'remove_role': {
                if (!action.roleId) return { ok: false, message: 'No role configured' };
                const role = guild.roles.cache.get(action.roleId);
                if (!role) return { ok: false, message: 'Role not found' };
                const me = guild.members.me;
                if (me && role.position >= me.roles.highest.position) {
                    return { ok: false, message: 'Role is above bot — cannot manage' };
                }
                if (!member.roles.cache.has(action.roleId)) {
                    return { ok: true, message: 'Did not have role' };
                }
                await member.roles.remove(role, `Screenshot Verify: ${ctx.task?.name || 'task'} (${ctx.submission?.id || ''})`);
                return { ok: true, message: `Removed <@&${action.roleId}>` };
            }
            case 'send_channel': {
                if (!action.channelId || !action.content) return { ok: false, message: 'Missing channel or content' };
                const ch = guild.channels.cache.get(action.channelId)
                    || await guild.channels.fetch(action.channelId).catch(() => null);
                if (!ch?.isTextBased?.()) return { ok: false, message: 'Channel not found / not text' };
                const text = applyPlaceholders(action.content, ctx);
                await ch.send({ content: text, allowedMentions: { users: [ctx.user.id], parse: [] } });
                return { ok: true, message: `Sent in <#${action.channelId}>` };
            }
            case 'send_dm': {
                if (!action.content) return { ok: false, message: 'Missing content' };
                const text = applyPlaceholders(action.content, ctx);
                const user = await client.users.fetch(ctx.user.id).catch(() => null);
                if (!user) return { ok: false, message: 'Could not fetch user' };
                await user.send({ content: text, allowedMentions: { parse: [] } });
                return { ok: true, message: 'DM delivered' };
            }
            default:
                return { ok: false, message: `Unknown action type: ${action.type}` };
        }
    } catch (err) {
        return { ok: false, message: err.message || String(err) };
    }
}

/**
 * Execute all configured actions for a task in order. Returns an
 * array of {action, ok, message} results so the caller can log /
 * surface a summary to staff.
 */
async function runTaskActions(client, guild, member, task, submission) {
    const ctx = { guild, member, user: member.user, task, submission };
    const results = [];
    if (!task?.actions?.length) return results;
    for (const action of task.actions) {
        const r = await runAction(client, guild, member, action, ctx);
        results.push({ action, ok: r.ok, message: r.message });
    }
    return results;
}

/* ═══════════════════════════════════════════════════════════════════
   CHANNEL PRIVACY
   ═══════════════════════════════════════════════════════════════════
 *
 * Lock down the submission channel so it works as a "drop your
 * screenshot and disappear" gate:
 *
 *   - `@everyone`
 *       ViewChannel        : ALLOW   (so unverified members can find it)
 *       SendMessages       : ALLOW   (so they can post screenshots)
 *       AttachFiles        : ALLOW   (so they can upload images)
 *       ReadMessageHistory : DENY    (privacy: can't read other people's submissions)
 *       AddReactions       : DENY
 *       EmbedLinks         : DENY
 *       UseExternalEmojis  : DENY
 *
 *   - **Every "verified" role** referenced by an `add_role` action on
 *     any task gets `ViewChannel: DENY` so once a user is verified
 *     Discord automatically hides the channel from them.
 *
 *   - Bot's own member: every relevant manage permission allowed.
 *
 * Returns a result summary so the admin panel can show what happened.
 */

const { PermissionFlagsBits } = require('discord.js');

async function applyChannelPrivacy(guild, cfg) {
    const result = {
        ok: false,
        channelLocked: false,
        verifiedRoleLocks: [],
        warnings: [],
        error: null
    };

    if (!cfg?.submissionChannelId) {
        result.error = 'No submission channel set.';
        return result;
    }

    const channel = guild.channels.cache.get(cfg.submissionChannelId)
        || await guild.channels.fetch(cfg.submissionChannelId).catch(() => null);
    if (!channel?.permissionOverwrites) {
        result.error = 'Submission channel not found or not a guild text channel.';
        return result;
    }

    // Verify bot can manage permissions on this channel.
    const me = guild.members.me;
    if (!me) {
        result.error = 'Bot member not loaded.';
        return result;
    }
    const myPerms = channel.permissionsFor(me);
    if (!myPerms?.has(PermissionFlagsBits.ManageChannels)
        && !myPerms?.has(PermissionFlagsBits.ManageRoles)) {
        result.error = 'I need **Manage Channels** or **Manage Roles** on this channel to apply privacy.';
        return result;
    }

    // ── @everyone overwrite ──────────────────────────────────────
    try {
        await channel.permissionOverwrites.edit(guild.roles.everyone, {
            ViewChannel:       true,
            SendMessages:      true,
            AttachFiles:       true,
            ReadMessageHistory: false,
            AddReactions:      false,
            EmbedLinks:        false,
            UseExternalEmojis: false
        }, { reason: 'Screenshot Verify: lock submission channel' });
        result.channelLocked = true;
    } catch (e) {
        result.error = `Failed to lock @everyone overwrite: ${e.message || e}`;
        return result;
    }

    // ── Bot overwrite — make sure we keep all the moderation perms ─
    try {
        await channel.permissionOverwrites.edit(me.id, {
            ViewChannel:       true,
            SendMessages:      true,
            ManageMessages:    true,
            ReadMessageHistory: true,
            AttachFiles:       true,
            EmbedLinks:        true,
            ManageChannels:    true
        }, { reason: 'Screenshot Verify: bot overrides' });
    } catch (e) {
        result.warnings.push(`Could not set bot overrides: ${e.message || e}`);
    }

    // ── Hide from verified roles ─────────────────────────────────
    if (cfg.hideAfterVerify) {
        const verifiedRoleIds = new Set();
        for (const task of (cfg.tasks || [])) {
            for (const action of (task.actions || [])) {
                if (action.type === 'add_role' && action.roleId) {
                    verifiedRoleIds.add(action.roleId);
                }
            }
        }

        for (const roleId of verifiedRoleIds) {
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                result.warnings.push(`Verified role ${roleId} not found — skipped.`);
                continue;
            }
            try {
                await channel.permissionOverwrites.edit(role, {
                    ViewChannel: false
                }, { reason: 'Screenshot Verify: hide channel from verified members' });
                result.verifiedRoleLocks.push(roleId);
            } catch (e) {
                result.warnings.push(`Could not hide channel from <@&${roleId}>: ${e.message || e}`);
            }
        }
    }

    result.ok = true;
    return result;
}

/* ═══════════════════════════════════════════════════════════════════
   AUDIT + DM HELPERS
   ═══════════════════════════════════════════════════════════════════ */

async function logAudit(guild, cfg, content) {
    if (!cfg.logChannelId) return;
    const ch = guild.channels.cache.get(cfg.logChannelId)
        || await guild.channels.fetch(cfg.logChannelId).catch(() => null);
    if (!ch?.isTextBased?.()) return;
    ch.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
}

async function dmUser(client, userId, content) {
    try {
        const user = await client.users.fetch(userId);
        await user.send({ content, allowedMentions: { parse: [] } });
        return true;
    } catch {
        return false;
    }
}

/* ═══════════════════════════════════════════════════════════════════
   SUBMIT PIPELINE
   ═══════════════════════════════════════════════════════════════════ */

function validateAttachment(attachment) {
    if (!attachment) return 'No attachment was provided.';
    if (!attachment.contentType?.startsWith('image/')) {
        return 'The attachment must be an image (PNG / JPG / WEBP).';
    }
    if (attachment.size > MAX_IMAGE_BYTES) {
        return `The image is too large (max ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)} MB).`;
    }
    return null;
}

/**
 * Unified verification dispatcher. Picks the configured engine
 * (`ocr` / `ai` / `hybrid`) and returns the same {matched, taskId,
 * confidence, reasoning, model} shape regardless of the underlying
 * engine — so the rest of the pipeline never branches on engine.
 *
 * Hybrid behaviour: run OCR first (fast, free, deterministic). If it
 * confidently matches, use it. If it's uncertain, fall through to the
 * AI verifier. If both fail (binary missing, key missing, network),
 * return null so the manager can route to manual review.
 */
async function runVerifier({ engine, imageUrl, tasks, threshold }) {
    const ENGINE = (engine || 'hybrid').toLowerCase();
    const useOCR = ENGINE === 'ocr'    || ENGINE === 'hybrid';
    const useAI  = ENGINE === 'ai'     || ENGINE === 'hybrid';

    let ocrResult = null;
    if (useOCR) {
        ocrResult = await detectViaOCR({ imageUrl, tasks, threshold }).catch(() => null);
        // OCR alone is strong enough to short-circuit when:
        //   - it confidently matched, OR
        //   - this engine doesn't have an AI fallback configured.
        if (ENGINE === 'ocr') return ocrResult;
        if (ocrResult && ocrResult.matched && ocrResult.confidence >= (threshold || DEFAULT_CONFIDENCE)) {
            return ocrResult;
        }
    }

    if (useAI) {
        const aiResult = await detectViaAI({ imageUrl, tasks }).catch(() => null);
        if (aiResult) return aiResult;
    }

    // AI bailed (no key, network error, etc.) — return whatever OCR
    // produced even if it's a low-confidence "no match", so staff has
    // *some* signal in the review embed.
    return ocrResult;
}

/**
 * Public submit entry point. Handles validation, AI detection, and
 * dispatch to either auto-action execution or the manual review queue.
 *
 * @param {object} opts
 * @param {import('discord.js').Client} opts.client
 * @param {import('discord.js').Guild}  opts.guild
 * @param {import('discord.js').User}   opts.user
 * @param {object} opts.attachment      Discord attachment object (with optional sourceMessageId)
 * @param {string} [opts.note]          Optional user note
 * @param {string} [opts.taskId]        Pre-selected task; if omitted, AI classifies
 *
 * @returns {Promise<{ok: boolean, error?: string, submission?: object,
 *                    decision?: 'auto-approved'|'auto-rejected'|'queued',
 *                    actionResults?: Array, ai?: object, task?: object}>}
 */
async function submitScreenshot(opts) {
    const { client, guild, user, attachment, note, taskId: preSelectedTaskId } = opts;

    const cfg = getGuildConfig(guild.id);
    if (!cfg.enabled) return { ok: false, error: 'Screenshot verification is currently disabled.' };
    if (!cfg.tasks?.length) {
        return { ok: false, error: 'Staff has not configured any verification tasks yet.' };
    }
    if (cfg.mode !== 'auto' && !cfg.reviewChannelId) {
        return { ok: false, error: 'Staff has not configured the review channel.' };
    }

    const validationError = validateAttachment(attachment);
    if (validationError) return { ok: false, error: validationError };

    // One pending per user
    if (findUserPending(guild.id, user.id)) {
        return { ok: false, error: 'You already have a pending submission. Wait for staff to review it first.' };
    }

    // Cooldown after rejection
    if (cfg.cooldown && cfg.cooldown > 0) {
        const recent = findUserMostRecent(guild.id, user.id);
        if (recent && recent.status === 'rejected'
            && Date.now() - recent.reviewedAt < cfg.cooldown) {
            const until = recent.reviewedAt + cfg.cooldown;
            return { ok: false, error: `You can submit again <t:${Math.floor(until / 1000)}:R>.` };
        }
    }

    // Resolve target task — either explicit (user picked from select) or auto-classify
    let task = null;
    let ai   = null;

    if (preSelectedTaskId) {
        task = getTask(cfg, preSelectedTaskId);
        if (!task) return { ok: false, error: 'The task you selected no longer exists.' };

        // Even with a pre-selected task, run detection (unless mode=review explicitly skips it)
        if (cfg.mode !== 'review') {
            ai = await runVerifier({
                engine:    cfg.verifier,
                imageUrl:  attachment.proxyURL || attachment.url,
                tasks:     [task],
                threshold: cfg.confidenceThreshold
            });
        }
    } else {
        // Auto-classify across all configured tasks
        if (cfg.mode === 'review') {
            // In review-only mode without a pre-selected task, send to staff with no AI hint
            // and let them pick. We default to the first task as the "claimed" task.
            task = cfg.tasks[0];
        } else {
            ai = await runVerifier({
                engine:    cfg.verifier,
                imageUrl:  attachment.proxyURL || attachment.url,
                tasks:     cfg.tasks,
                threshold: cfg.confidenceThreshold
            });
            // ai.taskId may be null if the engine couldn't classify. Fall back to the first
            // task so the submission record is still attached to *something* and staff can
            // re-categorise on review.
            const matchedTask = ai?.taskId ? getTask(cfg, ai.taskId) : null;
            task = matchedTask || cfg.tasks[0];
        }
    }

    // Persist record
    let submission;
    try {
        submission = createSubmission(guild.id, user.id, task.id, attachment, note, ai);
    } catch (e) {
        return { ok: false, error: 'Could not save your submission. Please try again.' };
    }

    // Decide flow: auto / review / hybrid
    const aiOk         = ai && ai.matched && ai.taskId === task.id;
    const aiConfidence = ai?.confidence ?? 0;
    const threshold    = cfg.confidenceThreshold ?? DEFAULT_CONFIDENCE;

    let shouldAutoApprove = false;
    if (cfg.mode === 'auto')   shouldAutoApprove = aiOk && aiConfidence >= threshold;
    if (cfg.mode === 'hybrid') shouldAutoApprove = aiOk && aiConfidence >= threshold;
    // mode === 'review' → never auto

    if (shouldAutoApprove) {
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) {
            updateSubmission(guild.id, submission.id, { status: 'pending' });
            return queueForReview({ client, guild, cfg, task, user, submission, attachment, ai, note,
                                    fallbackReason: 'User left the server before actions could be applied' });
        }

        const actionResults = await runTaskActions(client, guild, member, task, submission);
        updateSubmission(guild.id, submission.id, {
            status:     'approved',
            decision:   'auto',
            reviewedAt: Date.now(),
            reviewedBy: client.user.id
        });

        const engineLabel = ai?.model === 'tesseract' ? 'OCR'
            : (ai?.model && /llama|gpt|claude|gemini|vision/i.test(ai.model)) ? 'AI Vision'
            : 'Verifier';

        const dmContent = `# <:Checkedbox:1521227734943269077> Verified Automatically\n\n`
            + `Your screenshot for **${task.name}** in **${guild.name}** was approved.\n\n`
            + (cfg.approveMessage ? `> ${cfg.approveMessage}\n` : '')
            + `\n-# ${engineLabel} confidence: \`${aiConfidence}%\` · Submission ID: \`${submission.id}\``;
        dmUser(client, user.id, dmContent);

        const summary = actionResults.map(r =>
            `${r.ok ? '<:Checkedbox:1521227734943269077>' : '<:Cancel:1521227723916181644>'} ${ACTION_PRESETS[r.action.type]?.label || r.action.type} · ${r.message}`
        ).join('\n') || '_No actions configured_';

        logAudit(guild, cfg,
            `<:Checkedbox:1521227734943269077> Auto-approved \`${submission.id}\` from <@${user.id}> · `
            + `task **${task.name}** · ${engineLabel.toLowerCase()} confidence \`${aiConfidence}%\`\n${summary}`
        );

        return {
            ok: true,
            decision: 'auto-approved',
            submission,
            task,
            ai,
            actionResults
        };
    }

    // Auto-reject path: only if mode=auto AND AI explicitly says no match
    if (cfg.mode === 'auto' && ai && !ai.matched) {
        updateSubmission(guild.id, submission.id, {
            status:     'rejected',
            decision:   'auto',
            reviewedAt: Date.now(),
            reviewedBy: client.user.id,
            reason:     `Automatic rejection: ${ai.reasoning || 'No matching task detected.'}`
        });
        const dmContent = `# <:Cancel:1521227723916181644> Verification Failed\n\n`
            + `Your screenshot for **${task.name}** in **${guild.name}** could not be verified.\n\n`
            + `> **Reason:** ${ai.reasoning || cfg.rejectMessage}\n`
            + (cfg.cooldown ? `\n-# You can submit again <t:${Math.floor((Date.now() + cfg.cooldown) / 1000)}:R>.` : '')
            + `\n-# Submission ID: \`${submission.id}\``;
        dmUser(client, user.id, dmContent);
        logAudit(guild, cfg,
            `<:Cancel:1521227723916181644> Auto-rejected \`${submission.id}\` from <@${user.id}> · `
            + `task **${task.name}** · ${ai.reasoning || 'no match'}`
        );
        return { ok: true, decision: 'auto-rejected', submission, task, ai };
    }

    // Otherwise → manual review queue. If the engine failed to run
    // (binary missing, key missing, network) AND we're in auto mode
    // with no review channel, the queue will fail too — return a
    // clearer message in that case so staff know what to fix.
    if (!ai && cfg.mode === 'auto' && !cfg.reviewChannelId) {
        deleteSubmission(guild.id, submission.id);
        return {
            ok: false,
            error: 'Verification engine is unavailable and no review channel is set. Ask staff to configure a review channel or re-enable the verifier.'
        };
    }

    return queueForReview({ client, guild, cfg, task, user, submission, attachment, ai, note });
}

async function queueForReview({ client, guild, cfg, task, user, submission, ai, fallbackReason }) {
    const reviewCh = cfg.reviewChannelId
        ? (guild.channels.cache.get(cfg.reviewChannelId)
            || await guild.channels.fetch(cfg.reviewChannelId).catch(() => null))
        : null;

    if (!reviewCh?.isTextBased?.()) {
        // No review channel → can't queue. Roll back.
        deleteSubmission(guild.id, submission.id);
        return { ok: false, error: 'Could not deliver your submission for review. Please contact staff.' };
    }

    const { buildReviewMessage } = require('./screenshotVerifyEmbeds');
    const container = buildReviewMessage(submission, task, cfg, ai);
    const { MessageFlags } = require('discord.js');
    let posted;
    try {
        posted = await reviewCh.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2
        });
    } catch (e) {
        deleteSubmission(guild.id, submission.id);
        return { ok: false, error: 'Could not deliver your submission for review. Please contact staff.' };
    }

    updateSubmission(guild.id, submission.id, {
        reviewMessageId: posted.id,
        reviewChannelId: posted.channel.id
    });

    const verifierLabel = ai?.model === 'tesseract' ? 'OCR'
        : (ai?.model && /llama|gpt|claude|gemini|vision/i.test(ai.model)) ? 'AI'
        : null;

    logAudit(guild, cfg,
        `<:Lightning:1521227915537285150> Queued \`${submission.id}\` from <@${user.id}> · task **${task.name}** · `
        + (verifierLabel ? `${verifierLabel}: \`${ai.confidence ?? 0}%\` ${ai.matched ? 'match' : 'no-match'}` : 'no verifier signal')
        + (fallbackReason ? ` · ${fallbackReason}` : '')
    );

    return { ok: true, decision: 'queued', submission, task, ai };
}

/* ═══════════════════════════════════════════════════════════════════
   MANUAL REVIEW (Approve / Reject)
   ═══════════════════════════════════════════════════════════════════ */

const reviewLocks = new Set();

async function manualReview({ interaction, submissionId, action, reason }) {
    if (reviewLocks.has(submissionId)) {
        return { ok: false, locked: true };
    }
    reviewLocks.add(submissionId);
    try {
        const guildId = interaction.guild.id;
        const subs = loadSubs();
        const sub  = subs[guildId]?.[submissionId];
        if (!sub)                         return { ok: false, notFound: true };
        if (sub.status !== 'pending')     return { ok: false, alreadyDone: sub };

        const cfg  = getGuildConfig(guildId);
        const task = getTask(cfg, sub.taskId);

        sub.status     = action;
        sub.decision   = 'manual';
        sub.reviewedBy = interaction.user.id;
        sub.reviewedAt = Date.now();
        sub.reason     = reason || null;
        saveSubs(subs);

        let actionResults = [];
        if (action === 'approved' && task) {
            const member = await interaction.guild.members.fetch(sub.userId).catch(() => null);
            if (member) {
                actionResults = await runTaskActions(interaction.client, interaction.guild, member, task, sub);
            }
        }

        // DM the user
        const dmContent = action === 'approved'
            ? `# <:Checkedbox:1521227734943269077> Verified\n\n`
                + `Your screenshot for **${task?.name || 'verification'}** in **${interaction.guild.name}** was approved by staff.\n\n`
                + (cfg.approveMessage ? `> ${cfg.approveMessage}\n` : '')
                + `\n-# Submission ID: \`${sub.id}\``
            : `# <:Cancel:1521227723916181644> Verification Rejected\n\n`
                + `Your screenshot for **${task?.name || 'verification'}** in **${interaction.guild.name}** was rejected.\n\n`
                + (reason ? `> **Reason:** ${reason}\n` : `> ${cfg.rejectMessage}\n`)
                + (cfg.cooldown ? `\n-# You can submit again <t:${Math.floor((Date.now() + cfg.cooldown) / 1000)}:R>.` : '')
                + `\n-# Submission ID: \`${sub.id}\``;
        dmUser(interaction.client, sub.userId, dmContent);

        const auditEmoji = action === 'approved'
            ? '<:Checkedbox:1521227734943269077>'
            : '<:Cancel:1521227723916181644>';
        logAudit(interaction.guild, cfg,
            `${auditEmoji} Manually ${action} \`${sub.id}\` (task **${task?.name || 'unknown'}**) by <@${interaction.user.id}>`
            + (reason ? ` · ${reason}` : '')
        );

        return { ok: true, submission: sub, task, cfg, actionResults };
    } finally {
        reviewLocks.delete(submissionId);
    }
}

/**
 * Re-classify a submission against a different task (manual override
 * from review). Returns { ok, sub, task }.
 */
function reassignTask(guildId, submissionId, newTaskId) {
    const cfg = getGuildConfig(guildId);
    const task = getTask(cfg, newTaskId);
    if (!task) return { ok: false };
    const sub = updateSubmission(guildId, submissionId, { taskId: newTaskId });
    return { ok: !!sub, sub, task };
}

/* ═══════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
    // Stores + constants
    STORE_CONFIG, STORE_SUBS,
    TASK_PRESETS, ACTION_PRESETS,
    MAX_TASKS_PER_GUILD, MAX_ACTIONS_PER_TASK,
    DEFAULT_CONFIDENCE,

    // Config
    defaultGuildConfig, loadConfig, saveConfig,
    getGuildConfig, setGuildConfig,

    // Tasks + actions
    getTask, addTask, updateTask, deleteTask,
    addAction, removeAction,

    // Submissions
    loadSubs, saveSubs,
    findUserPending, findUserMostRecent, countByStatus,
    createSubmission, updateSubmission, deleteSubmission,

    // Pipelines
    submitScreenshot, manualReview, reassignTask,
    runVerifier,

    // Helpers
    runTaskActions, runAction, applyPlaceholders,
    applyChannelPrivacy,
    logAudit, dmUser,
    validateAttachment
};
