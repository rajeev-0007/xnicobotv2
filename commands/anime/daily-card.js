'use strict';

const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');
const animeCard = require('../../utils/animeCardCanvas');

/** Build the "vote to earn more rolls" panel shown once daily rolls run out. */
function buildVoteGate(reason) {
    const clientId = process.env.CLIENT_ID || '';
    const c = createContainer(0x5865F2);

    const nextReset = new Date();
    nextReset.setHours(24, 0, 0, 0);
    const timeUntil = nextReset.getTime() - Date.now();
    const hours = Math.floor(timeUntil / 3600000);
    const minutes = Math.floor((timeUntil % 3600000) / 60000);

    const alreadyClaimed = reason === 'already-claimed';
    const headline = alreadyClaimed
        ? `> You've already claimed the bonus rolls for your current vote.`
        : `> You've used all **${animeManager.DAILY_FREE_ROLLS}** of today's free rolls.`;

    addTextDisplay(c, [
        `## 🎟️ Out of Daily Rolls`,
        headline,
        '',
        `<:Fire:1521227907647668374> **Vote to unlock +${animeManager.VOTE_BONUS_ROLLS} bonus rolls!**`,
        alreadyClaimed
            ? `> Vote again in 12h to claim another **+${animeManager.VOTE_BONUS_ROLLS}** rolls.`
            : `> After voting, run \`adaily\` again to claim your **+${animeManager.VOTE_BONUS_ROLLS}** rolls.`,
        '',
        `-# Daily rolls reset in **${hours}h ${minutes}m** • Or use coins with \`aroll\``,
    ].join('\n'));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Vote on Top.gg')
            .setURL(`https://top.gg/bot/${clientId}/vote`)
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:topgg:1521228219066482790>'),
        new ButtonBuilder()
            .setLabel('Vote on DBL')
            .setURL('https://discordbotlist.com/bots/xnico')
            .setStyle(ButtonStyle.Link)
            .setEmoji('<:Cursor:1521228147071127732>'),
    );
    c.addActionRowComponents(row);
    return c;
}

async function handleDailyCard(reply, user, guildId) {
    await animeManager.ensurePool();
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);

    let bonusClaimed = false;

    // Eagerly bank any fresh, unclaimed vote bonus. Bonus rolls persist until
    // spent, so claiming immediately means a vote never expires unused just
    // because the player still had daily rolls left (the old gate only tried
    // to claim once dailies were exhausted, which could miss the 12h window).
    const claim = animeManager.claimVoteRolls(playerData, user.id);
    if (claim.claimed) {
        bonusClaimed = true;
        animeManager.saveAnimeData();
    }

    // Still no free rolls (no dailies AND no bonus to claim)? Prompt to vote.
    if (animeManager.checkFreeRolls(playerData) <= 0) {
        return reply({ components: [buildVoteGate(claim.reason || 'no-vote')], flags: MessageFlags.IsComponentsV2 });
    }

    const source = animeManager.useFreeRoll(playerData); // 'daily' | 'bonus'
    playerData.lastRoll = Date.now();
    playerData.totalRolls++;

    const voteBoost = animeManager.hasActiveVote(user.id);
    const character = animeManager.rollCharacter(voteBoost);
    const isDuplicate = animeManager.addToCollection(playerData, character);
    animeManager.saveAnimeData();

    const rarity = animeManager.RARITIES[character.rarity];
    const dailyLeft = animeManager.checkDailyRolls(playerData);
    const bonusLeft = playerData.bonusRolls || 0;
    const buffer = await animeCard.renderCard(character, { isDuplicate, isNew: !isDuplicate });

    const c = createContainer(rarity.color);
    const lines = [
        `## ${AE.present} ${source === 'bonus' ? 'Vote Bonus Roll' : 'Daily Free Roll'} — **${character.name}**`,
        `> ${rarity.emoji} **${rarity.name}** • ${AE.money} ${rarity.value.toLocaleString()} value`,
    ];
    if (bonusClaimed) lines.push(`> ${AE.sparkle} **+${animeManager.VOTE_BONUS_ROLLS} vote bonus rolls claimed!**`);
    if (voteBoost) lines.push(`> ${AE.fire} **Vote boost active** — better Epic/Legendary/Mythic odds!`);
    const bonusStr = bonusLeft > 0 ? ` • ${AE.gift} ${bonusLeft} bonus` : '';
    lines.push(`-# Rolls left today: ${dailyLeft}/${animeManager.DAILY_FREE_ROLLS}${bonusStr}`);
    if (playerData.wishlist.includes(character.id)) lines.push(`\n${AE.star} **WISHLIST HIT!**`);
    addTextDisplay(c, lines.join('\n'));
    c.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder().setURL('attachment://card.png')
        )
    );

    return reply({ components: [c], files: [new AttachmentBuilder(buffer, { name: 'card.png' })], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('adaily')
        .setDescription('Use a free daily anime card roll'),
    prefix: 'adaily',
    description: 'Use one of your free daily anime card rolls',
    usage: 'adaily',
    aliases: ['dailycard', 'freeroll', 'adailyroll'],
    category: 'anime',

    async executePrefix(message) {
        await message.channel.sendTyping().catch(() => {});
        return handleDailyCard(message.reply.bind(message), message.author, message.guild?.id);
    },

    async execute(interaction) {
        await interaction.deferReply();
        return handleDailyCard((payload) => interaction.editReply(payload), interaction.user, interaction.guild?.id);
    },
};
