const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: null,

    async executePrefix(message, args) {
        if (!args.length) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Bookopen:1521227911137595605> Wikipedia Search\n\n**Usage:** \`wikipedia <query>\`\n\n**Description:**\nSearch for information on Wikipedia!\n\n**Example:** \`wikipedia Discord\``)
                );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const query = args.join(' ');

        try {
            const response = await axios.get('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(query));
            const data = response.data;

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Bookopen:1521227911137595605> Wikipedia: ${data.title}\n\n${data.extract}\n\n**Read more:** ${data.content_urls.desktop.page}\n\n${data.thumbnail ? `**Image:**\n${data.thumbnail.source}` : ''}`)
                );

            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            message.reply(require('../../utils/utilityUI').errReply('Not Found', 'No Wikipedia article found for that query.'));
        }
    }
};
