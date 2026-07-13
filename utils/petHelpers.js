'use strict';

const path = require('path');

const jsonStore = require('./jsonStore');
const { getRarityEmoji } = require('./rarityBadges');
const PETS_PATH = path.join(__dirname, '../data/pets.json');

/* ═══════════════════════════════════════════════════════
   RARITY CONFIG
   ═══════════════════════════════════════════════════════ */

const RARITY_PREFIX = {
  common: 'cmn', uncommon: 'ucm', rare: 'rar',
  epic: 'epc', legendary: 'lgd', mythic: 'myc',
};

// Sourced from the shared rarityBadges helper so pets/weapons and the anime
// system show one consistent rarity emoji set (was the ⬜🟩🟦 square glyphs).
// Getters resolve the live application emoji at usage time.
const RARITY_EMOJI = {
  get common()    { return getRarityEmoji('common'); },
  get uncommon()  { return getRarityEmoji('uncommon'); },
  get rare()      { return getRarityEmoji('rare'); },
  get epic()      { return getRarityEmoji('epic'); },
  get legendary() { return getRarityEmoji('legendary'); },
  get mythic()    { return getRarityEmoji('mythic'); },
};

const RARITY_COLOR = {
  common: 0x9ca3af, uncommon: 0x22c55e, rare: 0x3b82f6,
  epic: 0x8b5cf6, legendary: 0xfbbf24, mythic: 0xef4444,
};

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

/* ═══════════════════════════════════════════════════════
   WEAPONS CATALOG  (single source of truth)
   ─────────────────────────────────────────────────────────
   Each weapon carries:
     name        - display name including the icon glyph
     baseAtk     - flat ATK bonus added to the wielder's attack
     rarity      - one of common/uncommon/rare/epic/legendary/mythic.
                   Used for tinted output, weapon-box drop weights and
                   the upgrade-cost rarity multiplier in /weapon.
     price       - shop price for direct purchase (0 = drop only)
     description - short blurb shown in /shop and /weapon list

   Backwards compatibility: stored pet objects only persist
   `{ id, name, baseAtk, level, rarity }`; new weapons drop into the
   same shape, and existing equipped weapons keep working unchanged.
   ═══════════════════════════════════════════════════════ */

const WEAPONS = {
  /* ── Common ── starter drops, weak but cheap ── */
  sword: { name: '🗡️ Sword', baseAtk: 10, rarity: 'common', price: 4000, description: 'Reliable blade — balanced ATK for new pets' },
  bow: { name: '🏹 Bow', baseAtk: 8, rarity: 'common', price: 3500, description: 'Light bow — modest ATK, low cost' },
  staff: { name: '🔮 Staff', baseAtk: 6, rarity: 'common', price: 3000, description: 'Apprentice staff — entry-tier mage weapon' },
  dagger: { name: '🔪 Dagger', baseAtk: 12, rarity: 'common', price: 4500, description: 'Quick blade — slightly higher ATK than a sword' },

  /* ── Uncommon ── solid mid-tier ── */
  warhammer: { name: '🔨 Warhammer', baseAtk: 18, rarity: 'uncommon', price: 9000, description: 'Heavy hammer — strong ATK for slower pets' },
  crossbow: { name: '🎯 Crossbow', baseAtk: 16, rarity: 'uncommon', price: 8500, description: 'Mechanical bow — solid ranged ATK' },
  trident: { name: '🔱 Trident', baseAtk: 20, rarity: 'uncommon', price: 11000, description: 'Three-pronged spear — best uncommon ATK' },
  cursed_orb: { name: '🔮 Cursed Orb', baseAtk: 17, rarity: 'uncommon', price: 9500, description: 'Dark orb — reliable magical ATK' },

  /* ── Rare ── mid-game upgrade ── */
  katana: { name: '🗡️ Katana', baseAtk: 26, rarity: 'rare', price: 22000, description: 'Master-forged katana — sharp and fast' },
  battleaxe: { name: '🪓 Battleaxe', baseAtk: 30, rarity: 'rare', price: 26000, description: 'Two-handed axe — top rare ATK' },
  longbow: { name: '🏹 Elven Longbow', baseAtk: 24, rarity: 'rare', price: 21000, description: 'Elven craftsmanship — pierces armor' },
  arcane_staff: { name: '<:Star:1521227981685526568> Arcane Staff', baseAtk: 22, rarity: 'rare', price: 20000, description: 'Crystal-tipped staff — channels true arcane power' },

  /* ── Epic ── late-game weapons ── */
  shadow_blade: { name: '🌑 Shadowblade', baseAtk: 38, rarity: 'epic', price: 60000, description: 'Forged in shadow — devastating epic ATK' },
  flame_lance: { name: '🔥 Flame Lance', baseAtk: 36, rarity: 'epic', price: 58000, description: 'Burns the enemy on every hit (flavor)' },
  frost_axe: { name: '❄️ Frost Axe', baseAtk: 40, rarity: 'epic', price: 65000, description: 'Glacial edge — strongest epic ATK' },
  thunder_bow: { name: '⚡ Thunder Bow', baseAtk: 35, rarity: 'epic', price: 56000, description: 'Crackles with lightning — fast epic ATK' },

  /* ── Legendary ── premium ── */
  excalibur: { name: '⚔️ Excalibur', baseAtk: 55, rarity: 'legendary', price: 150000, description: 'The legendary sword — colossal ATK' },
  dragon_fang: { name: '🐉 Dragon Fang', baseAtk: 60, rarity: 'legendary', price: 165000, description: 'Forged from dragon teeth — apex ATK' },
  celestial_bow: { name: '🌟 Celestial Bow', baseAtk: 50, rarity: 'legendary', price: 140000, description: 'Bow of the heavens — pierces any defense' },

  /* ── Mythic ── only obtainable from premium boxes ── */
  void_reaper: { name: '🕳️ Void Reaper', baseAtk: 80, rarity: 'mythic', price: 0, description: 'Cuts through reality — drop-only mythic weapon' },
  starforge: { name: '<:Star:1521227981685526568> Starforge', baseAtk: 85, rarity: 'mythic', price: 0, description: 'Forged from a dying star — drop-only mythic' },
};

/**
 * Drop-pool weights used by `weapon_box` and `weapon_crate`. Higher
 * weight = more common in the loot pool. Mythics deliberately drop
 * only from the premium crate.
 */
const WEAPON_BOX_WEIGHTS = {
  common: 50, uncommon: 30, rare: 15, epic: 4, legendary: 1, mythic: 0,
};
const WEAPON_CRATE_WEIGHTS = {
  common: 0, uncommon: 25, rare: 35, epic: 25, legendary: 12, mythic: 3,
};

/**
 * Group weapons by rarity. Used by the weapon-equip select menu so we
 * can paginate across rarity tabs instead of cramming everything into
 * a single 25-option select.
 */
function weaponsByRarity() {
  const out = {};
  for (const [id, w] of Object.entries(WEAPONS)) {
    const r = w.rarity || 'common';
    (out[r] ||= []).push({ id, ...w });
  }
  return out;
}

/* ═══════════════════════════════════════════════════════
   SKILL CATALOG  (shared with battle.js)
   ─────────────────────────────────────────────────────────
   Single source of truth so /skill, /pets, the battle engine and the
   shop all agree on labels, descriptions, prices and mechanics.

   Skill object shape:
     name        - display name with leading emoji
     emoji       - icon used in battle log lines
     type        - 'dmg' | 'heal' | 'buff' | 'drain' | 'dmg_debuff' |
                   'shield' | 'dot' | 'multi'
     starter     - true if every freshly-caught pet learns it for free
     enemyOnly   - true if NPCs use it but it's not available to players
     unlockTier  - minimum pet level required to learn (default 1)
     price       - coin cost to learn from the shop (0 if not for sale)
     description - one-liner shown in /shop, /skill list, /skill info
   ═══════════════════════════════════════════════════════ */

const SKILL_DEFS = {
  /* ── Starter / cheap ── */
  slash: { name: '⚔️ Slash', emoji: '⚔️', type: 'dmg', mult: 1.0, starter: true, unlockTier: 1, price: 0, description: 'Basic balanced strike — every pet starts knowing this' },
  bone_throw: { name: '🦴 Bone Throw', emoji: '🦴', type: 'dmg', mult: 1.1, unlockTier: 1, price: 1500, description: 'Hurls a bone for slightly above-baseline damage' },
  absorb: { name: '💚 Absorb', emoji: '💚', type: 'heal', amount: 0.15, unlockTier: 1, price: 2500, description: 'Heal for 15% of your max HP' },

  /* ── Common combat ── */
  slam: { name: '💥 Slam', emoji: '💥', type: 'dmg', mult: 1.3, unlockTier: 2, price: 4000, description: 'Heavy hit — 1.3x ATK damage' },
  howl: { name: '<:Star:1521227981685526568> Howl', emoji: '<:Star:1521227981685526568>', type: 'buff', stat: 'atk', amount: 0.20, unlockTier: 2, price: 5000, description: 'Buff your own ATK by +20%' },
  fortify: { name: '<:Shield:1521227694677692467> Fortify', emoji: '<:Shield:1521227694677692467>', type: 'buff', stat: 'def', amount: 0.30, unlockTier: 2, price: 5000, description: 'Reinforce your defense by +30%' },

  /* ── Mid tier ── */
  fireball: { name: '<:Fire:1521227907647668374> Fireball', emoji: '<:Fire:1521227907647668374>', type: 'dmg', mult: 1.5, unlockTier: 4, price: 9000, description: 'Magic explosion — 1.5x ATK damage' },
  drain: { name: '🩸 Life Drain', emoji: '🩸', type: 'drain', mult: 0.8, unlockTier: 4, price: 10000, description: 'Damage and heal yourself for 40% of damage dealt' },
  riposte: { name: '🛡️ Riposte', emoji: '🛡️', type: 'multi', multAtk: 1.2, defBuff: 0.10, unlockTier: 4, price: 11000, description: 'Hit for 1.2x ATK and gain +10% DEF' },
  regenerate: { name: '🌿 Regenerate', emoji: '🌿', type: 'heal', amount: 0.25, unlockTier: 5, price: 12000, description: 'Heal 25% of your max HP — best heal at this tier' },

  /* ── High tier ── */
  double_strike: { name: '⚔️ Double Strike', emoji: '⚔️', type: 'dmg', mult: 0.7, hits: 2, unlockTier: 6, price: 18000, description: 'Strike twice — each hit deals 0.7x ATK' },
  shield_wall: { name: '🛡️ Shield Wall', emoji: '🛡️', type: 'shield', amount: 0.40, unlockTier: 6, price: 20000, description: 'Absorb 40% of the next incoming hit' },
  dark_strike: { name: '🌑 Dark Strike', emoji: '🌑', type: 'dmg', mult: 1.7, unlockTier: 7, price: 28000, description: 'Shadow-imbued blow — 1.7x ATK damage' },
  frost_breath: { name: '❄️ Frost Breath', emoji: '❄️', type: 'dmg_debuff', mult: 1.2, debuff: 'spd', debuffAmt: 0.20, unlockTier: 7, price: 30000, description: 'Damage and slow the enemy by -20% SPD' },
  poison_fang: { name: '☠️ Poison Fang', emoji: '☠️', type: 'dot', mult: 0.6, dotMult: 0.10, dotTurns: 3, unlockTier: 8, price: 35000, description: 'Bite for 0.6x ATK and inflict poison for 3 rounds' },

  /* ── Apex player skills (Legendary cost) ── */
  meteor_strike: { name: '☄️ Meteor Strike', emoji: '☄️', type: 'dmg', mult: 2.2, unlockTier: 10, price: 65000, description: 'Calls a meteor — 2.2x ATK damage' },
  divine_heal: { name: '<:Star:1521227981685526568> Divine Heal', emoji: '<:Star:1521227981685526568>', type: 'heal', amount: 0.45, unlockTier: 10, price: 60000, description: 'Heal 45% of your max HP — apex healing' },

  /* ── Enemy-only skills (NPC AI uses them, players cannot learn) ── */
  inferno: { name: '🌋 Inferno', emoji: '🌋', type: 'dmg', mult: 2.0, enemyOnly: true, unlockTier: 99, price: 0, description: 'NPC-only fiery attack' },
  void_collapse: { name: '🕳️ Void Collapse', emoji: '🕳️', type: 'dmg', mult: 2.5, enemyOnly: true, unlockTier: 99, price: 0, description: 'NPC-only reality-warping strike' },
};

/**
 * Legacy alias kept so `pets.js` can keep doing `ph.SKILL_LABEL[id]`
 * without changing its template literals. Built dynamically from
 * SKILL_DEFS so the two never drift.
 */
const SKILL_LABEL = Object.fromEntries(
  Object.entries(SKILL_DEFS).map(([id, s]) => [id, s.name])
);

/** All skills a player can learn (excludes enemy-only entries). */
function playerLearnableSkills() {
  return Object.entries(SKILL_DEFS)
    .filter(([, s]) => !s.enemyOnly)
    .map(([id, s]) => ({ id, ...s }));
}

/** Maximum skills a pet can have equipped at once (kept low for variety). */
const MAX_EQUIPPED_SKILLS = 3;

/* ═══════════════════════════════════════════════════════
   FILE I/O
   ═══════════════════════════════════════════════════════ */

function rawLoad() {
  if (!jsonStore.has('pets')) return {};
  try { return jsonStore.read('pets'); }
  catch { return {}; }
}

function savePets(data) {
  jsonStore.write('pets', data);
}

function ensureUser(data, uid) {
  if (!data[uid]) data[uid] = { animals: [], activeBattlePet: null };
  if (!Array.isArray(data[uid].animals)) data[uid].animals = [];
  return data[uid];
}

/* ═══════════════════════════════════════════════════════
   PET ID GENERATION
   ═══════════════════════════════════════════════════════

   Format:  {rarityPrefix}{name}_{counter}
   Example: cmnmouse_1, ucmwolf_3, lgddragon_1
   ═══════════════════════════════════════════════════════ */

const NEW_ID_RE = /^(cmn|ucm|rar|epc|lgd|myc)[a-z0-9]+_\d+$/;

function baseId(rarity, name) {
  return (RARITY_PREFIX[rarity] || 'cmn') + (name || 'pet').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function nextId(rarity, name, animals) {
  const base = baseId(rarity, name);
  let max = 0;
  for (const p of animals) {
    if (p.id?.startsWith(base + '_')) {
      const n = parseInt(p.id.slice(base.length + 1));
      if (n > max) max = n;
    }
  }
  return `${base}_${max + 1}`;
}

/* ═══════════════════════════════════════════════════════
   DATA MIGRATION  (old random IDs → new format)
   ═══════════════════════════════════════════════════════ */

function migrate(data) {
  let changed = false;
  for (const uid in data) {
    const u = data[uid];
    if (!Array.isArray(u?.animals)) continue;
    for (const pet of u.animals) {
      // ID migration only runs once; `learnedSkills` backfill must run
      // on every load until the field exists, so we split the two so
      // already-migrated pets still pick up newer fields.
      if (!NEW_ID_RE.test(pet.id)) {
        const old = pet.id;
        pet.id = nextId(pet.rarity || 'common', pet.name || 'pet', u.animals);
        if (u.activeBattlePet === old) u.activeBattlePet = pet.id;
        pet.baseHp ??= pet.hp || 20;
        pet.baseAtk ??= pet.atk || 5;
        pet.maxHp ??= pet.baseHp;
        pet.hp ??= pet.maxHp;
        pet.atk ??= pet.baseAtk;
        pet.level ??= 1;
        pet.exp ??= 0;
        pet.weapon ??= null;
        changed = true;
      }
      // Skills bookkeeping. `skills` = currently equipped (≤ 3 used in
      // battle); `learnedSkills` = the full pool the pet owns. Older
      // pets only had `skills`, so seed `learnedSkills` from it. Runs
      // on all pets so pets that migrated before this field existed
      // still pick it up the next time they're loaded.
      if (!Array.isArray(pet.skills) || pet.skills.length === 0) {
        pet.skills = ['slash'];
        changed = true;
      }
      if (!Array.isArray(pet.learnedSkills) || pet.learnedSkills.length === 0) {
        pet.learnedSkills = Array.from(new Set([...(pet.skills || []), 'slash']));
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Load pets with automatic migration of old IDs.
 * Safe to call from any file — migration is idempotent.
 */
function loadPets() {
  const data = rawLoad();
  if (migrate(data)) {
    savePets(data);
  }
  return data;
}

/* ═══════════════════════════════════════════════════════
   GROUPING  (for stacked display)
   ═══════════════════════════════════════════════════════ */

/** Group by base type ID → stacked entries */
function groupByType(animals) {
  const m = new Map();
  for (const p of animals) {
    const k = baseId(p.rarity || 'common', p.name || 'pet');
    if (!m.has(k)) m.set(k, { typeId: k, name: p.name, emoji: p.emoji || '🐾', rarity: p.rarity || 'common', pets: [] });
    m.get(k).pets.push(p);
  }
  return [...m.values()];
}

/** Group by rarity name */
function groupByRarity(animals) {
  const m = {};
  for (const p of animals) { const r = p.rarity || 'common'; (m[r] ??= []).push(p); }
  return m;
}

/* ═══════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════ */

module.exports = {
  PETS_PATH,
  RARITY_PREFIX, RARITY_EMOJI, RARITY_COLOR, RARITY_ORDER,
  WEAPONS, WEAPON_BOX_WEIGHTS, WEAPON_CRATE_WEIGHTS, weaponsByRarity,
  SKILL_DEFS, SKILL_LABEL, playerLearnableSkills, MAX_EQUIPPED_SKILLS,
  NEW_ID_RE,
  loadPets, savePets, ensureUser,
  baseId, nextId, migrate,
  groupByType, groupByRarity,
};
