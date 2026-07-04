'use strict';

/**
 * battle.js — pet battle command.
 *
 * Two modes, kept consistent with the rest of the bet-game commands
 * (rps / tictactoe / connect4):
 *
 *   • PvE  — `battle` (no opponent). Picks a tier-appropriate enemy
 *            and runs the simulation immediately. Result is rendered
 *            via the shared `economyCanvas.createBattleCard` so it
 *            matches hunt / fish / adventure visually.
 *
 *   • PvP  — `battle @user [bet]`. Posts an Accept/Decline challenge
 *            using the shared `pvpGameHelper.buildChallenge` UI. On
 *            accept both players' bets are escrowed and the winner
 *            takes the pot. Decline / 60s timeout cancels cleanly.
 *
 * Backward compatibility: the legacy `battle pvp @user` form still
 * works — `pvp` is detected as a sub-command alias.
 */

const {
    ButtonBuilder, ActionRowBuilder, ButtonStyle, MessageFlags,
    ContainerBuilder, TextDisplayBuilder, AttachmentBuilder,
    MediaGalleryBuilder, MediaGalleryItemBuilder,
} = require('discord.js');
const { formatCoins, formatCoinsShort, coinIcon } = require('../../utils/currencyHelper');
const { createContainer, addTextDisplay, addSeparator, formatNumber, getErrorContainer, SeparatorSpacingSize } = require('../../utils/componentHelpers');
const economyManager = require('../../utils/economyManager');
const ph = require('../../utils/petHelpers');
const { resolveUser } = require('../../utils/resolveUser');
const { parseBet, getBalance, MAX_BET } = require('../../utils/betHelper');
const {
    validateOpponent, deductBoth, settlePvP, buildChallenge, pvpError,
} = require('../../utils/pvpGameHelper');

let economyCanvas = null;
try { economyCanvas = require('../../utils/economyCanvas'); } catch { }

/* ═══════════════════════════════════════════════════
   COOLDOWNS / CONSTANTS
   ═══════════════════════════════════════════════════ */

const PVE_COOLDOWN = 15_000;
const pveCooldowns = new Map();

const CHALLENGE_TTL_MS = 60_000;
const challenges = new Map();   // challengeId → { challengerId, opponentId, bet, guildId, expiresAt }

/* ═══════════════════════════════════════════════════
   ENEMIES + SKILLS
   ═══════════════════════════════════════════════════ */

const ENEMIES = [
    { name: 'Goblin', emoji: '👺', tier: 1, baseHp: 60, baseAtk: 8, baseDef: 3, baseSpd: 5, skills: ['slash'], loot: { minCoins: 40, maxCoins: 100 } },
    { name: 'Skeleton', emoji: '💀', tier: 1, baseHp: 50, baseAtk: 10, baseDef: 2, baseSpd: 6, skills: ['bone_throw'], loot: { minCoins: 50, maxCoins: 120 } },
    { name: 'Slime', emoji: '🟢', tier: 1, baseHp: 80, baseAtk: 5, baseDef: 5, baseSpd: 3, skills: ['absorb'], loot: { minCoins: 30, maxCoins: 80 } },
    { name: 'Wolf Alpha', emoji: '🐺', tier: 2, baseHp: 100, baseAtk: 18, baseDef: 8, baseSpd: 12, skills: ['slash', 'howl'], loot: { minCoins: 100, maxCoins: 250 } },
    { name: 'Dark Mage', emoji: '🧙', tier: 2, baseHp: 70, baseAtk: 25, baseDef: 5, baseSpd: 8, skills: ['fireball', 'drain'], loot: { minCoins: 120, maxCoins: 300 } },
    { name: 'Stone Golem', emoji: '🗿', tier: 2, baseHp: 180, baseAtk: 12, baseDef: 20, baseSpd: 2, skills: ['slam', 'fortify'], loot: { minCoins: 150, maxCoins: 350 } },
    { name: 'Shadow Knight', emoji: '🖤', tier: 3, baseHp: 200, baseAtk: 30, baseDef: 15, baseSpd: 10, skills: ['slash', 'dark_strike', 'fortify'], loot: { minCoins: 250, maxCoins: 500 } },
    { name: 'Ice Dragon', emoji: '🐲', tier: 3, baseHp: 300, baseAtk: 35, baseDef: 18, baseSpd: 14, skills: ['fireball', 'frost_breath', 'howl'], loot: { minCoins: 400, maxCoins: 800 } },
    { name: 'Demon Lord', emoji: '👿', tier: 4, baseHp: 450, baseAtk: 45, baseDef: 22, baseSpd: 16, skills: ['dark_strike', 'drain', 'inferno'], loot: { minCoins: 600, maxCoins: 1200 } },
    { name: 'Void Entity', emoji: '🌑', tier: 4, baseHp: 500, baseAtk: 50, baseDef: 25, baseSpd: 20, skills: ['dark_strike', 'drain', 'inferno', 'void_collapse'], loot: { minCoins: 800, maxCoins: 1500 } },
];

// Battle skill table is sourced from the shared `petHelpers` catalog
// so /skill, /pets and the battle engine can never disagree on what a
// skill does. We still keep a local alias so the existing handler
// switch keeps reading short.
const SKILLS = ph.SKILL_DEFS;

/* ═══════════════════════════════════════════════════
   PURE COMBAT MATH
   ═══════════════════════════════════════════════════ */

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function scaleStats(base, level) {
    return {
        hp: Math.floor(base.baseHp * (1 + (level - 1) * 0.12)),
        atk: Math.floor(base.baseAtk * (1 + (level - 1) * 0.10)),
        def: Math.floor((base.baseDef || 0) * (1 + (level - 1) * 0.08)),
        spd: Math.floor((base.baseSpd || 0) * (1 + (level - 1) * 0.06)),
    };
}

function selectEnemy(petLevel) {
    const tier = petLevel <= 3 ? 1 : petLevel <= 7 ? 2 : petLevel <= 12 ? 3 : 4;
    const pool = ENEMIES.filter(e => e.tier <= tier);
    const selected = clone(pool[rand(0, pool.length - 1)]);
    const enemyLevel = Math.max(1, petLevel + rand(-2, 2));
    const stats = scaleStats(selected, enemyLevel);
    return {
        ...selected, level: enemyLevel,
        hp: stats.hp, maxHp: stats.hp,
        atk: stats.atk, def: stats.def, spd: stats.spd,
        rarity: tier === 4 ? 'mythic' : tier === 3 ? 'epic' : tier === 2 ? 'uncommon' : 'common',
        // Match the per-pet combat trackers so executeTurn's shield/DOT
        // bookkeeping doesn't crash when targeting an enemy.
        _dots: [], _shield: 0,
    };
}

function preparePet(storedPet) {
    const pet = clone(storedPet);
    const level = pet.level || 1;
    pet.hp = pet.baseHp ? Math.floor(pet.baseHp * (1 + (level - 1) * 0.12)) : (pet.hp || 50);
    pet.atk = pet.baseAtk ? Math.floor(pet.baseAtk * (1 + (level - 1) * 0.10)) : (pet.atk || 10);
    pet.def = pet.baseDef ? Math.floor(pet.baseDef * (1 + (level - 1) * 0.08)) : Math.floor(5 + level * 2);
    pet.spd = pet.baseSpd ? Math.floor(pet.baseSpd * (1 + (level - 1) * 0.06)) : Math.floor(5 + level);
    if (pet.weapon) pet.atk += pet.weapon.baseAtk || 0;
    pet.maxHp = pet.hp;

    // Normalise equipped skills:
    //   - Drop anything not in the shared catalog (defensive against
    //     legacy pets / typos in saved data).
    //   - Strip enemy-only skills (a player pet should never be using
    //     `inferno` or `void_collapse` even if their save has them).
    //   - Cap at MAX_EQUIPPED_SKILLS so an over-long list can't overflow.
    //   - Always guarantee at least `slash` so battle never picks from
    //     an empty array.
    const equipped = (Array.isArray(pet.skills) ? pet.skills : ['slash'])
        .filter(id => SKILLS[id] && !SKILLS[id].enemyOnly)
        .slice(0, ph.MAX_EQUIPPED_SKILLS || 3);
    pet.skills = equipped.length ? equipped : ['slash'];

    pet.level = level;
    pet.rarity = pet.rarity || 'common';

    // Reset transient combat trackers so successive battles don't
    // inherit stale shields/DOT entries from cloned data.
    pet._dots = [];
    pet._shield = 0;
    return pet;
}

function executeTurn(attacker, defender, skillId) {
    const skill = SKILLS[skillId] || SKILLS.slash;
    const log = [];

    /* ── Persistent effects (DOT + Shield) tick at the start of the
       attacker's turn. They live on the combatant object so they
       carry across rounds without needing a separate tracker. ── */
    if (Array.isArray(attacker._dots) && attacker._dots.length) {
        for (const d of attacker._dots) {
            const tickDmg = Math.max(1, Math.floor(d.dmg));
            attacker.hp -= tickDmg;
            d.turns--;
            log.push(`☠️ ${attacker.name} takes ${tickDmg} poison damage`);
        }
        attacker._dots = attacker._dots.filter(d => d.turns > 0);
        if (attacker.hp <= 0) return log;   // expired before they could act
    }

    const crit = Math.random() < 0.15;
    const miss = Math.random() < Math.max(0.05, 0.15 - (attacker.spd - defender.spd) * 0.01);

    /* Helper: apply a single chunk of damage, honouring an active
       defender shield. Returns the actual damage dealt after the
       shield absorbs its share. */
    const dealDmg = (raw) => {
        let dmg = Math.max(1, Math.floor(raw));
        if (defender._shield && defender._shield > 0) {
            const absorbed = Math.min(dmg, Math.floor(dmg * defender._shield));
            dmg -= absorbed;
            // Shield stays at the same percentage but only blocks one
            // hit before expiring — keeps it from trivialising fights.
            defender._shield = 0;
            if (absorbed > 0) log.push(`🛡️ ${defender.name} shield absorbed ${absorbed}`);
        }
        defender.hp -= dmg;
        return dmg;
    };

    switch (skill.type) {
        case 'dmg': {
            if (miss) { log.push(`${skill.emoji} ${attacker.name} → MISS!`); break; }
            const hits = Math.max(1, skill.hits || 1);
            for (let i = 0; i < hits; i++) {
                let dmg = Math.floor(attacker.atk * skill.mult - defender.def * 0.5);
                if (crit && i === 0) dmg = Math.floor(dmg * 1.5);
                const dealt = dealDmg(dmg);
                log.push(hits > 1
                    ? `${skill.emoji} ${attacker.name} → ${dealt} dmg (hit ${i + 1}/${hits})${crit && i === 0 ? ' CRIT!' : ''}`
                    : `${skill.emoji} ${attacker.name} → ${dealt} dmg${crit ? ' CRIT!' : ''}`);
                if (defender.hp <= 0) break;
            }
            break;
        }
        case 'heal': {
            const heal = Math.floor(attacker.maxHp * skill.amount);
            attacker.hp = Math.min(attacker.maxHp, attacker.hp + heal);
            log.push(`${skill.emoji} ${attacker.name} → healed ${heal} HP`);
            break;
        }
        case 'buff': {
            const inc = Math.floor(attacker[skill.stat] * skill.amount);
            attacker[skill.stat] += inc;
            log.push(`${skill.emoji} ${attacker.name} → +${inc} ${skill.stat.toUpperCase()}`);
            break;
        }
        case 'drain': {
            if (miss) { log.push(`${skill.emoji} ${attacker.name} → MISS!`); break; }
            let dmg = Math.floor(attacker.atk * skill.mult - defender.def * 0.3);
            if (crit) dmg = Math.floor(dmg * 1.5);
            const dealt = dealDmg(dmg);
            const healed = Math.floor(dealt * 0.4);
            attacker.hp = Math.min(attacker.maxHp, attacker.hp + healed);
            log.push(`${skill.emoji} ${attacker.name} → ${dealt} dmg, healed ${healed}${crit ? ' CRIT' : ''}`);
            break;
        }
        case 'dmg_debuff': {
            if (miss) { log.push(`${skill.emoji} ${attacker.name} → MISS!`); break; }
            let dmg = Math.floor(attacker.atk * skill.mult - defender.def * 0.4);
            if (crit) dmg = Math.floor(dmg * 1.5);
            const dealt = dealDmg(dmg);
            const debuffVal = Math.floor(defender[skill.debuff] * skill.debuffAmt);
            defender[skill.debuff] = Math.max(0, defender[skill.debuff] - debuffVal);
            log.push(`${skill.emoji} ${attacker.name} → ${dealt} dmg, -${debuffVal} ${skill.debuff.toUpperCase()}${crit ? ' CRIT' : ''}`);
            break;
        }
        case 'shield': {
            // Stash the absorption percentage on the attacker; the next
            // incoming hit consumes it in `dealDmg` above.
            attacker._shield = Math.max(attacker._shield || 0, skill.amount);
            log.push(`${skill.emoji} ${attacker.name} braces (-${Math.round(skill.amount * 100)}% next hit)`);
            break;
        }
        case 'dot': {
            if (miss) { log.push(`${skill.emoji} ${attacker.name} → MISS!`); break; }
            let dmg = Math.floor(attacker.atk * skill.mult - defender.def * 0.4);
            if (crit) dmg = Math.floor(dmg * 1.5);
            const dealt = dealDmg(dmg);
            const tickDmg = Math.floor(attacker.atk * (skill.dotMult || 0.10));
            defender._dots = defender._dots || [];
            defender._dots.push({ dmg: tickDmg, turns: skill.dotTurns || 3 });
            log.push(`${skill.emoji} ${attacker.name} → ${dealt} dmg + poison (${skill.dotTurns || 3}t)${crit ? ' CRIT' : ''}`);
            break;
        }
        case 'multi': {
            // Combo attack — deal a hit then apply a self-buff.
            if (miss) { log.push(`${skill.emoji} ${attacker.name} → MISS!`); break; }
            let dmg = Math.floor(attacker.atk * (skill.multAtk || 1.0) - defender.def * 0.4);
            if (crit) dmg = Math.floor(dmg * 1.5);
            const dealt = dealDmg(dmg);
            const defInc = Math.floor(attacker.def * (skill.defBuff || 0));
            if (defInc > 0) attacker.def += defInc;
            log.push(`${skill.emoji} ${attacker.name} → ${dealt} dmg${defInc ? `, +${defInc} DEF` : ''}${crit ? ' CRIT' : ''}`);
            break;
        }
    }
    return log;
}

function runBattle(petA, petB, maxRounds = 20) {
    const turnLog = [];
    let round = 0;
    while (petA.hp > 0 && petB.hp > 0 && round < maxRounds) {
        round++;
        const first = petA.spd >= petB.spd ? petA : petB;
        const second = first === petA ? petB : petA;

        turnLog.push(...executeTurn(first, second, first.skills[rand(0, first.skills.length - 1)]));
        if (second.hp <= 0) break;

        turnLog.push(...executeTurn(second, first, second.skills[rand(0, second.skills.length - 1)]));
    }
    return { turnLog, petA, petB, rounds: round };
}

/* ═══════════════════════════════════════════════════
   VISUALS — canvas card + text fallback
   ═══════════════════════════════════════════════════ */

/**
 * Render a battle card via economyCanvas. Returns null if canvas
 * isn't available or rendering fails so callers can fall back to a
 * text-only container.
 */
async function tryRenderCard(petA, petB, finalA, finalB, won, turnLog, rewards) {
    if (!economyCanvas?.createBattleCard) return null;
    try {
        return await economyCanvas.createBattleCard({
            petA: { ...petA, hp: Math.max(0, finalA.hp), maxHp: finalA.maxHp, atk: petA.atk, def: petA.def, spd: petA.spd, weapon: petA.weapon },
            petB: { ...petB, hp: Math.max(0, finalB.hp), maxHp: finalB.maxHp, atk: petB.atk, def: petB.def, spd: petB.spd, weapon: petB.weapon },
            turnLog,
            result: won ? 'win' : 'lose',
            rewards,
        });
    } catch {
        return null;
    }
}

function hpBar(current, max, len = 10) {
    const pct = Math.max(0, current) / Math.max(1, max);
    const filled = Math.round(pct * len);
    return '█'.repeat(filled) + '░'.repeat(len - filled);
}

/**
 * Build the result container. If a canvas buffer was rendered, attach
 * it as a media gallery; otherwise fall back to a text-only summary.
 */
function buildResultContainer({ petA, petB, finalA, finalB, won, turnLog, rounds, rewards, cardBuffer, fileName, headline }) {
    const container = createContainer(won ? 0xCAD7E6 : 0xED4245);

    addTextDisplay(container, [
        `# ⚔️ ${headline || (won ? 'Victory!' : 'Defeated!')}`,
        '',
        `**${petA.emoji || '🐾'} ${petA.name}** Lv.${petA.level} vs **${petB.emoji || '👹'} ${petB.name}** Lv.${petB.level || '?'}`,
    ].join('\n'));

    if (cardBuffer && fileName) {
        const gallery = new MediaGalleryBuilder().addItems(
            new MediaGalleryItemBuilder({ media: { url: `attachment://${fileName}` } })
        );
        container.addMediaGalleryComponents(gallery);
    } else {
        addSeparator(container, SeparatorSpacingSize.Small);
        addTextDisplay(container, [
            `> ${petA.emoji || '🐾'} HP: \`${hpBar(Math.max(0, finalA.hp), finalA.maxHp)}\` ${Math.max(0, finalA.hp)}/${finalA.maxHp}`,
            `> ${petB.emoji || '👹'} HP: \`${hpBar(Math.max(0, finalB.hp), finalB.maxHp)}\` ${Math.max(0, finalB.hp)}/${finalB.maxHp}`,
            '',
            `⚔️ **Rounds:** ${rounds}`,
        ].join('\n'));

        addSeparator(container, SeparatorSpacingSize.Small);
        addTextDisplay(container, [
            '**Battle Log** (last 5):',
            ...turnLog.slice(-5).map(l => `> ${l}`),
        ].join('\n'));
    }

    if (rewards) {
        addSeparator(container, SeparatorSpacingSize.Small);
        const lines = ['### <:Award:1521228119640375336> Rewards'];
        if (rewards.coins) lines.push(`> <:Money:1521228266957045900> **+${formatNumber(rewards.coins)}** coins`);
        if (rewards.exp) lines.push(`> <:Lightning:1521227915537285150> **+${rewards.exp}** XP`);
        if (rewards.leveledUp) lines.push(`> <:Fire:1521227907647668374> **Level Up → Lv.${rewards.newLevel}**`);
        addTextDisplay(container, lines.join('\n'));
    }

    return container;
}

/* ═══════════════════════════════════════════════════
   PvE
   ═══════════════════════════════════════════════════ */

async function handlePVE(reply, userId, guildId) {
    const now = Date.now();

    if (pveCooldowns.get(userId) > now) {
        const left = Math.ceil((pveCooldowns.get(userId) - now) / 1000);
        const c = createContainer(0xED4245);
        addTextDisplay(c, `<:Clock:1521228110408847623> Battle cooldown: **${left}s** remaining.`);
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const petsData = ph.loadPets();
    const userData = petsData[userId];

    if (!userData || !userData.activeBattlePet) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, '<:Cancel:1521227723916181644> Set an active battle pet first! Use `pets active <petId>`');
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    const storedPet = userData.animals.find(p => p.id === userData.activeBattlePet);
    if (!storedPet) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, '<:Cancel:1521227723916181644> Active pet not found.');
        return reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }

    pveCooldowns.set(userId, now + PVE_COOLDOWN);

    const petA = preparePet(storedPet);
    const enemy = selectEnemy(storedPet.level || 1);
    const { turnLog, petA: finalA, petB: finalB, rounds } = runBattle(petA, enemy);
    const won = finalA.hp > 0;
    let rewards = null;

    if (won) {
        const expGain = 25 + enemy.level * 12 + enemy.tier * 15;
        const coinReward = rand(enemy.loot.minCoins, enemy.loot.maxCoins) + enemy.level * 10;

        storedPet.exp = (storedPet.exp || 0) + expGain;
        const expForLevel = (storedPet.level || 1) * 100;
        if (storedPet.exp >= expForLevel) {
            storedPet.exp -= expForLevel;
            storedPet.level = (storedPet.level || 1) + 1;
            storedPet.baseHp = Math.floor((storedPet.baseHp || 50) * 1.06);
            storedPet.baseAtk = Math.floor((storedPet.baseAtk || 10) * 1.05);
            storedPet.baseDef = Math.floor((storedPet.baseDef || 5) * 1.04);
            storedPet.baseSpd = Math.floor((storedPet.baseSpd || 5) * 1.03);
        }
        ph.savePets(petsData);

        const economy = economyManager.loadEconomy();
        const ecoUser = economyManager.getUser(economy, userId).userData;
        ecoUser.coins += coinReward;
        // Track lifetime earnings the same way fish/hunt/adventure do
        // so the /profile card and leaderboards show consistent numbers.
        ecoUser.totalEarned = (ecoUser.totalEarned || 0) + coinReward;
        ecoUser.battlesWon = (ecoUser.battlesWon || 0) + 1;
        const xpResult = economyManager.addXP(economy, userId, 10 + enemy.tier * 5);
        if (ecoUser.battlesWon === 1) economyManager.checkAchievement(economy, userId, 'first_battle');
        if (ecoUser.battlesWon >= 50) economyManager.checkAchievement(economy, userId, 'battle_50');
        economyManager.saveEconomy(economy);

        rewards = { coins: coinReward, exp: expGain, leveledUp: xpResult.leveledUp, newLevel: xpResult.newLevel, rounds };
    } else {
        const economy = economyManager.loadEconomy();
        const u = economyManager.getUser(economy, userId).userData;
        u.battlesLost = (u.battlesLost || 0) + 1;
        // Even on a loss, award a tiny XP nibble so the user feels the
        // round mattered — they brought a pet to fight, that's effort.
        economyManager.addXP(economy, userId, 3);
        economyManager.saveEconomy(economy);
        // Surface the round count even on a loss so the canvas
        // result strip shows "⚔️ N rounds" instead of being blank.
        rewards = { exp: 3, rounds };
    }

    const cardBuffer = await tryRenderCard(petA, enemy, finalA, finalB, won, turnLog, rewards);
    const fileName = `battle_${userId}_${Date.now()}.png`;

    const container = buildResultContainer({
        petA, petB: enemy, finalA, finalB, won, turnLog, rounds, rewards,
        cardBuffer, fileName,
    });

    const opts = { components: [container], flags: MessageFlags.IsComponentsV2 };
    if (cardBuffer) opts.files = [new AttachmentBuilder(cardBuffer, { name: fileName })];
    return reply(opts);
}

/* ═══════════════════════════════════════════════════
   PvP — challenge / accept / decline
   ═══════════════════════════════════════════════════ */

function hasPendingChallenge(userId) {
    for (const ch of challenges.values()) {
        if (ch.challengerId === userId || ch.opponentId === userId) return true;
    }
    return false;
}

function expireOldChallenges() {
    const now = Date.now();
    for (const [id, ch] of challenges.entries()) {
        if (ch.expiresAt < now) challenges.delete(id);
    }
}

async function handlePVP(message, target, betArg, guildId) {
    expireOldChallenges();

    if (!target) {
        const c = createContainer(0xED4245);
        addTextDisplay(c, [
            '# ⚔️ PvP Battle',
            '',
            '**Usage:** `battle @user [bet]`',
            '',
            '> Challenge another player\'s active pet to a duel.',
            '> Bet is optional — both players match the bet, winner takes the pot.',
        ].join('\n'));
        return message.reply({ components: [c], flags: MessageFlags.IsComponentsV2 });
    }
    if (target.id === message.author.id) {
        return message.reply(pvpError('You cannot challenge yourself.'));
    }
    if (target.bot) {
        return message.reply(pvpError('You cannot challenge a bot — try `battle` (no opponent) for PvE.'));
    }

    const petsData = ph.loadPets();
    const a = petsData[message.author.id];
    const b = petsData[target.id];
    if (!a?.activeBattlePet) return message.reply(pvpError('You don\'t have an active battle pet.'));
    if (!b?.activeBattlePet) return message.reply(pvpError(`<@${target.id}> doesn't have an active battle pet.`));
    if (!a.animals.find(p => p.id === a.activeBattlePet)) return message.reply(pvpError('Your active pet was not found.'));
    if (!b.animals.find(p => p.id === b.activeBattlePet)) return message.reply(pvpError(`${target.username}'s active pet was not found.`));

    if (hasPendingChallenge(message.author.id)) return message.reply(pvpError('You already have a pending challenge — wait for it to resolve or expire.'));
    if (hasPendingChallenge(target.id)) return message.reply(pvpError(`<@${target.id}> already has a pending challenge.`));

    /* ── Bet parsing ── */
    let bet = 0;
    if (betArg) {
        const balance = getBalance(message.author.id);
        const r = parseBet(betArg, balance);
        // parseBet returns { valid, amount, error } — NOT { ok, message }.
        // The previous version checked `r.ok`, which was always falsy, so
        // any PvP battle with a bet silently fell through and replied
        // with `pvpError(undefined)`.
        if (!r.valid) {
            return message.reply(r.error);
        }
        bet = r.amount;

        const v = validateOpponent(message.author.id, target, bet);
        if (!v.ok) return message.reply(v.message);
    }

    /* ── Post the challenge ── */
    const challengeId = `${message.author.id}-${target.id}-${Date.now()}`;
    challenges.set(challengeId, {
        challengerId: message.author.id,
        opponentId: target.id,
        bet,
        guildId,
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });

    const challenge = bet > 0
        ? buildChallenge({
            gameLabel: 'Pet Battle',
            gameEmoji: '⚔️',
            challengerId: message.author.id,
            opponentId: target.id,
            bet,
            guildId,
            idPrefix: 'btlch',
            challengeId,
        })
        : buildBetlessChallenge({
            challengerId: message.author.id,
            opponentId: target.id,
            challengeId,
        });

    return message.reply(challenge);
}

/**
 * Battle-specific challenge UI for the no-bet case. The shared
 * `buildChallenge` always shows a bet/pot line, which would look
 * weird for a friendly duel. This variant matches the visual style
 * but drops the financial bits.
 */
function buildBetlessChallenge({ challengerId, opponentId, challengeId }) {
    const c = new ContainerBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent([
            `# ⚔️ Pet Battle Challenge`,
            ``,
            `<@${challengerId}> has challenged <@${opponentId}> to a friendly duel!`,
            ``,
            `<@${opponentId}> — accept within 60s to bring out your active pet.`,
        ].join('\n')))
        .addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`btlch_accept_${challengeId}`)
                .setLabel('Accept')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:Checkedbox:1521227734943269077>'),
            new ButtonBuilder()
                .setCustomId(`btlch_decline_${challengeId}`)
                .setLabel('Decline')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('<:Cancel:1521227723916181644>'),
        ));
    return { components: [c], flags: MessageFlags.IsComponentsV2, allowedMentions: { users: [opponentId] } };
}

/**
 * Resolve an accepted PvP challenge: run the simulation, settle bets,
 * and edit the challenge message with the result.
 *
 * Caller contract: this function expects the interaction to already be
 * deferred via `interaction.deferUpdate()` (see handleButton). All
 * surface mutations therefore go through `editReply`, not `update` —
 * calling `update()` after a defer raises InteractionAlreadyReplied on
 * the gateway and previously made Accept buttons appear to do nothing.
 */
async function resolveAcceptedChallenge(interaction, ch) {
    /** Replace the challenge message in-place; safe to call multiple times. */
    const editPanel = (payload) =>
        interaction.editReply(payload).catch(err => {
            // We can't surface this to the user (the original message
            // is already deferred) but logging the cause beats the
            // previous silent failure that masked accept bugs.
            console.error('[battle] editReply failed:', err?.message || err);
        });

    const petsData = ph.loadPets();
    const a = petsData[ch.challengerId];
    const b = petsData[ch.opponentId];
    if (!a?.activeBattlePet || !b?.activeBattlePet) {
        return editPanel(pvpError('One of the players no longer has an active pet.'));
    }

    const aPet = a.animals.find(p => p.id === a.activeBattlePet);
    const bPet = b.animals.find(p => p.id === b.activeBattlePet);
    if (!aPet || !bPet) {
        return editPanel(pvpError('One of the players\' active pets is missing.'));
    }

    /* ── Re-validate balances and escrow the bet ── */
    if (ch.bet > 0) {
        const economy = economyManager.loadEconomy();
        const cu = economyManager.getUser(economy, ch.challengerId).userData;
        const ou = economyManager.getUser(economy, ch.opponentId).userData;
        if (cu.coins < ch.bet || ou.coins < ch.bet) {
            return editPanel(pvpError('One of the players no longer has enough coins for this match.'));
        }
        deductBoth(ch.challengerId, ch.opponentId, ch.bet);
    }

    /* ── Run the simulation. Wrap in a try/catch so a bad render or
       canvas crash can't leave the bet escrowed with no result. ── */
    try {
        const petA = preparePet(aPet);
        const petB = preparePet(bPet);
        const { turnLog, petA: finalA, petB: finalB, rounds } = runBattle(petA, petB);
        const challengerWon = finalA.hp > 0;
        const winnerId = challengerWon ? ch.challengerId : ch.opponentId;
        const loserId = challengerWon ? ch.opponentId : ch.challengerId;

        /* ── Reward bookkeeping ── */
        let rewards = null;
        if (ch.bet > 0) {
            settlePvP({
                winnerId, loserId,
                aId: ch.challengerId, bId: ch.opponentId,
                bet: ch.bet, draw: false,
            });
            rewards = { coins: ch.bet * 2, exp: 15, rounds };
        } else {
            // Friendly duel: small XP only, no coin transfer.
            const economy = economyManager.loadEconomy();
            const w = economyManager.getUser(economy, winnerId).userData;
            const l = economyManager.getUser(economy, loserId).userData;
            w.battlesWon = (w.battlesWon || 0) + 1;
            l.battlesLost = (l.battlesLost || 0) + 1;
            const xpResult = economyManager.addXP(economy, winnerId, 10);
            economyManager.addXP(economy, loserId, 3);
            if (w.battlesWon === 1) economyManager.checkAchievement(economy, winnerId, 'first_battle');
            if (w.battlesWon >= 50) economyManager.checkAchievement(economy, winnerId, 'battle_50');
            economyManager.saveEconomy(economy);
            rewards = { exp: 10, leveledUp: xpResult.leveledUp, newLevel: xpResult.newLevel, rounds };
        }

        /* ── Render ── */
        const cardBuffer = await tryRenderCard(petA, petB, finalA, finalB, challengerWon, turnLog, rewards);
        const fileName = `pvp_battle_${ch.challengerId}_${ch.opponentId}_${Date.now()}.png`;

        const container = buildResultContainer({
            petA, petB,
            finalA, finalB,
            won: challengerWon,
            turnLog, rounds, rewards,
            cardBuffer, fileName,
            headline: `<@${winnerId}> wins!`,
        });

        const opts = { components: [container], flags: MessageFlags.IsComponentsV2 };
        if (cardBuffer) opts.files = [new AttachmentBuilder(cardBuffer, { name: fileName })];

        await editPanel(opts);
    } catch (err) {
        // Best-effort refund if we already escrowed but the simulation
        // bombed out — keeps the bet from disappearing into the void.
        if (ch.bet > 0) {
            try {
                const economy = economyManager.loadEconomy();
                const a2 = economyManager.getUser(economy, ch.challengerId).userData;
                const b2 = economyManager.getUser(economy, ch.opponentId).userData;
                a2.coins += ch.bet;
                b2.coins += ch.bet;
                economyManager.saveEconomy(economy);
            } catch { }
        }
        console.error('[battle] Simulation failed:', err?.message || err);
        await editPanel(pvpError(
            ch.bet > 0
                ? 'The match couldn\'t be resolved due to an internal error. Bets have been refunded.'
                : 'The match couldn\'t be resolved due to an internal error.'
        ));
    }
}

/* ═══════════════════════════════════════════════════
   COMMAND
   ═══════════════════════════════════════════════════ */

module.exports = {
    data: new (require('discord.js').SlashCommandBuilder)()
        .setName('battle')
        .setDescription('Battle enemies (PvE) or another player\'s pet (PvP)')
        .addUserOption(o => o.setName('opponent').setDescription('Challenge a player (omit for PvE)'))
        .addStringOption(o => o.setName('bet').setDescription('Optional bet for PvP — winner takes 2x')),
    prefix: 'battle',
    aliases: ['fight', 'bt'],
    category: 'economy',
    description: 'Battle a tier-appropriate enemy with your active pet, or challenge another player',

    async executePrefix(message, args) {
        // Legacy `battle pvp @user [bet]` — treat `pvp` as a noise word.
        let argv = args.slice();
        if (argv[0]?.toLowerCase() === 'pvp') argv = argv.slice(1);

        const target = await resolveUser(message, argv);
        if (target) {
            const tokens = argv.filter(a => !/^<@!?\d{17,20}>$/.test(a) && !/^\d{17,20}$/.test(a));
            const betArg = tokens[0] || null;
            return handlePVP(message, target, betArg, message.guild?.id);
        }
        return handlePVE(message.reply.bind(message), message.author.id, message.guild?.id);
    },

    async execute(interaction) {
        const opponent = interaction.options.getUser('opponent');
        if (opponent) {
            const betArg = interaction.options.getString('bet');
            // Wrap the interaction so handlePVP's `message.reply` works
            const fakeMessage = {
                author: interaction.user,
                guild: interaction.guild,
                reply: (opts) => interaction.reply(opts),
            };
            return handlePVP(fakeMessage, opponent, betArg, interaction.guild?.id);
        }
        return handlePVE(interaction.reply.bind(interaction), interaction.user.id, interaction.guild?.id);
    },

    /* ─────────── Routed by index.js for `btlch_…` button ids ─────────── */
    async handleButton(interaction) {
        const id = interaction.customId;
        if (!id.startsWith('btlch_')) return false;

        const accept = id.startsWith('btlch_accept_');
        const decline = id.startsWith('btlch_decline_');
        if (!accept && !decline) return false;

        // Recover the challengeId. We use slice(prefix.length) instead
        // of `replace(prefix, '')` so a literal `btlch_accept_` inside
        // a future challenge ID can never get clobbered.
        const prefix = accept ? 'btlch_accept_' : 'btlch_decline_';
        const challengeId = id.slice(prefix.length);
        const ch = challenges.get(challengeId);

        // ── 1. Stale / already-resolved challenge ──
        // If we use `update()` after another path beat us to a defer,
        // Discord will throw. Probe interaction state and pick the
        // matching method so the user always gets feedback.
        if (!ch) {
            const payload = pvpError('This challenge has expired or already been resolved.');
            try {
                if (interaction.replied || interaction.deferred) await interaction.editReply(payload);
                else await interaction.update(payload);
            } catch { }
            return true;
        }

        // ── 2. Wrong user trying to respond ──
        // Stays as an ephemeral reply so the original challenge UI
        // remains intact for the actual opponent.
        if (interaction.user.id !== ch.opponentId) {
            try {
                await interaction.reply({
                    components: [getErrorContainer('Only the challenged user can respond.')],
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                });
            } catch { }
            return true;
        }

        // Mark consumed FIRST so a double-click can't double-resolve.
        challenges.delete(challengeId);

        // ── 3. Decline ──
        if (decline) {
            const c = new ContainerBuilder().setAccentColor(0x6b7280)
                .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                    `# ⚔️ Challenge Declined\n\n<@${ch.opponentId}> declined the battle challenge.`
                ));
            const payload = { components: [c], flags: MessageFlags.IsComponentsV2 };
            try {
                if (interaction.replied || interaction.deferred) await interaction.editReply(payload);
                else await interaction.update(payload);
            } catch (err) {
                console.error('[battle] decline render failed:', err?.message || err);
            }
            return true;
        }

        // ── 4. Accept ──
        // The simulation can take a beat (canvas render, balance
        // re-check) so we defer first, then hand off to the resolver
        // which uses editReply. Without this defer the gateway would
        // close the interaction before the canvas finished rendering
        // and the Accept button would visibly do nothing.
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.deferUpdate();
            }
        } catch (err) {
            console.error('[battle] deferUpdate failed:', err?.message || err);
            // If the defer itself failed the interaction is probably
            // already gone; bail out cleanly.
            return true;
        }
        await resolveAcceptedChallenge(interaction, ch);
        return true;
    },
};
