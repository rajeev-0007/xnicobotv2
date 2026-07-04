const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

function hexToRgb(hex) {
    const bigint = parseInt(hex, 16);
    return {
        r: (bigint >> 16) & 255,
        g: (bigint >> 8) & 255,
        b: bigint & 255
    };
}

function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;

    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }

    return {
        h: Math.round(h * 360),
        s: Math.round(s * 100),
        l: Math.round(l * 100)
    };
}

function buildColorContainer(hex) {
    const rgb = hexToRgb(hex);
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const colorUrl = `https://singlecolorimage.com/get/${hex}/400x200`;
    const colorInt = parseInt(hex, 16);

    let content = `# <:Palette:1521227950601539755> Color Information\n\n`;
    content += `### Values\n`;
    content += `> **Hex:** \`#${hex.toUpperCase()}\`\n`;
    content += `> **RGB:** \`rgb(${rgb.r}, ${rgb.g}, ${rgb.b})\`\n`;
    content += `> **HSL:** \`hsl(${hsl.h}°, ${hsl.s}%, ${hsl.l}%)\`\n\n`;
    content += `### Components\n`;
    content += `> 🔴 Red: **${rgb.r}** | 🟢 Green: **${rgb.g}** | 🔵 Blue: **${rgb.b}**`;

    return new ContainerBuilder()
        .setAccentColor(colorInt)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(colorUrl)
            )
        );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('color')
        .setDescription('Get information about a color')
        .addStringOption(o => o.setName('hex').setDescription('Hex color code (e.g. #ff0000)').setRequired(true)),
    prefix: 'color',
    description: 'Get information about a color',
    usage: 'color <hex>',
    category: 'utility',
    aliases: ['colour', 'hex'],

    async execute(interaction) {
        let hex = interaction.options.getString('hex').replace('#', '');

        if (!/^[0-9A-F]{6}$/i.test(hex)) {
            const container = buildErrorResponse(
                'Invalid Hex Color',
                'Please use format: `#FF5733` or `FF5733`'
            );
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildColorContainer(hex);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        let hex = args[0]?.replace('#', '');

        if (!hex || !/^[0-9A-F]{6}$/i.test(hex)) {
            const container = buildErrorResponse(
                'Invalid Hex Color',
                'Please use format: `#FF5733` or `FF5733`',
                '**Example:** `color #FF5733`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildColorContainer(hex);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
