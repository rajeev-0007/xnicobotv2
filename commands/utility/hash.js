const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MessageFlags } = require('discord.js');
const crypto = require('crypto');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('hash')
        .setDescription('Generate a hash from text')
        .addStringOption(o => o.setName('text').setDescription('Text to hash').setRequired(true))
        .addStringOption(o => o.setName('algorithm').setDescription('Hash algorithm').addChoices(
            { name: 'MD5', value: 'md5' },
            { name: 'SHA-1', value: 'sha1' },
            { name: 'SHA-256', value: 'sha256' },
            { name: 'SHA-512', value: 'sha512' }
        )),

    prefix: 'hash',
    description: 'Generate a hash from text using various algorithms',
    usage: 'hash <text> [algorithm]',
    category: 'utility',
    aliases: ['encrypt'],

    async execute(interaction) {
        const text = interaction.options.getString('text');
        const algorithm = interaction.options.getString('algorithm') || 'sha256';
        await generateHash(interaction, text, algorithm, true);
    },

    async executePrefix(message, args) {
        if (args.length === 0) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Missing Text\n\nPlease provide text to hash!\n\n**Usage:** \`-hash <text> [algorithm]\`\n**Algorithms:** md5, sha1, sha256, sha512\n**Example:** \`-hash mypassword sha256\``
                    )
                );
            return message.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
        
        let algorithm = 'sha256';
        let text = args.join(' ');
        
        const lastArg = args[args.length - 1].toLowerCase();
        if (['md5', 'sha1', 'sha256', 'sha512'].includes(lastArg)) {
            algorithm = lastArg;
            text = args.slice(0, -1).join(' ');
        }
        
        if (!text) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Missing Text\n\nPlease provide text to hash!`
                    )
                );
            return message.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
        
        await generateHash(message, text, algorithm, false);
    }
};

async function generateHash(context, text, algorithm, isInteraction) {
    try {
        const hash = crypto.createHash(algorithm).update(text).digest('hex');
        
        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `# <:Key:1521228000467878111> Hash Generated\n\n` +
                    `**Algorithm:** ${algorithm.toUpperCase()}\n` +
                    `**Input:** ${text.length > 100 ? text.substring(0, 100) + '...' : text}\n\n` +
                    `**Hash:**\n\`\`\`${hash}\`\`\``
                )
            );
        
        if (isInteraction) {
            await context.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } else {
            await context.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    } catch (error) {
        const errorContainer = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> Error\n\nError generating hash: ${error.message}`)
            );
        if (isInteraction) {
            await context.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        } else {
            await context.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
    }
}
