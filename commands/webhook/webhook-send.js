'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { buildExpiredPanel } = require('../../utils/responseBuilder');
const ui = require('../../utils/webhookUI');

module.exports = {
    data: null,
    prefix: 'webhook-send',
    description: 'Send a message through a webhook (inline or via modal)',
    usage: 'webhook-send <webhook ID> [message]',
    category: 'webhook',
    aliases: ['wh-send', 'sendwebhook', 'wh-msg'],
    permissions: ['ManageWebhooks'],

    async executePrefix(message, args) {
        const gid = message.guild.id;

        const permErr = ui.requireManageWebhooks(message.member, gid);
        if (permErr) return message.reply(ui.payload(permErr));

        const webhookId = args[0];
        if (!webhookId) {
            return message.reply(ui.payload(ui.errorPanel(gid, 'Invalid Usage',
                '`webhook-send <ID> <message>` — send inline\n`webhook-send <ID>` — open a compose modal',
                'Use `webhook-list` to see all webhooks.')));
        }

        const { webhooks, error } = await ui.fetchWebhooks(message.guild);
        if (error) return message.reply(ui.payload(error));

        const webhook = webhooks.get(webhookId);
        if (!webhook) {
            return message.reply(ui.payload(ui.errorPanel(gid, 'Not Found',
                `No webhook with ID \`${webhookId}\` exists.`, 'Use `webhook-list` to see available webhooks.')));
        }

        const uid = message.author.id;
        const sid = `${uid}_${Date.now().toString(36)}`;
        const msgContent = args.slice(1).join(' ');

        /* ── INLINE SEND ── */
        if (msgContent) {
            try {
                await webhook.send({
                    content: msgContent,
                    username: webhook.name,
                    avatarURL: webhook.avatarURL() || undefined
                });
            } catch (err) {
                console.error('Error sending webhook:', err);
                return message.reply(ui.payload(ui.errorPanel(gid, 'Failed', `Could not send message.\n> ${err.message}`)));
            }

            const result = ui.successPanel(gid, 'Message Sent',
                `Sent through **${webhook.name}** in <#${webhook.channelId}>.`,
                [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`whs:compose:${sid}:${webhookId}`).setEmoji(ui.E.pencil).setLabel('Compose Another').setStyle(ButtonStyle.Primary)
                )]
            );
            const sent = await message.reply(ui.payload(result));
            return this._follow(sent, message, uid);
        }

        /* ── COMPOSE MODE ── */
        const ch = message.guild.channels.cache.get(webhook.channelId);
        const prompt = ui.infoPanel(gid, `${ui.E.edit} Send via ${webhook.name}`,
            `### ${ui.E.gear} Target\n` +
            ui.rows(
                `**Channel:** ${ch ? `<#${ch.id}>` : '*Unknown*'}`,
                `**ID:** \`${webhook.id}\``
            ) +
            `\n\n-# Click **Compose** to open the editor with custom username & avatar options.`,
            [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`whs:compose:${sid}:${webhookId}`).setEmoji(ui.E.pencil).setLabel('Compose Message').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`whs:cancel:${sid}`).setEmoji(ui.E.no).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
            )]
        );

        const sent = await message.reply(ui.payload(prompt));
        this._follow(sent, message, uid);
    },

    _follow(sent, message, uid) {
        const gid = message.guild.id;
        const collector = sent.createMessageComponentCollector({ time: ui.TIMEOUTS.FOLLOW });

        collector.on('collect', async (i) => {
            if (i.user.id !== uid) {
                return i.reply({ content: `${ui.E.no} Only the command invoker can use these controls.`, flags: MessageFlags.Ephemeral });
            }
            const parts = i.customId.split(':');
            const action = parts[1];

            if (action === 'cancel') {
                collector.stop('cancelled');
                return i.update(ui.payload(ui.infoPanel(gid, 'Cancelled', 'Send cancelled.')));
            }
            if (action === 'compose') {
                return i.showModal(ui.sendModal(uid, parts[3], 'Compose Webhook Message'));
            }
        });

        collector.on('end', (_, reason) => {
            if (reason === 'cancelled') return;
            sent.edit(ui.payload(ui.applyStyle(buildExpiredPanel('webhook-send'), gid))).catch(() => {});
        });
    },

    /* ── MODAL HANDLER (routed from index.js for wh_modal_send) ── */
    async handleModalSubmit(interaction) {
        const parts = interaction.customId.split(':');
        const uid = parts[1];
        const whId = parts[2];
        const gid = interaction.guild?.id;

        if (interaction.user.id !== uid) {
            return interaction.reply({ content: `${ui.E.no} This modal is not for you.`, flags: MessageFlags.Ephemeral });
        }

        const { webhooks, error } = await ui.fetchWebhooks(interaction.guild);
        if (error) return interaction.reply(ui.payload(error));

        const webhook = webhooks.get(whId);
        if (!webhook) {
            return interaction.reply(ui.payload(ui.errorPanel(gid, 'Not Found', 'Webhook no longer exists.')));
        }

        const content = interaction.fields.getTextInputValue('content');
        const username = interaction.fields.getTextInputValue('username')?.trim() || undefined;
        const avatarURL = interaction.fields.getTextInputValue('avatar_url')?.trim() || undefined;

        try {
            await webhook.send({
                content,
                username: username || webhook.name,
                avatarURL: avatarURL || webhook.avatarURL() || undefined
            });
            return interaction.reply(ui.payload(ui.successPanel(gid, 'Message Sent',
                `Sent through **${username || webhook.name}** in <#${webhook.channelId}>.`)));
        } catch (err) {
            console.error('Error sending webhook message via modal:', err);
            return interaction.reply(ui.payload(ui.errorPanel(gid, 'Failed', `Could not send message.\n> ${err.message}`)));
        }
    }
};
