const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');
const axios = require('axios');

async function getDefinition(word) {
    try {
        const response = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        return response.data[0];
    } catch {
        return null;
    }
}

function buildDefinitionContainer(data) {
    const meaning = data.meanings[0];
    const definition = meaning.definitions[0];
    
    let content = `# 📖 ${data.word}\n\n`;
    content += `**Part of Speech:** ${meaning.partOfSpeech}\n`;
    content += `**Phonetic:** ${data.phonetic || 'N/A'}\n\n`;
    content += `### Definition\n`;
    content += `> ${definition.definition}`;
    
    if (definition.example) {
        content += `\n\n### Example\n`;
        content += `> *"${definition.example}"*`;
    }

    if (meaning.synonyms?.length > 0) {
        content += `\n\n### Synonyms\n`;
        content += `> ${meaning.synonyms.slice(0, 5).join(', ')}`;
    }

    return new ContainerBuilder()
        .setAccentColor(COLORS.INFO)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('define')
        .setDescription('Get the definition of a word')
        .addStringOption(o => o.setName('word').setDescription('Word to define').setRequired(true)),
    prefix: 'define',
    description: 'Get the definition of a word',
    usage: 'define <word>',
    category: 'utility',
    aliases: ['dictionary', 'meaning'],

    async execute(interaction) {
        const word = interaction.options.getString('word');
        const data = await getDefinition(word);

        if (!data) {
            const container = buildErrorResponse('Word Not Found', `Could not find the definition for "${word}".`);
            return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildDefinitionContainer(data);
        await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const word = args[0];
        if (!word) {
            const container = buildErrorResponse(
                'No Word Provided',
                'Please provide a word to define.',
                '**Example:** `define serendipity`'
            );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const data = await getDefinition(word);

        if (!data) {
            const container = buildErrorResponse('Word Not Found', `Could not find the definition for "${word}".`);
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const container = buildDefinitionContainer(data);
        await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
