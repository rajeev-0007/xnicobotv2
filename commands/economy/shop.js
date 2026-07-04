'use strict';

const { ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { formatCoins, coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, MessageFlags, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const { CATEGORIES, getItems } = require('../../utils/shopItems');
const economyManager = require('../../utils/economyManager');
const { shopGuard } = require('../../utils/economyGuards');

const jsonStore = require('../../utils/jsonStore');

/* ─────────────────────────────────────────────
   CUSTOM SHOP TAB
   ───────────────────────────────────────────── */
const CUSTOM_CATEGORY_ID    = 'custom';
const CUSTOM_CATEGORY_LABEL = 'Custom Shop';
const CUSTOM_CATEGORY_EMOJI = '<:Settings:1521227767780343879>';
const CUSTOM_CATEGORY_COLOR = 0xFBBF24;

const ACTION_LABELS = {
  give_role:    { emoji: '<:Userplus:1521227719621218477>', label: 'Grants role' },
  remove_role:  { emoji: '<:Trash:1521227750420254820>',     label: 'Removes role' },
  send_dm:      { emoji: '<:Envelope:1521228013910626426>',  label: 'Sends DM' },
  add_coins:    { emoji: '<:Money:1521228266957045900>',     label: 'Bonus coins' },
  custom_reply: { emoji: '<:Hashtag:1521227771957870604>',      label: 'Custom reply' }
};

/* ─────────────────────────────────────────────
   STORAGE HELPERS
   ───────────────────────────────────────────── */
function loadInv() {
  if (!jsonStore.has('inventory')) return {};
  try { return jsonStore.read('inventory'); } catch { return {}; }
}

function loadCustomShop(guildId) {
  if (!guildId || !jsonStore.has('custom-shop')) return { items: [] };
  try {
    const all = jsonStore.read('custom-shop') || {};
    return all[guildId] || { items: [] };
  } catch { return { items: [] }; }
}

/* ─────────────────────────────────────────────
   FORMATTING UTILITIES
   ───────────────────────────────────────────── */

/**
 * Affordability badge that doesn't shout — uses a small colored dot
 * for at-a-glance scanning, plus the MAX badge when applicable.
 */
function affordBadge(canAfford, atMax) {
  if (atMax) return '` MAX `';
  if (!canAfford) return '<:Cancel:1521227723916181644>';
  return '<:Checkedbox:1521227734943269077>';
}

/* ─────────────────────────────────────────────
   PAGE BUILDER (professional layout)
   ─────────────────────────────────────────────
 *  ┌─────────────────────────────────────────┐
 *  │ # 🛒 Economy Shop                       │
 *  │ -# Browsing **{Category}** · {wallet}   │
 *  ├─────────────────────────────────────────┤
 *  │ ### {emoji} {Item Name}        ` MAX `  │
 *  │ {short description}                     │
 *  │ -# {coin} {price}  ·  Owned X/Y  ·  ID  │
 *  │  (separator)                            │
 *  │ ### {next item} …                       │
 *  ├─────────────────────────────────────────┤
 *  │ -# How to use · Buy/Use/Sell hints      │
 *  └─────────────────────────────────────────┘
 *  └ ActionRow: Category select menu         ┘
 */
function buildShopPage(category, userId, guildId) {
  const economy = economyManager.loadEconomy();
  const { userData } = economyManager.getUser(economy, userId);
  const inventory = loadInv();
  const userInv = inventory[userId] || [];

  const isCustom = category === CUSTOM_CATEGORY_ID;
  const customShop = isCustom ? loadCustomShop(guildId) : null;
  const cat = isCustom
    ? { label: CUSTOM_CATEGORY_LABEL, emoji: CUSTOM_CATEGORY_EMOJI, color: CUSTOM_CATEGORY_COLOR }
    : CATEGORIES[category];

  const items   = isCustom ? (customShop.items || []) : getItems(category);
  const wallet  = userData.coins;
  const icon    = coinIcon(guildId);
  const container = createContainer(cat.color);

  // ── Header card ──────────────────────────────────────────────
  addTextDisplay(container, [
    `# <:Shoppingcart:1521228291909095557> Economy Shop`,
    `-# Browsing **${cat.emoji} ${cat.label}**  ·  ${icon} Your Wallet: **${formatCoinsAmount(wallet, guildId)}**`
  ].join('\n'));

  addSeparator(container, SeparatorSpacingSize.Small);

  // ── Items section ────────────────────────────────────────────
  if (items.length === 0) {
    if (isCustom) {
      addTextDisplay(container, [
        `### <:Infotriangle:1521227710381428926> No custom items yet`,
        `-# This server hasn't configured a Custom Shop. Admins can add items with`,
        `-# \`/customshop add <name> <price> <action> <data>\` — pick from grant role, remove role,`,
        `-# DM the buyer, give bonus coins, or send a custom message.`
      ].join('\n'));
    } else {
      addTextDisplay(container, `### <:Infotriangle:1521227710381428926> No items in this category`);
    }
  } else if (isCustom) {
    // Custom-shop items rendered as full cards with action label badges.
    // Note: no inter-item separators — Discord caps Components V2 messages
    // at 40 components total, and the custom shop allows up to 25 items.
    // 25 items + 24 separators + chrome would blow the cap; the section
    // padding alone is enough visual separation.
    items.forEach((item, i) => {
      const affordable = wallet >= item.price;
      const action = ACTION_LABELS[item.action] || { emoji: '<:Star:1521227981685526568>', label: item.action };
      const card = [
        `### ${action.emoji} ${item.name} ${affordBadge(affordable, false)}`,
        item.description ? `> ${item.description}` : `> *${action.label}*`,
        `-# ${icon} **${formatCoinsAmount(item.price, guildId)}**  ·  ${action.emoji} ${action.label}  ·  Index \`#${i + 1}\``
      ].join('\n');
      addTextDisplay(container, card);
    });
  } else {
    // Built-in items — fixed layout: title row, description row, meta row.
    // Same no-separator strategy as above to keep component count predictable.
    items.forEach((item, i) => {
      const owned = userInv.filter(x => x.id === item.id).length;
      const affordable = wallet >= item.price;
      // VIP badge has a parallel `userData.vip` flag — once activated
      // the user owns it for the lifetime of the account regardless
      // of inventory contents. Treat that as "MAX" so it doesn't
      // appear buyable after activation.
      const vipOwned = item.id === 'vip_badge' && userData.vip;
      const atMax = vipOwned || owned >= item.maxOwn;
      const ownedDisplay = vipOwned ? `${item.maxOwn}/${item.maxOwn} (active)` : `${owned}/${item.maxOwn}`;

      const card = [
        `### ${item.emoji} ${item.name} ${affordBadge(affordable, atMax)}`,
        `> ${item.description}`,
        `-# ${icon} **${formatCoinsAmount(item.price, guildId)}**  ·  <:Box:1521228152414666833> Owned ${ownedDisplay}  ·  <:Fileuser:1521228225466859792> ID \`${item.id}\``
      ].join('\n');
      addTextDisplay(container, card);
    });
  }

  addSeparator(container, SeparatorSpacingSize.Small);

  // ── Footer help ──────────────────────────────────────────────
  if (isCustom) {
    addTextDisplay(container,
      `-# <:Lightbulbalt:1521227880703463675> **Buy:** \`/customshop buy <name>\`  ·  **Admins:** \`/customshop add\` to add more items`
    );
  } else {
    addTextDisplay(container,
      `-# <:Lightbulbalt:1521227880703463675> **Buy:** \`buy <id> [amount]\`  ·  **Use:** \`use <id>\`  ·  **Sell:** \`sell-item <id> [amount]\``
    );
  }

  // ── Category dropdown ────────────────────────────────────────
  // Always include Custom Shop tab if a guild has one; users browsing
  // it directly via slash arg also get the option auto-selected.
  const customShopProbe = isCustom ? customShop : loadCustomShop(guildId);
  const hasCustomItems = (customShopProbe?.items || []).length > 0;
  const showCustomTab = hasCustomItems || isCustom;

  const opts = Object.entries(CATEGORIES).map(([catId, catData]) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(catData.label)
      .setValue(catId)
      .setEmoji(catData.emoji)
      .setDefault(catId === category)
  );

  if (showCustomTab) {
    opts.push(
      new StringSelectMenuOptionBuilder()
        .setLabel(CUSTOM_CATEGORY_LABEL)
        .setDescription(hasCustomItems
          ? `Server-specific items (${customShopProbe.items.length})`
          : 'Configure with /customshop add')
        .setValue(CUSTOM_CATEGORY_ID)
        .setEmoji(CUSTOM_CATEGORY_EMOJI)
        .setDefault(isCustom)
    );
  }

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('shop_cat_select')
      .setPlaceholder(`Category: ${cat.label}`)
      .addOptions(opts)
  );

  return { container, row: selectRow };
}

function resolveCategory(input) {
  if (!input) return 'consumable';
  const lower = String(input).toLowerCase();
  if (lower === CUSTOM_CATEGORY_ID) return CUSTOM_CATEGORY_ID;
  return CATEGORIES[lower] ? lower : 'consumable';
}

/* ═════════════════════════ COMMAND ═════════════════════════ */

module.exports = {
  data: new (require('discord.js').SlashCommandBuilder)()
    .setName('shop')
    .setDescription('Browse the economy shop')
    .addStringOption(o => o.setName('category').setDescription('Category to browse').setRequired(false)
      .addChoices(
        { name: 'Consumables', value: 'consumable' },
        { name: 'Boosts', value: 'boost' },
        { name: 'Loot Boxes', value: 'loot' },
        { name: 'Special', value: 'special' },
        { name: 'Seeds', value: 'seeds' },
        { name: 'Mining Gear', value: 'mining' },
        { name: 'Fishing Gear', value: 'fishing' },
        { name: 'Materials', value: 'materials' },
        { name: 'Custom Shop', value: 'custom' },
      )),
  prefix: 'shop',
  description: 'Browse the economy shop — buy items, boosts, loot boxes, and the server\'s custom shop',
  usage: 'shop [category]',
  aliases: ['store', 'market'],
  category: 'economy',

  async executePrefix(message, args) {
    if (await shopGuard(message)) return;
    const category = resolveCategory(args[0]);
    const { container, row } = buildShopPage(category, message.author.id, message.guild?.id);
    return message.reply({ components: [container, row], flags: MessageFlags.IsComponentsV2 });
  },

  async execute(interaction) {
    if (await shopGuard(interaction)) return;
    const category = resolveCategory(interaction.options?.getString('category'));
    const { container, row } = buildShopPage(category, interaction.user.id, interaction.guild?.id);
    return interaction.reply({ components: [container, row], flags: MessageFlags.IsComponentsV2 });
  },

  async handleStringSelect(interaction) {
    if (interaction.customId !== 'shop_cat_select') return false;
    const category = resolveCategory(interaction.values[0]);
    const { container, row } = buildShopPage(category, interaction.user.id, interaction.guild?.id);
    await interaction.update({ components: [container, row], flags: MessageFlags.IsComponentsV2 });
    return true;
  },
};
