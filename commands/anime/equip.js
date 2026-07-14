'use strict';

/**
 * aequip — inspect a character's combat stats + signature ability and equip
 * an owned weapon to it. Character picker + weapon picker (select menus) and
 * an Unequip button. Loadouts persist per character.
 */

const {
    SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder, SeparatorBuilder, SeparatorSpacingSize,
} = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');
const combat = require('../../utils/animeCombat');
const { getRarityEmoji } = require('../../utils/rarityBadges');

const RARITY_ORDER = ['mythic', 'legendary', 'epic', 'rare', 'uncommon', 'common'];

/** Unique owned characters, resolved + sorted strongest first (max 25). */
function ownedCharacters(playerData) {
    const seen = new Set();
    const chars = [];
    for (const entry of playerData.collection) {
        if (seen.has(entry.charId)) continue;
        seen.add(entry.charId);
        const char = animeManager.CHARACTERS.find(c => c.id === entry.charId);
        if (char) chars.push(char);
    }
    chars.sort((a, b) => {
        const ra = RARITY_ORDER.indexOf(a.rarity), rb = RARITY_ORDER.indexOf(b.rarity);
        if (ra !== rb) return ra - rb;
        return combat.battlePower(b, null) - combat.battlePower(a, null);
    });
    return chars.slice(0, 25);
}

function buildPanel(playerData, selectedCharId) {
    combat.ensureCombatState(playerData);
    const chars = ownedCharacters(playerData);
    const char = chars.find(c => c.id === selectedCharId) || chars[0];

    const container = createContainer(char ? animeManager.RARITIES[char.rarity].color : 0x9B59B6);

    if (!char) {
        addTextDisplay(container, [
            `## ${AE.shield || AE.box} Character Loadout`,
            '',
            `> You don't own any characters yet.`,
            `-# Use \`aroll\` to collect characters first.`,
        ].join('\n'));
        return { container, char: null };
    }

    const weapon = combat.getEquippedWeapon(playerData, char.id);
    const base = combat.getStats(char);
    const eff = combat.effectiveStats(char, weapon);
    const ability = combat.getAbility(char);
    const rarity = animeManager.RARITIES[char.rarity];

    const statLine = (label, b, e) => {
        const diff = e - b;
        return `${label} **${e}**${diff > 0 ? ` (+${diff})` : ''}`;
    };

    addTextDisplay(container, [
        `## ${rarity.emoji} ${char.name}`,
        `-# ${char.anime} · ${rarity.name} · Power **${combat.battlePower(char, weapon)}**`,
        '',
        `${ability.emoji} **${ability.name}** — ${ability.desc}`,
        '',
        `> ⚔️ ${statLine('ATK', base.atk, eff.atk)}`,
        `> ❤️ ${statLine('HP', base.hp, eff.hp)}`,
        `> 💨 ${statLine('SPD', base.spd, eff.spd)}`,
        '',
        weapon
            ? `> 🛠️ Equipped: ${weapon.emoji} **${weapon.name}** (${getRarityEmoji(weapon.rarity)} ${weapon.rarity})`
            : `> 🛠️ Equipped: *none* — pick a weapon below`,
    ].join('\n'));

    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));

    // Character picker
    const charMenu = new StringSelectMenuBuilder()
        .setCustomId('aeq_char')
        .setPlaceholder('Select a character')
        .addOptions(chars.map(c =>
            new StringSelectMenuOptionBuilder()
                .setLabel(`${c.name}`.slice(0, 100))
                .setValue(c.id)
                .setDescription(`${animeManager.RARITIES[c.rarity].name} · Power ${combat.battlePower(c, combat.getEquippedWeapon(playerData, c.id))}`.slice(0, 100))
                .setDefault(c.id === char.id)
        ));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(charMenu));

    // Weapon picker (owned weapons)
    const owned = playerData.weapons.map(id => combat.getWeapon(id)).filter(Boolean);
    if (owned.length > 0) {
        const wMenu = new StringSelectMenuBuilder()
            .setCustomId('aeq_weapon')
            .setPlaceholder('Equip a weapon')
            .addOptions(owned.slice(0, 25).map(w =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(`${w.name}`.slice(0, 100))
                    .setValue(w.id)
                    .setDescription(`ATK +${w.atk} · HP +${w.hp} · SPD +${w.spd}`)
                    .setDefault(weapon && weapon.id === w.id)
            ));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(wMenu));
    } else {
        addTextDisplay(container, `\n-# You own no weapons yet — buy some with \`aweapons\`.`);
    }

    // Unequip button
    container.addActionRowComponents(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('aeq_unequip').setLabel('Unequip').setStyle(ButtonStyle.Danger).setDisabled(!weapon),
        new ButtonBuilder().setCustomId('aeq_shop').setLabel('Weapon Shop').setStyle(ButtonStyle.Secondary),
    ));

    return { container, char };
}

async function handle(sendReply, user, viewerId) {
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);
    combat.ensureCombatState(playerData);

    let state = buildPanel(playerData, null);
    const message = await sendReply({ components: [state.container], flags: MessageFlags.IsComponentsV2 });
    if (!message || typeof message.createMessageComponentCollector !== 'function') return message;

    let selectedId = state.char?.id || null;

    const collector = message.createMessageComponentCollector({
        filter: (i) => i.user.id === viewerId && i.customId.startsWith('aeq_'),
        time: 180_000,
    });

    collector.on('collect', async (i) => {
        const aData = animeManager.loadAnimeData();
        const pd = animeManager.getPlayerData(aData, user.id);
        combat.ensureCombatState(pd);

        if (i.customId === 'aeq_char') {
            selectedId = i.values?.[0] || selectedId;
        } else if (i.customId === 'aeq_weapon') {
            const weaponId = i.values?.[0];
            if (selectedId && combat.ownsWeapon(pd, weaponId)) {
                combat.equipWeapon(pd, selectedId, weaponId);
                animeManager.saveAnimeData();
            }
        } else if (i.customId === 'aeq_unequip') {
            if (selectedId) { combat.unequipWeapon(pd, selectedId); animeManager.saveAnimeData(); }
        } else if (i.customId === 'aeq_shop') {
            return i.reply({ content: `${AE.money} Browse & buy weapons with \`aweapons\`.`, flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        state = buildPanel(pd, selectedId);
        selectedId = state.char?.id || selectedId;
        await i.update({ components: [state.container], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });

    return message;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aequip')
        .setDescription('View a character\'s stats/ability and equip a weapon'),
    prefix: 'aequip',
    description: 'View a character\'s stats & ability and equip an owned weapon',
    usage: 'aequip',
    aliases: ['aloadout', 'aequipment'],
    category: 'anime',

    async executePrefix(message) {
        return handle(message.reply.bind(message), message.author, message.author.id);
    },

    async execute(interaction) {
        await interaction.deferReply();
        return handle(
            async (payload) => { await interaction.editReply(payload); return interaction.fetchReply(); },
            interaction.user, interaction.user.id
        );
    },
};
