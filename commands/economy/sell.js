const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const { createContainer, addTextDisplay, formatNumber, getErrorContainer, MessageFlags } = require('../../utils/componentHelpers');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const economyManager = require('../../utils/economyManager');
const ph = require('../../utils/petHelpers');

/* ---------------- HELPERS ---------------- */

// Base values by rarity (matching hunt.js animal definitions)
const RARITY_VALUES = {
  common: 10,
  uncommon: 60,
  rare: 200,
  legendary: 1000
};

function petValue(pet) {
  const baseValue = RARITY_VALUES[pet.rarity] || 10;
  return Math.floor(baseValue * (1 + (pet.level || 1) * 0.15));
}

/* ---------------- COMMAND ---------------- */

module.exports = {
  data: new (require('discord.js').SlashCommandBuilder)()
    .setName('sell')
    .setDescription('Sell pets for coins')
    .addStringOption(o => o.setName('rarity').setDescription('Rarity tier to sell').setRequired(true)
      .addChoices(
        { name: 'Common', value: 'common' },
        { name: 'Uncommon', value: 'uncommon' },
        { name: 'Rare', value: 'rare' },
        { name: 'Legendary', value: 'legendary' },
        { name: 'All', value: 'all' },
      )),
  prefix: 'sell',
  description: 'Sell pets for coins',
  usage: 'sell <common|uncommon|rare|legendary|all>',
  category: 'economy',
  aliases: ['sellpet'],

  async executePrefix(message, args) {
        const guildId = message.guild?.id;
    const pets = ph.loadPets();
    const economy = economyManager.loadEconomy();
    const userId = message.author.id;

    if (!pets[userId]?.animals?.length) {
      const c = createContainer(0xED4245); addTextDisplay(c, '<:Cancel:1521227723916181644> You have no pets to sell.');
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    const { userData } = economyManager.getUser(economy, userId);

    const type = args[0]?.toLowerCase();
    const valid = ['common', 'uncommon', 'rare', 'legendary', 'all'];

    if (!valid.includes(type)) {
      const c = createContainer(0xED4245); addTextDisplay(c, '<:Cancel:1521227723916181644> Usage: `sell common | uncommon | rare | legendary | all`');
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const allPets = [...pets[userId].animals];

    /* ---------- FILTER PETS ---------- */
    let sellable =
      type === 'all'
        ? allPets
        : allPets.filter(p => p.rarity === type);

    if (!sellable.length) {
      const c = createContainer(0xED4245); addTextDisplay(c, '<:Cancel:1521227723916181644> No pets of this type to sell.');
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    /* ---------- ENSURE 1 PET REMAINS ---------- */
    if (sellable.length >= allPets.length) {
      sellable = sellable.slice(0, allPets.length - 1);
    }

    if (!sellable.length) {
      const c = createContainer(0xFEE75C); addTextDisplay(c, '<:Infotriangle:1521227710381428926> You must keep at least **1 pet**.');
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const remaining = allPets.length - sellable.length;
    const totalCoins = sellable.reduce((a, p) => a + petValue(p), 0);

    /* ---------- CONFIRM UI ---------- */
    const container = createContainer();
    addTextDisplay(container, `# ${coinIcon(guildId)} Confirm Pet Sale\n\n` +
      `🐾 Type: **${type.toUpperCase()}**\n` +
      `<:Box:1521228152414666833> Pets to sell: **${sellable.length}**\n` +
      `🐶 Pets remaining: **${remaining}**\n\n` +
      `${coinIcon(guildId)} You will receive: **${formatCoinsAmount(totalCoins, guildId)}**`);

    const sessId = `sell_${Date.now()}_${userId}`;
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${sessId}_confirm`).setEmoji('<:Checkedbox:1521227734943269077>').setLabel('Confirm').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${sessId}_cancel`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );

    const msg = await message.reply({ components: [container, row], flags: MessageFlags.IsComponentsV2 });

    const collector = msg.createMessageComponentCollector({ time: 30000 });

    collector.on('collect', async i => {
      if (i.user.id !== userId) {
        await i.reply({ components: [getErrorContainer("This doesn't belong to you.")], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        return;
      }
      await i.deferUpdate();

      if (i.customId === `${sessId}_cancel`) {
        collector.stop();
        const c = createContainer();
        addTextDisplay(c, '<:Cancel:1521227723916181644> Sale cancelled.');
        return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }

      if (i.customId === `${sessId}_confirm`) {
        // Re-load fresh data to avoid stale state after 30s
        const freshPets = ph.loadPets();
        const freshEconomy = economyManager.loadEconomy();
        const { userData: freshUser } = economyManager.getUser(freshEconomy, userId);

        if (!freshPets[userId]?.animals?.length) {
          collector.stop();
          const c = createContainer();
          addTextDisplay(c, '<:Cancel:1521227723916181644> Pets no longer available.');
          return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        // Recompute the sellable set against the current pets state
        // — the original `sellable` was a snapshot from up to 30s
        // ago. If the user caught/sold pets in the meantime, the
        // snapshot's id list may include pets that no longer exist
        // (no-op) or miss new pets they expected to sell. Recomputing
        // here keeps the math honest and the "≥1 must remain" rule
        // applies to the *fresh* count, not the stale one.
        const freshAll = freshPets[userId].animals;
        let freshSellable = type === 'all'
          ? [...freshAll]
          : freshAll.filter(p => p.rarity === type);

        // Filter to pets that were targeted in the original confirm
        // (so a pet caught after the prompt is NOT silently sold).
        const originalIds = new Set(sellable.map(p => p.id));
        freshSellable = freshSellable.filter(p => originalIds.has(p.id));

        if (freshSellable.length >= freshAll.length) {
          freshSellable = freshSellable.slice(0, freshAll.length - 1);
        }
        if (!freshSellable.length) {
          collector.stop();
          const c = createContainer(0xFEE75C);
          addTextDisplay(c, '<:Infotriangle:1521227710381428926> Nothing to sell — your pets list changed since the prompt.');
          return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        const soldIds = freshSellable.map(p => p.id);
        const freshTotalCoins = freshSellable.reduce((a, p) => a + petValue(p), 0);

        freshPets[userId].animals = freshPets[userId].animals.filter(
          p => !soldIds.includes(p.id)
        );

        if (soldIds.includes(freshPets[userId].activeBattlePet)) {
          freshPets[userId].activeBattlePet = freshPets[userId].animals[0]?.id || null;
        }

        freshUser.coins += freshTotalCoins;
        // Track lifetime earnings for /economystats consistency.
        freshUser.totalEarned = (freshUser.totalEarned || 0) + freshTotalCoins;

        ph.savePets(freshPets);
        economyManager.saveEconomy(freshEconomy);

        collector.stop();

        const c = createContainer();
        addTextDisplay(c, `# <:Checkedbox:1521227734943269077> Pets Sold\n\n` +
          `<:Box:1521228152414666833> Sold: **${freshSellable.length} pets**\n` +
          `🐶 Remaining: **${freshPets[userId].animals.length}**\n` +
          `${coinIcon(guildId)} Earned: **${formatCoinsAmount(freshTotalCoins, guildId)}**`);

        return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }
    });
  },

  async execute(interaction) {
        await interaction.deferReply({ flags: 1 << 15 });
    const rarity = interaction.options.getString('rarity');
    const fakeMessage = {
      author: interaction.user,
      reply: (opts) => interaction.editReply(opts),
    };
    return module.exports.executePrefix(fakeMessage, [rarity]);
  },
};