'use strict';

const {
    PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder,
    SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, MessageFlags
} = require('discord.js');
const { buildExpiredPanel } = require('../../utils/responseBuilder');
const ui = require('../../utils/webhookUI');

module.exports = {
    data: null,
    prefix: 'webhook-create',
    description: 'Create a new webhook in a channel with confirmation',
    usage: 'webhook-create <#channel> <webhook name>',
    category: 'webhook',
    aliases: ['wh-create', 'createwebhook'],
    permissions: ['ManageWebhooks'],

    async executePrefix(message, args) {
        const gid = message.guild.id;

        const permErr = ui.requireManageWebhooks(message.member, gid);
        if (permErr) return message.reply(ui.payload(permErr));

        const channelMention = args[0];
        const webhookName = args.slice(1).join(' ');

        if (!channelMention || !webhookName) {
            return message.reply(ui.payload(ui.errorPanel(gid, 'Invalid Usage',
                'Provide a channel and a webhook name.',
                'Usage: `webhook-create <#channel> <name>` — e.g. `webhook-create #general News`')));
        }

        const channel = message.guild.channels.cache.get(channelMention.replace(/[<#>]/g, ''));
        if (!channel || !channel.isTextBased()) {
            return message.reply(ui.payload(ui.errorPanel(gid, 'Invalid Channel', 'Please mention a valid text channel.')));
        }
        if (!channel.permissionsFor(message.guild.members.me).has(PermissionFlagsBits.ManageWebhooks)) {
            return message.reply(ui.payload(ui.errorPanel(gid, 'Missing Bot Permission', `I can't manage webhooks in <#${channel.id}>.`)));
        }
        if (webhookName.length > 80) {
            return message.reply(ui.payload(ui.errorPanel(gid, 'Name Too Long', `Webhook name must be 80 characters or fewer (yours is ${webhookName.length}).`)));
        }

        const uid = message.author.id;
        const sid = `${uid}_${Date.now().toString(36)}`;

        const confirm = new ContainerBuilder()
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${ui.E.hook} Create Webhook\n-# Review the details below and confirm`))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true))
            .addTextDisplayComponents(new TextDisplayBuilder().setContent(
                `### ${ui.E.gear} Details\n` +
                ui.rows(
                    `**Name:** ${webhookName}`,
                    `**Channel:** <#${channel.id}>`,
                    `**Avatar:** Your profile picture`
                )
            ))
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true));
        confirm.addActionRowComponents(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`whc:confirm:${sid}`).setEmoji(ui.E.ok).setLabel('Create').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`whc:cancel:${sid}`).setEmoji(ui.E.no).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        ));
        ui.applyStyle(confirm, gid);

        const sent = await message.reply(ui.payload(confirm));
        const collector = sent.createMessageComponentCollector({ time: ui.TIMEOUTS.CONFIRM });

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) {
                return i.reply({ content: `${ui.E.no} Only the command invoker can use this.`, flags: MessageFlags.Ephemeral });
            }
            const action = i.customId.split(':')[1];
            collector.stop('handled');

            if (action === 'cancel') {
                return i.update(ui.payload(ui.infoPanel(gid, 'Cancelled', 'Webhook creation was cancelled.')));
            }

            try {
                const webhook = await channel.createWebhook({
                    name: webhookName,
                    avatar: message.author.displayAvatarURL({ extension: 'png' }),
                    reason: `Webhook created by ${message.author.username}`
                });

                const result = ui.successPanel(gid, 'Webhook Created',
                    `Created **${webhookName}** in <#${channel.id}>.\n\n` +
                    `### ${ui.E.gear} Details\n` +
                    ui.rows(
                        `**ID:** \`${webhook.id}\``,
                        `**URL:** ||${webhook.url}||`
                    ) +
                    `\n\n-# Keep this URL private — anyone with it can post as this webhook.`,
                    [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`whc:send:${sid}:${webhook.id}`).setEmoji(ui.E.send).setLabel('Send a Message').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setURL(ui.PORTAL_URL).setLabel('Web Portal').setEmoji(ui.E.hook).setStyle(ButtonStyle.Link)
                    )]
                );
                await i.update(ui.payload(result));

                const follow = sent.createMessageComponentCollector({ time: ui.TIMEOUTS.FOLLOW });
                follow.on('collect', async (fi) => {
                    if (fi.user.id !== uid) {
                        return fi.reply({ content: `${ui.E.no} Only the command invoker can use this.`, flags: MessageFlags.Ephemeral });
                    }
                    if (fi.customId.split(':')[1] === 'send') {
                        follow.stop('handled');
                        return fi.showModal(ui.sendModal(uid, webhook.id));
                    }
                });
            } catch (err) {
                console.error('Error creating webhook:', err);
                return i.update(ui.payload(ui.errorPanel(gid, 'Failed', `Could not create webhook.\n> ${err.message}`)));
            }
        });

        collector.on('end', (_, reason) => {
            if (reason === 'handled') return;
            sent.edit(ui.payload(ui.applyStyle(buildExpiredPanel('webhook-create'), gid))).catch(() => {});
        });
    }
};
