const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ContainerBuilder, TextDisplayBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const { invalidateCache } = require('../../utils/logger');
const { } = require('../../utils/responseBuilder');

const jsonStore = require('../../utils/jsonStore');

function loadLogs() {
    if (!jsonStore.has('logs')) {
        jsonStore.write('logs', {});
    }
    return jsonStore.read('logs');
}

function saveLogs(data) {
    jsonStore.write('logs', data);
}

/**
 * Toggle membership of an id in an array. Returns the new array and the
 * action taken ('added' | 'removed'). Used by the filter subcommands
 * so `ignore-user @x` toggles instead of pushing duplicates.
 */
function toggleInList(list, id) {
    const arr = Array.isArray(list) ? [...list] : [];
    const idx = arr.indexOf(id);
    if (idx >= 0) {
        arr.splice(idx, 1);
        return { list: arr, action: 'removed' };
    }
    arr.push(id);
    return { list: arr, action: 'added' };
}

/**
 * Slash-side handler for the `/logging filter ...` subcommand group.
 * Splitting this out keeps the main `execute` switch readable.
 */
async function handleFilterSlash(interaction, logs, guildId) {
    const sub = interaction.options.getSubcommand();
    if (!logs[guildId].filters) logs[guildId].filters = {};
    const filters = logs[guildId].filters;

    const replyContainer = (color, body) => new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
;

    if (sub === 'ignore-user') {
        const user = interaction.options.getUser('user', true);
        const r = toggleInList(filters.ignoredUsers, user.id);
        filters.ignoredUsers = r.list;
        saveLogs(logs); invalidateCache();
        return interaction.reply({
            components: [replyContainer(0xCAD7E6,
                `# <:Checkedbox:1521227734943269077> Filter Updated\n\n` +
                `<:User:1521227714227343380> **${user.tag || user.username}** (\`${user.id}\`) — **${r.action === 'added' ? 'Added to' : 'Removed from'}** the ignore list.\n\n` +
                `Total ignored users: \`${filters.ignoredUsers.length}\`\n\n` +
                `*Events from this user will ${r.action === 'added' ? 'no longer' : 'now'} appear in any log channel.*`
            )],
            flags: MessageFlags.IsComponentsV2 });
    }

    if (sub === 'ignore-channel') {
        const ch = interaction.options.getChannel('channel', true);
        const r = toggleInList(filters.ignoredChannels, ch.id);
        filters.ignoredChannels = r.list;
        saveLogs(logs); invalidateCache();
        return interaction.reply({
            components: [replyContainer(0xCAD7E6,
                `# <:Checkedbox:1521227734943269077> Filter Updated\n\n` +
                `<:Pin:1521227932625014916> ${ch} (\`${ch.id}\`) — **${r.action === 'added' ? 'Added to' : 'Removed from'}** the ignore list.\n\n` +
                `Total ignored channels: \`${filters.ignoredChannels.length}\``
            )],
            flags: MessageFlags.IsComponentsV2 });
    }

    if (sub === 'ignore-role') {
        const role = interaction.options.getRole('role', true);
        const r = toggleInList(filters.ignoredRoles, role.id);
        filters.ignoredRoles = r.list;
        saveLogs(logs); invalidateCache();
        return interaction.reply({
            components: [replyContainer(0xCAD7E6,
                `# <:Checkedbox:1521227734943269077> Filter Updated\n\n` +
                `<:Shield:1521227694677692467> ${role} (\`${role.id}\`) — **${r.action === 'added' ? 'Added to' : 'Removed from'}** the ignore list.\n\n` +
                `Total ignored roles: \`${filters.ignoredRoles.length}\`\n\n` +
                `*Members holding this role will be skipped in member/voice/moderation logs.*`
            )],
            flags: MessageFlags.IsComponentsV2 });
    }

    if (sub === 'ignore-bots') {
        const mode = interaction.options.getString('mode', true);
        filters.ignoreBots = mode === 'on';
        saveLogs(logs); invalidateCache();
        return interaction.reply({
            components: [replyContainer(filters.ignoreBots ? 0x57F287 : 0xED4245,
                `# <:Checkedbox:1521227734943269077> Bot Filter ${filters.ignoreBots ? 'Enabled' : 'Disabled'}\n\n` +
                (filters.ignoreBots
                    ? `<:bots:1521227848101396610> Bot-authored events will no longer appear in member, voice, or moderation logs.`
                    : `<:bots:1521227848101396610> Bot-authored events will appear in logs again.`)
            )],
            flags: MessageFlags.IsComponentsV2 });
    }

    if (sub === 'view') {
        const f = filters || {};
        const userList = (f.ignoredUsers || []).slice(0, 20).map(id => `<@${id}> (\`${id}\`)`).join('\n') || '*None*';
        const chList = (f.ignoredChannels || []).slice(0, 20).map(id => `<#${id}> (\`${id}\`)`).join('\n') || '*None*';
        const roleList = (f.ignoredRoles || []).slice(0, 20).map(id => `<@&${id}> (\`${id}\`)`).join('\n') || '*None*';
        return interaction.reply({
            components: [replyContainer(0xCAD7E6,
                `# <:Inforect:1521228008285929532> Logging Filters\n\n` +
                `<:bots:1521227848101396610> **Ignore Bots:** ${f.ignoreBots ? 'On' : 'Off'}\n\n` +
                `### <:User:1521227714227343380> Ignored Users (${(f.ignoredUsers || []).length})\n${userList}\n\n` +
                `### <:Pin:1521227932625014916> Ignored Channels (${(f.ignoredChannels || []).length})\n${chList}\n\n` +
                `### <:Shield:1521227694677692467> Ignored Roles (${(f.ignoredRoles || []).length})\n${roleList}`
            )],
            flags: MessageFlags.IsComponentsV2 });
    }

    if (sub === 'clear') {
        delete logs[guildId].filters;
        saveLogs(logs); invalidateCache();
        return interaction.reply({
            components: [replyContainer(0xED4245,
                `# <:Toggleoff:1521227763816595559> All Filters Cleared\n\n` +
                `<:Checkedbox:1521227734943269077> All ignore lists have been removed. Logs will record all events again.`
            )],
            flags: MessageFlags.IsComponentsV2 });
    }
}

// Single source of truth for log categories so slash + prefix paths stay aligned.
const logTypeNames = {
    message:    { name: 'Message',    emoji: '<:Hashtag:1521227771957870604>',     desc: 'message edits, deletions, and reactions' },
    member:     { name: 'Member',     emoji: '<:User:1521227714227343380>',     desc: 'joins, leaves, role changes, and bans' },
    voice:      { name: 'Voice',      emoji: '<:Volumeup:1521228004502536272>', desc: 'VC joins, leaves, and streaming activity' },
    server:     { name: 'Server',     emoji: '<:Settings:1521227767780343879>', desc: 'channel/role changes and server settings' },
    moderation: { name: 'Moderation', emoji: '<:banhammer:1521227777083314529>',desc: 'warns, kicks, bans, and mod actions' },
    automod:    { name: 'AutoMod',    emoji: '<:Shield:1521227694677692467>',   desc: 'automod filter triggers (spam, links, words, mentions)' },
    security:   { name: 'Security',   emoji: '<:Shield:1521227694677692467>',   desc: 'Anti-Nuke / Anti-Raid / Vanity Guard / threat-mode events' },
    boost:      { name: 'Boost',      emoji: '<:Sketch:1521228025365004471>',   desc: 'server boost / unboost events' },
    commands:   { name: 'Commands',   emoji: '<:Gamepad:1521228035213230090>',  desc: 'slash and prefix command usage' },
    reactions:  { name: 'Reactions',  emoji: '<:Fire:1521227907647668374>',     desc: 'reaction adds & removes (with target message + author)' },
    pins:       { name: 'Pins',       emoji: '<:Pin:1521227932625014916>',      desc: 'message pin & unpin events with executor attribution' } };
const ALL_LOG_KEYS = Object.keys(logTypeNames);

function buildLoggingPanel(config, guild) {
    const mode = config.mode || 'bot';

    let content = `# <:Document:1521227875016114266> Server Logging System\n\n`;
    content += `Monitor and track all server activities with comprehensive logging. Each log type captures specific events to help you manage your server effectively.\n\n`;

    content += `### <:Settings:1521227767780343879> Delivery Mode\n`;
    content += `<:Lightning:1521227915537285150> **Mode:** ${mode === 'webhook' ? '<:Attach:1521228039135170722> Webhook' : '<:bots:1521227848101396610> Bot Message'} — *All log messages are sent silently (no pings)*\n\n`;

    content += `### <:Fire:1521227907647668374> Log Channels Configuration\n`;

    const rows = [
        { key: 'message',    emoji: '<:Hashtag:1521227771957870604>',         name: 'Message Logs',     desc: 'Message edits, deletions, bulk deletes' },
        { key: 'member',     emoji: '<:User:1521227714227343380>',         name: 'Member Logs',      desc: 'Joins, leaves, role changes, nickname updates, kicks (auto-detected)' },
        { key: 'voice',      emoji: '<:Volumeup:1521228004502536272>',     name: 'Voice Logs',       desc: 'VC joins/leaves with duration, moves, mutes, deafens, streaming, forced disconnects' },
        { key: 'server',     emoji: '<:Settings:1521227767780343879>',     name: 'Server Logs',      desc: 'Channel/role creates, settings changes, emoji updates, threads, stickers (with executor)' },
        { key: 'moderation', emoji: '<:banhammer:1521227777083314529>',    name: 'Moderation Logs',  desc: 'Warns, kicks, bans, timeouts, mod actions (with executor + reason)' },
        { key: 'automod',    emoji: '<:Shield:1521227694677692467>',       name: 'AutoMod Logs',     desc: 'Filter triggers (spam, links, words, mentions)' },
        { key: 'security',   emoji: '<:Shield:1521227694677692467>',       name: 'Security Logs',    desc: 'Anti-Nuke, Anti-Raid, Anti-Alt, Vanity Guard, Threat mode' },
        { key: 'boost',      emoji: '<:Sketch:1521228025365004471>',       name: 'Boost Logs',       desc: 'Server boost / unboost events' },
        { key: 'commands',   emoji: '<:Gamepad:1521228035213230090>',      name: 'Command Logs',     desc: 'Slash and prefix command usage' },
        { key: 'reactions',  emoji: '<:Fire:1521227907647668374>',         name: 'Reaction Logs',    desc: 'Reaction adds & removes with target author + jump link' },
        { key: 'pins',       emoji: '<:Pin:1521227932625014916>',          name: 'Pin Logs',         desc: 'Message pin / unpin events (with executor from audit log)' },
    ];

    for (const row of rows) {
        const target = config[row.key] ? `<#${config[row.key]}>` : '*Not configured*';
        const wh = (mode === 'webhook' && config.webhooks?.[row.key]) ? ' <:Attach:1521228039135170722>' : '';
        content += `${row.emoji} **${row.name}:** ${target}${wh}\n*Tracks: ${row.desc}*\n\n`;
    }

    content += `### <:Edit:1521227886634205298> Quick Setup Guide\n`;
    content += `**Slash:** \`/logging set-<type> #channel\` · \`/logging set-all #channel\` · \`/logging disable <type>\` · \`/logging set-mode <bot|webhook>\` · \`/logging set-webhook <type> <url>\`\n`;
    content += `**Filters:** \`/logging filter ignore-user @user\` · \`/logging filter ignore-channel #ch\` · \`/logging filter ignore-bots <on|off>\` · \`/logging filter view\` · \`/logging filter clear\`\n`;
    content += `**Prefix:** \`-logging <type> #channel\` · \`-logging all #channel\` · \`-logging disable <type>\` · \`-logging mode <bot|webhook>\` · \`-logging webhook <type> <url>\`\n`;
    content += `**Types:** message · member · voice · server · moderation · automod · security · boost · commands · reactions · pins\n\n`;

    // Show active filter summary if any are set
    const filters = config.filters || {};
    const filterSummary = [];
    if (filters.ignoreBots) filterSummary.push('🤖 Bots ignored');
    if (filters.ignoredUsers?.length) filterSummary.push(`👤 ${filters.ignoredUsers.length} users ignored`);
    if (filters.ignoredChannels?.length) filterSummary.push(`📌 ${filters.ignoredChannels.length} channels ignored`);
    if (filters.ignoredRoles?.length) filterSummary.push(`🛡 ${filters.ignoredRoles.length} roles ignored`);
    if (filterSummary.length > 0) {
        content += `### <:Inforect:1521228008285929532> Active Filters\n${filterSummary.map(s => `> ${s}`).join('\n')}`;
    }

    return content;
}

function buildLoggingContainer(config, guild) {
    const trackedKeys = ['message', 'member', 'voice', 'server', 'moderation', 'automod', 'security', 'boost', 'commands', 'reactions', 'pins'];
    const configuredCount = trackedKeys.filter(k => config[k]).length;

    return new ContainerBuilder()
        .setAccentColor(configuredCount === trackedKeys.length ? 0x57F287 : configuredCount > 0 ? 0xFEE75C : 0xED4245)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(buildLoggingPanel(config, guild))
        )
;
}

module.exports = {
    description: 'Logging Setup',
    usage: 'logging-setup',
    category: 'admin',
    aliases: ['logs', 'logging-setup', 'log', 'setlogs'],
    data: new SlashCommandBuilder()
        .setName('logging')
        .setDescription('Configure server logging channels for comprehensive activity tracking')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand.setName('set-message').setDescription('Set channel for message logs (edits, deletions, reactions)')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel for message logs').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('set-member').setDescription('Set channel for member logs (joins, leaves, role changes)')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel for member logs').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('set-voice').setDescription('Set channel for voice logs (VC activity, streaming)')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel for voice logs').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('set-server').setDescription('Set channel for server logs (settings, channels, roles)')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel for server logs').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('set-moderation').setDescription('Set channel for moderation logs (warns, bans, kicks)')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel for moderation logs').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('set-automod').setDescription('Set channel for AutoMod filter logs')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel for AutoMod logs').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('set-security').setDescription('Set channel for Anti-Nuke / Anti-Raid / Vanity Guard / Threat-mode logs')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel for security logs').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('set-boost').setDescription('Set channel for boost / unboost logs')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel for boost logs').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('set-commands').setDescription('Set channel for slash / prefix command usage logs')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel for command usage logs').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('set-reactions').setDescription('Set channel for reaction add / remove logs')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel for reaction logs').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('set-pins').setDescription('Set channel for message pin / unpin logs')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel for pin logs').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('set-all').setDescription('Set all log types to a single channel')
                .addChannelOption(option =>
                    option.setName('channel').setDescription('The channel for all logs').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('view').setDescription('View current logging configuration and setup guide'))
        .addSubcommand(subcommand =>
            subcommand.setName('disable').setDescription('Disable a specific log type or all logging')
                .addStringOption(option =>
                    option.setName('type').setDescription('The log type to disable').setRequired(true)
                        .addChoices(
                            { name: 'Message Logs', value: 'message' },
                            { name: 'Member Logs', value: 'member' },
                            { name: 'Voice Logs', value: 'voice' },
                            { name: 'Server Logs', value: 'server' },
                            { name: 'Moderation Logs', value: 'moderation' },
                            { name: 'AutoMod Logs', value: 'automod' },
                            { name: 'Security Logs', value: 'security' },
                            { name: 'Boost Logs', value: 'boost' },
                            { name: 'Command Logs', value: 'commands' },
                            { name: 'Reaction Logs', value: 'reactions' },
                            { name: 'Pin Logs', value: 'pins' },
                            { name: 'All Logs', value: 'all' }
                        )))
        .addSubcommand(subcommand =>
            subcommand.setName('set-mode').setDescription('Set log delivery mode (bot message or webhook)')
                .addStringOption(option =>
                    option.setName('mode').setDescription('Delivery mode for log messages').setRequired(true)
                        .addChoices(
                            { name: 'Bot Message (default)', value: 'bot' },
                            { name: 'Webhook', value: 'webhook' }
                        )))
        .addSubcommand(subcommand =>
            subcommand.setName('set-webhook').setDescription('Set a webhook URL for a specific log type')
                .addStringOption(option =>
                    option.setName('type').setDescription('The log type to set webhook for').setRequired(true)
                        .addChoices(
                            { name: 'Message Logs', value: 'message' },
                            { name: 'Member Logs', value: 'member' },
                            { name: 'Voice Logs', value: 'voice' },
                            { name: 'Server Logs', value: 'server' },
                            { name: 'Moderation Logs', value: 'moderation' },
                            { name: 'AutoMod Logs', value: 'automod' },
                            { name: 'Security Logs', value: 'security' },
                            { name: 'Boost Logs', value: 'boost' },
                            { name: 'Command Logs', value: 'commands' },
                            { name: 'Reaction Logs', value: 'reactions' },
                            { name: 'Pin Logs', value: 'pins' },
                            { name: 'All Logs', value: 'all' }
                        ))
                .addStringOption(option =>
                    option.setName('url').setDescription('The webhook URL (from channel settings > Integrations > Webhooks)').setRequired(true)))
        // ─── Filter subcommand group: ignore users / channels / roles / bots ───
        .addSubcommandGroup(group =>
            group.setName('filter')
                .setDescription('Manage logging filters (ignore users, channels, roles, or bots)')
                .addSubcommand(sub =>
                    sub.setName('ignore-user')
                        .setDescription('Toggle a user on/off the logging ignore list')
                        .addUserOption(opt => opt.setName('user').setDescription('User to ignore in all log channels').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('ignore-channel')
                        .setDescription('Toggle a channel on/off the logging ignore list')
                        .addChannelOption(opt => opt.setName('channel').setDescription('Channel to ignore in all log channels').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('ignore-role')
                        .setDescription('Toggle a role on/off the logging ignore list (members holding it are skipped)')
                        .addRoleOption(opt => opt.setName('role').setDescription('Role to ignore').setRequired(true)))
                .addSubcommand(sub =>
                    sub.setName('ignore-bots')
                        .setDescription('Skip events caused by bots in member/voice/moderation logs')
                        .addStringOption(opt => opt.setName('mode').setDescription('on or off').setRequired(true)
                            .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })))
                .addSubcommand(sub =>
                    sub.setName('view')
                        .setDescription('View the current filter configuration'))
                .addSubcommand(sub =>
                    sub.setName('clear')
                        .setDescription('Remove all filters (logs everything again)'))),
    
    async execute(interaction) {
        try {
        const logs = loadLogs();
        const guildId = interaction.guild.id;
        
        if (!logs[guildId]) {
            logs[guildId] = {};
        }

        // Subcommand groups (e.g. `filter ignore-user`) report group via getSubcommandGroup;
        // route them before the flat subcommand switch to keep the existing code untouched.
        const group = interaction.options.getSubcommandGroup(false);
        if (group === 'filter') {
            return handleFilterSlash(interaction, logs, guildId);
        }

        const subcommand = interaction.options.getSubcommand();

        if (subcommand.startsWith('set-') && !['set-mode', 'set-webhook'].includes(subcommand)) {
            const channel = interaction.options.getChannel('channel');
            const type = subcommand.replace('set-', '');
            
            if (type === 'all') {
                for (const key of ALL_LOG_KEYS) logs[guildId][key] = channel.id;
                saveLogs(logs);
                invalidateCache();

                const lines = ALL_LOG_KEYS.map(k => `${logTypeNames[k].emoji} **${logTypeNames[k].name} Logs** — ${logTypeNames[k].desc}`).join('\n');
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Checkedbox:1521227734943269077> All Logging Channels Configured\n\n` +
                            `All ${ALL_LOG_KEYS.length} log types have been set to ${channel}\n\n` +
                            `### Logs Now Active\n${lines}\n\n` +
                            `*Use \`/logging view\` to see your full configuration*`
                        )
                    )
;
                await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } else {
                const info = logTypeNames[type];
                logs[guildId][type] = channel.id;
                saveLogs(logs);
                invalidateCache();
                
                const container = new ContainerBuilder()
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Checkedbox:1521227734943269077> ${info.name} Logs Configured\n\n` +
                            `**Channel:** ${channel}\n` +
                            `**Type:** ${info.emoji} ${info.name} Logs\n\n` +
                            `### What Will Be Logged\n` +
                            `This channel will now receive logs for ${info.desc}.\n\n` +
                            `*Use \`/logging view\` to see your full configuration*`
                        )
                    )
;
                await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

        } else if (subcommand === 'view') {
            const config = logs[guildId] || {};
            const container = buildLoggingContainer(config, interaction.guild);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } else if (subcommand === 'disable') {
            const type = interaction.options.getString('type');
            
            if (type === 'all') {
                delete logs[guildId];
                saveLogs(logs);
                
                const container = new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Toggleoff:1521227763816595559> All Logging Disabled\n\n` +
                            `All logging has been disabled for this server.\n\n` +
                            `No events will be logged until you configure logging channels again.\n\n` +
                            `*Use \`/logging set-all #channel\` to quickly re-enable all logging*`
                        )
                    )
;
                await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            } else {
                const info = logTypeNames[type];
                if (logs[guildId] && logs[guildId][type]) {
                    delete logs[guildId][type];
                    saveLogs(logs);
                    
                    const container = new ContainerBuilder()
                        .setAccentColor(0xED4245)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <:Toggleoff:1521227763816595559> ${info.name} Logging Disabled\n\n` +
                                `${info.emoji} **${info.name} Logs** have been disabled.\n\n` +
                                `Events related to ${info.desc} will no longer be logged.\n\n` +
                                `*Use \`/logging set-${type} #channel\` to re-enable*`
                            )
                        )
;
                    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                } else {
                    await interaction.reply({ 
                        content: `<:Cancel:1521227723916181644> ${info.name} logging is not currently enabled!`, 
                        flags: MessageFlags.Ephemeral 
                    });
                }
            }

        } else if (subcommand === 'set-mode') {
            const mode = interaction.options.getString('mode');
            logs[guildId].mode = mode;
            saveLogs(logs);
            invalidateCache();
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Log Delivery Mode Updated\n\n` +
                        `<:Lightning:1521227915537285150> **Mode:** ${mode === 'webhook' ? '<:Attach:1521228039135170722> Webhook' : '<:bots:1521227848101396610> Bot Message'}\n\n` +
                        (mode === 'webhook'
                            ? `Logs will be sent via webhooks. Make sure to set webhook URLs:\n\`/logging set-webhook <type> <url>\`\n\n`
                            : `Logs will be sent as bot messages in the configured channels.\n\n`) +
                        `*All log messages are always sent silently (no user pings)*`
                    )
                )
;
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });

        } else if (subcommand === 'set-webhook') {
            const type = interaction.options.getString('type');
            const url = interaction.options.getString('url');
            
            // Validate webhook URL format
            const webhookUrlRegex = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/.+$/;
            if (!webhookUrlRegex.test(url)) {
                return interaction.reply({
                    content: `<:Cancel:1521227723916181644> Invalid webhook URL! It should look like:\n\`https://discord.com/api/webhooks/123456789/abcdef...\`\n\nYou can create a webhook in **Channel Settings → Integrations → Webhooks**`,
                    flags: MessageFlags.Ephemeral
                });
            }
            
            if (!logs[guildId].webhooks) logs[guildId].webhooks = {};
            
            const allTypes = ALL_LOG_KEYS;
            if (type === 'all') {
                for (const t of allTypes) {
                    logs[guildId].webhooks[t] = url;
                }
            } else {
                logs[guildId].webhooks[type] = url;
            }
            saveLogs(logs);
            invalidateCache();
            
            const typeName = type === 'all' ? 'All Log Types' : logTypeNames[type].name + ' Logs';
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Webhook URL Configured\n\n` +
                        `<:Attach:1521228039135170722> **Type:** ${typeName}\n` +
                        `<:Lightning:1521227915537285150> **URL:** ||${url.substring(0, 50)}...||  *(hidden for security)*\n\n` +
                        (logs[guildId].mode !== 'webhook'
                            ? `<:Infotriangle:1521227710381428926> **Note:** Webhook mode is not active yet! Use \`/logging set-mode webhook\` to enable webhook delivery.\n\n`
                            : '') +
                        `*Use \`/logging view\` to see your full configuration*`
                    )
                )
;
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
        } catch (error) {
            console.error('[LoggingSetup] Error:', error);
            const { buildErrorResponse } = require('../../utils/responseBuilder');
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return message.reply('<:Cancel:1521227723916181644> You need **Administrator** permission to use this command!');
        }

        try {
        const logs = loadLogs();
        const guildId = message.guild.id;
        
        if (!logs[guildId]) {
            logs[guildId] = {};
        }

        const action = args[0]?.toLowerCase();
        const channel = message.mentions.channels.first();

        if (!action || action === 'view') {
            const config = logs[guildId] || {};
            const container = buildLoggingContainer(config, message.guild);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        // Filter management — mirrors the slash subcommand group.
        // Usage examples (case-insensitive):
        //   -logging filter ignore-user @user
        //   -logging filter ignore-channel #ch
        //   -logging filter ignore-bots on|off
        //   -logging filter view
        //   -logging filter clear
        if (action === 'filter') {
            const sub = args[1]?.toLowerCase();
            if (!logs[guildId].filters) logs[guildId].filters = {};
            const filters = logs[guildId].filters;

            const reply = (color, body) => {
                const container = new ContainerBuilder()
                    .setAccentColor(color)
                    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body))
;
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            };

            if (!sub || sub === 'view') {
                const f = filters;
                const userList = (f.ignoredUsers || []).slice(0, 20).map(id => `<@${id}> (\`${id}\`)`).join('\n') || '*None*';
                const chList = (f.ignoredChannels || []).slice(0, 20).map(id => `<#${id}> (\`${id}\`)`).join('\n') || '*None*';
                const roleList = (f.ignoredRoles || []).slice(0, 20).map(id => `<@&${id}> (\`${id}\`)`).join('\n') || '*None*';
                return reply(0xCAD7E6,
                    `# <:Inforect:1521228008285929532> Logging Filters\n\n` +
                    `<:bots:1521227848101396610> **Ignore Bots:** ${f.ignoreBots ? 'On' : 'Off'}\n\n` +
                    `### <:User:1521227714227343380> Ignored Users (${(f.ignoredUsers || []).length})\n${userList}\n\n` +
                    `### <:Folderblock:1521228044683968745> Ignored Channels (${(f.ignoredChannels || []).length})\n${chList}\n\n` +
                    `### <:Shield:1521227694677692467> Ignored Roles (${(f.ignoredRoles || []).length})\n${roleList}`
                );
            }

            if (sub === 'clear') {
                delete logs[guildId].filters;
                saveLogs(logs); invalidateCache();
                return reply(0xED4245, `# <:Toggleoff:1521227763816595559> All Filters Cleared\n\nLogs will record all events again.`);
            }

            if (sub === 'ignore-user') {
                const u = message.mentions.users.first();
                const targetId = u?.id || args[2];
                if (!targetId) return reply(0xED4245, `<:Cancel:1521227723916181644> Mention a user or pass a user ID. Usage: \`-logging filter ignore-user @user\``);
                const r = toggleInList(filters.ignoredUsers, targetId);
                filters.ignoredUsers = r.list;
                saveLogs(logs); invalidateCache();
                return reply(0xCAD7E6,
                    `# <:Checkedbox:1521227734943269077> Filter Updated\n\n` +
                    `<:User:1521227714227343380> <@${targetId}> (\`${targetId}\`) — **${r.action === 'added' ? 'Added to' : 'Removed from'}** the ignore list.\n\n` +
                    `Total ignored users: \`${filters.ignoredUsers.length}\``
                );
            }

            if (sub === 'ignore-channel') {
                const c = message.mentions.channels.first();
                const targetId = c?.id || args[2];
                if (!targetId) return reply(0xED4245, `<:Cancel:1521227723916181644> Mention a channel or pass a channel ID. Usage: \`-logging filter ignore-channel #channel\``);
                const r = toggleInList(filters.ignoredChannels, targetId);
                filters.ignoredChannels = r.list;
                saveLogs(logs); invalidateCache();
                return reply(0xCAD7E6,
                    `# <:Checkedbox:1521227734943269077> Filter Updated\n\n` +
                    `<:Pin:1521227932625014916> <#${targetId}> (\`${targetId}\`) — **${r.action === 'added' ? 'Added to' : 'Removed from'}** the ignore list.\n\n` +
                    `Total ignored channels: \`${filters.ignoredChannels.length}\``
                );
            }

            if (sub === 'ignore-role') {
                const role = message.mentions.roles.first();
                const targetId = role?.id || args[2];
                if (!targetId) return reply(0xED4245, `<:Cancel:1521227723916181644> Mention a role or pass a role ID. Usage: \`-logging filter ignore-role @role\``);
                const r = toggleInList(filters.ignoredRoles, targetId);
                filters.ignoredRoles = r.list;
                saveLogs(logs); invalidateCache();
                return reply(0xCAD7E6,
                    `# <:Checkedbox:1521227734943269077> Filter Updated\n\n` +
                    `<:Shield:1521227694677692467> <@&${targetId}> (\`${targetId}\`) — **${r.action === 'added' ? 'Added to' : 'Removed from'}** the ignore list.\n\n` +
                    `Total ignored roles: \`${filters.ignoredRoles.length}\``
                );
            }

            if (sub === 'ignore-bots') {
                const mode = args[2]?.toLowerCase();
                if (mode !== 'on' && mode !== 'off') {
                    return reply(0xED4245, `<:Cancel:1521227723916181644> Usage: \`-logging filter ignore-bots <on|off>\``);
                }
                filters.ignoreBots = mode === 'on';
                saveLogs(logs); invalidateCache();
                return reply(filters.ignoreBots ? 0x57F287 : 0xED4245,
                    `# <:Checkedbox:1521227734943269077> Bot Filter ${filters.ignoreBots ? 'Enabled' : 'Disabled'}\n\n` +
                    (filters.ignoreBots
                        ? `<:bots:1521227848101396610> Bot-authored events will no longer appear in logs.`
                        : `<:bots:1521227848101396610> Bot-authored events will appear in logs again.`)
                );
            }

            return reply(0xED4245,
                `<:Cancel:1521227723916181644> Unknown filter subcommand. Use:\n` +
                `\`-logging filter ignore-user @user\`\n` +
                `\`-logging filter ignore-channel #channel\`\n` +
                `\`-logging filter ignore-role @role\`\n` +
                `\`-logging filter ignore-bots <on|off>\`\n` +
                `\`-logging filter view\`\n` +
                `\`-logging filter clear\``
            );
        }

        if (action === 'disable') {
            const type = args[1]?.toLowerCase();
            if (!type) {
                return message.reply(`<:Cancel:1521227723916181644> Please specify a log type to disable: ${ALL_LOG_KEYS.map(k => '\`' + k + '\`').join(', ')}, or \`all\``);
            }
            
            if (type === 'all') {
                delete logs[guildId];
                saveLogs(logs);
                invalidateCache();
                
                const container = new ContainerBuilder()
                    .setAccentColor(0xED4245)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `# <:Toggleoff:1521227763816595559> All Logging Disabled\n\n` +
                            `All logging has been disabled for this server.`
                        )
                    )
;
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            
            if (logTypeNames[type]) {
                if (logs[guildId] && logs[guildId][type]) {
                    delete logs[guildId][type];
                    saveLogs(logs);
                    invalidateCache();
                    
                    const container = new ContainerBuilder()
                        .setAccentColor(0xED4245)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(
                                `# <:Toggleoff:1521227763816595559> ${logTypeNames[type].name} Logging Disabled`
                            )
                        )
;
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                } else {
                    return message.reply(`<:Cancel:1521227723916181644> ${logTypeNames[type].name} logging is not currently enabled!`);
                }
            } else {
                return message.reply(`<:Cancel:1521227723916181644> Invalid log type! Use: ${ALL_LOG_KEYS.map(k => '\`' + k + '\`').join(', ')}, or \`all\``);
            }
        }

        if (action === 'mode') {
            const mode = args[1]?.toLowerCase();
            if (!mode || !['bot', 'webhook'].includes(mode)) {
                return message.reply('<:Cancel:1521227723916181644> Please specify a mode: `bot` or `webhook`\nExample: `-logging mode webhook`');
            }
            logs[guildId].mode = mode;
            saveLogs(logs);
            invalidateCache();
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Log Delivery Mode Updated\n\n` +
                        `<:Lightning:1521227915537285150> **Mode:** ${mode === 'webhook' ? '<:Attach:1521228039135170722> Webhook' : '<:bots:1521227848101396610> Bot Message'}\n\n` +
                        (mode === 'webhook'
                            ? `Logs will be sent via webhooks. Set webhook URLs:\n\`-logging webhook <type> <url>\`\n\n`
                            : `Logs will be sent as bot messages in the configured channels.\n\n`) +
                        `*All log messages are always sent silently (no user pings)*`
                    )
                )
;
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (action === 'webhook') {
            const type = args[1]?.toLowerCase();
            const url = args[2];
            
            if (!type || !url) {
                return message.reply(`<:Cancel:1521227723916181644> Usage: \`-logging webhook <type> <url>\`\nTypes: ${ALL_LOG_KEYS.map(k => '\`' + k + '\`').join(', ')}, or \`all\``);
            }
            
            const allTypes = ALL_LOG_KEYS;
            if (type !== 'all' && !allTypes.includes(type)) {
                return message.reply(`<:Cancel:1521227723916181644> Invalid log type! Use: ${ALL_LOG_KEYS.map(k => '`' + k + '`').join(', ')}, or \`all\``);
            }
            
            const webhookUrlRegex = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/.+$/;
            if (!webhookUrlRegex.test(url)) {
                return message.reply('<:Cancel:1521227723916181644> Invalid webhook URL! It should look like:\n`https://discord.com/api/webhooks/123456789/abcdef...`\n\nCreate a webhook in **Channel Settings → Integrations → Webhooks**');
            }
            
            if (!logs[guildId].webhooks) logs[guildId].webhooks = {};
            
            if (type === 'all') {
                for (const t of allTypes) {
                    logs[guildId].webhooks[t] = url;
                }
            } else {
                logs[guildId].webhooks[type] = url;
            }
            saveLogs(logs);
            invalidateCache();
            
            const typeName = type === 'all' ? 'All Log Types' : logTypeNames[type].name + ' Logs';
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> Webhook URL Configured\n\n` +
                        `<:Attach:1521228039135170722> **Type:** ${typeName}\n` +
                        `<:Lightning:1521227915537285150> **URL:** ||${url.substring(0, 50)}...||  *(hidden for security)*\n\n` +
                        (logs[guildId].mode !== 'webhook'
                            ? `<:Infotriangle:1521227710381428926> **Note:** Webhook mode is not active! Use \`-logging mode webhook\` to enable.\n\n`
                            : '') +
                        `*Use \`-logging view\` to see your full configuration*`
                    )
                )
;
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (!channel) {
            return message.reply('<:Cancel:1521227723916181644> Please mention a channel! Example: `-logging message #logs`');
        }

        if (action === 'all') {
            for (const key of ALL_LOG_KEYS) logs[guildId][key] = channel.id;
            saveLogs(logs);
            invalidateCache();
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> All Logging Channels Configured\n\n` +
                        `All ${ALL_LOG_KEYS.length} log types have been set to ${channel}`
                    )
                )
;
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        if (logTypeNames[action]) {
            logs[guildId][action] = channel.id;
            saveLogs(logs);
            invalidateCache();
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Checkedbox:1521227734943269077> ${logTypeNames[action].name} Logs Configured\n\n` +
                        `**Channel:** ${channel}\n` +
                        `**Type:** ${logTypeNames[action].emoji} ${logTypeNames[action].name} Logs`
                    )
                )
;
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        return message.reply('<:Cancel:1521227723916181644> Invalid usage! Use:\n`-logging <type> #channel` — Set log channel\n`-logging mode <bot|webhook>` — Set delivery mode\n`-logging webhook <type> <url>` — Set webhook URL\n`-logging disable <type>` — Disable a log type\n`-logging filter ignore-user @user` — Manage filters');
        } catch (error) {
            console.error('[LoggingSetup] Error:', error);
            const { buildErrorResponse } = require('../../utils/responseBuilder');
            const container = buildErrorResponse('Error', 'An error occurred while executing this command.', error.message);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
