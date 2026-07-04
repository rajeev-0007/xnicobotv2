'use strict';

/**
 * craft — Use ores to craft shop-grade items.
 *
 * Inputs (ores) live in `userData.oreInventory` (object map of
 * id → qty), which is set by /mine. Outputs are *real shop items*
 * (iron_pickaxe, lucky_charm, shield, trophy, …) — they need to end
 * up in the same jsonStore inventory bucket that /buy, /shop and
 * /inventory all read from. The previous version dumped them into
 * a legacy `userData.inventory` object map that nothing else
 * reads, so crafted pickaxes were invisible to /mine and crafted
 * shop items were invisible to /shop.
 *
 * Fallback: stone & wood don't fit the ore table on every code
 * path, so we also accept materials from a legacy
 * `userData.inventory` object map for input consumption only.
 */

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { formatCoins, formatCoinsShort } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const { getAllRecipes, getRecipe } = require('../../utils/craftingRecipes');
const { ITEMS } = require('../../utils/shopItems');
const { EMOJIS } = require('../../utils/economyEmojis');
const jsonStore = require('../../utils/jsonStore');

function loadInv()      { return jsonStore.has('inventory') ? (jsonStore.read('inventory') || {}) : {}; }
function saveInv(data)  { jsonStore.write('inventory', data); }

/** Total qty of a material across the user's known stores. */
function materialQty(userData, mat, globalInv, userId) {
  const ore = Number((userData.oreInventory || {})[mat] || 0);

  // Some materials (stone, wood) can also exist as shop items in
  // the global inventory store. Count those too.
  const slots = Array.isArray(globalInv?.[userId]) ? globalInv[userId] : [];
  const fromGlobal = slots.filter(it => it && it.id === mat).length;

  // Legacy fallback for any data still on the userData map.
  const legacy = userData.inventory;
  const fromLegacy = (legacy && typeof legacy === 'object' && !Array.isArray(legacy))
    ? Number(legacy[mat] || 0) : 0;

  return ore + fromGlobal + fromLegacy;
}

/** Consume `qty` of `mat` from oreInventory → globalInv → legacy. */
function consumeMaterial(userData, mat, qty, globalInv, userId) {
  let need = qty;

  // 1. Ore inventory (where /mine puts ores).
  const ore = userData.oreInventory || {};
  if ((ore[mat] || 0) > 0) {
    const take = Math.min(need, ore[mat]);
    ore[mat] -= take;
    need -= take;
    if (ore[mat] <= 0) delete ore[mat];
  }
  userData.oreInventory = ore;

  // 2. Global inventory store (where /buy puts shop materials).
  if (need > 0 && Array.isArray(globalInv?.[userId])) {
    const slots = globalInv[userId];
    for (let i = 0; i < slots.length && need > 0; ) {
      if (slots[i] && slots[i].id === mat) {
        slots.splice(i, 1);
        need--;
      } else {
        i++;
      }
    }
  }

  // 3. Legacy fallback object map.
  if (need > 0) {
    const legacy = userData.inventory;
    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
      const take = Math.min(need, legacy[mat] || 0);
      legacy[mat] -= take;
      need -= take;
      if (legacy[mat] <= 0) delete legacy[mat];
    }
  }

  return need === 0;
}

async function handleCraft(reply, userId, recipeId, guildId) {
  const economy = economyManager.loadEconomy();
  const { userData } = economyManager.getUser(economy, userId);
  userData.oreInventory = userData.oreInventory || {};

  /* ── LIST ── */
  if (!recipeId || recipeId === 'list') {
    const recipes = getAllRecipes();
    const lines = recipes.map(r => {
      const inputStr = Object.entries(r.inputs)
        .map(([mat, qty]) => `${qty}× \`${mat}\``)
        .join(', ');
      return `> ${r.emoji} **${r.name}** (\`${r.id}\`)\n> *${r.description}*\n> **Needs:** ${inputStr}`;
    });
    const c = createContainer(0xCAD7E6);
    addTextDisplay(c, [
      `# 🔨 Crafting Bench`,
      '',
      ...lines,
      '',
      `Use \`craft <recipe_id>\` to craft an item.`,
      `-# Mine ores using \`mine\` — view ores in \`inventory\``,
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  /* ── CRAFT ── */
  const recipe = getRecipe(recipeId);
  if (!recipe) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `${EMOJIS.cancel} Recipe \`${recipeId}\` not found. Use \`craft list\` to see all recipes.`);
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  const globalInv = loadInv();
  globalInv[userId] ||= [];

  const missing = [];
  for (const [mat, qty] of Object.entries(recipe.inputs)) {
    const have = materialQty(userData, mat, globalInv, userId);
    if (have < qty) {
      missing.push(`${qty}× \`${mat}\` (have ${have})`);
    }
  }

  if (missing.length > 0) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, [
      `${EMOJIS.cancel} **Not enough materials** to craft **${recipe.name}**!`,
      '',
      `**Missing:**`,
      ...missing.map(m => `> ${m}`),
    ].join('\n'));
    return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // Consume inputs.
  for (const [mat, qty] of Object.entries(recipe.inputs)) {
    const ok = consumeMaterial(userData, mat, qty, globalInv, userId);
    if (!ok) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, `${EMOJIS.cancel} Inventory drift — couldn't consume \`${mat}\` × ${qty}. Try again.`);
      return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
  }

  // Push outputs into the SAME store /buy uses so /shop, /inventory,
  // /mine and /use all see them.
  const outId  = recipe.output.id;
  const outQty = recipe.output.qty;
  const outMeta = ITEMS[outId];
  for (let i = 0; i < outQty; i++) {
    globalInv[userId].push({ id: outId, boughtAt: Date.now(), crafted: true });
  }

  userData.craftCount = (userData.craftCount || 0) + 1;
  economyManager.checkAllAchievements(economy, userId);

  // Persist BOTH stores so the consume + grant pair survive a crash.
  saveInv(globalInv);
  economyManager.saveEconomy(economy);

  const inputStr = Object.entries(recipe.inputs).map(([m, q]) => `${q}× ${m}`).join(', ');

  const c = createContainer(0xCAD7E6);
  addTextDisplay(c, [
    `# 🔨 Item Crafted!`,
    '',
    `${recipe.emoji} **${recipe.name}** (×${outQty}) added to your inventory!`,
    outMeta ? `-# Browse with \`inventory\` · use with \`use ${outId}\`` : '',
    '',
    `🪵 **Materials used:** ${inputStr}`,
    `🔧 **Total crafts:** ${formatNumber(userData.craftCount)}`,
  ].filter(Boolean).join('\n'));
  return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('craft')
    .setDescription('Craft items using ores and materials')
    .addStringOption(o => o.setName('recipe').setDescription('Recipe ID to craft, or "list" to see all').setRequired(false)),
  prefix: 'craft',
  aliases: ['crafting', 'make'],
  category: 'economy',
  description: 'Craft items using ores and materials',
  usage: 'craft [list|<recipe_id>]',

  async executePrefix(message, args) {
    return handleCraft(message.reply.bind(message), message.author.id, args[0]?.toLowerCase() || 'list', message.guild?.id);
  },

  async execute(interaction) {
    const recipe = interaction.options.getString('recipe') || 'list';
    return handleCraft(interaction.reply.bind(interaction), interaction.user.id, recipe.toLowerCase(), interaction.guild?.id);
  },
};
