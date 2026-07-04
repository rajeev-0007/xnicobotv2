const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags } = require('discord.js');

async function searchGif(query) {
    const apiKey = process.env.TENOR_API_KEY;
    
    if (!apiKey) {
        return { error: 'GIF search is not configured. Please set TENOR_API_KEY in environment variables.' };
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(
            `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${apiKey}&limit=10&media_filter=gif`,
            { signal: controller.signal }
        );
        clearTimeout(timeout);

        if (!response.ok) {
            return { error: `Tenor API returned status ${response.status}. Please try again later.` };
        }

        const data = await response.json();

        if (!data.results || data.results.length === 0) {
            return { error: 'No GIFs found for that search!' };
        }

        const randomGif = data.results[Math.floor(Math.random() * data.results.length)];

        // Safely resolve the best available format
        const gifUrl = randomGif.media_formats?.gif?.url
            || randomGif.media_formats?.mediumgif?.url
            || randomGif.media_formats?.tinygif?.url
            || null;

        if (!gifUrl) {
            return { error: 'Found a result but couldn\'t extract the GIF URL. Try a different query.' };
        }

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`**${query}** — *Powered by Tenor*`)
            )
            .addMediaGalleryComponents(
                new MediaGalleryBuilder().addItems(
                    new MediaGalleryItemBuilder().setURL(gifUrl)
                )
            );

        return { container };
    } catch (error) {
        if (error.name === 'AbortError') {
            return { error: 'GIF search timed out. Please try again.' };
        }
        console.error('[GIF] Search error:', error.message);
        return { error: 'Failed to fetch GIF. Please try again later.' };
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('gif')
        .setDescription('Search for a GIF')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('What to search for')
                .setRequired(true)),

    name: 'gif',
    prefix: 'gif',
    description: 'Search for a GIF from Tenor',
    usage: 'gif <query>',
    category: 'fun',
    aliases: ['giphy', 'tenor'],

    async execute(interaction) {
        const query = interaction.options.getString('query');
        await interaction.deferReply();
        
        const result = await searchGif(query);
        if (result.error) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> GIF Error\n\n${result.error}`)
                );
            return interaction.editReply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
        await interaction.editReply({ components: [result.container], flags: MessageFlags.IsComponentsV2 });
    },

    async executePrefix(message, args) {
        const query = args.join(' ');
        
        if (!query) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `# <:Cancel:1521227723916181644> Missing Query\n\nPlease provide a search query!\n\n**Usage:** \`-gif <query>\`\n**Example:** \`-gif happy dance\``
                    )
                );
            return message.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }

        const result = await searchGif(query);
        if (result.error) {
            const errorContainer = new ContainerBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`# <:Cancel:1521227723916181644> GIF Error\n\n${result.error}`)
                );
            return message.reply({ components: [errorContainer], flags: MessageFlags.IsComponentsV2 });
        }
        await message.reply({ components: [result.container], flags: MessageFlags.IsComponentsV2 });
    }
};
