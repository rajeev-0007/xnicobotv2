'use strict';

const {
    SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder,
    ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags
} = require('discord.js');
const { buildErrorResponse, buildUserNotFound, COLORS } = require('../../utils/responseBuilder');

// Each entry: emoji, display label, short description.
const FLAG_DETAILS = {
    Staff:                    { emoji: '<:Shield:1521227694677692467>', label: 'Discord Staff', desc: 'Official member of the Discord team' },
    Partner:                  { emoji: '<:Attach:1521228039135170722>', label: 'Partnered Server Owner', desc: 'Owns a Discord-partnered server' },
    Hypesquad:                { emoji: '<:Money:1521228266957045900>', label: 'HypeSquad Events', desc: 'Active member of HypeSquad Events' },
    BugHunterLevel1:          { emoji: '<:Search:1521228231263387738>', label: 'Bug Hunter Level 1', desc: 'Verified bug hunter (tier 1)' },
    BugHunterLevel2:          { emoji: '<:Search:1521228231263387738>', label: 'Bug Hunter Level 2', desc: 'Verified bug hunter (gold tier)' },
    HypeSquadOnlineHouse1:    { emoji: '<:Lightningalt:1521227851796447472>', label: 'HypeSquad Bravery', desc: 'House Bravery member' },
    HypeSquadOnlineHouse2:    { emoji: '<:Lightning:1521227915537285150>', label: 'HypeSquad Brilliance', desc: 'House Brilliance member' },
    HypeSquadOnlineHouse3:    { emoji: '<:Heart:1521228100652765247>', label: 'HypeSquad Balance', desc: 'House Balance member' },
    PremiumEarlySupporter:    { emoji: '<:Fire:1521227907647668374>', label: 'Early Supporter', desc: 'Subscribed to Nitro before Oct 10, 2018' },
    VerifiedBot:              { emoji: '<:Checkedbox:1521227734943269077>', label: 'Verified Bot', desc: 'Officially verified Discord bot' },
    VerifiedDeveloper:        { emoji: '<:Settings:1521227767780343879>', label: 'Early Verified Bot Developer', desc: 'Verified developer before Aug 2019' },
    CertifiedModerator:       { emoji: '<:Shield:1521227694677692467>', label: 'Moderator Programs Alumni', desc: 'Discord Certified Moderator alumnus' },
    ActiveDeveloper:          { emoji: '<:Settings:1521227767780343879>', label: 'Active Developer', desc: 'Owns a recently active application' },
    TeamPseudoUser:           { emoji: '<:Userplus:1521227719621218477>', label: 'Team User', desc: 'Pseudo account belonging to a Team' },
    Spammer:                  { emoji: '<:Infotriangle:1521227710381428926>', label: 'Flagged as Spammer', desc: 'Discord has flagged this account' },
    Quarantined:              { emoji: '<:Commentblock:1521227898101432331>', label: 'Quarantined', desc: 'Account temporarily restricted' },
    BotHTTPInteractions:      { emoji: '<:Bookopen:1521227911137595605>', label: 'HTTP Interactions Bot', desc: 'Bot that uses HTTP-only interactions' } };

function buildContainer(user, flags) {
    const sorted = flags.slice().sort();
    const isBot = user.bot;
    const created = Math.floor(user.createdTimestamp / 1000);

    const headerSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# <:Award:1521228119640375336> Profile Badges & Flags\n` +
                `**${user.username}** ${isBot ? '`[BOT]`' : ''}\n` +
                `${user}`
            )
        )
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: user.displayAvatarURL({ size: 256 }) } }));

    const meta =
        `### <:Invoice:1521227903956811836> Account Snapshot\n` +
        `<:Caretright:1521227704953864202> **User ID:** \`${user.id}\`\n` +
        `<:Caretright:1521227704953864202> **Created:** <t:${created}:F> (<t:${created}:R>)\n` +
        `<:Caretright:1521227704953864202> **Total badges:** \`${sorted.length}\``;

    let badges;
    if (sorted.length === 0) {
        badges = `### <:Award:1521228119640375336> Badges\n*This account has no public profile flags.*`;
    } else {
        const formatted = sorted.map(flag => {
            const meta = FLAG_DETAILS[flag];
            if (!meta) return `> <:Checkedbox:1521227734943269077> \`${flag}\``;
            return `> ${meta.emoji} **${meta.label}**\n> -# ${meta.desc}`;
        }).join('\n');
        badges = `### <:Award:1521228119640375336> Badges (${sorted.length})\n${formatted}`;
    }

    return new ContainerBuilder()
        .setAccentColor(user.accentColor || COLORS.INFO)
        .addSectionComponents(headerSection)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(meta))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(badges))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

async function resolveUser(client, target) {
    if (!target) return null;
    if (typeof target === 'object') {
        try { return await target.fetch(true); } catch { return target; }
    }
    if (typeof target === 'string') {
        try { return await client.users.fetch(target, { force: true }); } catch { return null; }
    }
    return null;
}

module.exports = {
    prefix: 'user-flags',
    description: 'View a user’s Discord profile badges and flags',
    usage: 'user-flags [@user | id]',
    category: 'basic',
    aliases: ['flags', 'userflags', 'badges-of'],

    data: new SlashCommandBuilder()
        .setName('user-flags')
        .setDescription('View a user’s Discord profile badges and flags')
        .addUserOption(opt => opt.setName('user').setDescription('Target user').setRequired(false)),

    async execute(interaction) {
        try {
            const user = interaction.options.getUser('user') || interaction.user;
            const fetched = await resolveUser(interaction.client, user) || user;
            const flags = fetched.flags?.toArray?.() || [];
            await interaction.reply({ components: [buildContainer(fetched, flags)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[USER-FLAGS] Slash error:', error);
            const err = buildErrorResponse('Lookup Failed', 'Could not fetch user flags.', error.message);
            const fn = interaction.replied || interaction.deferred ? interaction.editReply : interaction.reply;
            await fn.call(interaction, { components: [err], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    },

    async executePrefix(message, args) {
        try {
            let user = message.mentions.users.first();
            if (!user && args[0] && /^\d{17,19}$/.test(args[0])) {
                user = await resolveUser(message.client, args[0]);
                if (!user) {
                    const container = buildUserNotFound(args[0]);
                    return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
                }
            }
            user = user || message.author;
            const fetched = await resolveUser(message.client, user) || user;
            const flags = fetched.flags?.toArray?.() || [];
            await message.reply({ components: [buildContainer(fetched, flags)], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('[USER-FLAGS] Prefix error:', error);
            const err = buildErrorResponse('Lookup Failed', 'Could not fetch user flags.', error.message);
            await message.reply({ components: [err], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
    } };
