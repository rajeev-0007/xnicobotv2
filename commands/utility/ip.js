
const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const { buildLoadingResponse } = require('../../utils/responseBuilder');

module.exports = {
    data: null,

    async executePrefix(message, args) {
        if (!args[0]) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing IP Address', 'Please provide an IP address.', { hint: 'Example: `-ip 8.8.8.8`' }));
        }

        const ip = args[0];
        const loadingMsg = await message.reply({
            components: [buildLoadingResponse('IP Lookup', 'Looking up IP information...', 'Querying geolocation and network details.')],
            flags: MessageFlags.IsComponentsV2
        });

        try {
            const response = await axios.get(`http://ip-api.com/json/${ip}`);
            const data = response.data;

            if (data.status === 'fail') {
                return loadingMsg.edit({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> IP Lookup Failed\n\nInvalid IP address or lookup failed.'))], flags: MessageFlags.IsComponentsV2 });
            }

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Bookopen:1521227911137595605> IP Information\n\n**IP:** ${data.query}\n**Country:** ${data.country} (${data.countryCode})\n**Region:** ${data.regionName}\n**City:** ${data.city}\n**ZIP:** ${data.zip || 'N/A'}\n**ISP:** ${data.isp}\n**Organization:** ${data.org}\n**Timezone:** ${data.timezone}\n**Coordinates:** ${data.lat}, ${data.lon}`)
                );

            await loadingMsg.edit({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('IP lookup error:', error);
            await loadingMsg.edit({ components: [new ContainerBuilder().setAccentColor(0xED4245).addTextDisplayComponents(new TextDisplayBuilder().setContent('# <:Cancel:1521227723916181644> IP Lookup Failed\n\nFailed to lookup IP information.'))], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
