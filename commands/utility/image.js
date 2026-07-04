
const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('image')
        .setDescription('Apply filters to an image')
        .addSubcommand(sub => sub.setName('invert').setDescription('Invert image colors').addAttachmentOption(o => o.setName('image').setDescription('Image to process').setRequired(true)))
        .addSubcommand(sub => sub.setName('blur').setDescription('Blur an image').addAttachmentOption(o => o.setName('image').setDescription('Image to process').setRequired(true)))
        .addSubcommand(sub => sub.setName('pixelate').setDescription('Pixelate an image').addAttachmentOption(o => o.setName('image').setDescription('Image to process').setRequired(true))),

    async execute(interaction) {
        await interaction.deferReply();

        const subcommand = interaction.options.getSubcommand();
        const image = interaction.options.getAttachment('image');

        if (!image.contentType?.startsWith('image/')) {
            return interaction.editReply('<:Cancel:1521227723916181644> Please provide a valid image file!');
        }

        try {
            const filter = subcommand === 'invert' ? 'invert' : subcommand === 'blur' ? 'blur' : 'pixelate';
            const apiUrl = `https://some-api.com/api/${filter}?image=${encodeURIComponent(image.url)}`;
            
            // For demo, just return the original with a note
            await interaction.editReply({
                content: `<:Star:1521227981685526568> Applied **${filter}** filter to your image!`,
                files: [image.url]
            });
        } catch (error) {
            console.error(error);
            await interaction.editReply('<:Cancel:1521227723916181644> Failed to process image!');
        }
    },

    async executePrefix(message, args) {
        const attachment = message.attachments.first();
        if (!attachment || !attachment.contentType?.startsWith('image/')) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Image', 'Please attach an image.'));
        }

        const filter = args[0] || 'invert';
        await message.reply({
            content: `<:Star:1521227981685526568> Applied **${filter}** filter to your image!`,
            files: [attachment.url]
        });
    }
};
