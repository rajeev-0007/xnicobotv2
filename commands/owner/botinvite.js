const { isOwner } = require('../../utils/helpers');
const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, OAuth2Scopes, PermissionsBitField } = require('discord.js');

module.exports = {
    name: 'botinvite',
    prefix: 'botinvite',
    aliases: ['generateinvite', 'invitelink', 'oauth'],
    description: 'Generate bot OAuth2 invite link',
    usage: 'botinvite',
    category: 'owner',
    ownerOnly: true,

    async executePrefix(message) {
        if (!isOwner(message.author.id)) return;
        await this.showInvite(message, message.client);
    },

    async showInvite(context, client) {
        const adminInvite = client.generateInvite({
            scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
            permissions: [PermissionsBitField.Flags.Administrator]
        });

        const standardInvite = client.generateInvite({
            scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
            permissions: [
                PermissionsBitField.Flags.ManageGuild,
                PermissionsBitField.Flags.ManageRoles,
                PermissionsBitField.Flags.ManageChannels,
                PermissionsBitField.Flags.KickMembers,
                PermissionsBitField.Flags.BanMembers,
                PermissionsBitField.Flags.ManageMessages,
                PermissionsBitField.Flags.EmbedLinks,
                PermissionsBitField.Flags.AttachFiles,
                PermissionsBitField.Flags.ReadMessageHistory,
                PermissionsBitField.Flags.UseExternalEmojis,
                PermissionsBitField.Flags.AddReactions,
                PermissionsBitField.Flags.Connect,
                PermissionsBitField.Flags.Speak,
                PermissionsBitField.Flags.ManageNicknames,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.CreateInstantInvite,
                PermissionsBitField.Flags.ModerateMembers
            ]
        });

        const container = new ContainerBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `### <:Key:1521228000467878111> Bot Invite Links\n` +
                    `**Bot:** ${client.user.username} (\`${client.user.id}\`)\n` +
                    `**Servers:** ${client.guilds.cache.size}`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `<:Shield:1521227694677692467> **Admin Invite** (full permissions)\n> ${adminInvite}\n\n` +
                    `<:Lock:1521227892770734120> **Standard Invite** (recommended permissions)\n> ${standardInvite}`
                )
            )
            .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
            .addActionRowComponents(
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setLabel('Admin Invite').setStyle(ButtonStyle.Link).setURL(adminInvite).setEmoji('<:Shield:1521227694677692467>'),
                    new ButtonBuilder().setLabel('Standard Invite').setStyle(ButtonStyle.Link).setURL(standardInvite).setEmoji('<:Lock:1521227892770734120>')
                )
            );

        const opts = { components: [container], flags: MessageFlags.IsComponentsV2 };
        if (context.reply) return context.reply(opts);
    }
};
