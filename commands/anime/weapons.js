'use strict';

/**
 * aweapons — anime weapon shop. Browse weapons, see stats, and buy with coins.
 * Owned weapons are equipped to characters via /aequip.
 */

const {
    SlashCommandBuilder, MessageFlags, ActionRowBuilder,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');
const combat = require('../../utils/animeCombat');
const { getRarityEmoji } = require('../../utils/rarityBadges');
const economyManager = require('../../utils/economyManager');

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];

function buildShop(playerData, userData) {
    const container = createContainer(0x9B59B6);

    const weapons = combat.listWeapons().sort(
        (a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)
    );

    const lines = weapons.map(w => {
        const owned = combat.ownsWeapon(playerData, w.id);
        const tag = owned ? ` ${AE.check} owned` : ` • ${AE.money} ${w.price.toLocaleString()}`;
        return `${w.emoji} ${getRarityEmoji(w.rarity)} **${w.name}**${tag}\n-# └ ATK +${w.atk} · HP +${w.hp} · SPD +${w.spd}`;
    });

    addTextDisplay(container, [
        `## ${AE.shield || AE.box} Anime Weapon Shop`,
        `> ${AE.money} Balance: **${(userData.coins || 0).toLocaleString()}** coins`,
        `> Buy a weapon, then equip it with \`aequip\`.`,
        '',
        lines.join('\n'),
    ].join('\n'));

    // Buy menu — only weapons the player doesn't own yet
    const buyable = weapons.filter(w => !combat.ownsWeapon(playerData, w.id));
    if (buyable.length > 0) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId('awpn_buy')
            .setPlaceholder('Buy a weapon…')
            .addOptions(buyable.slice(0, 25).map(w =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(`${w.name} — ${w.price.toLocaleString()} coins`)
                    .setValue(w.id)
                    .setDescription(`ATK +${w.atk} · HP +${w.hp} · SPD +${w.spd}`)
            ));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
    } else {
        addTextDisplay(container, `\n-# ${AE.check} You own every weapon!`);
    }

    return container;
}

async function handle(sendReply, user, viewerId) {
    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);
    combat.ensureCombatState(playerData);
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, user.id);

    const message = await sendReply({ components: [buildShop(playerData, userData)], flags: MessageFlags.IsComponentsV2 });
    if (!message || typeof message.createMessageComponentCollector !== 'function') return message;

    const collector = message.createMessageComponentCollector({
        filter: (i) => i.user.id === viewerId && i.customId === 'awpn_buy',
        time: 120_000,
    });

    collector.on('collect', async (i) => {
        const weaponId = i.values?.[0];
        const w = combat.getWeapon(weaponId);
        // Reload fresh state each interaction.
        const aData = animeManager.loadAnimeData();
        const pd = animeManager.getPlayerData(aData, user.id);
        const eco = economyManager.loadEconomy();
        const { userData: ud } = economyManager.getUser(eco, user.id);

        if (!w) return i.deferUpdate().catch(() => {});
        if (combat.ownsWeapon(pd, weaponId)) {
            return i.reply({ content: `${AE.cancel} You already own the **${w.name}**.`, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        if ((ud.coins || 0) < w.price) {
            return i.reply({ content: `${AE.cancel} You need **${w.price.toLocaleString()}** coins for the **${w.name}** (you have ${(ud.coins || 0).toLocaleString()}).`, flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        ud.coins -= w.price;
        combat.addWeapon(pd, weaponId);
        economyManager.saveEconomy(eco);
        animeManager.saveAnimeData();

        await i.update({ components: [buildShop(pd, ud)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
        await i.followUp({ content: `${AE.check} Bought **${w.emoji} ${w.name}**! Equip it with \`aequip\`.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    });

    return message;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aweapons')
        .setDescription('Browse and buy anime weapons to equip on your characters'),
    prefix: 'aweapons',
    description: 'Browse and buy anime weapons to equip on your characters',
    usage: 'aweapons',
    aliases: ['aweapon', 'ashop', 'awpn'],
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
