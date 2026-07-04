const { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../../utils/database');
const { COLORS } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');
const lui = require('../../utils/levelingUI');

/**
 * Build the paginated payload for the "list" subcommand. Combines
 * ignored channels and roles into one numbered, sectioned list so we
 * stay under the 4 000-char container cap on busy servers, while
 * keeping the existing two-section layout intact at small sizes.
 */
function buildIgnoreListResult(guild, ignoreChannels, ignoreRoles) {
    const E = {
        block:  '<:Commentblock:1521227898101432331>',
        chan:   '<:Folderblock:1521228044683968745>',
        role:   '<:Userplus:1521227719621218477>',
        caret:  '<:Caretright:1521227704953864202>',
        none:   '<:Cancel:1521227723916181644>' };

    const channelLines = ignoreChannels.length > 0
        ? ignoreChannels.map((id, i) => {
            const ch = guild.channels.cache.get(id);
            const label = ch ? `${ch}` : `~~<#${id}>~~ \`(deleted)\``;
            return `${E.caret} \`${String(i + 1).padStart(2, '0')}.\` ${label}`;
        })
        : [`${E.none} *No ignored channels*`];

    const roleLines = ignoreRoles.length > 0
        ? ignoreRoles.map((id, i) => {
            const role = guild.roles.cache.get(id);
            const label = role ? `<@&${id}>` : `~~<@&${id}>~~ \`(deleted)\``;
            return `${E.caret} \`${String(i + 1).padStart(2, '0')}.\` ${label}`;
        })
        : [`${E.none} *No ignored roles*`];

    const lines = [
        `### ${E.chan} Ignored Channels (${ignoreChannels.length})`,
        ...channelLines,
        '',
        `### ${E.role} Ignored Roles (${ignoreRoles.length})`,
        ...roleLines,
    ];

    return paginate({
        header:
            `# ${E.block} Leveling · Ignore List\n` +
            `-# Members do not gain XP in these channels or with these roles.`,
        lines,
        perPage:     20,
        accentColor: COLORS.WARNING });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leveling-ignore')
        .setDescription('Configure ignored channels/roles for leveling')
        .addSubcommand(sub => sub.setName('add-channel').setDescription('Ignore a channel')
            .addChannelOption(o => o.setName('channel').setDescription('Channel to ignore').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove-channel').setDescription('Un-ignore a channel')
            .addChannelOption(o => o.setName('channel').setDescription('Channel to remove').setRequired(true)))
        .addSubcommand(sub => sub.setName('add-role').setDescription('Ignore a role')
            .addRoleOption(o => o.setName('role').setDescription('Role to ignore').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove-role').setDescription('Un-ignore a role')
            .addRoleOption(o => o.setName('role').setDescription('Role to remove').setRequired(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('View all ignored channels and roles')),
    name: 'leveling-ignore',
    prefix: 'leveling-ignore',
    description: 'Configure ignored channels and roles for leveling (prefix-only)',
    usage: 'leveling-ignore <add-channel|remove-channel|add-role|remove-role|list> [target]',
    category: 'leveling',
    aliases: ['lvlignore', 'levelignore'],

    async execute(interaction) {
        const gid = interaction.guild.id;
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ ...lui.payload(lui.permError(gid)), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        const subcommand = interaction.options.getSubcommand();
        const guildConfig = await getGuildConfig(gid);

        if (subcommand === 'add-channel') {
            const channel = interaction.options.getChannel('channel');
            const ignoreChannels = guildConfig.leveling?.ignoreChannels || [];

            if (ignoreChannels.includes(channel.id)) {
                return interaction.reply({ ...lui.payload(lui.warn(gid, 'Already Ignored', `${channel} is already in the ignore list.`)), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            ignoreChannels.push(channel.id);
            await updateGuildConfig(gid, { 'leveling.ignoreChannels': ignoreChannels });

            return interaction.reply(lui.payload(lui.ok(gid, 'Channel Added to Ignore List', `Users will not gain XP in ${channel}.`, { Channel: `${channel}` })));
        }

        if (subcommand === 'remove-channel') {
            const channel = interaction.options.getChannel('channel');
            let ignoreChannels = guildConfig.leveling?.ignoreChannels || [];

            if (!ignoreChannels.includes(channel.id)) {
                return interaction.reply({ ...lui.payload(lui.warn(gid, 'Not Ignored', `${channel} is not in the ignore list.`)), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            ignoreChannels = ignoreChannels.filter(id => id !== channel.id);
            await updateGuildConfig(gid, { 'leveling.ignoreChannels': ignoreChannels });

            return interaction.reply(lui.payload(lui.ok(gid, 'Channel Removed from Ignore List', `Users can now gain XP in ${channel}.`, { Channel: `${channel}` }, { emoji: lui.E.trash })));
        }

        if (subcommand === 'add-role') {
            const role = interaction.options.getRole('role');
            const ignoreRoles = guildConfig.leveling?.ignoreRoles || [];

            if (ignoreRoles.includes(role.id)) {
                return interaction.reply({ ...lui.payload(lui.warn(gid, 'Already Ignored', `${role} is already in the ignore list.`)), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            ignoreRoles.push(role.id);
            await updateGuildConfig(gid, { 'leveling.ignoreRoles': ignoreRoles });

            return interaction.reply(lui.payload(lui.ok(gid, 'Role Added to Ignore List', `Users with ${role} will not gain XP.`, { Role: `${role}` })));
        }

        if (subcommand === 'remove-role') {
            const role = interaction.options.getRole('role');
            let ignoreRoles = guildConfig.leveling?.ignoreRoles || [];

            if (!ignoreRoles.includes(role.id)) {
                return interaction.reply({ ...lui.payload(lui.warn(gid, 'Not Ignored', `${role} is not in the ignore list.`)), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }

            ignoreRoles = ignoreRoles.filter(id => id !== role.id);
            await updateGuildConfig(gid, { 'leveling.ignoreRoles': ignoreRoles });

            return interaction.reply(lui.payload(lui.ok(gid, 'Role Removed from Ignore List', `Users with ${role} can now gain XP.`, { Role: `${role}` }, { emoji: lui.E.trash })));
        }

        if (subcommand === 'list') {
            const ignoreChannels = guildConfig.leveling?.ignoreChannels || [];
            const ignoreRoles    = guildConfig.leveling?.ignoreRoles    || [];

            const result = buildIgnoreListResult(interaction.guild, ignoreChannels, ignoreRoles);
            const reply  = await interaction.reply({ ...result, fetchReply: true });
            setupPaginationCollector(reply, result._pageData, interaction.user.id);
            return;
        }
    },

    async executePrefix(message, args) {
        const gid = message.guild.id;
        const perr = lui.requirePerm(message.member, gid);
        if (perr) return message.reply(lui.payload(perr));

        const guildConfig = await getGuildConfig(gid);
        const ignoreChannels = guildConfig.leveling?.ignoreChannels || [];
        const ignoreRoles    = guildConfig.leveling?.ignoreRoles    || [];

        const result = buildIgnoreListResult(message.guild, ignoreChannels, ignoreRoles);
        const reply  = await message.reply(result);
        setupPaginationCollector(reply, result._pageData, message.author.id);
    }
};
