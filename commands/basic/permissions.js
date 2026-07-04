'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder,
    ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const { buildErrorResponse, buildUserNotFound, COLORS } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');

// Higher-impact permissions surfaced first in the spotlight section.
const KEY_PERMS = new Set([
    'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels',
    'ManageMessages', 'ManageWebhooks', 'ManageNicknames', 'ManageEmojisAndStickers',
    'KickMembers', 'BanMembers', 'ModerateMembers', 'MentionEveryone',
    'ViewAuditLog', 'ManageEvents', 'ManageThreads',
]);

function buildSpotlight(member, allPerms) {
    const hasAdmin = allPerms.includes('Administrator');
    const keyPerms = allPerms.filter(p => KEY_PERMS.has(p));
    const totalRoles = member.roles.cache.size - 1;

    const headerSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <:Key:1521228000467878111> Permissions Overview\n` +
                `**${member.user.username}** ${member.nickname ? `\`(${member.nickname})\`` : ''}\n` +
                `${member.user}`
            )
        )
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: member.user.displayAvatarURL({ size: 256 }) } }));

    const meta =
        `### <:Invoice:1521227903956811836> Member Snapshot\n` +
        `<:Caretright:1521227704953864202> **Roles:** \`${totalRoles}\`\n` +
        `<:Caretright:1521227704953864202> **Highest role:** ${member.roles.highest}\n` +
        `<:Caretright:1521227704953864202> **Total permissions:** \`${allPerms.length}\`\n` +
        `<:Caretright:1521227704953864202> **Administrator:** ${hasAdmin ? '<:Checkedbox:1521227734943269077> Yes' : '<:Cancel:1521227723916181644> No'}`;

    const keyBlock = hasAdmin
        ? `### <:Crown:1521227739988889764> Administrator\n*This member has every permission via the Administrator flag.*`
        : keyPerms.length > 0
            ? `### <:Lightningalt:1521227851796447472> Key Permissions (${keyPerms.length})\n` +
              keyPerms.map(p => `> <:Checkedbox:1521227734943269077> \`${p}\``).join('\n')
            : `### <:Lightningalt:1521227851796447472> Key Permissions\n*No moderation-tier permissions.*`;

    return new ContainerBuilder()
        .setAccentColor(member.displayColor || COLORS.INFO)
        .addSectionComponents(headerSection)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(meta))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(keyBlock))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `-# Run \`permissions @user list\` to browse every granted permission`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

function buildFullList(member, allPerms) {
    const lines = allPerms.sort().map((p, i) => {
        const tier = KEY_PERMS.has(p) ? '<:Lightningalt:1521227851796447472>' : '<:Checkedbox:1521227734943269077>';
        return `\`${String(i + 1).padStart(2, '0')}.\` ${tier} \`${p}\``;
    });

    return paginate({
        header:
            `# <:Key:1521228000467878111> All Permissions — ${member.user.username}\n` +
            `-# **${allPerms.length}** total permission${allPerms.length === 1 ? '' : 's'} (key permissions highlighted)`,
        lines,
        perPage: 15,
        accentColor: member.displayColor || COLORS.INFO });
}

async function send(replyFn, member, userId, args) {
    const allPerms = member.permissions.toArray();
    const wantList = (args || []).some(a => /^(list|all|full)$/i.test(a));

    if (wantList) {
        const result = buildFullList(member, allPerms);
        const reply = await replyFn({ ...result, fetchReply: true });
        setupPaginationCollector(reply, result._pageData, userId);
        return;
    }

    return replyFn({ components: [buildSpotlight(member, allPerms)], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('permissions')
        .setDescription("View a member's Discord permissions")
        .addUserOption(opt => opt.setName('user').setDescription('Member to inspect').setRequired(false))
        .addBooleanOption(opt => opt.setName('list').setDescription('Show every granted permission with pagination').setRequired(false)),

    prefix: 'permissions',
    description: "View a member's Discord permissions",
    usage: 'permissions [@user] [list]',
    category: 'basic',
    aliases: ['perms'],

    async execute(interaction) {
        try {
            const user = interaction.options.getUser('user');
            const list = interaction.options.getBoolean('list');
            const member = user
                ? await interaction.guild.members.fetch(user.id).catch(() => null)
                : interaction.member;
            if (!member) {
                const container = buildUserNotFound(user?.tag);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            await send(
                (payload) => interaction.reply(payload),
                member,
                interaction.user.id,
                list ? ['list'] : []
            );
        } catch (error) {
            console.error('[PERMISSIONS] Slash error:', error);
            const container = buildErrorResponse('Failed', 'Could not load permissions.', error.message);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        try {
            let member = message.mentions.members.first();
            const cleanArgs = args.filter(a => !/^<@/.test(a));
            if (!member && cleanArgs[0] && /^\d{17,19}$/.test(cleanArgs[0])) {
                member = await message.guild.members.fetch(cleanArgs.shift()).catch(() => null);
            }
            if (!member) member = message.member;

            await send(
                (payload) => message.reply(payload),
                member,
                message.author.id,
                cleanArgs
            );
        } catch (error) {
            console.error('[PERMISSIONS] Prefix error:', error);
            const container = buildErrorResponse('Failed', 'Could not load permissions.', error.message);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    } };
