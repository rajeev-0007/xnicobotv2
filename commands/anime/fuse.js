'use strict';

const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { createContainer, addTextDisplay, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const economyManager = require('../../utils/economyManager');
const { renderFusion } = require('../../utils/animeCardCanvas');

async function handleFuse(reply, user, character1Name, character2Name) {
    if (!character1Name || !character2Name) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, [
            `## ❌ Usage`,
            '',
            `> \`afuse <char1> <char2>\` — Fuse two characters to get a random one`,
            '',
            `-# Characters must be separated by a comma if using the prefix command.`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);
    const economy = economyManager.loadEconomy();
    const { userData } = economyManager.getUser(economy, user.id);

    const char1 = animeManager.findCharacter(character1Name);
    const char2 = animeManager.findCharacter(character2Name);

    if (!char1) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Not Found\nCharacter "${character1Name}" not found.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    if (!char2) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Not Found\nCharacter "${character2Name}" not found.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (!animeManager.hasCharacter(playerData, char1.id)) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Not Owned\nYou don't own **${char1.name}**.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    if (!animeManager.hasCharacter(playerData, char2.id)) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Not Owned\nYou don't own **${char2.name}**.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // if char1 and char2 are the same, they must have at least 2 copies
    if (char1.id === char2.id && animeManager.getCharacterCount(playerData, char1.id) < 2) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Not Enough Copies\nYou need 2 copies of **${char1.name}** to fuse them together.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const fusionCost = animeManager.getFusionCost(char1.id, char2.id);

    if (userData.coins < fusionCost) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Insufficient Funds\nFusion costs **${fusionCost.toLocaleString()}** coins. You only have **${userData.coins.toLocaleString()}**.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    // Perform fusion
    userData.coins -= fusionCost;
    economyManager.saveEconomy(economy);

    const fusionResult = animeManager.fuseCards(playerData, char1.id, char2.id);
    if (!fusionResult) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ❌ Fusion Failed\nAn error occurred during fusion.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
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

    const buffer = await renderFusion(fusionResult.result, fusionResult.upgraded);
    const attachment = new AttachmentBuilder(buffer, { name: 'fusion.png' });

    let status = 'Equal Exchange';
    let color = 0x3498DB;
    if (fusionResult.upgraded) { status = 'UPGRADED!'; color = 0x57F287; }
    else if (fusionResult.downgraded) { status = 'DOWNGRADED...'; color = 0xED4245; }

    const container = createContainer(color);
    addTextDisplay(container, [
        `## 🔮 Fusion Complete: ${status}`,
        '',
        `> You fused **${char1.name}** and **${char2.name}**!`,
        `> Result: **${fusionResult.result.name}** (${animeManager.RARITIES[fusionResult.result.rarity].name})`,
        `> 💰 Cost: **${fusionCost.toLocaleString()}** coins`,
    ].join('\n'));

    const mediaGallery = new MediaGalleryBuilder();
    mediaGallery.addItem(new MediaGalleryItemBuilder().setMedia('attachment://fusion.png'));
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
        .setName('afuse')
        .setDescription('Fuse two characters together to get a random character')
        .addStringOption(o => o.setName('character1').setDescription('First character to fuse').setRequired(true))
        .addStringOption(o => o.setName('character2').setDescription('Second character to fuse').setRequired(true)),
    prefix: 'afuse',
    description: 'Fuse two character cards together. Has a chance to upgrade or downgrade the rarity!',
    usage: 'afuse <character1>, <character2>',
    aliases: ['fusion'],
    category: 'anime',

    async executePrefix(message, args) {
        const input = args.join(' ').split(',');
        if (input.length < 2) {
            return handleFuse(message.reply.bind(message), message.author, null, null);
        }
        return handleFuse(message.reply.bind(message), message.author, input[0].trim(), input[1].trim());
    },

    async execute(interaction) {
        const char1 = interaction.options.getString('character1');
        const char2 = interaction.options.getString('character2');
        return handleFuse(interaction.reply.bind(interaction), interaction.user, char1, char2);
    },
};
