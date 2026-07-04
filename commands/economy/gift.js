'use strict';

/**
 * gift — Send an item from your inventory to another user.
 *
 * Items in this bot live in the global inventory jsonStore as
 *   `[{ id, boughtAt }, ...]`
 * keyed by user ID — the same store /buy, /shop and /inventory
 * use. The previous version of this command read and wrote a
 * legacy `userData.inventory` object map, so gifts silently
 * vanished and the recipient never received anything. We now
 * operate on the real store, with a legacy-map fallback so any
 * stragglers still land somewhere sensible.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { formatCoins, formatCoinsShort } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, formatNumber, addSeparator, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { EMOJIS } = require('../../utils/economyEmojis');
const { getItem } = require('../../utils/shopItems');
const { resolveUser } = require('../../utils/resolveUser');
const jsonStore = require('../../utils/jsonStore');

const COOLDOWN = 60 * 1000;
const cooldowns = new Map();
// Per-sender re-entry guard. Two parallel `gift` invocations from
// the same sender (slash + prefix double-fire) would otherwise both
// pass the `have.total >= qty` check on the same live cache and
// both push items onto the receiver — duplicating the gift while
// only consuming the inventory once.
const inFlight = new Set();

function loadInv()      { return jsonStore.has('inventory') ? (jsonStore.read('inventory') || {}) : {}; }
function saveInv(data)  { jsonStore.write('inventory', data); }

function ownedQty(inv, userId, userData, itemId) {
  const slots = Array.isArray(inv?.[userId]) ? inv[userId] : [];
  const fromGlobal = slots.filter(it => it && it.id === itemId).length;
  const legacyMap  = userData.inventory;
  const fromLegacy = (legacyMap && typeof legacyMap === 'object' && !Array.isArray(legacyMap))
    ? Number(legacyMap[itemId] || 0) : 0;
  return { fromGlobal, fromLegacy, total: fromGlobal + fromLegacy };
}

async function handleGift(reply, senderId, target, itemId, quantity, guildId) {
  if (!target || target.id === senderId || target.bot) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `${EMOJIS.cancel} You must mention a valid user to gift an item to.`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  if (inFlight.has(senderId)) {
    const c = createContainer(0xFEE75C);
    addTextDisplay(c, `${EMOJIS.warn || '<:Infotriangle:1521227710381428926>'} A gift from you is already in flight — wait a moment for it to finish.`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  if (!itemId) {
    const c = createContainer(0xCAD7E6);
    addTextDisplay(c, [
      `# ${EMOJIS.present} Gift an Item`,
      '',
      `**Usage:** \`gift @user <item_id> [quantity]\``,
      '',
      `Gift any item from your inventory to another player.`,
      `Use \`inventory\` to see your items and their IDs.`,
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  const itemInfo = getItem(itemId);
  if (!itemInfo) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `${EMOJIS.cancel} Unknown item \`${itemId}\`. Use \`inventory\` to see valid IDs.`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  const now = Date.now();
  const lastUsed = cooldowns.get(senderId) || 0;
  const remainingCd = COOLDOWN - (now - lastUsed);
  if (remainingCd > 0) {
    const secs = Math.ceil(remainingCd / 1000);
    const c = createContainer(0xED4245);
    addTextDisplay(c, `# ${EMOJIS.sandwatch} Gift Cooldown\n\n${EMOJIS.alarm} Wait **${secs}s** before gifting again.`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  const qty = Math.max(1, Math.min(quantity || 1, 100));
  const economy = economyManager.loadEconomy();
  const { userData: sender }   = economyManager.getUser(economy, senderId);
  const { userData: receiver } = economyManager.getUser(economy, target.id);

  const inv = loadInv();
  const have = ownedQty(inv, senderId, sender, itemId);

  if (have.total < qty) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `${EMOJIS.cancel} You only have **${have.total}× ${itemInfo.name}** but tried to gift **${qty}**.`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // Receiver max-own check — keep them under the per-item cap so we
  // don't quietly waste gifts that exceed the limit.
  const recvHave = ownedQty(inv, target.id, receiver, itemId);
  const cap      = Number(itemInfo.maxOwn || Infinity);
  const allowed  = Math.max(0, cap - recvHave.total);
  if (qty > allowed) {
    const c = createContainer(0xFEE75C);
    addTextDisplay(c, [
      `# ${EMOJIS.warn || '<:Infotriangle:1521227710381428926>'} Recipient At Cap`,
      '',
      `**${target.username}** can only hold **${cap}× ${itemInfo.name}** — they already have **${recvHave.total}**.`,
      `You can send at most **${allowed}** more.`,
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  cooldowns.set(senderId, now);

  inFlight.add(senderId);
  try {
    // Re-load and re-validate inside the lock so a concurrent gift
    // that ran while we were validating outside doesn't slip through.
    const freshInv = loadInv();
    const freshHave = ownedQty(freshInv, senderId, sender, itemId);
    if (freshHave.total < qty) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, `${EMOJIS.cancel} You only have **${freshHave.total}× ${itemInfo.name}** but tried to gift **${qty}**.`);
      return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    // Consume from the sender — global slots first, legacy map second.
    freshInv[senderId] ||= [];
    freshInv[target.id] ||= [];
    let toRemove = qty;
    for (let i = 0; i < freshInv[senderId].length && toRemove > 0; ) {
      if (freshInv[senderId][i] && freshInv[senderId][i].id === itemId) {
        freshInv[senderId].splice(i, 1);
        toRemove--;
      } else {
        i++;
      }
    }
    if (toRemove > 0) {
      const legacyMap = sender.inventory;
      if (legacyMap && typeof legacyMap === 'object' && !Array.isArray(legacyMap)) {
        const take = Math.min(toRemove, legacyMap[itemId] || 0);
        legacyMap[itemId] -= take;
        toRemove -= take;
        if (legacyMap[itemId] <= 0) delete legacyMap[itemId];
      }
    }

    // Credit the receiver in the global store (uniform format).
    for (let i = 0; i < qty; i++) {
      freshInv[target.id].push({ id: itemId, boughtAt: now, gift: true, from: senderId });
    }

    sender.giftsSent = (sender.giftsSent || 0) + qty;
    economyManager.checkAllAchievements(economy, senderId);

    saveInv(freshInv);
    economyManager.saveEconomy(economy);

    const c = createContainer(0xCAD7E6);
    addTextDisplay(c, [
      `# ${EMOJIS.present} Gift Sent!`,
      '',
      `${itemInfo.emoji} **${target.username}** received **${qty}× ${itemInfo.name}** from you!`,
      '',
      `🎀 **Total gifts sent:** ${formatNumber(sender.giftsSent)}`,
      `-# Cooldown: 1 minute`,
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  } finally {
    inFlight.delete(senderId);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gift')
    .setDescription('Gift an item from your inventory to another user')
    .addUserOption(o => o.setName('user').setDescription('User to gift to').setRequired(true))
    .addStringOption(o => o.setName('item').setDescription('Item ID to gift').setRequired(true))
    .addIntegerOption(o => o.setName('quantity').setDescription('Quantity to gift').setRequired(false).setMinValue(1).setMaxValue(100)),
  prefix: 'gift',
  aliases: [],
  category: 'economy',
  description: 'Gift an inventory item to another user',
  usage: 'gift <@user> <item_id> [quantity]',

  async executePrefix(message, args) {
    const target = await resolveUser(message, args);
    const itemId  = args[1]?.toLowerCase();
    const qty     = parseInt(args[2]) || 1;
    return handleGift(message.reply.bind(message), message.author.id, target, itemId, qty, message.guild?.id);
  },

  async execute(interaction) {
    await interaction.deferReply();
    const target = interaction.options.getUser('user');
    const itemId  = interaction.options.getString('item')?.toLowerCase();
    const qty     = interaction.options.getInteger('quantity') || 1;
    return handleGift(interaction.editReply.bind(interaction), interaction.user.id, target, itemId, qty, interaction.guild?.id);
  },
};
