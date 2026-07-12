const { SlashCommandBuilder, AttachmentBuilder, MessageFlags, ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildLoadingResponse, buildErrorResponse, EMOJIS } = require('../../utils/responseBuilder');
const LevelCard = require('../../utils/levelCard');
const { getUserData, getGuildMember } = require('../../utils/database');
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

async function generateRankCard(target, guild) {
    const leveling = getLeveling();
    const guildData = leveling[guild.id] || {};
    const userData = guildData[target.id] || { xp: 0, level: 0 };
    
    const currentLevel = calculateLevel(userData.xp);
    const xpForNext = Math.ceil(xpForNextLevel(currentLevel));
    const baseXp = currentLevel > 0 ? Math.ceil(xpForNextLevel(currentLevel - 1)) : 0;
    const xpProgress = Math.max(0, userData.xp - baseXp);
    const xpNeeded = Math.max(1, xpForNext - baseXp);
    
    const sorted = Object.entries(guildData)
        .map(([userId, data]) => ({ userId, xp: data.xp }))
        .sort((a, b) => b.xp - a.xp);
    const rank = sorted.findIndex(u => u.userId === target.id) + 1;

    const member = await guild.members.fetch(target.id).catch(() => null);
    const userProfile = await getUserData(target.id).catch(() => ({ profile: {}, social: {} }));

    // Resolve the user's REAL Discord banner + avatar decoration (force-fetch
    // included) — partial users from interaction options don't include them.
    const { fullUser, banner: discordBanner, decoration: avatarDecoration } =
        await resolveProfileAssets(guild.client, target);
    
    let messageCount = userData.messages || 0;
    let voiceTime = 0;
    try {
        const memberData = await getGuildMember(guild.id, target.id);
        if (memberData) {
            // Use the higher count: jsonStore leveling data or database member data
            const dbMessageCount = memberData.leveling?.messageCount || 0;
            if (dbMessageCount > messageCount) messageCount = dbMessageCount;
            voiceTime = memberData.analytics?.voiceTime || 0;
        }
    } catch {}
    
    const levelCard = new LevelCard();
    
    const rankSettings = userProfile.profile?.rankCard || userProfile.profile || {};
    const selectedCardStyle = rankSettings.cardStyle || 'minimal';
    levelCard.setCardStyle(selectedCardStyle);
    if (rankSettings.customBackground) levelCard.setBackgroundImage(rankSettings.customBackground);
    // Default the banner to the user's real Discord banner; a custom banner
    // set via rank-customize overrides it.
    const effectiveBanner = rankSettings.bannerImage || discordBanner;
    if (effectiveBanner) {
        levelCard.setBannerImage(effectiveBanner);
        levelCard.setBannerMode(rankSettings.bannerMode || 'strip');
    }
    if (rankSettings.backgroundColor) levelCard.setBackground(rankSettings.backgroundColor);
    if (rankSettings.progressBarColor) {
        levelCard.setProgressBarColor(rankSettings.progressBarColor);
        levelCard.setAccentColor(rankSettings.progressBarColor);
    }
    if (rankSettings.textColor) levelCard.setTextColor(rankSettings.textColor);
    if (userProfile.social?.bio) levelCard.setBio(userProfile.social.bio);
    if (rankSettings.backgroundOpacity !== undefined) levelCard.setBackgroundOpacity(rankSettings.backgroundOpacity);
    if (rankSettings.fontFamily) levelCard.setFontFamily(rankSettings.fontFamily);
    
    const cardBuffer = await levelCard.generate(fullUser, {
        level: currentLevel,
        rank: rank || 0,
        xpProgress,
        xpNeeded,
        totalXp: userData.xp,
        memberCount: guild.memberCount,
        joinedAt: member?.joinedTimestamp || null,
        messagesCount: messageCount,
        voiceTime,
        avatarDecoration
    });

    const attachment = new AttachmentBuilder(cardBuffer, { name: 'rank-card.png' });

    // Plain action row so the rank card renders as a normal attachment
    // OUTSIDE any container.
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('rankcard_customize_open').setLabel('Customize').setEmoji('<:Palette:1521227950601539755>').setStyle(ButtonStyle.Secondary)
    );

    return { attachment, row };
}

module.exports = {
    name: 'rank',
    prefix: 'rank',
    description: 'Display your rank card with level and XP',
    usage: 'rank [@user]',
    category: 'leveling',
    aliases: ['level', 'lvl', 'xp'],
    
    data: new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Display your rank card with level and XP progress')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to view (optional)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply();
        const target = interaction.options.getUser('user') || interaction.user;

        try {
            const { attachment, row } = await generateRankCard(target, interaction.guild);
            await interaction.editReply({ files: [attachment], components: [row] });
        } catch (error) {
            console.error('Error generating rank card:', error);
            const errContainer = buildErrorResponse('Rank Card Error', 'Failed to generate the rank card.', 'Try again in a moment or use `rank-customize` to reset your card settings.');
            await interaction.editReply({ components: [errContainer], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        const target = (await resolveUser(message, args)) || message.author;
        const msg = await message.reply(`${EMOJIS.LOADING} Loading rank...`);

        try {
            const { attachment, row } = await generateRankCard(target, message.guild);
            await msg.edit({ content: null, files: [attachment], components: [row] });
        } catch (error) {
            console.error('Error generating rank card:', error);
            await msg.edit({ content: '<:Cancel:1521227723916181644> Failed to generate the rank card.' }).catch(() => {});
        }
    },
};
