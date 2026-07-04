const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');

function buildSpotifyUnavailable() {
    const content = `# <:Music:1521228141543165982> Spotify Status\n\n` +
        `<:Cancel:1521227723916181644> **This command is no longer available.**\n\n` +
        `Viewing Spotify activity requires the Presence Intent, which has been disabled for performance and scalability reasons.\n\n` +
        `### Alternatives\n` +
        `> <:Music:1521228141543165982> Use the \`play\` command to play Spotify tracks directly\n` +
        `> <:Lightbulbalt:1521227880703463675> Share a Spotify link in chat for others to see`;

    return new ContainerBuilder()
        .setAccentColor(0x1DB954)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
}

module.exports = {
    prefix: 'spotify',
    description: 'Spotify status viewing is no longer available',
    usage: 'spotify',
    category: 'utility',
    aliases: [],

    data: new SlashCommandBuilder()
        .setName('spotify')
        .setDescription('Spotify status viewing (currently unavailable)')
        .addUserOption(option => option.setName('user').setDescription('User to check').setRequired(false)),

    async execute(interaction) {
        return interaction.reply({ components: [buildSpotifyUnavailable()], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    },

    async executePrefix(message) {
        return message.reply({ components: [buildSpotifyUnavailable()], flags: MessageFlags.IsComponentsV2 });
    }
};
