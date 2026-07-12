'use strict';

const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const economyManager = require('../../utils/economyManager');
const { renderUpgrade } = require('../../utils/animeCardCanvas');

async function handleUpgrade(reply, user, characterName) {
    if (!characterName) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, [
            `## ❌ Usage`,
            '',
            `> \`aupgrade <character>\` — Upgrade a character to the next rarity`,
            '',
            `-# Requires sacrificing ${animeManager.UPGRADE_SACRIFICE} other cards of the same rarity`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, user.id);

    const char = animeManager.findCharacter(characterName);
    if (!char) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Not Found\nCharacter "${characterName}" not found.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (!animeManager.hasCharacter(playerData, char.id)) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Not Owned\nYou don't own **${char.name}**.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const upgradeCheck = animeManager.canUpgrade(playerData, char.id);
    if (!upgradeCheck.ok) {
        const container = createContainer(0xFEE75C);
        addTextDisplay(container, `## ⚠️ Cannot Upgrade\n${upgradeCheck.reason}`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (userData.coins < upgradeCheck.cost) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Insufficient Funds\nUpgrading costs **${upgradeCheck.cost.toLocaleString()}** coins. You only have **${userData.coins.toLocaleString()}**.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // Perform upgrade
    userData.coins -= upgradeCheck.cost;
    economyManager.saveEconomy(economy);

    const upgradedChar = animeManager.performUpgrade(playerData, char.id);
    
    // We update the entry in the collection
    const entry = playerData.collection.find(c => c.charId === char.id);
    entry.customRarity = upgradedChar.rarity;
    
    // Check if any achievements were unlocked
    const newAchievements = animeManager.checkNewAchievements(playerData);
    if (newAchievements.length > 0) {
        for (const ach of newAchievements) {
            userData.coins += ach.reward;
        }
        economyManager.saveEconomy(economy);
    }

    animeManager.saveAnimeData();

    const buffer = await renderUpgrade(upgradedChar);
    const attachment = new AttachmentBuilder(buffer, { name: 'upgrade.png' });

    const container = createContainer(0xF1C40F);
    addTextDisplay(container, [
        `## ✨ Ascension Complete! ✨`,
        '',
        `> You sacrificed **${animeManager.UPGRADE_SACRIFICE}** cards to ascend **${char.name}**.`,
        `> Their rarity is now **${animeManager.RARITIES[upgradedChar.rarity].name}**!`,
        `> 💰 Cost: **${upgradeCheck.cost.toLocaleString()}** coins`,
    ].join('\n'));

    const mediaGallery = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://upgrade.png')
    );
    container.addMediaGalleryComponents(mediaGallery);

    let components = [container];
    if (newAchievements.length > 0) {
        const achContainer = createContainer(0x57F287);
        const achLines = newAchievements.map(a => `${a.emoji} **${a.name}** (+${a.reward} coins)`);
        addTextDisplay(achContainer, `### 🏆 Achievements Unlocked!\n${achLines.join('\n')}`);
        components.push(achContainer);
    }

    return reply({ components, files: [attachment], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aupgrade')
        .setDescription('Upgrade a character by sacrificing duplicates of the same rarity')
        .addStringOption(o => o.setName('character').setDescription('The character to upgrade').setRequired(true)),
    prefix: 'aupgrade',
    description: 'Upgrade a character card by sacrificing 3 other cards of the same rarity',
    usage: 'aupgrade <character>',
    aliases: ['ascend', 'aascend'],
    category: 'anime',

    async executePrefix(message, args) {
        if (args.length === 0) {
            return handleUpgrade(message.reply.bind(message), message.author, null);
        }
        const characterName = args.join(' ');
        return handleUpgrade(message.reply.bind(message), message.author, characterName);
    },

    async execute(interaction) {
        const characterName = interaction.options.getString('character');
        await interaction.deferReply();
        return handleUpgrade((payload) => interaction.editReply(payload), interaction.user, characterName);
    },
};
