'use strict';

const path = require('path');
const { formatCoins, formatCoinsShort , coinIcon, formatCoinsAmount } = require('../../utils/currencyHelper');
const { ButtonBuilder, ActionRowBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { createContainer, addTextDisplay, addSeparator, formatNumber, getErrorContainer, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');

const ph = require('../../utils/petHelpers');
const jsonStore = require('../../utils/jsonStore');
const { applyIncomeTax, formatTaxFootnote } = require('../../utils/taxHelper');
const COOLDOWN = 5 * 60 * 1000;
const cooldowns = new Map();

const BIOMES = [
  {
    name: 'Enchanted Forest', biome: 'forest', emoji: '🌲',
    stages: 4,
    events: [
      { text: 'You find a hidden path through the trees...', type: 'explore', coinRange: [50, 200] },
      { text: 'A wild boar charges at you!', type: 'fight', enemy: { name: 'Wild Boar', emoji: '🐗', hp: 40, atk: 8 } },
      { text: 'You discover an old chest in the roots!', type: 'treasure', coinRange: [200, 600] },
      { text: 'A fairy offers you a gift!', type: 'bonus', coinRange: [100, 400], itemChance: 0.3, item: 'gem' },
    ],
  },
  {
    name: 'Crystal Cavern', biome: 'cave', emoji: '<:Sketch:1521228025365004471>',
    stages: 5,
    events: [
      { text: 'The crystals hum with energy...', type: 'explore', coinRange: [80, 300] },
      { text: 'A cave troll blocks your path!', type: 'fight', enemy: { name: 'Cave Troll', emoji: '👹', hp: 80, atk: 15 } },
      { text: 'You mine some rare crystals!', type: 'treasure', coinRange: [300, 800] },
      { text: 'Bats swarm around you!', type: 'fight', enemy: { name: 'Bat Swarm', emoji: '🦇', hp: 30, atk: 12 } },
      { text: 'You find a hidden underground lake!', type: 'bonus', coinRange: [150, 500], itemChance: 0.4, item: 'mystery_box' },
    ],
  },
  {
    name: 'Sunken Reef', biome: 'ocean', emoji: '🌊',
    stages: 4,
    events: [
      { text: 'You dive deeper into the reef...', type: 'explore', coinRange: [60, 250] },
      { text: 'A giant squid attacks!', type: 'fight', enemy: { name: 'Giant Squid', emoji: '🦑', hp: 60, atk: 18 } },
      { text: 'You find a sunken treasure chest!', type: 'treasure', coinRange: [400, 1000] },
      { text: 'A mermaid offers you a pearl!', type: 'bonus', coinRange: [200, 600], itemChance: 0.25, item: 'gem' },
    ],
  },
  {
    name: 'Volcanic Peak', biome: 'volcano', emoji: '🌋',
    stages: 5,
    events: [
      { text: 'The ground rumbles beneath you...', type: 'explore', coinRange: [100, 400] },
      { text: 'A fire elemental emerges!', type: 'fight', enemy: { name: 'Fire Elemental', emoji: '<:Fire:1521227907647668374>', hp: 100, atk: 22 } },
      { text: 'You find obsidian deposits!', type: 'treasure', coinRange: [500, 1200] },
      { text: 'Lava flows block your path!', type: 'hazard', dmgPercent: 0.2 },
      { text: 'A phoenix drops a feather!', type: 'bonus', coinRange: [300, 800], itemChance: 0.35, item: 'weapon_box' },
    ],
  },
  {
    name: 'Sky Temple', biome: 'sky', emoji: '☁',
    stages: 6,
    events: [
      { text: 'You climb the cloud stairs...', type: 'explore', coinRange: [120, 500] },
      { text: 'An angel warrior challenges you!', type: 'fight', enemy: { name: 'Angel Warrior', emoji: '👼', hp: 120, atk: 25 } },
      { text: 'You find a divine relic!', type: 'treasure', coinRange: [600, 1500] },
      { text: 'Lightning strikes near you!', type: 'hazard', dmgPercent: 0.15 },
      { text: 'You reach the inner sanctum!', type: 'explore', coinRange: [200, 700] },
      { text: 'The Sky God blesses you!', type: 'bonus', coinRange: [500, 1500], itemChance: 0.5, item: 'crown' },
    ],
  },
];

function loadPets() { return ph.loadPets(); }

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function runAdventure(message, biomeData) {
  const guildId = message.guild?.id;
  const userId = message.author.id;
  const petsData = loadPets();
  const userData = petsData[userId];

  let pet = null;
  if (userData?.activeBattlePet) {
    const storedPet = userData.animals.find(p => p.id === userData.activeBattlePet);
    if (storedPet) {
      pet = {
        name: storedPet.name,
        emoji: storedPet.emoji,
        level: storedPet.level || 1,
        hp: storedPet.baseHp || storedPet.hp || 50,
        maxHp: storedPet.baseHp || storedPet.hp || 50,
        atk: (storedPet.baseAtk || storedPet.atk || 10) + (storedPet.weapon?.baseAtk || 0),
      };
      pet.hp = Math.floor(pet.hp * (1 + (pet.level - 1) * 0.1));
      pet.maxHp = pet.hp;
      pet.atk = Math.floor(pet.atk * (1 + (pet.level - 1) * 0.08));
    }
  }

  const totalCoins = { value: 0 };
  const totalExp = { value: 0 };
  const items = [];
  let failed = false;
  const stages = biomeData.stages;

  const sessId = `adv_${Date.now()}_${userId}`;

  const initContainer = createContainer(0xCAD7E6);
  addTextDisplay(initContainer, [
    `# <:Fire:1521227907647668374> Adventure: ${biomeData.name}`,
    '',
    `${biomeData.emoji} Embarking on a **${stages}-stage** adventure!`,
    pet ? `> 🐾 Pet: ${pet.emoji} **${pet.name}** (Lv.${pet.level}) | <:Heart:1521228100652765247> ${pet.hp}/${pet.maxHp} HP` : '> <:Infotriangle:1521227710381428926> No pet — combat will be harder!',
    '',
    `Press **Continue** to advance through each stage.`,
  ].join('\n'));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${sessId}_continue`).setEmoji('<:Caretright:1521227704953864202>').setLabel('Continue').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${sessId}_flee`).setLabel('🏃 Flee').setStyle(ButtonStyle.Secondary),
  );

  const msg = await message.reply({ components: [initContainer, row], flags: MessageFlags.IsComponentsV2 });

  let currentStage = 0;

  const collector = msg.createMessageComponentCollector({ time: 120_000 });

  collector.on('collect', async i => {
    if (i.user.id !== userId) {
      await i.reply({ components: [getErrorContainer('This adventure belongs to someone else.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
      return;
    }

    await i.deferUpdate();

    if (i.customId === `${sessId}_flee`) {
      collector.stop('flee');
      return;
    }

    currentStage++;
    const event = biomeData.events[currentStage - 1] || biomeData.events[biomeData.events.length - 1];

    let stageText = `**Stage ${currentStage}/${stages}**\n> ${event.text}\n\n`;

    switch (event.type) {
      case 'explore': {
        const coins = rand(event.coinRange[0], event.coinRange[1]);
        totalCoins.value += coins;
        totalExp.value += 10;
        stageText += `${coinIcon(guildId)} Found **${formatCoinsAmount(coins, guildId)}**!`;
        break;
      }
      case 'treasure': {
        const coins = rand(event.coinRange[0], event.coinRange[1]);
        totalCoins.value += coins;
        totalExp.value += 20;
        stageText += `🎁 Treasure! **+${formatCoins(coins, guildId)}**!`;
        break;
      }
      case 'fight': {
        const enemy = event.enemy;
        const petAtk = pet ? pet.atk : 5;
        const petHp = pet ? pet.hp : 20;
        const dmgDealt = Math.max(1, petAtk - Math.floor(enemy.hp * 0.05));
        const dmgTaken = Math.max(1, enemy.atk - Math.floor(petAtk * 0.1));

        if (dmgDealt * 5 > enemy.hp) {
          const coins = rand(50, 200);
          totalCoins.value += coins;
          totalExp.value += 15;
          if (pet) pet.hp = Math.max(1, pet.hp - Math.floor(dmgTaken * 0.5));
          stageText += `⚔️ Defeated ${enemy.emoji} **${enemy.name}**! +${coins} coins`;
        } else {
          if (pet) pet.hp = Math.max(0, pet.hp - dmgTaken);
          totalExp.value += 5;
          stageText += `⚔️ ${enemy.emoji} **${enemy.name}** hit hard! ${pet ? `${pet.emoji} HP: ${pet.hp}/${pet.maxHp}` : ''}`;
          if (pet && pet.hp <= 0) {
            stageText += `\n💀 Your pet was knocked out!`;
            failed = true;
          }
        }
        break;
      }
      case 'hazard': {
        if (pet) {
          const dmg = Math.floor(pet.maxHp * event.dmgPercent);
          pet.hp = Math.max(0, pet.hp - dmg);
          stageText += `<:Infotriangle:1521227710381428926> Took **${dmg}** damage! ${pet.emoji} HP: ${pet.hp}/${pet.maxHp}`;
          if (pet.hp <= 0) { stageText += `\n💀 Your pet was knocked out!`; failed = true; }
        } else {
          stageText += `<:Infotriangle:1521227710381428926> You barely avoided danger!`;
        }
        break;
      }
      case 'bonus': {
        const coins = rand(event.coinRange[0], event.coinRange[1]);
        totalCoins.value += coins;
        totalExp.value += 25;
        stageText += `<:Star:1521227981685526568> **+${formatCoins(coins, guildId)}**!`;
        if (Math.random() < event.itemChance) {
          items.push(event.item);
          stageText += `\n<:Box:1521228152414666833> **Bonus item:** \`${event.item}\`!`;
        }
        break;
      }
    }

    if (failed || currentStage >= stages) {
      collector.stop(failed ? 'failed' : 'complete');

      const economy = economyManager.loadEconomy();
      const { userData: ecoUser } = economyManager.getUser(economy, userId);

      if (!failed) {
        // Wealth tax — applies once total wealth ≥ 100k.
        const taxResult = applyIncomeTax(totalCoins.value, ecoUser);
        ecoUser.coins += taxResult.net;
        totalCoins.value = taxResult.net; // surface net to caller for the result panel
        ecoUser.adventuresCompleted = (ecoUser.adventuresCompleted || 0) + 1;
        if (ecoUser.adventuresCompleted >= 25) economyManager.checkAchievement(economy, userId, 'adventurer');
        economyManager.addXP(economy, userId, totalExp.value);
      } else {
        // Partial 30% credit on failure — also taxed if eligible.
        const partial = Math.floor(totalCoins.value * 0.3);
        const taxResult = applyIncomeTax(partial, ecoUser);
        ecoUser.coins += taxResult.net;
        totalCoins.value = taxResult.net;
      }
      economyManager.saveEconomy(economy);

      if (items.length > 0 && !failed) {
        // Read the live inventory store, append THIS user's drops,
        // then write back. The previous version wrote an empty `{}`
        // back if the read threw — which would wipe every user's
        // inventory across the bot. We now refuse the write if the
        // read failed, so a transient store error never destroys
        // data.
        let inv = null;
        try { inv = jsonStore.read('inventory'); } catch { inv = null; }
        if (inv && typeof inv === 'object') {
          inv[userId] = inv[userId] || [];
          for (const itemId of items) inv[userId].push({ id: itemId, boughtAt: Date.now() });
          jsonStore.write('inventory', inv);
        } else {
          console.warn('[ADVENTURE] inventory store unreachable, skipping item drops to avoid wiping other users');
        }
      }

      // Track lifetime earnings for /profile and /economystats so
      // adventure coin gains (full or partial) show up consistently
      // with every other earning command.
      if ((totalCoins.value || 0) > 0) {
        ecoUser.totalEarned = (ecoUser.totalEarned || 0) + totalCoins.value;
        economyManager.saveEconomy(economy);
      }

      const resultContainer = createContainer(failed ? 0xED4245 : 0xCAD7E6);
      addTextDisplay(resultContainer, [
        `# ${failed ? '<:Toggleoff:1521227763816595559>' : '<:Toggleon:1521227758011809964>'} Adventure ${failed ? 'Failed' : 'Complete'}!`,
        '',
        stageText,
      ].join('\n'));

      addSeparator(resultContainer, SeparatorSpacingSize.Small);

      const summaryLines = [
        `### ${coinIcon(guildId)} Rewards`,
        `> ${coinIcon(guildId)} **Coins:** +${formatNumber(totalCoins.value)}`,
        `> <:transfer:1521228019824590948> **XP:** +${totalExp.value}`,
      ];
      if (items.length > 0 && !failed) {
        summaryLines.push(`> <:Box:1521228152414666833> **Items:** ${items.join(', ')}`);
      }
      if (failed) {
        summaryLines.push('', '-# You salvaged 30% of earned coins. Try again with a stronger pet!');
      } else {
        summaryLines.push('', '-# Use `adventure` again after cooldown for more loot!');
      }
      addTextDisplay(resultContainer, summaryLines.join('\n'));

      await msg.edit({ components: [resultContainer], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      return;
    }

    const c = createContainer(0xCAD7E6);
    addTextDisplay(c, `# <:Fire:1521227907647668374> ${biomeData.name}\n\n${stageText}\n\n${pet ? `${pet.emoji} HP: ${pet.hp}/${pet.maxHp}` : ''}`);
    await msg.edit({ components: [c, row], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  });

  collector.on('end', async (_, reason) => {
    if (reason === 'time') {
      const c = createContainer(0xED4245);
      addTextDisplay(c, '<:Cancel:1521227723916181644> Adventure timed out.');
      await msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    } else if (reason === 'flee') {
      const economy = economyManager.loadEconomy();
      const { userData: ecoUser } = economyManager.getUser(economy, userId);
      const partial = Math.floor(totalCoins.value * 0.5);
      ecoUser.coins += partial;
      economyManager.saveEconomy(economy);

      const c = createContainer(0xCAD7E6);
      addTextDisplay(c, `# 🏃 Fled the Adventure\n\nYou escaped with **${formatCoins(partial, guildId)}** (50% of earned).\n\n-# Use \`adventure\` to try again!`);
      await msg.edit({ components: [c], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
  });
}

module.exports = {
  data: new (require('discord.js').SlashCommandBuilder)()
    .setName('adventure')
    .setDescription('Go on an adventure with your active pet')
    .addIntegerOption(o => o.setName('biome').setDescription('Biome number (1-5)').setRequired(false).setMinValue(1).setMaxValue(5)),
  prefix: 'adventure',
  aliases: ['adv', 'explore', 'quest'],
  category: 'economy',
  description: 'Go on an adventure with your pet',

  async executePrefix(message, args) {
    const userId = message.author.id;
    const now = Date.now();

    if (cooldowns.get(userId) > now) {
      const c = createContainer(0xED4245);
      addTextDisplay(c, `<:Cancel:1521227723916181644> Adventure cooldown: **${economyManager.formatTime(cooldowns.get(userId) - now)}**`);
      return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    cooldowns.set(userId, now + COOLDOWN);

    const biomeArg = args[0]?.toLowerCase();

    if (biomeArg === 'list') {
      const container = createContainer(0xCAD7E6);
      addTextDisplay(container, [
        `# <:Fire:1521227907647668374> Adventure Biomes`,
        '',
        ...BIOMES.map((b, i) => `**${i + 1}. ${b.emoji} ${b.name}** — ${b.stages} stages`),
        '',
        `-# Use \`adventure <number>\` or \`adventure\` for random`,
      ].join('\n'));
      cooldowns.delete(userId);
      return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    let biome;
    const biomeIndex = parseInt(biomeArg) - 1;
    if (biomeIndex >= 0 && biomeIndex < BIOMES.length) {
      biome = BIOMES[biomeIndex];
    } else {
      biome = BIOMES[Math.floor(Math.random() * BIOMES.length)];
    }

    return runAdventure(message, biome);
  },

  async execute(interaction) {
        await interaction.deferReply({ flags: 1 << 15 });
    const biome = interaction.options.getInteger('biome');
    const fakeMessage = {
      author: interaction.user,
      reply: (opts) => interaction.editReply(opts),
    };
    return module.exports.executePrefix(fakeMessage, biome ? [String(biome)] : []);
  },
};
