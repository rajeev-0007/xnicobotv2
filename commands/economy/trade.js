'use strict';

/**
 * /trade — Direct trades between two users.
 *
 * Modes
 * ─────
 *   trade weapon @user                     Move active pet's weapon to their active pet
 *   trade item @user <id> [qty]            Send N of an item to them (free)
 *   trade pet @user <petId>                Transfer a pet outright
 *
 * All paths require explicit "Accept" from the recipient inside 30 s.
 * State is rechecked at confirm time so the displayed deal still
 * matches the one being committed (no stale snapshots).
 *
 * The `auction` command is the place for paid sales — `trade` is
 * exclusively for free transfers between trusted users.
 */

const { ButtonBuilder, ActionRowBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { formatCoins } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, getErrorContainer } = require('../../utils/componentHelpers');
const ph = require('../../utils/petHelpers');
const jsonStore = require('../../utils/jsonStore');
const { ITEMS, getItem } = require('../../utils/shopItems');
const { resolveUser } = require('../../utils/resolveUser');

const inFlight = new Set();

function loadInv() { return jsonStore.has('inventory') ? (jsonStore.read('inventory') || {}) : {}; }
function saveInv(d) { jsonStore.write('inventory', d); }

function ownedItemQty(inv, userId, itemId) {
  const slots = Array.isArray(inv?.[userId]) ? inv[userId] : [];
  return slots.filter(s => s && s.id === itemId).length;
}

function moveItems(inv, fromId, toId, itemId, qty) {
  inv[fromId] ||= [];
  inv[toId]   ||= [];
  let removed = 0;
  inv[fromId] = inv[fromId].filter(slot => {
    if (slot && slot.id === itemId && removed < qty) { removed++; return false; }
    return true;
  });
  const now = Date.now();
  for (let i = 0; i < removed; i++) inv[toId].push({ id: itemId, boughtAt: now, fromTrade: true });
  return removed;
}

/* ═══════════════════════════════════════════════════════════════
   WEAPON TRADE (legacy flow, preserved)
   ═══════════════════════════════════════════════════════════════ */

async function handleWeaponTrade(message, target) {
  const pets = ph.loadPets();
  const senderId = message.author.id;
  const receiverId = target.id;

  const senderData = pets[senderId];
  if (!senderData?.activeBattlePet) {
    const c = createContainer(0xED4245); addTextDisplay(c, '<:Cancel:1521227723916181644> You do not have an active battle pet.');
    return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }
  const senderPet = senderData.animals?.find(p => p.id === senderData.activeBattlePet);
  if (!senderPet) {
    const c = createContainer(0xED4245); addTextDisplay(c, '<:Cancel:1521227723916181644> Active pet not found.');
    return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }
  if (!senderPet.weapon) {
    const c = createContainer(0xED4245); addTextDisplay(c, '<:Cancel:1521227723916181644> Your active pet has no weapon to trade.');
    return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }
  const receiverData = pets[receiverId];
  if (!receiverData?.activeBattlePet) {
    const c = createContainer(0xED4245); addTextDisplay(c, `<:Cancel:1521227723916181644> **${target.username}** does not have an active battle pet.`);
    return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }
  const receiverPet = receiverData.animals?.find(p => p.id === receiverData.activeBattlePet);
  if (!receiverPet) {
    const c = createContainer(0xED4245); addTextDisplay(c, `<:Cancel:1521227723916181644> **${target.username}**'s active pet not found.`);
    return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  const weapon = senderPet.weapon;
  const container = createContainer();
  addTextDisplay(container, `# <:History:1521227863079256278> Weapon Trade\n\n` +
    `**${message.author.username}** → **${target.username}**\n\n` +
    `🗡️ **${weapon.name}** (Lv.${weapon.level || 1})\n` +
    `⚔️ ATK: +${weapon.baseAtk}\n\n` +
    `From: ${senderPet.emoji} **${senderPet.name}**\n` +
    `To: ${receiverPet.emoji} **${receiverPet.name}**` +
    (receiverPet.weapon ? `\n\n<:Infotriangle:1521227710381428926> This will **replace** ${target.username}'s current weapon!` : ''));

  const sessId = `trade_w_${Date.now()}_${senderId}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${sessId}_accept`).setEmoji('<:Checkedbox:1521227734943269077>').setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${sessId}_decline`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Decline').setStyle(ButtonStyle.Danger)
  );
  const msg = await message.reply({ components: [container, row], flags: MessageFlags.IsComponentsV2 });

  const collector = msg.createMessageComponentCollector({ time: 30_000 });
  collector.on('collect', async i => {
    if (i.user.id !== receiverId) {
      await i.reply({ components: [getErrorContainer('Only the trade recipient can respond.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }
    await i.deferUpdate();
    if (i.customId === `${sessId}_decline`) {
      collector.stop();
      const c = createContainer(); addTextDisplay(c, '<:Cancel:1521227723916181644> Trade declined.');
      return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
    if (i.customId === `${sessId}_accept`) {
      const freshPets = ph.loadPets();
      const sPet = freshPets[senderId]?.animals?.find(p => p.id === freshPets[senderId]?.activeBattlePet);
      const rPet = freshPets[receiverId]?.animals?.find(p => p.id === freshPets[receiverId]?.activeBattlePet);
      if (!sPet?.weapon) {
        collector.stop();
        const c = createContainer(); addTextDisplay(c, '<:Cancel:1521227723916181644> Weapon no longer available.');
        return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }
      if (!rPet) {
        collector.stop();
        const c = createContainer(); addTextDisplay(c, `<:Cancel:1521227723916181644> ${target.username}'s active pet no longer valid.`);
        return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }
      rPet.weapon = sPet.weapon;
      sPet.weapon = null;
      ph.savePets(freshPets);
      collector.stop();
      const c = createContainer();
      addTextDisplay(c, `# <:Checkedbox:1521227734943269077> Trade Complete\n\n` +
        `🗡️ **${weapon.name}** transferred!\n` +
        `${sPet.emoji} ${sPet.name} → ${rPet.emoji} ${rPet.name}`);
      return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
  });
  collector.on('end', (_collected, reason) => {
    if (reason === 'time') {
      const c = createContainer();
      addTextDisplay(c, '<:Clock:1521228110408847623> Trade timed out.');
      msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   ITEM TRADE
   ═══════════════════════════════════════════════════════════════ */

async function handleItemTrade(message, target, itemId, qty) {
  const senderId = message.author.id;
  const meta = getItem(itemId);
  if (!meta) {
    const c = createContainer(0xED4245); addTextDisplay(c, `<:Cancel:1521227723916181644> Unknown item \`${itemId}\`.`);
    return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }
  qty = Math.max(1, Math.min(qty || 1, 100));

  const inv = loadInv();
  const owned = ownedItemQty(inv, senderId, itemId);
  if (owned < qty) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `<:Cancel:1521227723916181644> You only have **${owned}× ${meta.name}** but tried to trade **${qty}**.`);
    return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  // Recipient cap check (so we don't quietly waste over-cap items).
  const receiverHas = ownedItemQty(inv, target.id, itemId);
  const cap = Number(meta.maxOwn || Infinity);
  if (receiverHas + qty > cap) {
    const c = createContainer(0xFEE75C);
    addTextDisplay(c, [
      `<:Infotriangle:1521227710381428926> **${target.username}** can hold at most **${cap}× ${meta.name}** — they already have **${receiverHas}**.`,
      `Send at most **${Math.max(0, cap - receiverHas)}**.`,
    ].join('\n'));
    return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }

  const container = createContainer();
  addTextDisplay(container, [
    `# <:History:1521227863079256278> Item Trade`,
    '',
    `**${message.author.username}** → **${target.username}**`,
    '',
    `${meta.emoji} **${meta.name}** ×${qty}`,
    '',
    `-# Recipient must accept within 30 seconds.`,
  ].join('\n'));

  const sessId = `trade_i_${Date.now()}_${senderId}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${sessId}_accept`).setEmoji('<:Checkedbox:1521227734943269077>').setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${sessId}_decline`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Decline').setStyle(ButtonStyle.Danger)
  );
  const msg = await message.reply({ components: [container, row], flags: MessageFlags.IsComponentsV2 });

  const collector = msg.createMessageComponentCollector({ time: 30_000 });
  collector.on('collect', async i => {
    if (i.user.id !== target.id) {
      await i.reply({ components: [getErrorContainer('Only the trade recipient can respond.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }
    await i.deferUpdate();
    if (i.customId === `${sessId}_decline`) {
      collector.stop();
      const c = createContainer(); addTextDisplay(c, '<:Cancel:1521227723916181644> Trade declined.');
      return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
    if (i.customId === `${sessId}_accept`) {
      if (inFlight.has(senderId)) {
        return msg.edit({ components: [createContainer().toJSON?.() || createContainer()], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      }
      inFlight.add(senderId);
      try {
        const fresh = loadInv();
        const freshOwned = ownedItemQty(fresh, senderId, itemId);
        if (freshOwned < qty) {
          collector.stop();
          const c = createContainer();
          addTextDisplay(c, `<:Cancel:1521227723916181644> Sender no longer has **${qty}× ${meta.name}**.`);
          return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
        const moved = moveItems(fresh, senderId, target.id, itemId, qty);
        saveInv(fresh);
        collector.stop();
        const c = createContainer();
        addTextDisplay(c, [
          `# <:Checkedbox:1521227734943269077> Trade Complete`,
          '',
          `${meta.emoji} **${moved}× ${meta.name}** transferred`,
          `**${message.author.username}** → **${target.username}**`,
        ].join('\n'));
        return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      } finally {
        inFlight.delete(senderId);
      }
    }
  });
  collector.on('end', (_collected, reason) => {
    if (reason === 'time') {
      const c = createContainer();
      addTextDisplay(c, '<:Clock:1521228110408847623> Trade timed out.');
      msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   PET TRADE
   ═══════════════════════════════════════════════════════════════ */

async function handlePetTrade(message, target, petId) {
  const senderId = message.author.id;
  const pets = ph.loadPets();
  ph.ensureUser(pets, senderId);
  const animals = pets[senderId].animals || [];
  if (animals.length <= 1) {
    const c = createContainer(0xFEE75C);
    addTextDisplay(c, '<:Infotriangle:1521227710381428926> You need to keep at least one pet — catch another before trading this one.');
    return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }
  const idx = animals.findIndex(p => p.id === petId);
  if (idx === -1) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `<:Cancel:1521227723916181644> Pet \`${petId}\` not found in your collection.`);
    return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
  }
  const pet = animals[idx];

  const container = createContainer();
  addTextDisplay(container, [
    `# <:History:1521227863079256278> Pet Trade`,
    '',
    `**${message.author.username}** → **${target.username}**`,
    '',
    `${pet.emoji || '🐾'} **${pet.name}** *(Lv.${pet.level || 1} ${pet.rarity || 'common'})*`,
    pet.weapon ? `> 🗡 ${pet.weapon.name} +${pet.weapon.baseAtk || 0}` : null,
    '',
    `-# Recipient must accept within 30 seconds. The pet keeps its weapon and learned skills.`,
  ].filter(Boolean).join('\n'));

  const sessId = `trade_p_${Date.now()}_${senderId}`;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${sessId}_accept`).setEmoji('<:Checkedbox:1521227734943269077>').setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${sessId}_decline`).setEmoji('<:Cancel:1521227723916181644>').setLabel('Decline').setStyle(ButtonStyle.Danger)
  );
  const msg = await message.reply({ components: [container, row], flags: MessageFlags.IsComponentsV2 });

  const collector = msg.createMessageComponentCollector({ time: 30_000 });
  collector.on('collect', async i => {
    if (i.user.id !== target.id) {
      await i.reply({ components: [getErrorContainer('Only the trade recipient can respond.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }
    await i.deferUpdate();
    if (i.customId === `${sessId}_decline`) {
      collector.stop();
      const c = createContainer(); addTextDisplay(c, '<:Cancel:1521227723916181644> Trade declined.');
      return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
    if (i.customId === `${sessId}_accept`) {
      if (inFlight.has(senderId)) {
        return; // ignore double-tap
      }
      inFlight.add(senderId);
      try {
        const fresh = ph.loadPets();
        ph.ensureUser(fresh, senderId);
        ph.ensureUser(fresh, target.id);
        const senderAnimals = fresh[senderId].animals;
        const senderIdx = senderAnimals.findIndex(p => p.id === petId);
        if (senderIdx === -1) {
          collector.stop();
          const c = createContainer();
          addTextDisplay(c, `<:Cancel:1521227723916181644> Sender no longer owns that pet.`);
          return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }
        if (senderAnimals.length <= 1) {
          collector.stop();
          const c = createContainer();
          addTextDisplay(c, '<:Infotriangle:1521227710381428926> Sender now has only one pet — trade aborted.');
          return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        }

        const moving = senderAnimals.splice(senderIdx, 1)[0];
        if (fresh[senderId].activeBattlePet === petId) {
          fresh[senderId].activeBattlePet = senderAnimals[0]?.id || null;
        }
        // Re-issue id for the new owner so it can't collide.
        const newId = ph.nextId(moving.rarity || 'common', moving.name || 'Pet', fresh[target.id].animals);
        moving.id = newId;
        fresh[target.id].animals.push(moving);
        ph.savePets(fresh);

        collector.stop();
        const c = createContainer();
        addTextDisplay(c, [
          `# <:Checkedbox:1521227734943269077> Pet Transferred`,
          '',
          `${moving.emoji || '🐾'} **${moving.name}** is now owned by **${target.username}**`,
          `New pet ID: \`${newId}\``,
        ].join('\n'));
        return msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      } finally {
        inFlight.delete(senderId);
      }
    }
  });
  collector.on('end', (_collected, reason) => {
    if (reason === 'time') {
      const c = createContainer();
      addTextDisplay(c, '<:Clock:1521228110408847623> Trade timed out.');
      msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
  });
}

/* ═══════════════════════════════════════════════════════════════
   COMMAND DISPATCH
   ═══════════════════════════════════════════════════════════════ */

module.exports = {
  data: new (require('discord.js').SlashCommandBuilder)()
    .setName('trade')
    .setDescription('Free trade with another user (weapons, items, or pets)')
    .addSubcommand(s => s.setName('weapon')
      .setDescription("Move your active pet's weapon to their active pet")
      .addUserOption(o => o.setName('user').setDescription('Trading partner').setRequired(true)))
    .addSubcommand(s => s.setName('item')
      .setDescription('Send items from your inventory to another user')
      .addUserOption(o => o.setName('user').setDescription('Trading partner').setRequired(true))
      .addStringOption(o => o.setName('item').setDescription('Item id').setRequired(true))
      .addIntegerOption(o => o.setName('quantity').setDescription('Quantity (default 1)').setRequired(false).setMinValue(1).setMaxValue(100)))
    .addSubcommand(s => s.setName('pet')
      .setDescription('Transfer a pet to another user')
      .addUserOption(o => o.setName('user').setDescription('Trading partner').setRequired(true))
      .addStringOption(o => o.setName('pet').setDescription('Pet id (use /pets)').setRequired(true))),
  prefix: 'trade',
  description: 'Free trade with another user — weapons, items, or pets',
  usage: 'trade <weapon|item|pet> @user [args]',
  category: 'economy',
  aliases: ['gift-trade'],

  async executePrefix(message, args) {
    const sub = (args[0] || '').toLowerCase();
    if (!['weapon', 'item', 'pet'].includes(sub)) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, '<:Cancel:1521227723916181644> Usage: `trade weapon @user`, `trade item @user <id> [qty]`, or `trade pet @user <petId>`');
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const target = await resolveUser(message, args);
    if (!target || target.id === message.author.id) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, '<:Cancel:1521227723916181644> Mention a valid user.');
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    if (target.bot) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, '<:Cancel:1521227723916181644> You cannot trade with bots.');
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    if (sub === 'weapon') return handleWeaponTrade(message, target);

    // For item / pet, the next non-mention args carry the payload.
    // Strip the mention token from args so we can index reliably.
    const rest = args.filter(a => !/^<@!?\d+>$/.test(a)).slice(1);
    if (sub === 'item') {
      const itemId = (rest[1] || '').toLowerCase();
      const qty = parseInt(rest[2], 10) || 1;
      if (!itemId) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, '<:Cancel:1521227723916181644> Specify an item id: `trade item @user <id> [qty]`');
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      }
      return handleItemTrade(message, target, itemId, qty);
    }
    if (sub === 'pet') {
      const petId = rest[1];
      if (!petId) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, '<:Cancel:1521227723916181644> Specify a pet id: `trade pet @user <petId>`');
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
      }
      return handlePetTrade(message, target, petId);
    }
  },

  async execute(interaction) {
    await interaction.deferReply();
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('user');
    if (!target || target.id === interaction.user.id) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, '<:Cancel:1521227723916181644> Pick a valid user.');
      return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    if (target.bot) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, '<:Cancel:1521227723916181644> You cannot trade with bots.');
      return interaction.editReply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    // Build a small message-like adapter so the handlers can stay
    // shared between slash and prefix.
    const fakeMessage = {
      author: interaction.user,
      reply: (opts) => interaction.editReply(opts),
    };

    if (sub === 'weapon') return handleWeaponTrade(fakeMessage, target);
    if (sub === 'item') {
      const itemId = (interaction.options.getString('item') || '').toLowerCase();
      const qty = interaction.options.getInteger('quantity') || 1;
      return handleItemTrade(fakeMessage, target, itemId, qty);
    }
    if (sub === 'pet') {
      const petId = interaction.options.getString('pet');
      return handlePetTrade(fakeMessage, target, petId);
    }
  },
};
