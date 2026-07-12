'use strict';

const { SlashCommandBuilder, MessageFlags, AttachmentBuilder } = require('discord.js');
const { createContainer, addTextDisplay, MediaGalleryBuilder, MediaGalleryItemBuilder } = require('../../utils/componentHelpers');
const animeManager = require('../../utils/animeManager');
const { EMOJIS: AE } = require('../../utils/animeEmojis');
const { renderCompare } = require('../../utils/animeCardCanvas');

async function handleCompare(reply, character1Name, character2Name) {
    if (!character1Name || !character2Name) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, [
            `## ${AE.cancel} Usage`,
            '',
            `> \`acompare <char1> <char2>\` — Compare two characters side-by-side`,
            '',
            `-# Characters must be separated by a comma if using the prefix command.`,
        ].join('\n'));
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const char1 = animeManager.findCharacter(character1Name);
    const char2 = animeManager.findCharacter(character2Name);

    if (!char1) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ${AE.cancel} Not Found\nCharacter "${character1Name}" not found.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
    if (!char2) {
        const container = createContainer(0xED4245);
        addTextDisplay(container, `## ${AE.cancel} Not Found\nCharacter "${character2Name}" not found.`);
        return reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }

    const buffer = await renderCompare(char1, char2);
    const attachment = new AttachmentBuilder(buffer, { name: 'compare.png' });

    const val1 = animeManager.getSellValue(char1.id) * 2;
    const val2 = animeManager.getSellValue(char2.id) * 2;

    const container = createContainer(0x3498DB);
    addTextDisplay(container, [
        `## ${AE.stats} Character Comparison`,
        '',
        `**${char1.name}** (${animeManager.RARITIES[char1.rarity].name})`,
        `> ${AE.money} Value: **${val1.toLocaleString()}** coins`,
        `> ${AE.book} Anime: *${char1.anime}*`,
        '',
        `**${char2.name}** (${animeManager.RARITIES[char2.rarity].name})`,
        `> ${AE.money} Value: **${val2.toLocaleString()}** coins`,
        `> ${AE.book} Anime: *${char2.anime}*`,
    ].join('\n'));

    const mediaGallery = new MediaGalleryBuilder();
    mediaGallery.addItem(new MediaGalleryItemBuilder().setMedia('attachment://compare.png'));
    container.addMediaGalleryComponents(mediaGallery);

    return reply({ components: [container], files: [attachment], flags: MessageFlags.IsComponentsV2 });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('acompare')
        .setDescription('Compare two characters side-by-side')
        .addStringOption(o => o.setName('character1').setDescription('First character').setRequired(true))
        .addStringOption(o => o.setName('character2').setDescription('Second character').setRequired(true)),
    prefix: 'acompare',
    description: 'Compare two characters visually and see their stats',
    usage: 'acompare <character1>, <character2>',
    aliases: ['avs'],
    category: 'anime',

    async executePrefix(message, args) {
        const input = args.join(' ').split(',');
        if (input.length < 2) {
            return handleCompare(message.reply.bind(message), null, null);
        }
        return handleCompare(message.reply.bind(message), input[0].trim(), input[1].trim());
    },

    async execute(interaction) {
        const char1 = interaction.options.getString('character1');
        const char2 = interaction.options.getString('character2');
        return handleCompare(interaction.reply.bind(interaction), char1, char2);
    },
};
