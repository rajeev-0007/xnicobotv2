'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder,
    ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const { buildErrorResponse, buildUserNotFound, COLORS } = require('../../utils/responseBuilder');

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function formatDuration(ms) {
    const days = Math.floor(ms / MS_PER_DAY);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'}`;
    const months = Math.floor(days / 30);
    if (months < 12) {
        const remDays = days - months * 30;
        return `${months}mo${remDays ? ` ${remDays}d` : ''}`;
    }
    const years = Math.floor(days / 365);
    const remDays = days - years * 365;
    const remMonths = Math.floor(remDays / 30);
    return `${years}y${remMonths ? ` ${remMonths}mo` : ''}`;
}

function buildJoined(member) {
    const joinedAt = Math.floor(member.joinedTimestamp / 1000);
    const createdAt = Math.floor(member.user.createdTimestamp / 1000);
    const ageOnServer = formatDuration(Date.now() - member.joinedTimestamp);
    const accountAge = formatDuration(Date.now() - member.user.createdTimestamp);

    const headerContent =
        `# <:Clock:1521228110408847623> Member Timeline\n` +
        `**${member.user.username}** ${member.nickname ? `\`(${member.nickname})\`` : ''}\n` +
        `${member.user}`;

    const headerSection = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(headerContent))
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: member.user.displayAvatarURL({ size: 256 }) } }));

    const joinBlock =
        `### <:Userplus:1521227719621218477> Joined Server\n` +
        `<:Caretright:1521227704953864202> **Date:** <t:${joinedAt}:F>\n` +
        `<:Caretright:1521227704953864202> **Relative:** <t:${joinedAt}:R>\n` +
        `<:Caretright:1521227704953864202> **On server for:** \`${ageOnServer}\``;

    const accountBlock =
        `### <:Bookopen:1521227911137595605> Account Created\n` +
        `<:Caretright:1521227704953864202> **Date:** <t:${createdAt}:F>\n` +
        `<:Caretright:1521227704953864202> **Relative:** <t:${createdAt}:R>\n` +
        `<:Caretright:1521227704953864202> **Account age:** \`${accountAge}\``;

    return new ContainerBuilder()
        .setAccentColor(member.displayColor || COLORS.INFO)
        .addSectionComponents(headerSection)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(joinBlock))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(accountBlock))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('joined')
        .setDescription('See when a member joined the server and how long they have been around')
        .addUserOption(opt => opt.setName('user').setDescription('Member to inspect').setRequired(false)),

    prefix: 'joined',
    description: 'See when a member joined the server',
    usage: 'joined [@user]',
    category: 'basic',
    aliases: ['joindate', 'whenjoined'],

    async execute(interaction) {
        try {
            const user = interaction.options.getUser('user');
            const member = user
                ? await interaction.guild.members.fetch(user.id).catch(() => null)
                : interaction.member;
            if (!member) {
                const container = buildUserNotFound(user?.tag);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
            }
            await interaction.reply({ components: [buildJoined(member)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[JOINED] Slash error:', error);
            const container = buildErrorResponse('Failed', 'Could not fetch join info.', error.message);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        try {
            let member = message.mentions.members.first();
            if (!member && args[0]) {
                member = await message.guild.members.fetch(args[0]).catch(() => null);
            }
            if (!member) member = message.member;

            await message.reply({ components: [buildJoined(member)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[JOINED] Prefix error:', error);
            const container = buildErrorResponse('Failed', 'Could not fetch join info.', error.message);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    } };
