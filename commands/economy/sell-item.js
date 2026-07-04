'use strict';

const { createContainer, addTextDisplay, formatNumber, MessageFlags } = require('../../utils/componentHelpers');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const economyManager = require('../../utils/economyManager');
const { ITEMS } = require('../../utils/shopItems');
const jsonStore = require('../../utils/jsonStore');
const { shopGuard } = require('../../utils/economyGuards');

/* ═══════════════════ HELPERS ═══════════════════ */

function load() { return jsonStore.read('inventory'); }
function save(d) { jsonStore.write('inventory', d); }

// Per-user re-entry guard. Without this, two parallel sell-item
// invocations from the same user (slash + prefix double-fire) both
// pass the `owned > 0` check on the same live snapshot and credit
// coins twice, while inventory removal works only once.
const inFlight = new Set();

/* ═══════════════════ COMMAND ═══════════════════ */

module.exports = {
  data: new (require('discord.js').SlashCommandBuilder)()
    .setName('sell-item')
    .setDescription('Sell items from your inventory for coins')
    .addStringOption(o => o.setName('item').setDescription('Item ID to sell').setRequired(true))
    .addIntegerOption(o => o.setName('amount').setDescription('Quantity to sell').setRequired(false).setMinValue(1).setMaxValue(100)),
  prefix: 'sell-item',
  description: 'Sell items from your inventory for coins',
  usage: 'sell-item <item_id> [amount]',
  category: 'economy',
  aliases: ['sellitem', 'sell-i'],

  async executePrefix(message, args) {
        const guildId = message.guild?.id;
    if (await shopGuard(message)) return;
    const itemId = args[0]?.toLowerCase();
    const qty = Math.max(1, parseInt(args[1]) || 1);

    const meta = itemId ? ITEMS[itemId] : null;

    if (!meta) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, [
        '<:Cancel:1521227723916181644> **Invalid item.**',
        '',
        '**Usage:** `sell-item <item_id> [amount]`',
        '**Example:** `sell-item trophy 3`',
        '',
        '-# Use `inventory` to see your items and their sell values.',
      ].join('\n'));
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (!meta.sellPrice || meta.sellPrice <= 0) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, `<:Cancel:1521227723916181644> ${meta.emoji} **${meta.name}** cannot be sold.`);
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (qty < 1 || qty > 100) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, '<:Cancel:1521227723916181644> Amount must be between **1** and **100**.');
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const economy = economyManager.loadEconomy();
    const inventory = load();
    const userId = message.author.id;

    if (inFlight.has(userId)) {
      const c = createContainer(0xFEE75C);
      addTextDisplay(c, '<:Infotriangle:1521227710381428926> A previous sale is still completing — try again in a moment.');
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    inFlight.add(userId);
    try {
      inventory[userId] ||= [];

      /* ── Ownership check ── */
      const owned = inventory[userId].filter(i => i.id === itemId).length;
      if (owned === 0) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `<:Cancel:1521227723916181644> You don't own any ${meta.emoji} **${meta.name}**.`);
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      }

      const wantedQty = Math.min(qty, owned);

      /* ═══════ PROCESS SALE ═══════ */

      // Remove items (oldest first). The number actually removed by
      // the filter is the source of truth for how many coins to
      // credit — using the pre-mutation `owned` count would double-
      // credit if a parallel sale already drained part of the stack.
      let removed = 0;
      inventory[userId] = inventory[userId].filter(i => {
        if (i.id === itemId && removed < wantedQty) {
          removed++;
          return false;
        }
        return true;
      });

      if (removed === 0) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, `<:Cancel:1521227723916181644> You don't own any ${meta.emoji} **${meta.name}**.`);
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      }

      const sellQty = removed;
      const totalValue = meta.sellPrice * sellQty;

      const { userData } = economyManager.getUser(economy, userId);
      userData.coins += totalValue;

      // Save inventory FIRST so the items removed are guaranteed to
      // be persisted even if the economy save somehow fails. The
      // next economy mutation in any other command will re-save the
      // wallet on its way through.
      save(inventory);
      economyManager.saveEconomy(economy);

      /* ═══════ RESPONSE ═══════ */

      const remaining = inventory[userId].filter(i => i.id === itemId).length;
      const container = createContainer(0xCAD7E6);
      addTextDisplay(container, [
        `# ${coinIcon(guildId)} Item Sold`,
        '',
        `<:Checkedbox:1521227734943269077> Sold **${sellQty}× ${meta.emoji} ${meta.name}**`,
        `${coinIcon(guildId)} Earned: **${formatCoinsAmount(totalValue, guildId)}** (${formatNumber(meta.sellPrice)}/ea)`,
        '',
        `💼 Wallet: **${formatCoins(userData.coins, guildId)}**`,
        `<:Box:1521228152414666833> Remaining: **${remaining}** ${meta.name}`,
      ].join('\n'));

      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    } finally {
      inFlight.delete(userId);
    }
  },

  async execute(interaction) {
        await interaction.deferReply({ flags: 1 << 15 });
    if (await shopGuard(interaction)) return;
    const itemId = interaction.options?.getString('item');
    const qty = interaction.options?.getInteger('amount') || 1;
    const fakeArgs = [itemId, String(qty)].filter(Boolean);
    const fakeMessage = {
      author: interaction.user,
      guild: interaction.guild,
      reply: (opts) => interaction.editReply(opts),
    };
    return module.exports.executePrefix(fakeMessage, fakeArgs);
  },
};
