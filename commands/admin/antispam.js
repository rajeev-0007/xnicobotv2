const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
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

function buildStatusPanel(guildConfig) {
    const status = guildConfig.enabled ? EMOJIS.SUCCESS + ' Enabled' : EMOJIS.ERROR + ' Disabled';
    const actionMap = { timeout: 'Timeout', kick: 'Kick', ban: 'Ban', mute: 'Mute', warn: 'Warn' };
    const actionLabel = actionMap[guildConfig.action] || guildConfig.action;
    const whitelistedRoles = guildConfig.whitelistedRoles?.length ? guildConfig.whitelistedRoles.map(id => '<@&' + id + '>').join(', ') : 'None';
    const whitelistedChannels = guildConfig.whitelistedChannels?.length ? guildConfig.whitelistedChannels.map(id => '<#' + id + '>').join(', ') : 'None';
    const logChannel = guildConfig.logChannel ? '<#' + guildConfig.logChannel + '>' : 'Not set';
    const filters = guildConfig.filters || getDefaultGuildConfig().filters;
    let filterStatus = '';
    for (const [key, info] of Object.entries(FILTER_INFO)) {
        const f = filters[key];
        const on = f?.enabled ? '<:Toggleon:1521227758011809964>' : '<:Toggleoff:1521227763816595559>';
        filterStatus += on + ' ' + info.emoji + ' **' + info.label + '**\n';
    }
    return new ContainerBuilder()
        .setAccentColor(COLORS.PRIMARY)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            '# <:Shield:1521227694677692467> Anti-Spam Configuration\n\n' +
            '### ' + EMOJIS.STATS + ' General Settings\n' +
            '**Status:** ' + status + '\n' +
            '**Action:** ' + actionLabel + '\n' +
            '**Log Channel:** ' + logChannel + '\n\n' +
            '### <:Userplus:1521227719621218477> Whitelists\n' +
            '**Roles:** ' + whitelistedRoles + '\n' +
            '**Channels:** ' + whitelistedChannels + '\n\n' +
            '### <:Fire:1521227907647668374> Spam Filters\n' +
            filterStatus + '\n' +
            '### ' + EMOJIS.CHANNEL + ' Commands\n' +
            '`/antispam enable` — Enable anti-spam\n' +
            '`/antispam disable` — Disable anti-spam\n' +
            '`/antispam action <type>` — Punishment (timeout/kick/ban/warn)\n' +
            '`/antispam log <channel>` — Set log channel\n' +
            '`/antispam filter <name> <on/off>` — Toggle a filter\n' +
            '`/antispam configure <filter>` — Configure filter settings\n' +
            '`/antispam whitelist-role <role>` — Toggle role whitelist\n' +
            '`/antispam whitelist-channel <channel>` — Toggle channel whitelist\n' +
            '`/antispam reset` — Reset all settings'
        ))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(createFooterText()))
;
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
            if (sub === 'status') { return interaction.reply({ components: [buildStatusPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 }); }

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

            await interaction.reply({ components: [buildStatusPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 });
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

            if (!sub || sub === 'status') { return message.reply({ components: [buildStatusPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 }); }
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

            return message.reply({ components: [buildStatusPanel(guildConfig)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[AntiSpam] Error:', error);
            return message.reply({ components: [buildErrorResponse('Error', 'An error occurred.', error.message)], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async handleInteraction(interaction) {
        if (!interaction.customId?.startsWith('antispam_')) return false;
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ components: [buildErr('Permission Denied', 'You need **Administrator** permission.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            return true;
        }
        const config = loadConfig();
        const guildConfig = ensureGuildConfig(config, interaction.guild.id);
        if (interaction.customId.startsWith('antispam_configure_modal_') && interaction.isModalSubmit()) {
            const filterName = interaction.customId.replace('antispam_configure_modal_', '');
            return handleConfigureModal(interaction, config, guildConfig, filterName);
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
        case 'inviteSpam':
            modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('placeholder').setLabel('No extra settings for invite spam').setStyle(TextInputStyle.Short).setValue('Blocks all invites when enabled').setRequired(false))); break;
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
        await interaction.reply({ components: [buildOk(info.label + ' Configured', info.emoji + ' Settings for **' + info.label + '** have been updated.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return true;
    } catch (error) {
        console.error('[AntiSpam Configure]', error);
        await interaction.reply({ components: [buildErr('Configuration Error', 'Failed to update filter settings.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return true;
    }
}
