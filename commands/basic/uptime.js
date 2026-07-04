const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');

function getUptimeContainer(client) {
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    const startTimestamp = Math.floor((Date.now() - uptime * 1000) / 1000);

    const parts = [];
    if (days > 0) parts.push(`**${days}**d`);
    if (hours > 0) parts.push(`**${hours}**h`);
    if (minutes > 0) parts.push(`**${minutes}**m`);
    parts.push(`**${seconds}**s`);

    return new ContainerBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`# <:Clock:1521228110408847623> Uptime`)
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `> <:Lightning:1521227915537285150> **Duration:** ${parts.join(' ')}\n` +
                `> <:Clock:1521228110408847623> **Online Since:** <t:${startTimestamp}:F>\n` +
                `> <:Caretright:1521227704953864202> **Relative:** <t:${startTimestamp}:R>`
            )
        )
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
}

module.exports = {
    prefix: 'uptime',
    description: 'Check how long the bot has been running',
    usage: 'uptime',
    category: 'basic',
    data: new SlashCommandBuilder()
        .setName('uptime')
        .setDescription('Check how long the bot has been running'),

    async execute(interaction) {
        try {
            const container = getUptimeContainer(interaction.client);
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error(`[UPTIME] Error:`, error);
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
            const container = getUptimeContainer(message.client);
            await message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error(`[UPTIME] Error:`, error);
            await message.reply('<:Cancel:1521227723916181644> An error occurred while running this command.').catch(() => {});
        }
    }
};
