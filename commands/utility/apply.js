const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildErrorResponse, buildSuccessResponse } = require('../../utils/responseBuilder');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('apply')
        .setDescription('Submit an application to this server'),

    prefix: 'apply',
    description: 'Submit an application to this server',
    usage: 'apply',
    category: 'utility',
    aliases: ['app'],

    async execute(interaction) {
        const appCmd = interaction.client.commands.get('application');
        if (!appCmd) {
            return interaction.reply({ components: [buildErrorResponse('Unavailable', 'Application system is not available.')], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
        }

        return appCmd.startApplication(interaction);
    },

    async executePrefix(message) {
        const appCmd = message.client.commands.get('application');
        if (!appCmd) {
            return message.reply({ components: [buildErrorResponse('Unavailable', 'Application system is not available.')], flags: MessageFlags.IsComponentsV2 });
        }

        const config = appCmd.loadConfig();
        const guildConfig = config[message.guild.id];

        if (!guildConfig || !guildConfig.enabled) {
            return message.reply({ components: [buildErrorResponse('Closed', 'Applications are currently closed in this server.')], flags: MessageFlags.IsComponentsV2 });
        }

        const content = `# <:Document:1521227875016114266> ${guildConfig.name}\n\n${guildConfig.description}\n\n-# Click the button below to start your application`;

        const container = new ContainerBuilder()
            .setAccentColor(guildConfig.color || 0x5865F2);

        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('app_apply_start')
                .setLabel('Apply Now')
                .setStyle(ButtonStyle.Success)
                .setEmoji('<:Document:1521227875016114266>')
        );

        container.addActionRowComponents(row);

        return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
    }
};
