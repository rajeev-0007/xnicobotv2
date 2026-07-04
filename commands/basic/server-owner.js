const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { COLORS } = require('../../utils/responseBuilder');

async function buildOwnerContainer(guild) {
    const owner = await guild.fetchOwner();

    let content = `# <:Crown:1521227739988889764> Server Owner\n\n`;
    content += `**${owner.user.username}** (${owner})\n\n`;
    content += `### <:Bookopen:1521227911137595605> Details\n`;
    content += `> <:Fileuser:1521228225466859792> **ID:** \`${owner.id}\`\n`;
    content += `> <:Lightning:1521227915537285150> **Joined Server:** <t:${Math.floor(owner.joinedTimestamp / 1000)}:R>\n`;
    content += `> <:Clock:1521228110408847623> **Account Created:** <t:${Math.floor(owner.user.createdTimestamp / 1000)}:R>\n\n`;
    content += `### <:Userplus:1521227719621218477> Roles\n`;
    content += `> <:Caretright:1521227704953864202> **Role Count:** ${owner.roles.cache.size - 1}\n`;
    content += `> <:Award:1521228119640375336> **Highest Role:** ${owner.roles.highest}`;

    const section = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
        .setThumbnailAccessory(new ThumbnailBuilder({ media: { url: owner.user.displayAvatarURL({ size: 256 }) } }));

    return new ContainerBuilder()
        .setAccentColor(owner.displayColor || COLORS.WARNING)
        .addSectionComponents(section)
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

module.exports = {
    prefix: 'server-owner',
    description: 'View information about the server owner',
    usage: 'server-owner',
    category: 'basic',
    aliases: ['owner', 'serverowner'],

    data: new SlashCommandBuilder()
        .setName('server-owner')
        .setDescription('View information about the server owner'),

    async execute(interaction) {
        try {
            const container = await buildOwnerContainer(interaction.guild);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error(`[SERVER-OWNER] Error:`, error);
            const content = '<:Cancel:1521227723916181644> An error occurred while running this command.';
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content }).catch(() => {});
            } else {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
        }
    },

    async executePrefix(message) {
        try {
            const container = await buildOwnerContainer(message.guild);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error(`[SERVER-OWNER] Error:`, error);
            await message.reply('<:Cancel:1521227723916181644> An error occurred while running this command.').catch(() => {});
        }
    }
};
