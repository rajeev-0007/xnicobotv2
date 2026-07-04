const { createContainer, addTextDisplay, formatNumber, MessageFlags } = require('../../utils/componentHelpers');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const economyManager = require('../../utils/economyManager');
const ph = require('../../utils/petHelpers');

// Per-user re-entry guard for the coin-spending equip/upgrade flows.
// Without this, two parallel `weapon equip` / `weapon upgrade` (slash
// + prefix double-fire) could both pass the balance check on the
// same live cache and double-charge the user.
const inFlight = new Set();

const MAX_WEAPON_LEVEL = 10;

// Use shared WEAPONS catalog from petHelpers
const WEAPONS = ph.WEAPONS;

const RARITY_MULT = {
  common: 1,
  uncommon: 1.3,
  rare: 1.6,
  epic: 2,
  legendary: 2.5,
  mythic: 3.5,
};

/* ---------------- HELPERS ---------------- */

function load(file) { return ph.loadPets(); }
function save(file, data) { ph.savePets(data); }

/* ---------------- COMMAND ---------------- */

module.exports = {
  data: new (require('discord.js').SlashCommandBuilder)()
    .setName('weapon')
    .setDescription('Manage your pet weapons — equip, upgrade, or view info')
    .addStringOption(o => o.setName('action').setDescription('Action: list, equip, upgrade, info').setRequired(false)
      .addChoices(
        { name: 'List weapons', value: 'list' },
        { name: 'Equip weapon', value: 'equip' },
        { name: 'Upgrade weapon', value: 'upgrade' },
        { name: 'Weapon info', value: 'info' },
      ))
    .addStringOption(o => o.setName('id').setDescription('Weapon ID (for equip/upgrade/info)').setRequired(false)),
  prefix: 'weapon',
  description: 'Manage your pet weapons — equip, upgrade, or view info',
  usage: 'weapon <list|equip|upgrade|info> [id]',
  category: 'economy',
  aliases: ['weap'],

  async executePrefix(message, args) {
        const guildId = message.guild?.id;
    const pets = ph.loadPets();
    const userId = message.author.id;
    const sub = args[0];

    if (!pets[userId] || !pets[userId].activeBattlePet) {
      const c = createContainer(0xED4245); addTextDisplay(c, '<:Cancel:1521227723916181644> You don\'t have an active pet.');
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const pet = pets[userId].animals.find(p => p.id === pets[userId].activeBattlePet);
    if (!pet) {
      const c = createContainer(0xED4245); addTextDisplay(c, '<:Cancel:1521227723916181644> Active pet not found.');
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    /* ---------- LIST ---------- */
    if (!sub || sub === "list") {
      // Group by rarity so 20+ weapons stay readable. The catalog
      // already carries `rarity`, `price` and `description` on every
      // entry, so we render a compact line per weapon under each
      // rarity heading and finish with a short usage tip.
      const byRarity = ph.weaponsByRarity();
      const rarityEmoji = ph.RARITY_EMOJI || {};

      const lines = ['# 🗡️ Weapons Catalog', ''];
      for (const r of ph.RARITY_ORDER) {
        const list = byRarity[r];
        if (!list?.length) continue;
        lines.push(`### ${rarityEmoji[r] || '•'} ${r[0].toUpperCase() + r.slice(1)}`);
        for (const w of list) {
          const priceStr = w.price > 0
            ? `${formatCoins(w.price, guildId)}`
            : '*drop only*';
          lines.push(`> \`${w.id}\` — ${w.name} · +${w.baseAtk} ATK · ${priceStr}`);
        }
        lines.push('');
      }
      lines.push(`-# Use \`weapon equip <id>\` to equip · \`weapon upgrade\` to scale a weapon`);

      const container = createContainer();
      addTextDisplay(container, lines.join('\n'));
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    /* ---------- EQUIP ---------- */
    // `weapon equip <id>` — direct purchase + equip. The catalog now
    // spans common→legendary with prices ranging from 3k to 165k, so
    // we charge the user the catalog price up front (one-time) and
    // equip the weapon onto their active pet. Mythic weapons are
    // marked `price: 0` and can ONLY be obtained from a `weapon_crate`
    // drop, never bought directly.
    if (sub === "equip") {
      const id = args[1];
      if (!WEAPONS[id]) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, '<:Cancel:1521227723916181644> Weapon not found. Use `weapon list` to see the full catalog.');
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      }
      const def = WEAPONS[id];
      if (!def.price || def.price <= 0) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, [
          `<:Infotriangle:1521227710381428926> **${def.name}** is a drop-only weapon.`,
          '',
          `It can only be obtained from a \`weapon_crate\` (premium box). Use \`buy weapon_crate\` to try for it.`,
        ].join('\n'));
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      }

      // Already-equipped guard: prevents accidentally re-paying when
      // the same weapon is already on the pet.
      if (pet.weapon?.id === id) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, `<:Infotriangle:1521227710381428926> ${pet.emoji} **${pet.name}** already has **${def.name}** equipped.`);
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      }

      if (inFlight.has(userId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, '<:Infotriangle:1521227710381428926> A previous weapon equip/upgrade is still completing — try again in a moment.');
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      }

      inFlight.add(userId);
      try {
        const economy = economyManager.loadEconomy();
        const { userData: wUser } = economyManager.getUser(economy, userId);
        if (wUser.coins < def.price) {
          const c = createContainer(0xED4245);
          addTextDisplay(c, [
            `<:Cancel:1521227723916181644> Not enough coins to equip **${def.name}**.`,
            `${coinIcon(guildId)} Cost: **${formatCoinsAmount(def.price, guildId)}**`,
            `<:Money:1521228266957045900> Wallet: **${formatCoins(wUser.coins, guildId)}**`,
          ].join('\n'));
          return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        wUser.coins -= def.price;
        pet.weapon = {
          id,
          name: def.name,
          baseAtk: def.baseAtk,
          rarity: def.rarity,
          level: 1,
        };

        ph.savePets(pets);
        economyManager.saveEconomy(economy);

        const container = createContainer();
        addTextDisplay(container, [
          `# 🗡️ Weapon Equipped`,
          '',
          `<:Checkedbox:1521227734943269077> Equipped **${def.name}** *(${def.rarity})* to ${pet.emoji} **${pet.name}**`,
          `${coinIcon(guildId)} Cost: ${formatCoinsAmount(def.price, guildId)}`,
          `⚔️ Base ATK bonus: **+${def.baseAtk}**`,
        ].join('\n'));
        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      } finally {
        inFlight.delete(userId);
      }
    }

    /* ---------- UPGRADE ---------- */
    if (sub === "upgrade") {
      if (!pet.weapon) {
        const c = createContainer(0xED4245); addTextDisplay(c, '<:Cancel:1521227723916181644> No weapon equipped. Use `weapon equip <id>` first.');
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      }
      if (pet.weapon.level >= MAX_WEAPON_LEVEL) {
        const c = createContainer(0xFEE75C); addTextDisplay(c, '<:Infotriangle:1521227710381428926> Weapon already at max level!');
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      }

      if (inFlight.has(userId)) {
        const c = createContainer(0xFEE75C);
        addTextDisplay(c, '<:Infotriangle:1521227710381428926> A previous weapon equip/upgrade is still completing — try again in a moment.');
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      }

      const rarityMult = RARITY_MULT[pet.weapon.rarity] || 1;
      const cost = Math.floor(5000 * pet.weapon.level * rarityMult);

      inFlight.add(userId);
      try {
        const economy = economyManager.loadEconomy();
        const { userData: wUser } = economyManager.getUser(economy, userId);
        if (wUser.coins < cost) {
          const c = createContainer(0xED4245); addTextDisplay(c, `<:Cancel:1521227723916181644> You need **${formatCoins(cost, guildId)}** to upgrade.`);
          return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
        }

        wUser.coins -= cost;
        pet.weapon.level++;
        pet.weapon.baseAtk += 2;

        ph.savePets(pets);
        economyManager.saveEconomy(economy);

        const container = createContainer();
        addTextDisplay(container, `# 🗡️ Weapon Upgraded!\n\n` +
          `<:Star:1521227981685526568> Level: **${pet.weapon.level}/${MAX_WEAPON_LEVEL}**\n` +
          `⚔️ ATK: **${pet.weapon.baseAtk}**\n` +
          `${coinIcon(guildId)} Cost: ${formatCoinsAmount(cost, guildId)}`);

        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
      } finally {
        inFlight.delete(userId);
      }
    }

    /* ---------- INFO ---------- */
    if (sub === "info") {
      if (!pet.weapon) {
        const c = createContainer(0xED4245); addTextDisplay(c, '<:Cancel:1521227723916181644> No weapon equipped.');
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      }

      const container = createContainer();
      addTextDisplay(container, `# 🗡️ Weapon Info\n\n` +
        `**${pet.weapon.name}**\n` +
        `<:Star:1521227981685526568> Rarity: ${pet.weapon.rarity}\n` +
        `📈 Level: ${pet.weapon.level}/${MAX_WEAPON_LEVEL}\n` +
        `⚔️ ATK: ${pet.weapon.baseAtk}`);
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const c = createContainer(0xED4245); addTextDisplay(c, '<:Cancel:1521227723916181644> Invalid subcommand. Use `weapon list`, `weapon equip`, `weapon upgrade`, or `weapon info`.');
    return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  },

  async execute(interaction) {
        await interaction.deferReply({ flags: 1 << 15 });
    const sub = interaction.options?.getString('action') || 'list';
    const weaponId = interaction.options?.getString('id');
    const fakeArgs = [sub, weaponId].filter(Boolean);
    const fakeMessage = {
      author: interaction.user,
      reply: (opts) => interaction.editReply(opts),
    };
    return module.exports.executePrefix(fakeMessage, fakeArgs);
  }
};