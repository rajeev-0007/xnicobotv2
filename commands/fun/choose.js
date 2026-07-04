const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

function buildChoice(options) {
    const chosen = options[Math.floor(Math.random() * options.length)];
    let content = `# <:Bookmark:1521227835526742066> I Choose...\n\n`;
    content += `## **${chosen}**\n\n`;
    content += `### Options\n`;
    content += options.map(opt => `> ${opt === chosen ? '<:Checkedbox:1521227734943269077>' : '\u2022'} ${opt}`).join('\n');
    return new ContainerBuilder()
        .setAccentColor(COLORS.SUCCESS)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('choose')
        .setDescription('Let the bot choose between multiple options')
        .addStringOption(opt =>
            opt.setName('options')
                .setDescription('Options separated by commas (e.g. pizza, burger, sushi)')
                .setRequired(true)),
    prefix: 'choose',
    description: 'Let the bot choose between multiple options',
    usage: 'choose <option1>, <option2>, [option3...]',
    category: 'fun',
    aliases: ['pick', 'decide'],

    async execute(interaction) {
        const optionsString = interaction.options.getString('options');
        const options = optionsString.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);
        if (options.length < 2) {
            const container = buildErrorResponse('Not Enough Options', 'Please provide at least 2 options separated by commas.');
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }
        const container = buildChoice(options);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        if (!args.length) {
            const container = buildErrorResponse(
                'No Options Provided',
                'Please provide options separated by commas.',
                '**Example:**\n> `choose pizza, burger, sushi`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const optionsString = args.join(' ');
        const options = optionsString.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);

        if (options.length < 2) {
            const container = buildErrorResponse(
                'Not Enough Options',
                'Please provide at least 2 options separated by commas.'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildChoice(options);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
