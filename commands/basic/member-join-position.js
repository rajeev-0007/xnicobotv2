'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder,
    ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const { buildErrorResponse, buildUserNotFound, COLORS } = require('../../utils/responseBuilder');

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function buildProgressBar(position, total) {
    const ratio = 1 - (position - 1) / Math.max(total - 1, 1);
    const filled = Math.max(1, Math.round(ratio * 14));
    return `${'▰'.repeat(filled)}${'▱'.repeat(14 - filled)}`;
}

async function buildJoinPosition(member, guild) {
    await guild.members.fetch();
    const sorted = Array.from(guild.members.cache.values())
        .sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);

    const position = sorted.findIndex(m => m.id === member.id) + 1;
    const total = guild.memberCount;
    const percentage = ((position / total) * 100).toFixed(2);
    const beforeMember = sorted[position - 2] || null;
    const afterMember  = sorted[position] || null;
    const bar = buildProgressBar(position, total);

    const headerSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <:Award:1521228119640375336> Join Position\n` +
                `**${member.user.username}** ${member.nickname ? `\`(${member.nickname})\`` : ''}`
            )
        )
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: member.user.displayAvatarURL({ size: 256 }) } }));

    const ranking =
        `### <:Invoice:1521227903956811836> Ranking\n` +
        `<:Caretright:1521227704953864202> **Position:** \`${ordinal(position)}\` of \`${total}\` members\n` +
        `<:Caretright:1521227704953864202> **Percentile:** Top **${percentage}%**\n` +
        `${bar}`;

    let neighbours = `### <:Userplus:1521227719621218477> Neighbours\n`;
    neighbours += beforeMember
        ? `<:Caretright:1521227704953864202> **Joined just before:** ${beforeMember.user} \`@${beforeMember.user.username}\`\n`
        : `<:Caretright:1521227704953864202> *No one joined before this member*\n`;
    neighbours += afterMember
        ? `<:Caretright:1521227704953864202> **Joined just after:** ${afterMember.user} \`@${afterMember.user.username}\``
        : `<:Caretright:1521227704953864202> *No one joined after this member*`;

    const timeline =
        `### <:Clock:1521228110408847623> Timeline\n` +
        `<:Caretright:1521227704953864202> **Joined:** <t:${Math.floor(member.joinedTimestamp / 1000)}:F>\n` +
        `<:Caretright:1521227704953864202> **Relative:** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`;

    return new ContainerBuilder()
        .setAccentColor(member.displayColor || COLORS.INFO)
        .addSectionComponents(headerSection)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(ranking))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(neighbours))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(timeline))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('member-join-position')
        .setDescription('See where a member ranks in the server join order')
        .addUserOption(opt => opt.setName('user').setDescription('Member to inspect').setRequired(false)),

    prefix: 'member-join-position',
    description: 'See where a member ranks in the server join order',
    usage: 'member-join-position [@user]',
    category: 'basic',
    aliases: ['joinpos', 'joinposition'],

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
        try {
            const user = interaction.options.getUser('user');
            const member = user
                ? await interaction.guild.members.fetch(user.id).catch(() => null)
                : interaction.member;
            if (!member) {
                const container = buildUserNotFound(user?.tag);
                return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            const container = await buildJoinPosition(member, interaction.guild);
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[MEMBER-JOIN-POSITION] Slash error:', error);
            const container = buildErrorResponse('Failed', 'Could not calculate join position.', error.message);
            await interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        try {
            let member = message.mentions.members.first();
            if (!member && args[0]) member = await message.guild.members.fetch(args[0]).catch(() => null);
            if (!member) member = message.member;

            const container = await buildJoinPosition(member, message.guild);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[MEMBER-JOIN-POSITION] Prefix error:', error);
            const container = buildErrorResponse('Failed', 'Could not calculate join position.', error.message);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    } };
