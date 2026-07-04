'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, MessageFlags, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const { ITEMS, itemDisplay, CATEGORIES } = require('../../utils/shopItems');
const economyManager = require('../../utils/economyManager');
const itemCooldowns = require('../../utils/itemCooldowns');

const jsonStore = require('../../utils/jsonStore');
const ITEMS_PER_PAGE = 6;

function load() {
  if (!jsonStore.has('inventory')) return {};
  try { return jsonStore.read('inventory'); } catch { return {}; }
}

/**
 * Parse anything an item's `emoji` field could be (unicode "🎫",
 * custom tag "<:Box:1521228152414666833>", animated tag
 * "<a:wave:1234>", or undefined) into the `{ id?, name?, animated? }`
 * shape that StringSelectMenuOption expects.
 *
 * Returns `undefined` when nothing usable was provided so the option
 * is built without an emoji rather than failing validation.
 */
function parseSelectEmoji(raw) {
    if (!raw) return undefined;
    const s = String(raw).trim();
    const custom = s.match(/^<(a?):([^:\s]+):(\d+)>$/);
    if (custom) {
        return { animated: custom[1] === 'a', name: custom[2], id: custom[3] };
    }
    // Plain Unicode glyph (or anything that's not a Discord tag) — keep
    // only the first grapheme so we never feed Discord a multi-char
    // string in the emoji slot, which it rejects.
    const first = [...s][0];
    return first ? { name: first } : undefined;
}

/** Trim a string to the Discord StringSelect limit, with ellipsis. */
function clampSelect(text, max) {
    if (!text) return '';
    const t = String(text);
    return t.length <= max ? t : t.slice(0, max - 1) + '…';
}

/* ═══════════════════ GROUP ITEMS ═══════════════════ */

function groupItems(items) {
  const grouped = {};
  for (const item of items) {
    if (!grouped[item.id]) grouped[item.id] = { id: item.id, count: 0, oldest: item.boughtAt || 0 };
    grouped[item.id].count++;
    if (item.boughtAt && item.boughtAt < grouped[item.id].oldest) grouped[item.id].oldest = item.boughtAt;
  }
  // Sort by category order, then by name
  const catOrder = Object.keys(CATEGORIES);
  return Object.values(grouped).sort((a, b) => {
    const catA = ITEMS[a.id]?.category || 'special';
    const catB = ITEMS[b.id]?.category || 'special';
    const orderDiff = catOrder.indexOf(catA) - catOrder.indexOf(catB);
    if (orderDiff !== 0) return orderDiff;
    return (ITEMS[a.id]?.name || a.id).localeCompare(ITEMS[b.id]?.name || b.id);
  });
}

/* ═══════════════════ BUILD PAGE ═══════════════════ */

/**
 * Tag the inventory line with cooldown info if the item is currently
 * blocked. Returns "" when ready or when the item has no cooldown
 * configured. Format is purposefully terse so it fits on the existing
 * `-# … · …` meta line.
 */
function cooldownTag(userId, itemId) {
    const remaining = itemCooldowns.getRemaining(userId, itemId);
    if (remaining <= 0) return '';
    return ` ·  <:Clock:1521228110408847623> Ready ${itemCooldowns.formatReadyAt(remaining)}`;
}

function buildInventoryPage(userId, page = 0, guildId = null) {
  const inventory = load();
  const userItems = inventory[userId] || [];
  const economy = economyManager.loadEconomy();
  const { userData } = economyManager.getUser(economy, userId);

  const container = createContainer(0x7c3aed);

  if (!userItems.length) {
    addTextDisplay(container, '# <:Box:1521228152414666833> Your Inventory\n\nYour inventory is empty! Use `shop` to browse items.');
    return { container, components: [container] };
  }

  const grouped = groupItems(userItems);
  const totalPages = Math.ceil(grouped.length / ITEMS_PER_PAGE);
  page = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = grouped.slice(page * ITEMS_PER_PAGE, (page + 1) * ITEMS_PER_PAGE);

  // Header
  const totalItems = userItems.length;
  const uniqueItems = grouped.length;
  addTextDisplay(container, `# <:Box:1521228152414666833> Your Inventory\n${coinIcon(guildId)} Wallet: **${formatCoinsAmount(userData.coins, guildId)}**  ·  <:Folder:1521228095225331765> ${totalItems} items (${uniqueItems} unique)`);
  addSeparator(container, SeparatorSpacingSize.Small);

  // Items list
  for (const entry of pageItems) {
    const meta = ITEMS[entry.id];
    if (!meta) {
      addTextDisplay(container, `❓ \`${entry.id}\` × **${entry.count}** — *Unknown item*`);
      continue;
    }
    const catMeta = CATEGORIES[meta.category];
    const sellVal = meta.sellPrice ? ` ·  ${coinIcon(guildId)} Sell: ${formatNumber(meta.sellPrice)}/ea` : '';
    const cdTag   = cooldownTag(userId, entry.id);
    addTextDisplay(container, [
      `### ${meta.emoji} ${meta.name}  ×${entry.count}`,
      `-# ${catMeta?.emoji || '<:Box:1521228152414666833>'} ${catMeta?.label || 'Other'}${sellVal}${cdTag}  ·  \`use ${entry.id}\``,
    ].join('\n'));
  }

  addSeparator(container, SeparatorSpacingSize.Small);
  addTextDisplay(container, `-# Page ${page + 1}/${totalPages}  ·  \`use <id>\` to use  ·  \`sell-item <id> [amount]\` to sell`);

  // Build components array
  const components = [container];

  // Quick-use select menu (only if there are usable items)
  if (grouped.length > 0) {
    const selectItems = grouped.slice(0, 25).map(entry => {
      const meta = ITEMS[entry.id];
      const labelName = meta?.name || entry.id;
      // Discord limits: label ≤ 100 chars, description ≤ 100 chars,
      // value ≤ 100 chars. We have to clamp because a custom item
      // name + count could easily blow past the label cap.
      const opt = {
        label: clampSelect(`${labelName} (×${entry.count})`, 100),
        value: clampSelect(entry.id, 100),
        description: clampSelect(meta?.description || 'Use this item', 100),
      };
      const parsed = parseSelectEmoji(meta?.emoji);
      if (parsed) opt.emoji = parsed;
      return opt;
    });

    const selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('inv_use')
        .setPlaceholder('Quick Use — Select an item')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(selectItems)
    );
    components.push(selectRow);
  }

  // Pagination buttons
  if (totalPages > 1) {
    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`inv_page_${page - 1}`)
        .setEmoji('<:History:1521227863079256278>').setLabel('Prev')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId('inv_page_info')
        .setLabel(`${page + 1}/${totalPages}`)
        .setStyle(ButtonStyle.Primary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`inv_page_${page + 1}`)
        .setEmoji('<:Caretright:1521227704953864202>').setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );
    components.push(navRow);
  }

  return { container, components };
}

/* ═══════════════════ COMMAND ═══════════════════ */

module.exports = {
  data: new (require('discord.js').SlashCommandBuilder)()
    .setName('inventory')
    .setDescription('View your item inventory'),
  prefix: 'inventory',
  description: 'View your item inventory with quick-use menu',
  usage: 'inventory',
  category: 'economy',
  aliases: ['inv', 'bag', 'items'],

  async executePrefix(message) {
    const { components } = buildInventoryPage(message.author.id, 0, message.guild?.id);
    return message.reply({ components, flags: MessageFlags.IsComponentsV2 });
  },

  /* ═══════════════════ INTERACTION HANDLER ═══════════════════ */

  async handleInteraction(interaction) {
    const { customId } = interaction;

    /* ── Pagination ── */
    if (customId.startsWith('inv_page_')) {
      const page = parseInt(customId.replace('inv_page_', ''));
      if (isNaN(page)) { await interaction.deferUpdate(); return true; }

      const { components } = buildInventoryPage(interaction.user.id, page, interaction.guild?.id);
      await interaction.update({ components, flags: MessageFlags.IsComponentsV2 });
      return true;
    }

    /* ── Quick-use select ── */
    if (customId === 'inv_use') {
      const itemId = interaction.values?.[0];
      if (!itemId) { await interaction.deferUpdate(); return true; }

      // Delegate to the use command logic
      const useCmd = require('./use');
      if (useCmd && useCmd.executeUse) {
        await useCmd.executeUse(interaction, itemId);
        return true;
      }

      await interaction.deferUpdate();
      return true;
    }

    return false;
  },

  async execute(interaction) {
        await interaction.deferReply({ flags: 1 << 15 });
    const fakeMessage = {
      author: interaction.user,
      guild: interaction.guild,
      reply: (opts) => interaction.editReply(opts),
    };
    return module.exports.executePrefix(fakeMessage);
  },
};