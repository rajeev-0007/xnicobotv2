'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder,
    ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const { buildErrorResponse, buildInvalidUsage, COLORS } = require('../../utils/responseBuilder');
const { paginate, setupPaginationCollector } = require('../../utils/pagination');

function buildHeaderContainer(role) {
    const guildIcon = role.guild.iconURL({ size: 256 });
    const created = Math.floor(role.createdTimestamp / 1000);

    const headerSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <:Userplus:1521227719621218477> Members in ${role.name}\n` +
                `-# Snapshot of every member currently holding this role`
            )
        );
    if (guildIcon) headerSection.setThumbnailAccessory(new ThumbnailBuilder({ media: { url: guildIcon } }));

    const meta =
        `### <:Invoice:1521227903956811836> Role Overview\n` +
        `<:Caretright:1521227704953864202> **Role:** ${role}\n` +
        `<:Caretright:1521227704953864202> **Color:** \`${role.hexColor.toUpperCase()}\`\n` +
        `<:Caretright:1521227704953864202> **Position:** \`#${role.position}\`\n` +
        `<:Caretright:1521227704953864202> **Members:** \`${role.members.size}\`\n` +
        `<:Clock:1521228110408847623> **Created:** <t:${created}:R>`;

    return new ContainerBuilder()
        .setAccentColor(role.color || COLORS.INFO)
        .addSectionComponents(headerSection)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(meta))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

function buildInRolePages(role) {
    if (role.members.size === 0) return null;

    const sorted = [...role.members.values()]
        .sort((a, b) => (a.user.username || '').localeCompare(b.user.username || ''));

    const lines = sorted.map((m, i) =>
        `\`${String(i + 1).padStart(3, '0')}.\` ${m} \`@${m.user.username}\``
    );

    return paginate({
        header:
            `# <:Userplus:1521227719621218477> Members in ${role.name}\n` +
            `-# **${role.members.size}** member${role.members.size === 1 ? '' : 's'} hold this role`,
        lines,
        perPage: 15,
        accentColor: role.color || COLORS.INFO });
}

async function send(replyFn, role, userId) {
    const result = buildInRolePages(role);
    if (!result) {
        const container = buildErrorResponse(
            'No Members Found',
            `No one currently holds the ${role} role.`,
            'Try assigning it to a few members first, then run this command again.'
        );
        return replyFn({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    const reply = await replyFn({ ...result, fetchReply: true });
    setupPaginationCollector(reply, result._pageData, userId);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('inrole')
        .setDescription('View every member who holds a specific role')
        .addRoleOption(opt => opt.setName('role').setDescription('Role to inspect').setRequired(true)),

    prefix: 'inrole',
    description: 'View every member who holds a specific role',
    usage: 'inrole <@role>',
    category: 'basic',

    async execute(interaction) {
        const role = interaction.options.getRole('role');
        try {
            await send(
                (payload) => interaction.reply(payload),
                role,
                interaction.user.id
            );
        } catch (error) {
            console.error('[INROLE] Slash error:', error);
            const container = buildErrorResponse('Lookup Failed', 'Could not list members for that role.', error.message);
            const replyFn = interaction.replied || interaction.deferred ? interaction.editReply : interaction.reply;
            await replyFn.call(interaction, { components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        try {
            const role = message.mentions.roles.first()
                || message.guild.roles.cache.get(args[0])
                || message.guild.roles.cache.find(r => r.name.toLowerCase() === args.join(' ').toLowerCase());

            if (!role) {
                const container = buildInvalidUsage('inrole', '-inrole <@role | name | id>', ['-inrole @Members', '-inrole VIP', '-inrole 123456789012345678']);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }

            await send(
                (payload) => message.reply(payload),
                role,
                message.author.id
            );
        } catch (error) {
            console.error('[INROLE] Prefix error:', error);
            const container = buildErrorResponse('Lookup Failed', 'Could not list members for that role.', error.message);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    } };
