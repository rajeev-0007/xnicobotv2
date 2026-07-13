'use strict';

const {
    SlashCommandBuilder, MessageFlags, AttachmentBuilder,
    MediaGalleryBuilder, MediaGalleryItemBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');
const animeCard = require('../../utils/animeCardCanvas');
const economyManager = require('../../utils/economyManager');

/** Action buttons shown under a roll result for quick re-rolls. */
function rollButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('aroll_again').setLabel('Roll Again').setEmoji(AE.roll).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('aroll_multi').setLabel(`×${animeManager.MULTI_ROLL_COUNT} Multi`).setEmoji(AE.gacha).setStyle(ButtonStyle.Secondary),
    );
}

/**
 * Run one roll (single or multi) and build the response payload WITHOUT
 * sending it. Performs all side effects (cooldown check, coin deduction,
 * collection updates, saves). Returns { container, files, ok }.
 *   ok=false → a cooldown / insufficient-funds container (no action buttons).
 */
async function computeRoll(user, multi = false) {
    await animeManager.ensurePool();
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, user.id);

    // Cooldown
    const now = Date.now();
    if (now - playerData.lastRoll < animeManager.ROLL_COOLDOWN) {
        const remaining = Math.ceil((animeManager.ROLL_COOLDOWN - (now - playerData.lastRoll)) / 1000);
        const c = createContainer(0xED4245);
        addTextDisplay(c, `## ${AE.clock} Cooldown\nPlease wait **${remaining}s** before rolling again.`);
        return { container: c, ok: false };
    }

    // Eagerly bank any fresh, unclaimed vote bonus (persists until spent).
    let voteBonusClaimed = 0;
    {
        const claim = animeManager.claimVoteRolls(playerData, user.id);
        if (claim.claimed) {
            voteBonusClaimed = claim.granted;
            animeManager.saveAnimeData();
        }
    }

    let freeRolls = animeManager.checkFreeRolls(playerData);
    let isFreeRoll = false;

    if (freeRolls > 0 && !multi) {
        isFreeRoll = true;
    } else {
        const cost = multi ? animeManager.MULTI_ROLL_COST : animeManager.ROLL_COST;
        if (userData.coins < cost) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, [
                `## ${AE.money} Not Enough Coins`,
                '',
                `You need **${cost.toLocaleString()}** coins to roll${multi ? ` (×${animeManager.MULTI_ROLL_COUNT})` : ''}.`,
                `> Balance: **${(userData.coins || 0).toLocaleString()}** coins`,
                freeRolls > 0 ? `\n-# ${AE.present} You have ${freeRolls} free roll(s) — use \`adaily\`` : `\n-# Free rolls used — \`adaily\` to vote for +${animeManager.VOTE_BONUS_ROLLS} more, or earn coins with \`daily\` / \`work\``,
            ].join('\n'));
            return { container: c, ok: false };
        }
        userData.coins -= cost;
        playerData.totalSpent += cost;
        economyManager.saveEconomy(economy);
    }

    if (isFreeRoll) animeManager.useFreeRoll(playerData);
    playerData.lastRoll = now;

    const voteBoost = animeManager.hasActiveVote(user.id);

    // ── Multi roll ──
    if (multi) {
        const results = animeManager.rollMultiple(animeManager.MULTI_ROLL_COUNT, voteBoost);
        let newCount = 0, dupCount = 0;
        for (const char of results) {
            const isDup = animeManager.addToCollection(playerData, char);
            if (isDup) dupCount++; else newCount++;
        }
        playerData.totalRolls += animeManager.MULTI_ROLL_COUNT;
        animeManager.saveAnimeData();

        const buffer = await animeCard.renderMulti(results);
        const c = createContainer(0x9B59B6);
        const mLines = [
            `## ${AE.present} Multi Roll ×${animeManager.MULTI_ROLL_COUNT}`,
            `> ${AE.sparkle} **${newCount} New** • ${AE.refresh} **${dupCount} Dupes**`,
        ];
        if (voteBonusClaimed > 0) mLines.push(`> ${AE.gift} **+${voteBonusClaimed} vote bonus rolls claimed!**`);
        if (voteBoost) mLines.push(`> ${AE.fire} **Vote boost active** — better Epic/Legendary/Mythic odds!`);
        mLines.push(`-# ${isFreeRoll ? 'Free roll' : `${animeManager.MULTI_ROLL_COST} coins`} • Collection: ${playerData.collection.length} cards`);
        addTextDisplay(c, mLines.join('\n'));
        c.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://multiroll.png'))
        );
        return { container: c, files: [new AttachmentBuilder(buffer, { name: 'multiroll.png' })], ok: true };
    }

    // ── Single roll ──
    const character = animeManager.rollCharacter(voteBoost);
    const isDuplicate = animeManager.addToCollection(playerData, character);
    playerData.totalRolls++;
    animeManager.saveAnimeData();

    const wishlistHit = playerData.wishlist.includes(character.id);
    const rarity = animeManager.RARITIES[character.rarity];
    const buffer = await animeCard.renderCard(character, { isDuplicate, isNew: !isDuplicate });

    const c = createContainer(rarity.color);
    const lines = [
        `## ${rarity.emoji} You rolled **${character.name}**!`,
        `> ${rarity.emoji} **${rarity.name}** • ${AE.money} ${rarity.value.toLocaleString()} value`,
        `-# ${isFreeRoll ? 'Free roll' : `${animeManager.ROLL_COST} coins`} • Collection: ${playerData.collection.length} cards`,
    ];
    if (voteBonusClaimed > 0) lines.push(`> ${AE.sparkle} **+${voteBonusClaimed} vote bonus rolls claimed!**`);
    if (voteBoost) lines.push(`> ${AE.fire} **Vote boost active** — better Epic/Legendary/Mythic odds!`);
    if (wishlistHit) lines.push(`\n${AE.star} **WISHLIST HIT!**`);
    addTextDisplay(c, lines.join('\n'));
    c.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://card.png'))
    );
    return { container: c, files: [new AttachmentBuilder(buffer, { name: 'card.png' })], ok: true };
}

/** Attach a persistent collector so the Roll Again / Multi buttons work. */
function attachRollCollector(message, user) {
    if (!message || typeof message.createMessageComponentCollector !== 'function') return;
    const collector = message.createMessageComponentCollector({
        filter: (i) => i.user.id === user.id && (i.customId === 'aroll_again' || i.customId === 'aroll_multi'),
        time: 300_000,
    });
    collector.on('collect', async (i) => {
        const multi = i.customId === 'aroll_multi';
        try {
            const r = await computeRoll(user, multi);
            if (r.ok) r.container.addActionRowComponents(rollButtons());
            const payload = { components: [r.container], flags: MessageFlags.IsComponentsV2, files: r.files || [] };
            await i.update(payload);
        } catch {
            await i.deferUpdate().catch(() => {});
        }
    });
}

async function handleRoll(reply, user, guildId, multi = false) {
    const r = await computeRoll(user, multi);
    if (r.ok) r.container.addActionRowComponents(rollButtons());
    const payload = { components: [r.container], flags: MessageFlags.IsComponentsV2 };
    if (r.files) payload.files = r.files;
    const sent = await reply(payload);
    if (r.ok) attachRollCollector(sent, user);
    return sent;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aroll')
        .setDescription('Roll for a random anime character card')
        .addBooleanOption(o => o.setName('multi').setDescription(`Do a multi-roll (×${animeManager.MULTI_ROLL_COUNT})`).setRequired(false)),
    prefix: 'aroll',
    description: 'Roll for a random anime character card (gacha)',
    usage: 'aroll [--multi]',
    aliases: ['ar', 'animeroll', 'gacha'],
    category: 'anime',

    async executePrefix(message, args) {
        const multi = args.includes('multi') || args.includes('--multi') || args.includes('x5') || args.includes('x10');
        await message.channel.sendTyping().catch(() => {});
        return handleRoll(message.reply.bind(message), message.author, message.guild?.id, multi);
    },

    async execute(interaction) {
        const multi = interaction.options?.getBoolean('multi') || false;
        await interaction.deferReply();
        return handleRoll(
            async (payload) => { await interaction.editReply(payload); return interaction.fetchReply(); },
            interaction.user, interaction.guild?.id, multi
        );
    },

    // Shared so the dedicated /amulti command can reuse the exact same logic.
    handleRoll,
};
