const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType } = require('discord.js');
const { buildErrorResponse, COLORS, EMOJIS } = require('../../utils/responseBuilder');

const jsonStore = require('../../utils/jsonStore');
const { createFooterText } = require('../../utils/theme');

function loadConfig() {
    if (!jsonStore.has('antispam')) {
        jsonStore.write('antispam', {});
        return {};
    }
    try {
        const raw = JSON.stringify(jsonStore.read('antispam'));
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveConfig(config) {
    jsonStore.write('antispam', config);
}

function getDefaultGuildConfig() {
    return {
        enabled: false,
        action: 'timeout',
        timeoutDuration: 60000,
        whitelistedRoles: [],
        whitelistedChannels: [],
        logChannel: null,
        filters: {
            messageSpam: { enabled: true, maxMessages: 5, interval: 5000 },
            emojiSpam: { enabled: false, maxEmojis: 10 },
            capsSpam: { enabled: false, minLength: 10, maxPercent: 70 },
            linkSpam: { enabled: false, maxLinks: 3, whitelistedDomains: [] },
            imageSpam: { enabled: false, maxImages: 3, interval: 10000 },
            stickerSpam: { enabled: false, maxStickers: 3, interval: 10000 },
            mentionSpam: { enabled: false, maxMentions: 5 },
            duplicateSpam: { enabled: false, maxDuplicates: 3, interval: 30000 },
            inviteSpam: { enabled: false },
            newlineSpam: { enabled: false, maxNewlines: 15 }
        }
    };
}

function ensureGuildConfig(config, guildId) {
    if (!config[guildId]) {
        config[guildId] = getDefaultGuildConfig();
    } else {
        const defaults = getDefaultGuildConfig();
        for (const key of Object.keys(defaults)) {
            if (config[guildId][key] === undefined) config[guildId][key] = defaults[key];
        }
        if (!config[guildId].filters) {
            config[guildId].filters = defaults.filters;
        } else {
            for (const key of Object.keys(defaults.filters)) {
                if (!config[guildId].filters[key]) config[guildId].filters[key] = defaults.filters[key];
            }
        }
    }
    return config[guildId];
}

const FILTER_INFO = {
    messageSpam: { label: 'Message Spam', emoji: '💬', desc: 'Too many messages in short time' },
    emojiSpam: { label: 'Emoji Spam', emoji: '😀', desc: 'Excessive emojis in a message' },
    capsSpam: { label: 'CAPS Spam', emoji: '🔠', desc: 'Excessive capital letters' },
    linkSpam: { label: 'Link Spam', emoji: '🔗', desc: 'Too many links in messages' },
    imageSpam: { label: 'Image Spam', emoji: '🖼', desc: 'Too many images/GIFs rapidly' },
    stickerSpam: { label: 'Sticker Spam', emoji: '🏷', desc: 'Too many stickers rapidly' },
    mentionSpam: { label: 'Mention Spam', emoji: '📢', desc: 'Mass mentioning users/roles' },
    duplicateSpam: { label: 'Duplicate Spam', emoji: '📋', desc: 'Repeated identical messages' },
    inviteSpam: { label: 'Invite Spam', emoji: '✉', desc: 'Discord server invite links' },
    newlineSpam: { label: 'Newline Spam', emoji: '<:Invoice:1521227903956811836>', desc: 'Excessive line breaks' }
};

const FILTER_NAMES = Object.keys(FILTER_INFO);
const VALID_ACTIONS = ['timeout', 'kick', 'ban', 'warn'];

/* ═══════════════════════════════════════════════════════════════════════════
 * PANEL — one select menu per row
 *
 * Conventions match welcomer.js and message-builder.js:
 *   - ids are `antispam:<control>`
 *   - the ONLY emojis are the enable/disable pair. The filter list previously
 *     carried a unicode icon each (speech balloon, grinning face, capital abcd,
 *     link, framed picture, label, loudspeaker, clipboard, envelope) which
 *     competed with the actual on/off state for attention
 *   - the filter row is a multi-select whose SELECTION IS THE STATE, applied
 *     absolutely, so it is idempotent
 *
 * Anti-spam is a STANDALONE system: it does not read, write or sync with
 * /automod, and it does not create Discord native AutoMod rules. Enforcement is
 * entirely bot-side, in the guildMemberAdd/messageCreate path. Keeping it
 * separate avoids fighting /automod over Discord's Spam and MentionSpam
 * triggers, which allow only one rule each per guild.
 * ═══════════════════════════════════════════════════════════════════════════ */

const TOGGLE_ON = '<:Toggleon:1521227758011809964>';
const TOGGLE_OFF = '<:Toggleoff:1521227763816595559>';
const mark = (v) => (v ? TOGGLE_ON : TOGGLE_OFF);

const AID = {
    filters: 'antispam:filters',
    system: 'antispam:system',
    action: 'antispam:action',
    configure: 'antispam:configure',
    log: 'antispam:log',
    exemptRoles: 'antispam:exempt:roles',
    exemptChannels: 'antispam:exempt:channels',
};

/** Human summary of a filter's thresholds, used as the option description. */
function filterSummary(key, f) {
    const c = f || {};
    switch (key) {
        case 'messageSpam': return `${c.maxMessages ?? 5} msgs / ${Math.round((c.interval ?? 5000) / 1000)}s`;
        case 'emojiSpam': return `over ${c.maxEmojis ?? 10} emojis`;
        case 'capsSpam': return `over ${c.maxPercent ?? 70}% caps, min ${c.minLength ?? 10} chars`;
        case 'linkSpam': return `over ${c.maxLinks ?? 3} links` + ((c.whitelistedDomains || []).length ? `, ${c.whitelistedDomains.length} allowed` : '');
        case 'imageSpam': return `${c.maxImages ?? 3} images / ${Math.round((c.interval ?? 10000) / 1000)}s`;
        case 'stickerSpam': return `${c.maxStickers ?? 3} stickers / ${Math.round((c.interval ?? 10000) / 1000)}s`;
        case 'mentionSpam': return `over ${c.maxMentions ?? 5} mentions`;
        case 'duplicateSpam': return `${c.maxDuplicates ?? 3} repeats / ${Math.round((c.interval ?? 30000) / 1000)}s`;
        case 'inviteSpam': return 'any Discord invite link';
        case 'newlineSpam': return `over ${c.maxNewlines ?? 15} line breaks`;
        default: return '';
    }
}

function menuRow(customId, placeholder, options, { min = 1, max = 1 } = {}) {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(placeholder)
            .setMinValues(min)
            .setMaxValues(max)
            .addOptions(options.slice(0, 25).map((o) => {
                const opt = new StringSelectMenuOptionBuilder().setValue(o.value).setLabel(o.label.slice(0, 100));
                if (o.description) opt.setDescription(o.description.slice(0, 100));
                if (o.emoji) opt.setEmoji(o.emoji);
                if (o.default) opt.setDefault(true);
                return opt;
            }))
    );
}

function buildAntispamContainer(guildConfig) {
    const cfg = guildConfig || getDefaultGuildConfig();
    const filters = cfg.filters || getDefaultGuildConfig().filters;
    const keys = Object.keys(FILTER_INFO);

    const onCount = keys.filter(k => filters[k] && filters[k].enabled).length;
    const activeLabels = keys.filter(k => filters[k] && filters[k].enabled).map(k => FILTER_INFO[k].label);

    let head = '# Anti-spam\n';
    head += '-# Catches flooding, mass mentions, duplicate text and other spam.\n';
    head += '-# Enforced by the bot, independently of /automod.\n\n';
    head += mark(cfg.enabled) + ' **Anti-spam**  \u00b7  punish `' + (cfg.action || 'timeout') + '`';
    head += '  \u00b7  log ' + (cfg.logChannel ? '<#' + cfg.logChannel + '>' : '`not set`') + '\n';
    if (!cfg.enabled) {
        head += '-# Turn it on from the Protection menu below.\n';
    }

    head += '\n**Filters** \u2014 ' + onCount + ' of ' + keys.length + ' on\n';
    head += (activeLabels.length ? activeLabels.join(', ') : '*none enabled*') + '\n';

    const exemptR = (cfg.whitelistedRoles || []).length;
    const exemptC = (cfg.whitelistedChannels || []).length;
    head += '\n**Exempt** \u00b7 ' + exemptR + ' role(s), ' + exemptC + ' channel(s)';

    const container = new ContainerBuilder()
        .setAccentColor(COLORS.PRIMARY)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(head))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

    // Filters: the selection IS the state, applied absolutely.
    container.addActionRowComponents(menuRow(AID.filters, 'Filters \u2014 ' + onCount + ' of ' + keys.length + ' on',
        keys.map(k => ({
            value: k,
            label: FILTER_INFO[k].label,
            description: filterSummary(k, filters[k]),
            emoji: mark(!!(filters[k] && filters[k].enabled)),
            default: !!(filters[k] && filters[k].enabled),
        })), { min: 0, max: keys.length }));

    container.addActionRowComponents(menuRow(AID.system, 'Protection', [
        { value: 'antispam:set:enabled:on', label: 'Enable anti-spam', description: 'Start acting on spam', emoji: mark(!!cfg.enabled) },
        { value: 'antispam:set:enabled:off', label: 'Disable anti-spam', description: 'Stop acting, keep the settings', emoji: mark(!cfg.enabled) },
        { value: 'antispam:reset', label: 'Reset all settings', description: 'Back to defaults' },
    ]));

    const act = cfg.action || 'timeout';
    container.addActionRowComponents(menuRow(AID.action, 'Punishment', [
        { value: 'antispam:set:action:warn', label: 'Warn', description: 'Delete and notify only', emoji: mark(act === 'warn') },
        { value: 'antispam:set:action:timeout', label: 'Timeout', description: 'Mute for ' + Math.round((cfg.timeoutDuration || 60000) / 1000) + 's', emoji: mark(act === 'timeout') },
        { value: 'antispam:set:action:kick', label: 'Kick', description: 'Remove from the server', emoji: mark(act === 'kick') },
        { value: 'antispam:set:action:ban', label: 'Ban', description: 'Permanent removal', emoji: mark(act === 'ban') },
    ]));

    container.addActionRowComponents(menuRow(AID.configure, 'Adjust a filter\u2019s thresholds',
        keys.filter(k => CONFIGURABLE.includes(k)).map(k => ({
            value: k,
            label: FILTER_INFO[k].label,
            description: filterSummary(k, filters[k]),
            emoji: mark(!!(filters[k] && filters[k].enabled)),
        }))));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId(AID.log)
            .setPlaceholder('Log channel for spam actions')
            .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setMinValues(0)
            .setMaxValues(1)
    ));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
            .setCustomId(AID.exemptRoles)
            .setPlaceholder('Roles exempt from anti-spam')
            .setMinValues(0)
            .setMaxValues(20)
    ));

    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
            .setCustomId(AID.exemptChannels)
            .setPlaceholder('Channels exempt from anti-spam')
            .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum)
            .setMinValues(0)
            .setMaxValues(25)
    ));

    return container;
}

/** Filters that expose numeric thresholds worth a modal. */
const CONFIGURABLE = ['messageSpam', 'emojiSpam', 'capsSpam', 'linkSpam', 'imageSpam', 'stickerSpam', 'mentionSpam', 'duplicateSpam', 'newlineSpam'];

/**
 * Applies a filter multi-select absolutely: the submitted values are the
 * complete set the admin wants on, so replaying it is a no-op.
 */
function applyFilterSelection(filters, selected) {
    const want = new Set(selected || []);
    const changed = [];
    for (const key of Object.keys(FILTER_INFO)) {
        if (!filters[key]) filters[key] = { ...getDefaultGuildConfig().filters[key] };
        const before = !!filters[key].enabled;
        const after = want.has(key);
        if (before !== after) {
            filters[key].enabled = after;
            changed.push(`${mark(after)} ${FILTER_INFO[key].label}`);
        }
    }
    return changed;
}

function buildOk(title, desc) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.PRIMARY)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('# ' + EMOJIS.SUCCESS + ' ' + title + '\n\n' + desc))
;
}
function buildErr(title, desc) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.ERROR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent('# ' + EMOJIS.ERROR + ' ' + title + '\n\n' + desc));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('antispam')
        .setDescription('Configure anti-spam protection and spam filters')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub => sub.setName('enable').setDescription('Enable anti-spam protection'))
        .addSubcommand(sub => sub.setName('disable').setDescription('Disable anti-spam protection'))
        .addSubcommand(sub => sub.setName('status').setDescription('View current anti-spam configuration'))
        .addSubcommand(sub => sub.setName('action').setDescription('Set the punishment action for spam')
            .addStringOption(opt => opt.setName('type').setDescription('Action to take').setRequired(true)
                .addChoices({ name: 'Timeout (1 min)', value: 'timeout' }, { name: 'Kick', value: 'kick' }, { name: 'Ban', value: 'ban' }, { name: 'Warn', value: 'warn' })))
        .addSubcommand(sub => sub.setName('log').setDescription('Set the log channel for spam events')
            .addChannelOption(opt => opt.setName('channel').setDescription('Log channel').setRequired(true)))
        .addSubcommand(sub => sub.setName('filter').setDescription('Toggle a spam filter on or off')
            .addStringOption(opt => opt.setName('name').setDescription('Filter name').setRequired(true)
                .addChoices(...FILTER_NAMES.map(k => ({ name: FILTER_INFO[k].label, value: k }))))
            .addStringOption(opt => opt.setName('state').setDescription('Enable or disable').setRequired(true)
                .addChoices({ name: 'Enable', value: 'on' }, { name: 'Disable', value: 'off' })))
        .addSubcommand(sub => sub.setName('configure').setDescription('Configure a specific filter\'s settings')
            .addStringOption(opt => opt.setName('filter').setDescription('Which filter to configure').setRequired(true)
                .addChoices(...FILTER_NAMES.map(k => ({ name: FILTER_INFO[k].label, value: k })))))
        .addSubcommand(sub => sub.setName('whitelist-role').setDescription('Toggle a role on the spam whitelist')
            .addRoleOption(opt => opt.setName('role').setDescription('Role to toggle').setRequired(true)))
        .addSubcommand(sub => sub.setName('whitelist-channel').setDescription('Toggle a channel on the spam whitelist')
            .addChannelOption(opt => opt.setName('channel').setDescription('Channel to toggle').setRequired(true)))
        .addSubcommand(sub => sub.setName('reset').setDescription('Reset all anti-spam settings to defaults')),

    prefix: 'antispam',
    description: 'Configure anti-spam protection and spam filters',
    usage: 'antispam <enable/disable/status/action/log/filter/configure/whitelist-role/whitelist-channel/reset>',
    category: 'admin',
    aliases: ['anti-spam', 'spamprotect'],

    async execute(interaction) {
        try {
            const config = loadConfig();
            const guildConfig = ensureGuildConfig(config, interaction.guild.id);
            const sub = interaction.options.getSubcommand();

            if (sub === 'enable') { config[interaction.guild.id].enabled = true; saveConfig(config); return interaction.reply({ components: [buildOk('Anti-Spam Enabled', 'Messages triggering spam filters will result in **' + guildConfig.action + '**.')], flags: MessageFlags.IsComponentsV2 }); }
            if (sub === 'disable') { config[interaction.guild.id].enabled = false; saveConfig(config); return interaction.reply({ components: [buildOk('Anti-Spam Disabled', 'Spam protection has been turned off.')], flags: MessageFlags.IsComponentsV2 }); }
            if (sub === 'status') { return interaction.reply({ components: [buildAntispamContainer(guildConfig)], flags: MessageFlags.IsComponentsV2 }); }

            if (sub === 'action') {
                const type = interaction.options.getString('type');
                config[interaction.guild.id].action = type;
                saveConfig(config);
                const actionMap = { timeout: 'Timeout', kick: 'Kick', ban: 'Ban', warn: 'Warn' };
                return interaction.reply({ components: [buildOk('Action Updated', 'Spam punishment set to **' + actionMap[type] + '**.')], flags: MessageFlags.IsComponentsV2 });
            }
            if (sub === 'log') {
                const channel = interaction.options.getChannel('channel');
                config[interaction.guild.id].logChannel = channel.id;
                saveConfig(config);
                return interaction.reply({ components: [buildOk('Log Channel Set', 'Spam events will be logged in ' + channel + '.')], flags: MessageFlags.IsComponentsV2 });
            }
            if (sub === 'filter') {
                const name = interaction.options.getString('name');
                const state = interaction.options.getString('state');
                if (!config[interaction.guild.id].filters) config[interaction.guild.id].filters = getDefaultGuildConfig().filters;
                config[interaction.guild.id].filters[name].enabled = state === 'on';
                saveConfig(config);
                const info = FILTER_INFO[name];
                return interaction.reply({ components: [buildOk(info.label + (state === 'on' ? ' Enabled' : ' Disabled'), info.emoji + ' ' + info.desc + ' — now **' + (state === 'on' ? 'active' : 'inactive') + '**.')], flags: MessageFlags.IsComponentsV2 });
            }
            if (sub === 'configure') {
                const filterName = interaction.options.getString('filter');
                return showConfigureModal(interaction, guildConfig, filterName);
            }
            if (sub === 'whitelist-role') {
                const role = interaction.options.getRole('role');
                const roles = config[interaction.guild.id].whitelistedRoles || [];
                const idx = roles.indexOf(role.id);
                if (idx >= 0) { roles.splice(idx, 1); } else { roles.push(role.id); }
                config[interaction.guild.id].whitelistedRoles = roles;
                saveConfig(config);
                return interaction.reply({ components: [buildOk('Role Updated', role + ' has been **' + (idx >= 0 ? 'removed from' : 'added to') + '** the whitelist.')], flags: MessageFlags.IsComponentsV2 });
            }
            if (sub === 'whitelist-channel') {
                const channel = interaction.options.getChannel('channel');
                const channels = config[interaction.guild.id].whitelistedChannels || [];
                const idx = channels.indexOf(channel.id);
                if (idx >= 0) { channels.splice(idx, 1); } else { channels.push(channel.id); }
                config[interaction.guild.id].whitelistedChannels = channels;
                saveConfig(config);
                return interaction.reply({ components: [buildOk('Channel Updated', channel + ' has been **' + (idx >= 0 ? 'removed from' : 'added to') + '** the whitelist.')], flags: MessageFlags.IsComponentsV2 });
            }
            if (sub === 'reset') {
                config[interaction.guild.id] = getDefaultGuildConfig();
                saveConfig(config);
                return interaction.reply({ components: [buildOk('Anti-Spam Reset', 'All settings reset to defaults.')], flags: MessageFlags.IsComponentsV2 });
            }

            await interaction.reply({ components: [buildAntispamContainer(guildConfig)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[AntiSpam] Error:', error);
            const container = buildErrorResponse('Error', 'An error occurred.', error.message);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply({ components: [buildErr('Permission Denied', 'You need **Administrator** permission.')], flags: MessageFlags.IsComponentsV2 });
        }
        try {
            const config = loadConfig();
            const guildConfig = ensureGuildConfig(config, message.guild.id);
            const sub = args[0]?.toLowerCase();

            if (!sub || sub === 'status') { return message.reply({ components: [buildAntispamContainer(guildConfig)], flags: MessageFlags.IsComponentsV2 }); }
            if (sub === 'enable') { config[message.guild.id].enabled = true; saveConfig(config); return message.reply({ components: [buildOk('Anti-Spam Enabled', 'Messages triggering spam filters will result in **' + guildConfig.action + '**.')], flags: MessageFlags.IsComponentsV2 }); }
            if (sub === 'disable') { config[message.guild.id].enabled = false; saveConfig(config); return message.reply({ components: [buildOk('Anti-Spam Disabled', 'Spam protection has been turned off.')], flags: MessageFlags.IsComponentsV2 }); }

            if (sub === 'action') {
                const type = args[1]?.toLowerCase();
                if (!type || !VALID_ACTIONS.includes(type)) return message.reply({ components: [buildErr('Invalid Action', 'Valid: **' + VALID_ACTIONS.join(', ') + '**\n\n**Usage:** `-antispam action <type>`')], flags: MessageFlags.IsComponentsV2 });
                config[message.guild.id].action = type;
                saveConfig(config);
                const actionMap = { timeout: 'Timeout', kick: 'Kick', ban: 'Ban', warn: 'Warn' };
                return message.reply({ components: [buildOk('Action Updated', 'Spam punishment set to **' + actionMap[type] + '**.')], flags: MessageFlags.IsComponentsV2 });
            }
            if (sub === 'log') {
                const channel = message.mentions.channels.first();
                if (!channel) return message.reply({ components: [buildErr('Invalid Channel', 'Mention a channel.\n\n**Usage:** `-antispam log #channel`')], flags: MessageFlags.IsComponentsV2 });
                config[message.guild.id].logChannel = channel.id;
                saveConfig(config);
                return message.reply({ components: [buildOk('Log Channel Set', 'Spam events will be logged in ' + channel + '.')], flags: MessageFlags.IsComponentsV2 });
            }
            if (sub === 'filter') {
                const filterName = args[1]?.toLowerCase();
                const state = args[2]?.toLowerCase();
                const matched = FILTER_NAMES.find(k => k.toLowerCase() === filterName);
                if (!matched || !['on', 'off'].includes(state)) {
                    return message.reply({ components: [buildErr('Invalid Filter', '**Filters:** ' + FILTER_NAMES.map(k => '`' + k + '`').join(', ') + '\n\n**Usage:** `-antispam filter <name> <on/off>`')], flags: MessageFlags.IsComponentsV2 });
                }
                if (!config[message.guild.id].filters) config[message.guild.id].filters = getDefaultGuildConfig().filters;
                config[message.guild.id].filters[matched].enabled = state === 'on';
                saveConfig(config);
                const info = FILTER_INFO[matched];
                return message.reply({ components: [buildOk(info.label + (state === 'on' ? ' Enabled' : ' Disabled'), info.emoji + ' ' + info.desc + ' — now **' + (state === 'on' ? 'active' : 'inactive') + '**.')], flags: MessageFlags.IsComponentsV2 });
            }
            if (sub === 'configure') {
                const filterName = args[1]?.toLowerCase();
                const matched = FILTER_NAMES.find(k => k.toLowerCase() === filterName);
                if (!matched) return message.reply({ components: [buildErr('Invalid Filter', '**Filters:** ' + FILTER_NAMES.map(k => '`' + k + '`').join(', ') + '\n\n**Usage:** `-antispam configure <filter>`')], flags: MessageFlags.IsComponentsV2 });
                return showConfigurePanel(message, guildConfig, matched);
            }
            if (sub === 'whitelist-role' || sub === 'whitelistrole') {
                const role = message.mentions.roles.first();
                if (!role) return message.reply({ components: [buildErr('Invalid Role', 'Mention a role.\n\n**Usage:** `-antispam whitelist-role @role`')], flags: MessageFlags.IsComponentsV2 });
                const roles = config[message.guild.id].whitelistedRoles || [];
                const idx = roles.indexOf(role.id);
                if (idx >= 0) { roles.splice(idx, 1); } else { roles.push(role.id); }
                config[message.guild.id].whitelistedRoles = roles;
                saveConfig(config);
                return message.reply({ components: [buildOk('Role Updated', role + ' has been **' + (idx >= 0 ? 'removed from' : 'added to') + '** the whitelist.')], flags: MessageFlags.IsComponentsV2 });
            }
            if (sub === 'whitelist-channel' || sub === 'whitelistchannel') {
                const channel = message.mentions.channels.first();
                if (!channel) return message.reply({ components: [buildErr('Invalid Channel', 'Mention a channel.\n\n**Usage:** `-antispam whitelist-channel #channel`')], flags: MessageFlags.IsComponentsV2 });
                const channels = config[message.guild.id].whitelistedChannels || [];
                const idx = channels.indexOf(channel.id);
                if (idx >= 0) { channels.splice(idx, 1); } else { channels.push(channel.id); }
                config[message.guild.id].whitelistedChannels = channels;
                saveConfig(config);
                return message.reply({ components: [buildOk('Channel Updated', channel + ' has been **' + (idx >= 0 ? 'removed from' : 'added to') + '** the whitelist.')], flags: MessageFlags.IsComponentsV2 });
            }
            if (sub === 'reset') {
                config[message.guild.id] = getDefaultGuildConfig();
                saveConfig(config);
                return message.reply({ components: [buildOk('Anti-Spam Reset', 'All settings reset to defaults.')], flags: MessageFlags.IsComponentsV2 });
            }

            return message.reply({ components: [buildAntispamContainer(guildConfig)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[AntiSpam] Error:', error);
            return message.reply({ components: [buildErrorResponse('Error', 'An error occurred.', error.message)], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async handleInteraction(interaction) {
        const rawId = interaction.customId || '';
        const isPanel = rawId.startsWith('antispam:');
        if (!isPanel && !rawId.startsWith('antispam_')) return false;

        if (!interaction.guild || !interaction.member) return false;
        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            await interaction.reply({ content: EMOJIS.ERROR + ' You need Manage Server permission.', flags: MessageFlags.Ephemeral });
            return true;
        }

        const guildId = interaction.guild.id;
        const config = loadConfig();
        ensureGuildConfig(config, guildId);
        const guildConfig = config[guildId];
        if (!guildConfig.filters) guildConfig.filters = getDefaultGuildConfig().filters;

        const persist = async (note) => {
            config[guildId] = guildConfig;
            saveConfig(config);
            await interaction.update({
                components: [buildAntispamContainer(guildConfig)],
                flags: MessageFlags.IsComponentsV2
            });
            if (note) {
                await interaction.followUp({ content: note, flags: MessageFlags.Ephemeral }).catch(() => { });
            }
        };

        /* ── filters: selection IS state ── */
        if (rawId === AID.filters) {
            applyFilterSelection(guildConfig.filters, interaction.values);
            await persist();
            return true;
        }

        /* ── single-choice menus dispatch on their option value ── */
        const chosen = isPanel ? (interaction.values && interaction.values[0]) || rawId : rawId;

        if (chosen === 'antispam:reset') {
            config[guildId] = getDefaultGuildConfig();
            saveConfig(config);
            await interaction.update({
                components: [buildAntispamContainer(config[guildId])],
                flags: MessageFlags.IsComponentsV2
            });
            return true;
        }

        /* Discrete setters: `antispam:set:<field>:<value>`.
         * Custom ids come from the client, so both field and value are checked
         * against a whitelist rather than written through. */
        if (typeof chosen === 'string' && chosen.startsWith('antispam:set:')) {
            const parts = chosen.split(':');
            const field = parts[2];
            const value = parts[3];
            const ALLOWED = {
                enabled: ['on', 'off'],
                action: VALID_ACTIONS,
            };
            /* Object.prototype keys are inherited, so a crafted field of
             * `__proto__` or `constructor` made ALLOWED[field] truthy and the
             * guard passed — then .includes() was not a function and the handler
             * threw. Check OWN properties, and require an actual array. */
            /* Object.prototype keys are inherited, so a crafted field of
             * `__proto__` or `constructor` made ALLOWED[field] truthy and the
             * guard passed — then .includes() was not a function and the handler
             * threw. Check OWN properties, and require an actual array. */
            const allowedValues = Object.prototype.hasOwnProperty.call(ALLOWED, field) ? ALLOWED[field] : null;
            if (!Array.isArray(allowedValues) || !allowedValues.includes(value)) {
                await interaction.reply({
                    content: EMOJIS.ERROR + ' That option is not recognised. Re-open the panel with `/antispam status`.',
                    flags: MessageFlags.Ephemeral
                });
                return true;
            }
            if (field === 'enabled') guildConfig.enabled = (value === 'on');
            else if (field === 'action') guildConfig.action = value;
            await persist();
            return true;
        }

        if (rawId === AID.log) {
            const picked = (interaction.values || [])[0] || null;
            guildConfig.logChannel = picked;
            await persist();
            return true;
        }

        if (rawId === AID.exemptRoles) {
            guildConfig.whitelistedRoles = (interaction.values || []).slice(0, 20);
            await persist();
            return true;
        }

        if (rawId === AID.exemptChannels) {
            guildConfig.whitelistedChannels = (interaction.values || []).slice(0, 25);
            await persist();
            return true;
        }

        /* ── threshold modal for one filter ── */
        if (rawId === AID.configure) {
            const filterName = (interaction.values || [])[0];
            if (!FILTER_INFO[filterName]) {
                await interaction.reply({ content: EMOJIS.ERROR + ' Unknown filter.', flags: MessageFlags.Ephemeral });
                return true;
            }
            if (!CONFIGURABLE.includes(filterName)) {
                // inviteSpam is on/off only — opening a modal with no inputs
                // throws "Invalid Form Body" on Discord's side.
                await interaction.reply({ content: EMOJIS.ERROR + ' That filter has no adjustable limits.', flags: MessageFlags.Ephemeral });
                return true;
            }
            // showConfigureModal has no return value. Returning it directly made
            // handleInteraction report "not handled", so index.js fell through to
            // other handlers even though the modal had already been shown.
            await showConfigureModal(interaction, guildConfig, filterName);
            return true;
        }

        /* ── modal submit from the threshold form ── */
        if (rawId.startsWith('antispam_configure_modal_')) {
            return await handleConfigureModal(interaction, config, guildConfig, rawId.replace('antispam_configure_modal_', ''));
        }

        return false;
    },

    // Exported for use in event handler
    loadConfig,
    ensureGuildConfig,
    getDefaultGuildConfig,
    FILTER_INFO
};

async function showConfigureModal(interaction, guildConfig, filterName) {
    const filter = guildConfig.filters?.[filterName] || {};
    const info = FILTER_INFO[filterName];
    const modal = new ModalBuilder().setCustomId('antispam_configure_modal_' + filterName).setTitle('Configure ' + info.label);

    switch (filterName) {
        case 'messageSpam':
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('maxMessages').setLabel('Max messages per window (2-20)').setStyle(TextInputStyle.Short).setValue(String(filter.maxMessages || 5)).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('interval').setLabel('Time window in ms (2000-30000)').setStyle(TextInputStyle.Short).setValue(String(filter.interval || 5000)).setRequired(true))
            ); break;
        case 'emojiSpam':
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('maxEmojis').setLabel('Max emojis per message (3-50)').setStyle(TextInputStyle.Short).setValue(String(filter.maxEmojis || 10)).setRequired(true))); break;
        case 'capsSpam':
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('minLength').setLabel('Min message length to check (5-50)').setStyle(TextInputStyle.Short).setValue(String(filter.minLength || 10)).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('maxPercent').setLabel('Max caps percentage (50-95)').setStyle(TextInputStyle.Short).setValue(String(filter.maxPercent || 70)).setRequired(true))
            ); break;
        case 'linkSpam':
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('maxLinks').setLabel('Max links per message (1-10)').setStyle(TextInputStyle.Short).setValue(String(filter.maxLinks || 3)).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('whitelistedDomains').setLabel('Whitelisted domains (comma separated)').setStyle(TextInputStyle.Paragraph).setValue((filter.whitelistedDomains || []).join(', ')).setRequired(false).setPlaceholder('youtube.com, twitter.com'))
            ); break;
        case 'imageSpam':
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('maxImages').setLabel('Max images per window (1-10)').setStyle(TextInputStyle.Short).setValue(String(filter.maxImages || 3)).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('interval').setLabel('Time window in ms (5000-60000)').setStyle(TextInputStyle.Short).setValue(String(filter.interval || 10000)).setRequired(true))
            ); break;
        case 'stickerSpam':
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('maxStickers').setLabel('Max stickers per window (1-10)').setStyle(TextInputStyle.Short).setValue(String(filter.maxStickers || 3)).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('interval').setLabel('Time window in ms (5000-60000)').setStyle(TextInputStyle.Short).setValue(String(filter.interval || 10000)).setRequired(true))
            ); break;
        case 'mentionSpam':
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('maxMentions').setLabel('Max mentions per message (2-20)').setStyle(TextInputStyle.Short).setValue(String(filter.maxMentions || 5)).setRequired(true))); break;
        case 'duplicateSpam':
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('maxDuplicates').setLabel('Max duplicate messages (2-10)').setStyle(TextInputStyle.Short).setValue(String(filter.maxDuplicates || 3)).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('interval').setLabel('Time window in ms (5000-120000)').setStyle(TextInputStyle.Short).setValue(String(filter.interval || 30000)).setRequired(true))
            ); break;
        // inviteSpam is on/off only. It used to render a dummy read-only input
        // that handleConfigureModal never read; the CONFIGURABLE guard in
        // handleInteraction now rejects it before we get here.
        case 'newlineSpam':
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('maxNewlines').setLabel('Max newlines per message (5-50)').setStyle(TextInputStyle.Short).setValue(String(filter.maxNewlines || 15)).setRequired(true))); break;
    }
    await interaction.showModal(modal);
}

function showConfigurePanel(message, guildConfig, filterName) {
    const filter = guildConfig.filters?.[filterName] || {};
    const info = FILTER_INFO[filterName];
    let t = '# ' + info.emoji + ' ' + info.label + ' Settings\n\n';
    t += '**Status:** ' + (filter.enabled ? '<:Toggleon:1521227758011809964> Enabled' : '<:Toggleoff:1521227763816595559> Disabled') + '\n\n';
    switch (filterName) {
        case 'messageSpam': t += '**Max Messages:** ' + (filter.maxMessages||5) + '\n**Time Window:** ' + ((filter.interval||5000)/1000) + 's'; break;
        case 'emojiSpam': t += '**Max Emojis:** ' + (filter.maxEmojis||10); break;
        case 'capsSpam': t += '**Min Length:** ' + (filter.minLength||10) + '\n**Max Caps %:** ' + (filter.maxPercent||70) + '%'; break;
        case 'linkSpam': t += '**Max Links:** ' + (filter.maxLinks||3) + '\n**Whitelisted:** ' + ((filter.whitelistedDomains||[]).join(', ') || 'None'); break;
        case 'imageSpam': t += '**Max Images:** ' + (filter.maxImages||3) + '\n**Time Window:** ' + ((filter.interval||10000)/1000) + 's'; break;
        case 'stickerSpam': t += '**Max Stickers:** ' + (filter.maxStickers||3) + '\n**Time Window:** ' + ((filter.interval||10000)/1000) + 's'; break;
        case 'mentionSpam': t += '**Max Mentions:** ' + (filter.maxMentions||5); break;
        case 'duplicateSpam': t += '**Max Duplicates:** ' + (filter.maxDuplicates||3) + '\n**Time Window:** ' + ((filter.interval||30000)/1000) + 's'; break;
        case 'inviteSpam': t += 'Blocks all Discord server invite links.'; break;
        case 'newlineSpam': t += '**Max Newlines:** ' + (filter.maxNewlines||15); break;
    }
    const container = new ContainerBuilder().setAccentColor(COLORS.PRIMARY)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(t))
;
    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

async function handleConfigureModal(interaction, config, guildConfig, filterName) {
    const guildId = interaction.guild.id;
    if (!config[guildId].filters) config[guildId].filters = getDefaultGuildConfig().filters;
    const filter = config[guildId].filters[filterName];
    try {
        switch (filterName) {
            case 'messageSpam': filter.maxMessages = Math.min(20,Math.max(2,parseInt(interaction.fields.getTextInputValue('maxMessages'))||5)); filter.interval = Math.min(30000,Math.max(2000,parseInt(interaction.fields.getTextInputValue('interval'))||5000)); break;
            case 'emojiSpam': filter.maxEmojis = Math.min(50,Math.max(3,parseInt(interaction.fields.getTextInputValue('maxEmojis'))||10)); break;
            case 'capsSpam': filter.minLength = Math.min(50,Math.max(5,parseInt(interaction.fields.getTextInputValue('minLength'))||10)); filter.maxPercent = Math.min(95,Math.max(50,parseInt(interaction.fields.getTextInputValue('maxPercent'))||70)); break;
            case 'linkSpam': filter.maxLinks = Math.min(10,Math.max(1,parseInt(interaction.fields.getTextInputValue('maxLinks'))||3)); filter.whitelistedDomains = (interaction.fields.getTextInputValue('whitelistedDomains')||'').split(',').map(d=>d.trim().toLowerCase()).filter(Boolean); break;
            case 'imageSpam': filter.maxImages = Math.min(10,Math.max(1,parseInt(interaction.fields.getTextInputValue('maxImages'))||3)); filter.interval = Math.min(60000,Math.max(5000,parseInt(interaction.fields.getTextInputValue('interval'))||10000)); break;
            case 'stickerSpam': filter.maxStickers = Math.min(10,Math.max(1,parseInt(interaction.fields.getTextInputValue('maxStickers'))||3)); filter.interval = Math.min(60000,Math.max(5000,parseInt(interaction.fields.getTextInputValue('interval'))||10000)); break;
            case 'mentionSpam': filter.maxMentions = Math.min(20,Math.max(2,parseInt(interaction.fields.getTextInputValue('maxMentions'))||5)); break;
            case 'duplicateSpam': filter.maxDuplicates = Math.min(10,Math.max(2,parseInt(interaction.fields.getTextInputValue('maxDuplicates'))||3)); filter.interval = Math.min(120000,Math.max(5000,parseInt(interaction.fields.getTextInputValue('interval'))||30000)); break;
            case 'newlineSpam': filter.maxNewlines = Math.min(50,Math.max(5,parseInt(interaction.fields.getTextInputValue('maxNewlines'))||15)); break;
        }
        config[guildId].filters[filterName] = filter;
        saveConfig(config);
        const info = FILTER_INFO[filterName];

        /* Refresh the panel the modal was opened from, so the new limits appear
         * straight away instead of only after the panel is reopened. A modal
         * submit raised by a component carries that message, but it can be
         * absent (panel deleted, bot restarted), so this is best-effort. */
        try {
            if (interaction.message) {
                await interaction.message.edit({
                    components: [buildAntispamContainer(config[guildId])],
                    flags: MessageFlags.IsComponentsV2
                });
            }
        } catch { /* panel gone — the confirmation below still tells the user */ }

        await interaction.reply({ components: [buildOk(info.label + ' Configured', 'Now ' + filterSummary(filterName, filter) + '.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return true;
    } catch (error) {
        console.error('[AntiSpam Configure]', error);
        await interaction.reply({ components: [buildErr('Configuration Error', 'Failed to update filter settings.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return true;
    }
}
