'use strict';

/**
 * /skill — manage your active pet's combat skills.
 *
 * Subcommands
 *   skill list                 - list every skill in the catalog with
 *                                price, unlock-tier and the active
 *                                pet's learned/equipped state
 *   skill info  <skill>        - full details for a single skill
 *   skill learn <skill>        - permanently teach the active pet a
 *                                skill (deducts the catalog price; the
 *                                pet must meet the unlock-tier)
 *   skill equip <skill>        - move a learned skill into the pet's
 *                                equipped loadout (capped at
 *                                `MAX_EQUIPPED_SKILLS`)
 *   skill unequip <skill>      - remove a skill from the loadout
 *   skill forget <skill>       - drop a skill from the learned pool
 *                                entirely (refunds nothing — works as
 *                                a way to free up the loadout if a
 *                                pet's learned a skill it no longer
 *                                wants to keep visible)
 *
 * The catalog lives in `utils/petHelpers.js` so the slash, prefix, /pets
 * detail panel and the battle engine all read identical data.
 */

const { SlashCommandBuilder } = require('discord.js');

const { createContainer, addTextDisplay, MessageFlags } = require('../../utils/componentHelpers');
const { formatCoins, formatCoinsAmount, coinIcon } = require('../../utils/currencyHelper');
const economyManager = require('../../utils/economyManager');
const ph = require('../../utils/petHelpers');

// Per-user re-entry guard for the coin-spending learn flow. Without
// this, two parallel `skill learn` invocations (slash + prefix) from
// the same user could both pass the balance check on the same live
// cache and double-charge the user. Cleared in a finally block.
const learnInFlight = new Set();

const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');

/* ─────────────── helpers ─────────────── */

function reqActivePet(message) {
    const pets = ph.loadPets();
    ph.ensureUser(pets, message.author.id);
    const userData = pets[message.author.id];
    if (!userData?.activeBattlePet) return { error: 'Set an active battle pet first — use `pets active <petId>` or `/pets`.' };
    const pet = userData.animals.find(p => p.id === userData.activeBattlePet);
    if (!pet) return { error: 'Active pet not found. Set one with `pets active <petId>`.' };
    if (!Array.isArray(pet.skills) || pet.skills.length === 0) pet.skills = ['slash'];
    if (!Array.isArray(pet.learnedSkills) || pet.learnedSkills.length === 0) {
        pet.learnedSkills = Array.from(new Set([...(pet.skills || []), 'slash']));
    }
    return { pets, userData, pet };
}

function err(text) {
    const c = createContainer(0xED4245);
    addTextDisplay(c, `<:Cancel:1521227723916181644> ${text}`);
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

function ok(text, color = 0xCAD7E6) {
    const c = createContainer(color);
    addTextDisplay(c, text);
    return { components: [c], flags: MessageFlags.IsComponentsV2 };
}

/* ─────────────── subcommands ─────────────── */

function cmdList(message, pet, guildId) {
    const learned = new Set(pet.learnedSkills || []);
    const equipped = new Set(pet.skills || []);
    const max = ph.MAX_EQUIPPED_SKILLS;

    const lines = [
        `# <:Lightningalt:1521227851796447472> Skills Catalog`,
        `-# Active pet: ${pet.emoji} **${pet.name}** Lv.${pet.level || 1}  ·  Equipped **${equipped.size}/${max}**  ·  Learned **${learned.size}**`,
        '',
    ];

    // Group by unlock tier so the list reads as a progression ladder.
    const byTier = {};
    for (const s of ph.playerLearnableSkills()) {
        const tier = s.unlockTier || 1;
        (byTier[tier] ||= []).push(s);
    }
    const tiers = Object.keys(byTier).map(Number).sort((a, b) => a - b);

    for (const tier of tiers) {
        lines.push(`### Tier ${tier}${(pet.level || 1) >= tier ? ' <:Checkedbox:1521227734943269077>' : ' <:Clock:1521228110408847623>'}`);
        for (const s of byTier[tier]) {
            const isLearned  = learned.has(s.id);
            const isEquipped = equipped.has(s.id);
            const status = isEquipped ? '⚔️ Equipped'
                          : isLearned ? '<:Checkedbox:1521227734943269077> Learned'
                          : `${coinIcon(guildId)} ${formatCoinsAmount(s.price, guildId)}`;
            lines.push(`> \`${s.id}\` — ${s.name} · ${status}`);
            lines.push(`> -# ${s.description}`);
        }
        lines.push('');
    }

    lines.push(`-# Use \`skill learn <id>\` to learn  ·  \`skill equip <id>\` to add to loadout  ·  \`skill info <id>\` for details`);

    return ok(lines.join('\n'));
}

function cmdInfo(skillId) {
    const def = ph.SKILL_DEFS[skillId];
    if (!def || def.enemyOnly) return err(`Unknown skill \`${skillId}\`. Use \`skill list\` to see what's available.`);

    const lines = [
        `# ${def.name}`,
        `-# ${def.description}`,
        '',
        `**Type:** \`${def.type}\``,
        def.mult        != null ? `**Damage Mult:** ${def.mult}x` : null,
        def.amount      != null && def.type === 'heal'   ? `**Heal:** ${Math.round(def.amount * 100)}% of max HP` : null,
        def.amount      != null && def.type === 'shield' ? `**Shield:** absorbs ${Math.round(def.amount * 100)}% of next hit` : null,
        def.amount      != null && def.type === 'buff'   ? `**Buff:** +${Math.round(def.amount * 100)}% ${def.stat?.toUpperCase()}` : null,
        def.hits        != null ? `**Hits:** ${def.hits}x` : null,
        def.dotMult     != null ? `**Damage Over Time:** ${Math.round(def.dotMult * 100)}% ATK for ${def.dotTurns || 3} rounds` : null,
        def.debuff      ? `**Debuff:** -${Math.round(def.debuffAmt * 100)}% ${def.debuff?.toUpperCase()}` : null,
        '',
        `**Unlock Tier:** Lv.${def.unlockTier || 1}  ·  **Price:** ${def.price > 0 ? formatCoins(def.price) + ' coins' : 'Free starter'}`,
    ].filter(Boolean);

    return ok(lines.join('\n'));
}

function cmdLearn(skillId, pet, userData, pets, message, guildId) {
    const def = ph.SKILL_DEFS[skillId];
    if (!def || def.enemyOnly) return err(`Unknown skill \`${skillId}\`. Use \`skill list\` to see what's available.`);

    const learned = new Set(pet.learnedSkills || []);
    if (learned.has(skillId)) {
        return err(`${pet.emoji} **${pet.name}** already knows **${def.name}**.`);
    }
    if ((pet.level || 1) < (def.unlockTier || 1)) {
        return err(`**${def.name}** unlocks at pet level **${def.unlockTier || 1}**. Your active pet is level **${pet.level || 1}**.`);
    }

    const userId = message.author.id;
    if (learnInFlight.has(userId)) {
        return err('A previous skill learn is still completing — try again in a moment.');
    }

    learnInFlight.add(userId);
    try {
        const economy = economyManager.loadEconomy();
        const econ = economyManager.getUser(economy, userId).userData;
        const cost = def.price || 0;
        if (cost > 0 && econ.coins < cost) {
            return err(`Not enough coins. **${def.name}** costs **${formatCoins(cost, guildId)}** but you have **${formatCoins(econ.coins, guildId)}**.`);
        }
        if (cost > 0) econ.coins -= cost;

        pet.learnedSkills = [...learned, skillId];
        ph.savePets(pets);
        economyManager.saveEconomy(economy);

        return ok([
            `# <:Lightbulbalt:1521227880703463675> Skill Learned`,
            '',
            `${pet.emoji} **${pet.name}** learned **${def.name}**!`,
        cost > 0 ? `${coinIcon(guildId)} Cost: **${formatCoinsAmount(cost, guildId)}**` : '',
        '',
        `-# Use \`skill equip ${skillId}\` to bring it into battle (cap **${ph.MAX_EQUIPPED_SKILLS}**).`,
    ].filter(Boolean).join('\n'));
    } finally {
        learnInFlight.delete(userId);
    }
}

function cmdEquip(skillId, pet, pets) {
    const def = ph.SKILL_DEFS[skillId];
    if (!def || def.enemyOnly) return err(`Unknown skill \`${skillId}\`. Use \`skill list\` to see what's available.`);

    const learned = new Set(pet.learnedSkills || []);
    if (!learned.has(skillId)) {
        return err(`${pet.emoji} **${pet.name}** hasn't learned **${def.name}** yet. Use \`skill learn ${skillId}\` first.`);
    }

    const equipped = new Set(pet.skills || []);
    if (equipped.has(skillId)) {
        return err(`**${def.name}** is already equipped.`);
    }
    if (equipped.size >= ph.MAX_EQUIPPED_SKILLS) {
        return err(`Loadout full (**${ph.MAX_EQUIPPED_SKILLS}/${ph.MAX_EQUIPPED_SKILLS}**). Unequip a skill first with \`skill unequip <id>\`.`);
    }

    pet.skills = [...equipped, skillId];
    ph.savePets(pets);

    return ok([
        `# ⚔️ Skill Equipped`,
        '',
        `${pet.emoji} **${pet.name}** can now use **${def.name}** in battle.`,
        `-# Loadout: ${pet.skills.map(id => ph.SKILL_LABEL[id] || id).join(', ')}`,
    ].join('\n'));
}

function cmdUnequip(skillId, pet, pets) {
    const def = ph.SKILL_DEFS[skillId];
    if (!def) return err(`Unknown skill \`${skillId}\`.`);

    if (!pet.skills?.includes(skillId)) {
        return err(`**${def.name}** isn't equipped.`);
    }
    const next = pet.skills.filter(id => id !== skillId);
    // A pet always needs at least one skill so the battle engine has
    // something to pick. If unequipping would empty the loadout, fall
    // back to the starter `slash`.
    pet.skills = next.length ? next : ['slash'];
    ph.savePets(pets);

    return ok([
        `# 🛠️ Skill Unequipped`,
        '',
        `${pet.emoji} **${pet.name}** removed **${def.name}** from the loadout.`,
        `-# Loadout: ${pet.skills.map(id => ph.SKILL_LABEL[id] || id).join(', ')}`,
    ].join('\n'));
}

function cmdForget(skillId, pet, pets) {
    const def = ph.SKILL_DEFS[skillId];
    if (!def) return err(`Unknown skill \`${skillId}\`.`);
    if (skillId === 'slash') return err('`slash` is the starter skill and can\'t be forgotten.');

    const learned = pet.learnedSkills || [];
    if (!learned.includes(skillId)) {
        return err(`${pet.emoji} **${pet.name}** doesn't know **${def.name}**.`);
    }

    pet.learnedSkills = learned.filter(id => id !== skillId);
    pet.skills = (pet.skills || []).filter(id => id !== skillId);
    if (pet.skills.length === 0) pet.skills = ['slash'];
    ph.savePets(pets);

    return ok([
        `# <:Trash:1521227750420254820> Skill Forgotten`,
        '',
        `${pet.emoji} **${pet.name}** has forgotten **${def.name}**.`,
        `-# You'll need to learn it again to use it in battle.`,
    ].join('\n'));
}

/* ─────────────── command export ─────────────── */

module.exports = {
    data: new SlashCommandBuilder()
        .setName('skill')
        .setDescription('Manage your active pet\'s combat skills')
        .addStringOption(o => o.setName('action').setDescription('list / info / learn / equip / unequip / forget').setRequired(false)
            .addChoices(
                { name: 'List skills',     value: 'list' },
                { name: 'Skill info',      value: 'info' },
                { name: 'Learn skill',     value: 'learn' },
                { name: 'Equip skill',     value: 'equip' },
                { name: 'Unequip skill',   value: 'unequip' },
                { name: 'Forget skill',    value: 'forget' },
            ))
        .addStringOption(o => o.setName('skill').setDescription('Skill ID (for info/learn/equip/unequip/forget)').setRequired(false)),
    prefix: 'skill',
    aliases: ['skills', 'sk'],
    description: 'Learn, equip, and manage your active pet\'s battle skills',
    usage: 'skill <list|info|learn|equip|unequip|forget> [skill_id]',
    category: 'economy',

    async executePrefix(message, args) {
        const guildId = message.guild?.id;
        const sub = (args[0] || 'list').toLowerCase();
        const skillId = args[1]?.toLowerCase();

        const ctx = reqActivePet(message);
        if (ctx.error) return message.reply(err(ctx.error));
        const { pets, pet } = ctx;

        switch (sub) {
            case 'list':     return message.reply(cmdList(message, pet, guildId));
            case 'info':     if (!skillId) return message.reply(err('Specify a skill — `skill info <id>`.')); return message.reply(cmdInfo(skillId));
            case 'learn':    if (!skillId) return message.reply(err('Specify a skill — `skill learn <id>`.')); return message.reply(cmdLearn(skillId, pet, ctx.userData, pets, message, guildId));
            case 'equip':    if (!skillId) return message.reply(err('Specify a skill — `skill equip <id>`.')); return message.reply(cmdEquip(skillId, pet, pets));
            case 'unequip':  if (!skillId) return message.reply(err('Specify a skill — `skill unequip <id>`.')); return message.reply(cmdUnequip(skillId, pet, pets));
            case 'forget':   if (!skillId) return message.reply(err('Specify a skill — `skill forget <id>`.')); return message.reply(cmdForget(skillId, pet, pets));
            default:         return message.reply(err('Unknown subcommand. Try `skill list`, `skill info`, `skill learn`, `skill equip`, `skill unequip`, or `skill forget`.'));
        }
    },

    async execute(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const fakeMessage = {
            author: interaction.user,
            guild: interaction.guild,
            reply: (opts) => interaction.editReply(opts),
        };
        const sub = interaction.options?.getString('action') || 'list';
        const skillId = interaction.options?.getString('skill');
        const fakeArgs = [sub, skillId].filter(Boolean);
        return module.exports.executePrefix(fakeMessage, fakeArgs);
    },
};
