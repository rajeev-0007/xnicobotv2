'use strict';

const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('discord.js');
const { createContainer, addTextDisplay } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');
const economyManager = require('../../utils/economyManager');
const { renderMysteryBox } = require('../../utils/animeCardCanvas');

async function handleMysteryBox(reply, user, tier = 'bronze') {
    const box = animeManager.MYSTERY_BOXES[tier.toLowerCase()];
    if (!box) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, [
            `## ${AE.cancel} Invalid Box Tier`,
            '',
            `> Available tiers: **bronze**, **silver**, **gold**`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, user.id);

    if (userData.coins < box.cost) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ${AE.cancel} Insufficient Funds\nA **${box.name}** costs **${box.cost.toLocaleString()}** coins. You only have **${userData.coins.toLocaleString()}**.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // Purchase box
    userData.coins -= box.cost;
    economyManager.saveEconomy(economy);

    const results = animeManager.openMysteryBox(tier.toLowerCase());
    
    // Add to collection
    for (const char of results) {
        animeManager.addToCollection(playerData, char);
    }
    
    // Check if any achievements were unlocked
    const newAchievements = animeManager.checkNewAchievements(playerData);
    if (newAchievements.length > 0) {
        for (const ach of newAchievements) {
            userData.coins += ach.reward;
        }
        economyManager.saveEconomy(economy);
    }

    animeManager.saveAnimeData();

    const buffer = await renderMysteryBox(results, box.name);
    const attachment = new AttachmentBuilder(buffer, { name: 'mysterybox.png' });

    const container = createContainer(0x9B59B6);
    addTextDisplay(container, [
        `## ${box.emoji} Unboxed: ${box.name}!`,
        '',
        `> You bought a **${box.name}** for **${box.cost.toLocaleString()}** coins.`,
        `> You received **${results.length}** characters!`,
    ].join('\n'));

    const mediaGallery = new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL('attachment://mysterybox.png')
    );
    container.addMediaGalleryComponents(mediaGallery);

    let components = [container];
    if (newAchievements.length > 0) {
        const achContainer = createContainer(0x57F287);
        const achLines = newAchievements.map(a => `${a.emoji} **${a.name}** (+${a.reward} coins)`);
        addTextDisplay(achContainer, `### ${AE.trophy} Achievements Unlocked!\n${achLines.join('\n')}`);
        components.push(achContainer);
    }

    return reply({ components, files: [attachment], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aopen')
        .setDescription('Open a mystery box for guaranteed drops')
        .addStringOption(o => o.setName('tier').setDescription('Box tier').addChoices(
            { name: 'Bronze (500 coins)', value: 'bronze' },
            { name: 'Silver (1500 coins)', value: 'silver' },
            { name: 'Gold (5000 coins)', value: 'gold' },
        ).setRequired(true)),
    prefix: 'aopen',
    description: 'Buy and open a mystery box. Tiers: bronze, silver, gold',
    usage: 'aopen <bronze|silver|gold>',
    aliases: ['mysterybox', 'abox'],
    category: 'anime',

    async executePrefix(message, args) {
        const tier = args[0] ? args[0].toLowerCase() : 'bronze';
        return handleMysteryBox(message.reply.bind(message), message.author, tier);
    },

    async execute(interaction) {
        const tier = interaction.options.getString('tier');
        await interaction.deferReply();
        return handleMysteryBox((payload) => interaction.editReply(payload), interaction.user, tier);
    },
};
