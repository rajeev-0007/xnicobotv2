'use strict';

/**
 * roleAllHelper.js — Shared logic for the `/roleall` family of commands.
 *
 * Provides validation, target filtering and concurrency-safe role
 * application/removal for the `humans`, `bots`, and `everyone`
 * subcommand groups (each with `add` / `remove` actions).
 *
 *  © xNico
 */

const {
    PermissionFlagsBits,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags,
} = require('discord.js');

const {
    buildErrorResponse,
    buildPermissionDenied,
    buildRoleHierarchyError,
    COLORS,
    BRANDING,
} = require('./responseBuilder');

// ── Tunables ─────────────────────────────────────────────────────────
const BATCH_SIZE       = 5;     // members processed concurrently per batch
const PROGRESS_EVERY   = 50;    // edit the status message after this many members
const PROGRESS_THROTTLE_MS = 1500;

const TARGET_FILTERS = {
    humans:   (m) => !m.user.bot,
    bots:     (m) =>  m.user.bot,
    everyone: ()  => true,
};
const TARGET_LABELS = {
    humans:   { plural: 'Humans',  singular: 'Human'  },
    bots:     { plural: 'Bots',    singular: 'Bot'    },
    everyone: { plural: 'Members', singular: 'Member' },
};

const VALID_TARGETS = new Set(Object.keys(TARGET_FILTERS));
const VALID_ACTIONS = new Set(['add', 'remove']);

// ── Common validation ───────────────────────────────────────────────
/**
 * Validate the executor and the role together.
 * @returns {ContainerBuilder|null} Error container, or null if everything is fine.
 */
function validate({ guild, role, executor, action }) {
    if (!role) {
        return buildErrorResponse('Role Required', 'You must provide a role.');
    }
    if (role.id === guild.id) {
        return buildErrorResponse('Invalid Role', 'You cannot use the `@everyone` role.');
    }
    if (role.managed) {
        return buildErrorResponse(
            'Managed Role',
            `**${role.name}** is managed by an integration or bot and cannot be assigned manually.`
        );
    }

    const me = guild.members.me;
    if (!me) {
        return buildErrorResponse(
            'Bot Member Missing',
            'I could not find my own member entry in this server. Please re-invite the bot.'
        );
    }
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return buildErrorResponse(
            'Missing Bot Permission',
            'I need the **Manage Roles** permission to perform this action.'
        );
    }

    if (role.position >= me.roles.highest.position) {
        return buildRoleHierarchyError(action === 'remove' ? 'remove this role' : 'assign this role');
    }

    // Owner always bypasses the executor-vs-role hierarchy check.
    if (executor && executor.id !== guild.ownerId) {
        const execHighest = executor.roles?.highest?.position ?? 0;
        if (role.position >= execHighest) {
            return buildErrorResponse(
                'Insufficient Permissions',
                `You cannot ${action === 'remove' ? 'remove' : 'assign'} a role that is higher than or equal to your highest role.`
            );
        }
    }

    return null;
}

// ── Member processing ───────────────────────────────────────────────
/**
 * Run an async task over an iterable with bounded concurrency.
 * Triggers `onTick(processed, total)` roughly every `PROGRESS_EVERY` items.
 */
async function runBatched(items, taskFn, batchSize, onTick) {
    let processed = 0;
    let nextProgressAt = PROGRESS_EVERY;
    for (let i = 0; i < items.length; i += batchSize) {
        const slice = items.slice(i, i + batchSize);
        await Promise.all(slice.map(taskFn));
        processed += slice.length;
        if (onTick && processed >= nextProgressAt) {
            nextProgressAt = processed + PROGRESS_EVERY;
            try { await onTick(processed, items.length); } catch { /* ignore */ }
        }
    }
}

/**
 * Apply or remove `role` for every guild member that matches `targetType`.
 *
 * @returns {Promise<{eligible:number, success:number, skipped:number, failed:number, blocked:number}>}
 */
async function processMembers(ctx) {
    const { guild, role, targetType, action, executorTag, onProgress } = ctx;

    // Use cache when complete; otherwise fetch all once.
    let members = guild.members.cache;
    if (!guild.memberCount || members.size < guild.memberCount) {
        try {
            members = await guild.members.fetch();
        } catch {
            // Fall back to whatever we already have in cache.
            members = guild.members.cache;
        }
    }

    const filterFn = TARGET_FILTERS[targetType];
    const me       = guild.members.me;
    const meTopPos = me.roles.highest.position;
    const reason   = `roleall ${targetType} ${action} by ${executorTag}`.slice(0, 512);

    const candidates = [...members.values()].filter(filterFn);

    let success = 0;
    let skipped = 0;
    let failed  = 0;
    let blocked = 0;

    const work = async (member) => {
        // Discord forbids editing the server owner's roles, regardless of hierarchy.
        if (member.id === guild.ownerId) {
            blocked++;
            return;
        }
        // Skip the bot itself — it cannot meaningfully self-assign.
        if (member.id === me.id) {
            blocked++;
            return;
        }
        // Bot must be hierarchically above the role we're managing.
        // (This is enforced globally in `validate()`, but we re-check the
        // member's highest role only for the very rare case where it is
        // also a managed/integration role above the bot.)
        if (member.roles.highest.position >= meTopPos) {
            blocked++;
            return;
        }

        const has = member.roles.cache.has(role.id);
        if (action === 'add' && has)     { skipped++; return; }
        if (action === 'remove' && !has) { skipped++; return; }

        try {
            if (action === 'add') await member.roles.add(role, reason);
            else                  await member.roles.remove(role, reason);
            success++;
        } catch {
            failed++;
        }
    };

    await runBatched(candidates, work, BATCH_SIZE, onProgress);

    return {
        eligible: candidates.length,
        success,
        skipped,
        failed,
        blocked,
    };
}

// ── Pretty containers ───────────────────────────────────────────────
function buildProcessingContainer({ role, targetType, action }) {
    const label = TARGET_LABELS[targetType].plural;
    const verb  = action === 'add' ? 'Adding' : 'Removing';
    const dir   = action === 'add' ? 'to' : 'from';

    return new ContainerBuilder()
        .setAccentColor(COLORS.WARNING)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <a:Loading:1521227993995940032> ${verb} Role ${dir} ${label}\n\n` +
                `> **Role:** ${role}\n` +
                `> **Target:** ${label}\n` +
                `> Working on it, please hold on...\n\n` +
                `-# Larger servers will take a moment.`
            )
        );
}

function buildProgressContainer({ role, targetType, action, processed, total }) {
    const label = TARGET_LABELS[targetType].plural;
    const verb  = action === 'add' ? 'Adding' : 'Removing';
    const pct   = total === 0 ? 100 : Math.floor((processed / total) * 100);
    const bar   = renderBar(pct);

    return new ContainerBuilder()
        .setAccentColor(COLORS.WARNING)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <a:Loading:1521227993995940032> ${verb} Role — ${label}\n\n` +
                `> **Role:** ${role}\n` +
                `> **Progress:** \`${processed}\` / \`${total}\`  •  **${pct}%**\n` +
                `> ${bar}\n\n` +
                `-# Working in batches to respect Discord rate limits.`
            )
        );
}

function buildResultContainer({ role, targetType, action, stats, executorTag }) {
    const label = TARGET_LABELS[targetType];
    const verb  = action === 'add' ? 'Added to' : 'Removed from';
    const head  = `${verb} ${label.plural}`;
    const successLine = action === 'add' ? 'Added'   : 'Removed';
    const skipLine    = action === 'add' ? 'Already Had' : 'Did Not Have';

    let body =
        `# <:Checkedbox:1521227734943269077> Role ${head}\n\n` +
        `> **Role:** ${role}\n` +
        `> **Target Group:** ${label.plural}\n` +
        `> **Eligible ${label.plural}:** \`${stats.eligible}\`\n\n` +
        `### <:Bookopen:1521227911137595605> Results\n` +
        `> <:Checkedbox:1521227734943269077> **${successLine}:** \`${stats.success}\`\n` +
        `> <:Infotriangle:1521227710381428926> **${skipLine}:** \`${stats.skipped}\`\n`;

    if (stats.blocked) {
        body += `> <:Lock:1521227892770734120> **Hierarchy Blocked:** \`${stats.blocked}\`\n`;
    }
    if (stats.failed) {
        body += `> <:Cancel:1521227723916181644> **Failed:** \`${stats.failed}\`\n`;
    }

    body += `\n**Moderator:** ${executorTag}`;

    return new ContainerBuilder()
        .setAccentColor(stats.failed > 0 ? COLORS.WARNING : COLORS.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
;
}

function renderBar(pct, length = 14) {
    const filled = Math.max(0, Math.min(length, Math.round((pct / 100) * length)));
    return '`[' + '█'.repeat(filled) + '░'.repeat(length - filled) + ']`';
}

// ── Throttled, sequential progress editor ───────────────────────────
/**
 * Returns an `onProgress` callback plus a `finish()` helper that ensures
 * the last in-flight edit settles before we send the final result.
 */
function makeProgressUpdater(editFn, role, targetType, action) {
    const state = { lastAt: 0, pending: null };
    const run = async (processed, total) => {
        const now = Date.now();
        if (now - state.lastAt < PROGRESS_THROTTLE_MS) return;
        state.lastAt = now;
        const container = buildProgressContainer({ role, targetType, action, processed, total });
        state.pending = editFn({ components: [container], flags: MessageFlags.IsComponentsV2 })
            .catch(() => {})
            .finally(() => { state.pending = null; });
        await state.pending;
    };
    const finish = async () => {
        if (state.pending) await state.pending.catch(() => {});
    };
    return { onProgress: run, finish };
}

// ── Unified entrypoints (slash + prefix share the same flow) ────────
async function runFromInteraction(interaction, { targetType, action, role }) {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.reply({
            components: [buildPermissionDenied('Manage Roles')],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
    }

    const err = validate({
        guild:    interaction.guild,
        role,
        executor: interaction.member,
        action,
    });
    if (err) {
        return interaction.reply({
            components: [err],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
    }

    await interaction.reply({
        components: [buildProcessingContainer({ role, targetType, action })],
        flags: MessageFlags.IsComponentsV2,
    });

    const { onProgress, finish } = makeProgressUpdater(
        (payload) => interaction.editReply(payload),
        role, targetType, action,
    );

    const stats = await processMembers({
        guild:       interaction.guild,
        role,
        targetType,
        action,
        executorTag: interaction.user.username,
        onProgress,
    });

    await finish();

    if (stats.eligible === 0) {
        return interaction.editReply({
            components: [buildErrorResponse(
                'No Eligible Members',
                `There are no **${TARGET_LABELS[targetType].plural.toLowerCase()}** in this server to ${action === 'add' ? 'assign the role to' : 'remove the role from'}.`
            )],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => {});
    }

    return interaction.editReply({
        components: [buildResultContainer({
            role, targetType, action, stats,
            executorTag: interaction.user.username,
        })],
        flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
}

async function runFromMessage(message, { targetType, action, role }) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return message.reply({
            components: [buildPermissionDenied('Manage Roles')],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    const err = validate({
        guild:    message.guild,
        role,
        executor: message.member,
        action,
    });
    if (err) {
        return message.reply({
            components: [err],
            flags: MessageFlags.IsComponentsV2,
        });
    }

    const statusMsg = await message.reply({
        components: [buildProcessingContainer({ role, targetType, action })],
        flags: MessageFlags.IsComponentsV2,
    });

    const { onProgress, finish } = makeProgressUpdater(
        (payload) => statusMsg.edit(payload),
        role, targetType, action,
    );

    const stats = await processMembers({
        guild:       message.guild,
        role,
        targetType,
        action,
        executorTag: message.author.username,
        onProgress,
    });

    await finish();

    if (stats.eligible === 0) {
        return statusMsg.edit({
            components: [buildErrorResponse(
                'No Eligible Members',
                `There are no **${TARGET_LABELS[targetType].plural.toLowerCase()}** in this server to ${action === 'add' ? 'assign the role to' : 'remove the role from'}.`
            )],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => {});
    }

    return statusMsg.edit({
        components: [buildResultContainer({
            role, targetType, action, stats,
            executorTag: message.author.username,
        })],
        flags: MessageFlags.IsComponentsV2,
    }).catch(() => {});
}

module.exports = {
    VALID_TARGETS,
    VALID_ACTIONS,
    TARGET_FILTERS,
    TARGET_LABELS,
    validate,
    processMembers,
    runFromInteraction,
    runFromMessage,
    buildProcessingContainer,
    buildProgressContainer,
    buildResultContainer,
};
