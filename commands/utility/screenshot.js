
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: null,

    async executePrefix(message, args) {
        if (!args[0]) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing URL', 'Please provide a URL.', { hint: 'Example: `-screenshot https://google.com`' }));
        }

        let url = args[0];
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        const loadingMsg = await message.reply('<:Image:1521227966435037255> Taking screenshot...');

        try {
            const screenshotUrl = `https://image.thum.io/get/width/1920/crop/768/maxAge/1/noanimate/${url}`;
            
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Image:1521227966435037255> Website Screenshot\n\n**URL:** ${url}\n\n![Screenshot](${screenshotUrl})`)
                );

            await loadingMsg.edit({ content: null, components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('Screenshot error:', error);
            await loadingMsg.edit('<:Cancel:1521227723916181644> Failed to take screenshot! Make sure the URL is valid.');
        }
    }
};
