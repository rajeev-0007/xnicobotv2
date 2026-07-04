const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');

module.exports = {
    data: null,

    async executePrefix(message, args) {
        if (!args.length) {
            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Box:1521228152414666833> NPM Package Search\n\n**Usage:** \`npm <package_name>\`\n\n**Description:**\nSearch for NPM packages and view their information!\n\n**Example:** \`npm discord.js\``)
                );
            return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }

        const packageName = args.join(' ');

        try {
            const response = await axios.get(`https://registry.npmjs.org/${packageName}`);
            const pkg = response.data;
            const latest = pkg['dist-tags'].latest;
            const latestVersion = pkg.versions[latest];

            const container = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder()
                        .setContent(`# <:Box:1521228152414666833> NPM Package: ${pkg.name}\n\n**Description:** ${pkg.description || 'No description'}\n**Latest Version:** ${latest}\n**Author:** ${pkg.author?.name || 'Unknown'}\n**License:** ${pkg.license || 'N/A'}\n**Keywords:** ${pkg.keywords?.join(', ') || 'None'}\n\n**Dependencies:** ${Object.keys(latestVersion.dependencies || {}).length}\n**Homepage:** ${pkg.homepage || 'N/A'}\n**Repository:** ${pkg.repository?.url || 'N/A'}\n\n**Install:** \`npm install ${pkg.name}\`\n\n**NPM:** https://npmjs.com/package/${pkg.name}`)
                );

            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            message.reply(require('../../utils/utilityUI').errReply('Package Not Found', 'Make sure the package name is correct.'));
        }
    }
};
