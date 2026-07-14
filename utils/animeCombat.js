'use strict';

/**
 * animeCombat.js — combat layer for the anime collection system.
 *
 * Anime characters come from the AniList pool (stable ids, no combat data),
 * so stats and a signature ability are derived DETERMINISTICALLY from each
 * character's id + rarity. This means every character has consistent power,
 * an ability, and can equip a weapon — with zero extra stored per-character.
 *
 * Player state (stored on playerData in the anime_collection store):
 *   • weapons   : string[]              owned weapon ids
 *   • loadouts  : { [charId]: weaponId } equipped weapon per character
 *
 * Exports helpers for stats, abilities, the weapon catalog, and a lightweight
 * round-based battle resolver used by /abattle.
 */

const crypto = require('crypto');
const { getRarityEmoji } = require('./rarityBadges');

/* ═══════════════════════════════════════════════════════
   DETERMINISTIC HASH
   ═══════════════════════════════════════════════════════ */

function hashInt(str, salt = '') {
    const h = crypto.createHash('md5').update(String(str) + '|' + salt).digest();
    return h.readUInt32BE(0);
}
/** Deterministic value in [0,1) from a key. */
function hash01(str, salt = '') { return (hashInt(str, salt) % 100000) / 100000; }

/* ═══════════════════════════════════════════════════════
   BASE STATS (per rarity) + deterministic ±15% variance
   ═══════════════════════════════════════════════════════ */

const RARITY_INDEX = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };

const RARITY_STATS = {
    common:    { atk: 45,  hp: 220, spd: 42 },
    uncommon:  { atk: 60,  hp: 280, spd: 50 },
    rare:      { atk: 82,  hp: 360, spd: 60 },
    epic:      { atk: 110, hp: 460, spd: 72 },
    legendary: { atk: 150, hp: 600, spd: 88 },
    mythic:    { atk: 200, hp: 800, spd: 105 },
};

/** Derive a character's base stats (deterministic per id). */
function getStats(char) {
    const base = RARITY_STATS[char.rarity] || RARITY_STATS.common;
    // ±15% variance, deterministic per character + a small favourites nudge.
    const vAtk = 0.85 + hash01(char.id, 'atk') * 0.30;
    const vHp = 0.85 + hash01(char.id, 'hp') * 0.30;
    const vSpd = 0.85 + hash01(char.id, 'spd') * 0.30;
    const fav = Math.min(0.15, (char.favourites || 0) / 500000); // up to +15% for super-popular
    return {
        atk: Math.round(base.atk * vAtk * (1 + fav)),
        hp: Math.round(base.hp * vHp * (1 + fav)),
        spd: Math.round(base.spd * vSpd),
    };
}

/* ═══════════════════════════════════════════════════════
   ABILITIES (signature power per character)
   ═══════════════════════════════════════════════════════ */

// `minTier` = lowest rarity index that can roll this ability.
const ABILITIES = [
    { id: 'slash',   name: 'Blade Slash',       emoji: '⚔️', minTier: 0, desc: '+10% ATK',                                  mods: { atkPct: 0.10 } },
    { id: 'guard',   name: 'Iron Guard',        emoji: '🛡️', minTier: 0, desc: '+18% HP',                                  mods: { hpPct: 0.18 } },
    { id: 'swift',   name: 'Swift Step',        emoji: '💨', minTier: 1, desc: '+20% SPD, strikes first',                   mods: { spdPct: 0.20 } },
    { id: 'focus',   name: 'Focused Mind',      emoji: '🎯', minTier: 1, desc: '+12% ATK, +8% HP',                          mods: { atkPct: 0.12, hpPct: 0.08 } },
    { id: 'crit',    name: 'Critical Eye',      emoji: '👁️', minTier: 2, desc: '25% chance to crit ×1.8',                  mods: { crit: 0.25, critMult: 1.8 } },
    { id: 'regen',   name: 'Regeneration',      emoji: '♻️', minTier: 2, desc: 'Heals 7% max HP each round',               mods: { regen: 0.07 } },
    { id: 'berserk', name: 'Berserker Rage',    emoji: '🔥', minTier: 3, desc: '+30% ATK while below 40% HP',              mods: { rageAtk: 0.30 } },
    { id: 'pierce',  name: 'Armor Pierce',      emoji: '🗡️', minTier: 3, desc: '+22% ATK, ignores guard',                 mods: { atkPct: 0.22, pierce: true } },
    { id: 'domain',  name: 'Domain Expansion',  emoji: '🌀', minTier: 4, desc: '+32% ATK & +15% crit',                     mods: { atkPct: 0.32, crit: 0.15, critMult: 1.8 } },
    { id: 'ultra',   name: 'Ultra Instinct',    emoji: '⚡', minTier: 5, desc: '35% dodge & +25% ATK',                     mods: { dodge: 0.35, atkPct: 0.25 } },
    { id: 'reality', name: 'Reality Rewrite',   emoji: '✨', minTier: 5, desc: '+40% ATK, 20% crit ×2.2',                  mods: { atkPct: 0.40, crit: 0.20, critMult: 2.2 } },
];

/** Deterministically assign one signature ability to a character. */
function getAbility(char) {
    const tier = RARITY_INDEX[char.rarity] ?? 0;
    const pool = ABILITIES.filter(a => a.minTier <= tier);
    // Weight toward higher-tier abilities for higher-rarity characters.
    const idx = hashInt(char.id, 'abil') % pool.length;
    return pool[idx];
}

/* ═══════════════════════════════════════════════════════
   WEAPONS (buy with coins, equip to a character)
   ═══════════════════════════════════════════════════════ */

const WEAPONS = {
    training_blade: { id: 'training_blade', name: 'Training Blade',   emoji: '🗡️', rarity: 'common',    price: 800,    atk: 12,  hp: 30,   spd: 6 },
    hunter_bow:     { id: 'hunter_bow',     name: 'Hunter Bow',       emoji: '🏹', rarity: 'uncommon',  price: 2000,   atk: 22,  hp: 40,   spd: 14 },
    flame_katana:   { id: 'flame_katana',   name: 'Flame Katana',     emoji: '🔥', rarity: 'rare',      price: 5000,   atk: 40,  hp: 80,   spd: 18 },
    frost_lance:    { id: 'frost_lance',    name: 'Frost Lance',      emoji: '❄️', rarity: 'rare',      price: 5500,   atk: 36,  hp: 110,  spd: 12 },
    storm_gauntlet: { id: 'storm_gauntlet', name: 'Storm Gauntlet',   emoji: '🌩️', rarity: 'epic',      price: 12000,  atk: 65,  hp: 150,  spd: 30 },
    dragon_fang:    { id: 'dragon_fang',    name: 'Dragon Fang',      emoji: '🐉', rarity: 'epic',      price: 14000,  atk: 80,  hp: 130,  spd: 22 },
    celestial_edge: { id: 'celestial_edge', name: 'Celestial Edge',   emoji: '🌟', rarity: 'legendary', price: 30000,  atk: 120, hp: 250,  spd: 45 },
    void_scythe:    { id: 'void_scythe',    name: 'Void Scythe',      emoji: '🌑', rarity: 'legendary', price: 34000,  atk: 140, hp: 200,  spd: 40 },
    god_slayer:     { id: 'god_slayer',     name: 'God Slayer',       emoji: '⚡', rarity: 'mythic',    price: 75000,  atk: 210, hp: 380,  spd: 70 },
    infinity_blade: { id: 'infinity_blade', name: 'Infinity Blade',   emoji: '♾️', rarity: 'mythic',    price: 90000,  atk: 250, hp: 320,  spd: 80 },
};

function getWeapon(id) { return WEAPONS[id] || null; }
function listWeapons() { return Object.values(WEAPONS); }

/* ═══════════════════════════════════════════════════════
   EFFECTIVE STATS (base + weapon), and battle power score
   ═══════════════════════════════════════════════════════ */

/** Combine a character's base stats with an equipped weapon (may be null). */
function effectiveStats(char, weapon) {
    const s = getStats(char);
    if (weapon) {
        s.atk += weapon.atk || 0;
        s.hp += weapon.hp || 0;
        s.spd += weapon.spd || 0;
    }
    return s;
}

/** A single "battle power" number for quick ranking / comparisons. */
function battlePower(char, weapon) {
    const s = effectiveStats(char, weapon);
    const ab = getAbility(char);
    const abilityBoost = 1 + (ab.mods.atkPct || 0) * 0.6 + (ab.mods.hpPct || 0) * 0.3 + (ab.mods.crit || 0);
    return Math.round((s.atk * 1.0 + s.hp * 0.18 + s.spd * 0.6) * abilityBoost);
}

/* ═══════════════════════════════════════════════════════
   BATTLE RESOLVER — lightweight round-based simulation
   ═══════════════════════════════════════════════════════ */

/**
 * Simulate a battle between two fighters.
 * @param {object} A { char, weapon, name }
 * @param {object} B { char, weapon, name }
 * @param {function} rnd  optional RNG (defaults Math.random) for testability
 * @returns {{ winner:'A'|'B', rounds:string[], aHp, bHp, aStats, bStats, aAbility, bAbility }}
 */
function simulate(A, B, rnd = Math.random) {
    const build = (F) => {
        const stats = effectiveStats(F.char, F.weapon);
        const ability = getAbility(F.char);
        return { ...F, stats, ability, hp: stats.hp, maxHp: stats.hp };
    };
    const a = build(A), b = build(B);

    // Faster fighter strikes first.
    let first = a.stats.spd >= b.stats.spd ? a : b;
    let second = first === a ? b : a;
    const rounds = [];

    const attack = (att, def) => {
        let dmg = att.stats.atk;
        const m = att.ability.mods;
        if (m.atkPct) dmg *= (1 + m.atkPct);
        // Berserker: bonus when low HP
        if (m.rageAtk && att.hp < att.maxHp * 0.4) dmg *= (1 + m.rageAtk);
        // Crit
        let crit = false;
        if (m.crit && rnd() < m.crit) { dmg *= (m.critMult || 1.8); crit = true; }
        // Defender dodge
        if (def.ability.mods.dodge && rnd() < def.ability.mods.dodge) {
            return { dmg: 0, dodged: true, crit: false };
        }
        // Guard reduces damage unless attacker pierces
        if (def.ability.mods.hpPct && !m.pierce) dmg *= 0.9;
        dmg = Math.max(1, Math.round(dmg * (0.85 + rnd() * 0.3)));
        def.hp -= dmg;
        // Attacker regen
        if (m.regen) att.hp = Math.min(att.maxHp, att.hp + Math.round(att.maxHp * m.regen));
        return { dmg, dodged: false, crit };
    };

    const MAX_ROUNDS = 12;
    for (let r = 1; r <= MAX_ROUNDS && a.hp > 0 && b.hp > 0; r++) {
        const r1 = attack(first, second);
        if (second.hp <= 0) { rounds.push(fmtRound(r, first, second, r1)); break; }
        const r2 = attack(second, first);
        rounds.push(fmtRound(r, first, second, r1) + '  ·  ' + fmtRound(r, second, first, r2, true));
        if (first.hp <= 0) break;
    }

    let winner;
    if (a.hp <= 0 && b.hp <= 0) winner = a.stats.atk >= b.stats.atk ? 'A' : 'B';
    else if (b.hp <= 0) winner = 'A';
    else if (a.hp <= 0) winner = 'B';
    else winner = a.hp >= b.hp ? 'A' : 'B'; // timeout → most HP left

    return {
        winner,
        aHp: Math.max(0, Math.round(a.hp)), bHp: Math.max(0, Math.round(b.hp)),
        aStats: a.stats, bStats: b.stats,
        aAbility: a.ability, bAbility: b.ability,
    };
}

function fmtRound(r, att, def, res) {
    if (res.dodged) return `${att.name} attacks — ${def.name} dodges!`;
    return `${att.name} hits ${res.crit ? '💥CRIT ' : ''}${res.dmg}`;
}

/* ═══════════════════════════════════════════════════════
   PLAYER LOADOUT HELPERS
   ═══════════════════════════════════════════════════════ */

function ensureCombatState(playerData) {
    if (!Array.isArray(playerData.weapons)) playerData.weapons = [];
    if (!playerData.loadouts || typeof playerData.loadouts !== 'object') playerData.loadouts = {};
}

function ownsWeapon(playerData, weaponId) {
    ensureCombatState(playerData);
    return playerData.weapons.includes(weaponId);
}

function addWeapon(playerData, weaponId) {
    ensureCombatState(playerData);
    if (!playerData.weapons.includes(weaponId)) playerData.weapons.push(weaponId);
}

function getEquippedWeapon(playerData, charId) {
    ensureCombatState(playerData);
    const wid = playerData.loadouts[charId];
    return wid ? getWeapon(wid) : null;
}

function equipWeapon(playerData, charId, weaponId) {
    ensureCombatState(playerData);
    if (!ownsWeapon(playerData, weaponId)) return false;
    playerData.loadouts[charId] = weaponId;
    return true;
}

function unequipWeapon(playerData, charId) {
    ensureCombatState(playerData);
    delete playerData.loadouts[charId];
}

module.exports = {
    RARITY_INDEX,
    ABILITIES,
    WEAPONS,
    getStats,
    getAbility,
    getWeapon,
    listWeapons,
    effectiveStats,
    battlePower,
    simulate,
    ensureCombatState,
    ownsWeapon,
    addWeapon,
    getEquippedWeapon,
    equipWeapon,
    unequipWeapon,
    getRarityEmoji,
};
