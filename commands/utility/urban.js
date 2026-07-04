
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: null,

    async executePrefix(message, args) {
        if (!args[0]) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Term', 'Please provide a term to search.', { hint: 'Example: `-urban discord`' }));
        }

        const term = args.join(' ');
        const loadingMsg = await message.reply('<:Search:1521228231263387738> Searching Urban Dictionary...');

        try {
            const response = await axios.get(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(term)}`);
            
            if (!response.data.list || response.data.list.length === 0) {
                return loadingMsg.edit('<:Cancel:1521227723916181644> No results found!');
            }

            const result = response.data.list[0];
            const definition = result.definition.substring(0, 500);
            const example = result.example ? result.example.substring(0, 300) : 'No example available';
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Bookopen:1521227911137595605> Urban Dictionary\n\n**Term:** ${result.word}\n\n**Definition:**\n${definition}${result.definition.length > 500 ? '...' : ''}\n\n**Example:**\n${example}${result.example && result.example.length > 300 ? '...' : ''}\n\n👍 ${result.thumbs_up} | 👎 ${result.thumbs_down}\n\n**Author:** ${result.author}`)
                );

            await loadingMsg.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Urban Dictionary error:', error);
            await loadingMsg.edit('<:Cancel:1521227723916181644> Failed to search Urban Dictionary!');
        }
    }
};
