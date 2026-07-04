const { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { buildErrorResponse, COLORS } = require('../../utils/responseBuilder');

async function buildFirstMsg(channel) {
    const messages = await channel.messages.fetch({ limit: 1, after: '0' });
    const firstMessage = messages.first();
    if (!firstMessage) return null;

    const container = new ContainerBuilder()
        .setAccentColor(COLORS.INFO)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# <:Editalt:1521227921673556019> First Message`))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `<:Bullhorn:1521227936575914016> **Channel:** ${channel}\n` +
            `<:User:1521227714227343380> **Author:** ${firstMessage.author}\n` +
            `<:Clock:1521228110408847623> **Date:** <t:${Math.floor(firstMessage.createdTimestamp / 1000)}:F>`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
            `### <:Edit:1521227886634205298> Content\n> ${firstMessage.content || '*No text content*'}`
        ))
        .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Jump to Message')
            .setStyle(ButtonStyle.Link)
            .setURL(firstMessage.url)
            .setEmoji('<:Attach:1521228039135170722>')
    );

    return { container, row };
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('firstmsg')
        .setDescription('Get the first message in a channel')
        .addChannelOption(opt => opt.setName('channel').setDescription('Channel to check')),

    prefix: 'firstmsg',
    description: 'Get the first message in a channel',
    usage: 'firstmsg [#channel]',
    category: 'basic',
    aliases: ['firstmessage'],

    async execute(interaction) {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        try {
            const result = await buildFirstMsg(channel);
            if (!result) {
                const container = buildErrorResponse('No Messages Found', `Could not find the first message in ${channel}.`);
                return interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            await interaction.reply({ components: [result.container, result.row], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('First Message Error:', error);
            const container = buildErrorResponse('Failed to Fetch', 'Could not fetch the first message.', 'I may not have permission to view this channel.');
            await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    },

    async executePrefix(message, args) {
        const channel = message.mentions.channels.first() || message.channel;
        try {
            const result = await buildFirstMsg(channel);
            if (!result) {
                const container = buildErrorResponse('No Messages Found', `Could not find the first message in ${channel}.`);
                return message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
            }
            message.reply({ components: [result.container, result.row], flags: MessageFlags.IsComponentsV2 });
        } catch (error) {
            console.error('First Message Error:', error);
            const container = buildErrorResponse('Failed to Fetch', 'Could not fetch the first message.', 'I may not have permission to view this channel.');
            message.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
        }
    }
};
