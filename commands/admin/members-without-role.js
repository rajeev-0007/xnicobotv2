'use strict';

const {
    SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize, PermissionFlagsBits
} = require('discord.js');
const {
    buildErrorResponse, buildPermissionDenied, COLORS, BRANDING
} = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');

async function loadRoleless(guild) {
    await guild.members.fetch();
    return [...guild.members.cache.values()]
        .filter(m => !m.user.bot && m.roles.cache.size === 1)
        .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
}

function buildEmpty() {
    return new ContainerBuilder()
        .setAccentColor(0x57F287)
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <:Checkedbox:1521227734943269077> No Roleless Members\n\n` +
                `Every member already has at least one role. Nice and tidy.`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

function buildPagedList(members, guildName) {
    const lines = members.map((m, i) => {
        const joined = Math.floor(m.joinedTimestamp / 1000);
        return `\`${String(i + 1).padStart(3, '0')}.\` ${m.user} \`@${m.user.username}\` — joined <t:${joined}:R>`;
    });

    return paginate({
        header:
            `# <:Bookopen:1521227911137595605> Members Without Roles — ${guildName}\n` +
            `-# **${members.length}** human member${members.length === 1 ? '' : 's'} have no assigned roles`,
        lines,
        perPage: 15,
        accentColor: COLORS.WARNING || 0xFEE75C,
    });
}

module.exports = {
    name: 'members-without-role',
    prefix: 'members-without-role',
    description: 'List human members who have no roles assigned',
    category: 'admin',
    usage: 'members-without-role',
    permissions: ['ManageRoles'],
    data: new SlashCommandBuilder()
        .setName('members-without-role')
        .setDescription('List human members who have no roles assigned')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
        try {
            const members = await loadRoleless(interaction.guild);
            if (members.length === 0) {
                return interaction.editReply({ components: [buildEmpty()], flags: MessageFlags.IsComponentsV2 });
            }
            const result = buildPagedList(members, interaction.guild.name);
            const reply = await interaction.editReply(result);
            setupPaginationCollector(reply, result._pageData, interaction.user.id);
        } catch (error) {
            console.error('[MEMBERS-WITHOUT-ROLE] Slash error:', error);
            const container = buildErrorResponse('Failed', 'Could not load member list.', error.message);
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async executePrefix(message) {
        if (!message.guild) {
            return message.reply('<:Cancel:1521227723916181644> This command can only be used in a server.').catch(() => {});
        }
        if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
            const container = buildPermissionDenied('Manage Roles');
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        try {
            const members = await loadRoleless(message.guild);
            if (members.length === 0) {
                return message.reply({ components: [buildEmpty()], flags: MessageFlags.IsComponentsV2 });
            }
            const result = buildPagedList(members, message.guild.name);
            const reply = await message.reply(result);
            setupPaginationCollector(reply, result._pageData, message.author.id);
        } catch (error) {
            console.error('[MEMBERS-WITHOUT-ROLE] Prefix error:', error);
            const container = buildErrorResponse('Failed', 'Could not load member list.', error.message);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },
};
