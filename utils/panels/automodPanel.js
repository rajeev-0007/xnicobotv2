'use strict';

/**
 * automodPanel — config UI for AutoMod.
 *
 * Follows the same rules as antinukePanel:
 *   1. Select menus only — the previous panel had eight buttons across two rows.
 *   2. Multi-selects use "selection IS the state", so the control is idempotent
 *      and Enable All / Disable All buttons are unnecessary.
 *   3. The only emojis are the enable/disable icons from automodSchema.STATUS.
 *      The old panel used ~20 distinct decorative emojis, one per filter.
 *   4. Everything derives from utils/automodSchema — adding a filter needs no
 *      edit here. The list previously appeared six times in this file alone.
 *
 * ═══ CUSTOM ID SCHEME ═══
 *   automod:filters                 multi   which filters are enabled
 *   automod:configure               single  open a filter sub-panel
 *   automod:system                  single  system-level actions
 *   automod:f:action:<key>          single  action for one filter
 *   automod:f:set:<field>:<key>     single  a numeric/enum setting
 *   automod:f:nav:<key>             single  toggle / edit list / reset / back
 *   automod:pick:logchannel         channel select
 *   automod:pick:bypassrole         role select
 *   automod:pick:ignorechannels     channel select (multi)
 *   automod:pick:ignoreroles        role select (multi)
 *   automod:modal:list:<key>        modal for a list field
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
    MessageFlags,
    ChannelType,
} = require('discord.js');

const jsonStore = require('../jsonStore');
const log = require('../logger-styled');
const schema = require('../automodSchema');

const {
    FILTERS,
    FILTER_KEYS,
    FILTER_LABELS,
    FIELDS,
    CHOICES,
    ACTION_LABELS,
    ALL_ACTIONS,
    ENGINE_LABELS,
    STATUS,
    toggle,
    getDefaultConfig,
    withDefaults,
    describeFilter,
    countEnabled,
} = schema;

const ACCENT_ON = 0x2ECC71;
const ACCENT_OFF = 0xE74C3C;
const ACCENT_NEUTRAL = 0x5865F2;

/** Discord caps select-option descriptions at 100 characters. */
const clamp = (s, n = 100) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

/* ─────────────────────────── storage ─────────────────────────── */

function loadConfig() {
    if (!jsonStore.has('automod')) {
        jsonStore.write('automod', {});
        return {};
    }
    try {
        return jsonStore.read('automod');
    } catch {
        return {};
    }
}

function saveConfig(config, guildId = null) {
    jsonStore.write('automod', config);
    if (global.updateAutomodCache && guildId && config[guildId]) {
        global.updateAutomodCache(guildId, config[guildId]);
    }
}

function getGuildConfig(guildId) {
    return withDefaults(loadConfig()[guildId]);
}

/* ─────────────────────────── main panel ─────────────────────────── */

function buildAutomodPanel(rawConfig) {
    const cfg = withDefaults(rawConfig);
    const total = FILTER_KEYS.length;
    const active = countEnabled(cfg);
    const on = !!cfg.enabled;

    const logChannel = cfg.logChannel ? `<#${cfg.logChannel}>` : 'not set';
    const bypassRole = cfg.bypassRoleId ? `<@&${cfg.bypassRoleId}>` : 'none';
    const ignoredCh = cfg.ignoredChannels?.length || 0;
    const ignoredRoles = cfg.ignoredRoles?.length || 0;

    const status = on
        ? `${STATUS.ON} **Active** — ${active}/${total} filters enabled`
        : `${STATUS.OFF} **Inactive** — nothing is running · ${active}/${total} filters enabled`;

    // Grouped by enforcement engine so it is obvious which filters Discord
    // blocks pre-publish and which the bot removes after the fact.
    const groups = { bot: [], discord: [], both: [] };
    for (const key of FILTER_KEYS) {
        groups[FILTERS[key].engine].push(
            `${toggle(cfg[key]?.enabled)} **${FILTER_LABELS[key]}** — \`${describeFilter(cfg, key)}\``
        );
    }

    const sections = [];
    if (groups.both.length) sections.push(`### Message Filters\n${groups.both.join('\n')}`);
    if (groups.bot.length) sections.push(`### Bot-Side Filters\n${groups.bot.join('\n')}`);
    if (groups.discord.length) sections.push(`### Discord Preset Filters\n${groups.discord.join('\n')}`);

    const settings =
        `Log channel · ${logChannel}\n` +
        `Bypass role · ${bypassRole}\n` +
        `Ignored · ${ignoredCh} channel${ignoredCh === 1 ? '' : 's'}, ${ignoredRoles} role${ignoredRoles === 1 ? '' : 's'}`;

    /* ── row 1: which filters are enabled ── */
    const filtersSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('automod:filters')
            .setPlaceholder('Enabled filters — select to set, clear to disable all')
            .setMinValues(0)
            .setMaxValues(total)
            .addOptions(FILTER_KEYS.map(key => ({
                label: FILTER_LABELS[key],
                value: key,
                description: clamp(`${cfg[key]?.enabled ? 'Enabled' : 'Disabled'} · ${describeFilter(cfg, key)}`),
                emoji: toggle(cfg[key]?.enabled),
                default: !!cfg[key]?.enabled,
            })))
    );

    /* ── row 2: open a filter sub-panel ── */
    const configureSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('automod:configure')
            .setPlaceholder('Configure a filter…')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(FILTER_KEYS.map(key => ({
                label: FILTER_LABELS[key],
                value: key,
                description: clamp(`${ENGINE_LABELS[FILTERS[key].engine]} · ${describeFilter(cfg, key)}`),
                emoji: toggle(cfg[key]?.enabled),
            })))
    );

    /* ── row 3: system actions ── */
    const systemSelect = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('automod:system')
            .setPlaceholder('System settings…')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions([
                {
                    label: on ? 'Deactivate AutoMod' : 'Activate AutoMod',
                    value: 'toggle',
                    description: clamp(on ? 'Stop all filtering' : 'Start filtering messages'),
                    emoji: toggle(on),
                },
                { label: 'Set log channel', value: 'logchannel', description: clamp(`Currently ${cfg.logChannel ? 'set' : 'not set'}`) },
                { label: 'Set bypass role', value: 'bypassrole', description: clamp(`Currently ${cfg.bypassRoleId ? 'set' : 'none'}`) },
                { label: 'Ignored channels', value: 'ignorechannels', description: clamp(`${ignoredCh} exempt`) },
                { label: 'Ignored roles', value: 'ignoreroles', description: clamp(`${ignoredRoles} exempt`) },
                { label: 'Reset all filters', value: 'reset', description: 'Restore every filter to its default' },
            ])
    );

    const container = new ContainerBuilder().setAccentColor(on ? ACCENT_ON : ACCENT_OFF);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('# AutoMod'));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(status));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    for (const section of sections) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(section));
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Settings\n${settings}`));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(filtersSelect);
    container.addActionRowComponents(configureSelect);
    container.addActionRowComponents(systemSelect);

    return container;
}

/* ─────────────────────── filter sub-panel ─────────────────────── */

/**
 * Focused panel for one filter. Replaces the old per-filter modal, which was
 * reached through a second select whose values used a different spelling of the
 * filter keys (`aitext` vs `aiText`) and had to be mapped by hand.
 */
function buildFilterPanel(rawConfig, key) {
    const cfg = withDefaults(rawConfig);
    const def = FILTERS[key];
    if (!def) return null;
    const mod = cfg[key];

    const lines = [
        `${toggle(mod?.enabled)} **Status** — ${mod?.enabled ? 'Enabled' : 'Disabled'}`,
        `**Action** — \`${ACTION_LABELS[mod?.action] || mod?.action}\``,
        `**Enforced by** — ${ENGINE_LABELS[def.engine]}`,
    ];
    for (const field of def.fields) {
        const meta = FIELDS[field];
        const value = mod[field];
        lines.push(`**${meta.label}** — \`${meta.kind === 'list' ? meta.summary(value) : meta.format(value)}\``);
    }
    if (def.needsApiKey && !process.env.GROQ_API_KEY) {
        lines.push(`${STATUS.OFF} **GROQ_API_KEY is not set** — this filter cannot run until it is configured.`);
    }
    if (def.engine === 'discord') {
        lines.push('-# Discord enforces this preset before the message is posted, so it cannot be logged bot-side.');
    }

    const container = new ContainerBuilder().setAccentColor(ACCENT_NEUTRAL);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${FILTER_LABELS[key]}`));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${def.description}`));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    // Action
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`automod:f:action:${key}`)
            .setPlaceholder('Action when triggered…')
            .setMinValues(1).setMaxValues(1)
            .addOptions(ALL_ACTIONS.map(a => ({
                label: ACTION_LABELS[a],
                value: a,
                default: mod?.action === a,
            })))
    ));

    // Numeric / enum settings — one select per field. Discord allows five action
    // rows per message and no filter defines more than two of these.
    for (const field of def.fields) {
        const meta = FIELDS[field];
        if (meta.kind !== 'choice') continue;
        const options = CHOICES[meta.choices];
        container.addActionRowComponents(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`automod:f:set:${field}:${key}`)
                .setPlaceholder(`${meta.label}…`)
                .setMinValues(1).setMaxValues(1)
                .addOptions(options.map(v => ({
                    label: meta.format(v),
                    value: String(v),
                    default: String(mod?.[field]) === String(v),
                })))
        ));
    }

    // Navigation + list editing + reset, kept in a select so the panel stays
    // button-free.
    const navOptions = [
        { label: mod?.enabled ? 'Disable this filter' : 'Enable this filter', value: 'toggle', emoji: toggle(mod?.enabled) },
    ];
    for (const field of def.fields) {
        if (FIELDS[field].kind === 'list') {
            navOptions.push({
                label: `Edit ${FIELDS[field].label.toLowerCase()}`,
                value: `list:${field}`,
                description: clamp(FIELDS[field].summary(mod[field])),
            });
        }
    }
    navOptions.push({ label: 'Reset this filter', value: 'reset', description: 'Restore its defaults' });
    navOptions.push({ label: 'Back to overview', value: 'back' });

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`automod:f:nav:${key}`)
            .setPlaceholder('More…')
            .setMinValues(1).setMaxValues(1)
            .addOptions(navOptions)
    ));

    return container;
}

/* ───────────────────── sub-flow pickers ───────────────────── */

function buildLogChannelPicker() {
    return new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('automod:pick:logchannel')
            .setPlaceholder('Choose a channel for AutoMod logs…')
            .addChannelTypes(ChannelType.GuildText)
            .setMinValues(1).setMaxValues(1)
    );
}

function buildBypassRolePicker() {
    return new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
            .setCustomId('automod:pick:bypassrole')
            .setPlaceholder('Choose a role that bypasses AutoMod…')
            .setMinValues(1).setMaxValues(1)
    );
}

function buildIgnoreChannelsPicker() {
    return new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId('automod:pick:ignorechannels')
            .setPlaceholder('Channels AutoMod should ignore…')
            .addChannelTypes(ChannelType.GuildText)
            .setMinValues(0).setMaxValues(25)
    );
}

function buildIgnoreRolesPicker() {
    return new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
            .setCustomId('automod:pick:ignoreroles')
            .setPlaceholder('Roles AutoMod should ignore…')
            .setMinValues(0).setMaxValues(25)
    );
}

/* ───────────────────────── refresh ───────────────────────── */

async function refreshAutomodPanel(message, guildId) {
    const container = buildAutomodPanel(getGuildConfig(guildId));
    try {
        await message.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
        return { success: true };
    } catch (error) {
        log.error('Error refreshing automod panel:', error);
        return { success: false, error };
    }
}

module.exports = {
    loadConfig,
    saveConfig,
    getDefaultConfig,
    getGuildConfig,
    buildAutomodPanel,
    buildFilterPanel,
    buildLogChannelPicker,
    buildBypassRolePicker,
    buildIgnoreChannelsPicker,
    buildIgnoreRolesPicker,
    refreshAutomodPanel,
    FILTER_KEYS,
    FILTER_LABELS,
};
