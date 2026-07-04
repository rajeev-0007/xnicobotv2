const { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');

module.exports = {
    aliases: ['announcement', 'announce-embed'],
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send an announcement to a channel')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The announcement message')
                .setRequired(true))
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel to send the announcement')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('ping')
                .setDescription('Who to ping')
                .addChoices(
                    { name: 'Everyone', value: 'everyone' },
                    { name: 'Here', value: 'here' },
                    { name: 'None', value: 'none' }
                )
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    async execute(interaction) {
        const msg = interaction.options.getString('message');
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const ping = interaction.options.getString('ping') || 'none';
        let pingText = ping === 'everyone' ? '@everyone' : ping === 'here' ? '@here' : '';

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# <:Bullhorn:1521227936575914016> Announcement\n\n${msg}`)
            )
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`*Announced by ${interaction.user.username}*`)
            );

        if (pingText) {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(pingText));
        }

        const mentionOptions = ping === 'none' ? { parse: [] } : { parse: ['everyone'] };
        await channel.send({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: mentionOptions });
        await interaction.reply({ content: '<:Checkedbox:1521227734943269077> Announcement sent!', flags: MessageFlags.Ephemeral });
    },

    async executePrefix(message, args) {
        if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Permission', 'You need the **Manage Messages** permission.'));
        }

        const content = args.join(' ');
        if (!content) {
            return message.reply(require('../../utils/utilityUI').errReply('Missing Message', 'Please provide an announcement message.'));
        }

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`# <:Bullhorn:1521227936575914016> Announcement\n\n${content}`)
            )
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(`*Announced by ${message.author.username}*`)
            );

        await message.channel.send({ components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
        await message.delete().catch(() => {});
    }
};
