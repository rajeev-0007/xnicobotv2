'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
    SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const { buildErrorResponse, buildRoleNotFound } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');

function bool(yes) {
    return yes ? '<:Checkedbox:1521227734943269077> Yes' : '<:Cancel:1521227723916181644> No';
}

function buildOverview(role) {
    const created = Math.floor(role.createdTimestamp / 1000);
    const totalPerms = role.permissions.toArray().length;

    const meta =
        `### <:Invoice:1521227903956811836> Role Overview\n` +
        `<:Caretright:1521227704953864202> **Name:** ${role}\n` +
        `<:Caretright:1521227704953864202> **ID:** \`${role.id}\`\n` +
        `<:Caretright:1521227704953864202> **Color:** \`${role.hexColor.toUpperCase()}\`\n` +
        `<:Caretright:1521227704953864202> **Position:** \`#${role.position}\`\n` +
        `<:Caretright:1521227704953864202> **Members:** \`${role.members.size}\`\n` +
        `<:Caretright:1521227704953864202> **Permissions:** \`${totalPerms}\``;

    const settings =
        `### <:Settings:1521227767780343879> Settings\n` +
        `<:Caretright:1521227704953864202> **Mentionable:** ${bool(role.mentionable)}\n` +
        `<:Caretright:1521227704953864202> **Hoisted:** ${bool(role.hoist)}\n` +
        `<:Caretright:1521227704953864202> **Managed:** ${role.managed ? '<:bots:1521227848101396610> Bot/Integration' : '<:Cancel:1521227723916181644> No'}\n` +
        `<:Caretright:1521227704953864202> **Created:** <t:${created}:F> (<t:${created}:R>)`;

    const previewPerms = role.permissions.toArray().slice(0, 6);
    const previewBlock = previewPerms.length > 0
        ? `### <:Key:1521228000467878111> Permission Preview\n` +
          previewPerms.map(p => `> \`${p}\``).join('\n') +
          (totalPerms > previewPerms.length ? `\n> *…and ${totalPerms - previewPerms.length} more — run \`roleinfo @${role.name} perms\` to browse all.*` : '')
        : `### <:Key:1521228000467878111> Permission Preview\n*This role has no permissions.*`;

    return new ContainerBuilder()
        .setAccentColor(role.color || 0xCAD7E6)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Userplus:1521227719621218477> ${role.name}`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(meta))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(settings))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(previewBlock))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

function buildPermsPages(role) {
    const perms = role.permissions.toArray().sort();
    const lines = perms.map((p, i) =>
        `\`${String(i + 1).padStart(2, '0')}.\` <:Checkedbox:1521227734943269077> \`${p}\``
    );
    return paginate({
        header:
            `# <:Key:1521228000467878111> Permissions for ${role.name}\n` +
            `-# **${perms.length}** permission${perms.length === 1 ? '' : 's'} granted to this role`,
        lines,
        perPage: 15,
        accentColor: role.color || 0xCAD7E6 });
}

function resolveRole(message, args) {
    if (args.length === 0) return null;
    const mention = message.mentions.roles.first();
    if (mention) return mention;
    const guess = args.join(' ').trim();
    if (/^\d{17,19}$/.test(guess)) return message.guild.roles.cache.get(guess) || null;
    return message.guild.roles.cache.find(r =>
        r.name.toLowerCase() === guess.toLowerCase()
        || r.name.toLowerCase().includes(guess.toLowerCase())
    ) || null;
}

module.exports = {
    prefix: 'roleinfo',
    description: 'View detailed information about a role',
    usage: 'roleinfo <@role | name | id> [perms]',
    category: 'basic',
    data: new SlashCommandBuilder()
        .setName('roleinfo')
        .setDescription('View detailed information about a role')
        .addRoleOption(option =>
            option.setName('role')
                .setDescription('The role to inspect')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('perms')
                .setDescription('Browse the full permission list with pagination')
                .setRequired(false)),

    async execute(interaction) {
        try {
            const role = interaction.options.getRole('role');
            const perms = interaction.options.getBoolean('perms');
            if (perms) {
                const result = buildPermsPages(role);
                const reply = await interaction.reply({ ...result, fetchReply: true });
                setupPaginationCollector(reply, result._pageData, interaction.user.id);
                return;
            }
            await interaction.reply({ components: [buildOverview(role)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[ROLEINFO] Slash error:', error);
            const container = buildErrorResponse('Failed', 'Could not load role info.', error.message);
            const fn = interaction.replied || interaction.deferred ? interaction.editReply : interaction.reply;
            await fn.call(interaction, { components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        try {
            const wantPerms = args.length > 0 && /^(perms|permissions|all)$/i.test(args[args.length - 1]);
            const lookupArgs = wantPerms ? args.slice(0, -1) : args;

            const role = resolveRole(message, lookupArgs);
            if (!role) {
                const container = buildRoleNotFound(lookupArgs.join(' ') || null);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            if (wantPerms) {
                const result = buildPermsPages(role);
                const reply = await message.reply(result);
                setupPaginationCollector(reply, result._pageData, message.author.id);
                return;
            }

            await message.reply({ components: [buildOverview(role)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[ROLEINFO] Prefix error:', error);
            const container = buildErrorResponse('Failed', 'Could not load role info.', error.message);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    } };
