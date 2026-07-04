const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('abbreviate')
        .setDescription('Create an abbreviation from text')
        .addStringOption(o => o.setName('text').setDescription('Text to abbreviate').setRequired(true)),
    prefix: 'abbreviate',
    description: 'Create an abbreviation from text',
    usage: 'abbreviate <text>',
    category: 'utility',
    aliases: ['abbr', 'acronym'],

    async execute(interaction) {
        const text = interaction.options.getString('text');
        const words = text.split(' ').filter(w => w.length > 0);
        const abbreviation = words.map(word => word[0].toUpperCase()).join('');

        let content = `# 🔤 Abbreviation\n\n`;
        content += `**Original:** ${text}\n\n`;
        content += `**Abbreviation:** \`${abbreviation}\``;

        const container = new ContainerBuilder()
            .setAccentColor(COLORS.INFO)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        if (args.length === 0) {
            const container = buildErrorResponse(
                'No Text Provided',
                'Please provide text to abbreviate.',
                '**Example:** `abbreviate Application Programming Interface`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const text = args.join(' ');
        const words = text.split(' ').filter(w => w.length > 0);
        const abbreviation = words.map(word => word[0].toUpperCase()).join('');

        let content = `# 🔤 Abbreviation\n\n`;
        content += `**Original:** ${text}\n\n`;
        content += `**Abbreviation:** \`${abbreviation}\``;

        const container = new ContainerBuilder()
            .setAccentColor(COLORS.INFO)
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

        message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
