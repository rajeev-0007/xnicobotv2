'use strict';

/**
 * antinukePanel — config UI for the anti-nuke engine.
 *
 * ═══ DESIGN RULES ═══
 * 1. Select menus, not buttons. The old panel had nine buttons across two rows
 *    plus two selects; every option is now a select menu.
 * 2. Multi-selects use "selection IS the state" semantics, not toggle-on-click.
 *    Picking a set of modules enables exactly those and disables the rest, so
 *    the control is idempotent and readable. This also removes the need for
 *    separate Enable All / Disable All buttons — select everything, or nothing.
 * 3. The ONLY emojis are the enable/disable icons from antinukeSchema.STATUS.
 *    No decorative per-module icons.
 * 4. Everything derives from utils/antinukeSchema, so adding a protection needs
 *    no edits here.
 *
 * ═══ WHY THE PUNISHMENT PICKER MOVED ═══
 * The punishment select used to be a hand-written list of 20 options shaped
 * `Channel -> Kick`, where "Channel" only ever mapped to channelDelete and
 * "Role" only to roleDelete — so channelCreate and roleCreate could not have
 * their punishment changed at all. Generating the full matrix is impossible:
 * 10 protections x 4 punishments is 39 options against Discord's 25-option
 * cap. Instead, picking a module opens a focused sub-panel that configures its
 * punishment, limit, window and flags. That covers every module and scales.
 *
 * ═══ CUSTOM ID SCHEME ═══
 *   antinuke:modules                 multi   which protections are enabled
 *   antinuke:power                   multi   which response flags are enabled
 *   antinuke:configure               single  open a module sub-panel
 *   antinuke:system                  single  system-level actions
 *   antinuke:mod:action:<key>        single  punishment for one module
 *   antinuke:mod:limit:<key>         single  trigger threshold
 *   antinuke:mod:window:<key>        single  rolling window
 *   antinuke:mod:flags:<key>         multi   edit-protection behaviour flags
 *   antinuke:mod:nav:<key>           single  back / reset this module
 *   antinuke:pick:logchannel         channel select
 *   antinuke:pick:bypassrole         role select
 *   antinuke:modal:whitelist         modal
 */

const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    ChannelType,
} = require('discord.js');

const jsonStore = require('./../jsonStore');
const log = require('./../logger-styled');
const schema = require('./../antinukeSchema');

const {
    PROTECTIONS,
    PROTECTION_KEYS,
    PROTECTION_LABELS,
    PUNISHMENT_LABELS,
    ACTIONS_FOR,
    STATUS,
    toggle,
    getDefaultConfig,
    withDefaults,
    formatTimeWindow,
} = schema;

/** Kept for backwards compatibility with commands/utility/antinuke.js. */
const AVAILABLE_PUNISHMENTS = ACTIONS_FOR;

const ACCENT_ARMED = 0x2ECC71;
const ACCENT_OFF = 0xE74C3C;
const ACCENT_NEUTRAL = 0x5865F2;

/** Curated threshold values — a 1..20 range would blow the 25-option cap. */
const LIMIT_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20];

/** Rolling-window choices in ms. */
const WINDOW_CHOICES = [
    10_000, 15_000, 30_000, 45_000, 60_000, 90_000, 120_000, 180_000, 300_000, 600_000,
];

/** Behaviour flags offered on the "response mode" select. */
const POWER_FLAGS = [
    { key: 'zeroTolerance', label: 'Zero Tolerance', description: 'Punish on the first destructive action.' },
    { key: 'instantQuarantine', label: 'Instant Quarantine', description: 'Strip the offender\'s roles the moment they are detected.' },
    { key: 'autoRestore', label: 'Auto Restore', description: 'Recreate channels and roles a nuker deletes.' },
];

/* ─────────────────────────── storage ─────────────────────────── */

function loadConfig() {
    if (!jsonStore.has('antinuke')) {
        jsonStore.write('antinuke', {});
        return {};
    }
    return jsonStore.read('antinuke');
}

function saveConfig(config) {
    jsonStore.write('antinuke', config);
    if (global.reloadAntinukeCache) {
        global.reloadAntinukeCache(config);
    } else if (global.updateAntinukeCache) {
        for (const [gid, cfg] of Object.entries(config)) global.updateAntinukeCache(gid, cfg);
    }
}

/**
 * Read one guild's config with schema defaults merged in.
 *
 * Mirrors automodPanel.getGuildConfig. Stored rows predate newer protections,
 * so reading them raw leaves `config.roleUpdate` undefined and the panel would
 * render a module that the engine can never run.
 */
function getGuildConfig(guildId) {
    const all = loadConfig();
    return withDefaults(all[guildId]);
}

/* ─────────────────────────── helpers ─────────────────────────── */

/** `3 / 60s -> Strip Roles`, or just the punishment for limitless modules. */
function describeModule(mod, key) {
    const def = PROTECTIONS[key];
    const action = PUNISHMENT_LABELS[mod?.action] || mod?.action || '—';
    if (!def.hasLimit) return action;
    const limit = mod?.limit ?? def.defaultLimit;
    const win = formatTimeWindow(mod?.timeWindow ?? def.defaultWindow);
    return `${limit} / ${win} → ${action}`;
}

/** Discord caps select-option descriptions at 100 characters. */
const clamp = (s, n = 100) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

/* ─────────────────────────── main panel ─────────────────────────── */

function buildAntiNukePanel(rawConfig) {
    const cfg = withDefaults(rawConfig);

    const total = PROTECTION_KEYS.length;
    const enabledKeys = PROTECTION_KEYS.filter(k => cfg[k]?.enabled);
    const armed = !!cfg.enabled;
    const threatActive = !!(cfg.threatMode || cfg.superThreatMode);

    const logChannel = cfg.logChannel ? `<#${cfg.logChannel}>` : 'not set';
    const bypassRole = cfg.bypassRoleId ? `<@&${cfg.bypassRoleId}>` : 'none';
    const whitelistCount = cfg.whitelistedUsers?.length || 0;

    /* ── header ── */
    const header = `# Anti-Nuke`;

    // The count is always shown, including while inactive, so an admin can see
    // what is configured before arming. `total` is derived, never hardcoded —
    // the old panel printed a literal "/8".
    const count = `${enabledKeys.length}/${total} protections enabled`;
    let status;
    if (threatActive) {
        const mode = cfg.superThreatMode ? 'Super Threat Mode' : 'Threat Mode';
        status = `${STATUS.ON} **${mode}** — limits are locked by the threat override · ${count}`;
    } else if (armed) {
        status = `${STATUS.ON} **Active** — ${count}`;
    } else {
        status = `${STATUS.OFF} **Inactive** — nothing is running · ${count}`;
    }

    /* ── protections list ── */
    const rows = PROTECTION_KEYS.map(key => {
        const mod = cfg[key];
        return `${toggle(mod?.enabled)} **${PROTECTION_LABELS[key]}** — \`${describeModule(mod, key)}\``;
    }).join('\n');

    /* ── response mode list ── */
    const powerRows = POWER_FLAGS
        .map(f => `${toggle(!!cfg[f.key])} **${f.label}**`)
        .join('\n');

    /* ── settings summary ── */
    const settings =
        `Log channel · ${logChannel}\n` +
        `Bypass role · ${bypassRole}\n` +
        `Whitelist · ${whitelistCount === 0 ? 'empty' : `${whitelistCount} user${whitelistCount === 1 ? '' : 's'}`}`;

    /* ── row 1: which protections are enabled ── */
    const modulesSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('antinuke:modules')
            .setPlaceholder('Enabled protections — select to set, clear to disable all')
            .setMinValues(0)
            .setMaxValues(total)
            .addOptions(PROTECTION_KEYS.map(key => ({
                label: PROTECTION_LABELS[key],
                value: key,
                description: clamp(`${cfg[key]?.enabled ? 'Enabled' : 'Disabled'} · ${describeModule(cfg[key], key)}`),
                emoji: toggle(cfg[key]?.enabled),
                default: !!cfg[key]?.enabled,
            })))
    );

    /* ── row 2: response mode flags ── */
    const powerSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('antinuke:power')
            .setPlaceholder('Response mode — select to set, clear to disable all')
            .setMinValues(0)
            .setMaxValues(POWER_FLAGS.length)
            .addOptions(POWER_FLAGS.map(f => ({
                label: f.label,
                value: f.key,
                description: clamp(f.description),
                emoji: toggle(!!cfg[f.key]),
                default: !!cfg[f.key],
            })))
    );

    /* ── row 3: open a module sub-panel ── */
    const configureSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('antinuke:configure')
            .setPlaceholder('Configure a protection…')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(PROTECTION_KEYS.map(key => ({
                label: PROTECTION_LABELS[key],
                value: key,
                description: clamp(describeModule(cfg[key], key)),
                emoji: toggle(cfg[key]?.enabled),
            })))
    );

    /* ── row 4: system actions ── */
    const systemSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('antinuke:system')
            .setPlaceholder('System settings…')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions([
                {
                    label: armed ? 'Deactivate anti-nuke' : 'Activate anti-nuke',
                    value: 'arm',
                    description: clamp(armed ? 'Stop all protection' : 'Start protecting this server'),
                    emoji: toggle(armed),
                },
                { label: 'Set log channel', value: 'logchannel', description: clamp(`Currently ${cfg.logChannel ? 'set' : 'not set'}`) },
                { label: 'Set bypass role', value: 'bypassrole', description: clamp(`Currently ${cfg.bypassRoleId ? 'set' : 'none'}`) },
                { label: 'Edit whitelist', value: 'whitelist', description: clamp(`${whitelistCount} user${whitelistCount === 1 ? '' : 's'} exempt`) },
                { label: 'Reset all settings', value: 'reset', description: 'Restore every protection to its default' },
            ])
    );

    const container = new ContainerBuilder()
        .setAccentColor(armed ? ACCENT_ARMED : ACCENT_OFF);

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(status));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Protections\n${rows}`));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Response Mode\n${powerRows}`));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Settings\n${settings}`));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(modulesSelect);
    container.addActionRowComponents(powerSelect);
    container.addActionRowComponents(configureSelect);
    container.addActionRowComponents(systemSelect);

    return container;
}

/* ─────────────────────── module sub-panel ─────────────────────── */

/**
 * Focused panel for a single protection. Replaces the impossible
 * protection x punishment matrix and is the only place channelCreate /
 * roleCreate punishments were ever reachable from.
 */
function buildModulePanel(rawConfig, key) {
    const cfg = withDefaults(rawConfig);
    const def = PROTECTIONS[key];
    if (!def) return null;

    const mod = cfg[key];
    const allowed = ACTIONS_FOR[key] || [];

    const lines = [
        `${toggle(mod?.enabled)} **Status** — ${mod?.enabled ? 'Enabled' : 'Disabled'}`,
        `**Response** — \`${PUNISHMENT_LABELS[mod?.action] || mod?.action}\``,
    ];
    if (def.hasLimit) {
        lines.push(`**Threshold** — \`${mod?.limit ?? def.defaultLimit}\` actions within \`${formatTimeWindow(mod?.timeWindow ?? def.defaultWindow)}\``);
    } else {
        lines.push('**Threshold** — fires on every occurrence');
    }
    if (def.permissionsOnly) {
        lines.push(`${toggle(mod?.permissionsOnly !== false)} **Permission changes only** — ignore renames and cosmetic edits`);
    }
    if (def.escalates) {
        lines.push(`${toggle(mod?.escalationInstant !== false)} **Instant on escalation** — act immediately when a dangerous permission is granted`);
    }

    const container = new ContainerBuilder().setAccentColor(ACCENT_NEUTRAL);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${PROTECTION_LABELS[key]}`));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${def.description}`));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    // Response
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`antinuke:mod:action:${key}`)
            .setPlaceholder('Response when triggered…')
            .setMinValues(1).setMaxValues(1)
            .addOptions(allowed.map(a => ({
                label: PUNISHMENT_LABELS[a] || a,
                value: a,
                default: mod?.action === a,
            })))
    ));

    if (def.hasLimit) {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`antinuke:mod:limit:${key}`)
                .setPlaceholder('Threshold — actions before triggering…')
                .setMinValues(1).setMaxValues(1)
                .addOptions(LIMIT_CHOICES.map(n => ({
                    label: `${n} action${n === 1 ? '' : 's'}`,
                    value: String(n),
                    default: (mod?.limit ?? def.defaultLimit) === n,
                })))
        ));

        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`antinuke:mod:window:${key}`)
                .setPlaceholder('Time window…')
                .setMinValues(1).setMaxValues(1)
                .addOptions(WINDOW_CHOICES.map(ms => ({
                    label: `within ${formatTimeWindow(ms)}`,
                    value: String(ms),
                    default: (mod?.timeWindow ?? def.defaultWindow) === ms,
                })))
        ));
    }

    // Behaviour flags — only for protections that define them.
    const flagOptions = [];
    if (def.permissionsOnly) {
        flagOptions.push({
            label: 'Permission changes only',
            value: 'permissionsOnly',
            description: clamp('Ignore renames and other cosmetic edits'),
            emoji: toggle(mod?.permissionsOnly !== false),
            default: mod?.permissionsOnly !== false,
        });
    }
    if (def.escalates) {
        flagOptions.push({
            label: 'Instant on escalation',
            value: 'escalationInstant',
            description: clamp('Act at once when a dangerous permission is granted'),
            emoji: toggle(mod?.escalationInstant !== false),
            default: mod?.escalationInstant !== false,
        });
    }
    if (flagOptions.length) {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`antinuke:mod:flags:${key}`)
                .setPlaceholder('Behaviour — select to set, clear to disable all')
                .setMinValues(0).setMaxValues(flagOptions.length)
                .addOptions(flagOptions)
        ));
    }

    // Navigation + per-module reset, kept as a select so the panel stays
    // button-free.
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`antinuke:mod:nav:${key}`)
            .setPlaceholder('More…')
            .setMinValues(1).setMaxValues(1)
            .addOptions([
                { label: mod?.enabled ? 'Disable this protection' : 'Enable this protection', value: 'toggle', emoji: toggle(mod?.enabled) },
                { label: 'Reset this protection', value: 'reset', description: 'Restore its default threshold and response' },
                { label: 'Back to overview', value: 'back' },
            ])
    ));

    return container;
}

/* ───────────────────── sub-flow pickers ───────────────────── */

function buildLogChannelPicker() {
    return new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('antinuke:pick:logchannel')
            .setPlaceholder('Choose a channel for security logs…')
            .addChannelTypes(ChannelType.GuildText)
            .setMinValues(1).setMaxValues(1)
    );
}

function buildBypassRolePicker() {
    return new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
            .setCustomId('antinuke:pick:bypassrole')
            .setPlaceholder('Choose a role that bypasses anti-nuke…')
            .setMinValues(1).setMaxValues(1)
    );
}

/* ───────────────────────── refresh ───────────────────────── */

async function refreshAntiNukePanel(message, guildConfig) {
    const container = buildAntiNukePanel(guildConfig);
    try {
        await message.edit({ components: [container] });
        return { success: true };
    } catch (error) {
        log.error('Error refreshing antinuke panel:', error);
        return { success: false, error };
    }
}

module.exports = {
    loadConfig,
    saveConfig,
    getGuildConfig,
    getDefaultConfig,
    buildAntiNukePanel,
    buildModulePanel,
    buildLogChannelPicker,
    buildBypassRolePicker,
    refreshAntiNukePanel,
    PROTECTION_KEYS,
    PROTECTION_LABELS,
    PUNISHMENT_LABELS,
    AVAILABLE_PUNISHMENTS,
    LIMIT_CHOICES,
    WINDOW_CHOICES,
    POWER_FLAGS,
    STATUS,
    formatTimeWindow,
};
