'use strict';

const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { createContainer, addTextDisplay, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');
const { renderShowcase } = require('../../utils/animeCardCanvas');

async function handleShowcase(reply, user, characterName) {
    if (!characterName) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, [
            `## ${AE.cancel} Usage`,
            '',
            `> \`ashowcase <character>\` — Show off a character you own in premium format!`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const animeData = animeManager.loadAnimeData();
    const playerData = animeManager.getPlayerData(animeData, user.id);

    const char = animeManager.findCharacter(characterName);
    if (!char) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ${AE.cancel} Not Found\nCharacter "${characterName}" not found.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    if (!animeManager.hasCharacter(playerData, char.id)) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ${AE.cancel} Not Owned\nYou can only showcase characters you own!`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const count = animeManager.getCharacterCount(playerData, char.id);
    
    // Check how many people globally own this card
    let globalOwners = 0;
    for (const data of Object.values(animeData)) {
        if (data.collection && data.collection.some(c => c.charId === char.id)) {
            globalOwners++;
        }
    }

    const entry = playerData.collection.find(c => c.charId === char.id);
    // Use customRarity if it was upgraded, otherwise base rarity
    const activeRarity = entry.customRarity || char.rarity;
    
    const displayChar = { ...char, rarity: activeRarity };

    const buffer = await renderShowcase(displayChar);
    const attachment = new AttachmentBuilder(buffer, { name: 'showcase.png' });

    const obtainedTime = entry.obtainedAt ? `<t:${Math.floor(entry.obtainedAt / 1000)}:R>` : 'Unknown';

    const container = createContainer(0xF1C40F);
    addTextDisplay(container, [
        `## ${AE.sparkle} Character Showcase`,
        '',
        `> ${AE.user} **Showcased by:** <@${user.id}>`,
        `> ${AE.cards} **Character:** ${char.name} (${animeManager.RARITIES[activeRarity].name})`,
        `> ${AE.book} **Anime:** ${char.anime}`,
        '',
        `**Collection Stats:**`,
        `> ${AE.sandwatch} **Obtained:** ${obtainedTime}`,
        `> ${AE.collection} **Copies Owned:** ${count}`,
        `> ${AE.server} **Global Owners:** ${globalOwners}`,
    ].join('\n'));

    const mediaGallery = new MediaGalleryBuilder();
    mediaGallery.addItem(new MediaGalleryItemBuilder().setMedia('attachment://showcase.png'));
    container.addMediaGalleryComponents(mediaGallery);

    return reply({ components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ashowcase')
        .setDescription('Showcase a premium full-size render of a character you own')
        .addStringOption(o => o.setName('character').setDescription('The character to showcase').setRequired(true)),
    prefix: 'ashowcase',
    description: 'Showcase a premium full-size render of a character you own.',
    usage: 'ashowcase <character>',
    aliases: ['showcase', 'ashow'],
    category: 'anime',

    async executePrefix(message, args) {
        const characterName = args.join(' ');
        return handleShowcase(message.reply.bind(message), message.author, characterName);
    },

    async execute(interaction) {
        const characterName = interaction.options.getString('character');
        return handleShowcase(interaction.reply.bind(interaction), interaction.user, characterName);
    },
};
