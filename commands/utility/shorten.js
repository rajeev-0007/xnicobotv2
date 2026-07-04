
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: null,
    aliases: ['bitly'],

    async executePrefix(message, args) {
        if (!args[0]) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing URL', 'Please provide a URL to shorten.', { hint: 'Example: `-shorten https://example.com`' }));
        }

        let url = args[0];
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        const loadingMsg = await message.reply('<:Attach:1521228039135170722> Shortening URL...');

        try {
            const response = await axios.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
            const shortUrl = response.data;

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Attach:1521228039135170722> URL Shortened\n\n**Original URL:**\n${url}\n\n**Shortened URL:**\n${shortUrl}`)
                );

            await loadingMsg.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('URL shortener error:', error);
            await loadingMsg.edit('<:Cancel:1521227723916181644> Failed to shorten URL! Make sure the URL is valid.');
        }
    }
};
