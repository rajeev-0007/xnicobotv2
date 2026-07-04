const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');

function buildQRCodeContainer(text) {
    const encodedText = encodeURIComponent(text);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodedText}`;

    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `# 📱 QR Code Generated\n\n**Content:**\n\`\`\`${text.substring(0, 200)}${text.length > 200 ? '...' : ''}\`\`\``
            )
        )
        .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL(qrUrl)
            )
        );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('qrcode')
        .setDescription('Generate a QR code from text or URL')
        .addStringOption(o => o.setName('text').setDescription('Text or URL to encode').setRequired(true)),

    async execute(interaction) {
        const text = interaction.options.getString('text');
        const container = buildQRCodeContainer(text);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const text = args.join(' ');

        if (!text) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Input', 'Please provide text or a URL to encode.', { hint: 'Example: `' + (process.env.PREFIX || '-') + 'qrcode https://discord.com`' }));
        }

        const container = buildQRCodeContainer(text);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
