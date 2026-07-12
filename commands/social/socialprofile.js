const { SlashCommandBuilder, AttachmentBuilder, MessageFlags, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ProfileCard = require('../../utils/profileCard');
const { getUserData, models, getGuildMember } = require('../../utils/database');
const badgeManager = require('../../utils/badgeManager');
const premiumManager = require('../../utils/premiumManager');
const economyManager = require('../../utils/economyManager');
const { buildLoadingResponse, buildErrorResponse, EMOJIS } = require('../../utils/responseBuilder');
const jsonStore = require('../../utils/jsonStore');
const { resolveUser } = require('../../utils/resolveUser');
const { resolveProfileAssets } = require('../../utils/discordAssets');

function getLeveling() {
    if (!jsonStore.has('leveling')) return {};
    return jsonStore.read('leveling');
}

function calculateLevel(xp) {
    return Math.floor(0.1 * Math.sqrt(xp));
}

function xpForNextLevel(level) {
    return Math.pow((level + 1) / 0.1, 2);
}

async function generateProfileCard(user, guild, client) {
    const marriages = jsonStore.has('marriages') ? jsonStore.read('marriages') : {};
    const reputation = jsonStore.has('reputation') ? jsonStore.read('reputation') : {};

    const leveling = getLeveling();
    const guildData = leveling[guild.id] || {};
    const userData = guildData[user.id] || { xp: 0, level: 0 };
    const currentLevel = calculateLevel(userData.xp);

    const xpForNext = Math.ceil(xpForNextLevel(currentLevel));
    const baseXp = currentLevel > 0 ? Math.ceil(xpForNextLevel(currentLevel - 1)) : 0;
    const xpProgress = Math.max(0, userData.xp - baseXp);
    const xpNeeded = Math.max(1, xpForNext - baseXp);

    const sorted = Object.entries(guildData)
        .map(([userId, data]) => ({ userId, xp: data.xp }))
        .sort((a, b) => b.xp - a.xp);
    const userRank = sorted.findIndex(u => u.userId === user.id) + 1;

    const userProfile = await getUserData(user.id).catch(() => ({ profile: {}, social: {} }));
    const member = await guild.members.fetch(user.id).catch(() => null);

    // Resolve the user's REAL Discord banner + avatar decoration (force-fetch
    // included) — partial users from interaction options don't include them.
    const { fullUser, banner: discordBanner, decoration: avatarDecoration } =
        await resolveProfileAssets(client, user);
    const flags = fullUser.flags ? fullUser.flags.toArray() : [];

    let commandsUsed = 0;
    let messageCount = 0;
    let voiceTime = 0;
    try {
        const memberData = await getGuildMember(guild.id, user.id);
        if (memberData) {
            commandsUsed = memberData.leveling?.commandsUsed || 0;
            messageCount = memberData.leveling?.messageCount || 0;
            voiceTime = memberData.analytics?.voiceTime || 0;
        }
    } catch {}

    // Pull wallet + bank from the economy store so the BALANCE stat box
    // shows real coins instead of always rendering "0".
    let balance = 0;
    try {
        const economy = economyManager.loadEconomy();
        const { userData: econUser } = economyManager.getUser(economy, user.id);
        balance = (Number(econUser.coins) || 0) + (Number(econUser.bank) || 0);
    } catch {}

    let favoriteSongs = [];
    try { favoriteSongs = await models.FavoriteSong.find({ userId: user.id }); } catch {}

    let likedSongs = [];
    try { likedSongs = await models.LikedSong.find({ userId: user.id }); } catch {}

    const profileCard = new ProfileCard();

    const profileSettings = userProfile.profile?.profileCard || userProfile.profile || {};
    const selectedCardStyle = profileSettings.cardStyle || 'minimal';
    profileCard.setCardStyle(selectedCardStyle);
    if (profileSettings.customBackground) profileCard.setBackgroundImage(profileSettings.customBackground);
    // Default the banner to the user's real Discord banner; a custom banner
    // set via profile-customize overrides it.
    const effectiveBanner = profileSettings.bannerImage || discordBanner;
    if (effectiveBanner) {
        profileCard.setBannerImage(effectiveBanner);
        profileCard.setBannerMode(profileSettings.bannerMode || 'strip');
    }
    if (profileSettings.backgroundColor) profileCard.setBackground(profileSettings.backgroundColor);
    if (profileSettings.accentColor || profileSettings.progressBarColor) {
        profileCard.setAccentColor(profileSettings.accentColor || profileSettings.progressBarColor);
    }
    if (profileSettings.textColor) profileCard.setTextColor(profileSettings.textColor);
    if (profileSettings.backgroundOpacity !== undefined) profileCard.setBackgroundOpacity(profileSettings.backgroundOpacity);
    if (profileSettings.fontFamily) profileCard.setFontFamily(profileSettings.fontFamily);

    let relationshipStatus = 'Single';
    if (marriages[user.id]) {
        try {
            const partnerId = marriages[user.id].partner;
            const partner = await client.users.fetch(partnerId).catch(() => null);
            relationshipStatus = partner ? `Married to ${partner.username}` : 'Married';
        } catch {
            relationshipStatus = 'Married';
        }
    }

    let customBadges = [];
    try {
        customBadges = await badgeManager.getUserBadges(user.id);
        customBadges = customBadges.map(badge => ({
            badgeId: badge.badgeId,
            name: badge.name,
            emoji: badge.emoji,
            description: badge.description || '',
            color: badge.color || '#bcf1e4',
            imageUrl: badge.imageUrl || null
        }));
    } catch {
        customBadges = [];
    }

    const isPremiumUser = premiumManager.isPremium(user.id);
    if (isPremiumUser) {
        const hasPremiumBadge = customBadges.some(b => b.badgeId === 'premium');
        if (!hasPremiumBadge) {
            const allBadges = await badgeManager.getAllBadges();
            const premiumBadge = allBadges.find(b => b.badgeId === 'premium');
            if (premiumBadge) {
                customBadges.unshift({
                    badgeId: premiumBadge.badgeId,
                    name: premiumBadge.name,
                    emoji: premiumBadge.emoji,
                    description: premiumBadge.description || '',
                    color: premiumBadge.color || '#bcf1e4',
                    imageUrl: premiumBadge.imageUrl || null
                });
            }
        }
    } else {
        customBadges = customBadges.filter(b => b.badgeId !== 'premium');
    }

    const cardBuffer = await profileCard.generate(fullUser, {
        bio: userProfile.social?.bio || null,
        avatarDecoration,
        reputation: reputation[user.id] || 0,
        relationship: relationshipStatus,
        level: currentLevel,
        totalXp: userData.xp,
        currentXp: xpProgress,
        requiredXp: xpNeeded,
        rank: userRank || 0,
        flags,
        customBadges,
        commandsUsed,
        messageCount,
        voiceTime,
        balance,
        favoriteSongs,
        likedSongs,
        createdAt: fullUser.createdTimestamp,
        joinedAt: member?.joinedTimestamp || null,
        cardStyle: selectedCardStyle,
        badgeStyle: profileSettings.badgeStyle || 'default'
    });

    const attachment = new AttachmentBuilder(cardBuffer, { name: 'profile-card.png' });

    // Plain action row (NOT a V2 container) so the card image renders as a
    // normal attachment OUTSIDE any container.
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('profile_customize_open').setLabel('Customize').setEmoji('<:Palette:1521227950601539755>').setStyle(ButtonStyle.Secondary)
    );

    return { attachment, row };
}

module.exports = {
    name: 'socialprofile',
    prefix: 'socialprofile',
    description: 'View your or someone else\'s social profile card',
    usage: 'socialprofile [@user]',
    category: 'social',
    aliases: ['sprofile', 'soprofile', 'prof', 'userprofile', 'me'],

    data: new SlashCommandBuilder()
        .setName('socialprofile')
        .setDescription('View your or someone else\'s social profile card')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to view (optional)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply();
        const user = interaction.options.getUser('user') || interaction.user;

        try {
            const { attachment, row } = await generateProfileCard(user, interaction.guild, interaction.client);
            await interaction.editReply({ files: [attachment], components: [row] });
        } catch (error) {
            console.error('Error generating profile card:', error);
            const errContainer = buildErrorResponse('Profile Error', 'Failed to generate the social profile card.', 'Try again in a moment or use `profile-customize` to reset your settings.');
            await interaction.editReply({ components: [errContainer], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        const user = (await resolveUser(message, args)) || message.author;
        const msg = await message.reply(`${EMOJIS.LOADING} Loading profile...`);

        try {
            const { attachment, row } = await generateProfileCard(user, message.guild, message.client);
            await msg.edit({ content: null, files: [attachment], components: [row] });
        } catch (error) {
            console.error('Error generating profile card:', error);
            await msg.edit({ content: '<:Cancel:1521227723916181644> Failed to generate the social profile card.' }).catch(() => {});
        }
    }
};
