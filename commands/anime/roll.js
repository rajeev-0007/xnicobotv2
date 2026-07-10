'use strict';

const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const animeCard = require('../../utils/animeCardCanvas');
const economyManager = require('../../utils/economyManager');

async function handleRoll(reply, user, guildId, multi = false) {
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
        addTextDisplay(c, `## <:Alarm:1521227869047750689> Cooldown\nPlease wait **${remaining}s** before rolling again.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const freeRolls = animeManager.checkFreeRolls(playerData);
    let isFreeRoll = false;

    if (freeRolls > 0 && !multi) {
        isFreeRoll = true;
    } else {
        const cost = multi ? animeManager.MULTI_ROLL_COST : animeManager.ROLL_COST;
        if (userData.coins < cost) {
            const c = createContainer(0xED4245);
            addTextDisplay(c, [
                `## <:Money:1521228266957045900> Not Enough Coins`,
                '',
                `You need **${cost.toLocaleString()}** coins to roll${multi ? ' (×10)' : ''}.`,
                `> Balance: **${(userData.coins || 0).toLocaleString()}** coins`,
                freeRolls > 0 ? `\n-# 🎟️ You have ${freeRolls} free roll(s) today — use \`adaily\`` : `\n-# Earn coins with \`daily\` / \`work\``,
            ].join('\n'));
            return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }
        userData.coins -= cost;
        playerData.totalSpent += cost;
        economyManager.saveEconomy(economy);
    }

    if (isFreeRoll) animeManager.useFreeRoll(playerData);
    playerData.lastRoll = now;

    if (multi) {
        const results = animeManager.rollMultiple();
        let newCount = 0, dupCount = 0;
        for (const char of results) {
            const isDup = animeManager.addToCollection(playerData, char);
            if (isDup) dupCount++; else newCount++;
        }
        playerData.totalRolls += animeManager.MULTI_ROLL_COUNT;
        animeManager.saveAnimeData();

        const buffer = await animeCard.renderMulti(results);
        const c = createContainer(0x9B59B6);
        addTextDisplay(c, [
            `## <:Present:1521228115655917659> Multi Roll ×${animeManager.MULTI_ROLL_COUNT}`,
            `> ✨ **${newCount} New** • 🔄 **${dupCount} Dupes**`,
            `-# ${isFreeRoll ? 'Free roll' : `${animeManager.MULTI_ROLL_COST} coins`} • Collection: ${playerData.collection.length} cards`,
        ].join('\n'));
        c.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL('attachment://multiroll.png')
            )
        );
        return reply({ components: [c], files: [new AttachmentBuilder(buffer, { name: 'multiroll.png' })], flags: MessageFlags.IsComponentsV2 });
    }

    const character = animeManager.rollCharacter();
    const isDuplicate = animeManager.addToCollection(playerData, character);
    playerData.totalRolls++;
    animeManager.saveAnimeData();

    const wishlistHit = playerData.wishlist.includes(character.id);
    const rarity = animeManager.RARITIES[character.rarity];
    const buffer = await animeCard.renderCard(character, { isDuplicate, isNew: !isDuplicate });

    const c = createContainer(rarity.color);
    const lines = [
        `## ${rarity.emoji} You rolled **${character.name}**!`,
        `> ${rarity.emoji} **${rarity.name}** • 💰 ${rarity.value.toLocaleString()} value`,
        `-# ${isFreeRoll ? 'Free roll' : `${animeManager.ROLL_COST} coins`} • Collection: ${playerData.collection.length} cards`,
    ];
    if (wishlistHit) lines.push(`\n🌟 **WISHLIST HIT!**`);
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
        .setName('aroll')
        .setDescription('Roll for a random anime character card')
        .addBooleanOption(o => o.setName('multi').setDescription('Do a multi-roll (×10)').setRequired(false)),
    prefix: 'aroll',
    description: 'Roll for a random anime character card (gacha)',
    usage: 'aroll [--multi]',
    aliases: ['ar', 'animeroll', 'gacha'],
    category: 'anime',

    async executePrefix(message, args) {
        const multi = args.includes('multi') || args.includes('--multi') || args.includes('x10');
        await message.channel.sendTyping().catch(() => {});
        return handleRoll(message.reply.bind(message), message.author, message.guild?.id, multi);
    },

    async execute(interaction) {
        const multi = interaction.options?.getBoolean('multi') || false;
        await interaction.deferReply();
        return handleRoll((payload) => interaction.editReply(payload), interaction.user, interaction.guild?.id, multi);
    },
};
