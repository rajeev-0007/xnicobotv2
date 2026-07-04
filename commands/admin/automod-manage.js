const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    MessageFlags
} = require('discord.js');
const { loadConfig, saveConfig, getGuildConfig, getDefaultConfig } = require('../../utils/panels/automodPanel');
const { syncToDiscord } = require('../../utils/automodSync');
const { THEME, formatCheck, createFooterText } = require('../../utils/theme');
const {  EMOJIS, COLORS, buildErrorResponse } = require('../../utils/responseBuilder');

const VALID_FILTERS = ['badwords', 'spam', 'links', 'invites', 'massmention', 'caps'];
const FILTER_MAP = {
    badwords: 'badWords',
    spam: 'spam',
    links: 'links',
    invites: 'invites',
    massmention: 'massMention',
    caps: 'caps'
};
const VALID_ACTIONS = ['delete', 'timeout', 'kick', 'ban', 'warn'];

function buildOk(title, desc) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${EMOJIS.SUCCESS} ${title}\n\n${desc}`))
;
}

function buildErr(title, desc) {
    return new ContainerBuilder()
        .setAccentColor(COLORS.ERROR)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${EMOJIS.ERROR} ${title}\n\n${desc}`));
}

function buildConfigDisplay(guildConfig) {
    const activeCount = [
        guildConfig.badWords?.enabled,
        guildConfig.spam?.enabled,
        guildConfig.links?.enabled,
        guildConfig.invites?.enabled,
        guildConfig.massMention?.enabled,
        guildConfig.caps?.enabled,
        guildConfig.profanity?.enabled,
        guildConfig.sexualContent?.enabled,
        guildConfig.slurs?.enabled
    ].filter(Boolean).length;

    const logChannel = guildConfig.logChannel ? `<#${guildConfig.logChannel}>` : '`Not Set`';
    const bypassRole = guildConfig.bypassRoleId ? `<@&${guildConfig.bypassRoleId}>` : '`None`';
    const ignoredRoles = guildConfig.ignoredRoles?.length || 0;
    const ignoredChannels = guildConfig.ignoredChannels?.length || 0;

    const statusText = guildConfig.enabled
        ? `${THEME.EMOJIS.SUCCESS} **System Active**`
        : `${THEME.EMOJIS.OFFLINE} **System Inactive**`;

    const filtersGrid =
        `${formatCheck(guildConfig.badWords?.enabled)} **Bad Words** — \`${guildConfig.badWords?.words?.length || 0} words\` → \`${guildConfig.badWords?.action || 'delete'}\`\n` +
        `${formatCheck(guildConfig.spam?.enabled)} **Anti-Spam** → \`${guildConfig.spam?.action || 'timeout'}\`\n` +
        `${formatCheck(guildConfig.links?.enabled)} **Link Filter** → \`${guildConfig.links?.action || 'delete'}\`\n` +
        `${formatCheck(guildConfig.invites?.enabled)} **Invite Blocker** → \`${guildConfig.invites?.action || 'delete'}\`\n` +
        `${formatCheck(guildConfig.massMention?.enabled)} **Mass Mentions** — \`${guildConfig.massMention?.limit || 5}+ mentions\` → \`${guildConfig.massMention?.action || 'delete'}\`\n` +
        `${formatCheck(guildConfig.caps?.enabled)} **Caps Lock** — \`${guildConfig.caps?.percentage || 70}%+\` → \`${guildConfig.caps?.action || 'delete'}\``;

    const settingsText =
        `<:Caretright:1521227704953864202> **Active Filters:** \`${activeCount}/9\`\n` +
        `<:Caretright:1521227704953864202> **Bypass Role:** ${bypassRole}\n` +
        `<:Caretright:1521227704953864202> **Log Channel:** ${logChannel}\n` +
        `<:Caretright:1521227704953864202> **Ignored Roles:** \`${ignoredRoles}\`\n` +
        `<:Caretright:1521227704953864202> **Ignored Channels:** \`${ignoredChannels}\``;

    return new ContainerBuilder()
        .setAccentColor(guildConfig.enabled ? 0x57F287 : 0xED4245)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${THEME.EMOJIS.SHIELD} AutoMod Configuration`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${THEME.EMOJIS.SHIELD} Filters\n${filtersGrid}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${THEME.EMOJIS.SETTINGS} Settings\n${settingsText}`))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(createFooterText()))
;
}

function buildIgnoreShowDisplay(guildConfig) {
    const ignoredRoles = guildConfig.ignoredRoles || [];
    const ignoredChannels = guildConfig.ignoredChannels || [];

    let content = `# ${THEME.EMOJIS.SHIELD} AutoMod Ignore List\n\n`;
    content += `### Ignored Channels (${ignoredChannels.length})\n`;
    if (ignoredChannels.length === 0) {
        content += '*No ignored channels*\n';
    } else {
        for (const id of ignoredChannels) content += `> <#${id}>\n`;
    }
    content += `\n### Ignored Roles (${ignoredRoles.length})\n`;
    if (ignoredRoles.length === 0) {
        content += '*No ignored roles*\n';
    } else {
        for (const id of ignoredRoles) content += `> <@&${id}>\n`;
    }

    return new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
;
}

async function handleSubcommand(sub, options, guild) {
    const guildId = guild.id;
    const config = loadConfig();
    if (!config[guildId]) config[guildId] = getDefaultConfig();
    const guildConfig = getGuildConfig(guildId);

    if (sub === 'enable') {
        config[guildId] = { ...config[guildId], enabled: true };
        saveConfig(config, guildId);
        const updatedConfig = getGuildConfig(guildId);
        await syncToDiscord(guild, updatedConfig);
        return buildOk('AutoMod Enabled', 'The automod system is now **active**. All enabled filters are enforced.');
    }

    if (sub === 'disable') {
        config[guildId] = { ...config[guildId], enabled: false };
        saveConfig(config, guildId);
        const updatedConfig = getGuildConfig(guildId);
        await syncToDiscord(guild, updatedConfig);
        return buildOk('AutoMod Disabled', 'The automod system has been **deactivated**.');
    }

    if (sub === 'punishment') {
        const filter = options.filter?.toLowerCase();
        const action = options.action?.toLowerCase();

        if (!filter || !VALID_FILTERS.includes(filter)) {
            return buildErr('Invalid Filter', `Valid filters: ${VALID_FILTERS.map(f => `\`${f}\``).join(', ')}\n\n**Usage:** \`automod-manage punishment <filter> <action>\``);
        }
        if (!action || !VALID_ACTIONS.includes(action)) {
            return buildErr('Invalid Action', `Valid actions: ${VALID_ACTIONS.map(a => `\`${a}\``).join(', ')}\n\n**Usage:** \`automod-manage punishment <filter> <action>\``);
        }

        const configKey = FILTER_MAP[filter];
        if (!config[guildId][configKey]) config[guildId][configKey] = {};
        config[guildId][configKey].action = action;
        saveConfig(config, guildId);
        const updatedConfig = getGuildConfig(guildId);
        await syncToDiscord(guild, updatedConfig);
        return buildOk('Punishment Updated', `**${filter}** filter action set to **${action}**.`);
    }

    if (sub === 'config') {
        return buildConfigDisplay(guildConfig);
    }

    if (sub === 'logging') {
        const channelId = options.channelId;
        if (!channelId) {
            config[guildId].logChannel = null;
            saveConfig(config, guildId);
            const updatedConfig = getGuildConfig(guildId);
            await syncToDiscord(guild, updatedConfig);
            return buildOk('Log Channel Cleared', 'AutoMod logging has been disabled.');
        }
        const channel = guild.channels.cache.get(channelId);
        if (channel && !channel.isTextBased()) {
            return buildErr('Invalid Channel', 'Please provide a text-based channel for logging.');
        }
        config[guildId].logChannel = channelId;
        saveConfig(config, guildId);
        const updatedConfig = getGuildConfig(guildId);
        await syncToDiscord(guild, updatedConfig);
        return buildOk('Log Channel Set', `AutoMod events will be logged in <#${channelId}>.`);
    }

    if (sub === 'ignore-channel') {
        const channelId = options.channelId;
        if (!channelId) return buildErr('Missing Channel', 'Please mention a channel to ignore.');
        if (!config[guildId].ignoredChannels) config[guildId].ignoredChannels = [];
        if (config[guildId].ignoredChannels.includes(channelId)) {
            return buildErr('Already Ignored', `<#${channelId}> is already in the ignore list.`);
        }
        config[guildId].ignoredChannels.push(channelId);
        saveConfig(config, guildId);
        const updatedConfig = getGuildConfig(guildId);
        await syncToDiscord(guild, updatedConfig);
        return buildOk('Channel Ignored', `<#${channelId}> will now be ignored by automod.`);
    }

    if (sub === 'ignore-role') {
        const roleId = options.roleId;
        if (!roleId) return buildErr('Missing Role', 'Please mention a role to ignore.');
        if (!config[guildId].ignoredRoles) config[guildId].ignoredRoles = [];
        if (config[guildId].ignoredRoles.includes(roleId)) {
            return buildErr('Already Ignored', `<@&${roleId}> is already in the ignore list.`);
        }
        config[guildId].ignoredRoles.push(roleId);
        saveConfig(config, guildId);
        const updatedConfig = getGuildConfig(guildId);
        await syncToDiscord(guild, updatedConfig);
        return buildOk('Role Ignored', `<@&${roleId}> will now be ignored by automod.`);
    }

    if (sub === 'ignore-show') {
        return buildIgnoreShowDisplay(guildConfig);
    }

    if (sub === 'ignore-reset') {
        config[guildId].ignoredRoles = [];
        config[guildId].ignoredChannels = [];
        saveConfig(config, guildId);
        const updatedConfig = getGuildConfig(guildId);
        await syncToDiscord(guild, updatedConfig);
        return buildOk('Ignore List Cleared', 'All ignored channels and roles have been removed.');
    }

    if (sub === 'unignore-channel') {
        const channelId = options.channelId;
        if (!channelId) return buildErr('Missing Channel', 'Please mention a channel to unignore.');
        if (!config[guildId].ignoredChannels || !config[guildId].ignoredChannels.includes(channelId)) {
            return buildErr('Not Ignored', `<#${channelId}> is not in the ignore list.`);
        }
        config[guildId].ignoredChannels = config[guildId].ignoredChannels.filter(id => id !== channelId);
        saveConfig(config, guildId);
        const updatedConfig = getGuildConfig(guildId);
        await syncToDiscord(guild, updatedConfig);
        return buildOk('Channel Unignored', `<#${channelId}> will now be subject to automod.`);
    }

    if (sub === 'unignore-role') {
        const roleId = options.roleId;
        if (!roleId) return buildErr('Missing Role', 'Please mention a role to unignore.');
        if (!config[guildId].ignoredRoles || !config[guildId].ignoredRoles.includes(roleId)) {
            return buildErr('Not Ignored', `<@&${roleId}> is not in the ignore list.`);
        }
        config[guildId].ignoredRoles = config[guildId].ignoredRoles.filter(id => id !== roleId);
        saveConfig(config, guildId);
        const updatedConfig = getGuildConfig(guildId);
        await syncToDiscord(guild, updatedConfig);
        return buildOk('Role Unignored', `<@&${roleId}> will now be subject to automod.`);
    }

    return buildErr('Unknown Subcommand', 'Use `/automod-manage` to see available subcommands.');
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('automod-manage')
        .setDescription('Manage automod settings directly')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub.setName('enable').setDescription('Enable the automod system'))
        .addSubcommand(sub => sub.setName('disable').setDescription('Disable the automod system'))
        .addSubcommand(sub => sub.setName('punishment').setDescription('Set punishment for a filter')
            .addStringOption(opt => opt.setName('filter').setDescription('Filter name').setRequired(true)
                .addChoices(
                    { name: 'Bad Words', value: 'badwords' },
                    { name: 'Spam', value: 'spam' },
                    { name: 'Links', value: 'links' },
                    { name: 'Invites', value: 'invites' },
                    { name: 'Mass Mention', value: 'massmention' },
                    { name: 'Caps', value: 'caps' }
                ))
            .addStringOption(opt => opt.setName('action').setDescription('Action to take').setRequired(true)
                .addChoices(
                    { name: 'Delete', value: 'delete' },
                    { name: 'Timeout', value: 'timeout' },
                    { name: 'Kick', value: 'kick' },
                    { name: 'Ban', value: 'ban' },
                    { name: 'Warn', value: 'warn' }
                )))
        .addSubcommand(sub => sub.setName('config').setDescription('Show current automod configuration'))
        .addSubcommand(sub => sub.setName('logging').setDescription('Set or clear the automod log channel')
            .addChannelOption(opt => opt.setName('channel').setDescription('Log channel (leave empty to clear)').setRequired(false)))
        .addSubcommandGroup(group => group.setName('ignore').setDescription('Manage ignored channels and roles')
            .addSubcommand(sub => sub.setName('channel').setDescription('Ignore a channel')
                .addChannelOption(opt => opt.setName('channel').setDescription('Channel to ignore').setRequired(true)))
            .addSubcommand(sub => sub.setName('role').setDescription('Ignore a role')
                .addRoleOption(opt => opt.setName('role').setDescription('Role to ignore').setRequired(true)))
            .addSubcommand(sub => sub.setName('show').setDescription('Show all ignored channels and roles'))
            .addSubcommand(sub => sub.setName('reset').setDescription('Clear all ignored channels and roles')))
        .addSubcommandGroup(group => group.setName('unignore').setDescription('Remove channels and roles from ignore list')
            .addSubcommand(sub => sub.setName('channel').setDescription('Unignore a channel')
                .addChannelOption(opt => opt.setName('channel').setDescription('Channel to unignore').setRequired(true)))
            .addSubcommand(sub => sub.setName('role').setDescription('Unignore a role')
                .addRoleOption(opt => opt.setName('role').setDescription('Role to unignore').setRequired(true)))),

    prefix: 'automod-manage',
    description: 'Manage automod settings directly',
    usage: 'automod-manage <enable|disable|punishment|config|logging|ignore|unignore> [args]',
    category: 'admin',
    aliases: ['am'],

    async execute(interaction) {
        const group = interaction.options.getSubcommandGroup(false);
        const sub = interaction.options.getSubcommand();

        let mappedSub;
        if (group === 'ignore') {
            mappedSub = `ignore-${sub}`;
        } else if (group === 'unignore') {
            mappedSub = `unignore-${sub}`;
        } else {
            mappedSub = sub;
        }

        const options = {};
        if (mappedSub === 'punishment') {
            options.filter = interaction.options.getString('filter');
            options.action = interaction.options.getString('action');
        } else if (mappedSub === 'logging') {
            const ch = interaction.options.getChannel('channel');
            options.channelId = ch?.id || null;
        } else if (mappedSub === 'ignore-channel' || mappedSub === 'unignore-channel') {
            options.channelId = interaction.options.getChannel('channel')?.id;
        } else if (mappedSub === 'ignore-role' || mappedSub === 'unignore-role') {
            options.roleId = interaction.options.getRole('role')?.id;
        }

        const container = await handleSubcommand(mappedSub, options, interaction.guild);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
            return message.reply({ components: [buildErr('Permission Denied', 'You need **Manage Server** permission.')], flags: MessageFlags.IsComponentsV2 });
        }

        const sub = args[0]?.toLowerCase();
        if (!sub) {
            return message.reply({ components: [buildErr('Missing Subcommand', 'Available: `enable`, `disable`, `punishment`, `config`, `logging`, `ignore`, `unignore`')], flags: MessageFlags.IsComponentsV2 });
        }

        const options = {};
        let mappedSub = sub;

        if (sub === 'enable' || sub === 'disable' || sub === 'config') {
            mappedSub = sub;
        } else if (sub === 'punishment') {
            options.filter = args[1]?.toLowerCase();
            options.action = args[2]?.toLowerCase();
        } else if (sub === 'logging') {
            const channel = message.mentions.channels.first();
            options.channelId = channel?.id || null;
        } else if (sub === 'ignore') {
            const subSub = args[1]?.toLowerCase();
            if (subSub === 'channel') {
                mappedSub = 'ignore-channel';
                const channel = message.mentions.channels.first();
                options.channelId = channel?.id;
            } else if (subSub === 'role') {
                mappedSub = 'ignore-role';
                const role = message.mentions.roles.first();
                options.roleId = role?.id;
            } else if (subSub === 'show') {
                mappedSub = 'ignore-show';
            } else if (subSub === 'reset') {
                mappedSub = 'ignore-reset';
            } else {
                return message.reply({ components: [buildErr('Invalid Ignore Subcommand', 'Usage: `ignore channel #channel`, `ignore role @role`, `ignore show`, `ignore reset`')], flags: MessageFlags.IsComponentsV2 });
            }
        } else if (sub === 'unignore') {
            const subSub = args[1]?.toLowerCase();
            if (subSub === 'channel') {
                mappedSub = 'unignore-channel';
                const channel = message.mentions.channels.first();
                options.channelId = channel?.id;
            } else if (subSub === 'role') {
                mappedSub = 'unignore-role';
                const role = message.mentions.roles.first();
                options.roleId = role?.id;
            } else {
                return message.reply({ components: [buildErr('Invalid Unignore Subcommand', 'Usage: `unignore channel #channel`, `unignore role @role`')], flags: MessageFlags.IsComponentsV2 });
            }
        } else {
            return message.reply({ components: [buildErr('Unknown Subcommand', 'Available: `enable`, `disable`, `punishment`, `config`, `logging`, `ignore`, `unignore`')], flags: MessageFlags.IsComponentsV2 });
        }

        const container = await handleSubcommand(mappedSub, options, message.guild);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
