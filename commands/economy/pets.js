'use strict';

const {
  ContainerBuilder, TextDisplayBuilder, ActionRowBuilder,
  StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const ph = require('../../utils/petHelpers');
const { formatCoins, formatCoinsShort } = require('../../utils/currencyHelper');

// Per-user re-entry guard for the weapon-equip select menu. Two
// rapid clicks on the same option (or slash + prefix variants
// running in parallel) can both pass the funds check and double-
// charge — the lock keeps a single equip in flight at a time.
const equipInFlight = new Set();

/* ═══════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════ */

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

/* ═══════════════════════════════════════════════════════
   VIEW 1 — OVERVIEW
   Shows total pets, active pet, rarity breakdown.
   StringSelectMenu to browse by rarity.
   ═══════════════════════════════════════════════════════ */

function viewOverview(user, uid) {
  const { animals } = user;
  const active = user.activeBattlePet ? animals.find(p => p.id === user.activeBattlePet) : null;
  const byR = ph.groupByRarity(animals);

  const lines = ['# <:Fire:1521227907647668374> Your Pets', ''];

  if (active) {
    lines.push(
      `> ⚔️ **Active:** ${active.emoji} **${active.name}** (Lv.${active.level || 1}) \`${active.id}\``,
      ''
    );
  } else {
    lines.push('> <:Infotriangle:1521227710381428926> **No active battle pet** — browse your pets below and click **⚔️ Set Active** on one!', '');
  }

  if (!animals.length) {
    lines.push(
      '<:Cancel:1521227723916181644> No pets yet.',
      '', '> Use `hunt` to catch your first pet!'
    );
    return new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  }

  lines.push(`<:Box:1521228152414666833> **Total:** ${animals.length} pets`, '');

  const breakdown = ph.RARITY_ORDER
    .filter(r => byR[r]?.length)
    .map(r => `${ph.RARITY_EMOJI[r]} ${cap(r)}: **${byR[r].length}**`);
  lines.push(breakdown.join(' ┊ '), '');
  lines.push('### How to manage your pets:');
  lines.push('1. **Select a rarity** from the dropdown below to browse');
  lines.push('2. Pick a **pet type** to see all your copies');
  lines.push('3. Select a specific **pet** to view stats, equip weapons, or set as active');
  lines.push('');
  lines.push('-# Use `hunt` to catch new pets • `battle` to fight with your active pet');

  const ctr = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  const opts = ph.RARITY_ORDER
    .filter(r => byR[r]?.length)
    .map(r => ({ label: `${cap(r)} (${byR[r].length})`, value: r, description: `View your ${r} pets` }));

  if (opts.length > 1) {
    opts.unshift({ label: `All Pets (${animals.length})`, value: 'all', description: 'View all pets across rarities' });
  }

  ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`pets:rar:${uid}`)
      .setPlaceholder('🐾 Select rarity to browse')
      .addOptions(opts.slice(0, 25))
  ));

  return ctr;
}

/* ═══════════════════════════════════════════════════════
   VIEW 2 — RARITY CATEGORY
   Shows all pet types of chosen rarity, stacked.
   StringSelectMenu to pick a pet type.
   ═══════════════════════════════════════════════════════ */

function viewRarity(user, uid, rarity) {
  const list = rarity === 'all' ? user.animals : user.animals.filter(p => (p.rarity || 'common') === rarity);
  const groups = ph.groupByType(list);
  const label = rarity === 'all' ? 'All' : cap(rarity);
  const color = rarity === 'all' ? 0x7c3aed : (ph.RARITY_COLOR[rarity] || 0x7c3aed);

  const lines = [
    `# ${rarity === 'all' ? '<:Box:1521228152414666833>' : (ph.RARITY_EMOJI[rarity] || '<:Box:1521228152414666833>')} ${label} Pets`,
    '',
  ];

  if (!groups.length) {
    lines.push(`<:Cancel:1521227723916181644> No ${rarity} pets.`);
  } else {
    for (const g of groups) {
      const best = Math.max(...g.pets.map(p => p.level || 1));
      const armed = g.pets.some(p => p.weapon);
      const here = g.pets.some(p => p.id === user.activeBattlePet);
      lines.push(`${g.emoji} **${g.name}** ×${g.pets.length} — Best Lv.${best}${armed ? ' 🗡️' : ''}${here ? ' ⚔️' : ''}`);
    }
  }

  const ctr = new ContainerBuilder().setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  if (groups.length) {
    const opts = groups.map(g => ({
      label: `${g.name} ×${g.pets.length}`.substring(0, 100),
      value: `${g.typeId}|${rarity}`,
      description: `${cap(g.rarity)} — Best Lv.${Math.max(...g.pets.map(p => p.level || 1))}`.substring(0, 100),
      emoji: g.emoji || undefined,
    }));
    ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`pets:grp:${uid}`)
        .setPlaceholder('🐾 Select a pet type')
        .addOptions(opts.slice(0, 25))
    ));
  }

  ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pets:bk:${uid}:main`).setEmoji('<:History:1521227863079256278>').setLabel('Back').setStyle(ButtonStyle.Secondary)
  ));

  return ctr;
}

/* ═══════════════════════════════════════════════════════
   VIEW 3 — PET GROUP  (stacked type view)
   Shows all individual instances of the same pet type.
   StringSelectMenu to pick individual for details.
   ═══════════════════════════════════════════════════════ */

function viewGroup(user, uid, typeId, fromRarity) {
  const groups = ph.groupByType(user.animals);
  const grp = groups.find(g => g.typeId === typeId);
  if (!grp) return viewRarity(user, uid, fromRarity);

  const color = ph.RARITY_COLOR[grp.rarity] || 0x7c3aed;
  const lines = [
    `# ${grp.emoji} ${grp.name}`,
    `${ph.RARITY_EMOJI[grp.rarity]} **${cap(grp.rarity)}** — Owned: **${grp.pets.length}**`,
    '',
  ];

  for (const [i, p] of grp.pets.entries()) {
    const active = user.activeBattlePet === p.id;
    const wpn = p.weapon ? `🗡️ ${p.weapon.name} Lv.${p.weapon.level || 1}` : '—';
    lines.push(
      `${active ? '⚔️' : `**${i + 1}.**`} \`${p.id}\` Lv.${p.level || 1}`,
      `> <:Heart:1521228100652765247> ${p.baseHp || p.hp} ┊ ⚔️ ${p.baseAtk || p.atk} ┊ ${wpn}`,
    );
  }

  const ctr = new ContainerBuilder().setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  // Select menu for individual pets
  if (grp.pets.length > 0) {
    const pOpts = grp.pets.map((p, i) => ({
      label: `${p.name} #${i + 1} (Lv.${p.level || 1})`.substring(0, 100),
      value: `${p.id}|${fromRarity}`,
      description: `${p.id}${p.weapon ? ` | ${p.weapon.name}` : ''}${p.id === user.activeBattlePet ? ' | Active' : ''}`.substring(0, 100),
    }));
    ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`pets:sel:${uid}`)
        .setPlaceholder('🐾 Select a pet to manage')
        .addOptions(pOpts.slice(0, 25))
    ));
  }

  ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pets:bk:${uid}:rar:${fromRarity}`).setEmoji('<:History:1521227863079256278>').setLabel('Back').setStyle(ButtonStyle.Secondary)
  ));

  return ctr;
}

/* ═══════════════════════════════════════════════════════
   VIEW 4 — PET DETAIL
   Full info for a single pet instance.
   Buttons: Set Active, Weapon, Back.
   ═══════════════════════════════════════════════════════ */

function viewDetail(user, uid, petId, fromRarity) {
  const pet = user.animals.find(p => p.id === petId);
  if (!pet) return viewOverview(user, uid);

  const isActive = user.activeBattlePet === petId;
  const color = ph.RARITY_COLOR[pet.rarity] || 0x7c3aed;
  const lv = pet.level || 1;
  const equipped = (pet.skills || ['slash']).map(s => ph.SKILL_LABEL[s] || s);
  const learnedCount = (pet.learnedSkills || pet.skills || ['slash']).length;
  const maxEquipped = ph.MAX_EQUIPPED_SKILLS || 3;

  const lines = [
    `# ${pet.emoji} ${pet.name}${isActive ? ' ⚔️' : ''}`,
    `${ph.RARITY_EMOJI[pet.rarity]} **${cap(pet.rarity)}** — \`${pet.id}\``,
    '',
    `<:Heart:1521228100652765247> HP: **${pet.baseHp || pet.hp}** ┊ ⚔️ ATK: **${pet.baseAtk || pet.atk}**`,
    `<:Invoice:1521227903956811836> Level: **${lv}** ┊ XP: **${pet.exp || 0}/${lv * 100}**`,
    '',
    `🗡️ **Weapon:** ${pet.weapon ? `${pet.weapon.name} (Lv.${pet.weapon.level || 1}) +${pet.weapon.baseAtk} ATK` : 'None'}`,
    `<:Lightningalt:1521227851796447472> **Equipped Skills:** ${equipped.join(', ')} *(${equipped.length}/${maxEquipped})*`,
    `<:Document:1521227875016114266> **Learned:** ${learnedCount} skill${learnedCount === 1 ? '' : 's'} — manage with \`skill\``,
  ];

  const ctr = new ContainerBuilder().setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  const btns = [];
  if (!isActive) {
    btns.push(new ButtonBuilder().setCustomId(`pets:act:${uid}:${petId}`).setLabel('⚔️ Set Active').setStyle(ButtonStyle.Primary));
  } else {
    btns.push(new ButtonBuilder().setCustomId(`pets:act:${uid}:${petId}`).setEmoji('<:Checkedbox:1521227734943269077>').setLabel('Active').setStyle(ButtonStyle.Success).setDisabled(true));
  }
  btns.push(
    new ButtonBuilder().setCustomId(`pets:wpn:${uid}:${petId}:${fromRarity}`).setLabel('🗡️ Weapon').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`pets:bk:${uid}:grp:${ph.baseId(pet.rarity, pet.name)}:${fromRarity}`).setEmoji('<:History:1521227863079256278>').setLabel('Back').setStyle(ButtonStyle.Secondary),
  );

  ctr.addActionRowComponents(new ActionRowBuilder().addComponents(...btns));
  return ctr;
}

/* ═══════════════════════════════════════════════════════
   VIEW 5 — WEAPON EQUIP
   Lets user pick a weapon to equip on the pet.
   ═══════════════════════════════════════════════════════ */

function viewWeapon(user, uid, petId, fromRarity) {
  const pet = user.animals.find(p => p.id === petId);
  if (!pet) return viewOverview(user, uid);

  const color = ph.RARITY_COLOR[pet.rarity] || 0x7c3aed;
  const lines = [`# 🗡️ Weapon — ${pet.emoji} ${pet.name}`, ''];

  if (pet.weapon) {
    lines.push(
      `**Equipped:** ${pet.weapon.name}`,
      `> ⚔️ ATK: +${pet.weapon.baseAtk} ┊ <:Star:1521227981685526568> Level: ${pet.weapon.level || 1}/10  ·  Rarity: ${pet.weapon.rarity || 'common'}`,
      '', '> Pick a different weapon below to switch — purchasing it deducts the catalog price.',
    );
  } else {
    lines.push('> No weapon equipped. Pick one below — its catalog price is deducted from your wallet.', '');
  }

  // The catalog now spans common→legendary, plus drop-only mythics.
  // The select menu can only show 25 options so we filter to weapons
  // the user can actually buy (price > 0). Mythic drop-only entries
  // are surfaced in the description text instead, with a note that
  // they come from `weapon_crate` only.
  const buyable = Object.entries(ph.WEAPONS)
    .filter(([, w]) => (w.price || 0) > 0)
    .sort((a, b) => (a[1].price || 0) - (b[1].price || 0));
  const dropOnly = Object.entries(ph.WEAPONS).filter(([, w]) => !w.price);

  lines.push('', '**Catalog:**');
  for (const [, w] of buyable.slice(0, 12)) {
    lines.push(`> ${w.name} · +${w.baseAtk} ATK · ${formatCoins(w.price)}`);
  }
  if (buyable.length > 12) {
    lines.push(`> -# …and ${buyable.length - 12} more — pick from the menu below`);
  }
  if (dropOnly.length) {
    lines.push('');
    lines.push(`-# Drop-only mythics (\`weapon_crate\` only): ${dropOnly.map(([, w]) => w.name).join(', ')}`);
  }

  const ctr = new ContainerBuilder().setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  // Cap at 25 options — the StringSelectMenu hard limit. We sort by
  // price ascending so the cheapest weapons are always reachable here
  // even if the catalog grows beyond 25 buyable entries in the future.
  const wOpts = buyable.slice(0, 25).map(([id, w]) => ({
    label: `${w.name.replace(/[^\w\s]/g, '').trim()} (+${w.baseAtk} ATK)`.substring(0, 100),
    value: `${id}|${petId}|${fromRarity}`,
    description: `${w.rarity} · ${formatCoins(w.price)} coins`.substring(0, 100),
  }));
  ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`pets:weq:${uid}`)
      .setPlaceholder('🗡️ Select weapon to equip (deducts coins)')
      .addOptions(wOpts)
  ));

  ctr.addActionRowComponents(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`pets:bk:${uid}:det:${petId}:${fromRarity}`).setEmoji('<:History:1521227863079256278>').setLabel('Back').setStyle(ButtonStyle.Secondary)
  ));

  return ctr;
}

/* ═══════════════════════════════════════════════════════
   COMMAND EXPORT
   ═══════════════════════════════════════════════════════ */

module.exports = {
  data: new (require('discord.js').SlashCommandBuilder)()
    .setName('pets')
    .setDescription('View and manage your pet collection'),
  name: 'pets',
  prefix: 'pets',
  aliases: ['mypets'],
  category: 'economy',
  description: 'View and manage your pet collection',

  async executePrefix(message, args) {
    const data = ph.loadPets();
    const user = ph.ensureUser(data, message.author.id);
    const uid = message.author.id;

    /* ─── pets active [id] ─── */
    if (args[0] === 'active') {
      const petId = args[1];

      if (petId) {
        // Direct set by ID
        const pet = user.animals.find(p => p.id === petId);
        if (!pet) return message.reply('<:Cancel:1521227723916181644> Pet not found. Use `pets` to browse.');
        user.activeBattlePet = petId;
        ph.savePets(data);
        const ctr = new ContainerBuilder()
          .setAccentColor(ph.RARITY_COLOR[pet.rarity] || 0x22c55e)
          .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `# <:Checkedbox:1521227734943269077> Battle Pet Set\n\n` +
            `${pet.emoji} **${pet.name}** (Lv.${pet.level || 1}) is now your active battle pet!\n` +
            `> \`${pet.id}\`\n\n> Use \`battle\` to fight enemies or \`battle pvp @user\` to challenge players.`
          ));
        return message.reply({ components: [ctr], flags: MessageFlags.IsComponentsV2 });
      }

      // No ID — open interactive overview for selection
    }

    return message.reply({
      components: [viewOverview(user, uid)],
      flags: MessageFlags.IsComponentsV2,
    });
  },

  /* ═══════════════════════════════════════════════════════
     INTERACTION HANDLER
     ═══════════════════════════════════════════════════════ */

  async handleInteraction(interaction) {
    if (!interaction.customId?.startsWith('pets:')) return false;

    const parts = interaction.customId.split(':');
    const action = parts[1];
    const uid = parts[2];

    /* ── deny non-owner ── */
    if (interaction.user.id !== uid) {
      await interaction.reply({
        content: '<:Cancel:1521227723916181644> This menu belongs to someone else.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const data = ph.loadPets();
    const user = ph.ensureUser(data, uid);

    /* ── RARITY SELECT ── */
    if (interaction.isStringSelectMenu() && action === 'rar') {
      const rarity = interaction.values[0];
      await interaction.update({ components: [viewRarity(user, uid, rarity)], flags: MessageFlags.IsComponentsV2 });
      return true;
    }

    /* ── GROUP SELECT ── */
    if (interaction.isStringSelectMenu() && action === 'grp') {
      const [typeId, fromRarity] = interaction.values[0].split('|');
      await interaction.update({ components: [viewGroup(user, uid, typeId, fromRarity)], flags: MessageFlags.IsComponentsV2 });
      return true;
    }

    /* ── INDIVIDUAL PET SELECT ── */
    if (interaction.isStringSelectMenu() && action === 'sel') {
      const [petId, fromRarity] = interaction.values[0].split('|');
      await interaction.update({ components: [viewDetail(user, uid, petId, fromRarity)], flags: MessageFlags.IsComponentsV2 });
      return true;
    }

    /* ── SET ACTIVE ── */
    if (interaction.isButton() && action === 'act') {
      const petId = parts[3];
      const pet = user.animals.find(p => p.id === petId);
      if (!pet) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> Pet no longer exists.', flags: MessageFlags.Ephemeral });
        return true;
      }
      user.activeBattlePet = petId;
      ph.savePets(data);
      await interaction.update({ components: [viewOverview(user, uid)], flags: MessageFlags.IsComponentsV2 });
      return true;
    }

    /* ── WEAPON VIEW ── */
    if (interaction.isButton() && action === 'wpn') {
      const petId = parts[3];
      const fromRarity = parts[4] || 'all';
      await interaction.update({ components: [viewWeapon(user, uid, petId, fromRarity)], flags: MessageFlags.IsComponentsV2 });
      return true;
    }

    /* ── WEAPON EQUIP SELECT ──
       Mirrors the paid-equip flow used by `weapon equip <id>` so the
       catalog is the single source of truth and selecting a weapon
       through this menu can't bypass its price. */
    if (interaction.isStringSelectMenu() && action === 'weq') {
      const [weaponId, petId, fromRarity] = interaction.values[0].split('|');
      const pet = user.animals.find(p => p.id === petId);
      const wpDef = ph.WEAPONS[weaponId];
      if (!pet || !wpDef) {
        await interaction.reply({ content: '<:Cancel:1521227723916181644> Invalid selection.', flags: MessageFlags.Ephemeral });
        return true;
      }

      // Drop-only (mythic) weapons can't be bought through this menu.
      if (!wpDef.price || wpDef.price <= 0) {
        await interaction.reply({
          content: `<:Infotriangle:1521227710381428926> **${wpDef.name}** is a drop-only weapon — open a \`weapon_crate\` to roll for it.`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      // Same weapon already equipped → don't double-charge.
      if (pet.weapon?.id === weaponId) {
        await interaction.reply({
          content: `<:Infotriangle:1521227710381428926> **${wpDef.name}** is already equipped on this pet.`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      if (equipInFlight.has(uid)) {
        await interaction.reply({
          content: '<:Infotriangle:1521227710381428926> Your previous weapon equip is still completing — try again in a moment.',
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      equipInFlight.add(uid);
      try {
        const economyManager = require('../../utils/economyManager');
        const economy = economyManager.loadEconomy();
        const { userData } = economyManager.getUser(economy, uid);
        if (userData.coins < wpDef.price) {
          await interaction.reply({
            content: `<:Cancel:1521227723916181644> Not enough coins. **${wpDef.name}** costs **${wpDef.price.toLocaleString()}** but you have **${userData.coins.toLocaleString()}**.`,
            flags: MessageFlags.Ephemeral,
          });
          return true;
        }

        userData.coins -= wpDef.price;
        pet.weapon = { id: weaponId, name: wpDef.name, baseAtk: wpDef.baseAtk, level: 1, rarity: wpDef.rarity };
        ph.savePets(data);
        economyManager.saveEconomy(economy);

        await interaction.update({ components: [viewDetail(user, uid, petId, fromRarity)], flags: MessageFlags.IsComponentsV2 });
        return true;
      } finally {
        equipInFlight.delete(uid);
      }
    }

    /* ── BACK NAVIGATION ── */
    if (interaction.isButton() && action === 'bk') {
      const target = parts[3];
      if (target === 'main') {
        await interaction.update({ components: [viewOverview(user, uid)], flags: MessageFlags.IsComponentsV2 });
      } else if (target === 'rar') {
        const rarity = parts[4] || 'all';
        await interaction.update({ components: [viewRarity(user, uid, rarity)], flags: MessageFlags.IsComponentsV2 });
      } else if (target === 'grp') {
        const typeId = parts[4];
        const fromRarity = parts[5] || 'all';
        await interaction.update({ components: [viewGroup(user, uid, typeId, fromRarity)], flags: MessageFlags.IsComponentsV2 });
      } else if (target === 'det') {
        const petId = parts[4];
        const fromRarity = parts[5] || 'all';
        await interaction.update({ components: [viewDetail(user, uid, petId, fromRarity)], flags: MessageFlags.IsComponentsV2 });
      } else {
        await interaction.update({ components: [viewOverview(user, uid)], flags: MessageFlags.IsComponentsV2 });
      }
      return true;
    }

    return false;
  },

  async execute(interaction) {
        await interaction.deferReply({ flags: 1 << 15 });
    const fakeMessage = {
      author: interaction.user,
      reply: (opts) => interaction.editReply(opts),
    };
    return module.exports.executePrefix(fakeMessage, []);
  },
};
