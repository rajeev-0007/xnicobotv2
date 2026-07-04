'use strict';

/**
 * Screenshot Verification Command (Smart, Task-based)
 * ──────────────────────────────────────────────────────────────────
 * Admins create per-server "tasks" (YouTube Subscribe, Insta Follow,
 * Twitter Follow, Discord join, custom, etc). Each task has a target,
 * description, keywords, and a chain of actions (add role, remove role,
 * send channel message, DM user). Members post a screenshot in the
 * configured submission channel; the bot uses a vision LLM to classify
 * + verify it, then either auto-runs the actions or queues for staff.
 *
 * Custom ID prefixes (must be routed in index.js):
 *   - Buttons:         `sshot_…`
 *   - Modals:          `sshot_modal_…`
 *   - Channel/Role sel:`sshot_select_…`
 *   - String selects:  `sshot_…`  (already covered by the button branch)
 */

const {
    SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType,
    ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelSelectMenuBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder
} = require('discord.js');

const {
    buildErrorResponse, buildSuccessResponse, buildPermissionDenied
} = require('../../utils/responseBuilder');

const { registerPanel, updatePanel } = require('../../utils/panelRegistry');

const mgr = require('../../utils/screenshotVerifyManager');
const {
    buildSetupPanel, buildTaskEditor, buildUserPanel,
    buildReviewedMessage, formatDuration, engineLabelFromAi
} = require('../../utils/screenshotVerifyEmbeds');
const { TASK_PRESETS, ACTION_PRESETS } = require('../../utils/screenshotVerifyManagerShared');

/**
 * Action-pending map for two-step flows (e.g. "add role" button →
 * shows a role picker → user selects → we resolve here).
 *   key: `${guildId}:${userId}`
 *   value: { kind: 'add_role'|..., taskId, expiresAt, modalContent? }
 */
const pendingActionEdits = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;

function setPending(guildId, userId, payload) {
    pendingActionEdits.set(`${guildId}:${userId}`, { ...payload, expiresAt: Date.now() + PENDING_TTL_MS });
}
function getPending(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const p = pendingActionEdits.get(key);
    if (!p) return null;
    if (p.expiresAt < Date.now()) { pendingActionEdits.delete(key); return null; }
    return p;
}
function clearPending(guildId, userId) {
    pendingActionEdits.delete(`${guildId}:${userId}`);
}

/**
 * Per-user submission session for the "Submit Screenshot" button on
 * the public panel. Holds the task the user picked from the StringSelect
 * before they upload; gives them 5 minutes to upload via DM or the
 * slash command.
 */
const userSubmitSessions = new Map();
const USER_SESSION_TTL_MS = 5 * 60 * 1000;

function setUserSession(guildId, userId, taskId) {
    userSubmitSessions.set(`${guildId}:${userId}`, { taskId, expiresAt: Date.now() + USER_SESSION_TTL_MS });
}
function getUserSession(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const s = userSubmitSessions.get(key);
    if (!s) return null;
    if (s.expiresAt < Date.now()) { userSubmitSessions.delete(key); return null; }
    return s;
}
function clearUserSession(guildId, userId) {
    userSubmitSessions.delete(`${guildId}:${userId}`);
}

/**
 * Sticky-panel tracker. Maps guildId → {channelId, messageId, refloating}.
 * After each successful submission we delete the previous panel message
 * and re-send a fresh copy at the bottom of the channel so the panel
 * is always visible. The `refloating` flag prevents concurrent re-sends
 * from racing each other.
 */
const stickyPanels = new Map();

function recordStickyPanel(guildId, channelId, messageId) {
    stickyPanels.set(guildId, { channelId, messageId, refloating: false });
}

async function refloatUserPanel(guild, channel) {
    const tracked = stickyPanels.get(guild.id);
    if (!tracked || tracked.channelId !== channel.id) return;
    if (tracked.refloating) return;
    tracked.refloating = true;
    try {
        const cfg = mgr.getGuildConfig(guild.id);
        if (!cfg.enabled) return;

        // Delete the previous panel message (best-effort)
        if (tracked.messageId) {
            try {
                const old = await channel.messages.fetch(tracked.messageId);
                await old.delete().catch(() => {});
            } catch { /* gone already */ }
        }

        // Send a fresh panel
        const sent = await channel.send({
            components: [buildUserPanel(cfg)],
            flags: MessageFlags.IsComponentsV2
        }).catch(() => null);
        if (sent) recordStickyPanel(guild.id, channel.id, sent.id);
    } finally {
        const t = stickyPanels.get(guild.id);
        if (t) t.refloating = false;
    }
}

/* ═══════════════════════════════════════════════════════════════════
   PERMISSION GUARDS
   ═══════════════════════════════════════════════════════════════════ */

function isAdminMember(member) {
    return member.permissions.has(PermissionFlagsBits.ManageGuild)
        || member.permissions.has(PermissionFlagsBits.Administrator);
}

function isReviewerMember(member) {
    return isAdminMember(member)
        || member.permissions.has(PermissionFlagsBits.ManageRoles);
}

/* ═══════════════════════════════════════════════════════════════════
   HELPER: refresh the registered setup panel (best-effort)
   ═══════════════════════════════════════════════════════════════════ */

async function refreshSetupPanel(client, guild) {
    const cfg = mgr.getGuildConfig(guild.id);
    return updatePanel(client, guild.id, 'screenshot-verify', async (m) => {
        await m.edit({ components: [buildSetupPanel(guild, cfg)] });
    }).catch(() => null);
}

async function refreshReviewMessage(guild, submission) {
    if (!submission.reviewChannelId || !submission.reviewMessageId) return;
    try {
        const ch = guild.channels.cache.get(submission.reviewChannelId)
            || await guild.channels.fetch(submission.reviewChannelId);
        const msg = await ch.messages.fetch(submission.reviewMessageId);
        const cfg = mgr.getGuildConfig(guild.id);
        const task = mgr.getTask(cfg, submission.taskId);
        const updated = buildReviewedMessage(submission, task, cfg, submission.status, submission.reviewedBy, submission.reason);
        await msg.edit({ components: [updated] });
    } catch { /* swallow — non-critical */ }
}

/* ═══════════════════════════════════════════════════════════════════
   ENTRY: setup panel
   ═══════════════════════════════════════════════════════════════════ */

async function showSetupPanel(replyTarget, guild) {
    const cfg = mgr.getGuildConfig(guild.id);
    const container = buildSetupPanel(guild, cfg);
    const sent = await replyTarget.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2
    });
    let msg = sent;
    if (typeof replyTarget.fetchReply === 'function') {
        try { msg = await replyTarget.fetchReply(); } catch {}
    }
    if (msg?.id && msg?.channel?.id) {
        registerPanel(guild.id, 'screenshot-verify', msg.channel.id, msg.id);
    }
    return msg;
}

/* ═══════════════════════════════════════════════════════════════════
   COMMAND EXPORT
   ═══════════════════════════════════════════════════════════════════ */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('screenshot-verify')
        .setDescription('Smart screenshot verification with OCR + AI, custom tasks and actions')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(s => s
            .setName('panel')
            .setDescription('Open the configuration panel'))
        .addSubcommand(s => s
            .setName('submit')
            .setDescription('Submit a screenshot for verification')
            .addAttachmentOption(o => o
                .setName('screenshot')
                .setDescription('Image proof to submit')
                .setRequired(true))
            .addStringOption(o => o
                .setName('note')
                .setDescription('Optional note for moderators')
                .setMaxLength(500)
                .setRequired(false)))
        .addSubcommand(s => s
            .setName('pending')
            .setDescription('List currently pending submissions (mod only)'))
        .addSubcommand(s => s
            .setName('lookup')
            .setDescription('Look up a submission by ID (mod only)')
            .addStringOption(o => o
                .setName('id')
                .setDescription('Submission ID')
                .setRequired(true))),

    prefix: 'screenshot-verify',
    aliases: ['sshot-verify', 'sverify', 'screenverify'],
    description: 'Smart task-based screenshot verification system',
    usage: 'screenshot-verify [submit|pending|lookup <id>]',
    category: 'admin',
    permissions: ['ManageGuild'],

    // Exposed for index.js (auto-watch in messageCreate) + cross-command use
    submitScreenshot: mgr.submitScreenshot,
    getGuildConfig:   mgr.getGuildConfig,
    countByStatus:    mgr.countByStatus,
    getUserSession:   (guildId, userId) => getUserSession(guildId, userId),
    clearUserSession: (guildId, userId) => clearUserSession(guildId, userId),
    refloatUserPanel: (guild, channel) => refloatUserPanel(guild, channel),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();

        if (sub === 'submit') {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const attachment = interaction.options.getAttachment('screenshot');
            const note = interaction.options.getString('note');

            const session = getUserSession(interaction.guild.id, interaction.user.id);
            const result = await mgr.submitScreenshot({
                client:     interaction.client,
                guild:      interaction.guild,
                user:       interaction.user,
                attachment,
                note,
                taskId:     session?.taskId || null
            });
            if (session) clearUserSession(interaction.guild.id, interaction.user.id);

            return interaction.editReply(formatSubmitResult(result));
        }

        if (!isAdminMember(interaction.member)) {
            return interaction.reply({
                components: [buildPermissionDenied('Manage Server')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        if (sub === 'pending') return showPendingList(interaction);
        if (sub === 'lookup')  return showLookup(interaction, interaction.options.getString('id'));

        return showSetupPanel(interaction, interaction.guild);
    },

    async executePrefix(message, args) {
        const sub = (args[0] || '').toLowerCase();

        if (sub === 'submit') {
            const attachment = message.attachments.first();
            if (!attachment) {
                return message.reply({
                    components: [buildErrorResponse('No Image', 'Attach an image to your message and try again.')],
                    flags: MessageFlags.IsComponentsV2
                });
            }
            const note = args.slice(1).join(' ').slice(0, 500) || null;
            const session = getUserSession(message.guild.id, message.author.id);
            const result = await mgr.submitScreenshot({
                client:    message.client,
                guild:     message.guild,
                user:      message.author,
                attachment,
                note,
                taskId:    session?.taskId || null
            });
            if (session) clearUserSession(message.guild.id, message.author.id);
            return message.reply(formatSubmitResult(result));
        }

        if (!isAdminMember(message.member)) {
            return message.reply({
                components: [buildPermissionDenied('Manage Server')],
                flags: MessageFlags.IsComponentsV2
            });
        }

        if (sub === 'pending') return showPendingList(message);
        if (sub === 'lookup')  return showLookup(message, args[1]);

        return showSetupPanel(message, message.guild);
    },

    /* ═════════════════════════════════════════════════════════════════
       UNIFIED INTERACTION ROUTER
       ═════════════════════════════════════════════════════════════════ */

    async handleInteraction(interaction) {
        if (!interaction.guild || !interaction.member) return;
        const id      = interaction.customId;
        const guildId = interaction.guild.id;

        /* ── PUBLIC: user-facing submit panel ─────────────────────────── */
        if (id === 'sshot_user_pick_task' && interaction.isStringSelectMenu?.()) {
            const taskId = interaction.values[0];
            const cfg    = mgr.getGuildConfig(guildId);
            const task   = mgr.getTask(cfg, taskId);
            if (!task) {
                return interaction.reply({
                    components: [buildErrorResponse('Task Missing', 'That task no longer exists.')],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }
            setUserSession(guildId, interaction.user.id, taskId);
            return interaction.reply({
                components: [buildSuccessResponse(
                    `Selected: ${task.name}`,
                    `Now drop your screenshot in <#${cfg.submissionChannelId}> or run \`/screenshot-verify submit\`. Selection expires in 5 minutes.`
                )],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }
        if (id === 'sshot_user_submit') {
            return interaction.reply({
                components: [buildSuccessResponse(
                    'How to submit',
                    'Use `/screenshot-verify submit screenshot:<file>` and attach your image, or simply post your screenshot directly in the submission channel.'
                )],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }

        /* ── REVIEWER: approve / reject / re-assign ───────────────────── */
        if (id.startsWith('sshot_approve_')) {
            if (!isReviewerMember(interaction.member)) return permissionDenied(interaction);
            return handleManualReview(interaction, id.replace('sshot_approve_', ''), 'approved', null);
        }
        if (id.startsWith('sshot_reject_') && !id.startsWith('sshot_rejectreason_')) {
            if (!isReviewerMember(interaction.member)) return permissionDenied(interaction);
            return handleManualReview(interaction, id.replace('sshot_reject_', ''), 'rejected', null);
        }
        if (id.startsWith('sshot_rejectreason_')) {
            if (!isReviewerMember(interaction.member)) return permissionDenied(interaction);
            const subId = id.replace('sshot_rejectreason_', '');
            return interaction.showModal(new ModalBuilder()
                .setCustomId(`sshot_modal_reject_${subId}`)
                .setTitle('Reject Submission')
                .addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('reason')
                        .setLabel('Reason (shown to applicant)')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setMaxLength(500)
                )));
        }
        if (id.startsWith('sshot_reassign_')) {
            if (!isReviewerMember(interaction.member)) return permissionDenied(interaction);
            const subId = id.replace('sshot_reassign_', '');
            const cfg = mgr.getGuildConfig(guildId);
            if (!cfg.tasks?.length) {
                return interaction.reply({
                    components: [buildErrorResponse('No Tasks', 'There are no tasks configured.')],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }
            const opts = cfg.tasks.slice(0, 25).map(t => ({
                label: t.name.slice(0, 100),
                description: (t.target || TASK_PRESETS[t.type]?.label || '').slice(0, 100),
                value: t.id
            }));
            const c = new ContainerBuilder()
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `### <:Editalt:1521227921673556019> Re-assign Task\nPick the correct task for submission \`${subId}\`.`
                ))
                .addActionRowComponents(new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(`sshot_reassign_pick_${subId}`)
                        .setPlaceholder('Select the correct task…')
                        .addOptions(opts)
                ));
            return interaction.reply({
                components: [c],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        }
        if (id.startsWith('sshot_reassign_pick_') && interaction.isStringSelectMenu?.()) {
            if (!isReviewerMember(interaction.member)) return permissionDenied(interaction);
            const subId = id.replace('sshot_reassign_pick_', '');
            const taskId = interaction.values[0];
            const result = mgr.reassignTask(guildId, subId, taskId);
            if (!result.ok) {
                return interaction.update({
                    components: [buildErrorResponse('Failed', 'Could not re-assign — submission may have been deleted.')],
                    flags: MessageFlags.IsComponentsV2
                });
            }
            // Re-render the original review message with the new task
            const cfg = mgr.getGuildConfig(guildId);
            const sub = mgr.loadSubs()[guildId]?.[subId];
            if (sub?.reviewChannelId && sub?.reviewMessageId) {
                try {
                    const ch  = interaction.guild.channels.cache.get(sub.reviewChannelId);
                    const msg = await ch?.messages?.fetch(sub.reviewMessageId);
                    if (msg) {
                        const { buildReviewMessage } = require('../../utils/screenshotVerifyEmbeds');
                        await msg.edit({ components: [buildReviewMessage(sub, result.task, cfg, sub.ai)] });
                    }
                } catch {}
            }
            return interaction.update({
                components: [buildSuccessResponse('Re-assigned', `Submission \`${subId}\` is now under **${result.task.name}**.`)],
                flags: MessageFlags.IsComponentsV2
            });
        }

        /* ── ADMIN-ONLY from here ─────────────────────────────────────── */
        if (!isAdminMember(interaction.member)) return permissionDenied(interaction);

        if (id === 'sshot_toggle')        return handleToggle(interaction);
        if (id === 'sshot_send_panel')    return handleSendUserPanel(interaction);
        if (id === 'sshot_pending')       return showPendingList(interaction, true);
        if (id === 'sshot_messages')      return openMessagesModal(interaction);
        if (id === 'sshot_settings')      return openSettingsModal(interaction);
        if (id === 'sshot_apply_privacy') return handleApplyPrivacy(interaction);
        if (id === 'sshot_toggle_hide')   return handleToggleHide(interaction);
        if (id === 'sshot_cycle_mode')    return handleCycleMode(interaction);
        if (id === 'sshot_cycle_engine')  return handleCycleEngine(interaction);
        if (id === 'sshot_reset')         return openResetConfirm(interaction);
        if (id === 'sshot_reset_confirm') return handleResetConfirm(interaction);
        if (id === 'sshot_reset_cancel') {
            return interaction.update({
                components: [buildSuccessResponse('Cancelled', 'No changes were made.')],
                flags: MessageFlags.IsComponentsV2
            });
        }

        // Channel pickers (open ephemeral select)
        if (id === 'sshot_set_channel') return openChannelSelect(interaction, 'sshot_select_submission', 'Submission Channel', 'Members will post screenshots here.');
        if (id === 'sshot_set_review')  return openChannelSelect(interaction, 'sshot_select_review',     'Review Channel',     'Submissions awaiting manual review go here.');
        if (id === 'sshot_set_log')     return openChannelSelect(interaction, 'sshot_select_log',        'Log Channel',        'Audit trail of every action.');

        // Channel select results
        if (interaction.isChannelSelectMenu?.()) {
            const map = {
                'sshot_select_submission': 'submissionChannelId',
                'sshot_select_review':     'reviewChannelId',
                'sshot_select_log':        'logChannelId'
            };
            if (map[id]) {
                const channelId = interaction.values[0];
                const updated = mgr.setGuildConfig(guildId, { [map[id]]: channelId });
                await interaction.update({
                    components: [buildSuccessResponse('Channel Set', `<#${channelId}> saved.`)],
                    flags: MessageFlags.IsComponentsV2
                });
                refreshSetupPanel(interaction.client, interaction.guild);

                // When submission channel is (re)assigned and system is
                // already enabled, auto-apply privacy so the new channel
                // inherits the same lockdown without an extra click.
                if (map[id] === 'submissionChannelId' && updated.enabled) {
                    mgr.applyChannelPrivacy(interaction.guild, updated).catch(() => {});
                }
                return;
            }
            // Action role selects
            return handleActionChannelSelect(interaction);
        }

        if (interaction.isRoleSelectMenu?.()) {
            return handleActionRoleSelect(interaction);
        }

        // ── Tasks ─────────────────────────────────────────────────────
        if (id === 'sshot_task_new') return openTaskTypeSelect(interaction);
        if (id === 'sshot_task_back') {
            const cfg = mgr.getGuildConfig(guildId);
            return interaction.update({
                components: [buildSetupPanel(interaction.guild, cfg)],
                flags: MessageFlags.IsComponentsV2
            });
        }
        if (id === 'sshot_task_type_select' && interaction.isStringSelectMenu?.()) {
            return openTaskCreateModal(interaction, interaction.values[0]);
        }
        if (id === 'sshot_task_select' && interaction.isStringSelectMenu?.()) {
            const taskId = (interaction.values[0] || '').replace(/^edit_/, '');
            return openTaskEditor(interaction, taskId);
        }
        if (id.startsWith('sshot_task_edit_'))     return openTaskEditModal(interaction, id.replace('sshot_task_edit_', ''));
        if (id.startsWith('sshot_task_keywords_')) return openTaskKeywordsModal(interaction, id.replace('sshot_task_keywords_', ''));
        if (id.startsWith('sshot_task_delete_'))   return handleTaskDelete(interaction, id.replace('sshot_task_delete_', ''));

        // ── Action add buttons ────────────────────────────────────────
        if (id.startsWith('sshot_act_addrole_'))  return openActionRoleSelect(interaction, id.replace('sshot_act_addrole_', ''),  'add_role');
        if (id.startsWith('sshot_act_remrole_'))  return openActionRoleSelect(interaction, id.replace('sshot_act_remrole_', ''),  'remove_role');
        if (id.startsWith('sshot_act_sendch_'))   return openActionChannelSelect(interaction, id.replace('sshot_act_sendch_', ''));
        if (id.startsWith('sshot_act_senddm_'))   return openActionDMModal(interaction, id.replace('sshot_act_senddm_', ''));

        if (id.startsWith('sshot_act_remove_') && interaction.isStringSelectMenu?.()) {
            const taskId   = id.replace('sshot_act_remove_', '');
            const actionId = (interaction.values[0] || '').replace(/^del_/, '');
            mgr.removeAction(guildId, taskId, actionId);
            const cfg  = mgr.getGuildConfig(guildId);
            const task = mgr.getTask(cfg, taskId);
            if (!task) {
                return interaction.update({
                    components: [buildSetupPanel(interaction.guild, cfg)],
                    flags: MessageFlags.IsComponentsV2
                });
            }
            await interaction.update({
                components: [buildTaskEditor(interaction.guild, cfg, task)],
                flags: MessageFlags.IsComponentsV2
            });
            refreshSetupPanel(interaction.client, interaction.guild);
            return;
        }
    },

    /* ═════════════════════════════════════════════════════════════════
       MODAL ROUTER
       ═════════════════════════════════════════════════════════════════ */

    async handleModalSubmit(interaction) {
        if (!interaction.isModalSubmit?.()) return false;
        const id = interaction.customId;
        if (!id.startsWith('sshot_modal_')) return false;

        const guildId = interaction.guild.id;

        if (id.startsWith('sshot_modal_reject_')) {
            if (!isReviewerMember(interaction.member)) {
                await permissionDenied(interaction);
                return true;
            }
            const subId  = id.replace('sshot_modal_reject_', '');
            const reason = interaction.fields.getTextInputValue('reason').trim();
            await handleManualReview(interaction, subId, 'rejected', reason);
            return true;
        }

        if (!isAdminMember(interaction.member)) {
            await permissionDenied(interaction);
            return true;
        }

        if (id === 'sshot_modal_messages') {
            const approveMessage = interaction.fields.getTextInputValue('approve_msg').trim();
            const rejectMessage  = interaction.fields.getTextInputValue('reject_msg').trim();
            mgr.setGuildConfig(guildId, { approveMessage, rejectMessage });
            await interaction.reply({
                components: [buildSuccessResponse('DM Messages Saved', 'Both DM messages have been updated.')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            return true;
        }

        if (id === 'sshot_modal_settings') {
            const partial = {};
            const modeRaw       = interaction.fields.getTextInputValue('mode').trim().toLowerCase();
            const verifierRaw   = interaction.fields.getTextInputValue('verifier').trim().toLowerCase();
            const confRaw       = interaction.fields.getTextInputValue('confidence').trim();
            const cooldownRaw   = interaction.fields.getTextInputValue('cooldown_h').trim();
            const autoDeleteRaw = interaction.fields.getTextInputValue('auto_delete').trim().toLowerCase();

            if (['auto', 'review', 'hybrid'].includes(modeRaw))     partial.mode = modeRaw;
            if (['ocr', 'ai', 'hybrid'].includes(verifierRaw))      partial.verifier = verifierRaw;
            const conf = parseInt(confRaw, 10);
            if (!isNaN(conf) && conf >= 50 && conf <= 100) partial.confidenceThreshold = conf;
            const h = parseFloat(cooldownRaw);
            if (!isNaN(h) && h >= 0 && h <= 24 * 30) partial.cooldown = Math.floor(h * 3600000);
            if (['yes', 'y', 'on', '1', 'true'].includes(autoDeleteRaw))   partial.autoDelete = true;
            if (['no', 'n', 'off', '0', 'false'].includes(autoDeleteRaw))  partial.autoDelete = false;

            const updated = mgr.setGuildConfig(guildId, partial);
            await interaction.reply({
                components: [buildSuccessResponse(
                    'Behavior Saved',
                    'Verification behavior has been updated.',
                    {
                        Mode:       updated.mode,
                        Engine:     updated.verifier || 'hybrid',
                        Confidence: `${updated.confidenceThreshold}%`,
                        Cooldown:   formatDuration(updated.cooldown),
                        AutoDelete: updated.autoDelete ? 'On' : 'Off'
                    }
                )],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
            refreshSetupPanel(interaction.client, interaction.guild);
            return true;
        }

        if (id.startsWith('sshot_modal_taskcreate_')) {
            const type = id.replace('sshot_modal_taskcreate_', '');
            const preset = TASK_PRESETS[type] || TASK_PRESETS.custom;
            const data = {
                name:        interaction.fields.getTextInputValue('name').trim() || preset.defaultName,
                target:      interaction.fields.getTextInputValue('target').trim(),
                description: interaction.fields.getTextInputValue('description').trim() || preset.defaultDescription,
                keywords:    interaction.fields.getTextInputValue('keywords').split(',').map(s => s.trim()).filter(Boolean),
                type
            };
            try {
                const created = mgr.addTask(guildId, data);
                const cfg = mgr.getGuildConfig(guildId);
                await interaction.reply({
                    components: [buildTaskEditor(interaction.guild, cfg, created)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
                refreshSetupPanel(interaction.client, interaction.guild);
            } catch (e) {
                await interaction.reply({
                    components: [buildErrorResponse('Could Not Create Task', e.message || 'Unknown error.')],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }
            return true;
        }

        if (id.startsWith('sshot_modal_taskedit_')) {
            const taskId = id.replace('sshot_modal_taskedit_', '');
            const partial = {
                name:        interaction.fields.getTextInputValue('name').trim(),
                target:      interaction.fields.getTextInputValue('target').trim(),
                description: interaction.fields.getTextInputValue('description').trim()
            };
            mgr.updateTask(guildId, taskId, partial);
            const cfg  = mgr.getGuildConfig(guildId);
            const task = mgr.getTask(cfg, taskId);
            if (task) {
                await interaction.reply({
                    components: [buildTaskEditor(interaction.guild, cfg, task)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }
            refreshSetupPanel(interaction.client, interaction.guild);
            return true;
        }

        if (id.startsWith('sshot_modal_taskkeywords_')) {
            const taskId = id.replace('sshot_modal_taskkeywords_', '');
            const keywords = interaction.fields.getTextInputValue('keywords')
                .split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
            mgr.updateTask(guildId, taskId, { keywords });
            const cfg  = mgr.getGuildConfig(guildId);
            const task = mgr.getTask(cfg, taskId);
            if (task) {
                await interaction.reply({
                    components: [buildTaskEditor(interaction.guild, cfg, task)],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }
            refreshSetupPanel(interaction.client, interaction.guild);
            return true;
        }

        if (id.startsWith('sshot_modal_actsendch_')) {
            const taskId = id.replace('sshot_modal_actsendch_', '');
            const pending = getPending(guildId, interaction.user.id);
            if (!pending || pending.kind !== 'send_channel' || pending.taskId !== taskId) {
                await interaction.reply({
                    components: [buildErrorResponse('Session Expired', 'Please re-pick the channel and try again.')],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
                return true;
            }
            const content = interaction.fields.getTextInputValue('content').trim();
            try {
                mgr.addAction(guildId, taskId, { type: 'send_channel', channelId: pending.channelId, content });
                clearPending(guildId, interaction.user.id);
                const cfg  = mgr.getGuildConfig(guildId);
                const task = mgr.getTask(cfg, taskId);
                if (task) {
                    await interaction.reply({
                        components: [buildTaskEditor(interaction.guild, cfg, task)],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                    });
                }
                refreshSetupPanel(interaction.client, interaction.guild);
            } catch (e) {
                await interaction.reply({
                    components: [buildErrorResponse('Could Not Add Action', e.message || 'Unknown error.')],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }
            return true;
        }

        if (id.startsWith('sshot_modal_actsenddm_')) {
            const taskId  = id.replace('sshot_modal_actsenddm_', '');
            const content = interaction.fields.getTextInputValue('content').trim();
            try {
                mgr.addAction(guildId, taskId, { type: 'send_dm', content });
                const cfg  = mgr.getGuildConfig(guildId);
                const task = mgr.getTask(cfg, taskId);
                if (task) {
                    await interaction.reply({
                        components: [buildTaskEditor(interaction.guild, cfg, task)],
                        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                    });
                }
                refreshSetupPanel(interaction.client, interaction.guild);
            } catch (e) {
                await interaction.reply({
                    components: [buildErrorResponse('Could Not Add Action', e.message || 'Unknown error.')],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                });
            }
            return true;
        }

        return false;
    }
};

/* ═══════════════════════════════════════════════════════════════════
   ADMIN BUTTON HANDLERS
   ═══════════════════════════════════════════════════════════════════ */

async function permissionDenied(interaction) {
    return interaction.reply({
        components: [buildPermissionDenied('Manage Server / Manage Roles')],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
}

async function handleToggle(interaction) {
    const guildId = interaction.guild.id;
    const cfg = mgr.getGuildConfig(guildId);
    if (!cfg.enabled) {
        // Validate before enabling
        if (!cfg.submissionChannelId)
            return interaction.reply({
                components: [buildErrorResponse('Setup Required', 'Set the submission channel first.')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        if (cfg.mode !== 'auto' && !cfg.reviewChannelId)
            return interaction.reply({
                components: [buildErrorResponse('Setup Required', 'Set the review channel (or switch mode to "auto").')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        if (!cfg.tasks?.length)
            return interaction.reply({
                components: [buildErrorResponse('Setup Required', 'Create at least one verification task first.')],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
        const incomplete = (cfg.tasks || []).find(t => !t.actions || t.actions.length === 0);
        if (incomplete)
            return interaction.reply({
                components: [buildErrorResponse(
                    'Setup Required',
                    `Task **${incomplete.name}** has no actions. Add at least one action so approval has an effect.`
                )],
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
            });
    }

    const updated = mgr.setGuildConfig(guildId, { enabled: !cfg.enabled });
    await interaction.update({
        components: [buildSetupPanel(interaction.guild, updated)],
        flags: MessageFlags.IsComponentsV2
    });

    // When the system flips to enabled, auto-apply the channel-privacy
    // permission overwrites in the background. Best-effort — failures
    // are surfaced via the audit log if a log channel is configured.
    if (updated.enabled) {
        mgr.applyChannelPrivacy(interaction.guild, updated)
            .then((res) => {
                if (!res.ok && res.error) {
                    mgr.logAudit(interaction.guild, updated,
                        `<:Infotriangle:1521227710381428926> Could not auto-apply privacy: ${res.error}`).catch(() => {});
                }
            })
            .catch(() => {});
    }
}

/**
 * One-click privacy lockdown for the submission channel:
 *   - @everyone  : ViewChannel + SendMessages + AttachFiles, but
 *                  ReadMessageHistory + AddReactions + EmbedLinks DENIED.
 *   - Verified roles : ViewChannel DENIED so once the user is verified
 *                      Discord hides the channel from them automatically.
 *   - Bot : full overwrite for moderation.
 */
async function handleApplyPrivacy(interaction) {
    const cfg = mgr.getGuildConfig(interaction.guild.id);
    if (!cfg.submissionChannelId) {
        return interaction.reply({
            components: [buildErrorResponse('No Channel', 'Set the submission channel first.')],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await mgr.applyChannelPrivacy(interaction.guild, cfg);

    if (!result.ok) {
        return interaction.editReply({
            components: [buildErrorResponse(
                'Privacy Not Applied',
                result.error || 'Unknown error — check that I have **Manage Channels** on the submission channel.'
            )],
            flags: MessageFlags.IsComponentsV2
        });
    }

    const details = {
        '@everyone':      'View + Send + Attach allowed · History/Reactions/Embeds denied',
        'Verified Roles': result.verifiedRoleLocks.length
            ? result.verifiedRoleLocks.map(r => `<@&${r}>`).join(', ') + ' · channel hidden'
            : 'None — add a `Grant Role` action on a task to enable hide-after-verify'
    };
    if (result.warnings.length) details['Warnings'] = result.warnings.map(w => `• ${w}`).join('\n');

    return interaction.editReply({
        components: [buildSuccessResponse(
            'Privacy Applied',
            `Submission channel <#${cfg.submissionChannelId}> is now locked down. Members can post screenshots but can't read each other's submissions, and verified members lose access to the channel.`,
            details
        )],
        flags: MessageFlags.IsComponentsV2
    });
}

/**
 * Toggle the `hideAfterVerify` config flag and immediately re-apply
 * channel privacy so the verified-role overwrite is added or removed
 * to match. When the flag is OFF, we explicitly clear the verified
 * role overwrites so verified members regain visibility.
 */
async function handleToggleHide(interaction) {
    const guildId = interaction.guild.id;
    const cfg = mgr.getGuildConfig(guildId);
    const next = cfg.hideAfterVerify === false ? true : false;
    const updated = mgr.setGuildConfig(guildId, { hideAfterVerify: next });

    // If we're turning hide OFF and there are verified-role overwrites
    // already on the channel, strip the ViewChannel:false overrides so
    // the channel becomes visible again to verified members.
    if (next === false && updated.submissionChannelId) {
        try {
            const ch = interaction.guild.channels.cache.get(updated.submissionChannelId);
            if (ch?.permissionOverwrites) {
                const verifiedRoleIds = new Set();
                for (const task of (updated.tasks || [])) {
                    for (const action of (task.actions || [])) {
                        if (action.type === 'add_role' && action.roleId) verifiedRoleIds.add(action.roleId);
                    }
                }
                for (const roleId of verifiedRoleIds) {
                    const role = interaction.guild.roles.cache.get(roleId);
                    if (role) {
                        await ch.permissionOverwrites.edit(role, { ViewChannel: null }, {
                            reason: 'Screenshot Verify: Hide-After-Verify disabled'
                        }).catch(() => {});
                    }
                }
            }
        } catch {}
    }

    await interaction.update({
        components: [buildSetupPanel(interaction.guild, updated)],
        flags: MessageFlags.IsComponentsV2
    });

    // Re-apply privacy with the new flag so everything is in sync
    if (updated.submissionChannelId && updated.enabled) {
        mgr.applyChannelPrivacy(interaction.guild, updated).catch(() => {});
    }
}

/**
 * Cycle the verification mode: auto → hybrid → review → auto.
 * One click flips between auto/manual/hybrid without opening a modal.
 */
async function handleCycleMode(interaction) {
    const guildId = interaction.guild.id;
    const cfg = mgr.getGuildConfig(guildId);
    const NEXT = { auto: 'hybrid', hybrid: 'review', review: 'auto' };
    const next = NEXT[cfg.mode] || 'hybrid';
    const updated = mgr.setGuildConfig(guildId, { mode: next });
    return interaction.update({
        components: [buildSetupPanel(interaction.guild, updated)],
        flags: MessageFlags.IsComponentsV2
    });
}

/**
 * Cycle the detection engine: ocr → ai → hybrid → ocr.
 * Lets admins flip between local OCR (free, deterministic) and the
 * Groq vision LLM (broader visual understanding) instantly.
 */
async function handleCycleEngine(interaction) {
    const guildId = interaction.guild.id;
    const cfg = mgr.getGuildConfig(guildId);
    const NEXT = { ocr: 'ai', ai: 'hybrid', hybrid: 'ocr' };
    const current = cfg.verifier || 'hybrid';
    const next = NEXT[current] || 'hybrid';
    const updated = mgr.setGuildConfig(guildId, { verifier: next });
    return interaction.update({
        components: [buildSetupPanel(interaction.guild, updated)],
        flags: MessageFlags.IsComponentsV2
    });
}

async function handleSendUserPanel(interaction) {
    const cfg = mgr.getGuildConfig(interaction.guild.id);
    if (!cfg.enabled) {
        return interaction.reply({
            components: [buildErrorResponse('Disabled', 'Enable the system first.')],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }
    if (!cfg.submissionChannelId) {
        return interaction.reply({
            components: [buildErrorResponse('No Channel', 'Set the submission channel first.')],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }
    const ch = interaction.guild.channels.cache.get(cfg.submissionChannelId);
    if (!ch?.isTextBased?.()) {
        return interaction.reply({
            components: [buildErrorResponse('Invalid Channel', 'Submission channel is missing or not a text channel.')],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    // Delete any previously-tracked panel before sending the new one
    const tracked = stickyPanels.get(interaction.guild.id);
    if (tracked?.channelId === ch.id && tracked.messageId) {
        try {
            const old = await ch.messages.fetch(tracked.messageId);
            await old.delete().catch(() => {});
        } catch {}
    }

    const sent = await ch.send({
        components: [buildUserPanel(cfg)],
        flags: MessageFlags.IsComponentsV2
    }).catch(() => null);
    if (!sent) {
        return interaction.reply({
            components: [buildErrorResponse('Send Failed', 'Could not send in the submission channel — check my permissions.')],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }
    recordStickyPanel(interaction.guild.id, ch.id, sent.id);

    return interaction.reply({
        components: [buildSuccessResponse(
            'User Panel Sent',
            `Sent to <#${cfg.submissionChannelId}>. The panel will auto-refloat after each submission so it stays at the bottom of the channel.`
        )],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
}

async function openMessagesModal(interaction) {
    const cfg = mgr.getGuildConfig(interaction.guild.id);
    return interaction.showModal(new ModalBuilder()
        .setCustomId('sshot_modal_messages')
        .setTitle('Approve / Reject DM Messages')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('approve_msg')
                    .setLabel('Approval DM')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(cfg.approveMessage || '')
                    .setMaxLength(500)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('reject_msg')
                    .setLabel('Rejection DM (default reason)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(cfg.rejectMessage || '')
                    .setMaxLength(500)
                    .setRequired(true)
            )
        ));
}

async function openSettingsModal(interaction) {
    const cfg = mgr.getGuildConfig(interaction.guild.id);
    return interaction.showModal(new ModalBuilder()
        .setCustomId('sshot_modal_settings')
        .setTitle('Verification Behavior')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('mode')
                    .setLabel('Mode (auto / review / hybrid)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(cfg.mode)
                    .setRequired(true)
                    .setMaxLength(8)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('verifier')
                    .setLabel('Engine (ocr / ai / hybrid)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(cfg.verifier || 'hybrid')
                    .setRequired(true)
                    .setMaxLength(8)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('confidence')
                    .setLabel('Confidence Threshold (50-100)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(cfg.confidenceThreshold))
                    .setRequired(true)
                    .setMaxLength(3)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('cooldown_h')
                    .setLabel('Cooldown after rejection (hours)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(String(((cfg.cooldown || 0) / 3600000).toFixed(2)).replace(/\.00$/, ''))
                    .setRequired(false)
                    .setMaxLength(8)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('auto_delete')
                    .setLabel('Auto-delete source message? (yes/no)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(cfg.autoDelete ? 'yes' : 'no')
                    .setRequired(false)
                    .setMaxLength(3)
            )
        ));
}

async function openResetConfirm(interaction) {
    const c = new ContainerBuilder()
        .setAccentColor(0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Infotriangle:1521227710381428926> Reset Screenshot Verification\n\n`
            + `This will:\n`
            + `> Disable the system\n`
            + `> Delete every task and action\n`
            + `> Clear every submission record\n\n`
            + `**This cannot be undone.**`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('sshot_reset_confirm')
                .setLabel('Confirm Reset')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Trash:1521227750420254820>'),
            new ButtonBuilder()
                .setCustomId('sshot_reset_cancel')
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('<:Cancel:1521227723916181644>')
        ));
    return interaction.reply({
        components: [c],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
}

async function handleResetConfirm(interaction) {
    const guildId = interaction.guild.id;
    const cfgAll = mgr.loadConfig();
    delete cfgAll[guildId];
    mgr.saveConfig(cfgAll);
    const subs = mgr.loadSubs();
    delete subs[guildId];
    mgr.saveSubs(subs);
    await interaction.update({
        components: [buildSuccessResponse('Reset Complete', 'All verification data for this server has been cleared.')],
        flags: MessageFlags.IsComponentsV2
    });
    refreshSetupPanel(interaction.client, interaction.guild);
}

async function openChannelSelect(interaction, customId, title, desc) {
    const c = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Hashtag:1521227771957870604> ${title}\n-# ${desc}`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(customId)
                .setPlaceholder('Select a channel…')
                .setChannelTypes(ChannelType.GuildText)
        ));
    return interaction.reply({
        components: [c],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
}

/* ═══════════════════════════════════════════════════════════════════
   TASK FLOWS
   ═══════════════════════════════════════════════════════════════════ */

async function openTaskTypeSelect(interaction) {
    const cfg = mgr.getGuildConfig(interaction.guild.id);
    if ((cfg.tasks || []).length >= 15) {
        return interaction.reply({
            components: [buildErrorResponse('Limit Reached', 'You already have 15 tasks (the maximum).')],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }
    const opts = Object.entries(TASK_PRESETS).map(([type, p]) => ({
        label: p.label,
        description: p.defaultDescription.slice(0, 100),
        value: type
    }));
    const c = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Add:1521227828199293152> New Verification Task\nPick the type. We'll pre-fill sensible defaults.`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('sshot_task_type_select')
                .setPlaceholder('Choose a task type…')
                .addOptions(opts)
        ));
    return interaction.reply({
        components: [c],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
}

async function openTaskCreateModal(interaction, type) {
    const preset = TASK_PRESETS[type] || TASK_PRESETS.custom;
    return interaction.showModal(new ModalBuilder()
        .setCustomId(`sshot_modal_taskcreate_${type}`)
        .setTitle(`New: ${preset.label}`)
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('name')
                    .setLabel('Task Name')
                    .setStyle(TextInputStyle.Short)
                    .setValue(preset.defaultName)
                    .setMaxLength(60)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('target')
                    .setLabel('Target')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(preset.targetHint)
                    .setMaxLength(200)
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('description')
                    .setLabel('Description (shown to users)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(preset.defaultDescription)
                    .setMaxLength(500)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('keywords')
                    .setLabel('Keywords (comma-separated, AI hints)')
                    .setStyle(TextInputStyle.Short)
                    .setValue((preset.defaultKeywords || []).join(', '))
                    .setMaxLength(300)
                    .setRequired(false)
            )
        ));
}

async function openTaskEditor(interaction, taskId) {
    const cfg = mgr.getGuildConfig(interaction.guild.id);
    const task = mgr.getTask(cfg, taskId);
    if (!task) {
        return interaction.update({
            components: [buildErrorResponse('Not Found', 'That task no longer exists.')],
            flags: MessageFlags.IsComponentsV2
        });
    }
    return interaction.update({
        components: [buildTaskEditor(interaction.guild, cfg, task)],
        flags: MessageFlags.IsComponentsV2
    });
}

async function openTaskEditModal(interaction, taskId) {
    const cfg = mgr.getGuildConfig(interaction.guild.id);
    const task = mgr.getTask(cfg, taskId);
    if (!task) return permissionDenied(interaction);

    return interaction.showModal(new ModalBuilder()
        .setCustomId(`sshot_modal_taskedit_${taskId}`)
        .setTitle('Edit Task Details')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('name')
                    .setLabel('Task Name')
                    .setStyle(TextInputStyle.Short)
                    .setValue(task.name)
                    .setMaxLength(60)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('target')
                    .setLabel('Target')
                    .setStyle(TextInputStyle.Short)
                    .setValue(task.target || '')
                    .setMaxLength(200)
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('description')
                    .setLabel('Description (shown to users)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(task.description || '')
                    .setMaxLength(500)
                    .setRequired(true)
            )
        ));
}

async function openTaskKeywordsModal(interaction, taskId) {
    const cfg = mgr.getGuildConfig(interaction.guild.id);
    const task = mgr.getTask(cfg, taskId);
    if (!task) return;
    return interaction.showModal(new ModalBuilder()
        .setCustomId(`sshot_modal_taskkeywords_${taskId}`)
        .setTitle('Edit Keywords')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('keywords')
                .setLabel('Keywords (comma-separated, AI hints)')
                .setStyle(TextInputStyle.Paragraph)
                .setValue((task.keywords || []).join(', '))
                .setMaxLength(500)
                .setRequired(false)
        )));
}

async function handleTaskDelete(interaction, taskId) {
    mgr.deleteTask(interaction.guild.id, taskId);
    const cfg = mgr.getGuildConfig(interaction.guild.id);
    await interaction.update({
        components: [buildSetupPanel(interaction.guild, cfg)],
        flags: MessageFlags.IsComponentsV2
    });
    refreshSetupPanel(interaction.client, interaction.guild);
}

/* ═══════════════════════════════════════════════════════════════════
   ACTION FLOWS (role / channel / DM)
   ═══════════════════════════════════════════════════════════════════ */

async function openActionRoleSelect(interaction, taskId, kind /* 'add_role'|'remove_role' */) {
    setPending(interaction.guild.id, interaction.user.id, { kind, taskId });
    const c = new ContainerBuilder()
        .setAccentColor(kind === 'add_role' ? 0x57F287 : 0xFEE75C)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Userplus:1521227719621218477> ${kind === 'add_role' ? 'Pick role to add' : 'Pick role to remove'}\n-# Selected role will run on every successful verification of this task.`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder()
                .setCustomId(`sshot_select_action_role_${taskId}`)
                .setPlaceholder('Select a role…')
        ));
    return interaction.reply({
        components: [c],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
}

async function openActionChannelSelect(interaction, taskId) {
    setPending(interaction.guild.id, interaction.user.id, { kind: 'send_channel', taskId });
    const c = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Hashtag:1521227771957870604> Pick channel for the announcement\n-# After picking the channel, you'll write the message content.`
        ))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
                .setCustomId(`sshot_select_action_channel_${taskId}`)
                .setPlaceholder('Select a channel…')
                .setChannelTypes(ChannelType.GuildText)
        ));
    return interaction.reply({
        components: [c],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
}

async function openActionDMModal(interaction, taskId) {
    return interaction.showModal(new ModalBuilder()
        .setCustomId(`sshot_modal_actsenddm_${taskId}`)
        .setTitle('DM Message')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('content')
                .setLabel('Message (placeholders: {user} {task} {server})')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Welcome {user}! Thanks for completing {task}.')
                .setMaxLength(1500)
                .setRequired(true)
        )));
}

async function handleActionRoleSelect(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('sshot_select_action_role_')) return;
    const taskId = id.replace('sshot_select_action_role_', '');
    const pending = getPending(interaction.guild.id, interaction.user.id);
    if (!pending || pending.taskId !== taskId
        || (pending.kind !== 'add_role' && pending.kind !== 'remove_role')) {
        return interaction.update({
            components: [buildErrorResponse('Session Expired', 'Please re-click the action button.')],
            flags: MessageFlags.IsComponentsV2
        });
    }
    const roleId = interaction.values[0];
    const role = interaction.guild.roles.cache.get(roleId);
    const me = interaction.guild.members.me;
    if (role && me && role.position >= me.roles.highest.position) {
        return interaction.update({
            components: [buildErrorResponse('Role Hierarchy', `<@&${roleId}> is at or above my highest role. Move my role above it and try again.`)],
            flags: MessageFlags.IsComponentsV2
        });
    }
    try {
        mgr.addAction(interaction.guild.id, taskId, { type: pending.kind, roleId });
        clearPending(interaction.guild.id, interaction.user.id);
        const cfg = mgr.getGuildConfig(interaction.guild.id);
        const task = mgr.getTask(cfg, taskId);
        await interaction.update({
            components: [task
                ? buildTaskEditor(interaction.guild, cfg, task)
                : buildSetupPanel(interaction.guild, cfg)],
            flags: MessageFlags.IsComponentsV2
        });
        refreshSetupPanel(interaction.client, interaction.guild);

        // Adding a `Grant Role` action means a new "verified role" exists.
        // Auto re-apply privacy so the role gets ViewChannel: deny on the
        // submission channel without the admin having to click another
        // button. Only fire when the system is enabled and a submission
        // channel is set; otherwise nothing to lock yet.
        if (pending.kind === 'add_role' && cfg.enabled && cfg.submissionChannelId) {
            mgr.applyChannelPrivacy(interaction.guild, cfg).catch(() => {});
        }
    } catch (e) {
        await interaction.update({
            components: [buildErrorResponse('Could Not Add Action', e.message || 'Unknown error.')],
            flags: MessageFlags.IsComponentsV2
        });
    }
}

async function handleActionChannelSelect(interaction) {
    const id = interaction.customId;
    if (!id.startsWith('sshot_select_action_channel_')) return;
    const taskId = id.replace('sshot_select_action_channel_', '');
    const pending = getPending(interaction.guild.id, interaction.user.id);
    if (!pending || pending.taskId !== taskId || pending.kind !== 'send_channel') {
        return interaction.update({
            components: [buildErrorResponse('Session Expired', 'Please re-click the action button.')],
            flags: MessageFlags.IsComponentsV2
        });
    }
    const channelId = interaction.values[0];
    setPending(interaction.guild.id, interaction.user.id, { kind: 'send_channel', taskId, channelId });

    return interaction.showModal(new ModalBuilder()
        .setCustomId(`sshot_modal_actsendch_${taskId}`)
        .setTitle('Channel Message')
        .addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('content')
                .setLabel('Message (placeholders: {user} {task} {role})')
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder('Welcome {user}, you completed {task}!')
                .setMaxLength(1500)
                .setRequired(true)
        )));
}

/* ═══════════════════════════════════════════════════════════════════
   MANUAL REVIEW
   ═══════════════════════════════════════════════════════════════════ */

async function handleManualReview(interaction, submissionId, action, reason) {
    const result = await mgr.manualReview({ interaction, submissionId, action, reason });

    if (result.locked) {
        return interaction.reply({
            components: [buildErrorResponse('Processing', 'Another moderator is already handling this submission.')],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }
    if (result.notFound) {
        return interaction.reply({
            components: [buildErrorResponse('Not Found', 'This submission no longer exists.')],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }
    if (result.alreadyDone) {
        return interaction.reply({
            components: [buildErrorResponse(
                'Already Processed',
                `This submission was already **${result.alreadyDone.status}**${result.alreadyDone.reviewedBy ? ` by <@${result.alreadyDone.reviewedBy}>` : ''}.`
            )],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    const updated = buildReviewedMessage(
        result.submission, result.task, result.cfg,
        action, interaction.user.id, reason, result.actionResults
    );

    if (interaction.isModalSubmit?.()) {
        await interaction.reply({
            components: [buildSuccessResponse(
                action === 'approved' ? 'Approved' : 'Rejected',
                `Submission \`${result.submission.id}\` updated.`
            )],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
        if (result.submission.reviewChannelId && result.submission.reviewMessageId) {
            try {
                const ch  = interaction.guild.channels.cache.get(result.submission.reviewChannelId);
                const msg = await ch?.messages?.fetch(result.submission.reviewMessageId);
                if (msg) await msg.edit({ components: [updated] });
            } catch {}
        }
    } else {
        await interaction.update({
            components: [updated],
            flags: MessageFlags.IsComponentsV2
        }).catch(() => {});
    }

    refreshSetupPanel(interaction.client, interaction.guild);
}

/* ═══════════════════════════════════════════════════════════════════
   USER-FACING SUBMIT RESULT FORMATTER
   ═══════════════════════════════════════════════════════════════════ */

function formatSubmitResult(result) {
    if (!result.ok) {
        return {
            components: [buildErrorResponse('Could Not Submit', result.error)],
            flags: MessageFlags.IsComponentsV2
        };
    }

    const sub = result.submission;
    const ai  = result.ai;

    if (result.decision === 'auto-approved') {
        const aSummary = (result.actionResults || []).map(r =>
            `${r.ok ? '<:Checkedbox:1521227734943269077>' : '<:Cancel:1521227723916181644>'} ${ACTION_PRESETS[r.action.type]?.label || r.action.type}`
        ).join('  ·  ') || '_No actions_';
        return {
            components: [buildSuccessResponse(
                'Auto-Verified',
                `Your screenshot for **${result.task.name}** was approved automatically.`,
                {
                    [`${engineLabelFromAi(ai)} Confidence`]: `${ai?.confidence ?? 0}%`,
                    Actions: aSummary,
                    'Submission ID': `\`${sub.id}\``
                }
            )],
            flags: MessageFlags.IsComponentsV2
        };
    }

    if (result.decision === 'auto-rejected') {
        return {
            components: [buildErrorResponse(
                'Auto-Rejected',
                ai?.reasoning || 'Your screenshot did not match the configured task.',
                `Submission ID: \`${sub.id}\``
            )],
            flags: MessageFlags.IsComponentsV2
        };
    }

    return {
        components: [buildSuccessResponse(
            'Queued for Review',
            `Your screenshot for **${result.task.name}** is awaiting staff review. You'll get a DM with the result.`,
            { 'Submission ID': `\`${sub.id}\`` }
        )],
        flags: MessageFlags.IsComponentsV2
    };
}

/* ═══════════════════════════════════════════════════════════════════
   PENDING + LOOKUP
   ═══════════════════════════════════════════════════════════════════ */

async function showPendingList(replyTarget, ephemeral = true) {
    const guildId = replyTarget.guild.id;
    const subs = mgr.loadSubs()[guildId] || {};
    const pending = Object.values(subs)
        .filter(s => s.status === 'pending')
        .sort((a, b) => b.submittedAt - a.submittedAt);

    if (pending.length === 0) {
        const c = buildSuccessResponse('No Pending', 'There are no pending submissions.');
        return replyTarget.reply({
            components: [c],
            flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0)
        });
    }

    const cfg = mgr.getGuildConfig(guildId);
    let content = `# <:Lightning:1521227915537285150> Pending Submissions (${pending.length})\n\n`;
    for (const s of pending.slice(0, 15)) {
        const task = mgr.getTask(cfg, s.taskId);
        content += `> <:User:1521227714227343380> <@${s.userId}> · **${task?.name || 'unknown'}** · \`${s.id}\` · <t:${Math.floor(s.submittedAt / 1000)}:R>`;
        if (s.ai)               content += ` · ${engineLabelFromAi(s.ai)} \`${s.ai.confidence ?? 0}%\``;
        if (s.reviewMessageId)  content += ` · [open](https://discord.com/channels/${guildId}/${s.reviewChannelId}/${s.reviewMessageId})`;
        content += `\n`;
    }
    if (pending.length > 15) content += `\n-# +${pending.length - 15} more pending`;

    const container = new ContainerBuilder()
        .setAccentColor(0xFEE75C)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    return replyTarget.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0)
    });
}

async function showLookup(replyTarget, submissionId) {
    if (!submissionId) {
        return replyTarget.reply({
            components: [buildErrorResponse('Missing ID', 'Provide a submission ID to look up.')],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }
    const guildId = replyTarget.guild.id;
    const sub = mgr.loadSubs()[guildId]?.[submissionId];
    if (!sub) {
        return replyTarget.reply({
            components: [buildErrorResponse('Not Found', `No submission with ID \`${submissionId}\`.`)],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
        });
    }

    const cfg = mgr.getGuildConfig(guildId);
    const task = mgr.getTask(cfg, sub.taskId);
    let content = `# <:Document:1521227875016114266> Submission \`${sub.id}\`\n\n`;
    content += `<:User:1521227714227343380> **Submitter:** <@${sub.userId}>\n`;
    content += `<:Bookmark:1521227835526742066> **Status:** \`${sub.status}\`${sub.decision ? ` (${sub.decision})` : ''}\n`;
    content += `<:Bookopen:1521227911137595605> **Task:** ${task?.name || '`unknown`'}\n`;
    content += `<:Alarm:1521227869047750689> **Submitted:** <t:${Math.floor(sub.submittedAt / 1000)}:F>\n`;
    if (sub.reviewedAt) content += `<:Shield:1521227694677692467> **Reviewed by:** <@${sub.reviewedBy}> · <t:${Math.floor(sub.reviewedAt / 1000)}:R>\n`;
    if (sub.ai)         content += `<:Lightning:1521227915537285150> **${engineLabelFromAi(sub.ai)}:** \`${sub.ai.confidence}%\` · ${sub.ai.matched ? 'match' : 'no-match'}\n> ${sub.ai.reasoning || ''}\n`;
    if (sub.reason)     content += `<:Hashtag:1521227771957870604> **Reason:** ${sub.reason}\n`;
    if (sub.note)       content += `<:Bookopen:1521227911137595605> **Note:** ${sub.note}\n`;

    const { MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
    const accent = sub.status === 'approved' ? 0x57F287 : sub.status === 'rejected' ? 0xED4245 : 0xFEE75C;
    const container = new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(sub.imageUrl))
        );

    return replyTarget.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
}
